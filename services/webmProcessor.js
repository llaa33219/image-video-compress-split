const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const fs = require('fs-extra');
const path = require('path');

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
    
    // WebM 파일 정보 가져오기
    const webmInfo = await getWebMInfo(inputPath);
    
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
    
    // 화질 변경 지점을 기준으로 분할
    const splitPoints = [0, ...qualityChanges.map(qc => qc.timestamp), webmInfo.duration];
    const segments = [];
    
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
    
    // 병렬 처리를 위한 Promise 배열 생성
    const parts = [];
    const baseFileName = path.basename(inputPath, path.extname(inputPath));
    const splitPromises = [];
    const segmentInfos = [];
    
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const timestamp = Date.now() + i; // 각 파일마다 고유한 타임스탬프
      const outputPath = path.join(outputDir, `webm_${timestamp}_${baseFileName}_part${i + 1}.webm`);
      
      segmentInfos.push({ index: i, segment, outputPath });
      
      // 각 세그먼트를 병렬로 처리
      const splitPromise = new Promise((resolve, reject) => {
        ffmpeg(inputPath)
          .setStartTime(segment.startTime)
          .setDuration(segment.duration)
          .outputOptions([
            '-c:v libvpx-vp9',
            '-c:a libopus',
            '-b:v 0',
            '-crf 30',
            '-threads 0',  // 모든 CPU 코어 활용
            '-speed 4',  // VP9 인코딩 속도 향상 (0-4, 높을수록 빠름)
            '-tile-columns 6',  // 병렬 처리 개선
            '-frame-parallel 1'  // 프레임 병렬 처리 활성화
          ])
          .output(outputPath)
          .on('start', (cmd) => {
            console.log(`FFmpeg 명령어 실행 (WebM 파트 ${i + 1}/${segments.length}):`, cmd);
          })
          .on('progress', (progress) => {
            console.log(`WebM 파트 ${i + 1} 처리 중: ${progress.percent ? progress.percent.toFixed(2) : 0}%`);
          })
          .on('end', () => {
            console.log(`WebM 파트 ${i + 1} 완료`);
            resolve({ index: i, outputPath });
          })
          .on('error', (err) => {
            console.error(`WebM 파트 ${i + 1} 오류:`, err);
            reject(err);
          })
          .run();
      });
      
      splitPromises.push(splitPromise);
    }
    
    // 모든 분할 작업을 병렬로 실행
    console.log(`${segments.length}개 WebM 파트를 병렬 처리 시작...`);
    const results = await Promise.all(splitPromises);
    
    // 결과를 순서대로 정리
    for (const result of results) {
      const segmentInfo = segmentInfos[result.index];
      const partStats = await fs.stat(result.outputPath);
      const partSizeKB = (partStats.size / 1024).toFixed(2);
      
      parts.push({
        partNumber: result.index + 1,
        size: parseFloat(partSizeKB),
        duration: segmentInfo.segment.duration,
        startTime: segmentInfo.segment.startTime,
        endTime: segmentInfo.segment.endTime,
        qualityChange: segmentInfo.segment.qualityChange,
        outputPath: `/output/${path.basename(result.outputPath)}`
      });
    }
    
    // 파트 번호순으로 정렬
    parts.sort((a, b) => a.partNumber - b.partNumber);
    
    return {
      success: true,
      message: `WebM 파일이 ${parts.length}개 구간으로 분할되었습니다. (화질 변경 ${qualityChanges.length}개 감지)`,
      originalSize: parseFloat(originalSizeKB),
      totalParts: parts.length,
      qualityChanges: qualityChanges,
      parts: parts,
      action: 'split_with_quality_detection'
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
    
    ffmpeg(inputPath)
      .outputOptions([
        '-f null',
        '-'
      ])
      .on('stderr', (stderrLine) => {
        // 비트레이트 변화 감지
        const bitrateMatch = stderrLine.match(/bitrate:\s*(\d+\.?\d*)\s*kbits\/s/);
        if (bitrateMatch) {
          const currentBitrate = parseFloat(bitrateMatch[1]);
          if (previousBitrate > 0 && Math.abs(currentBitrate - previousBitrate) > 100) {
            // 비트레이트가 100kbps 이상 변화한 경우
            const timestampMatch = stderrLine.match(/time=(\d+:\d+:\d+\.\d+)/);
            if (timestampMatch) {
              const timestamp = parseTimestamp(timestampMatch[1]);
              qualityChanges.push({
                timestamp,
                type: 'bitrate_change',
                from: previousBitrate,
                to: currentBitrate
              });
            }
          }
          previousBitrate = currentBitrate;
        }
        
        // 해상도 변화 감지
        const resolutionMatch = stderrLine.match(/(\d+)x(\d+)/);
        if (resolutionMatch) {
          const currentResolution = resolutionMatch[0];
          if (previousResolution && currentResolution !== previousResolution) {
            const timestampMatch = stderrLine.match(/time=(\d+:\d+:\d+\.\d+)/);
            if (timestampMatch) {
              const timestamp = parseTimestamp(timestampMatch[1]);
              qualityChanges.push({
                timestamp,
                type: 'resolution_change',
                from: previousResolution,
                to: currentResolution
              });
            }
          }
          previousResolution = currentResolution;
        }
      })
      .on('end', () => {
        // 중복 제거 및 정렬
        const uniqueChanges = qualityChanges.filter((change, index, self) => 
          index === self.findIndex(c => c.timestamp === change.timestamp)
        ).sort((a, b) => a.timestamp - b.timestamp);
        
        resolve(uniqueChanges);
      })
      .on('error', reject)
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
