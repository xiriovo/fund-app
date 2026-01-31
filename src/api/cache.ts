// [WHY] 全局缓存管理器，参考 fishing-funds 的缓存策略
// [WHAT] 提供内存缓存，避免重复请求，提升加载速度

interface CacheItem<T> {
  data: T
  timestamp: number
  ttl: number  // 生存时间(ms)
}

class CacheManager {
  private cache = new Map<string, CacheItem<any>>()
  
  // [WHAT] 设置缓存
  set<T>(key: string, data: T, ttlMs = 30000): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl: ttlMs
    })
  }
  
  // [WHAT] 获取缓存（返回null表示过期或不存在）
  get<T>(key: string): T | null {
    const item = this.cache.get(key)
    if (!item) return null
    
    if (Date.now() - item.timestamp > item.ttl) {
      this.cache.delete(key)
      return null
    }
    
    return item.data as T
  }
  
  // [WHAT] 检查缓存是否存在且有效
  has(key: string): boolean {
    return this.get(key) !== null
  }
  
  // [WHAT] 清除指定缓存
  delete(key: string): void {
    this.cache.delete(key)
  }
  
  // [WHAT] 清除所有缓存
  clear(): void {
    this.cache.clear()
  }
  
  // [WHAT] 获取缓存大小
  get size(): number {
    return this.cache.size
  }
}

// [WHAT] 导出单例
export const cache = new CacheManager()

// [WHAT] 缓存TTL常量（秒级刷新优化）
export const CACHE_TTL = {
  ESTIMATE: 800,        // 实时估值 0.8秒（秒级刷新）
  NET_VALUE: 60000,     // 历史净值 1分钟
  FUND_LIST: 3600000,   // 基金列表 1小时
  FUND_DETAIL: 300000,  // 基金详情 5分钟
  MARKET_INDEX: 3000,   // 大盘指数 3秒
  FUND_INFO: 300000,    // 基金/经理信息 5分钟
  SHORT: 60000,         // 短期缓存 1分钟
  LONG: 3600000,        // 长期缓存 1小时
}
