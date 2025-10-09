const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const fs = require('fs-extra');
const path = require('path');
const { getCachedMetadata, setCachedMetadata } = require('./cacheManager');

// ffmpeg 경로 설정
ffmpeg.setFfmpegPath(ffmpegStatic);

/**
 * WebM 파일의 화질 변경 감지 및 분할
 * @param {string} inputPath - 입력 WebM 파일 경로
 * @param {number} targetSizeKB - 각 분할 파일의 최대 용량 (KB)
 * @returns {Promise<Object>} 처리 결과
 */
async function detectWebMQualityChange(inputPath, targetSizeKB) {
  try {
    const outputDir = path.join(__dirname, '..', 'output');
    await fs.ensureDir(outputDir);
    
    // 원본 파일 정보
    const originalStats = await fs.stat(inputPath);
    const originalSizeKB = (originalStats.size / 1024).toFixed(2);
    
    // WebM 파일 정보 가져오기 (캐싱 적용)
    let webmInfo = getCachedMetadata(inputPath);
    if (!webmInfo) {
      webmInfo = await getWebMInfo(inputPath);
      setCachedMetadata(inputPath, webmInfo);
    }
    
    // 이미 목표 용량 이하인 경우
    if (parseFloat(originalSizeKB) <= targetSizeKB) {
      const outputPath = path.join(outputDir, `webm_${Date.now()}_${path.basename(inputPath)}`);
      await fs.copy(inputPath, outputPath);
      
      return {
        success: true,
        message: `WebM 파일이 이미 목표 용량(${targetSizeKB}KB) 이하입니다.`,
        originalSize: parseFloat(originalSizeKB),
        totalParts: 1,
        qualityChanges: [],
        parts: [{
          partNumber: 1,
          size: parseFloat(originalSizeKB),
          duration: webmInfo.duration,
          outputPath: `/output/${path.basename(outputPath)}`
        }],
        action: 'copied'
      };
    }
    
    // 화질 변경 지점 감지
    const qualityChanges = await detectQualityChanges(inputPath);
    
    let segments = [];
    
    if (qualityChanges.length > 0) {
      // 화질 변경 지점을 기준으로 분할
      const splitPoints = [0, ...qualityChanges.map(qc => qc.timestamp), webmInfo.duration];
      
      for (let i = 0; i < splitPoints.length - 1; i++) {
        const startTime = splitPoints[i];
        const endTime = splitPoints[i + 1];
        const duration = endTime - startTime;
        
        segments.push({
          startTime,
          endTime,
          duration,
          qualityChange: qualityChanges.find(qc => qc.timestamp === startTime) || null
        });
      }
    } else {
      // 화질 감지 실패 시 기본 분할 (용량 기준)
      const totalParts = Math.ceil(parseFloat(originalSizeKB) / targetSizeKB);
      const segmentDuration = webmInfo.duration / totalParts;
      
      for (let i = 0; i < totalParts; i++) {
        const startTime = i * segmentDuration;
        const endTime = Math.min((i + 1) * segmentDuration, webmInfo.duration);
        const duration = endTime - startTime;
        
        segments.push({
          startTime,
          endTime,
          duration,
          qualityChange: null
        });
      }
    }
    
    // 각 세그먼트를 개별 파일로 분할
    const parts = [];
    const baseFileName = path.basename(inputPath, path.extname(inputPath));
    
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const timestamp = Date.now() + i; // 각 파일마다 고유한 타임스탬프
      const outputPath = path.join(outputDir, `webm_${timestamp}_${baseFileName}_part${i + 1}.webm`);
      
      await new Promise((resolve, reject) => {
        // VP9 코덱 시도 (고품질)
        const tryVP9 = () => {
          ffmpeg(inputPath)
            .setStartTime(segment.startTime)
            .setDuration(segment.duration)
            .outputOptions([
              '-c:v libvpx-vp9',
              '-c:a libopus',
              '-b:v 0',
              '-crf 30',
              '-threads 0',
              '-speed 4',
              '-tile-columns 2',
              '-frame-parallel 1',
              '-auto-alt-ref 0',
              '-lag-in-frames 0'
            ])
            .output(outputPath)
            .on('start', (cmd) => {
              console.log(`FFmpeg 명령어 실행 (WebM 파트 ${i + 1}/${segments.length} - VP9):`, cmd);
            })
            .on('progress', (progress) => {
              console.log(`WebM 파트 ${i + 1} 처리 중: ${progress.percent ? progress.percent.toFixed(2) : 0}%`);
            })
            .on('end', () => {
              console.log(`WebM 파트 ${i + 1} 완료 (VP9)`);
              resolve();
            })
            .on('error', (err) => {
              console.warn(`VP9 코덱 실패, VP8로 재시도:`, err.message);
              tryVP8();
            })
            .run();
        };

        // VP8 코덱 시도 (호환성 우선)
        const tryVP8 = () => {
          ffmpeg(inputPath)
            .setStartTime(segment.startTime)
            .setDuration(segment.duration)
            .outputOptions([
              '-c:v libvpx',
              '-c:a libvorbis',
              '-b:v 0',
              '-crf 30',
              '-threads 0',
              '-speed 4'
            ])
            .output(outputPath)
            .on('start', (cmd) => {
              console.log(`FFmpeg 명령어 실행 (WebM 파트 ${i + 1}/${segments.length} - VP8):`, cmd);
            })
            .on('progress', (progress) => {
              console.log(`WebM 파트 ${i + 1} 처리 중: ${progress.percent ? progress.percent.toFixed(2) : 0}%`);
            })
            .on('end', () => {
              console.log(`WebM 파트 ${i + 1} 완료 (VP8)`);
              resolve();
            })
            .on('error', (err) => {
              console.warn(`VP8 코덱 실패, 기본 설정으로 재시도:`, err.message);
              tryDefault();
            })
            .run();
        };

        // 기본 설정으로 시도 (최후의 수단)
        const tryDefault = () => {
          ffmpeg(inputPath)
            .setStartTime(segment.startTime)
            .setDuration(segment.duration)
            .outputOptions([
              '-c:v libvpx',
              '-c:a libvorbis',
              '-threads 0'
            ])
            .output(outputPath)
            .on('start', (cmd) => {
              console.log(`FFmpeg 명령어 실행 (WebM 파트 ${i + 1}/${segments.length} - 기본):`, cmd);
            })
            .on('progress', (progress) => {
              console.log(`WebM 파트 ${i + 1} 처리 중: ${progress.percent ? progress.percent.toFixed(2) : 0}%`);
            })
            .on('end', () => {
              console.log(`WebM 파트 ${i + 1} 완료 (기본)`);
              resolve();
            })
            .on('error', (err) => {
              console.error(`WebM 파트 ${i + 1} 모든 코덱 실패:`, err);
              reject(err);
            })
            .run();
        };

        // VP9부터 시도
        tryVP9();
      });
      
      // 분할된 파일 크기 확인
      const partStats = await fs.stat(outputPath);
      const partSizeKB = (partStats.size / 1024).toFixed(2);
      
      parts.push({
        partNumber: i + 1,
        size: parseFloat(partSizeKB),
        duration: segment.duration,
        startTime: segment.startTime,
        endTime: segment.endTime,
        qualityChange: segment.qualityChange,
        outputPath: `/output/${path.basename(outputPath)}`
      });
    }
    
    return {
      success: true,
      message: qualityChanges.length > 0 
        ? `WebM 파일이 ${parts.length}개 구간으로 분할되었습니다. (화질 변경 ${qualityChanges.length}개 감지)`
        : `WebM 파일이 ${parts.length}개 구간으로 분할되었습니다. (기본 분할)`,
      originalSize: parseFloat(originalSizeKB),
      totalParts: parts.length,
      qualityChanges: qualityChanges,
      parts: parts,
      action: qualityChanges.length > 0 ? 'split_with_quality_detection' : 'split_default'
    };
    
  } catch (error) {
    console.error('WebM 처리 오류:', error);
    throw new Error(`WebM 처리 실패: ${error.message}`);
  }
}

/**
 * WebM 파일의 화질 변경 지점 감지
 * @param {string} inputPath - 입력 WebM 파일 경로
 * @returns {Promise<Array>} 화질 변경 지점 배열
 */
async function detectQualityChanges(inputPath) {
  return new Promise((resolve, reject) => {
    const qualityChanges = [];
    let previousBitrate = 0;
    let previousResolution = '';
    let lastTimestamp = 0;
    const minInterval = 3; // 최소 3초 간격으로만 변화 감지 (안정성 향상)
    let timeoutId;
    
    // 타임아웃 설정 (30초)
    timeoutId = setTimeout(() => {
      console.warn('화질 감지 타임아웃, 기본 분할로 전환');
      resolve([]);
    }, 30000);
    
    ffmpeg(inputPath)
      .outputOptions([
        '-f null',
        '-threads 0',
        '-skip_loop_filter nokey',
        '-skip_idct nokey',
        '-skip_frame nokey',
        '-v error' // 에러만 출력하여 로그 노이즈 감소
      ])
      .output('-') // 명시적으로 출력 지정
      .on('stderr', (stderrLine) => {
        try {
          // 타임스탬프 추출
          const timestampMatch = stderrLine.match(/time=(\d+:\d+:\d+\.\d+)/);
          if (!timestampMatch) return;
          
          const timestamp = parseTimestamp(timestampMatch[1]);
          
          // 최소 간격 체크 (안정성 향상)
          if (timestamp - lastTimestamp < minInterval) return;
          lastTimestamp = timestamp;
          
          // 비트레이트 변화 감지 (임계값 조정)
          const bitrateMatch = stderrLine.match(/bitrate:\s*(\d+\.?\d*)\s*kbits\/s/);
          if (bitrateMatch) {
            const currentBitrate = parseFloat(bitrateMatch[1]);
            if (previousBitrate > 0 && Math.abs(currentBitrate - previousBitrate) > 150) {
              // 비트레이트가 150kbps 이상 변화한 경우만 감지
              qualityChanges.push({
                timestamp,
                type: 'bitrate_change',
                from: previousBitrate,
                to: currentBitrate
              });
            }
            previousBitrate = currentBitrate;
          }
          
          // 해상도 변화 감지
          const resolutionMatch = stderrLine.match(/(\d+)x(\d+)/);
          if (resolutionMatch) {
            const currentResolution = resolutionMatch[0];
            if (previousResolution && currentResolution !== previousResolution) {
              qualityChanges.push({
                timestamp,
                type: 'resolution_change',
                from: previousResolution,
                to: currentResolution
              });
            }
            previousResolution = currentResolution;
          }
        } catch (error) {
          console.warn('화질 감지 중 오류:', error.message);
        }
      })
      .on('end', () => {
        clearTimeout(timeoutId);
        // 중복 제거 및 정렬 (안정성 향상)
        const uniqueChanges = qualityChanges
          .filter((change, index, self) => 
            index === self.findIndex(c => Math.abs(c.timestamp - change.timestamp) < 2)
          )
          .sort((a, b) => a.timestamp - b.timestamp);
        
        console.log(`화질 변경 지점 ${uniqueChanges.length}개 감지됨`);
        resolve(uniqueChanges);
      })
      .on('error', (err) => {
        clearTimeout(timeoutId);
        console.warn('화질 감지 실패, 기본 분할로 전환:', err.message);
        resolve([]); // 에러 시 빈 배열 반환하여 기본 분할 진행
      })
      .run();
  });
}

/**
 * WebM 파일 정보 가져오기
 * @param {string} inputPath - 입력 WebM 파일 경로
 * @returns {Promise<Object>} WebM 파일 정보
 */
function getWebMInfo(inputPath) {
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

/**
 * 타임스탬프 문자열을 초 단위로 변환
 * @param {string} timestamp - HH:MM:SS.sss 형식의 타임스탬프
 * @returns {number} 초 단위 시간
 */
function parseTimestamp(timestamp) {
  const parts = timestamp.split(':');
  const hours = parseInt(parts[0]);
  const minutes = parseInt(parts[1]);
  const seconds = parseFloat(parts[2]);
  
  return hours * 3600 + minutes * 60 + seconds;
}

module.exports = {
  detectWebMQualityChange,
  detectQualityChanges,
  getWebMInfo
};

