# Node.js 18 Alpine 이미지 사용
FROM node:18-alpine

# FFmpeg 설치
RUN apk add --no-cache ffmpeg

# 작업 디렉토리 설정
WORKDIR /app

# package.json과 package-lock.json 복사
COPY package*.json ./

# 의존성 설치
RUN npm ci --only=production

# 소스 코드 복사
COPY . .

# 업로드 및 출력 디렉토리 생성
RUN mkdir -p uploads output

# 포트 노출
EXPOSE 3000

# 애플리케이션 실행
CMD ["npm", "start"]
