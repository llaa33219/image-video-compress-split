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
    
    console.log(`영상 압축 시작: 해상도 ${videoInfo.resolution}, 길이 ${videoInfo.duration.toFixed(2)}초`);
    
    // 오디오 비트레이트 계산 (128kbps 또는 원본보다 작게)
    const audioBitrate = 128;
    const audioSizeKB = (audioBitrate * videoInfo.duration) / 8;
    
    // 비디오에 할당할 크기 (목표 크기의 92% - 안전 마진 8%)
    const videoTargetSizeKB = (targetSizeKB * 0.92) - audioSizeKB;
    
    // 목표 비트레이트 계산 (kbps)
    let targetBitrate = Math.floor((videoTargetSizeKB * 8) / videoInfo.duration);
    
    // 최소 비트레이트 보장 (너무 낮으면 화질이 심각하게 저하됨)
    if (targetBitrate < 100) {
      console.log(`경고: 계산된 비트레이트(${targetBitrate}kbps)가 너무 낮아 100kbps로 조정`);
      targetBitrate = 100;
    }
    
    console.log(`목표 비트레이트: ${targetBitrate}kbps (오디오: ${audioBitrate}kbps)`);
    
    const outputPath = path.join(outputDir, `compressed_${Date.now()}_${path.basename(inputPath)}`);
    const passLogFile = path.join(outputDir, `passlog_${Date.now()}`);
    
    // 2-pass 인코딩으로 정확도 향상
    // Pass 1: 분석
    console.log('1차 패스 시작 (분석)...');
    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .outputOptions([
          '-c:v libx264',
          '-b:v ' + targetBitrate + 'k',
          '-maxrate ' + Math.floor(targetBitrate * 1.2) + 'k',
          '-bufsize ' + Math.floor(targetBitrate * 2) + 'k',
          '-preset fast',
          '-an', // 1차 패스에서는 오디오 무시
          '-pass 1',
          '-passlogfile ' + passLogFile,
          '-f null'
        ])
        .output('/dev/null')
        .on('start', (cmd) => {
          console.log('FFmpeg 1차 패스:', cmd);
        })
        .on('progress', (progress) => {
          if (progress.percent) {
            console.log(`1차 패스 진행: ${progress.percent.toFixed(1)}%`);
          }
        })
        .on('end', () => {
          console.log('1차 패스 완료');
          resolve();
        })
        .on('error', (err) => {
          console.error('1차 패스 오류:', err);
          reject(err);
        })
        .run();
    });
    
    // Pass 2: 실제 인코딩
    console.log('2차 패스 시작 (인코딩)...');
    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .outputOptions([
          '-c:v libx264',
          '-b:v ' + targetBitrate + 'k',
          '-maxrate ' + Math.floor(targetBitrate * 1.2) + 'k',
          '-bufsize ' + Math.floor(targetBitrate * 2) + 'k',
          '-preset fast',
          '-c:a aac',
          '-b:a ' + audioBitrate + 'k',
          '-pass 2',
          '-passlogfile ' + passLogFile,
          '-movflags +faststart'
        ])
        .output(outputPath)
        .on('start', (cmd) => {
          console.log('FFmpeg 2차 패스:', cmd);
        })
        .on('progress', (progress) => {
          if (progress.percent) {
            console.log(`2차 패스 진행: ${progress.percent.toFixed(1)}%`);
          }
        })
        .on('end', () => {
          console.log('2차 패스 완료');
          resolve();
        })
        .on('error', (err) => {
          console.error('2차 패스 오류:', err);
          reject(err);
        })
        .run();
    });
    
    // 패스 로그 파일 삭제
    try {
      await fs.remove(passLogFile + '-0.log');
      await fs.remove(passLogFile + '-0.log.mbtree');
    } catch (err) {
      // 로그 파일 삭제 실패는 무시
    }
    
    // 압축된 파일 크기 확인
    const compressedStats = await fs.stat(outputPath);
    const compressedSizeKB = (compressedStats.size / 1024).toFixed(2);
    
    console.log(`압축 결과: ${compressedSizeKB}KB (목표: ${targetSizeKB}KB, 달성률: ${((parseFloat(compressedSizeKB) / targetSizeKB) * 100).toFixed(1)}%)`);
    
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
    
    console.log(`영상 분할 시작: 해상도 ${videoInfo.resolution}, 길이 ${videoInfo.duration.toFixed(2)}초`);
    
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
    
    console.log(`${totalParts}개 파트로 분할 (각 ${segmentDuration.toFixed(2)}초, 목표: ${targetSizeKB}KB 이하)`);
    
    // 각 세그먼트의 목표 비트레이트 계산 (안전 마진 92%)
    const audioBitrate = 128;
    const audioSizeKB = (audioBitrate * segmentDuration) / 8;
    const videoTargetSizeKB = (targetSizeKB * 0.92) - audioSizeKB;
    let targetBitrate = Math.floor((videoTargetSizeKB * 8) / segmentDuration);
    
    // 최소 비트레이트 보장
    if (targetBitrate < 100) {
      console.log(`경고: 계산된 비트레이트(${targetBitrate}kbps)가 너무 낮아 100kbps로 조정`);
      targetBitrate = 100;
    }
    
    console.log(`각 파트 목표 비트레이트: ${targetBitrate}kbps`);
    
    const parts = [];
    const baseFileName = path.basename(inputPath, path.extname(inputPath));
    
    // 병렬 처리를 위한 함수
    const processPart = async (i, startTime) => {
      const timestamp = Date.now() + i * 100; // 각 파일마다 고유한 타임스탬프
      const outputPath = path.join(outputDir, `split_${timestamp}_${baseFileName}_part${i + 1}.mp4`);
      
      await new Promise((resolve, reject) => {
        ffmpeg(inputPath)
          .setStartTime(startTime)
          .setDuration(segmentDuration)
          .outputOptions([
            '-c:v libx264',
            '-b:v ' + targetBitrate + 'k',
            '-maxrate ' + Math.floor(targetBitrate * 1.2) + 'k',
            '-bufsize ' + Math.floor(targetBitrate * 2) + 'k',
            '-preset fast',
            '-c:a aac',
            '-b:a ' + audioBitrate + 'k',
            '-movflags +faststart'
          ])
          .output(outputPath)
          .on('start', (cmd) => {
            console.log(`FFmpeg 명령어 실행 (파트 ${i + 1}/${totalParts}):`, cmd);
          })
          .on('progress', (progress) => {
            if (progress.percent) {
              console.log(`파트 ${i + 1} 처리 중: ${progress.percent.toFixed(1)}%`);
            }
          })
          .on('end', () => {
            console.log(`파트 ${i + 1} 완료`);
            resolve();
          })
          .on('error', (err) => {
            console.error(`파트 ${i + 1} 오류:`, err);
            reject(err);
          })
          .run();
      });
      
      // 분할된 파일 크기 확인
      const partStats = await fs.stat(outputPath);
      const partSizeKB = (partStats.size / 1024).toFixed(2);
      
      console.log(`파트 ${i + 1}: ${partSizeKB}KB (목표: ${targetSizeKB}KB, 달성률: ${((parseFloat(partSizeKB) / targetSizeKB) * 100).toFixed(1)}%)`);
      
      return {
        partNumber: i + 1,
        size: parseFloat(partSizeKB),
        duration: segmentDuration,
        startTime: startTime,
        outputPath: `/output/${path.basename(outputPath)}`
      };
    };
    
    // 병렬 처리 (동시에 2개씩 처리하여 시스템 부하 조절)
    const maxConcurrent = 2;
    for (let i = 0; i < totalParts; i += maxConcurrent) {
      const batch = [];
      for (let j = 0; j < maxConcurrent && i + j < totalParts; j++) {
        const partIndex = i + j;
        const startTime = partIndex * segmentDuration;
        batch.push(processPart(partIndex, startTime));
      }
      
      const batchResults = await Promise.all(batch);
      parts.push(...batchResults);
    }
    
    // 파트 번호로 정렬
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


