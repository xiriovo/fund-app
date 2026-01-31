<script setup lang="ts">
// [WHY] 首页 - 展示自选基金列表、市场概览和快捷入口
// [WHAT] 支持下拉刷新、左滑删除、点击跳转搜索添加、设置提醒

import { ref, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useFundStore } from '@/stores/fund'
import { useAlertStore, ALERT_TYPE_CONFIG, type AlertType } from '@/stores/alert'
import { fetchMarketIndicesFast, type MarketIndexSimple } from '@/api/fundFast'
import { fetchFinanceNews, type NewsItem } from '@/api/tiantianApi'
import { 
  fetchRemoteConfig, 
  getActiveAnnouncements, 
  markAnnouncementShown,
  checkNeedUpdate,
  type Announcement,
  type RemoteConfig
} from '@/api/remote'
import { APP_VERSION } from '@/config/version'
import { showConfirmDialog, showToast } from 'vant'
import FundCard from '@/components/FundCard.vue'

const router = useRouter()
const fundStore = useFundStore()
const alertStore = useAlertStore()

// [WHAT] 大盘指数
const indices = ref<MarketIndexSimple[]>([])

// [WHAT] 公告列表（默认 + 远程）
const defaultNotices = [
  '基金投资有风险，入市需谨慎',
  '交易时间：工作日 9:30-15:00'
]
const notices = ref<string[]>([...defaultNotices])

// [WHAT] 远程公告
const remoteAnnouncements = ref<Announcement[]>([])
const showAnnouncementPopup = ref(false)
const currentAnnouncement = ref<Announcement | null>(null)

// [WHAT] 更新状态
const updateInfo = ref<{
  needUpdate: boolean
  forceUpdate: boolean
  latestVersion: string
  updateUrl: string
} | null>(null)

// [WHAT] 财经资讯
const newsList = ref<NewsItem[]>([])
const newsLoading = ref(false)
const showNewsDetail = ref(false)
const currentNews = ref<NewsItem | null>(null)

// [WHAT] 页面挂载时初始化数据
onMounted(async () => {
  fundStore.initWatchlist()
  // 请求通知权限
  await alertStore.requestNotificationPermission()
  // 加载大盘指数和资讯
  loadIndices()
  loadNews()
  // 加载远程配置
  loadRemoteConfig()
})

// [WHAT] 加载远程配置（公告和更新检查）
async function loadRemoteConfig() {
  try {
    const config = await fetchRemoteConfig()
    if (!config) return
    
    // 检查更新
    const { needUpdate, forceUpdate } = checkNeedUpdate(APP_VERSION, config)
    if (needUpdate) {
      updateInfo.value = {
        needUpdate,
        forceUpdate,
        latestVersion: config.version,
        updateUrl: config.updateUrl
      }
    }
    
    // 获取有效公告
    remoteAnnouncements.value = getActiveAnnouncements(config)
    
    // 将远程公告添加到滚动公告
    if (remoteAnnouncements.value.length > 0) {
      const remoteNoticeTexts = remoteAnnouncements.value.map(a => `【${a.title}】${a.content.split('\n')[0]}`)
      notices.value = [...remoteNoticeTexts, ...defaultNotices]
    }
  } catch (err) {
    console.warn('加载远程配置失败:', err)
  }
}

// [WHAT] 打开公告详情
function openAnnouncement(announcement: Announcement) {
  currentAnnouncement.value = announcement
  showAnnouncementPopup.value = true
}

// [WHAT] 关闭公告并标记已读
function closeAnnouncement() {
  if (currentAnnouncement.value) {
    markAnnouncementShown(currentAnnouncement.value.id)
    // 从列表移除
    remoteAnnouncements.value = remoteAnnouncements.value.filter(
      a => a.id !== currentAnnouncement.value?.id
    )
  }
  showAnnouncementPopup.value = false
  currentAnnouncement.value = null
}

// [WHAT] 跳转更新
function goToUpdate() {
  if (updateInfo.value?.updateUrl) {
    window.open(updateInfo.value.updateUrl, '_blank')
  }
}

// [WHAT] 加载大盘指数
async function loadIndices() {
  try {
    indices.value = await fetchMarketIndicesFast()
  } catch {
    // 静默失败
  }
}

// [WHAT] 加载财经资讯
async function loadNews() {
  newsLoading.value = true
  try {
    newsList.value = await fetchFinanceNews(6)
  } catch {
    // 静默失败
  } finally {
    newsLoading.value = false
  }
}

// [WHAT] 监听数据变化，检查提醒条件
watch(
  () => fundStore.watchlist,
  (watchlist) => {
    for (const fund of watchlist) {
      if (fund.estimateValue && fund.estimateChange) {
        const value = parseFloat(fund.estimateValue)
        const change = parseFloat(fund.estimateChange)
        if (!isNaN(value) && !isNaN(change)) {
          alertStore.checkAlerts(fund.code, value, change)
        }
      }
    }
  },
  { deep: true }
)

// [WHAT] 下拉刷新处理
async function onRefresh() {
  await Promise.all([
    fundStore.refreshEstimates(),
    loadIndices(),
    loadNews()
  ])
  showToast('刷新成功')
}

// [WHAT] 删除自选基金
async function handleDelete(code: string) {
  try {
    await showConfirmDialog({
      title: '确认删除',
      message: '确定要从自选中删除该基金吗？'
    })
    fundStore.removeFund(code)
    showToast('已删除')
  } catch {
    // 用户取消
  }
}

// [WHAT] 跳转到搜索页
function goToSearch() {
  router.push('/search')
}

// [WHAT] 打开资讯详情
function openNews(news: NewsItem) {
  currentNews.value = news
  showNewsDetail.value = true
}

// [WHAT] 跳转到外部链接
function openNewsUrl() {
  if (currentNews.value?.url) {
    window.open(currentNews.value.url, '_blank')
  } else {
    showToast('暂无详情链接')
  }
}

// [WHAT] 跳转到基金详情页
function goToDetail(code: string) {
  router.push(`/detail/${code}`)
}

// ========== 提醒设置弹窗 ==========
const showAlertDialog = ref(false)
const alertFund = ref<{ code: string; name: string } | null>(null)
const alertForm = ref({
  type: 'change_up' as AlertType,
  threshold: ''
})

const alertTypes = Object.entries(ALERT_TYPE_CONFIG).map(([key, config]) => ({
  value: key,
  label: config.label
}))

// [WHAT] 长按打开提醒设置
function onFundLongPress(code: string, name: string) {
  alertFund.value = { code, name }
  alertForm.value = { type: 'change_up', threshold: '' }
  showAlertDialog.value = true
}

// [WHAT] 提交提醒设置
function submitAlert() {
  if (!alertFund.value) return
  const threshold = parseFloat(alertForm.value.threshold)
  if (isNaN(threshold) || threshold <= 0) {
    showToast('请输入有效的阈值')
    return
  }

  alertStore.addAlert({
    code: alertFund.value.code,
    name: alertFund.value.name,
    type: alertForm.value.type,
    threshold,
    enabled: true
  })
  
  showToast('提醒已设置')
  showAlertDialog.value = false
}
</script>

<template>
  <div class="home-page">
    <!-- 顶部搜索栏 -->
    <div class="top-header">
      <div class="header-left">
        <span class="app-title">基金宝</span>
      </div>
      <div class="search-bar" @click="goToSearch">
        <van-icon name="search" size="16" />
        <span>搜索基金代码/名称</span>
      </div>
      <div class="header-right">
        <van-icon name="setting-o" size="22" @click="router.push('/alerts')" />
      </div>
    </div>
    
    <!-- 公告栏 -->
    <div class="notice-bar">
      <van-icon name="volume-o" class="notice-icon" />
      <van-swipe 
        class="notice-swipe" 
        vertical 
        :autoplay="3000" 
        :show-indicators="false"
        :touchable="false"
      >
        <van-swipe-item v-for="(notice, idx) in notices" :key="idx">
          {{ notice }}
        </van-swipe-item>
      </van-swipe>
    </div>
    
    <!-- 强制更新遮罩 -->
    <van-overlay :show="updateInfo?.forceUpdate" z-index="9999" class="force-update-overlay">
      <div class="force-update-content">
        <van-icon name="info-o" size="48" color="#ee0a24" />
        <h3>发现新版本 v{{ updateInfo?.latestVersion }}</h3>
        <p>当前版本过低，请更新后继续使用</p>
        <van-button type="danger" block @click="goToUpdate">
          立即更新
        </van-button>
      </div>
    </van-overlay>
    
    <!-- 更新提示卡片（普通更新） -->
    <div v-if="updateInfo?.needUpdate && !updateInfo?.forceUpdate" class="update-card">
      <div class="update-info">
        <van-icon name="upgrade" size="20" color="#1989fa" />
        <span>发现新版本 v{{ updateInfo.latestVersion }}</span>
      </div>
      <van-button size="small" type="primary" plain @click="goToUpdate">
        立即更新
      </van-button>
      <van-icon name="cross" class="close-btn" @click="updateInfo = null" />
    </div>
    
    <!-- 远程公告卡片 -->
    <div v-if="remoteAnnouncements.length > 0" class="announcement-cards">
      <div 
        v-for="announcement in remoteAnnouncements" 
        :key="announcement.id"
        class="announcement-card"
        :class="announcement.type"
        @click="openAnnouncement(announcement)"
      >
        <van-icon 
          :name="announcement.type === 'update' ? 'upgrade' : announcement.type === 'warning' ? 'warning-o' : 'info-o'" 
          size="18"
        />
        <span class="announcement-title">{{ announcement.title }}</span>
        <van-icon name="arrow" size="14" />
      </div>
    </div>

    <!-- 下拉刷新列表 -->
    <van-pull-refresh 
      v-model="fundStore.isRefreshing" 
      @refresh="onRefresh"
      class="fund-list-container"
    >
      <!-- 大盘指数概览 -->
      <div class="market-overview" v-if="indices.length > 0">
        <div class="overview-title">
          <span>大盘指数</span>
          <span class="view-more" @click="router.push('/market')">更多 ></span>
        </div>
        <div class="index-grid">
          <div 
            v-for="index in indices" 
            :key="index.code" 
            class="index-item"
            :class="index.change >= 0 ? 'up' : 'down'"
          >
            <div class="index-name">{{ index.name }}</div>
            <div class="index-value">{{ index.current.toFixed(2) }}</div>
            <div class="index-change">
              {{ index.change >= 0 ? '+' : '' }}{{ index.change.toFixed(2) }}%
            </div>
          </div>
        </div>
      </div>
      
      <!-- 快捷入口 -->
      <div class="quick-actions">
        <div class="action-item" @click="router.push('/search')">
          <div class="action-icon">
            <van-icon name="search" size="22" />
          </div>
          <span>搜索</span>
        </div>
        <div class="action-item" @click="router.push('/compare')">
          <div class="action-icon">
            <van-icon name="balance-o" size="22" />
          </div>
          <span>对比</span>
        </div>
        <div class="action-item" @click="router.push('/calculator')">
          <div class="action-icon">
            <van-icon name="gold-coin-o" size="22" />
          </div>
          <span>定投</span>
        </div>
        <div class="action-item" @click="router.push('/manager-rank')">
          <div class="action-icon">
            <van-icon name="friends-o" size="22" />
          </div>
          <span>经理</span>
        </div>
        <div class="action-item" @click="router.push('/backtest')">
          <div class="action-icon">
            <van-icon name="chart-trending-o" size="22" />
          </div>
          <span>回测</span>
        </div>
        <div class="action-item" @click="router.push('/report')">
          <div class="action-icon">
            <van-icon name="description-o" size="22" />
          </div>
          <span>报告</span>
        </div>
        <div class="action-item" @click="router.push('/calendar')">
          <div class="action-icon">
            <van-icon name="calendar-o" size="22" />
          </div>
          <span>日历</span>
        </div>
        <div class="action-item" @click="router.push('/alerts')">
          <div class="action-icon">
            <van-icon name="bell" size="22" />
          </div>
          <span>提醒</span>
        </div>
      </div>
      
      <!-- 财经资讯 -->
      <div class="news-section">
        <div class="section-header">
          <span class="section-title">财经资讯</span>
          <span class="view-more">更多 ></span>
        </div>
        <div class="news-list" v-if="!newsLoading && newsList.length > 0">
          <div 
            v-for="news in newsList" 
            :key="news.id" 
            class="news-item"
            @click="openNews(news)"
          >
            <div class="news-content">
              <div class="news-title">{{ news.title }}</div>
              <div class="news-meta">
                <span class="news-source">{{ news.source }}</span>
                <span class="news-time">{{ news.time }}</span>
              </div>
            </div>
          </div>
        </div>
        <van-loading v-else-if="newsLoading" class="news-loading" />
      </div>
      
      <!-- 自选基金标题 -->
      <div class="section-header" v-if="fundStore.watchlist.length > 0">
        <span class="section-title">自选基金</span>
        <span class="fund-count">{{ fundStore.watchlist.length }}只</span>
      </div>
      
      <!-- 有自选基金时显示列表 -->
      <template v-if="fundStore.watchlist.length > 0">
        <!-- 刷新时间提示 -->
        <div v-if="fundStore.lastRefreshTime" class="refresh-time">
          <span>最后刷新: {{ fundStore.lastRefreshTime }}</span>
          <span v-if="alertStore.enabledAlerts.length > 0" class="alert-badge">
            {{ alertStore.enabledAlerts.length }}个提醒
          </span>
        </div>
        
        <!-- 基金列表 -->
        <FundCard
          v-for="fund in fundStore.watchlist"
          :key="fund.code"
          :fund="fund"
          @delete="handleDelete"
          @click="goToDetail"
          @longpress="onFundLongPress(fund.code, fund.name)"
        />
      </template>

      <!-- 空状态 -->
      <van-empty
        v-else
        image="search"
        description="暂无自选基金"
      >
        <van-button round type="primary" @click="goToSearch">
          添加基金
        </van-button>
      </van-empty>
      
      <!-- 底部占位 -->
      <div class="bottom-spacer"></div>
    </van-pull-refresh>

    <!-- 提醒设置弹窗 -->
    <van-popup v-model:show="showAlertDialog" position="bottom" round>
      <div class="alert-dialog">
        <div class="dialog-header">
          <span>设置提醒</span>
          <van-icon name="cross" @click="showAlertDialog = false" />
        </div>
        <div class="dialog-fund">{{ alertFund?.name }}</div>
        
        <van-field label="提醒类型">
          <template #input>
            <van-radio-group v-model="alertForm.type" direction="horizontal">
              <van-radio v-for="t in alertTypes" :key="t.value" :name="t.value">
                {{ t.label }}
              </van-radio>
            </van-radio-group>
          </template>
        </van-field>
        
        <van-field
          v-model="alertForm.threshold"
          :label="alertForm.type.includes('change') ? '阈值(%)' : '目标净值'"
          type="number"
          :placeholder="alertForm.type.includes('change') ? '例如: 3' : '例如: 1.5000'"
        />
        
        <div class="dialog-footer">
          <van-button block type="primary" @click="submitAlert">确认设置</van-button>
        </div>
      </div>
    </van-popup>
    
    <!-- 资讯详情弹窗 -->
    <van-popup 
      v-model:show="showNewsDetail" 
      position="bottom" 
      round
      :style="{ height: '70%' }"
    >
      <div class="news-detail" v-if="currentNews">
        <div class="news-detail-header">
          <span>资讯详情</span>
          <van-icon name="cross" @click="showNewsDetail = false" />
        </div>
        <div class="news-detail-content">
          <h3 class="news-detail-title">{{ currentNews.title }}</h3>
          <div class="news-detail-meta">
            <span>{{ currentNews.source }}</span>
            <span>{{ currentNews.time }}</span>
          </div>
          <div class="news-detail-summary">
            {{ currentNews.summary || '暂无摘要内容' }}
          </div>
        </div>
        <div class="news-detail-footer" v-if="currentNews.url">
          <van-button block type="primary" @click="openNewsUrl">
            查看原文
          </van-button>
        </div>
        <div class="news-detail-footer" v-else>
          <van-button block plain @click="showNewsDetail = false">
            知道了
          </van-button>
        </div>
      </div>
    </van-popup>
    
    <!-- 公告详情弹窗 -->
    <van-popup
      v-model:show="showAnnouncementPopup"
      round
      position="center"
      :style="{ width: '85%', maxWidth: '400px' }"
    >
      <div class="announcement-detail" v-if="currentAnnouncement">
        <div class="announcement-detail-header" :class="currentAnnouncement.type">
          <van-icon 
            :name="currentAnnouncement.type === 'update' ? 'upgrade' : currentAnnouncement.type === 'warning' ? 'warning-o' : 'info-o'" 
            size="24"
          />
          <h3>{{ currentAnnouncement.title }}</h3>
        </div>
        <div class="announcement-detail-content">
          <p v-for="(line, idx) in currentAnnouncement.content.split('\n')" :key="idx">
            {{ line }}
          </p>
        </div>
        <div class="announcement-detail-footer">
          <van-button 
            v-if="currentAnnouncement.type === 'update'" 
            block 
            type="primary" 
            @click="goToUpdate(); closeAnnouncement()"
          >
            立即更新
          </van-button>
          <van-button block plain @click="closeAnnouncement">
            {{ currentAnnouncement.type === 'update' ? '稍后再说' : '知道了' }}
          </van-button>
        </div>
      </div>
    </van-popup>
  </div>
</template>

<style scoped>
.home-page {
  min-height: 100vh;
  background: var(--bg-primary);
  transition: background-color 0.3s;
}

/* 顶部搜索栏 */
.top-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: var(--bg-secondary);
  position: sticky;
  top: 0;
  z-index: 100;
}

.header-left {
  flex-shrink: 0;
}

.app-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--color-primary);
}

.search-bar {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--bg-primary);
  border-radius: 20px;
  color: var(--text-secondary);
  font-size: 14px;
  cursor: pointer;
}

.header-right {
  flex-shrink: 0;
  color: var(--text-primary);
}

/* 公告栏 */
.notice-bar {
  display: flex;
  align-items: center;
  padding: 8px 16px;
  background: var(--bg-secondary);
  font-size: 13px;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border-color);
}

.notice-icon {
  color: var(--text-secondary);
  margin-right: 8px;
  flex-shrink: 0;
}

.notice-swipe {
  flex: 1;
  height: 20px;
  line-height: 20px;
}

.fund-list-container {
  /* [WHY] 固定高度才能让滚动和下拉刷新正常工作 */
  height: calc(100vh - 130px);
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  /* [WHY] 下拉刷新需要这个属性 */
  overscroll-behavior-y: contain;
}

/* 大盘指数概览 */
.market-overview {
  padding: 12px;
  background: var(--bg-secondary);
  margin: 8px 12px;
  border-radius: 12px;
}

.overview-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}

.view-more {
  font-size: 12px;
  font-weight: 400;
  color: var(--text-secondary);
}

.index-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}

.index-item {
  text-align: center;
  padding: 8px 4px;
  background: var(--bg-primary);
  border-radius: 8px;
}

.index-name {
  font-size: 11px;
  color: var(--text-secondary);
  margin-bottom: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.index-value {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 2px;
}

.index-change {
  font-size: 12px;
}

.index-item.up .index-value,
.index-item.up .index-change {
  color: var(--color-up);
}

.index-item.down .index-value,
.index-item.down .index-change {
  color: var(--color-down);
}

/* 快捷入口 */
.quick-actions {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  padding: 12px;
  margin: 0 12px 8px;
  background: var(--bg-secondary);
  border-radius: 12px;
}

.action-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 10px 4px;
  cursor: pointer;
  border-radius: 8px;
  transition: background 0.2s;
}

.action-item:active {
  background: var(--bg-primary);
}

.action-icon {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-primary);
  border-radius: 10px;
  color: var(--color-primary);
}

.action-item span {
  font-size: 12px;
  color: var(--text-secondary);
}

/* 自选基金标题 */
.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px 8px;
}

.section-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.fund-count {
  font-size: 12px;
  color: var(--text-secondary);
}

/* 财经资讯 */
.news-section {
  margin: 0 12px 12px;
  background: var(--bg-secondary);
  border-radius: 12px;
  overflow: hidden;
}

.news-section .section-header {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color);
}

.news-list {
  padding: 0;
}

.news-item {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color);
  cursor: pointer;
  transition: background 0.2s;
}

.news-item:last-child {
  border-bottom: none;
}

.news-item:active {
  background: var(--bg-primary);
}

.news-content {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.news-title {
  font-size: 14px;
  color: var(--text-primary);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.news-meta {
  display: flex;
  gap: 12px;
  font-size: 12px;
  color: var(--text-secondary);
}

.news-source {
  color: var(--color-primary);
}

.news-loading {
  padding: 24px;
  display: flex;
  justify-content: center;
}

/* 底部占位 */
.bottom-spacer {
  height: calc(60px + env(safe-area-inset-bottom, 0px));
}

.refresh-time {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  color: var(--text-secondary);
  padding: 8px 0;
  background: var(--bg-primary);
}

.alert-badge {
  padding: 2px 8px;
  background: var(--color-primary);
  color: #fff;
  border-radius: 10px;
  font-size: 10px;
}

/* 提醒设置弹窗 */
.alert-dialog {
  padding: 16px;
  background: var(--bg-secondary);
}

.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 16px;
  font-weight: 500;
  margin-bottom: 12px;
  color: var(--text-primary);
}

.dialog-fund {
  font-size: 14px;
  color: var(--text-secondary);
  padding: 12px 0;
  border-bottom: 1px solid var(--border-color);
  margin-bottom: 12px;
}

.dialog-footer {
  padding-top: 16px;
}

/* 资讯详情弹窗 */
.news-detail {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg-secondary);
}

.news-detail-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.news-detail-content {
  flex: 1;
  padding: 16px;
  overflow-y: auto;
}

.news-detail-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.5;
  margin: 0 0 12px;
}

.news-detail-meta {
  display: flex;
  gap: 16px;
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 16px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border-color);
}

.news-detail-summary {
  font-size: 15px;
  line-height: 1.8;
  color: var(--text-primary);
}

.news-detail-footer {
  padding: 16px;
  border-top: 1px solid var(--border-color);
  flex-shrink: 0;
}

/* ========== 更新提示 ========== */
.force-update-overlay {
  display: flex;
  align-items: center;
  justify-content: center;
}

.force-update-content {
  background: var(--bg-card);
  padding: 32px 24px;
  border-radius: 16px;
  text-align: center;
  width: 80%;
  max-width: 320px;
}

.force-update-content h3 {
  margin: 16px 0 8px;
  font-size: 18px;
  color: var(--text-primary);
}

.force-update-content p {
  margin: 0 0 24px;
  font-size: 14px;
  color: var(--text-secondary);
}

.update-card {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 8px 12px;
  padding: 12px 16px;
  background: linear-gradient(135deg, rgba(25, 137, 250, 0.1), rgba(25, 137, 250, 0.05));
  border: 1px solid rgba(25, 137, 250, 0.2);
  border-radius: 12px;
  position: relative;
}

.update-info {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: var(--text-primary);
}

.update-card .close-btn {
  position: absolute;
  top: 8px;
  right: 8px;
  font-size: 14px;
  color: var(--text-secondary);
  cursor: pointer;
}

/* ========== 公告卡片 ========== */
.announcement-cards {
  padding: 8px 12px 0;
}

.announcement-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  margin-bottom: 8px;
  background: var(--bg-card);
  border-radius: 10px;
  cursor: pointer;
  transition: transform 0.2s;
}

.announcement-card:active {
  transform: scale(0.98);
}

.announcement-card.info {
  border-left: 3px solid #1989fa;
}

.announcement-card.info .van-icon {
  color: #1989fa;
}

.announcement-card.warning {
  border-left: 3px solid #ff976a;
}

.announcement-card.warning .van-icon {
  color: #ff976a;
}

.announcement-card.update {
  border-left: 3px solid #07c160;
}

.announcement-card.update .van-icon {
  color: #07c160;
}

.announcement-title {
  flex: 1;
  font-size: 14px;
  color: var(--text-primary);
}

.announcement-card .van-icon:last-child {
  color: var(--text-secondary);
}

/* ========== 公告详情弹窗 ========== */
.announcement-detail {
  background: var(--bg-card);
}

.announcement-detail-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 20px;
  border-bottom: 1px solid var(--border-color);
}

.announcement-detail-header.info {
  color: #1989fa;
}

.announcement-detail-header.warning {
  color: #ff976a;
}

.announcement-detail-header.update {
  color: #07c160;
}

.announcement-detail-header h3 {
  flex: 1;
  margin: 0;
  font-size: 17px;
  color: var(--text-primary);
}

.announcement-detail-content {
  padding: 20px;
  max-height: 300px;
  overflow-y: auto;
}

.announcement-detail-content p {
  margin: 0 0 8px;
  font-size: 15px;
  line-height: 1.6;
  color: var(--text-primary);
}

.announcement-detail-content p:last-child {
  margin-bottom: 0;
}

.announcement-detail-footer {
  padding: 16px 20px 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
</style>
