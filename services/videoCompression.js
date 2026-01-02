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
  const startTime = Date.now(); // 처리 시간 측정 시작
  
  try {
    const outputDir = path.join(__dirname, '..', 'output');
    await fs.ensureDir(outputDir);
    
    // 원본 파일 정보
    const originalStats = await fs.stat(inputPath);
    const originalSizeKB = (originalStats.size / 1024).toFixed(2);
    
    // 입력 파일 확장자 확인
    const inputExt = path.extname(inputPath).toLowerCase();
    const isWebM = inputExt === '.webm';
    
    // 출력 파일 확장자 결정 (입력과 동일하게 유지)
    const outputExt = isWebM ? '.webm' : '.mp4';
    const baseFileName = path.basename(inputPath, inputExt);
    
    // 이미 목표 용량 이하인 경우
    if (parseFloat(originalSizeKB) <= targetSizeKB) {
      const outputPath = path.join(outputDir, `compressed_${Date.now()}_${baseFileName}${outputExt}`);
      await fs.copy(inputPath, outputPath);
      
      return {
        success: true,
        message: `영상이 이미 목표 용량(${targetSizeKB}KB) 이하입니다.`,
        originalSize: parseFloat(originalSizeKB),
        compressedSize: parseFloat(originalSizeKB),
        compressionRatio: 0,
        outputPath: `/output/${path.basename(outputPath)}`,
        action: 'copied',
        processingTime: `${(Date.now() - startTime) / 1000} 초`
      };
    }
    
    // 영상 정보 가져오기
    const videoInfo = await getVideoInfo(inputPath);
    
    // 목표 비트레이트 계산 (kbps)
    const audioBitrate = 64; // kbps (용량 절약을 위해 낮춤)
    const totalTargetBitrate = Math.floor((targetSizeKB * 8) / videoInfo.duration);
    const initialTargetBitrate = Math.max(totalTargetBitrate - audioBitrate, 64);
    
    let outputPath = path.join(outputDir, `compressed_${Date.now()}_${baseFileName}${outputExt}`);
    let compressedSizeKB;
    let finalBitrate;
    
    if (isWebM) {
      // WebM: 2-pass 인코딩으로 정확한 비트레이트 제어
      const targetBitrate = initialTargetBitrate;
      const passLogFile = path.join(outputDir, `passlog_${Date.now()}`);
      const nullOutput = process.platform === 'win32' ? 'NUL' : '/dev/null';
      
      console.log(`WebM 2-pass 인코딩 시작 - 목표 비트레이트: ${targetBitrate}kbps`);
      
      // 1st pass: 분석
      console.log('1st pass 시작...');
      await new Promise((resolve, reject) => {
        ffmpeg(inputPath)
          .outputOptions([
            '-c:v libvpx',
            '-b:v ' + targetBitrate + 'k',
            '-pass 1',
            '-passlogfile ' + passLogFile,
            '-cpu-used 4',
            '-deadline good',
            '-threads 0',
            '-an',
            '-f webm'
          ])
          .output(nullOutput)
          .on('start', (cmd) => {
            console.log('1st pass 명령어:', cmd);
          })
          .on('progress', (progress) => {
            console.log(`1st pass 진행 중: ${progress.percent ? progress.percent.toFixed(2) : 0}%`);
          })
          .on('end', () => {
            console.log('1st pass 완료');
            resolve();
          })
          .on('error', (err) => {
            console.error('1st pass 오류:', err);
            reject(err);
          })
          .run();
      });
      
      // 2nd pass: 실제 인코딩
      console.log('2nd pass 시작...');
      await new Promise((resolve, reject) => {
        ffmpeg(inputPath)
          .outputOptions([
            '-c:v libvpx',
            '-c:a libvorbis',
            '-b:v ' + targetBitrate + 'k',
            '-b:a ' + audioBitrate + 'k',
            '-pass 2',
            '-passlogfile ' + passLogFile,
            '-cpu-used 4',
            '-deadline good',
            '-threads 0'
          ])
          .output(outputPath)
          .on('start', (cmd) => {
            console.log('2nd pass 명령어:', cmd);
          })
          .on('progress', (progress) => {
            console.log(`2nd pass 진행 중: ${progress.percent ? progress.percent.toFixed(2) : 0}%`);
          })
          .on('end', () => {
            console.log('2nd pass 완료');
            resolve();
          })
          .on('error', (err) => {
            console.error('2nd pass 오류:', err);
            reject(err);
          })
          .run();
      });
      
      // passlog 파일 삭제
      try {
        await fs.remove(passLogFile + '-0.log');
        await fs.remove(passLogFile + '.log');
      } catch (e) {
        // passlog 파일이 없어도 무시
      }
      
      const compressedStats = await fs.stat(outputPath);
      compressedSizeKB = (compressedStats.size / 1024).toFixed(2);
      finalBitrate = targetBitrate;
      
      console.log(`WebM 2-pass 인코딩 완료: ${compressedSizeKB}KB (목표: ${targetSizeKB}KB)`);
    } else {
      // MP4: 기존 1회 압축
      const targetBitrate = initialTargetBitrate;
      const outputOptions = [
        '-c:v libx264',
        '-c:a aac',
        '-b:v ' + targetBitrate + 'k',
        '-b:a ' + audioBitrate + 'k',
        '-preset fast',
        '-maxrate ' + targetBitrate + 'k',
        '-bufsize ' + (targetBitrate * 2) + 'k',
        '-movflags +faststart'
      ];
      
      await new Promise((resolve, reject) => {
        ffmpeg(inputPath)
          .outputOptions(outputOptions)
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
      
      const compressedStats = await fs.stat(outputPath);
      compressedSizeKB = (compressedStats.size / 1024).toFixed(2);
      finalBitrate = targetBitrate;
    }
    
    const compressionRatio = ((parseFloat(originalSizeKB) - parseFloat(compressedSizeKB)) / parseFloat(originalSizeKB) * 100).toFixed(1);
    
    return {
      success: true,
      message: `영상이 성공적으로 압축되었습니다.`,
      originalSize: parseFloat(originalSizeKB),
      compressedSize: parseFloat(compressedSizeKB),
      compressionRatio: parseFloat(compressionRatio),
      duration: videoInfo.duration,
      resolution: videoInfo.resolution,
      bitrate: finalBitrate,
      outputPath: `/output/${path.basename(outputPath)}`,
      action: 'compressed',
      processingTime: `${(Date.now() - startTime) / 1000} 초`
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
  const startTime = Date.now(); // 처리 시간 측정 시작
  
  try {
    const outputDir = path.join(__dirname, '..', 'output');
    await fs.ensureDir(outputDir);
    
    // 원본 파일 정보
    const originalStats = await fs.stat(inputPath);
    const originalSizeKB = (originalStats.size / 1024).toFixed(2);
    
    // 영상 정보 가져오기
    const videoInfo = await getVideoInfo(inputPath);
    
    // 입력 파일 확장자 확인
    const inputExt = path.extname(inputPath).toLowerCase();
    const isWebM = inputExt === '.webm';
    
    // 출력 파일 확장자 결정 (입력과 동일하게 유지)
    const outputExt = isWebM ? '.webm' : '.mp4';
    const baseFileName = path.basename(inputPath, inputExt);
    
    // 이미 목표 용량 이하인 경우
    if (parseFloat(originalSizeKB) <= targetSizeKB) {
      const outputPath = path.join(outputDir, `split_${Date.now()}_${baseFileName}${outputExt}`);
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
        action: 'copied',
        processingTime: `${(Date.now() - startTime) / 1000} 초`
      };
    }
    
    // 분할할 구간 수 계산
    const totalParts = Math.ceil(parseFloat(originalSizeKB) / targetSizeKB);
    const segmentDuration = videoInfo.duration / totalParts;
    
    const parts = [];
    const audioBitrate = 64; // kbps
    
    // 각 구간별로 분할
    for (let i = 0; i < totalParts; i++) {
      const segmentStartTime = i * segmentDuration;
      const timestamp = Date.now() + i;
      let outputPath = path.join(outputDir, `split_${timestamp}_${baseFileName}_part${i + 1}${outputExt}`);
      
      // 목표 비트레이트 계산
      const targetBitratePerPart = Math.floor((targetSizeKB * 8) / segmentDuration);
      let currentBitrate = Math.max(targetBitratePerPart - audioBitrate, 64);
      
      let partSizeKB;
      
      if (isWebM) {
        // WebM: 2-pass 인코딩으로 정확한 비트레이트 제어
        const passLogFile = path.join(outputDir, `passlog_split_${Date.now()}_${i}`);
        const nullOutput = process.platform === 'win32' ? 'NUL' : '/dev/null';
        
        console.log(`파트 ${i + 1} 2-pass 인코딩 시작 - 비트레이트: ${currentBitrate}kbps`);
        
        // 1st pass
        await new Promise((resolve, reject) => {
          ffmpeg(inputPath)
            .setStartTime(segmentStartTime)
            .setDuration(segmentDuration)
            .outputOptions([
              '-c:v libvpx',
              '-b:v ' + currentBitrate + 'k',
              '-pass 1',
              '-passlogfile ' + passLogFile,
              '-cpu-used 4',
              '-deadline good',
              '-threads 0',
              '-an',
              '-f webm'
            ])
            .output(nullOutput)
            .on('start', (cmd) => {
              console.log(`파트 ${i + 1} 1st pass 명령어:`, cmd);
            })
            .on('end', () => {
              console.log(`파트 ${i + 1} 1st pass 완료`);
              resolve();
            })
            .on('error', (err) => {
              console.error(`파트 ${i + 1} 1st pass 오류:`, err);
              reject(err);
            })
            .run();
        });
        
        // 2nd pass
        await new Promise((resolve, reject) => {
          ffmpeg(inputPath)
            .setStartTime(segmentStartTime)
            .setDuration(segmentDuration)
            .outputOptions([
              '-c:v libvpx',
              '-c:a libvorbis',
              '-b:v ' + currentBitrate + 'k',
              '-b:a ' + audioBitrate + 'k',
              '-pass 2',
              '-passlogfile ' + passLogFile,
              '-cpu-used 4',
              '-deadline good',
              '-threads 0'
            ])
            .output(outputPath)
            .on('start', (cmd) => {
              console.log(`파트 ${i + 1} 2nd pass 명령어:`, cmd);
            })
            .on('progress', (progress) => {
              console.log(`파트 ${i + 1} 2nd pass 진행 중: ${progress.percent ? progress.percent.toFixed(2) : 0}%`);
            })
            .on('end', () => {
              console.log(`파트 ${i + 1} 2nd pass 완료`);
              resolve();
            })
            .on('error', (err) => {
              console.error(`파트 ${i + 1} 2nd pass 오류:`, err);
              reject(err);
            })
            .run();
        });
        
        // passlog 파일 삭제
        try {
          await fs.remove(passLogFile + '-0.log');
          await fs.remove(passLogFile + '.log');
        } catch (e) {}
        
        const partStats = await fs.stat(outputPath);
        partSizeKB = (partStats.size / 1024).toFixed(2);
      } else {
        // MP4: 1회 압축
        const outputOptions = [
          '-c:v libx264',
          '-c:a aac',
          '-b:v ' + currentBitrate + 'k',
          '-b:a ' + audioBitrate + 'k',
          '-preset fast',
          '-movflags +faststart'
        ];
        
        await new Promise((resolve, reject) => {
          ffmpeg(inputPath)
            .setStartTime(segmentStartTime)
            .setDuration(segmentDuration)
            .outputOptions(outputOptions)
            .output(outputPath)
            .on('start', (cmd) => {
              console.log(`FFmpeg 명령어 실행 (파트 ${i + 1}/${totalParts}):`, cmd);
            })
            .on('progress', (progress) => {
              console.log(`파트 ${i + 1} 처리 중: ${progress.percent ? progress.percent.toFixed(2) : 0}%`);
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
        
        const partStats = await fs.stat(outputPath);
        partSizeKB = (partStats.size / 1024).toFixed(2);
      }
      
      parts.push({
        partNumber: i + 1,
        size: parseFloat(partSizeKB),
        duration: segmentDuration,
        startTime: segmentStartTime,
        outputPath: `/output/${path.basename(outputPath)}`
      });
    }
    
    return {
      success: true,
      message: `영상이 ${totalParts}개 구간으로 분할되었습니다.`,
      originalSize: parseFloat(originalSizeKB),
      totalParts: totalParts,
      parts: parts,
      action: 'split',
      processingTime: `${(Date.now() - startTime) / 1000} 초`
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


