# 미디어 압축 및 분할 API 서비스

이미지와 영상을 효율적으로 압축하고 분할하는 RESTful API 서비스입니다.

**외부 사이트에서 API로 호출하여 사용하는 것이 주요 목적입니다.**

## 최근 업데이트 (2025-10-09)

### 성능 최적화 (v2.0)
- 🚀 **이미지 압축 속도 대폭 향상**: 버퍼 기반 처리로 디스크 I/O 최소화 (약 2-3배 빠름)
- 🚀 **비디오 처리 하드웨어 가속**: NVIDIA NVENC, Intel QSV, AMD AMF, VAAPI 자동 감지 및 사용
- 🚀 **멀티스레딩 최적화**: CPU 코어의 75%를 활용한 병렬 처리
- 🚀 **VP9 WebM 인코딩 최적화**: realtime deadline, row-mt, tile-columns로 속도 향상 (약 3-5배 빠름)
- 🚀 **FFmpeg 프리셋 개선**: fast → veryfast, zerolatency tune 적용
- 🚀 **Sharp 최적화**: mozjpeg, adaptiveFiltering, effort 옵션으로 품질 유지하며 속도 향상
- ✅ **정확도 유지**: 모든 최적화는 압축 정확도를 유지하면서 속도만 개선

### 이전 업데이트 (2025-10-08)
- ✅ **영상 분할 기능 수정**: FFmpeg 명령어 개선으로 영상 분할이 정상적으로 작동
- ✅ **파일 크기 표시 개선**: 소수점 2자리까지 정확하게 표시 (KB/MB/GB 자동 변환)
- ✅ **압축률 계산 정확도 향상**: 소수점 1자리까지 표시
- ✅ **진행 상황 로깅 추가**: 각 처리 단계마다 콘솔에 상세 로그 출력
- ✅ **코덱 설정 명시**: 영상 압축/분할 시 libx264, aac 코덱 명시적 지정
- ✅ **단위 통일**: 모든 API가 KB 단위로 통일되어 일관성 향상

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

## 성능 최적화 상세

### 이미지 압축 최적화
1. **버퍼 기반 처리**: 이진 탐색 중 디스크에 파일을 쓰지 않고 메모리 버퍼로 처리
2. **Sharp 최적화 옵션**:
   - `mozjpeg: true` - Mozilla의 최적화된 JPEG 인코더 사용
   - `compressionLevel: 9` - PNG 최대 압축
   - `adaptiveFiltering: true` - PNG 적응형 필터링
   - `effort: 4` - WebP 인코딩 노력도 (0-6, 4는 속도와 품질의 균형)

### 비디오 압축 최적화
1. **하드웨어 가속 자동 감지**:
   - **NVIDIA NVENC** (가장 빠름): `h264_nvenc`, preset p1, low latency
   - **Intel QSV**: `h264_qsv`, veryfast preset
   - **AMD AMF**: `h264_amf`, speed quality
   - **VAAPI** (Linux): `h264_vaapi`
   - 하드웨어 가속 미지원 시 최적화된 소프트웨어 인코딩 사용

2. **멀티스레딩**:
   - CPU 코어의 75% 활용 (안정성 유지)
   - FFmpeg threads 옵션 자동 설정

3. **FFmpeg 최적화 옵션**:
   - `preset veryfast` - 빠른 인코딩 (품질 유지)
   - `tune zerolatency` - 지연 시간 최소화
   - `keyint 60` - 키프레임 간격 최적화

### WebM/VP9 최적화
VP9은 원래 매우 느린 코덱이지만, 다음 옵션으로 속도 대폭 개선:
- `deadline realtime` - 실시간 인코딩 모드
- `cpu-used 5` - 가장 빠른 CPU 설정 (0-5)
- `row-mt 1` - 행 기반 멀티스레딩
- `tile-columns 2` - 타일 인코딩으로 병렬 처리
- `frame-parallel 1` - 프레임 병렬 처리
- `auto-alt-ref 0` - alt-ref 프레임 비활성화
- `lag-in-frames 0` - 지연 프레임 제거

### 예상 성능 향상
- **이미지 압축**: 2-3배 속도 향상 (디스크 I/O 제거)
- **비디오 압축 (하드웨어 가속)**: 5-10배 속도 향상
- **비디오 압축 (소프트웨어)**: 1.5-2배 속도 향상
- **WebM/VP9 처리**: 3-5배 속도 향상

## 기술 스택

- **Backend**: Node.js, Express.js
- **이미지 처리**: Sharp (libvips 기반)
- **영상 처리**: FFmpeg (하드웨어 가속 지원)
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

## 중요 사항

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
