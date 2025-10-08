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
  const startTime = Date.now(); // 시작 시간 기록
  
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
      
      const executionTime = ((Date.now() - startTime) / 1000).toFixed(2);
      
      return {
        success: true,
        message: `영상이 이미 목표 용량(${targetSizeKB}KB) 이하입니다.`,
        originalSize: parseFloat(originalSizeKB),
        compressedSize: parseFloat(originalSizeKB),
        compressionRatio: 0,
        outputPath: `/output/${path.basename(outputPath)}`,
        executionTime: parseFloat(executionTime),
        executionTimeFormatted: `${executionTime}초`,
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
          '-preset ultrafast',  // fast -> ultrafast로 변경 (속도 최적화)
          '-threads 0',  // 모든 CPU 코어 활용
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
    const executionTime = ((Date.now() - startTime) / 1000).toFixed(2);
    
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
      executionTime: parseFloat(executionTime),
      executionTimeFormatted: `${executionTime}초`,
      action: 'compressed'
    };
    
  } catch (error) {
    console.error('영상 압축 오류:', error);
    
    // 에러 발생 시 생성된 파일들 정리
    try {
      const outputFiles = await fs.readdir(outputDir);
      for (const file of outputFiles) {
        if (file.includes('compressed_') && file.includes(path.basename(inputPath, path.extname(inputPath)))) {
          await fs.remove(path.join(outputDir, file));
        }
      }
    } catch (cleanupError) {
      console.error('정리 중 오류:', cleanupError);
    }
    
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
  const startTime = Date.now(); // 시작 시간 기록
  
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
      
      const executionTime = ((Date.now() - startTime) / 1000).toFixed(2);
      
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
        executionTime: parseFloat(executionTime),
        executionTimeFormatted: `${executionTime}초`,
        action: 'copied'
      };
    }
    
    // 분할할 구간 수 계산
    const totalParts = Math.ceil(parseFloat(originalSizeKB) / targetSizeKB);
    const segmentDuration = videoInfo.duration / totalParts;
    
    const parts = [];
    const baseFileName = path.basename(inputPath, path.extname(inputPath));
    
    // 병렬 처리를 위한 Promise 배열 생성
    const splitPromises = [];
    const partInfos = [];
    const baseTimestamp = Date.now(); // 고유한 기본 타임스탬프
    
    for (let i = 0; i < totalParts; i++) {
      const startTime = i * segmentDuration;
      const timestamp = baseTimestamp + (i * 1000); // 각 파일마다 1초씩 차이나는 타임스탬프
      const outputPath = path.join(outputDir, `split_${timestamp}_${baseFileName}_part${i + 1}.mp4`);
      
      partInfos.push({ index: i, startTime, outputPath });
      
      // 각 파트를 병렬로 처리
      const splitPromise = new Promise((resolve, reject) => {
        ffmpeg(inputPath)
          .setStartTime(startTime)
          .setDuration(segmentDuration)
          .outputOptions([
            '-c:v libx264',
            '-c:a aac',
            '-preset ultrafast',  // fast -> ultrafast로 변경 (속도 최적화)
            '-threads 0',  // 모든 CPU 코어 활용
            '-movflags +faststart'
          ])
          .output(outputPath)
          .on('start', (cmd) => {
            console.log(`FFmpeg 명령어 실행 (파트 ${i + 1}/${totalParts}):`, cmd);
          })
          .on('progress', (progress) => {
            console.log(`파트 ${i + 1} 처리 중: ${progress.percent ? progress.percent.toFixed(2) : 0}%`);
          })
          .on('end', () => {
            console.log(`파트 ${i + 1} 완료`);
            resolve({ index: i, outputPath });
          })
          .on('error', (err) => {
            console.error(`파트 ${i + 1} 오류:`, err);
            reject(err);
          })
          .run();
      });
      
      splitPromises.push(splitPromise);
    }
    
    // 모든 분할 작업을 병렬로 실행 (최대 4개씩 동시 처리)
    console.log(`${totalParts}개 파트를 병렬 처리 시작...`);
    const maxConcurrent = Math.min(4, totalParts); // 최대 4개까지 동시 처리
    const results = [];
    
    for (let i = 0; i < splitPromises.length; i += maxConcurrent) {
      const batch = splitPromises.slice(i, i + maxConcurrent);
      const batchResults = await Promise.all(batch);
      results.push(...batchResults);
      console.log(`진행: ${Math.min(i + maxConcurrent, totalParts)}/${totalParts} 파트 완료`);
    }
    
    // 결과를 순서대로 정리
    for (const result of results) {
      const partInfo = partInfos[result.index];
      const partStats = await fs.stat(result.outputPath);
      const partSizeKB = (partStats.size / 1024).toFixed(2);
      
      parts.push({
        partNumber: result.index + 1,
        size: parseFloat(partSizeKB),
        duration: segmentDuration,
        startTime: partInfo.startTime,
        outputPath: `/output/${path.basename(result.outputPath)}`
      });
    }
    
    // 파트 번호순으로 정렬
    parts.sort((a, b) => a.partNumber - b.partNumber);
    
    const executionTime = ((Date.now() - startTime) / 1000).toFixed(2);
    
    return {
      success: true,
      message: `영상이 ${totalParts}개 구간으로 분할되었습니다.`,
      originalSize: parseFloat(originalSizeKB),
      totalParts: totalParts,
      parts: parts,
      executionTime: parseFloat(executionTime),
      executionTimeFormatted: `${executionTime}초`,
      action: 'split'
    };
    
  } catch (error) {
    console.error('영상 분할 오류:', error);
    
    // 에러 발생 시 생성된 파일들 정리
    try {
      const outputFiles = await fs.readdir(outputDir);
      const timestamp = Date.now();
      for (const file of outputFiles) {
        if (file.includes('split_') && file.includes(path.basename(inputPath, path.extname(inputPath)))) {
          await fs.remove(path.join(outputDir, file));
        }
      }
    } catch (cleanupError) {
      console.error('정리 중 오류:', cleanupError);
    }
    
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
