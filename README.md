# IVCP Service

이미지와 영상을 효율적으로 압축하고 분할하는 서비스입니다.

**외부 사이트에서 API로 호출하여 사용하는 것이 주요 목적입니다.**

## 기능

### 이미지 압축
- JPG, PNG, WebP, GIF 형식 지원
- 목표 용량(KB) 설정 가능
- 이미 목표 용량 이하인 경우 알림
- 이진 탐색을 통한 최적 품질 자동 조정
- 정확한 크기 측정 (소수점 2자리)

### 영상 압축
- MP4, WebM, AVI, MOV, MKV 형식 지원
- 목표 용량(KB) 설정 가능
- 압축 모드: 전체 영상 압축
- 분할 모드: 여러 개의 작은 파일로 분할
- H.264/AAC 코덱 사용으로 호환성 보장
- 실시간 진행 상황 로깅

### WebM 분할
- 화질 변경 지점 자동 감지
- 비트레이트 및 해상도 변화 감지
- 화질 변경 지점에서 자동 분할
- 각 분할 파일의 최대 용량(KB) 설정 가능
- VP9/Opus 코덱 사용

## 빠른 시작

### API 상태 확인
```bash
curl https://your-railway-app.railway.app/
```

### 이미지 압축 예제
```bash
curl -X POST https://your-railway-app.railway.app/api/compress-image \
  -F "image=@image.jpg" \
  -F "targetSizeKB=500"
```

### JavaScript에서 호출
```javascript
const formData = new FormData();
formData.append('image', imageFile);
formData.append('targetSizeKB', 500);

const response = await fetch('https://your-railway-app.railway.app/api/compress-image', {
  method: 'POST',
  body: formData
});

const result = await response.json();
console.log(result);
```

**자세한 API 사용법은 [API_EXAMPLES.md](./API_EXAMPLES.md)를 참조하세요.**

## API 엔드포인트

### 1. 이미지 압축
```
POST /api/compress-image
Content-Type: multipart/form-data

파라미터:
- image: 이미지 파일
- targetSizeKB: 목표 용량 (KB)
```

### 2. 영상 압축
```
POST /api/compress-video
Content-Type: multipart/form-data

파라미터:
- video: 영상 파일
- targetSizeKB: 목표 용량 (KB)
- compressionMode: "compress" 또는 "split"
```

### 3. WebM 분할
```
POST /api/split-webm
Content-Type: multipart/form-data

파라미터:
- video: WebM 파일
- targetSizeKB: 각 분할 파일 최대 용량 (KB)
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

## 보안 및 제한사항

- **Rate Limiting**: 15분당 500 요청 (외부 API 호출 고려)
- **파일 형식 검증**: 지원되는 형식만 허용
- **파일 크기 제한**: 최대 500MB
- **CORS**: 모든 도메인에서 API 호출 가능
- **Helmet 보안 헤더**: XSS, CSRF 등 보안 강화
- **자동 파일 정리**: 처리된 파일은 일정 시간 후 삭제

## 중요

### 단위 통일
- **모든 API가 KB 단위를 사용합니다**
- 이미지 압축: `targetSizeKB` (예: 500KB)
- 영상 압축/분할: `targetSizeKB` (예: 102400KB = 100MB)
- WebM 분할: `targetSizeKB` (예: 51200KB = 50MB)

### 변환 참고
- 1 MB = 1024 KB
- 10 MB = 10240 KB
- 50 MB = 51200 KB
- 100 MB = 102400 KB
- 500 MB = 512000 KB

## 웹 UI 접근

API 외에도 웹 브라우저에서 직접 사용할 수 있는 UI가 제공됩니다:
```
https://your-railway-app.railway.app/web
```

## 환경 변수

- `PORT`: 서버 포트 (기본값: 3000)
- `NODE_ENV`: 환경 설정 (production/development)

## 활용 예시

이 API는 다음과 같은 용도로 활용할 수 있습니다:

1. **파일 업로드 사이트**: 사용자가 업로드한 이미지/영상을 자동 압축
2. **CMS/블로그**: 게시물 작성 시 미디어 파일 최적화
3. **모바일 앱**: 앱에서 촬영한 사진/영상을 서버로 전송 전 압축
4. **채팅 애플리케이션**: 미디어 공유 시 자동 크기 조정
5. **영상 스트리밍**: 영상을 적절한 크기로 분할하여 업로드
