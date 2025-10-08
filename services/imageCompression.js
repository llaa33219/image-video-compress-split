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
    
    // 압축 품질 설정 (초기값)
    let quality = 80;
    let outputPath;
    let compressedSizeKB;
    let tempOutputPath;
    
    // 이진 탐색으로 최적 품질 찾기
    let minQuality = 10;
    let maxQuality = 100;
    let bestQuality = quality;
    
    // 임시 파일 경로 (이진 탐색용)
    tempOutputPath = path.join(outputDir, `temp_${Date.now()}_${path.basename(inputPath)}`);
    
    while (minQuality <= maxQuality) {
      quality = Math.floor((minQuality + maxQuality) / 2);
      
      // 이미지 압축 (임시 파일로 저장)
      await sharp(inputPath)
        .jpeg({ quality: quality, mozjpeg: true })  // mozjpeg 사용으로 더 나은 압축
        .png({ quality: quality, compressionLevel: 9 })
        .webp({ quality: quality, effort: 4 })  // effort 4: 속도와 압축률 균형
        .toFile(tempOutputPath);
      
      // 압축된 파일 크기 확인
      const compressedStats = await fs.stat(tempOutputPath);
      compressedSizeKB = (compressedStats.size / 1024).toFixed(2);
      
      if (parseFloat(compressedSizeKB) <= targetSizeKB) {
        bestQuality = quality;
        minQuality = quality + 1;
      } else {
        maxQuality = quality - 1;
      }
      
      // 마지막 반복이 아니면 임시 파일 삭제
      if (minQuality <= maxQuality) {
        await fs.remove(tempOutputPath);
      }
    }
    
    // 최종 파일명으로 변경
    outputPath = path.join(outputDir, `compressed_${Date.now()}_${path.basename(inputPath)}`);
    await fs.move(tempOutputPath, outputPath, { overwrite: true });
    
    const finalStats = await fs.stat(outputPath);
    const finalSizeKB = (finalStats.size / 1024).toFixed(2);
    
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
