<script setup lang="ts">
// [WHY] 定投计算器页面 - 模拟定投收益
// [WHAT] 输入参数计算定投收益，支持多种定投策略

import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { showToast } from 'vant'

const router = useRouter()

// [WHAT] 定投参数
const investAmount = ref(1000) // 每期金额
const investPeriod = ref<'week' | 'month'>('month') // 定投周期
const totalMonths = ref(36) // 定投月数
const expectedReturn = ref(10) // 预期年化收益率(%)

// [WHAT] 计算结果
const result = computed(() => {
  const amount = investAmount.value
  const months = totalMonths.value
  const annualRate = expectedReturn.value / 100
  
  // 每期数量
  const periodsPerYear = investPeriod.value === 'week' ? 52 : 12
  const totalPeriods = investPeriod.value === 'week' ? Math.floor(months * 4.33) : months
  const periodRate = annualRate / periodsPerYear
  
  // 总投入
  const totalInvest = amount * totalPeriods
  
  // 定投终值公式: FV = A * ((1+r)^n - 1) / r * (1+r)
  // 其中 A=每期金额, r=每期收益率, n=期数
  let finalValue: number
  if (periodRate === 0) {
    finalValue = totalInvest
  } else {
    finalValue = amount * ((Math.pow(1 + periodRate, totalPeriods) - 1) / periodRate) * (1 + periodRate)
  }
  
  // 总收益
  const totalProfit = finalValue - totalInvest
  // 收益率
  const profitRate = totalInvest > 0 ? (totalProfit / totalInvest) * 100 : 0
  
  return {
    totalInvest,
    finalValue,
    totalProfit,
    profitRate,
    totalPeriods
  }
})

// [WHAT] 快捷金额选项
const amountOptions = [500, 1000, 2000, 3000, 5000]

// [WHAT] 快捷月数选项
const monthOptions = [12, 24, 36, 60, 120]

// [WHAT] 预期收益选项
const returnOptions = [5, 8, 10, 12, 15]

// [WHAT] 格式化金额
function formatMoney(num: number): string {
  if (num >= 10000) {
    return (num / 10000).toFixed(2) + '万'
  }
  return num.toFixed(2)
}

function goBack() {
  router.back()
}

// [WHAT] 开始定投（跳转到搜索选基金）
function startInvest() {
  showToast('请先选择定投基金')
  router.push('/search')
}
</script>

<template>
  <div class="calculator-page">
    <!-- 顶部导航 -->
    <van-nav-bar 
      title="定投计算器" 
      left-arrow 
      @click-left="goBack"
    />
    
    <!-- 参数设置区 -->
    <div class="params-section">
      <!-- 每期金额 -->
      <div class="param-item">
        <div class="param-label">每期投入金额（元）</div>
        <div class="param-options">
          <div 
            v-for="opt in amountOptions" 
            :key="opt"
            class="option-tag"
            :class="{ active: investAmount === opt }"
            @click="investAmount = opt"
          >
            {{ opt }}
          </div>
        </div>
        <van-field
          v-model.number="investAmount"
          type="number"
          placeholder="自定义金额"
          class="custom-input"
        />
      </div>
      
      <!-- 定投周期 -->
      <div class="param-item">
        <div class="param-label">定投周期</div>
        <div class="param-options">
          <div 
            class="option-tag"
            :class="{ active: investPeriod === 'week' }"
            @click="investPeriod = 'week'"
          >
            每周
          </div>
          <div 
            class="option-tag"
            :class="{ active: investPeriod === 'month' }"
            @click="investPeriod = 'month'"
          >
            每月
          </div>
        </div>
      </div>
      
      <!-- 定投时长 -->
      <div class="param-item">
        <div class="param-label">定投时长（月）</div>
        <div class="param-options">
          <div 
            v-for="opt in monthOptions" 
            :key="opt"
            class="option-tag"
            :class="{ active: totalMonths === opt }"
            @click="totalMonths = opt"
          >
            {{ opt >= 12 ? `${opt/12}年` : `${opt}月` }}
          </div>
        </div>
        <van-slider 
          v-model="totalMonths" 
          :min="6" 
          :max="240" 
          :step="6"
          class="month-slider"
        />
        <div class="slider-value">{{ totalMonths }}个月 ≈ {{ (totalMonths/12).toFixed(1) }}年</div>
      </div>
      
      <!-- 预期收益率 -->
      <div class="param-item">
        <div class="param-label">预期年化收益率（%）</div>
        <div class="param-options">
          <div 
            v-for="opt in returnOptions" 
            :key="opt"
            class="option-tag"
            :class="{ active: expectedReturn === opt }"
            @click="expectedReturn = opt"
          >
            {{ opt }}%
          </div>
        </div>
        <van-slider 
          v-model="expectedReturn" 
          :min="0" 
          :max="30" 
          :step="1"
          class="return-slider"
        />
        <div class="slider-value">{{ expectedReturn }}%</div>
      </div>
    </div>
    
    <!-- 结果展示 -->
    <div class="result-section">
      <div class="result-header">
        <span>预期收益</span>
        <span class="result-tip">仅供参考，不代表实际收益</span>
      </div>
      
      <div class="result-cards">
        <div class="result-card main">
          <div class="card-label">预期总资产</div>
          <div class="card-value">¥{{ formatMoney(result.finalValue) }}</div>
        </div>
        <div class="result-card">
          <div class="card-label">总投入</div>
          <div class="card-value">¥{{ formatMoney(result.totalInvest) }}</div>
        </div>
        <div class="result-card profit">
          <div class="card-label">预期收益</div>
          <div class="card-value up">+¥{{ formatMoney(result.totalProfit) }}</div>
        </div>
        <div class="result-card">
          <div class="card-label">收益率</div>
          <div class="card-value up">+{{ result.profitRate.toFixed(2) }}%</div>
        </div>
      </div>
      
      <!-- 定投说明 -->
      <div class="invest-info">
        <div class="info-item">
          <van-icon name="info-o" />
          <span>共{{ result.totalPeriods }}期，{{ investPeriod === 'week' ? '每周' : '每月' }}投入{{ investAmount }}元</span>
        </div>
        <div class="info-item">
          <van-icon name="clock-o" />
          <span>定投{{ totalMonths }}个月后的预期收益</span>
        </div>
      </div>
    </div>
    
    <!-- 底部按钮 -->
    <div class="bottom-action">
      <van-button block type="primary" size="large" @click="startInvest">
        选择基金开始定投
      </van-button>
    </div>
  </div>
</template>

<style scoped>
.calculator-page {
  min-height: 100vh;
  background: var(--bg-primary);
  padding-bottom: 80px;
}

/* 参数区域 */
.params-section {
  padding: 16px;
}

.param-item {
  background: var(--bg-secondary);
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 12px;
}

.param-label {
  font-size: 14px;
  color: var(--text-secondary);
  margin-bottom: 12px;
}

.param-options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}

.option-tag {
  padding: 8px 16px;
  background: var(--bg-tertiary);
  border-radius: 20px;
  font-size: 13px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s;
}

.option-tag.active {
  background: var(--color-primary);
  color: #fff;
}

.custom-input {
  background: var(--bg-tertiary);
  border-radius: 8px;
  padding: 0;
}

.custom-input :deep(.van-field__control) {
  text-align: center;
}

.month-slider, .return-slider {
  margin: 8px 0;
}

.slider-value {
  text-align: center;
  font-size: 13px;
  color: var(--text-secondary);
}

/* 结果区域 */
.result-section {
  background: var(--bg-secondary);
  margin: 0 16px;
  border-radius: 12px;
  padding: 16px;
}

.result-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.result-header span:first-child {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}

.result-tip {
  font-size: 11px;
  color: var(--text-secondary);
}

.result-cards {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

.result-card {
  background: var(--bg-tertiary);
  border-radius: 8px;
  padding: 12px;
  text-align: center;
}

.result-card.main {
  grid-column: span 2;
  background: var(--color-primary);
}

.result-card.main .card-label {
  color: rgba(255, 255, 255, 0.8);
}

.result-card.main .card-value {
  color: #fff;
}

.card-label {
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 6px;
}

.card-value {
  font-size: 20px;
  font-weight: 700;
  font-family: 'DIN Alternate', -apple-system, monospace;
  color: var(--text-primary);
}

.card-value.up {
  color: #f56c6c;
}

/* 定投说明 */
.invest-info {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--border-color);
}

.info-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

/* 底部按钮 */
.bottom-action {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 12px 16px;
  padding-bottom: max(12px, env(safe-area-inset-bottom));
  background: var(--bg-secondary);
  border-top: 1px solid var(--border-color);
}
</style>
