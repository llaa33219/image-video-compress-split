const express = require('express');
const multer = require('multer');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs-extra');
const { compressImage } = require('./services/imageCompression');
const { compressVideo, splitVideo } = require('./services/videoCompression');
const { detectWebMQualityChange } = require('./services/webmProcessor');

/**
 * 파일 경로 또는 결과 객체로부터 MIME 타입을 결정합니다.
 * @param {string} outputPath - 파일 경로
 * @param {Object} result - 서비스 함수의 결과 객체
 * @returns {string} MIME 타입 문자열
 */
function getMimeType(outputPath, result) {
  const extension = path.extname(outputPath).toLowerCase();
  
  if (result && result.format) {
    return `image/${result.format}`;
  }
  
  switch (extension) {
    case '.jpeg':
    case '.jpg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.mp4':
      return 'video/mp4';
    case '.webm':
      return 'video/webm';
    default:
      return 'application/octet-stream';
  }
}

/**
 * 결과 객체에 Base64 인코딩된 파일 데이터를 추가합니다.
 * @param {Object} result - 서비스 함수에서 반환된 결과 객체
 * @param {boolean} returnBase64 - Base64 반환 여부
 * @returns {Promise<Object>} Base64 데이터가 추가된 결과 객체
 */
async function addBase64ToResult(result, returnBase64) {
  if (!returnBase64 || !result.success) {
    return result;
  }

  try {
    if (result.outputPath) {
      // output 디렉토리 경로 수정
      const filePath = path.join(__dirname, 'output', path.basename(result.outputPath));
      if (await fs.pathExists(filePath)) {
        const fileData = await fs.readFile(filePath);
        const mimeType = getMimeType(result.outputPath, result);
        result.base64 = `data:${mimeType};base64,${fileData.toString('base64')}`;
      }
    }

    if (result.parts && Array.isArray(result.parts)) {
      for (const part of result.parts) {
        if (part.outputPath) {
          const filePath = path.join(__dirname, 'output', path.basename(part.outputPath));
          if (await fs.pathExists(filePath)) {
            const fileData = await fs.readFile(filePath);
            const mimeType = getMimeType(part.outputPath);
            part.base64 = `data:${mimeType};base64,${fileData.toString('base64')}`;
          }
        }
      }
    }
  } catch (error) {
    console.error('Base64 변환 오류:', error);
    // Base64 변환에 실패하더라도 원본 결과는 반환하도록 처리
  }

  return result;
}


const app = express();
const PORT = process.env.PORT || 3000;

// 미들웨어 설정
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-hashes'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
}));
app.use(cors({
  origin: true, // 모든 출처 허용 (외부 API 호출용)
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Rate limiting - 외부 API 호출을 고려하여 제한 완화
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15분
  max: 500, // 최대 500 요청 (외부 API용으로 증가)
  message: { error: '너무 많은 요청입니다. 잠시 후 다시 시도해주세요.' },
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/', limiter);

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// 업로드 디렉토리 생성
const uploadDir = path.join(__dirname, 'uploads');
const outputDir = path.join(__dirname, 'output');
fs.ensureDirSync(uploadDir);
fs.ensureDirSync(outputDir);

// Multer 설정
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 500 * 1024 * 1024 // 500MB 제한
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'image/jpeg', 'image/png', 'image/webp', 'image/gif',
      'video/mp4', 'video/webm', 'video/avi', 'video/mov', 'video/mkv'
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('지원하지 않는 파일 형식입니다.'), false);
    }
  }
});

// 정적 파일 서빙
app.use('/output', express.static(outputDir));

// API 상태 확인 엔드포인트
app.get('/', (req, res) => {
  res.json({
    service: '미디어 압축 및 분할 API',
    version: '1.0.0',
    status: 'online',
    endpoints: {
      image_compression: {
        method: 'POST',
        path: '/api/compress-image',
        description: '이미지를 목표 용량으로 압축',
        parameters: {
          image: 'file (required) - 이미지 파일',
          targetSizeKB: 'number (required) - 목표 용량 (KB)',
          returnBase64: 'boolean (optional) - 결과를 Base64로 인코딩하여 포함할지 여부'
        }
      },
      video_compression: {
        method: 'POST',
        path: '/api/compress-video',
        description: '영상 압축 또는 분할',
        parameters: {
          video: 'file (required) - 영상 파일',
          targetSizeKB: 'number (required) - 목표 용량 (KB)',
          compressionMode: 'string (required) - "compress" 또는 "split"',
          returnBase64: 'boolean (optional) - 결과를 Base64로 인코딩하여 포함할지 여부'
        }
      },
      webm_split: {
        method: 'POST',
        path: '/api/split-webm',
        description: 'WebM 화질 변경 감지 및 분할',
        parameters: {
          video: 'file (required) - WebM 파일',
          targetSizeKB: 'number (required) - 각 분할 파일 최대 용량 (KB)',
          returnBase64: 'boolean (optional) - 결과를 Base64로 인코딩하여 포함할지 여부'
        }
      }
    },
    limits: {
      max_file_size: '500MB',
      rate_limit: '500 requests per 15 minutes'
    }
  });
});

// 웹 UI 페이지
app.get('/web', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 이미지 압축 API
app.post('/api/compress-image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '이미지 파일이 필요합니다.' });
    }

    const { targetSizeKB, returnBase64 } = req.body;
    if (!targetSizeKB || isNaN(targetSizeKB)) {
      return res.status(400).json({ error: '유효한 목표 용량(KB)을 입력해주세요.' });
    }

    const result = await compressImage(req.file.path, parseInt(targetSizeKB));

    // Base64 데이터 추가
    const finalResult = await addBase64ToResult(result, returnBase64 === 'true' || returnBase64 === true);

    // 업로드된 파일 삭제
    await fs.remove(req.file.path);
    
    res.json(finalResult);
  } catch (error) {
    console.error('이미지 압축 오류:', error);
    res.status(500).json({ error: '이미지 압축 중 오류가 발생했습니다.' });
  }
});

// 영상 압축 API
app.post('/api/compress-video', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '영상 파일이 필요합니다.' });
    }

    const { targetSizeKB, compressionMode, returnBase64 } = req.body;
    if (!targetSizeKB || isNaN(targetSizeKB)) {
      return res.status(400).json({ error: '유효한 목표 용량(KB)을 입력해주세요.' });
    }

    if (!['compress', 'split'].includes(compressionMode)) {
      return res.status(400).json({ error: '압축 모드는 "compress" 또는 "split"이어야 합니다.' });
    }

    let result;
    if (compressionMode === 'compress') {
      result = await compressVideo(req.file.path, parseInt(targetSizeKB));
    } else {
      result = await splitVideo(req.file.path, parseInt(targetSizeKB));
    }

    // Base64 데이터 추가
    const finalResult = await addBase64ToResult(result, returnBase64 === 'true' || returnBase64 === true);
    
    // 업로드된 파일 삭제
    await fs.remove(req.file.path);
    
    res.json(finalResult);
  } catch (error) {
    console.error('영상 처리 오류:', error);
    res.status(500).json({ error: '영상 처리 중 오류가 발생했습니다.' });
  }
});

// WebM 분할 API
app.post('/api/split-webm', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'WebM 파일이 필요합니다.' });
    }

    const { targetSizeKB, returnBase64 } = req.body;
    if (!targetSizeKB || isNaN(targetSizeKB)) {
      return res.status(400).json({ error: '유효한 목표 용량(KB)을 입력해주세요.' });
    }

    // WebM 화질 변경 감지 및 분할
    const result = await detectWebMQualityChange(req.file.path, parseInt(targetSizeKB));
    
    // Base64 데이터 추가
    const finalResult = await addBase64ToResult(result, returnBase64 === 'true' || returnBase64 === true);

    // 업로드된 파일 삭제
    await fs.remove(req.file.path);
    
    res.json(finalResult);
  } catch (error) {
    console.error('WebM 처리 오류:', error);
    res.status(500).json({ error: 'WebM 처리 중 오류가 발생했습니다.' });
  }
});

// 에러 핸들링 미들웨어
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: '파일 크기가 너무 큽니다. (최대 500MB)' });
    }
  }
  console.error('서버 오류:', error);
  res.status(500).json({ error: '서버 내부 오류가 발생했습니다.' });
});

// 404 핸들러
app.use((req, res) => {
  res.status(404).json({ error: '요청한 리소스를 찾을 수 없습니다.' });
});

app.listen(PORT, () => {
  console.log(`서버가 포트 ${PORT}에서 실행 중입니다.`);
});
