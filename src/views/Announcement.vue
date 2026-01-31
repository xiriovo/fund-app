<script setup lang="ts">
// [WHY] 公告中心页面 - 集中展示所有公告、更新日志、关于信息
// [WHAT] 显示远程公告、版本信息、开源链接、更新记录

import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { 
  fetchRemoteConfig, 
  clearShownAnnouncements,
  type Announcement,
  type RemoteConfig
} from '@/api/remote'
import { APP_VERSION } from '@/config/version'
import { showToast } from 'vant'

const router = useRouter()

// [WHAT] 数据状态
const loading = ref(true)
const config = ref<RemoteConfig | null>(null)
const activeTab = ref<'announcement' | 'update' | 'about'>('announcement')

// [WHAT] 更新日志（本地维护）
const updateLogs = [
  {
    version: '1.1.0',
    date: '2026-01-30',
    changes: [
      '新增：全球指数实时行情',
      '新增：基金重仓股票明细',
      '新增：公告中心页面',
      '优化：首页布局调整',
    ]
  },
  {
    version: '1.0.0',
    date: '2026-01-28',
    changes: [
      '首次发布',
      '支持基金自选、持仓管理',
      '支持基金对比、定投计算',
      '支持基金经理排行、回测模拟',
      '支持智能提醒、投资日历',
    ]
  }
]

// [WHAT] 关于信息
const aboutInfo = {
  name: '基金宝',
  version: APP_VERSION,
  description: '一款简洁实用的基金管理工具',
  github: 'https://github.com/xiriovo/fund-app',
  features: [
    '实时估值 - 秒级更新基金估值',
    '自选管理 - 便捷管理关注基金',
    '持仓记录 - 记录买入计算收益',
    '基金对比 - 多维度对比分析',
    '定投计算 - 模拟定投收益',
    '智能提醒 - 涨跌提醒不错过',
  ]
}

// [WHAT] 所有公告（不过滤showOnce）
const allAnnouncements = computed(() => {
  if (!config.value) return []
  const now = new Date()
  return config.value.announcements.filter(a => {
    const start = new Date(a.startTime)
    const end = new Date(a.endTime)
    return now >= start && now <= end
  })
})

// [WHAT] 加载远程配置
onMounted(async () => {
  loading.value = true
  try {
    config.value = await fetchRemoteConfig()
  } finally {
    loading.value = false
  }
})

// [WHAT] 获取公告类型样式
function getAnnouncementClass(type: string) {
  return {
    info: 'type-info',
    warning: 'type-warning',
    update: 'type-update'
  }[type] || 'type-info'
}

// [WHAT] 获取公告类型标签
function getTypeLabel(type: string) {
  return {
    info: '公告',
    warning: '警告',
    update: '更新'
  }[type] || '公告'
}

// [WHAT] 打开链接
function openLink(url: string) {
  window.open(url, '_blank')
}

// [WHAT] 清除已读记录
function resetReadStatus() {
  clearShownAnnouncements()
  showToast('已重置，下次启动将重新显示公告')
}
</script>

<template>
  <div class="announcement-page">
    <!-- 顶部导航 -->
    <div class="page-header">
      <van-icon name="arrow-left" size="20" @click="router.back()" />
      <span class="header-title">公告中心</span>
      <div class="header-placeholder"></div>
    </div>

    <!-- Tab 切换 -->
    <div class="tab-bar">
      <div 
        class="tab-item" 
        :class="{ active: activeTab === 'announcement' }"
        @click="activeTab = 'announcement'"
      >
        公告
      </div>
      <div 
        class="tab-item" 
        :class="{ active: activeTab === 'update' }"
        @click="activeTab = 'update'"
      >
        更新日志
      </div>
      <div 
        class="tab-item" 
        :class="{ active: activeTab === 'about' }"
        @click="activeTab = 'about'"
      >
        关于
      </div>
    </div>

    <!-- 内容区域 -->
    <div class="content-area">
      <!-- 公告列表 -->
      <div v-if="activeTab === 'announcement'" class="announcement-list">
        <van-loading v-if="loading" class="loading-state" />
        
        <template v-else-if="allAnnouncements.length > 0">
          <div 
            v-for="item in allAnnouncements" 
            :key="item.id"
            class="announcement-card"
          >
            <div class="card-header">
              <span class="type-tag" :class="getAnnouncementClass(item.type)">
                {{ getTypeLabel(item.type) }}
              </span>
              <span class="card-title">{{ item.title }}</span>
            </div>
            <div class="card-content">
              <p v-for="(line, idx) in item.content.split('\\n')" :key="idx">
                <a 
                  v-if="line.startsWith('http')" 
                  :href="line" 
                  target="_blank" 
                  class="content-link"
                  @click.stop
                >{{ line }}</a>
                <span v-else>{{ line }}</span>
              </p>
            </div>
            <div class="card-footer">
              <span class="time-range">
                {{ item.startTime.split('T')[0] }} ~ {{ item.endTime.split('T')[0] }}
              </span>
            </div>
          </div>
        </template>

        <van-empty v-else description="暂无公告" />

        <!-- 重置按钮 -->
        <div class="reset-btn" @click="resetReadStatus">
          重置已读状态
        </div>
      </div>

      <!-- 更新日志 -->
      <div v-if="activeTab === 'update'" class="update-logs">
        <div 
          v-for="log in updateLogs" 
          :key="log.version"
          class="log-card"
        >
          <div class="log-header">
            <span class="log-version">v{{ log.version }}</span>
            <span class="log-date">{{ log.date }}</span>
            <span v-if="log.version === APP_VERSION" class="current-tag">当前版本</span>
          </div>
          <ul class="log-changes">
            <li v-for="(change, idx) in log.changes" :key="idx">
              {{ change }}
            </li>
          </ul>
        </div>
      </div>

      <!-- 关于页面 -->
      <div v-if="activeTab === 'about'" class="about-section">
        <!-- Logo 区域 -->
        <div class="about-logo">
          <div class="logo-icon">💰</div>
          <div class="app-name">{{ aboutInfo.name }}</div>
          <div class="app-version">v{{ aboutInfo.version }}</div>
          <div class="app-desc">{{ aboutInfo.description }}</div>
        </div>

        <!-- 功能特点 -->
        <div class="feature-card">
          <div class="card-title">功能特点</div>
          <div class="feature-list">
            <div 
              v-for="(feature, idx) in aboutInfo.features" 
              :key="idx"
              class="feature-item"
            >
              <van-icon name="checked" color="var(--color-primary)" />
              <span>{{ feature }}</span>
            </div>
          </div>
        </div>

        <!-- 链接 -->
        <div class="link-card">
          <div class="link-item" @click="openLink(aboutInfo.github)">
            <div class="link-icon">
              <van-icon name="link-o" size="20" />
            </div>
            <div class="link-info">
              <div class="link-title">GitHub</div>
              <div class="link-desc">查看源代码，欢迎 Star</div>
            </div>
            <van-icon name="arrow" color="var(--text-secondary)" />
          </div>
        </div>

        <!-- 版权信息 -->
        <div class="copyright">
          <p>基金投资有风险，入市需谨慎</p>
          <p>本应用仅供学习参考，不构成投资建议</p>
          <p class="open-source">开源项目 · MIT License</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.announcement-page {
  min-height: 100vh;
  background: var(--bg-primary);
}

/* 顶部导航 */
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  padding-top: calc(12px + env(safe-area-inset-top));
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
}

.header-title {
  font-size: 17px;
  font-weight: 600;
  color: var(--text-primary);
}

.header-placeholder {
  width: 20px;
}

/* Tab 切换 */
.tab-bar {
  display: flex;
  background: var(--bg-secondary);
  padding: 0 16px;
  border-bottom: 1px solid var(--border-color);
}

.tab-item {
  flex: 1;
  text-align: center;
  padding: 12px 0;
  font-size: 14px;
  color: var(--text-secondary);
  position: relative;
  cursor: pointer;
  transition: color 0.2s;
}

.tab-item.active {
  color: var(--color-primary);
  font-weight: 600;
}

.tab-item.active::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 24px;
  height: 3px;
  background: var(--color-primary);
  border-radius: 2px;
}

/* 内容区域 */
.content-area {
  padding: 12px;
}

/* 公告列表 */
.loading-state {
  display: flex;
  justify-content: center;
  padding: 40px;
}

.announcement-card {
  background: var(--bg-secondary);
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 12px;
}

.card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.type-tag {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  font-weight: 500;
}

.type-info {
  background: #e0f2fe;
  color: #0369a1;
}

.type-warning {
  background: #fef3c7;
  color: #d97706;
}

.type-update {
  background: #d1fae5;
  color: #059669;
}

.card-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}

.card-content {
  font-size: 14px;
  color: var(--text-secondary);
  line-height: 1.6;
}

.card-content p {
  margin: 4px 0;
}

.content-link {
  color: var(--color-primary);
  text-decoration: underline;
  word-break: break-all;
}

.card-footer {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border-color);
}

.time-range {
  font-size: 12px;
  color: var(--text-tertiary);
}

.reset-btn {
  text-align: center;
  padding: 12px;
  font-size: 13px;
  color: var(--text-secondary);
  cursor: pointer;
}

/* 更新日志 */
.log-card {
  background: var(--bg-secondary);
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 12px;
}

.log-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.log-version {
  font-size: 16px;
  font-weight: 600;
  color: var(--color-primary);
}

.log-date {
  font-size: 12px;
  color: var(--text-secondary);
}

.current-tag {
  font-size: 10px;
  padding: 2px 6px;
  background: var(--color-primary);
  color: white;
  border-radius: 4px;
  margin-left: auto;
}

.log-changes {
  margin: 0;
  padding-left: 20px;
}

.log-changes li {
  font-size: 14px;
  color: var(--text-secondary);
  line-height: 1.8;
}

/* 关于页面 */
.about-logo {
  text-align: center;
  padding: 32px 0;
}

.logo-icon {
  font-size: 48px;
  margin-bottom: 12px;
}

.app-name {
  font-size: 22px;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 4px;
}

.app-version {
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.app-desc {
  font-size: 14px;
  color: var(--text-secondary);
}

.feature-card,
.link-card {
  background: var(--bg-secondary);
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 12px;
}

.feature-card .card-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 12px;
}

.feature-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.feature-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: var(--text-secondary);
}

.link-item {
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
}

.link-icon {
  width: 40px;
  height: 40px;
  background: var(--bg-primary);
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.link-info {
  flex: 1;
}

.link-title {
  font-size: 15px;
  font-weight: 500;
  color: var(--text-primary);
}

.link-desc {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 2px;
}

.copyright {
  text-align: center;
  padding: 24px 0 40px;
}

.copyright p {
  font-size: 12px;
  color: var(--text-tertiary);
  margin: 4px 0;
}

.copyright .open-source {
  margin-top: 12px;
  color: var(--text-secondary);
}
</style>
