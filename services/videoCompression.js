const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const fs = require('fs-extra');
const path = require('path');

// ffmpeg 경로 설정
ffmpeg.setFfmpegPath(ffmpegStatic);

/**
 * 영상을 목표 용량 이하로 압축
 * @param {string} inputPath - 입력 영상 경로
 * @param {number} targetSizeMB - 목표 용량 (MB)
 * @returns {Promise<Object>} 압축 결과
 */
async function compressVideo(inputPath, targetSizeMB) {
  try {
    const outputDir = path.join(__dirname, '..', 'output');
    await fs.ensureDir(outputDir);
    
    // 원본 파일 정보
    const originalStats = await fs.stat(inputPath);
    const originalSizeMB = Math.round(originalStats.size / (1024 * 1024));
    
    // 이미 목표 용량 이하인 경우
    if (originalSizeMB <= targetSizeMB) {
      const outputPath = path.join(outputDir, `compressed_${Date.now()}_${path.basename(inputPath)}`);
      await fs.copy(inputPath, outputPath);
      
      return {
        success: true,
        message: `영상이 이미 목표 용량(${targetSizeMB}MB) 이하입니다.`,
        originalSize: originalSizeMB,
        compressedSize: originalSizeMB,
        compressionRatio: 0,
        outputPath: `/output/${path.basename(outputPath)}`,
        action: 'copied'
      };
    }
    
    // 영상 정보 가져오기
    const videoInfo = await getVideoInfo(inputPath);
    
    // 목표 비트레이트 계산 (kbps)
    const targetBitrate = Math.floor((targetSizeMB * 8 * 1024) / videoInfo.duration);
    
    const outputPath = path.join(outputDir, `compressed_${Date.now()}_${path.basename(inputPath)}`);
    
    // 영상 압축
    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .videoBitrate(targetBitrate)
        .audioBitrate('128k')
        .outputOptions([
          '-preset fast',
          '-crf 23',
          '-maxrate ' + targetBitrate + 'k',
          '-bufsize ' + (targetBitrate * 2) + 'k'
        ])
        .output(outputPath)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });
    
    // 압축된 파일 크기 확인
    const compressedStats = await fs.stat(outputPath);
    const compressedSizeMB = Math.round(compressedStats.size / (1024 * 1024));
    
    const compressionRatio = Math.round(((originalSizeMB - compressedSizeMB) / originalSizeMB) * 100);
    
    return {
      success: true,
      message: `영상이 성공적으로 압축되었습니다.`,
      originalSize: originalSizeMB,
      compressedSize: compressedSizeMB,
      compressionRatio: compressionRatio,
      duration: videoInfo.duration,
      resolution: videoInfo.resolution,
      bitrate: targetBitrate,
      outputPath: `/output/${path.basename(outputPath)}`,
      action: 'compressed'
    };
    
  } catch (error) {
    console.error('영상 압축 오류:', error);
    throw new Error(`영상 압축 실패: ${error.message}`);
  }
}

/**
 * 영상을 여러 개의 작은 파일로 분할
 * @param {string} inputPath - 입력 영상 경로
 * @param {number} targetSizeMB - 각 분할 파일의 최대 용량 (MB)
 * @returns {Promise<Object>} 분할 결과
 */
async function splitVideo(inputPath, targetSizeMB) {
  try {
    const outputDir = path.join(__dirname, '..', 'output');
    await fs.ensureDir(outputDir);
    
    // 원본 파일 정보
    const originalStats = await fs.stat(inputPath);
    const originalSizeMB = Math.round(originalStats.size / (1024 * 1024));
    
    // 영상 정보 가져오기
    const videoInfo = await getVideoInfo(inputPath);
    
    // 이미 목표 용량 이하인 경우
    if (originalSizeMB <= targetSizeMB) {
      const outputPath = path.join(outputDir, `split_${Date.now()}_${path.basename(inputPath)}`);
      await fs.copy(inputPath, outputPath);
      
      return {
        success: true,
        message: `영상이 이미 목표 용량(${targetSizeMB}MB) 이하입니다.`,
        originalSize: originalSizeMB,
        totalParts: 1,
        parts: [{
          partNumber: 1,
          size: originalSizeMB,
          duration: videoInfo.duration,
          outputPath: `/output/${path.basename(outputPath)}`
        }],
        action: 'copied'
      };
    }
    
    // 분할할 구간 수 계산
    const totalParts = Math.ceil(originalSizeMB / targetSizeMB);
    const segmentDuration = videoInfo.duration / totalParts;
    
    const parts = [];
    const baseFileName = path.basename(inputPath, path.extname(inputPath));
    
    // 각 구간별로 분할
    for (let i = 0; i < totalParts; i++) {
      const startTime = i * segmentDuration;
      const outputPath = path.join(outputDir, `split_${Date.now()}_${baseFileName}_part${i + 1}.mp4`);
      
      await new Promise((resolve, reject) => {
        ffmpeg(inputPath)
          .seekInput(startTime)
          .duration(segmentDuration)
          .output(outputPath)
          .on('end', resolve)
          .on('error', reject)
          .run();
      });
      
      // 분할된 파일 크기 확인
      const partStats = await fs.stat(outputPath);
      const partSizeMB = Math.round(partStats.size / (1024 * 1024));
      
      parts.push({
        partNumber: i + 1,
        size: partSizeMB,
        duration: segmentDuration,
        startTime: startTime,
        outputPath: `/output/${path.basename(outputPath)}`
      });
    }
    
    return {
      success: true,
      message: `영상이 ${totalParts}개 구간으로 분할되었습니다.`,
      originalSize: originalSizeMB,
      totalParts: totalParts,
      parts: parts,
      action: 'split'
    };
    
  } catch (error) {
    console.error('영상 분할 오류:', error);
    throw new Error(`영상 분할 실패: ${error.message}`);
  }
}

/**
 * 영상 정보 가져오기
 * @param {string} inputPath - 입력 영상 경로
 * @returns {Promise<Object>} 영상 정보
 */
function getVideoInfo(inputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputPath, (err, metadata) => {
      if (err) {
        reject(err);
        return;
      }
      
      const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
      const audioStream = metadata.streams.find(stream => stream.codec_type === 'audio');
      
      resolve({
        duration: parseFloat(metadata.format.duration),
        resolution: `${videoStream.width}x${videoStream.height}`,
        videoCodec: videoStream.codec_name,
        audioCodec: audioStream ? audioStream.codec_name : 'none',
        bitrate: parseInt(metadata.format.bit_rate) || 0,
        size: parseInt(metadata.format.size)
      });
    });
  });
}

module.exports = {
  compressVideo,
  splitVideo,
  getVideoInfo
};
