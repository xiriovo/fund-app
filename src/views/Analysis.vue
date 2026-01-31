<script setup lang="ts">
// [WHY] 分析页 - 展示资产配置和收益分析
// [WHAT] 显示持仓分布饼图、收益统计、交易汇总、主题设置

import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useHoldingStore } from '@/stores/holding'
import { useTradeStore } from '@/stores/trade'
import { useThemeStore } from '@/stores/theme'
import { formatMoney, formatPercent, getChangeStatus } from '@/utils/format'
import { showToast } from 'vant'

const router = useRouter()
const holdingStore = useHoldingStore()
const tradeStore = useTradeStore()
const themeStore = useThemeStore()

// [WHAT] 下拉刷新状态
const isRefreshing = ref(false)

// [WHAT] 初始化数据
onMounted(() => {
  holdingStore.initHoldings()
})

// [WHAT] 下拉刷新
async function onRefresh() {
  isRefreshing.value = true
  try {
    await holdingStore.refreshEstimates()
    showToast('刷新成功')
  } finally {
    isRefreshing.value = false
  }
}

// ========== 资产配置分析 ==========

// [WHAT] 计算各基金占比
const assetAllocation = computed(() => {
  const total = holdingStore.summary.totalValue
  if (total <= 0) return []
  
  return holdingStore.holdings
    .filter(h => h.marketValue && h.marketValue > 0)
    .map(h => ({
      code: h.code,
      name: h.name,
      value: h.marketValue || 0,
      ratio: ((h.marketValue || 0) / total) * 100
    }))
    .sort((a, b) => b.value - a.value)
})

// [WHAT] 饼图颜色
const pieColors = ['#1989fa', '#07c160', '#ff976a', '#ee0a24', '#7232dd', '#1cbbb4', '#f2826a', '#9191ff']

// [WHAT] 计算饼图扇形路径
function getPieSlice(startAngle: number, endAngle: number, index: number) {
  const cx = 100
  const cy = 100
  const r = 80
  
  const startRad = (startAngle - 90) * Math.PI / 180
  const endRad = (endAngle - 90) * Math.PI / 180
  
  const x1 = cx + r * Math.cos(startRad)
  const y1 = cy + r * Math.sin(startRad)
  const x2 = cx + r * Math.cos(endRad)
  const y2 = cy + r * Math.sin(endRad)
  
  const largeArc = endAngle - startAngle > 180 ? 1 : 0
  
  return {
    path: `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`,
    color: pieColors[index % pieColors.length] || '#999'
  }
}

// [WHAT] 生成饼图数据
const pieSlices = computed(() => {
  const slices: { path: string; color: string; name: string; ratio: number }[] = []
  let currentAngle = 0
  
  assetAllocation.value.forEach((item, index) => {
    const angle = (item.ratio / 100) * 360
    const slice = getPieSlice(currentAngle, currentAngle + angle, index)
    slices.push({
      ...slice,
      name: item.name,
      ratio: item.ratio
    })
    currentAngle += angle
  })
  
  return slices
})

// ========== 收益分析 ==========

// [WHAT] 收益率状态
const profitStatus = computed(() => getChangeStatus(holdingStore.summary.totalProfit))
const todayStatus = computed(() => getChangeStatus(holdingStore.summary.todayProfit))

// ========== 交易统计 ==========

const tradeStats = computed(() => tradeStore.statistics)

// [WHAT] 跳转到交易记录
function goToTrades() {
  router.push('/trades')
}
</script>

<template>
  <div class="analysis-page">
    <!-- 顶部导航 -->
    <van-nav-bar title="数据分析">
      <template #right>
        <van-icon name="replay" size="18" @click="onRefresh" />
      </template>
    </van-nav-bar>

    <van-pull-refresh v-model="isRefreshing" @refresh="onRefresh" class="analysis-content">
    <!-- 总资产卡片 -->
    <div class="summary-card">
      <div class="summary-header">
        <span class="label">总资产</span>
        <span class="value">{{ formatMoney(holdingStore.summary.totalValue, '¥') }}</span>
      </div>
      <div class="summary-grid">
        <div class="summary-item">
          <span class="item-label">持仓盈亏</span>
          <span class="item-value" :class="profitStatus">
            {{ holdingStore.summary.totalProfit >= 0 ? '+' : '' }}{{ formatMoney(holdingStore.summary.totalProfit) }}
          </span>
        </div>
        <div class="summary-item">
          <span class="item-label">收益率</span>
          <span class="item-value" :class="profitStatus">
            {{ formatPercent(holdingStore.summary.totalProfitRate) }}
          </span>
        </div>
        <div class="summary-item">
          <span class="item-label">今日收益</span>
          <span class="item-value" :class="todayStatus">
            {{ holdingStore.summary.todayProfit >= 0 ? '+' : '' }}{{ formatMoney(holdingStore.summary.todayProfit) }}
          </span>
        </div>
        <div class="summary-item">
          <span class="item-label">持仓成本</span>
          <span class="item-value">{{ formatMoney(holdingStore.summary.totalCost) }}</span>
        </div>
      </div>
    </div>

    <!-- 资产配置 -->
    <div class="section">
      <div class="section-header">
        <span class="section-title">资产配置</span>
      </div>
      
      <div v-if="assetAllocation.length > 0" class="allocation-content">
        <!-- 饼图 -->
        <div class="pie-chart">
          <svg viewBox="0 0 200 200">
            <path
              v-for="(slice, index) in pieSlices"
              :key="index"
              :d="slice.path"
              :fill="slice.color"
            />
            <!-- 中心空白圆 - 适配主题 -->
            <circle cx="100" cy="100" r="50" :fill="themeStore.actualTheme === 'dark' ? '#1a1a2e' : 'white'" />
            <!-- 中心文字 - 适配主题 -->
            <text x="100" y="95" text-anchor="middle" :fill="themeStore.actualTheme === 'dark' ? '#eee' : '#333'" font-size="12">持仓</text>
            <text x="100" y="115" text-anchor="middle" :fill="themeStore.actualTheme === 'dark' ? '#fff' : '#333'" font-size="14" font-weight="bold">
              {{ assetAllocation.length }}只
            </text>
          </svg>
        </div>
        
        <!-- 配置列表 -->
        <div class="allocation-list">
          <div 
            v-for="(item, index) in assetAllocation" 
            :key="item.code"
            class="allocation-item"
          >
            <div class="item-color" :style="{ background: pieColors[index % pieColors.length] }"></div>
            <div class="item-info">
              <span class="item-name">{{ item.name }}</span>
              <span class="item-ratio">{{ item.ratio.toFixed(1) }}%</span>
            </div>
            <div class="item-value">{{ formatMoney(item.value, '¥') }}</div>
          </div>
        </div>
      </div>
      
      <van-empty v-else description="暂无持仓数据" />
    </div>

    <!-- 交易统计 -->
    <div class="section">
      <div class="section-header">
        <span class="section-title">交易统计</span>
        <span class="section-action" @click="goToTrades">查看记录 ></span>
      </div>
      
      <div class="trade-stats">
        <div class="trade-stat-item">
          <div class="stat-icon buy">买</div>
          <div class="stat-info">
            <span class="stat-label">累计买入</span>
            <span class="stat-value">{{ formatMoney(tradeStats.totalBuy) }}</span>
          </div>
        </div>
        <div class="trade-stat-item">
          <div class="stat-icon sell">卖</div>
          <div class="stat-info">
            <span class="stat-label">累计卖出</span>
            <span class="stat-value">{{ formatMoney(tradeStats.totalSell) }}</span>
          </div>
        </div>
        <div class="trade-stat-item">
          <div class="stat-icon dividend">分</div>
          <div class="stat-info">
            <span class="stat-label">累计分红</span>
            <span class="stat-value">{{ formatMoney(tradeStats.totalDividend) }}</span>
          </div>
        </div>
        <div class="trade-stat-item">
          <div class="stat-icon fee">费</div>
          <div class="stat-info">
            <span class="stat-label">累计手续费</span>
            <span class="stat-value">{{ formatMoney(tradeStats.totalFee) }}</span>
          </div>
        </div>
      </div>
      
      <div class="net-invest">
        <span>净投入</span>
        <span class="net-value">{{ formatMoney(tradeStats.netInvest, '¥') }}</span>
      </div>
    </div>

    <!-- 实用工具 -->
    <div class="section">
      <div class="section-header">
        <span class="section-title">实用工具</span>
      </div>
      
      <div class="tools-grid">
        <div class="tool-item" @click="router.push('/compare')">
          <van-icon name="chart-trending-o" size="24" />
          <span>基金对比</span>
        </div>
        <div class="tool-item" @click="router.push('/calculator')">
          <van-icon name="calculator-o" size="24" />
          <span>定投计算</span>
        </div>
        <div class="tool-item" @click="router.push('/backtest')">
          <van-icon name="replay" size="24" />
          <span>回测模拟</span>
        </div>
        <div class="tool-item" @click="router.push('/filter')">
          <van-icon name="filter-o" size="24" />
          <span>基金筛选</span>
        </div>
        <div class="tool-item" @click="router.push('/trades')">
          <van-icon name="orders-o" size="24" />
          <span>交易记录</span>
        </div>
        <div class="tool-item" @click="router.push('/alerts')">
          <van-icon name="bell-o" size="24" />
          <span>智能提醒</span>
        </div>
        <div class="tool-item" @click="router.push('/report')">
          <van-icon name="description-o" size="24" />
          <span>收益报告</span>
        </div>
        <div class="tool-item" @click="router.push('/calendar')">
          <van-icon name="calendar-o" size="24" />
          <span>投资日历</span>
        </div>
        <div class="tool-item" @click="router.push('/manager-rank')">
          <van-icon name="manager-o" size="24" />
          <span>经理排行</span>
        </div>
      </div>
    </div>

    <!-- 设置区域 -->
    <div class="section">
      <div class="section-header">
        <span class="section-title">设置</span>
      </div>
      
      <van-cell-group :border="false">
        <van-cell title="深色模式" center>
          <template #right-icon>
            <van-switch 
              :model-value="themeStore.actualTheme === 'dark'"
              @update:model-value="themeStore.toggleTheme()"
              size="20px"
            />
          </template>
        </van-cell>
        <van-cell title="跟随系统" center>
          <template #right-icon>
            <van-switch 
              :model-value="themeStore.mode === 'auto'"
              @update:model-value="(v: boolean) => themeStore.setTheme(v ? 'auto' : themeStore.actualTheme)"
              size="20px"
            />
          </template>
        </van-cell>
      </van-cell-group>
    </div>

    <!-- 投资提示 -->
    <div class="tips-section">
      <van-notice-bar 
        left-icon="volume-o"
        text="投资有风险，数据仅供参考。基金过往业绩不代表未来表现。"
      />
    </div>
    </van-pull-refresh>
  </div>
</template>

<style scoped>
.analysis-page {
  min-height: 100vh;
  background: var(--bg-primary);
  padding-bottom: 60px;
  transition: background-color 0.3s;
}

.analysis-content {
  /* [WHY] 固定高度才能让滚动和下拉刷新正常工作 */
  height: calc(100vh - 46px);
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior-y: contain;
}

/* 总资产卡片 */
.summary-card {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  margin: 12px;
  padding: 20px;
  border-radius: 12px;
  color: #fff;
}

.summary-header {
  text-align: center;
  margin-bottom: 20px;
}

.summary-header .label {
  display: block;
  font-size: 14px;
  opacity: 0.8;
  margin-bottom: 8px;
}

.summary-header .value {
  font-size: 32px;
  font-weight: 600;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
}

.summary-item {
  text-align: center;
}

.item-label {
  display: block;
  font-size: 12px;
  opacity: 0.8;
  margin-bottom: 4px;
}

.item-value {
  font-size: 16px;
  font-weight: 500;
}

/* [WHY] 紫色背景上使用高对比度涨跌色 */
.item-value.up { color: #ff6b6b; }  /* 红涨 - 更鲜艳 */
.item-value.down { color: #51cf66; }  /* 绿跌 - 更鲜艳 */

/* 区块样式 */
.section {
  background: var(--bg-secondary);
  margin: 12px;
  border-radius: 12px;
  overflow: hidden;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  border-bottom: 1px solid var(--border-color);
}

.section-title {
  font-size: 16px;
  font-weight: 500;
  color: var(--text-primary);
}

.section-action {
  font-size: 13px;
  color: var(--color-primary);
}

/* 资产配置 */
.allocation-content {
  padding: 16px;
}

.pie-chart {
  width: 160px;
  height: 160px;
  margin: 0 auto 20px;
}

.pie-chart svg {
  width: 100%;
  height: 100%;
}

.allocation-list {
  flex: 1;
  min-width: 0;
}

.allocation-item {
  display: flex;
  align-items: center;
  padding: 10px 0;
  border-bottom: 1px solid var(--border-color);
}

.allocation-item:last-child {
  border-bottom: none;
}

.item-color {
  width: 12px;
  height: 12px;
  border-radius: 2px;
  margin-right: 12px;
}

.item-info {
  flex: 1;
  display: flex;
  justify-content: space-between;
  margin-right: 16px;
}

.item-name {
  font-size: 14px;
  color: var(--text-primary);
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-ratio {
  font-size: 13px;
  color: var(--text-secondary);
}

.allocation-item .item-value {
  font-size: 14px;
  color: var(--text-primary);
  font-weight: 500;
}

/* 交易统计 */
.trade-stats {
  padding: 16px;
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
}

.trade-stat-item {
  display: flex;
  align-items: center;
  gap: 12px;
}

.stat-icon {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  color: #fff;
}

.stat-icon.buy { background: var(--color-up); }
.stat-icon.sell { background: var(--color-down); }
.stat-icon.dividend { background: #ff9800; }
.stat-icon.fee { background: var(--text-muted); }

.stat-info {
  display: flex;
  flex-direction: column;
}

.stat-label {
  font-size: 12px;
  color: var(--text-secondary);
}

.stat-value {
  font-size: 15px;
  color: var(--text-primary);
  font-weight: 500;
}

.net-invest {
  display: flex;
  justify-content: space-between;
  padding: 16px;
  background: var(--bg-tertiary);
  font-size: 14px;
  color: var(--text-primary);
}

.net-value {
  font-weight: 600;
  color: var(--color-primary);
}

/* 提示 */
.tips-section {
  margin: 12px;
}

/* 工具网格 */
.tools-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  padding: 16px;
}

.tool-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 16px 8px;
  background: var(--bg-tertiary);
  border-radius: 8px;
  font-size: 12px;
  color: var(--text-primary);
  cursor: pointer;
  transition: opacity 0.2s;
}

.tool-item:active {
  opacity: 0.7;
}

.tool-item .van-icon {
  color: var(--color-primary);
}
</style>
