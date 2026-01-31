<script setup lang="ts">
// [WHY] 基金详情页 - 专业基金APP风格
// [WHAT] 蓝色顶部、持仓数据、分时图、关联板块、底部操作栏
// [REF] 参考蚂蚁基金/天天基金的专业设计

import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useFundStore } from '@/stores/fund'
import { useHoldingStore } from '@/stores/holding'
import { fetchStockHoldings, detectShareClass } from '@/api/fund'
import { fetchFundEstimateFast } from '@/api/fundFast'
import { 
  fetchPeriodReturnExt, fetchSimilarFunds, fetchSectorFunds, 
  fetchDividendRecords, fetchFundFees, fetchFundAnnouncements, fetchFundScale,
  calculateRedemptionFee,
  type PeriodReturnExt, type SimilarFund, type SectorInfo,
  type DividendRecord, type FundFeeInfo, type FundAnnouncement, type FundScale
} from '@/api/tiantianApi'
import type { FundEstimate, StockHolding, FundShareClass } from '@/types/fund'
import { showToast, showConfirmDialog } from 'vant'
import ProChart from '@/components/OKXChart.vue'

const route = useRoute()
const router = useRouter()
const fundStore = useFundStore()
const holdingStore = useHoldingStore()

// [WHAT] 基金代码
const fundCode = computed(() => route.params.code as string)

// 数据状态
const fundInfo = ref<FundEstimate | null>(null)
const stockHoldings = ref<StockHolding[]>([])
const periodReturns = ref<PeriodReturnExt[]>([])
const similarFunds = ref<SimilarFund[]>([])
const sectorInfo = ref<SectorInfo | null>(null)
const isLoading = ref(true)
const shareClass = ref<FundShareClass>('A')

// [WHAT] 核心功能数据
const dividendRecords = ref<DividendRecord[]>([])
const fundFees = ref<FundFeeInfo | null>(null)
const announcements = ref<FundAnnouncement[]>([])
const fundScale = ref<FundScale | null>(null)

// [WHAT] 实时刷新
let refreshTimer: ReturnType<typeof setInterval> | null = null

// [WHAT] Tab切换
const activeTab = ref<'chart' | 'performance' | 'profit'>('chart')

// [WHAT] 持仓面板展开状态
const holdingExpanded = ref(true)


// [WHAT] 持仓信息（如果已持有）
const holdingInfo = computed(() => {
  return holdingStore.holdings.find(h => h.code === fundCode.value) || null
})

// [WHAT] 持仓详细计算
const holdingDetails = computed(() => {
  const holding = holdingInfo.value
  if (!holding) return null
  
  const currentPrice = parseFloat(fundInfo.value?.gsz || fundInfo.value?.dwjz || '0')
  const shares = holding.shares || 0
  const buyNetValue = holding.buyNetValue || 0
  const amount = holding.amount || 0
  
  // 当前市值
  const currentValue = shares * currentPrice
  // 持有收益
  const profit = currentValue - amount
  // 收益率
  const profitRate = amount > 0 ? (profit / amount) * 100 : 0
  // 持仓占比（相对于总市值）
  const totalValue = holdingStore.summary.totalValue || 1
  const ratio = (currentValue / totalValue) * 100
  // 持有天数
  const buyDate = new Date(holding.buyDate || Date.now())
  const today = new Date()
  const holdDays = Math.floor((today.getTime() - buyDate.getTime()) / (1000 * 60 * 60 * 24))
  // 当日收益
  const changePercent = parseFloat(fundInfo.value?.gszzl || '0')
  const todayProfit = currentValue * (changePercent / 100)
  // 昨日收益（模拟）
  const yesterdayProfit = profit - todayProfit
  
  return {
    amount: currentValue,
    shares,
    ratio,
    profit,
    profitRate,
    cost: buyNetValue,
    todayProfit,
    yesterdayProfit,
    holdDays
  }
})

onMounted(async () => {
  holdingStore.initHoldings()
  await loadFundData()
  startAutoRefresh()
})

// [WHY] 监听路由参数变化
watch(fundCode, async (newCode, oldCode) => {
  if (newCode && newCode !== oldCode) {
    fundInfo.value = null
    stockHoldings.value = []
    periodReturns.value = []
    similarFunds.value = []
    dividendRecords.value = []
    fundFees.value = null
    announcements.value = []
    fundScale.value = null
    isLoading.value = true
    await loadFundData()
  }
})

onUnmounted(() => {
  stopAutoRefresh()
})

function startAutoRefresh() {
  refreshTimer = setInterval(async () => {
    const now = new Date()
    const hour = now.getHours()
    const minute = now.getMinutes()
    const day = now.getDay()
    
    if (day === 0 || day === 6) return
    if (hour < 9 || hour > 15) return
    if (hour === 9 && minute < 30) return
    
    await refreshEstimate()
  }, 3000)
}

function stopAutoRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer)
    refreshTimer = null
  }
}

async function refreshEstimate() {
  try {
    const estimate = await fetchFundEstimateFast(fundCode.value)
    if (estimate) {
      fundInfo.value = estimate
    }
  } catch {
    // 静默失败
  }
}

async function loadFundData() {
  isLoading.value = true
  
  try {
    const estimate = await fetchFundEstimateFast(fundCode.value).catch(() => null)
    
    if (estimate) {
      fundInfo.value = estimate
      shareClass.value = detectShareClass(fundCode.value, estimate.name)
    } else {
      const { searchFund } = await import('@/api/fund')
      const funds = await searchFund(fundCode.value, 1)
      if (funds.length > 0) {
        fundInfo.value = {
          fundcode: fundCode.value,
          name: funds[0]!.name,
          dwjz: '0',
          gsz: '0',
          gszzl: '0',
          gztime: '--'
        }
        shareClass.value = detectShareClass(fundCode.value, funds[0]!.name)
      } else {
        fundInfo.value = {
          fundcode: fundCode.value,
          name: `基金 ${fundCode.value}`,
          dwjz: '0',
          gsz: '0',
          gszzl: '0',
          gztime: '--'
        }
      }
    }
    
    // 后台加载其他数据
    fetchStockHoldings(fundCode.value).then(h => stockHoldings.value = h).catch(() => {})
    fetchPeriodReturnExt(fundCode.value).then(r => periodReturns.value = r).catch(() => {})
    fetchSimilarFunds(fundCode.value).then(f => similarFunds.value = f).catch(() => {})
    fetchSectorFunds().then(s => { if (s.length > 0) sectorInfo.value = s[0]! }).catch(() => {})
    
    // [WHAT] 加载核心功能数据：分红、费率、公告、规模
    fetchDividendRecords(fundCode.value).then(d => dividendRecords.value = d).catch(() => {})
    fetchFundFees(fundCode.value).then(f => fundFees.value = f).catch(() => {})
    fetchFundAnnouncements(fundCode.value).then(a => announcements.value = a).catch(() => {})
    fetchFundScale(fundCode.value).then(s => fundScale.value = s).catch(() => {})
      
  } catch {
    showToast('加载失败')
  } finally {
    isLoading.value = false
  }
}

// [WHAT] 计算涨跌
const priceChangePercent = computed(() => {
  return parseFloat(fundInfo.value?.gszzl || '0') || 0
})

const isUp = computed(() => priceChangePercent.value >= 0)

// [WHAT] 最佳可用周期收益（优先1年，其次6月、3月、1月）
const bestPeriodReturn = computed(() => {
  const priorities = ['1y', '6m', '3m', '1m']
  for (const period of priorities) {
    const item = periodReturns.value.find(p => p.period === period)
    if (item && item.fundReturn !== 0) {
      const labels: Record<string, string> = { '1y': '近1年', '6m': '近6月', '3m': '近3月', '1m': '近1月' }
      return { label: labels[period] || period, value: item.fundReturn }
    }
  }
  return { label: '近1年', value: 0 }
})


function goBack() {
  router.back()
}

// [WHAT] 切换到上一只/下一只基金
function goPrevFund() {
  const watchlist = fundStore.watchlist
  const idx = watchlist.findIndex(f => f.code === fundCode.value)
  if (idx > 0) {
    router.replace(`/detail/${watchlist[idx - 1]!.code}`)
  } else {
    showToast('已是第一只')
  }
}

function goNextFund() {
  const watchlist = fundStore.watchlist
  const idx = watchlist.findIndex(f => f.code === fundCode.value)
  if (idx >= 0 && idx < watchlist.length - 1) {
    router.replace(`/detail/${watchlist[idx + 1]!.code}`)
  } else {
    showToast('已是最后一只')
  }
}

function goToSearch() {
  router.push('/search')
}

// [WHAT] 底部操作
function editHolding() {
  // 跳转到持仓页编辑
  router.push('/holding')
}

function setReminder() {
  router.push('/alerts')
}

function showTransactions() {
  router.push(`/trades/${fundCode.value}`)
}

async function removeFromWatchlist() {
  if (!fundStore.isFundInWatchlist(fundCode.value)) {
    showToast('不在自选中')
    return
  }
  
  try {
    await showConfirmDialog({
      title: '删除自选',
      message: `确定将 ${fundInfo.value?.name || '该基金'} 从自选中删除？`
    })
    await fundStore.removeFund(fundCode.value)
    showToast('已删除')
  } catch {
    // 取消
  }
}

async function addToWatchlist() {
  if (fundStore.isFundInWatchlist(fundCode.value)) {
    showToast('已在自选中')
    return
  }
  await fundStore.addFund(fundCode.value, fundInfo.value?.name || '')
  showToast('添加成功')
}

function showMore() {
  showToast('更多功能开发中')
}

// [WHAT] 跳转同类基金
function goToSimilarFund(code: string) {
  if (code === fundCode.value) {
    showToast('已在当前基金')
    return
  }
  router.push(`/detail/${code}`)
}

// [WHAT] 搜索同类基金
function searchSimilarFunds() {
  if (sectorInfo.value) {
    router.push(`/search?q=${encodeURIComponent(sectorInfo.value.name)}`)
  }
}

// [WHAT] 计算预估赎回费
const estimatedRedemptionFee = computed(() => {
  if (!fundFees.value || !holdingDetails.value) return null
  
  const days = holdingDetails.value.holdDays
  const amount = holdingDetails.value.amount
  const result = calculateRedemptionFee(days, amount, fundFees.value.redemptionFees)
  
  return result
})

// [WHAT] 分红累计金额
const totalDividend = computed(() => {
  return dividendRecords.value.reduce((sum, r) => sum + r.amount, 0)
})

// [WHAT] 打开公告链接
function openAnnouncement(url: string) {
  if (url) {
    window.open(url, '_blank')
  } else {
    showToast('暂无详情链接')
  }
}

// [WHAT] 格式化数字
function formatNum(num: number, decimals = 2): string {
  if (Math.abs(num) >= 10000) {
    return (num / 10000).toFixed(2) + '万'
  }
  return num.toFixed(decimals)
}

function formatPercent(num: number): string {
  const prefix = num >= 0 ? '+' : ''
  return `${prefix}${num.toFixed(2)}%`
}
</script>

<template>
  <div class="detail-page">
    <!-- 顶部区域 -->
    <div class="top-header">
      <!-- 导航栏 -->
      <div class="nav-bar">
        <van-icon name="arrow-left" size="22" color="var(--text-primary)" @click="goBack" />
        <van-icon name="arrow-left" size="18" color="var(--text-secondary)" @click="goPrevFund" />
        <div class="nav-title">
          <div class="fund-name">{{ fundInfo?.name || '加载中...' }}</div>
          <div class="fund-code">{{ fundCode }}</div>
        </div>
        <van-icon name="arrow" size="18" color="var(--text-secondary)" @click="goNextFund" />
        <van-icon name="search" size="22" color="var(--text-primary)" @click="goToSearch" />
      </div>
      
      <!-- 核心指标 -->
      <div class="core-metrics" v-if="!isLoading">
        <div class="main-change">
          <div class="change-label">当日涨幅 {{ fundInfo?.gztime?.slice(5, 10) || '--' }}</div>
          <div class="change-value" :class="isUp ? 'up' : 'down'">
            {{ formatPercent(priceChangePercent) }}
          </div>
        </div>
        <div class="sub-metrics">
          <div class="metric-item">
            <div class="metric-label">{{ bestPeriodReturn.label }}</div>
            <div class="metric-value" :class="bestPeriodReturn.value >= 0 ? 'up' : 'down'">
              {{ bestPeriodReturn.value !== 0 ? formatPercent(bestPeriodReturn.value) : '--' }}
            </div>
          </div>
        </div>
      </div>
      <div v-else class="core-metrics loading">
        <van-loading color="var(--text-secondary)" />
      </div>
    </div>

    <!-- 持仓数据区（仅持有时显示） -->
    <div v-if="holdingDetails" class="holding-panel" :class="{ collapsed: !holdingExpanded }">
      <!-- 简要信息（始终显示） -->
      <div class="holding-summary" @click="holdingExpanded = !holdingExpanded">
        <div class="summary-item">
          <span class="summary-label">持有金额</span>
          <span class="summary-value">{{ formatNum(holdingDetails.amount) }}</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">持有收益</span>
          <span class="summary-value" :class="holdingDetails.profit >= 0 ? 'up' : 'down'">
            {{ formatNum(holdingDetails.profit) }}
          </span>
        </div>
        <div class="summary-item">
          <span class="summary-label">收益率</span>
          <span class="summary-value" :class="holdingDetails.profitRate >= 0 ? 'up' : 'down'">
            {{ formatPercent(holdingDetails.profitRate) }}
          </span>
        </div>
        <van-icon 
          :name="holdingExpanded ? 'arrow-up' : 'arrow-down'" 
          class="expand-icon"
        />
      </div>
      
      <!-- 详细信息（展开时显示） -->
      <transition name="slide">
        <div v-show="holdingExpanded" class="holding-grid">
          <div class="holding-item">
            <div class="item-label">持有金额</div>
            <div class="item-value">{{ formatNum(holdingDetails.amount) }}</div>
          </div>
          <div class="holding-item">
            <div class="item-label">持有份额</div>
            <div class="item-value">{{ formatNum(holdingDetails.shares) }}</div>
          </div>
          <div class="holding-item">
            <div class="item-label">持仓占比</div>
            <div class="item-value">{{ holdingDetails.ratio.toFixed(2) }}%</div>
          </div>
          <div class="holding-item">
            <div class="item-label">持有收益</div>
            <div class="item-value" :class="holdingDetails.profit >= 0 ? 'up' : 'down'">
              {{ formatNum(holdingDetails.profit) }}
            </div>
          </div>
          <div class="holding-item">
            <div class="item-label">持有收益率</div>
            <div class="item-value" :class="holdingDetails.profitRate >= 0 ? 'up' : 'down'">
              {{ formatPercent(holdingDetails.profitRate) }}
            </div>
          </div>
          <div class="holding-item">
            <div class="item-label">持仓成本</div>
            <div class="item-value">{{ holdingDetails.cost.toFixed(4) }}</div>
          </div>
          <div class="holding-item">
            <div class="item-label">当日收益</div>
            <div class="item-value" :class="holdingDetails.todayProfit >= 0 ? 'up' : 'down'">
              {{ formatNum(holdingDetails.todayProfit) }}
            </div>
          </div>
          <div class="holding-item">
            <div class="item-label">昨日收益</div>
            <div class="item-value" :class="holdingDetails.yesterdayProfit >= 0 ? 'up' : 'down'">
              {{ formatNum(holdingDetails.yesterdayProfit) }}
            </div>
          </div>
          <div class="holding-item">
            <div class="item-label">持有天数</div>
            <div class="item-value">{{ holdingDetails.holdDays }}</div>
          </div>
        </div>
      </transition>
    </div>

    <!-- Tab切换 -->
    <div class="tab-bar">
      <div 
        class="tab-item" 
        :class="{ active: activeTab === 'chart' }"
        @click="activeTab = 'chart'"
      >
        关联涨幅
      </div>
      <div 
        class="tab-item" 
        :class="{ active: activeTab === 'performance' }"
        @click="activeTab = 'performance'"
      >
        业绩走势
      </div>
      <div 
        class="tab-item" 
        :class="{ active: activeTab === 'profit' }"
        @click="activeTab = 'profit'"
      >
        我的收益
      </div>
    </div>

    <!-- 图表区域 -->
    <div class="chart-section" v-show="activeTab === 'chart'">
      <div class="chart-header">
        <span>{{ fundInfo?.gztime?.slice(5, 10) || '--' }}</span>
        <span class="estimate-tag" :class="isUp ? 'up' : 'down'">
          估算涨幅 {{ formatPercent(priceChangePercent) }}
        </span>
        <span class="data-source">
          <van-icon name="replay" /> 数据源1
        </span>
      </div>
      
      <ProChart
        :fund-code="fundCode"
        :realtime-value="fundInfo?.gsz ? parseFloat(fundInfo.gsz) : 0"
        :realtime-change="priceChangePercent"
        :last-close="fundInfo?.dwjz ? parseFloat(fundInfo.dwjz) : 0"
      />
      
    </div>

    <!-- 业绩走势（Tab2） -->
    <div class="performance-section" v-show="activeTab === 'performance'">
      <div v-if="periodReturns.length > 0" class="period-grid">
        <div 
          v-for="item in periodReturns.slice(0, 6)" 
          :key="item.period"
          class="period-item"
        >
          <div class="period-label">{{ item.label }}</div>
          <div class="period-return" :class="item.fundReturn >= 0 ? 'up' : 'down'">
            {{ formatPercent(item.fundReturn) }}
          </div>
          <div class="period-rank" v-if="item.rank > 0">
            <span class="rank-num">{{ item.rank }}</span>/{{ item.totalCount }}
          </div>
        </div>
      </div>
      <van-empty v-else description="暂无业绩数据" />
    </div>

    <!-- 我的收益（Tab3） -->
    <div class="profit-section" v-show="activeTab === 'profit'">
      <div v-if="holdingDetails" class="profit-chart">
        <div class="profit-summary">
          <div class="profit-total">
            <span class="label">累计收益</span>
            <span class="value" :class="holdingDetails.profit >= 0 ? 'up' : 'down'">
              {{ formatNum(holdingDetails.profit) }}
            </span>
          </div>
          <div class="profit-rate">
            <span class="label">收益率</span>
            <span class="value" :class="holdingDetails.profitRate >= 0 ? 'up' : 'down'">
              {{ formatPercent(holdingDetails.profitRate) }}
            </span>
          </div>
        </div>
      </div>
      <van-empty v-else description="暂未持有该基金" />
    </div>

    <!-- 关联板块 -->
    <div v-if="sectorInfo" class="sector-section" @click="searchSimilarFunds">
      <div class="sector-info">
        <span class="sector-label">关联板块：</span>
        <span class="sector-name">{{ sectorInfo.name }}</span>
        <span class="sector-change" :class="sectorInfo.dayReturn >= 0 ? 'up' : 'down'">
          {{ formatPercent(sectorInfo.dayReturn) }}
        </span>
      </div>
      <div class="sector-link">
        {{ similarFunds.length }}只同类基金
        <van-icon name="arrow" />
      </div>
    </div>

    <!-- 同类基金 -->
    <div v-if="similarFunds.length > 0" class="similar-section">
      <div class="section-header">
        <span>同类基金</span>
        <span class="section-tip">年涨幅TOP5</span>
      </div>
      <div class="similar-list">
        <div 
          v-for="fund in similarFunds.slice(0, 5)" 
          :key="fund.code"
          class="similar-item"
          @click="goToSimilarFund(fund.code)"
        >
          <div class="similar-info">
            <div class="similar-name">{{ fund.name }}</div>
            <div class="similar-code">{{ fund.code }}</div>
          </div>
          <div class="similar-return" :class="fund.yearReturn >= 0 ? 'up' : 'down'">
            {{ formatPercent(fund.yearReturn) }}
          </div>
        </div>
      </div>
    </div>

    <!-- ========== 基金规模 ========== -->
    <div v-if="fundScale && fundScale.scale > 0" class="info-section">
      <div class="section-header">
        <span>基金规模</span>
        <span class="section-tip">{{ fundScale.scaleDate }}</span>
      </div>
      <div class="scale-grid">
        <div class="scale-item">
          <div class="scale-value">{{ fundScale.scale.toFixed(2) }}亿</div>
          <div class="scale-label">资产规模</div>
        </div>
        <div class="scale-item">
          <div class="scale-value">{{ fundScale.shareTotal.toFixed(2) }}亿份</div>
          <div class="scale-label">总份额</div>
        </div>
        <div class="scale-item">
          <div class="scale-value">{{ fundScale.institutionRatio.toFixed(1) }}%</div>
          <div class="scale-label">机构持有</div>
        </div>
        <div class="scale-item">
          <div class="scale-value">{{ fundScale.personalRatio.toFixed(1) }}%</div>
          <div class="scale-label">个人持有</div>
        </div>
      </div>
    </div>

    <!-- ========== 费率信息 ========== -->
    <div v-if="fundFees" class="info-section">
      <div class="section-header">
        <span>费率信息</span>
      </div>
      <div class="fee-grid">
        <div class="fee-item">
          <div class="fee-label">管理费</div>
          <div class="fee-value">{{ fundFees.managementFee.toFixed(2) }}%/年</div>
        </div>
        <div class="fee-item">
          <div class="fee-label">托管费</div>
          <div class="fee-value">{{ fundFees.custodianFee.toFixed(2) }}%/年</div>
        </div>
        <div class="fee-item" v-if="fundFees.salesServiceFee > 0">
          <div class="fee-label">销售服务费</div>
          <div class="fee-value">{{ fundFees.salesServiceFee.toFixed(2) }}%/年</div>
        </div>
      </div>
      
      <!-- 申购费率 -->
      <div class="fee-table">
        <div class="table-title">申购费率</div>
        <div class="table-row header">
          <span>金额</span>
          <span>原费率</span>
          <span>优惠费率</span>
        </div>
        <div 
          v-for="(fee, idx) in fundFees.purchaseFees.slice(0, 4)" 
          :key="'p' + idx"
          class="table-row"
        >
          <span>
            {{ fee.maxAmount === Infinity 
              ? `≥${fee.minAmount}万` 
              : `${fee.minAmount}-${fee.maxAmount}万` }}
          </span>
          <span>{{ fee.rate >= 1000 ? `${fee.rate}元` : `${fee.rate}%` }}</span>
          <span class="discount">{{ fee.discountRate >= 1000 ? `${fee.discountRate}元` : `${fee.discountRate}%` }}</span>
        </div>
      </div>
      
      <!-- 赎回费率 -->
      <div class="fee-table">
        <div class="table-title">赎回费率</div>
        <div class="table-row header">
          <span>持有期限</span>
          <span>费率</span>
        </div>
        <div 
          v-for="(fee, idx) in fundFees.redemptionFees" 
          :key="'r' + idx"
          class="table-row"
        >
          <span>
            {{ fee.maxDays === Infinity 
              ? `≥${fee.minDays}天` 
              : fee.minDays === 0 
                ? `<${fee.maxDays}天`
                : `${fee.minDays}-${fee.maxDays}天` }}
          </span>
          <span :class="{ free: fee.rate === 0 }">{{ fee.rate === 0 ? '免费' : `${fee.rate}%` }}</span>
        </div>
      </div>
      
      <!-- 持仓赎回费预估 -->
      <div v-if="estimatedRedemptionFee && holdingDetails" class="redemption-estimate">
        <div class="estimate-info">
          <span>当前持有 {{ holdingDetails.holdDays }} 天，赎回费率 {{ estimatedRedemptionFee.rate }}%</span>
        </div>
        <div class="estimate-fee">
          预估赎回费: <span class="fee-amount">¥{{ estimatedRedemptionFee.fee.toFixed(2) }}</span>
        </div>
      </div>
    </div>

    <!-- ========== 分红记录 ========== -->
    <div class="info-section">
      <div class="section-header">
        <span>分红记录</span>
        <span class="section-tip" v-if="dividendRecords.length > 0">
          累计{{ dividendRecords.length }}次，共{{ totalDividend.toFixed(4) }}元/份
        </span>
      </div>
      <div v-if="dividendRecords.length > 0" class="dividend-list">
        <div 
          v-for="(record, idx) in dividendRecords.slice(0, 5)" 
          :key="idx"
          class="dividend-item"
        >
          <div class="dividend-date">{{ record.date }}</div>
          <div class="dividend-amount">每份派{{ record.amount.toFixed(4) }}元</div>
          <div class="dividend-type">{{ record.type }}</div>
        </div>
        <div v-if="dividendRecords.length > 5" class="more-hint">
          还有{{ dividendRecords.length - 5 }}条记录...
        </div>
      </div>
      <div v-else class="empty-hint">暂无分红记录</div>
    </div>

    <!-- ========== 基金公告 ========== -->
    <div class="info-section">
      <div class="section-header">
        <span>基金公告</span>
      </div>
      <div v-if="announcements.length > 0" class="announcement-list">
        <div 
          v-for="item in announcements.slice(0, 5)" 
          :key="item.id"
          class="announcement-item"
          @click="openAnnouncement(item.url)"
        >
          <div class="announcement-type" :class="item.type">
            {{ item.type === '分红公告' ? '分红' : item.type === '定期报告' ? '报告' : item.type === '人事变动' ? '人事' : '公告' }}
          </div>
          <div class="announcement-content">
            <div class="announcement-title">{{ item.title }}</div>
            <div class="announcement-date">{{ item.date }}</div>
          </div>
          <van-icon name="arrow" class="announcement-arrow" />
        </div>
      </div>
      <div v-else class="empty-hint">暂无公告</div>
    </div>

    <!-- 底部操作栏 -->
    <div class="bottom-bar">
      <div class="bar-item" @click="editHolding">
        <van-icon name="edit" size="20" />
        <span>修改持仓</span>
      </div>
      <div class="bar-item" @click="setReminder">
        <van-icon name="bell" size="20" />
        <span>提醒</span>
      </div>
      <div class="bar-item" @click="showTransactions">
        <van-icon name="orders-o" size="20" />
        <span>交易记录</span>
      </div>
      <div class="bar-item" @click="fundStore.isFundInWatchlist(fundCode) ? removeFromWatchlist() : addToWatchlist()">
        <van-icon :name="fundStore.isFundInWatchlist(fundCode) ? 'star' : 'star-o'" size="20" />
        <span>{{ fundStore.isFundInWatchlist(fundCode) ? '删自选' : '加自选' }}</span>
      </div>
      <div class="bar-item" @click="showMore">
        <van-icon name="ellipsis" size="20" />
        <span>更多</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.detail-page {
  min-height: 100vh;
  background: var(--bg-primary);
  padding-bottom: 70px;
}

/* ========== 顶部区域 ========== */
.top-header {
  background: var(--bg-secondary);
  padding-top: env(safe-area-inset-top);
  border-bottom: 1px solid var(--border-color);
}

.nav-bar {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  gap: 12px;
}

.nav-title {
  flex: 1;
  text-align: center;
}

.fund-name {
  font-size: 17px;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fund-code {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 2px;
}

.core-metrics {
  padding: 16px 20px 24px;
}

.core-metrics.loading {
  display: flex;
  justify-content: center;
  padding: 40px;
}

.main-change {
  margin-bottom: 16px;
}

.change-label {
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 4px;
}

.change-value {
  font-size: 42px;
  font-weight: 700;
  font-family: 'DIN Alternate', -apple-system, monospace;
  color: var(--text-primary);
}

.change-value.up {
  color: #f56c6c;
}

.change-value.down {
  color: #67c23a;
}

.sub-metrics {
  display: flex;
  gap: 40px;
}

.metric-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.metric-label {
  font-size: 12px;
  color: var(--text-secondary);
}

.metric-value {
  font-size: 18px;
  font-weight: 600;
  font-family: 'DIN Alternate', -apple-system, monospace;
  color: var(--text-primary);
}

.metric-value.up {
  color: #f56c6c;
}

.metric-value.down {
  color: #67c23a;
}

/* ========== 持仓数据区 ========== */
.holding-panel {
  background: var(--bg-secondary);
  margin: 0 12px;
  margin-top: -12px;
  border-radius: 12px;
  padding: 16px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
  overflow: hidden;
}

/* 简要信息（收起时显示） */
.holding-summary {
  display: flex;
  align-items: center;
  gap: 16px;
  cursor: pointer;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-color);
  margin-bottom: 12px;
}

.holding-panel.collapsed .holding-summary {
  border-bottom: none;
  margin-bottom: 0;
  padding-bottom: 0;
}

.summary-item {
  flex: 1;
  text-align: center;
}

.summary-label {
  display: block;
  font-size: 11px;
  color: var(--text-secondary);
  margin-bottom: 4px;
}

.summary-value {
  font-size: 15px;
  font-weight: 600;
  font-family: 'DIN Alternate', -apple-system, monospace;
  color: var(--text-primary);
}

.summary-value.up { color: #f56c6c; }
.summary-value.down { color: #67c23a; }

.expand-icon {
  color: var(--text-secondary);
  transition: transform 0.3s;
}

.holding-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

.holding-item {
  text-align: center;
}

.item-label {
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 6px;
}

.item-value {
  font-size: 16px;
  font-weight: 600;
  font-family: 'DIN Alternate', -apple-system, monospace;
  color: var(--text-primary);
}

.item-value.up { color: #f56c6c; }
.item-value.down { color: #67c23a; }

/* 展开/收起动画 */
.slide-enter-active,
.slide-leave-active {
  transition: all 0.3s ease;
  max-height: 300px;
  opacity: 1;
  overflow: hidden;
}

.slide-enter-from,
.slide-leave-to {
  max-height: 0;
  opacity: 0;
}

/* ========== Tab切换 ========== */
.tab-bar {
  display: flex;
  background: var(--bg-secondary);
  margin: 12px;
  border-radius: 8px;
  padding: 4px;
}

.tab-item {
  flex: 1;
  text-align: center;
  padding: 10px;
  font-size: 14px;
  color: var(--text-secondary);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}

.tab-item.active {
  background: var(--color-primary);
  color: #fff;
  font-weight: 500;
}

/* ========== 图表区域 ========== */
.chart-section {
  background: var(--bg-secondary);
  margin: 0 12px 12px;
  border-radius: 12px;
  overflow: hidden;
}

.chart-header {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  font-size: 13px;
  color: var(--text-secondary);
  gap: 12px;
}

.estimate-tag {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
}

.estimate-tag.up {
  background: rgba(245, 108, 108, 0.1);
  color: #f56c6c;
}

.estimate-tag.down {
  background: rgba(103, 194, 58, 0.1);
  color: #67c23a;
}

.data-source {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 4px;
}

/* ========== 业绩走势 ========== */
.performance-section, .profit-section {
  background: var(--bg-secondary);
  margin: 0 12px 12px;
  border-radius: 12px;
  padding: 16px;
  min-height: 200px;
}

.period-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

.period-item {
  text-align: center;
  padding: 12px;
  background: var(--bg-tertiary);
  border-radius: 8px;
}

.period-label {
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 6px;
}

.period-return {
  font-size: 16px;
  font-weight: 600;
  font-family: 'DIN Alternate', -apple-system, monospace;
}

.period-return.up { color: #f56c6c; }
.period-return.down { color: #67c23a; }

.period-rank {
  font-size: 11px;
  color: var(--text-secondary);
  margin-top: 4px;
}

.period-rank .rank-num {
  color: var(--color-primary);
}

/* ========== 我的收益 ========== */
.profit-summary {
  display: flex;
  justify-content: space-around;
  padding: 24px 0;
}

.profit-total, .profit-rate {
  text-align: center;
}

.profit-total .label, .profit-rate .label {
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 8px;
  display: block;
}

.profit-total .value, .profit-rate .value {
  font-size: 24px;
  font-weight: 700;
  font-family: 'DIN Alternate', -apple-system, monospace;
}

.profit-total .value.up, .profit-rate .value.up { color: #f56c6c; }
.profit-total .value.down, .profit-rate .value.down { color: #67c23a; }

/* ========== 关联板块 ========== */
.sector-section {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: var(--bg-secondary);
  margin: 0 12px 12px;
  padding: 14px 16px;
  border-radius: 12px;
  cursor: pointer;
}

.sector-info {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
}

.sector-label {
  color: var(--text-secondary);
}

.sector-name {
  color: var(--text-primary);
  font-weight: 500;
}

.sector-change {
  font-family: 'DIN Alternate', -apple-system, monospace;
}

.sector-change.up { color: #f56c6c; }
.sector-change.down { color: #67c23a; }

.sector-link {
  font-size: 13px;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  gap: 4px;
}

/* ========== 同类基金 ========== */
.similar-section {
  background: var(--bg-secondary);
  margin: 0 12px 12px;
  border-radius: 12px;
}

.section-header {
  display: flex;
  justify-content: space-between;
  padding: 14px 16px;
  font-size: 15px;
  font-weight: 500;
  color: var(--text-primary);
  border-bottom: 1px solid var(--border-color);
}

.section-tip {
  font-size: 12px;
  font-weight: 400;
  color: var(--text-secondary);
}

.similar-list {
  padding: 8px 16px;
}

.similar-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid var(--border-color);
  cursor: pointer;
}

.similar-item:last-child {
  border-bottom: none;
}

.similar-item:active {
  opacity: 0.7;
}

.similar-info {
  flex: 1;
  overflow: hidden;
}

.similar-name {
  font-size: 14px;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.similar-code {
  font-size: 11px;
  color: var(--text-secondary);
  margin-top: 2px;
}

.similar-return {
  font-size: 14px;
  font-weight: 600;
  font-family: 'DIN Alternate', -apple-system, monospace;
}

.similar-return.up { color: #f56c6c; }
.similar-return.down { color: #67c23a; }

/* ========== 信息区块通用样式 ========== */
.info-section {
  background: var(--bg-secondary);
  margin: 12px;
  border-radius: 12px;
  overflow: hidden;
}

/* ========== 基金规模 ========== */
.scale-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  padding: 12px 8px;
  gap: 8px;
}

.scale-item {
  text-align: center;
}

.scale-value {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  font-family: 'DIN Alternate', -apple-system, monospace;
}

.scale-label {
  font-size: 11px;
  color: var(--text-secondary);
  margin-top: 4px;
}

/* ========== 费率信息 ========== */
.fee-grid {
  display: flex;
  padding: 12px 16px;
  gap: 24px;
  border-bottom: 1px solid var(--border-color);
}

.fee-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.fee-label {
  font-size: 11px;
  color: var(--text-secondary);
}

.fee-value {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
}

.fee-table {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color);
}

.fee-table:last-of-type {
  border-bottom: none;
}

.table-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  margin-bottom: 8px;
}

.table-row {
  display: flex;
  justify-content: space-between;
  padding: 6px 0;
  font-size: 12px;
  color: var(--text-secondary);
}

.table-row.header {
  color: var(--text-tertiary);
  font-size: 11px;
  border-bottom: 1px solid var(--border-color);
  padding-bottom: 8px;
  margin-bottom: 4px;
}

.table-row span {
  flex: 1;
  text-align: center;
}

.table-row span:first-child {
  text-align: left;
}

.table-row .discount {
  color: #f56c6c;
  font-weight: 500;
}

.table-row .free {
  color: #67c23a;
  font-weight: 500;
}

.redemption-estimate {
  padding: 12px 16px;
  background: var(--bg-tertiary);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.estimate-info {
  font-size: 12px;
  color: var(--text-secondary);
}

.estimate-fee {
  font-size: 13px;
  color: var(--text-primary);
}

.fee-amount {
  font-weight: 600;
  color: #f56c6c;
}

/* ========== 分红记录 ========== */
.dividend-list {
  padding: 8px 16px 12px;
}

.dividend-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 0;
  border-bottom: 1px solid var(--border-color);
}

.dividend-item:last-child {
  border-bottom: none;
}

.dividend-date {
  font-size: 13px;
  color: var(--text-secondary);
  width: 90px;
}

.dividend-amount {
  flex: 1;
  font-size: 13px;
  color: var(--text-primary);
  font-weight: 500;
}

.dividend-type {
  font-size: 11px;
  color: #f56c6c;
  background: rgba(245, 108, 108, 0.1);
  padding: 2px 8px;
  border-radius: 10px;
}

.more-hint {
  text-align: center;
  font-size: 12px;
  color: var(--text-tertiary);
  padding: 8px 0;
}

.empty-hint {
  text-align: center;
  font-size: 13px;
  color: var(--text-tertiary);
  padding: 20px;
}

/* ========== 基金公告 ========== */
.announcement-list {
  padding: 8px 16px 12px;
}

.announcement-item {
  display: flex;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid var(--border-color);
  cursor: pointer;
}

.announcement-item:last-child {
  border-bottom: none;
}

.announcement-item:active {
  opacity: 0.7;
}

.announcement-type {
  font-size: 10px;
  padding: 3px 6px;
  border-radius: 4px;
  margin-right: 10px;
  white-space: nowrap;
}

.announcement-type.分红公告 {
  background: rgba(245, 108, 108, 0.1);
  color: #f56c6c;
}

.announcement-type.定期报告 {
  background: rgba(64, 158, 255, 0.1);
  color: #409eff;
}

.announcement-type.人事变动 {
  background: rgba(230, 162, 60, 0.1);
  color: #e6a23c;
}

.announcement-type.其他公告 {
  background: var(--bg-tertiary);
  color: var(--text-secondary);
}

.announcement-content {
  flex: 1;
  overflow: hidden;
}

.announcement-title {
  font-size: 13px;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.announcement-date {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-top: 4px;
}

.announcement-arrow {
  color: var(--text-tertiary);
  margin-left: 8px;
}

/* ========== 底部操作栏 ========== */
.bottom-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  background: var(--bg-secondary);
  border-top: 1px solid var(--border-color);
  padding: 8px 0;
  padding-bottom: max(8px, env(safe-area-inset-bottom));
  z-index: 100;
}

.bar-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 6px 0;
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
}

.bar-item:active {
  opacity: 0.7;
}
</style>
