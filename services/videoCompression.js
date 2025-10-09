const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const fs = require('fs-extra');
const path = require('path');

// ffmpeg 경로 설정
ffmpeg.setFfmpegPath(ffmpegStatic);

/**
 * 영상을 목표 용량 이하로 압축
 * @param {string} inputPath - 입력 영상 경로
 * @param {number} targetSizeKB - 목표 용량 (KB)
 * @returns {Promise<Object>} 압축 결과
 */
async function compressVideo(inputPath, targetSizeKB) {
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
        message: `영상이 이미 목표 용량(${targetSizeKB}KB) 이하입니다.`,
        originalSize: parseFloat(originalSizeKB),
        compressedSize: parseFloat(originalSizeKB),
        compressionRatio: 0,
        outputPath: `/output/${path.basename(outputPath)}`,
        action: 'copied'
      };
    }
    
    // 영상 정보 가져오기
    const videoInfo = await getVideoInfo(inputPath);
    
    // 목표 비트레이트 계산 (kbps)
    const targetBitrate = Math.floor((targetSizeKB * 8) / videoInfo.duration);
    
    const outputPath = path.join(outputDir, `compressed_${Date.now()}_${path.basename(inputPath)}`);
    
    // 영상 압축
    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .videoBitrate(targetBitrate)
        .audioBitrate('128k')
        .outputOptions([
          '-c:v libx264',
          '-c:a aac',
          '-preset ultrafast', // 'fast'에서 'ultrafast'로 변경하여 속도 향상
          '-crf 23',
          '-maxrate ' + targetBitrate + 'k',
          '-bufsize ' + (targetBitrate * 2) + 'k',
          '-movflags +faststart'
        ])
        .output(outputPath)
        .on('start', (cmd) => {
          console.log('FFmpeg 명령어 실행:', cmd);
        })
        .on('progress', (progress) => {
          console.log(`압축 진행 중: ${progress.percent ? progress.percent.toFixed(2) : 0}%`);
        })
        .on('end', () => {
          console.log('압축 완료');
          resolve();
        })
        .on('error', (err) => {
          console.error('압축 오류:', err);
          reject(err);
        })
        .run();
    });
    
    // 압축된 파일 크기 확인
    const compressedStats = await fs.stat(outputPath);
    const compressedSizeKB = (compressedStats.size / 1024).toFixed(2);
    
    const compressionRatio = ((parseFloat(originalSizeKB) - parseFloat(compressedSizeKB)) / parseFloat(originalSizeKB) * 100).toFixed(1);
    
    return {
      success: true,
      message: `영상이 성공적으로 압축되었습니다.`,
      originalSize: parseFloat(originalSizeKB),
      compressedSize: parseFloat(compressedSizeKB),
      compressionRatio: parseFloat(compressionRatio),
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
 * @param {number} targetSizeKB - 각 분할 파일의 최대 용량 (KB)
 * @returns {Promise<Object>} 분할 결과
 */
async function splitVideo(inputPath, targetSizeKB) {
  try {
    const outputDir = path.join(__dirname, '..', 'output');
    await fs.ensureDir(outputDir);
    
    // 원본 파일 정보
    const originalStats = await fs.stat(inputPath);
    const originalSizeKB = (originalStats.size / 1024).toFixed(2);
    
    // 영상 정보 가져오기
    const videoInfo = await getVideoInfo(inputPath);
    
    // 이미 목표 용량 이하인 경우
    if (parseFloat(originalSizeKB) <= targetSizeKB) {
      const outputPath = path.join(outputDir, `split_${Date.now()}_${path.basename(inputPath)}`);
      await fs.copy(inputPath, outputPath);
      
      return {
        success: true,
        message: `영상이 이미 목표 용량(${targetSizeKB}KB) 이하입니다.`,
        originalSize: parseFloat(originalSizeKB),
        totalParts: 1,
        parts: [{
          partNumber: 1,
          size: parseFloat(originalSizeKB),
          duration: videoInfo.duration,
          outputPath: `/output/${path.basename(outputPath)}`
        }],
        action: 'copied'
      };
    }
    
    // 분할할 구간 수 계산
    const totalParts = Math.ceil(parseFloat(originalSizeKB) / targetSizeKB);
    const segmentDuration = videoInfo.duration / totalParts;
    
    const parts = [];
    const baseFileName = path.basename(inputPath, path.extname(inputPath));
    
    // 각 구간별로 분할 작업을 프로미스 배열로 생성
    const splitPromises = [];
    for (let i = 0; i < totalParts; i++) {
      const startTime = i * segmentDuration;
      const timestamp = Date.now() + i; // 각 파일마다 고유한 타임스탬프
      const outputPath = path.join(outputDir, `split_${timestamp}_${baseFileName}_part${i + 1}.mp4`);
      
      const promise = new Promise((resolve, reject) => {
        ffmpeg(inputPath)
          .setStartTime(startTime)
          .setDuration(segmentDuration)
          .outputOptions([
            '-c:v libx264',
            '-c:a aac',
            '-preset ultrafast', // 'fast'에서 'ultrafast'로 변경하여 속도 향상
            '-movflags +faststart'
          ])
          .output(outputPath)
          .on('start', (cmd) => {
            console.log(`FFmpeg 명령어 실행 (파트 ${i + 1}/${totalParts}):`, cmd);
          })
          .on('progress', (progress) => {
            console.log(`파트 ${i + 1} 처리 중: ${progress.percent ? progress.percent.toFixed(2) : 0}%`);
          })
          .on('end', async () => {
            console.log(`파트 ${i + 1} 완료`);
            // 분할된 파일 크기 확인
            const partStats = await fs.stat(outputPath);
            const partSizeKB = (partStats.size / 1024).toFixed(2);
            
            parts.push({
              partNumber: i + 1,
              size: parseFloat(partSizeKB),
              duration: segmentDuration,
              startTime: startTime,
              outputPath: `/output/${path.basename(outputPath)}`
            });
            resolve();
          })
          .on('error', (err) => {
            console.error(`파트 ${i + 1} 오류:`, err);
            reject(err);
          })
          .run();
      });
      splitPromises.push(promise);
    }

    // 모든 분할 작업을 병렬로 실행
    await Promise.all(splitPromises);

    // 파트 번호 순서대로 정렬
    parts.sort((a, b) => a.partNumber - b.partNumber);
    
    return {
      success: true,
      message: `영상이 ${totalParts}개 구간으로 분할되었습니다.`,
      originalSize: parseFloat(originalSizeKB),
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


