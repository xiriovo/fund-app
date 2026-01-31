/**
 * 远程配置 API
 * [WHY] 从 GitHub Pages 获取远程配置，实现无需发版即可更新公告
 * [WHAT] 获取公告、版本更新提示等远程配置
 * [DEPS] 依赖 GitHub Pages 托管的 announcement.json 文件
 */

// [WHAT] 远程配置文件 URL，部署后替换为实际地址
// [HOW] 本地开发时使用相对路径，生产环境使用完整 URL
// [NOTE] 部署后将 xiriovo 替换为实际 GitHub 用户名
const isDev = import.meta.env.DEV
const REMOTE_CONFIG_URL = isDev 
  ? '/config/announcement.json'
  : 'API_ENDPOINT/config/announcement.json'

/**
 * 公告类型
 * [WHAT] info-普通公告, warning-警告, update-版本更新
 */
export type AnnouncementType = 'info' | 'warning' | 'update'

/**
 * 公告接口定义
 */
export interface Announcement {
  /** 公告唯一ID，用于标记已读状态 */
  id: string
  /** 公告标题 */
  title: string
  /** 公告内容，支持 \n 换行 */
  content: string
  /** 公告类型 */
  type: AnnouncementType
  /** 是否只显示一次 */
  showOnce: boolean
  /** 生效开始时间 ISO 格式 */
  startTime: string
  /** 生效结束时间 ISO 格式 */
  endTime: string
}

/**
 * 远程配置接口定义
 */
export interface RemoteConfig {
  /** 最新版本号 */
  version: string
  /** 是否强制更新 */
  forceUpdate: boolean
  /** 最低支持版本 */
  minVersion: string
  /** 公告列表 */
  announcements: Announcement[]
  /** 更新下载地址 */
  updateUrl: string
  /** 相关链接 */
  links?: {
    github?: string
    feedback?: string
  }
}

// [WHAT] 本地存储 key
const SHOWN_ANNOUNCEMENTS_KEY = 'fund_app_shown_announcements'
const LAST_CHECK_TIME_KEY = 'fund_app_last_config_check'

/**
 * 获取远程配置
 * [WHAT] 从远程服务器获取配置，带缓存防止频繁请求
 * [EDGE] 网络失败时返回 null，调用方需处理
 */
export async function fetchRemoteConfig(): Promise<RemoteConfig | null> {
  try {
    // [WHY] 添加时间戳防止浏览器缓存
    const url = `${REMOTE_CONFIG_URL}?t=${Date.now()}`
    const res = await fetch(url, {
      method: 'GET',
      cache: 'no-cache'
    })
    
    if (!res.ok) {
      console.warn('远程配置请求失败:', res.status)
      return null
    }
    
    const config = await res.json() as RemoteConfig
    
    // [WHAT] 记录检查时间
    localStorage.setItem(LAST_CHECK_TIME_KEY, Date.now().toString())
    
    return config
  } catch (err) {
    console.warn('获取远程配置失败:', err)
    return null
  }
}

/**
 * 获取当前生效的公告
 * [WHAT] 过滤出时间范围内且未显示过（如果设置了 showOnce）的公告
 * [HOW] 对比本地已显示列表，过滤已过期公告
 */
export function getActiveAnnouncements(config: RemoteConfig): Announcement[] {
  const now = new Date()
  const shownIds = getShownAnnouncementIds()
  
  return config.announcements.filter(announcement => {
    // [WHAT] 检查时间范围
    const startTime = new Date(announcement.startTime)
    const endTime = new Date(announcement.endTime)
    const inTimeRange = now >= startTime && now <= endTime
    
    if (!inTimeRange) return false
    
    // [WHAT] 检查是否已显示（仅对 showOnce 生效）
    if (announcement.showOnce && shownIds.includes(announcement.id)) {
      return false
    }
    
    return true
  })
}

/**
 * 获取已显示的公告 ID 列表
 */
function getShownAnnouncementIds(): string[] {
  try {
    const data = localStorage.getItem(SHOWN_ANNOUNCEMENTS_KEY)
    return data ? JSON.parse(data) : []
  } catch {
    return []
  }
}

/**
 * 标记公告已显示
 * [WHAT] 将公告 ID 添加到本地存储，防止重复显示
 */
export function markAnnouncementShown(id: string): void {
  const shownIds = getShownAnnouncementIds()
  if (!shownIds.includes(id)) {
    shownIds.push(id)
    localStorage.setItem(SHOWN_ANNOUNCEMENTS_KEY, JSON.stringify(shownIds))
  }
}

/**
 * 清除已显示公告记录
 * [WHAT] 用于调试或用户手动重置
 */
export function clearShownAnnouncements(): void {
  localStorage.removeItem(SHOWN_ANNOUNCEMENTS_KEY)
}

/**
 * 比较版本号
 * [WHAT] 判断 v1 是否小于 v2
 * [HOW] 按 . 分割后逐段比较数字
 * @returns true 表示 v1 < v2，需要更新
 */
export function isVersionLower(v1: string, v2: string): boolean {
  const parts1 = v1.split('.').map(Number)
  const parts2 = v2.split('.').map(Number)
  
  const maxLen = Math.max(parts1.length, parts2.length)
  
  for (let i = 0; i < maxLen; i++) {
    const num1 = parts1[i] || 0
    const num2 = parts2[i] || 0
    
    if (num1 < num2) return true
    if (num1 > num2) return false
  }
  
  return false // 版本相同
}

/**
 * 检查是否需要更新
 * [WHAT] 对比当前版本与远程最新版本
 */
export function checkNeedUpdate(
  currentVersion: string,
  config: RemoteConfig
): { needUpdate: boolean; forceUpdate: boolean } {
  const needUpdate = isVersionLower(currentVersion, config.version)
  const forceUpdate = config.forceUpdate || isVersionLower(currentVersion, config.minVersion)
  
  return { needUpdate, forceUpdate }
}
