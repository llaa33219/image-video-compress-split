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

const app = express();
const PORT = process.env.PORT || 3000;

// 미들웨어 설정
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
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
          targetSizeKB: 'number (required) - 목표 용량 (KB)'
        }
      },
      video_compression: {
        method: 'POST',
        path: '/api/compress-video',
        description: '영상 압축 또는 분할',
        parameters: {
          video: 'file (required) - 영상 파일',
          targetSizeMB: 'number (required) - 목표 용량 (MB)',
          compressionMode: 'string (required) - "compress" 또는 "split"'
        }
      },
      webm_split: {
        method: 'POST',
        path: '/api/split-webm',
        description: 'WebM 화질 변경 감지 및 분할',
        parameters: {
          video: 'file (required) - WebM 파일',
          targetSizeMB: 'number (required) - 각 분할 파일 최대 용량 (MB)'
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

    const { targetSizeKB } = req.body;
    if (!targetSizeKB || isNaN(targetSizeKB)) {
      return res.status(400).json({ error: '유효한 목표 용량(KB)을 입력해주세요.' });
    }

    const result = await compressImage(req.file.path, parseInt(targetSizeKB));
    
    // 업로드된 파일 삭제
    await fs.remove(req.file.path);
    
    res.json(result);
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

    const { targetSizeMB, compressionMode } = req.body;
    if (!targetSizeMB || isNaN(targetSizeMB)) {
      return res.status(400).json({ error: '유효한 목표 용량(MB)을 입력해주세요.' });
    }

    if (!['compress', 'split'].includes(compressionMode)) {
      return res.status(400).json({ error: '압축 모드는 "compress" 또는 "split"이어야 합니다.' });
    }

    let result;
    if (compressionMode === 'compress') {
      result = await compressVideo(req.file.path, parseInt(targetSizeMB));
    } else {
      result = await splitVideo(req.file.path, parseInt(targetSizeMB));
    }
    
    // 업로드된 파일 삭제
    await fs.remove(req.file.path);
    
    res.json(result);
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

    const { targetSizeMB } = req.body;
    if (!targetSizeMB || isNaN(targetSizeMB)) {
      return res.status(400).json({ error: '유효한 목표 용량(MB)을 입력해주세요.' });
    }

    // WebM 화질 변경 감지 및 분할
    const result = await detectWebMQualityChange(req.file.path, parseInt(targetSizeMB));
    
    // 업로드된 파일 삭제
    await fs.remove(req.file.path);
    
    res.json(result);
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
