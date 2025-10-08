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
app.use(helmet());
app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? false : true,
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15분
  max: 100, // 최대 100 요청
  message: '너무 많은 요청입니다. 잠시 후 다시 시도해주세요.'
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

// 메인 페이지
app.get('/', (req, res) => {
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
