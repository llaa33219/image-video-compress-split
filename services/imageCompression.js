const sharp = require('sharp');
const fs = require('fs-extra');
const path = require('path');
const compressionCache = require('./compressionCache');

/**
 * 이미지를 목표 용량 이하로 압축
 * @param {string} inputPath - 입력 이미지 경로
 * @param {number} targetSizeKB - 목표 용량 (KB)
 * @returns {Promise<Object>} 압축 결과
 */
async function compressImage(inputPath, targetSizeKB) {
  try {
    const outputDir = path.join(__dirname, '..', 'output');
    await fs.ensureDir(outputDir);
    
    // 원본 파일 정보
    const originalStats = await fs.stat(inputPath);
    const originalSizeKB = (originalStats.size / 1024).toFixed(2);
    
    // 이미 목표 용량 이하인 경우
    if (parseFloat(originalSizeKB) <= targetSizeKB) {
      const outputPath = path.join(outputDir, `compressed_${Date.now()}_${path.basename(inputPath)}`);
      await fs.copy(inputPath, outputPath);
      
      return {
        success: true,
        message: `이미지가 이미 목표 용량(${targetSizeKB}KB) 이하입니다.`,
        originalSize: parseFloat(originalSizeKB),
        compressedSize: parseFloat(originalSizeKB),
        compressionRatio: 0,
        outputPath: `/output/${path.basename(outputPath)}`,
        action: 'copied'
      };
    }
    
    // 이미지 메타데이터 가져오기
    const metadata = await sharp(inputPath).metadata();
    const { width, height, format } = metadata;
    
    // Sharp 인스턴스 생성 (한 번만 읽기)
    const inputBuffer = await fs.readFile(inputPath);
    
    // 캐시에서 품질 값 확인
    const cachedQuality = compressionCache.get(format, parseFloat(originalSizeKB), targetSizeKB);
    
    let initialQuality;
    if (cachedQuality !== null) {
      // 캐시된 값 사용
      initialQuality = cachedQuality;
      console.log(`캐시에서 품질 값 사용: ${initialQuality}`);
    } else {
      // 초기 품질 추정 - 목표 크기 비율을 기반으로
      const compressionRatio = targetSizeKB / parseFloat(originalSizeKB);
      
      // 경험적 추정값 (파일 형식별)
      if (format === 'jpeg' || format === 'jpg') {
        initialQuality = Math.round(compressionRatio * 100);
      } else if (format === 'png') {
        // PNG는 압축이 더 어려우므로 더 낮은 품질 시작
        initialQuality = Math.round(compressionRatio * 80);
      } else if (format === 'webp') {
        initialQuality = Math.round(compressionRatio * 90);
      } else {
        initialQuality = Math.round(compressionRatio * 85);
      }
      
      // 품질 범위 제한
      initialQuality = Math.max(10, Math.min(95, initialQuality));
    }
    
    // 이진 탐색으로 최적 품질 찾기
    let minQuality = 10;
    let maxQuality = 95; // 100은 거의 차이가 없으므로 95로 제한
    let bestQuality = initialQuality;
    let bestBuffer = null;
    let attempts = 0;
    const maxAttempts = 7; // 최대 탐색 횟수 제한
    
    // 초기 추정값에서 탐색 범위 좁히기
    if (initialQuality > 10 && initialQuality < 95) {
      minQuality = Math.max(10, initialQuality - 20);
      maxQuality = Math.min(95, initialQuality + 20);
    }
    
    while (minQuality <= maxQuality && attempts < maxAttempts) {
      attempts++;
      const quality = Math.floor((minQuality + maxQuality) / 2);
      
      // 포맷별 최적화된 압축 옵션
      let compressedBuffer;
      if (format === 'jpeg' || format === 'jpg') {
        compressedBuffer = await sharp(inputBuffer)
          .jpeg({ 
            quality: quality,
            progressive: true, // 프로그레시브 JPEG로 더 나은 압축
            optimizeScans: true, // 스캔 최적화
            mozjpeg: true // mozjpeg 인코더 사용 (더 나은 압축)
          })
          .toBuffer();
      } else if (format === 'png') {
        compressedBuffer = await sharp(inputBuffer)
          .png({ 
            quality: quality,
            compressionLevel: 9, // 최대 압축
            adaptiveFiltering: true,
            palette: true // 가능한 경우 팔레트 사용
          })
          .toBuffer();
      } else if (format === 'webp') {
        compressedBuffer = await sharp(inputBuffer)
          .webp({ 
            quality: quality,
            lossless: false,
            effort: 4 // 압축 노력 수준 (0-6, 기본값 4)
          })
          .toBuffer();
      } else {
        // 기타 포맷은 JPEG로 변환
        compressedBuffer = await sharp(inputBuffer)
          .jpeg({ 
            quality: quality,
            progressive: true,
            mozjpeg: true
          })
          .toBuffer();
      }
      
      const compressedSizeKB = compressedBuffer.length / 1024;
      
      if (compressedSizeKB <= targetSizeKB) {
        bestQuality = quality;
        bestBuffer = compressedBuffer;
        minQuality = quality + 1;
      } else {
        maxQuality = quality - 1;
      }
    }
    
    // 최종 압축 결과 저장
    const outputPath = path.join(outputDir, `compressed_${Date.now()}_${path.basename(inputPath)}`);
    
    if (bestBuffer) {
      await fs.writeFile(outputPath, bestBuffer);
    } else {
      // 최소 품질로도 목표 크기를 달성할 수 없는 경우
      const finalBuffer = await sharp(inputBuffer)
        .jpeg({ 
          quality: 10,
          progressive: true,
          mozjpeg: true
        })
        .toBuffer();
      await fs.writeFile(outputPath, finalBuffer);
      bestQuality = 10;
    }
    
    const finalStats = await fs.stat(outputPath);
    const finalSizeKB = (finalStats.size / 1024).toFixed(2);
    
    const compressionRatioPercent = (((parseFloat(originalSizeKB) - parseFloat(finalSizeKB)) / parseFloat(originalSizeKB)) * 100).toFixed(1);
    
    // 성공한 품질 값을 캐시에 저장
    compressionCache.set(format, parseFloat(originalSizeKB), targetSizeKB, bestQuality);
    
    return {
      success: true,
      message: `이미지가 성공적으로 압축되었습니다.`,
      originalSize: parseFloat(originalSizeKB),
      compressedSize: parseFloat(finalSizeKB),
      compressionRatio: parseFloat(compressionRatioPercent),
      quality: bestQuality,
      dimensions: `${width}x${height}`,
      format: format,
      outputPath: `/output/${path.basename(outputPath)}`,
      action: 'compressed',
      attempts: attempts // 디버깅용
    };
    
  } catch (error) {
    console.error('이미지 압축 오류:', error);
    throw new Error(`이미지 압축 실패: ${error.message}`);
  }
}

/**
 * 이미지 리사이즈
 * @param {string} inputPath - 입력 이미지 경로
 * @param {number} maxWidth - 최대 너비
 * @param {number} maxHeight - 최대 높이
 * @returns {Promise<string>} 출력 파일 경로
 */
async function resizeImage(inputPath, maxWidth, maxHeight) {
  const outputDir = path.join(__dirname, '..', 'output');
  await fs.ensureDir(outputDir);
  
  const outputPath = path.join(outputDir, `resized_${Date.now()}_${path.basename(inputPath)}`);
  
  await sharp(inputPath)
    .resize(maxWidth, maxHeight, {
      fit: 'inside',
      withoutEnlargement: true
    })
    .toFile(outputPath);
  
  return outputPath;
}

module.exports = {
  compressImage,
  resizeImage
};
