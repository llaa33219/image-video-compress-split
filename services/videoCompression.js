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
    
    // 압축 비율에 따른 해상도 결정
    const sizeRatio = parseFloat(originalSizeKB) / targetSizeKB;
    const originalHeight = parseInt(videoInfo.resolution.split('x')[1]);
    let scaleFilter = null;
    
    if (sizeRatio > 8 && originalHeight > 360) {
      scaleFilter = 'scale=-2:360'; // 360p로 축소
      console.log(`압축 비율 ${sizeRatio.toFixed(1)}x - 360p로 해상도 축소`);
    } else if (sizeRatio > 4 && originalHeight > 480) {
      scaleFilter = 'scale=-2:480'; // 480p로 축소
      console.log(`압축 비율 ${sizeRatio.toFixed(1)}x - 480p로 해상도 축소`);
    } else if (sizeRatio > 2 && originalHeight > 720) {
      scaleFilter = 'scale=-2:720'; // 720p로 축소
      console.log(`압축 비율 ${sizeRatio.toFixed(1)}x - 720p로 해상도 축소`);
    }
    
    // 목표 비트레이트 계산 (kbps) - 40%로 강하게 설정하여 목표 크기 확실히 달성
    const audioBitrate = 32; // kbps (최대한 압축)
    const totalTargetBitrate = Math.floor((targetSizeKB * 8) / videoInfo.duration);
    const initialTargetBitrate = Math.max(Math.floor((totalTargetBitrate - audioBitrate) * 0.4), 32);
    
    let outputPath = path.join(outputDir, `compressed_${Date.now()}_${baseFileName}${outputExt}`);
    let compressedSizeKB;
    let finalBitrate;
    
    if (isWebM) {
      // WebM: VP8 초고속 인코딩 (품질 희생 + 확실한 크기 달성)
      const targetBitrate = initialTargetBitrate;
      
      console.log(`WebM VP8 초고속 인코딩 시작 - 목표 비트레이트: ${targetBitrate}kbps`);
      
      // 비디오 필터 설정 (해상도 축소 + 프레임레이트 제한)
      const videoFilters = [];
      if (scaleFilter) {
        videoFilters.push(scaleFilter);
      }
      videoFilters.push('fps=24'); // 24fps로 제한하여 용량 감소
      
      await new Promise((resolve, reject) => {
        const command = ffmpeg(inputPath)
          .videoFilters(videoFilters)
          .outputOptions([
            '-c:v libvpx',
            '-c:a libvorbis',
            '-b:v ' + targetBitrate + 'k',
            '-maxrate ' + targetBitrate + 'k',
            '-bufsize ' + targetBitrate + 'k',
            '-b:a ' + audioBitrate + 'k',
            '-cpu-used 8',
            '-deadline realtime',
            '-qmin 30',
            '-qmax 63',
            '-threads 0'
          ]);
        
        command
          .output(outputPath)
          .on('start', (cmd) => {
            console.log('인코딩 명령어:', cmd);
          })
          .on('progress', (progress) => {
            console.log(`인코딩 진행 중: ${progress.percent ? progress.percent.toFixed(2) : 0}%`);
          })
          .on('end', () => {
            console.log('인코딩 완료');
            resolve();
          })
          .on('error', (err) => {
            console.error('인코딩 오류:', err);
            reject(err);
          })
          .run();
      });
      
      const compressedStats = await fs.stat(outputPath);
      compressedSizeKB = (compressedStats.size / 1024).toFixed(2);
      finalBitrate = targetBitrate;
      
      console.log(`WebM VP8 인코딩 완료: ${compressedSizeKB}KB (목표: ${targetSizeKB}KB)`);
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
    
    // 압축 비율에 따른 해상도 결정
    const sizeRatio = parseFloat(originalSizeKB) / targetSizeKB;
    const originalHeight = parseInt(videoInfo.resolution.split('x')[1]);
    let scaleFilter = null;
    
    if (sizeRatio > 8 && originalHeight > 360) {
      scaleFilter = 'scale=-2:360'; // 360p로 축소
      console.log(`압축 비율 ${sizeRatio.toFixed(1)}x - 360p로 해상도 축소`);
    } else if (sizeRatio > 4 && originalHeight > 480) {
      scaleFilter = 'scale=-2:480'; // 480p로 축소
      console.log(`압축 비율 ${sizeRatio.toFixed(1)}x - 480p로 해상도 축소`);
    } else if (sizeRatio > 2 && originalHeight > 720) {
      scaleFilter = 'scale=-2:720'; // 720p로 축소
      console.log(`압축 비율 ${sizeRatio.toFixed(1)}x - 720p로 해상도 축소`);
    }
    
    // 분할할 구간 수 계산
    const totalParts = Math.ceil(parseFloat(originalSizeKB) / targetSizeKB);
    const segmentDuration = videoInfo.duration / totalParts;
    
    const parts = [];
    const audioBitrate = 32; // kbps (최대한 압축)
    
    // 각 구간별로 분할
    for (let i = 0; i < totalParts; i++) {
      const segmentStartTime = i * segmentDuration;
      const timestamp = Date.now() + i;
      let outputPath = path.join(outputDir, `split_${timestamp}_${baseFileName}_part${i + 1}${outputExt}`);
      
      // 목표 비트레이트 계산 (40%로 강하게 설정하여 목표 크기 확실히 달성)
      const targetBitratePerPart = Math.floor((targetSizeKB * 8) / segmentDuration);
      let currentBitrate = Math.max(Math.floor((targetBitratePerPart - audioBitrate) * 0.4), 32);
      
      let partSizeKB;
      
      if (isWebM) {
        // WebM: VP8 초고속 인코딩 (품질 희생 + 확실한 크기 달성)
        console.log(`파트 ${i + 1} VP8 초고속 인코딩 시작 - 목표 비트레이트: ${currentBitrate}kbps`);
        
        // 비디오 필터 설정 (해상도 축소 + 프레임레이트 제한)
        const videoFilters = [];
        if (scaleFilter) {
          videoFilters.push(scaleFilter);
        }
        videoFilters.push('fps=24'); // 24fps로 제한하여 용량 감소
        
        await new Promise((resolve, reject) => {
          const command = ffmpeg(inputPath)
            .setStartTime(segmentStartTime)
            .setDuration(segmentDuration)
            .videoFilters(videoFilters)
            .outputOptions([
              '-c:v libvpx',
              '-c:a libvorbis',
              '-b:v ' + currentBitrate + 'k',
              '-maxrate ' + currentBitrate + 'k',
              '-bufsize ' + currentBitrate + 'k',
              '-b:a ' + audioBitrate + 'k',
              '-cpu-used 8',
              '-deadline realtime',
              '-qmin 30',
              '-qmax 63',
              '-threads 0'
            ]);
          
          command
            .output(outputPath)
            .on('start', (cmd) => {
              console.log(`파트 ${i + 1} 인코딩 명령어:`, cmd);
            })
            .on('progress', (progress) => {
              console.log(`파트 ${i + 1} 진행 중: ${progress.percent ? progress.percent.toFixed(2) : 0}%`);
            })
            .on('end', () => {
              console.log(`파트 ${i + 1} 인코딩 완료`);
              resolve();
            })
            .on('error', (err) => {
              console.error(`파트 ${i + 1} 인코딩 오류:`, err);
              reject(err);
            })
            .run();
        });
        
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


