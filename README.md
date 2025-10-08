# 미디어 압축 및 분할 서비스

이미지와 영상을 효율적으로 압축하고 분할하는 웹 서비스입니다.

## 기능

### 이미지 압축
- JPG, PNG, WebP, GIF 형식 지원
- 목표 용량(KB) 설정 가능
- 이미 목표 용량 이하인 경우 알림
- 이진 탐색을 통한 최적 품질 자동 조정

### 영상 압축
- MP4, WebM, AVI, MOV, MKV 형식 지원
- 목표 용량(MB) 설정 가능
- 압축 모드: 전체 영상 압축
- 분할 모드: 여러 개의 작은 파일로 분할

### WebM 분할
- 화질 변경 지점 자동 감지
- 비트레이트 및 해상도 변화 감지
- 화질 변경 지점에서 자동 분할
- 각 분할 파일의 최대 용량 설정 가능

## API 엔드포인트

### 이미지 압축
```
POST /api/compress-image
Content-Type: multipart/form-data

파라미터:
- image: 이미지 파일
- targetSizeKB: 목표 용량 (KB)
```

### 영상 압축
```
POST /api/compress-video
Content-Type: multipart/form-data

파라미터:
- video: 영상 파일
- targetSizeMB: 목표 용량 (MB)
- compressionMode: "compress" 또는 "split"
```

### WebM 분할
```
POST /api/split-webm
Content-Type: multipart/form-data

파라미터:
- video: WebM 파일
- targetSizeMB: 각 분할 파일 최대 용량 (MB)
```

## 설치 및 실행

### 로컬 개발
```bash
# 의존성 설치
npm install

# 개발 서버 실행
npm run dev

# 프로덕션 서버 실행
npm start
```

### Railway 배포
1. GitHub에 코드 푸시
2. Railway에서 새 프로젝트 생성
3. GitHub 저장소 연결
4. 자동 배포 완료

## 기술 스택

- **Backend**: Node.js, Express.js
- **이미지 처리**: Sharp
- **영상 처리**: FFmpeg
- **파일 업로드**: Multer
- **보안**: Helmet, CORS, Rate Limiting
- **배포**: Railway

## 파일 제한

- 최대 파일 크기: 500MB
- 지원 형식:
  - 이미지: JPG, PNG, WebP, GIF
  - 영상: MP4, WebM, AVI, MOV, MKV

## 보안 기능

- Rate Limiting (15분당 100요청)
- 파일 형식 검증
- 파일 크기 제한
- CORS 설정
- Helmet 보안 헤더

## 환경 변수

- `PORT`: 서버 포트 (기본값: 3000)
- `NODE_ENV`: 환경 설정 (production/development)
