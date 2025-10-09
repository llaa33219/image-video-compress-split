const sharp = require('sharp');
const fs = require('fs-extra');
const path = require('path');

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
    
    console.log(`이미지 압축 시작: ${width}x${height}, 포맷: ${format}`);
    
    // 압축 품질 설정 (초기값)
    let quality = 80;
    let bestBuffer = null;
    let bestQuality = 10;
    let compressedSizeKB = 0;
    
    // 이진 탐색으로 최적 품질 찾기 (버퍼 사용으로 디스크 I/O 최소화)
    let minQuality = 10;
    let maxQuality = 100;
    let iterations = 0;
    const maxIterations = 10; // 최대 반복 횟수 제한으로 속도 향상
    
    while (minQuality <= maxQuality && iterations < maxIterations) {
      quality = Math.floor((minQuality + maxQuality) / 2);
      iterations++;
      
      // 포맷에 맞는 압축만 수행 (속도 최적화)
      let buffer;
      const sharpInstance = sharp(inputPath);
      
      if (format === 'jpeg' || format === 'jpg') {
        buffer = await sharpInstance.jpeg({ quality, mozjpeg: true }).toBuffer();
      } else if (format === 'png') {
        buffer = await sharpInstance.png({ quality, compressionLevel: 9 }).toBuffer();
      } else if (format === 'webp') {
        buffer = await sharpInstance.webp({ quality }).toBuffer();
      } else if (format === 'gif') {
        // GIF는 품질 옵션이 없으므로 리사이즈로 크기 조절
        const scale = Math.sqrt(targetSizeKB / parseFloat(originalSizeKB));
        const newWidth = Math.floor(width * scale);
        const newHeight = Math.floor(height * scale);
        buffer = await sharpInstance.resize(newWidth, newHeight).toBuffer();
      } else {
        // 기본적으로 JPEG로 변환
        buffer = await sharpInstance.jpeg({ quality, mozjpeg: true }).toBuffer();
      }
      
      compressedSizeKB = (buffer.length / 1024).toFixed(2);
      
      console.log(`반복 ${iterations}: 품질 ${quality}, 크기 ${compressedSizeKB}KB (목표: ${targetSizeKB}KB)`);
      
      if (parseFloat(compressedSizeKB) <= targetSizeKB) {
        bestQuality = quality;
        bestBuffer = buffer;
        minQuality = quality + 1;
      } else {
        maxQuality = quality - 1;
      }
      
      // 목표 크기의 95%~100% 범위면 조기 종료 (정확도와 속도 균형)
      const sizeRatio = parseFloat(compressedSizeKB) / targetSizeKB;
      if (sizeRatio >= 0.95 && sizeRatio <= 1.0) {
        console.log(`목표 크기에 충분히 근접하여 조기 종료 (${(sizeRatio * 100).toFixed(1)}%)`);
        break;
      }
    }
    
    // bestBuffer가 없으면 (목표 크기를 맞출 수 없는 경우) 최소 품질로 재시도
    if (!bestBuffer) {
      console.log('목표 크기 달성 실패, 최소 품질로 재압축');
      bestQuality = 10;
      const sharpInstance = sharp(inputPath);
      
      if (format === 'jpeg' || format === 'jpg') {
        bestBuffer = await sharpInstance.jpeg({ quality: bestQuality, mozjpeg: true }).toBuffer();
      } else if (format === 'png') {
        bestBuffer = await sharpInstance.png({ quality: bestQuality, compressionLevel: 9 }).toBuffer();
      } else if (format === 'webp') {
        bestBuffer = await sharpInstance.webp({ quality: bestQuality }).toBuffer();
      } else {
        bestBuffer = await sharpInstance.jpeg({ quality: bestQuality, mozjpeg: true }).toBuffer();
      }
    }
    
    // 최종 파일 저장
    const outputPath = path.join(outputDir, `compressed_${Date.now()}_${path.basename(inputPath)}`);
    await fs.writeFile(outputPath, bestBuffer);
    
    const finalSizeKB = (bestBuffer.length / 1024).toFixed(2);
    console.log(`압축 완료: 최종 크기 ${finalSizeKB}KB, 품질 ${bestQuality}, 반복 횟수 ${iterations}`);
    
    const compressionRatio = (((parseFloat(originalSizeKB) - parseFloat(finalSizeKB)) / parseFloat(originalSizeKB)) * 100).toFixed(1);
    
    return {
      success: true,
      message: `이미지가 성공적으로 압축되었습니다.`,
      originalSize: parseFloat(originalSizeKB),
      compressedSize: parseFloat(finalSizeKB),
      compressionRatio: parseFloat(compressionRatio),
      quality: bestQuality,
      dimensions: `${width}x${height}`,
      format: format,
      iterations: iterations,
      outputPath: `/output/${path.basename(outputPath)}`,
      action: 'compressed'
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
