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
    
    // 하드웨어 가속 및 최적화된 설정
    const hwAccelOptions = await detectHardwareAcceleration();
    const cpuCores = require('os').cpus().length;
    const threads = Math.max(1, Math.floor(cpuCores * 0.75)); // CPU 코어의 75% 사용
    
    // 영상 압축
    await new Promise((resolve, reject) => {
      let ffmpegCommand = ffmpeg(inputPath);
      
      // 하드웨어 가속 설정 (사용 가능한 경우)
      if (hwAccelOptions.encoder) {
        ffmpegCommand
          .videoBitrate(targetBitrate)
          .audioBitrate('128k')
          .outputOptions([
            `-c:v ${hwAccelOptions.encoder}`,
            '-c:a aac',
            '-maxrate ' + targetBitrate + 'k',
            '-bufsize ' + (targetBitrate * 2) + 'k',
            '-movflags +faststart',
            ...hwAccelOptions.extraOptions
          ]);
      } else {
        // 소프트웨어 인코딩 (최적화된 설정)
        ffmpegCommand
          .videoBitrate(targetBitrate)
          .audioBitrate('128k')
          .outputOptions([
            '-c:v libx264',
            '-c:a aac',
            '-preset veryfast', // fast에서 veryfast로 변경 (속도 우선)
            '-tune zerolatency', // 지연 시간 최소화
            '-crf 23',
            `-threads ${threads}`, // 멀티스레딩 최적화
            '-maxrate ' + targetBitrate + 'k',
            '-bufsize ' + (targetBitrate * 2) + 'k',
            '-movflags +faststart',
            '-x264-params keyint=60:min-keyint=60', // 키프레임 간격 최적화
          ]);
      }
      
      ffmpegCommand
        .output(outputPath)
        .on('start', (cmd) => {
          console.log('FFmpeg 명령어 실행:', cmd);
          console.log(`사용 중: ${hwAccelOptions.encoder || 'libx264 (소프트웨어)'}, 스레드: ${threads}`);
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
    
    // 하드웨어 가속 및 최적화 설정
    const hwAccelOptions = await detectHardwareAcceleration();
    const cpuCores = require('os').cpus().length;
    const threads = Math.max(1, Math.floor(cpuCores * 0.75));
    
    // 각 구간별로 분할
    for (let i = 0; i < totalParts; i++) {
      const startTime = i * segmentDuration;
      const timestamp = Date.now() + i; // 각 파일마다 고유한 타임스탬프
      const outputPath = path.join(outputDir, `split_${timestamp}_${baseFileName}_part${i + 1}.mp4`);
      
      await new Promise((resolve, reject) => {
        let ffmpegCommand = ffmpeg(inputPath)
          .setStartTime(startTime)
          .setDuration(segmentDuration);
        
        // 하드웨어 가속 또는 최적화된 소프트웨어 인코딩
        if (hwAccelOptions.encoder) {
          ffmpegCommand.outputOptions([
            `-c:v ${hwAccelOptions.encoder}`,
            '-c:a aac',
            '-movflags +faststart',
            ...hwAccelOptions.extraOptions
          ]);
        } else {
          ffmpegCommand.outputOptions([
            '-c:v libx264',
            '-c:a aac',
            '-preset veryfast',
            '-tune zerolatency',
            `-threads ${threads}`,
            '-movflags +faststart'
          ]);
        }
        
        ffmpegCommand
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
    }
    
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
 * 하드웨어 가속 감지 및 설정
 * @returns {Promise<Object>} 하드웨어 가속 옵션
 */
async function detectHardwareAcceleration() {
  return new Promise((resolve) => {
    // FFmpeg 버전 확인 및 하드웨어 인코더 감지
    ffmpeg()
      .getAvailableEncoders((err, encoders) => {
        if (err) {
          console.log('하드웨어 가속 감지 실패, 소프트웨어 인코딩 사용');
          resolve({ encoder: null, extraOptions: [] });
          return;
        }
        
        // NVIDIA NVENC (가장 빠름)
        if (encoders.h264_nvenc) {
          console.log('NVIDIA NVENC 하드웨어 가속 감지됨');
          resolve({
            encoder: 'h264_nvenc',
            extraOptions: [
              '-preset p1', // 가장 빠른 프리셋
              '-tune ll', // low latency
              '-rc vbr', // variable bitrate
            ]
          });
          return;
        }
        
        // Intel Quick Sync Video
        if (encoders.h264_qsv) {
          console.log('Intel QSV 하드웨어 가속 감지됨');
          resolve({
            encoder: 'h264_qsv',
            extraOptions: [
              '-preset veryfast',
              '-look_ahead 0',
            ]
          });
          return;
        }
        
        // AMD AMF
        if (encoders.h264_amf) {
          console.log('AMD AMF 하드웨어 가속 감지됨');
          resolve({
            encoder: 'h264_amf',
            extraOptions: [
              '-quality speed',
              '-rc vbr_latency',
            ]
          });
          return;
        }
        
        // VAAPI (Linux)
        if (encoders.h264_vaapi) {
          console.log('VAAPI 하드웨어 가속 감지됨');
          resolve({
            encoder: 'h264_vaapi',
            extraOptions: [
              '-vaapi_device /dev/dri/renderD128',
            ]
          });
          return;
        }
        
        // 하드웨어 가속 없음
        console.log('하드웨어 가속 미감지, 소프트웨어 인코딩 사용');
        resolve({ encoder: null, extraOptions: [] });
      });
  });
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


