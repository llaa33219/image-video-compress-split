/**
 * 압축 캐시 모듈 - 최근 압축 결과를 캐싱하여 품질 추정 개선
 */

class CompressionCache {
  constructor() {
    this.cache = new Map();
    this.maxSize = 100; // 최대 캐시 항목 수
    this.maxAge = 1000 * 60 * 60; // 1시간
  }

  /**
   * 캐시 키 생성
   * @param {string} format - 이미지 형식
   * @param {number} originalSize - 원본 크기 (KB)
   * @param {number} targetSize - 목표 크기 (KB)
   * @returns {string} 캐시 키
   */
  generateKey(format, originalSize, targetSize) {
    const sizeRange = Math.floor(originalSize / 100) * 100; // 100KB 단위로 그룹화
    const ratio = Math.round((targetSize / originalSize) * 10) / 10; // 0.1 단위로 반올림
    return `${format}_${sizeRange}_${ratio}`;
  }

  /**
   * 캐시에서 품질 값 가져오기
   * @param {string} format - 이미지 형식
   * @param {number} originalSize - 원본 크기 (KB)
   * @param {number} targetSize - 목표 크기 (KB)
   * @returns {number|null} 캐시된 품질 값 또는 null
   */
  get(format, originalSize, targetSize) {
    const key = this.generateKey(format, originalSize, targetSize);
    const cached = this.cache.get(key);
    
    if (cached) {
      const age = Date.now() - cached.timestamp;
      if (age < this.maxAge) {
        // 캐시 히트 - 가중 평균 품질 반환
        return Math.round(cached.totalQuality / cached.count);
      } else {
        // 캐시 만료
        this.cache.delete(key);
      }
    }
    
    return null;
  }

  /**
   * 캐시에 품질 값 저장
   * @param {string} format - 이미지 형식
   * @param {number} originalSize - 원본 크기 (KB)
   * @param {number} targetSize - 목표 크기 (KB)
   * @param {number} quality - 성공한 품질 값
   */
  set(format, originalSize, targetSize, quality) {
    const key = this.generateKey(format, originalSize, targetSize);
    const existing = this.cache.get(key);
    
    if (existing) {
      // 기존 값과 평균내기
      existing.totalQuality += quality;
      existing.count += 1;
      existing.timestamp = Date.now();
    } else {
      // 새로운 항목 추가
      if (this.cache.size >= this.maxSize) {
        // 가장 오래된 항목 제거
        const oldestKey = this.findOldestKey();
        if (oldestKey) {
          this.cache.delete(oldestKey);
        }
      }
      
      this.cache.set(key, {
        totalQuality: quality,
        count: 1,
        timestamp: Date.now()
      });
    }
  }

  /**
   * 가장 오래된 캐시 키 찾기
   * @returns {string|null} 가장 오래된 키
   */
  findOldestKey() {
    let oldestKey = null;
    let oldestTime = Date.now();
    
    for (const [key, value] of this.cache.entries()) {
      if (value.timestamp < oldestTime) {
        oldestTime = value.timestamp;
        oldestKey = key;
      }
    }
    
    return oldestKey;
  }

  /**
   * 캐시 초기화
   */
  clear() {
    this.cache.clear();
  }

  /**
   * 캐시 통계
   * @returns {Object} 캐시 통계 정보
   */
  getStats() {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      entries: Array.from(this.cache.entries()).map(([key, value]) => ({
        key,
        averageQuality: Math.round(value.totalQuality / value.count),
        count: value.count,
        age: Math.round((Date.now() - value.timestamp) / 1000) + 's'
      }))
    };
  }
}

// 싱글톤 인스턴스
const compressionCache = new CompressionCache();

module.exports = compressionCache;
