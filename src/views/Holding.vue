<script setup lang="ts">
// [WHY] 持仓管理页 - 管理用户的基金持仓和收益
// [WHAT] 显示持仓列表、汇总统计，支持添加/编辑/删除持仓
// [WHAT] 支持 A类/C类基金费用计算

import { ref, onMounted, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useHoldingStore } from '@/stores/holding'
import { searchFund, fetchFundEstimate, detectShareClass, fetchFundFeeInfo, calculateBuyFee, calculateDailyServiceFee } from '@/api/fund'
import { showConfirmDialog, showToast, showLoadingToast, closeToast } from 'vant'
import { formatMoney, formatPercent, getChangeStatus } from '@/utils/format'
import type { FundInfo, HoldingRecord, FundShareClass, FundFeeInfo } from '@/types/fund'

const router = useRouter()
const holdingStore = useHoldingStore()

// ========== 表单相关 ==========
const showAddDialog = ref(false)
const isEditing = ref(false)
const formData = ref({
  code: '',
  name: '',
  amount: '', // 持仓金额
  buyDate: '' // 买入日期
})

// ========== A/C类费用相关 ==========
const shareClass = ref<FundShareClass>('A')
const feeInfo = ref<FundFeeInfo | null>(null)
// A类：是否扣除买入手续费
const deductBuyFee = ref(true)
// C类：销售服务费年化费率（默认0.4%）
const serviceFeeRate = ref(0.4)

// 基金搜索相关
const searchKeyword = ref('')
const searchResults = ref<FundInfo[]>([])
const isSearching = ref(false)
const selectedFund = ref<FundInfo | null>(null)
const currentNetValue = ref(0) // 当前基金净值

// [WHAT] 页面挂载时初始化数据
onMounted(() => {
  holdingStore.initHoldings()
})

// [WHAT] 汇总统计样式
const summaryProfitClass = computed(() => {
  return getChangeStatus(holdingStore.summary.totalProfit)
})

const summaryTodayClass = computed(() => {
  return getChangeStatus(holdingStore.summary.todayProfit)
})

// [WHAT] 下拉刷新
async function onRefresh() {
  await holdingStore.refreshEstimates()
  holdingStore.updateHoldingDays()
  showToast('刷新成功')
}

// [WHAT] 打开添加持仓弹窗
function openAddDialog() {
  isEditing.value = false
  resetForm()
  // 默认买入日期为今天
  formData.value.buyDate = new Date().toISOString().split('T')[0]
  showAddDialog.value = true
}

// [WHAT] 打开编辑持仓弹窗
function handleEdit(code: string) {
  const holding = holdingStore.getHoldingByCode(code)
  if (!holding) return
  
  isEditing.value = true
  formData.value = {
    code: holding.code,
    name: holding.name,
    amount: holding.amount.toString(),
    buyDate: holding.buyDate
  }
  currentNetValue.value = holding.buyNetValue
  selectedFund.value = { code: holding.code, name: holding.name, type: '', pinyin: '' }
  showAddDialog.value = true
}

// [WHAT] 删除持仓
async function handleDelete(code: string) {
  try {
    await showConfirmDialog({
      title: '确认删除',
      message: '确定要删除该持仓记录吗？'
    })
    holdingStore.removeHolding(code)
    showToast('已删除')
  } catch {
    // 用户取消
  }
}

// [WHAT] 重置表单
function resetForm() {
  formData.value = { code: '', name: '', amount: '', buyDate: '' }
  searchKeyword.value = ''
  searchResults.value = []
  selectedFund.value = null
  currentNetValue.value = 0
  shareClass.value = 'A'
  feeInfo.value = null
  deductBuyFee.value = true
  serviceFeeRate.value = 0.4
}

// [WHAT] 搜索基金
let searchTimer: ReturnType<typeof setTimeout> | null = null

function onSearchInput() {
  if (searchTimer) clearTimeout(searchTimer)
  
  if (!searchKeyword.value.trim()) {
    searchResults.value = []
    return
  }
  
  searchTimer = setTimeout(async () => {
    isSearching.value = true
    try {
      searchResults.value = await searchFund(searchKeyword.value, 10)
    } finally {
      isSearching.value = false
    }
  }, 300)
}

// [WHAT] 选择基金
async function selectFund(fund: FundInfo) {
  selectedFund.value = fund
  formData.value.code = fund.code
  formData.value.name = fund.name
  searchKeyword.value = ''
  searchResults.value = []
  
  // [WHAT] 检测份额类型（A类/C类）
  shareClass.value = detectShareClass(fund.code, fund.name)
  
  // [WHY] 获取当前净值和费率信息
  showLoadingToast({ message: '获取净值...', forbidClick: true })
  try {
    const [estimate, fee] = await Promise.all([
      fetchFundEstimate(fund.code),
      fetchFundFeeInfo(fund.code)
    ])
    currentNetValue.value = parseFloat(estimate.gsz) || parseFloat(estimate.dwjz) || 1
    feeInfo.value = fee
    
    // [WHAT] 根据费率信息更新默认费率
    if (fee) {
      if (shareClass.value === 'C') {
        serviceFeeRate.value = fee.serviceFeeRate || 0.4
      }
    }
    closeToast()
  } catch {
    closeToast()
    // [WHY] 估值API失败时（ETF联接等），尝试从历史净值获取
    try {
      const { fetchSimpleKLineData } = await import('@/api/fundFast')
      const klineData = await fetchSimpleKLineData(fund.code, '1m')
      if (klineData && klineData.length > 0) {
        // [WHAT] 使用最新的历史净值
        currentNetValue.value = klineData[klineData.length - 1]!.value
        showToast('已获取历史净值')
        return
      }
    } catch {
      // 历史数据也失败
    }
    currentNetValue.value = 1
    showToast('请手动输入净值')
  }
}

// [WHAT] 计算买入手续费（仅A类）
const buyFeeAmount = computed(() => {
  if (shareClass.value !== 'A' || !deductBuyFee.value) return 0
  const amount = parseFloat(formData.value.amount) || 0
  const rate = feeInfo.value?.buyFeeRate || 0.15
  const fee = amount * (rate / 100)
  return Math.round(fee * 100) / 100
})

// [WHAT] 实际用于购买的金额（扣除手续费后）
const actualBuyAmount = computed(() => {
  const amount = parseFloat(formData.value.amount) || 0
  if (shareClass.value === 'A' && deductBuyFee.value) {
    return amount - buyFeeAmount.value
  }
  return amount
})

// [WHAT] 计算持有份额
const calculatedShares = computed(() => {
  if (actualBuyAmount.value <= 0 || currentNetValue.value <= 0) return 0
  return actualBuyAmount.value / currentNetValue.value
})

// [WHAT] 计算C类每日销售服务费预估
const dailyServiceFee = computed(() => {
  if (shareClass.value !== 'C') return 0
  const shares = calculatedShares.value
  if (shares <= 0 || currentNetValue.value <= 0) return 0
  return calculateDailyServiceFee(shares, currentNetValue.value, serviceFeeRate.value)
})

// [WHAT] 计算持仓天数
const calculatedDays = computed(() => {
  if (!formData.value.buyDate) return 0
  const buyDate = new Date(formData.value.buyDate)
  const today = new Date()
  const diffTime = today.getTime() - buyDate.getTime()
  return Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)))
})

// [WHAT] 提交表单
async function submitForm() {
  if (!formData.value.code) {
    showToast('请选择基金')
    return
  }
  if (!formData.value.amount || parseFloat(formData.value.amount) <= 0) {
    showToast('请输入有效的持仓金额')
    return
  }
  if (!formData.value.buyDate) {
    showToast('请选择买入日期')
    return
  }
  
  const record: HoldingRecord = {
    code: formData.value.code,
    name: formData.value.name,
    shareClass: shareClass.value,
    amount: parseFloat(formData.value.amount),
    buyNetValue: currentNetValue.value,
    shares: calculatedShares.value,
    buyDate: formData.value.buyDate,
    holdingDays: calculatedDays.value,
    createdAt: Date.now(),
    // A类基金费用字段
    buyFeeRate: shareClass.value === 'A' ? (feeInfo.value?.buyFeeRate || 0.15) : undefined,
    buyFeeDeducted: shareClass.value === 'A' ? deductBuyFee.value : undefined,
    buyFeeAmount: shareClass.value === 'A' ? buyFeeAmount.value : undefined,
    // C类基金费用字段
    serviceFeeRate: shareClass.value === 'C' ? serviceFeeRate.value : undefined,
    serviceFeeDeducted: shareClass.value === 'C' ? 0 : undefined,
    lastFeeDate: shareClass.value === 'C' ? formData.value.buyDate : undefined
  }
  
  await holdingStore.addOrUpdateHolding(record)
  showToast(isEditing.value ? '修改成功' : '添加成功')
  showAddDialog.value = false
  resetForm()
}

// [WHAT] 跳转到首页
function goHome() {
  router.push('/')
}

// [WHAT] 跳转到基金详情
function goToDetail(code: string) {
  router.push(`/detail/${code}`)
}

// ========== 日期选择器 ==========
const showDatePicker = ref(false)

function onDateConfirm({ selectedValues }: { selectedValues: string[] }) {
  // [WHY] Vant 4 日期选择器返回 ['2024', '01', '30'] 格式
  if (selectedValues.length >= 3) {
    formData.value.buyDate = selectedValues.join('-')
  }
  showDatePicker.value = false
}
</script>

<template>
  <div class="holding-page">
    <!-- 顶部导航栏 -->
    <van-nav-bar title="我的持仓">
      <template #right>
        <van-icon name="add-o" size="20" @click="openAddDialog" />
      </template>
    </van-nav-bar>

    <!-- 汇总统计卡片 -->
    <div v-if="holdingStore.holdings.length > 0" class="summary-card">
      <div class="summary-row">
        <div class="summary-item">
          <div class="summary-label">账户资产</div>
          <div class="summary-value">{{ formatMoney(holdingStore.summary.totalValue) }}</div>
        </div>
        <div class="summary-item">
          <div class="summary-label">当日收益</div>
          <div class="summary-value" :class="summaryTodayClass">
            {{ holdingStore.summary.todayProfit >= 0 ? '+' : '' }}{{ formatMoney(holdingStore.summary.todayProfit) }}
          </div>
        </div>
      </div>
      <div class="summary-row">
        <div class="summary-item">
          <div class="summary-label">持仓盈亏</div>
          <div class="summary-value" :class="summaryProfitClass">
            {{ holdingStore.summary.totalProfit >= 0 ? '+' : '' }}{{ formatMoney(holdingStore.summary.totalProfit) }}
          </div>
        </div>
        <div class="summary-item">
          <div class="summary-label">收益率</div>
          <div class="summary-value" :class="summaryProfitClass">
            {{ formatPercent(holdingStore.summary.totalProfitRate) }}
          </div>
        </div>
      </div>
    </div>

    <!-- 持仓列表表头 -->
    <div v-if="holdingStore.holdings.length > 0" class="list-header">
      <span class="col-name">基金名称</span>
      <span class="col-change">当日涨幅</span>
      <span class="col-today">当日收益</span>
      <span class="col-profit">持有收益</span>
    </div>

    <!-- 持仓列表 -->
    <van-pull-refresh
      v-model="holdingStore.isRefreshing"
      @refresh="onRefresh"
      class="holding-list-container"
    >
      <template v-if="holdingStore.holdings.length > 0">
        <van-swipe-cell v-for="holding in holdingStore.holdings" :key="holding.code">
          <div class="holding-item" @click="goToDetail(holding.code)">
            <div class="col-name">
              <div class="fund-name">{{ holding.name || '加载中...' }}</div>
              <div class="fund-meta">
                <span class="tag">已更新</span>
                <span class="amount">¥{{ formatMoney(holding.amount) }}</span>
              </div>
            </div>
            <div class="col-change" :class="getChangeStatus(holding.todayChange || 0)">
              {{ formatPercent(holding.todayChange || 0) }}
            </div>
            <div class="col-today" :class="getChangeStatus(holding.todayProfit || 0)">
              {{ holding.todayProfit !== undefined ? (holding.todayProfit >= 0 ? '+' : '') + formatMoney(holding.todayProfit) : '--' }}
            </div>
            <div class="col-profit" :class="getChangeStatus(holding.profit || 0)">
              <div class="profit-amount">
                {{ holding.profit !== undefined ? (holding.profit >= 0 ? '+' : '') + formatMoney(holding.profit) : '--' }}
              </div>
              <div class="profit-rate">
                {{ holding.profitRate !== undefined ? formatPercent(holding.profitRate) : '--' }}
              </div>
            </div>
          </div>
          
          <!-- 滑动操作按钮 -->
          <template #right>
            <van-button square type="primary" text="编辑" class="action-btn" @click="handleEdit(holding.code)" />
            <van-button square type="danger" text="删除" class="action-btn" @click="handleDelete(holding.code)" />
          </template>
        </van-swipe-cell>
      </template>

      <!-- 空状态 -->
      <van-empty v-else description="暂无持仓记录">
        <van-button round type="primary" @click="openAddDialog">
          添加持仓
        </van-button>
      </van-empty>
    </van-pull-refresh>

    <!-- 添加/编辑持仓弹窗 -->
    <van-popup
      v-model:show="showAddDialog"
      position="bottom"
      round
      :style="{ height: '75%' }"
    >
      <div class="add-dialog">
        <div class="dialog-header">
          <span>{{ isEditing ? '编辑持仓' : '添加持仓' }}</span>
          <van-icon name="cross" @click="showAddDialog = false" />
        </div>

        <div class="dialog-content">
          <!-- 基金选择（非编辑模式） -->
          <template v-if="!isEditing">
            <van-field
              v-if="!selectedFund"
              v-model="searchKeyword"
              label="选择基金"
              placeholder="输入基金代码或名称搜索"
              @input="onSearchInput"
            />
            
            <!-- 搜索结果 -->
            <div v-if="searchResults.length > 0" class="search-results">
              <van-cell
                v-for="fund in searchResults"
                :key="fund.code"
                :title="fund.name"
                :label="fund.code"
                clickable
                @click="selectFund(fund)"
              />
            </div>

            <!-- 已选择的基金 -->
            <van-field
              v-if="selectedFund"
              :model-value="`${selectedFund.name} (${selectedFund.code})`"
              label="已选基金"
              readonly
            >
              <template #button>
                <van-button size="small" @click="selectedFund = null; currentNetValue = 0">重选</van-button>
              </template>
            </van-field>
          </template>

          <!-- 编辑模式显示基金信息 -->
          <van-field
            v-else
            :model-value="`${formData.name} (${formData.code})`"
            label="基金"
            readonly
          />

          <!-- 当前净值显示 -->
          <van-field
            v-if="currentNetValue > 0"
            :model-value="currentNetValue.toFixed(4)"
            label="当前净值"
            readonly
          />

          <!-- 份额类型显示 -->
          <van-field v-if="selectedFund || isEditing" label="份额类型" readonly>
            <template #input>
              <div class="share-class-display">
                <span class="share-class-tag" :class="shareClass.toLowerCase()">{{ shareClass }}类</span>
                <span class="share-class-desc">
                  {{ shareClass === 'A' ? '前端收费' : '按日计提销售服务费' }}
                </span>
              </div>
            </template>
          </van-field>

          <!-- A类基金：买入手续费选项 -->
          <template v-if="shareClass === 'A' && (selectedFund || isEditing)">
            <van-field label="买入手续费">
              <template #input>
                <div class="fee-option">
                  <van-checkbox v-model="deductBuyFee" shape="square">
                    从金额中扣除
                  </van-checkbox>
                  <span class="fee-rate">费率 {{ feeInfo?.buyFeeRate || 0.15 }}%</span>
                </div>
              </template>
            </van-field>
            <div v-if="buyFeeAmount > 0" class="fee-tip">
              <van-icon name="info-o" />
              <span>手续费约 ¥{{ buyFeeAmount.toFixed(2) }}，实际买入 ¥{{ actualBuyAmount.toFixed(2) }}</span>
            </div>
          </template>

          <!-- C类基金：销售服务费说明 -->
          <template v-if="shareClass === 'C' && (selectedFund || isEditing)">
            <van-field label="销售服务费">
              <template #input>
                <div class="fee-option">
                  <span class="fee-rate">年化 {{ serviceFeeRate }}%（按日计提）</span>
                </div>
              </template>
            </van-field>
            <div v-if="dailyServiceFee > 0" class="fee-tip">
              <van-icon name="info-o" />
              <span>每日约扣 ¥{{ dailyServiceFee.toFixed(2) }}（不满1分按1分计）</span>
            </div>
          </template>

          <!-- 持仓金额 -->
          <van-field
            v-model="formData.amount"
            type="number"
            label="持仓金额"
            placeholder="请输入持仓金额（元）"
          />

          <!-- 买入日期 -->
          <van-field
            v-model="formData.buyDate"
            label="买入日期"
            placeholder="请选择买入日期"
            readonly
            is-link
            @click="showDatePicker = true"
          />

          <!-- 计算结果展示 -->
          <div v-if="calculatedShares > 0" class="calc-result">
            <div class="calc-item">
              <span class="calc-label">预估份额</span>
              <span class="calc-value">{{ calculatedShares.toFixed(2) }} 份</span>
            </div>
            <div class="calc-item">
              <span class="calc-label">持仓天数</span>
              <span class="calc-value">{{ calculatedDays }} 天</span>
            </div>
          </div>
        </div>

        <div class="dialog-footer">
          <van-button block type="primary" @click="submitForm">
            {{ isEditing ? '保存修改' : '确认添加' }}
          </van-button>
        </div>
      </div>
    </van-popup>

    <!-- 日期选择器 -->
    <van-popup v-model:show="showDatePicker" position="bottom">
      <van-date-picker
        title="选择买入日期"
        :max-date="new Date()"
        @confirm="onDateConfirm"
        @cancel="showDatePicker = false"
      />
    </van-popup>
  </div>
</template>

<style scoped>
.holding-page {
  min-height: 100vh;
  background: var(--bg-primary);
  transition: background-color 0.3s;
}

/* 汇总卡片 */
.summary-card {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  margin: 12px;
  padding: 16px;
  border-radius: 12px;
  color: #fff;
}

.summary-row {
  display: flex;
  justify-content: space-between;
  margin-bottom: 12px;
}

.summary-row:last-child {
  margin-bottom: 0;
}

.summary-item {
  flex: 1;
}

.summary-label {
  font-size: 12px;
  opacity: 0.8;
  margin-bottom: 4px;
}

.summary-value {
  font-size: 18px;
  font-weight: 600;
}

/* [WHY] 紫色背景上使用高对比度涨跌色 */
.summary-value.up {
  color: #ff6b6b;  /* 红涨 - 更鲜艳 */
}

.summary-value.down {
  color: #51cf66;  /* 绿跌 - 更鲜艳 */
}

/* 列表表头 */
.list-header {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr 1fr;
  padding: 12px 16px;
  font-size: 12px;
  color: var(--text-secondary);
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
}

/* 持仓列表 */
.holding-list-container {
  /* [WHY] 固定高度才能让滚动和下拉刷新正常工作 */
  height: calc(100vh - 250px);
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior-y: contain;
}

.holding-item {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr 1fr;
  align-items: center;
  padding: 12px 16px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
}

.col-name .fund-name {
  font-size: 14px;
  color: var(--text-primary);
  margin-bottom: 4px;
}

.col-name .fund-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.col-name .tag {
  font-size: 10px;
  padding: 1px 4px;
  background: var(--color-primary-bg);
  color: var(--color-primary);
  border-radius: 2px;
}

.col-name .amount {
  font-size: 12px;
  color: var(--text-secondary);
}

.col-change, .col-today, .col-profit {
  text-align: center;
  font-size: 14px;
}

.col-profit .profit-amount {
  font-size: 14px;
}

.col-profit .profit-rate {
  font-size: 12px;
  opacity: 0.8;
}

.up { color: var(--color-up); }
.down { color: var(--color-down); }
.flat { color: var(--text-secondary); }

.action-btn {
  height: 100%;
}

/* 添加弹窗样式 */
.add-dialog {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg-secondary);
}

.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  font-size: 16px;
  font-weight: 500;
  color: var(--text-primary);
  border-bottom: 1px solid var(--border-color);
}

.dialog-content {
  flex: 1;
  overflow-y: auto;
}

.search-results {
  max-height: 200px;
  overflow-y: auto;
  border-bottom: 1px solid var(--border-color);
}

.calc-result {
  padding: 16px;
  background: var(--bg-tertiary);
  margin: 16px;
  border-radius: 8px;
}

.calc-item {
  display: flex;
  justify-content: space-between;
  padding: 8px 0;
}

.calc-label {
  color: var(--text-secondary);
}

.calc-value {
  color: var(--text-primary);
  font-weight: 500;
}

.dialog-footer {
  padding: 16px;
}

/* A/C 类份额标签 */
.share-class-display {
  display: flex;
  align-items: center;
  gap: 8px;
}

.share-class-tag {
  padding: 2px 8px;
  font-size: 12px;
  border-radius: 4px;
  font-weight: 500;
}

.share-class-tag.a {
  background: rgba(255, 193, 7, 0.2);
  color: #f59e0b;
}

.share-class-tag.c {
  background: rgba(25, 137, 250, 0.2);
  color: #1989fa;
}

.share-class-desc {
  font-size: 12px;
  color: var(--text-secondary);
}

/* 费用选项 */
.fee-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}

.fee-rate {
  font-size: 13px;
  color: var(--text-secondary);
}

.fee-tip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  margin: 0 16px;
  background: var(--color-primary-bg);
  border-radius: 4px;
  font-size: 12px;
  color: var(--color-primary);
}
</style>
