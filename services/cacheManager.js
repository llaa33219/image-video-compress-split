const fs = require('fs-extra');
const crypto = require('crypto');
const path = require('path');

// 메모리 기반 캐시 (Railway 환경 고려하여 제한적 사용)
const metadataCache = new Map();
const MAX_CACHE_SIZE = 100; // 최대 캐시 항목 수
const CACHE_TTL = 5 * 60 * 1000; // 5분 TTL

/**
 * 파일 해시 생성
 * @param {string} filePath - 파일 경로
 * @returns {Promise<string>} 파일 해시
 */
async function generateFileHash(filePath) {
  const stats = await fs.stat(filePath);
  const hash = crypto.createHash('md5');
  hash.update(filePath + stats.size + stats.mtime.getTime());
  return hash.digest('hex');
}

/**
 * 캐시에서 메타데이터 조회
 * @param {string} filePath - 파일 경로
 * @returns {Object|null} 캐시된 메타데이터
 */
function getCachedMetadata(filePath) {
  const hash = crypto.createHash('md5').update(filePath).digest('hex');
  const cached = metadataCache.get(hash);
  
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  
  // 만료된 캐시 삭제
  if (cached) {
    metadataCache.delete(hash);
  }
  
  return null;
}

/**
 * 메타데이터를 캐시에 저장
 * @param {string} filePath - 파일 경로
 * @param {Object} metadata - 메타데이터
 */
function setCachedMetadata(filePath, metadata) {
  // 캐시 크기 제한
  if (metadataCache.size >= MAX_CACHE_SIZE) {
    // 가장 오래된 항목 삭제
    const oldestKey = metadataCache.keys().next().value;
    metadataCache.delete(oldestKey);
  }
  
  const hash = crypto.createHash('md5').update(filePath).digest('hex');
  metadataCache.set(hash, {
    data: metadata,
    timestamp: Date.now()
  });
}

/**
 * 캐시 정리 (메모리 최적화)
 */
function clearExpiredCache() {
  const now = Date.now();
  for (const [key, value] of metadataCache.entries()) {
    if (now - value.timestamp > CACHE_TTL) {
      metadataCache.delete(key);
    }
  }
}

/**
 * 전체 캐시 정리
 */
function clearAllCache() {
  metadataCache.clear();
}

// 주기적 캐시 정리 (메모리 최적화)
setInterval(clearExpiredCache, 60000); // 1분마다 실행

module.exports = {
  generateFileHash,
  getCachedMetadata,
  setCachedMetadata,
  clearExpiredCache,
  clearAllCache
};
