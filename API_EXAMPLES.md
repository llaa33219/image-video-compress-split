# API 사용 예제

외부 사이트에서 API를 호출하는 방법입니다.

## 기본 정보

- **Base URL**: `https://ivcp.bloupla.net/`
- **Rate Limit**: 15분당 500 요청
- **최대 파일 크기**: 500MB

## 1. 이미지 압축 API

### 엔드포인트
```
POST /api/compress-image
```

### 요청 파라미터
- `image` (file, required): 압축할 이미지 파일
- `targetSizeKB` (number, required): 목표 용량 (KB)

### JavaScript/Fetch 예제
```javascript
async function compressImage(imageFile, targetSizeKB) {
  const formData = new FormData();
  formData.append('image', imageFile);
  formData.append('targetSizeKB', targetSizeKB);

  const response = await fetch('https://ivcp.bloupla.net/api/compress-image', {
    method: 'POST',
    body: formData
  });

  const result = await response.json();
  
  if (result.success) {
    console.log('압축 성공:', result);
    // 압축된 이미지 다운로드
    const downloadUrl = `https://ivcp.bloupla.net${result.outputPath}`;
    window.open(downloadUrl);
  } else {
    console.error('압축 실패:', result.error);
  }
  
  return result;
}

// 사용 예제
const fileInput = document.querySelector('input[type="file"]');
const file = fileInput.files[0];
compressImage(file, 500); // 500KB로 압축
```

### jQuery 예제
```javascript
function compressImage(imageFile, targetSizeKB) {
  const formData = new FormData();
  formData.append('image', imageFile);
  formData.append('targetSizeKB', targetSizeKB);

  $.ajax({
    url: 'https://ivcp.bloupla.net/api/compress-image',
    type: 'POST',
    data: formData,
    processData: false,
    contentType: false,
    success: function(result) {
      if (result.success) {
        console.log('압축 성공:', result);
        const downloadUrl = `https://ivcp.bloupla.net${result.outputPath}`;
        window.open(downloadUrl);
      }
    },
    error: function(xhr) {
      console.error('압축 실패:', xhr.responseJSON);
    }
  });
}
```

### cURL 예제
```bash
curl -X POST https://ivcp.bloupla.net/api/compress-image \
  -F "image=@/path/to/image.jpg" \
  -F "targetSizeKB=500"
```

### Python 예제
```python
import requests

def compress_image(image_path, target_size_kb):
    url = 'https://ivcp.bloupla.net/api/compress-image'
    
    with open(image_path, 'rb') as f:
        files = {'image': f}
        data = {'targetSizeKB': target_size_kb}
        
        response = requests.post(url, files=files, data=data)
        result = response.json()
        
        if result.get('success'):
            print('압축 성공:', result)
            # 압축된 이미지 다운로드
            download_url = f"https://ivcp.bloupla.net{result['outputPath']}"
            download_response = requests.get(download_url)
            
            with open('compressed_image.jpg', 'wb') as output_file:
                output_file.write(download_response.content)
        else:
            print('압축 실패:', result.get('error'))
        
        return result

# 사용 예제
compress_image('image.jpg', 500)
```

### 응답 예제
```json
{
  "success": true,
  "message": "이미지가 성공적으로 압축되었습니다.",
  "originalSize": 2048.56,
  "compressedSize": 498.23,
  "compressionRatio": 75.7,
  "quality": 65,
  "dimensions": "1920x1080",
  "format": "jpeg",
  "outputPath": "/output/compressed_1728378900123_image.jpg",
  "action": "compressed"
}
```

**참고**: 모든 크기는 KB 단위입니다.

## 2. 영상 압축 API

### 엔드포인트
```
POST /api/compress-video
```

### 요청 파라미터
- `video` (file, required): 압축할 영상 파일
- `targetSizeKB` (number, required): 목표 용량 (KB)
- `compressionMode` (string, required): "compress" (압축) 또는 "split" (분할)

### JavaScript 예제
```javascript
async function compressVideo(videoFile, targetSizeKB, mode = 'compress') {
  const formData = new FormData();
  formData.append('video', videoFile);
  formData.append('targetSizeKB', targetSizeKB);
  formData.append('compressionMode', mode);

  const response = await fetch('https://ivcp.bloupla.net/api/compress-video', {
    method: 'POST',
    body: formData
  });

  const result = await response.json();
  
  if (result.success) {
    console.log('처리 성공:', result);
    
    if (result.outputPath) {
      // 단일 파일 다운로드
      window.open(`https://ivcp.bloupla.net${result.outputPath}`);
    } else if (result.parts) {
      // 여러 파일 다운로드
      result.parts.forEach(part => {
        window.open(`https://ivcp.bloupla.net${part.outputPath}`);
      });
    }
  }
  
  return result;
}

// 사용 예제
const videoFile = document.querySelector('input[type="file"]').files[0];
compressVideo(videoFile, 102400, 'compress'); // 100MB (102400KB)로 압축
compressVideo(videoFile, 51200, 'split'); // 50MB (51200KB)씩 분할
```

### Python 예제
```python
import requests

def compress_video(video_path, target_size_kb, mode='compress'):
    url = 'https://ivcp.bloupla.net/api/compress-video'
    
    with open(video_path, 'rb') as f:
        files = {'video': f}
        data = {
            'targetSizeKB': target_size_kb,
            'compressionMode': mode
        }
        
        response = requests.post(url, files=files, data=data)
        result = response.json()
        
        if result.get('success'):
            print('처리 성공:', result)
            
            if result.get('outputPath'):
                # 단일 파일 다운로드
                download_url = f"https://ivcp.bloupla.net{result['outputPath']}"
                download_file(download_url, 'compressed_video.mp4')
            elif result.get('parts'):
                # 여러 파일 다운로드
                for part in result['parts']:
                    download_url = f"https://ivcp.bloupla.net{part['outputPath']}"
                    download_file(download_url, f"video_part{part['partNumber']}.mp4")
        
        return result

def download_file(url, filename):
    response = requests.get(url)
    with open(filename, 'wb') as f:
        f.write(response.content)
    print(f'다운로드 완료: {filename}')

# 사용 예제
compress_video('video.mp4', 102400, 'compress')  # 100MB = 102400KB
compress_video('video.mp4', 51200, 'split')  # 50MB = 51200KB
```

### 압축 모드 응답 예제
```json
{
  "success": true,
  "message": "영상이 성공적으로 압축되었습니다.",
  "originalSize": 256000,
  "compressedSize": 100352,
  "compressionRatio": 60.8,
  "duration": 120.5,
  "resolution": "1920x1080",
  "bitrate": 682,
  "outputPath": "/output/compressed_1728378900123_video.mp4",
  "action": "compressed"
}
```

### 분할 모드 응답 예제
```json
{
  "success": true,
  "message": "영상이 3개 구간으로 분할되었습니다.",
  "originalSize": 256000,
  "totalParts": 3,
  "parts": [
    {
      "partNumber": 1,
      "size": 49152,
      "duration": 40.17,
      "startTime": 0,
      "outputPath": "/output/split_1728378900123_video_part1.mp4"
    },
    {
      "partNumber": 2,
      "size": 49152,
      "duration": 40.17,
      "startTime": 40.17,
      "outputPath": "/output/split_1728378900124_video_part2.mp4"
    },
    {
      "partNumber": 3,
      "size": 49152,
      "duration": 40.16,
      "startTime": 80.34,
      "outputPath": "/output/split_1728378900125_video_part3.mp4"
    }
  ],
  "action": "split"
}
```

**참고**: 모든 크기는 KB 단위입니다.

## 3. WebM 분할 API (화질 변경 감지)

### 엔드포인트
```
POST /api/split-webm
```

### 요청 파라미터
- `video` (file, required): WebM 파일
- `targetSizeKB` (number, required): 각 분할 파일 최대 용량 (KB)

### JavaScript 예제
```javascript
async function splitWebM(webmFile, targetSizeKB) {
  const formData = new FormData();
  formData.append('video', webmFile);
  formData.append('targetSizeKB', targetSizeKB);

  const response = await fetch('https://ivcp.bloupla.net/api/split-webm', {
    method: 'POST',
    body: formData
  });

  const result = await response.json();
  
  if (result.success) {
    console.log('분할 성공:', result);
    console.log(`화질 변경 ${result.qualityChanges.length}개 감지`);
    
    // 모든 파트 다운로드
    result.parts.forEach(part => {
      console.log(`파트 ${part.partNumber}: ${part.size}KB`);
      if (part.qualityChange) {
        console.log('  → 화질 변경:', part.qualityChange);
      }
      window.open(`https://ivcp.bloupla.net${part.outputPath}`);
    });
  }
  
  return result;
}

// 사용 예제
const webmFile = document.querySelector('input[type="file"]').files[0];
splitWebM(webmFile, 51200); // 50MB = 51200KB
```

### 응답 예제
```json
{
  "success": true,
  "message": "WebM 파일이 4개 구간으로 분할되었습니다. (화질 변경 2개 감지)",
  "originalSize": 184320,
  "totalParts": 4,
  "qualityChanges": [
    {
      "timestamp": 30.5,
      "type": "bitrate_change",
      "from": 2500,
      "to": 1500
    },
    {
      "timestamp": 75.2,
      "type": "resolution_change",
      "from": "1920x1080",
      "to": "1280x720"
    }
  ],
  "parts": [
    {
      "partNumber": 1,
      "size": 46080,
      "duration": 30.5,
      "startTime": 0,
      "endTime": 30.5,
      "qualityChange": null,
      "outputPath": "/output/webm_1728378900123_video_part1.webm"
    },
    {
      "partNumber": 2,
      "size": 43008,
      "duration": 44.7,
      "startTime": 30.5,
      "endTime": 75.2,
      "qualityChange": {
        "timestamp": 30.5,
        "type": "bitrate_change",
        "from": 2500,
        "to": 1500
      },
      "outputPath": "/output/webm_1728378900124_video_part2.webm"
    }
  ],
  "action": "split_with_quality_detection"
}
```

**참고**: 모든 크기는 KB 단위입니다.

## 에러 응답

### 400 Bad Request
```json
{
  "error": "이미지 파일이 필요합니다."
}
```

### 429 Too Many Requests
```json
{
  "error": "너무 많은 요청입니다. 잠시 후 다시 시도해주세요."
}
```

### 500 Internal Server Error
```json
{
  "error": "이미지 압축 중 오류가 발생했습니다."
}
```

## 주의사항

1. **파일 크기 제한**: 최대 500MB
2. **Rate Limiting**: 15분당 500 요청
3. **파일 보관**: 처리된 파일은 일정 시간 후 자동 삭제됩니다
4. **CORS**: 모든 도메인에서 호출 가능
5. **동기 처리**: API는 동기적으로 처리되므로 큰 파일은 시간이 걸릴 수 있습니다

## 테스트

API 상태 확인:
```bash
curl https://ivcp.bloupla.net/
```

응답:
```json
{
  "service": "미디어 압축 및 분할 API",
  "version": "1.0.0",
  "status": "online",
  "endpoints": { ... }
}
```
