<script setup lang="ts">
// [WHY] 专业金融图表组件，使用 Lightweight Charts 实现
// [WHAT] 支持K线图、分时图、面积图切换，多时间维度
// [DEPS] 依赖 lightweight-charts 库

import { ref, onMounted, onUnmounted, watch, computed, nextTick } from 'vue'
import { createChart, type IChartApi, type ISeriesApi, ColorType, CrosshairMode } from 'lightweight-charts'
import type { NetValueRecord } from '@/types/fund'
import { fetchKLineData, type KLineData } from '@/api/fund'

const props = defineProps<{
  data: NetValueRecord[]
  fundCode: string
  loading?: boolean
}>()

const emit = defineEmits<{
  periodChange: [period: string]
}>()

// ========== 图表引用 ==========
const chartContainer = ref<HTMLDivElement | null>(null)
let chart: IChartApi | null = null
let areaSeries: ISeriesApi<'Area'> | null = null
let candlestickSeries: ISeriesApi<'Candlestick'> | null = null

// ========== 图表类型和周期 ==========
const chartType = ref<'area' | 'kline'>('area')
const activePeriod = ref('1m')

const chartTypes = [
  { key: 'area', label: '分时' },
  { key: 'kline', label: '曲线' }
]

const periods = [
  { key: '1w', label: '1周' },
  { key: '1m', label: '1月' },
  { key: '3m', label: '3月' },
  { key: '6m', label: '6月' },
  { key: '1y', label: '1年' },
  { key: 'all', label: '全部' }
]

// ========== K线数据 ==========
const klineData = ref<KLineData[]>([])
const klineLoading = ref(false)

// [WHAT] 根据时间周期过滤数据
const filteredData = computed(() => {
  if (!props.data || props.data.length === 0) return []
  
  const now = new Date()
  let startDate: Date
  
  switch (activePeriod.value) {
    case '1w':
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      break
    case '1m':
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
      break
    case '3m':
      startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
      break
    case '6m':
      startDate = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000)
      break
    case '1y':
      startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000)
      break
    default:
      startDate = new Date(0)
  }
  
  return props.data
    .filter(item => new Date(item.date) >= startDate)
    .reverse()
})

// [WHAT] 过滤后的K线数据
const filteredKlineData = computed(() => {
  if (klineData.value.length === 0) return []
  
  const now = new Date()
  let startDate: Date
  
  switch (activePeriod.value) {
    case '1w':
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      break
    case '1m':
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
      break
    case '3m':
      startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
      break
    case '6m':
      startDate = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000)
      break
    case '1y':
      startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000)
      break
    default:
      startDate = new Date(0)
  }
  
  return klineData.value.filter(item => new Date(item.time) >= startDate)
})

// [WHAT] 计算区间涨跌幅
const periodChange = computed(() => {
  if (chartType.value === 'kline' && filteredKlineData.value.length >= 2) {
    const first = filteredKlineData.value[0].open
    const last = filteredKlineData.value[filteredKlineData.value.length - 1].close
    return ((last - first) / first) * 100
  }
  if (filteredData.value.length < 2) return 0
  const first = filteredData.value[0].netValue
  const last = filteredData.value[filteredData.value.length - 1].netValue
  return ((last - first) / first) * 100
})

// [WHAT] 涨跌状态
const changeStatus = computed(() => {
  if (periodChange.value > 0) return 'up'
  if (periodChange.value < 0) return 'down'
  return 'flat'
})

// ========== K线数据加载 ==========
async function loadKlineData() {
  if (!props.fundCode) return
  klineLoading.value = true
  try {
    const days = activePeriod.value === 'all' ? 500 : 
                 activePeriod.value === '1y' ? 365 :
                 activePeriod.value === '6m' ? 180 :
                 activePeriod.value === '3m' ? 90 :
                 activePeriod.value === '1m' ? 30 : 7
    klineData.value = await fetchKLineData(props.fundCode, days)
  } catch (err) {
    console.error('加载K线数据失败:', err)
  } finally {
    klineLoading.value = false
  }
}

// ========== 图表初始化 ==========
function initChart() {
  // [EDGE] 等待 DOM 渲染完成
  if (!chartContainer.value) {
    console.warn('图表容器未准备好')
    return
  }
  
  // [WHY] 确保容器有正确的尺寸
  const containerWidth = chartContainer.value.clientWidth
  if (containerWidth <= 0) {
    console.warn('图表容器宽度为0，延迟初始化')
    setTimeout(initChart, 100)
    return
  }
  
  // 清除旧图表
  if (chart) {
    try {
      chart.remove()
    } catch (e) {
      console.warn('清除旧图表失败:', e)
    }
    chart = null
    areaSeries = null
    candlestickSeries = null
  }
  
  // 创建图表实例
  try {
    chart = createChart(chartContainer.value, {
      width: containerWidth,
      height: 220,
      layout: {
        background: { type: ColorType.Solid, color: '#ffffff' },
        textColor: '#999999',
      },
      grid: {
        vertLines: { color: '#f5f5f5' },
        horzLines: { color: '#f5f5f5' },
      },
      rightPriceScale: {
        borderColor: '#f0f0f0',
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderColor: '#f0f0f0',
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
      },
    })

    if (chartType.value === 'kline') {
      initKlineChart()
    } else {
      initAreaChart()
    }
    
    // 自适应容器大小
    const resizeObserver = new ResizeObserver(() => {
      if (chart && chartContainer.value) {
        chart.applyOptions({ width: chartContainer.value.clientWidth })
      }
    })
    resizeObserver.observe(chartContainer.value)
  } catch (err) {
    console.error('创建图表失败:', err)
  }
}

// [WHAT] 初始化面积图
function initAreaChart() {
  if (!chart) return
  
  const isUp = periodChange.value >= 0
  // @ts-ignore - lightweight-charts v5 API
  areaSeries = chart.addAreaSeries({
    lineColor: isUp ? '#e4393c' : '#1db82c',
    topColor: isUp ? 'rgba(228, 57, 60, 0.3)' : 'rgba(29, 184, 44, 0.3)',
    bottomColor: isUp ? 'rgba(228, 57, 60, 0.05)' : 'rgba(29, 184, 44, 0.05)',
    lineWidth: 2,
  })
  
  if (filteredData.value.length > 0) {
    // [WHY] lightweight-charts 需要时间格式为 YYYY-MM-DD 字符串
    const chartData = filteredData.value.map(item => ({
      time: item.date as string,  // 确保是字符串格式
      value: item.netValue
    }))
    
    try {
      areaSeries.setData(chartData as any)
      chart.timeScale().fitContent()
    } catch (err) {
      console.error('面积图数据设置失败:', err)
    }
  }
}

// [WHAT] 初始化K线图
function initKlineChart() {
  if (!chart) return
  
  // @ts-ignore - lightweight-charts v5 API
  candlestickSeries = chart.addCandlestickSeries({
    upColor: '#e4393c',
    downColor: '#1db82c',
    borderUpColor: '#e4393c',
    borderDownColor: '#1db82c',
    wickUpColor: '#e4393c',
    wickDownColor: '#1db82c',
  })
  
  if (filteredKlineData.value.length > 0) {
    // [WHY] lightweight-charts K线图需要 time 为 YYYY-MM-DD 格式
    const klineChartData = filteredKlineData.value.map(item => ({
      time: item.time as string,  // 确保是字符串格式
      open: item.open,
      high: item.high,
      low: item.low,
      close: item.close
    }))
    
    try {
      candlestickSeries.setData(klineChartData as any)
      chart.timeScale().fitContent()
    } catch (err) {
      console.error('K线图数据设置失败:', err)
    }
  }
}

// ========== 事件处理 ==========

// [WHAT] 切换图表类型
async function switchChartType(type: 'area' | 'kline') {
  chartType.value = type
  if (type === 'kline' && klineData.value.length === 0) {
    await loadKlineData()
  }
  await nextTick()
  initChart()
}

// [WHAT] 切换时间周期
async function selectPeriod(period: string) {
  activePeriod.value = period
  emit('periodChange', period)
  
  if (chartType.value === 'kline') {
    await loadKlineData()
  }
  await nextTick()
  initChart()
}

// ========== 生命周期 ==========
watch(() => props.data, () => {
  if (chart && chartType.value === 'area') {
    initChart()
  }
}, { deep: true })

watch(() => props.fundCode, () => {
  klineData.value = []
  if (chartType.value === 'kline') {
    loadKlineData()
  }
})

onMounted(() => {
  initChart()
})

onUnmounted(() => {
  if (chart) {
    chart.remove()
    chart = null
  }
})
</script>

<template>
  <div class="pro-chart">
    <!-- 图表类型切换 -->
    <div class="chart-type-tabs">
      <div
        v-for="t in chartTypes"
        :key="t.key"
        class="type-tab"
        :class="{ active: chartType === t.key }"
        @click="switchChartType(t.key as 'area' | 'kline')"
      >
        {{ t.label }}
      </div>
    </div>

    <!-- 时间周期选择器 -->
    <div class="period-tabs">
      <div
        v-for="p in periods"
        :key="p.key"
        class="period-tab"
        :class="{ active: activePeriod === p.key }"
        @click="selectPeriod(p.key)"
      >
        {{ p.label }}
      </div>
    </div>
    
    <!-- 区间涨跌信息 -->
    <div class="period-info">
      <span class="period-label">{{ periods.find(p => p.key === activePeriod)?.label }}涨跌</span>
      <span class="period-value" :class="changeStatus">
        {{ periodChange >= 0 ? '+' : '' }}{{ periodChange.toFixed(2) }}%
      </span>
    </div>
    
    <!-- 图表容器 -->
    <div class="chart-wrapper">
      <div v-if="loading || klineLoading" class="chart-loading">
        <van-loading size="24px">加载中...</van-loading>
      </div>
      <div v-else-if="(chartType === 'area' && filteredData.length === 0) || (chartType === 'kline' && filteredKlineData.length === 0)" class="chart-empty">
        暂无数据
      </div>
      <div v-else ref="chartContainer" class="chart-container"></div>
    </div>
    
    <!-- 数据统计 -->
    <div v-if="chartType === 'area' && filteredData.length > 0" class="chart-stats">
      <div class="stat-item">
        <span class="stat-label">最高</span>
        <span class="stat-value">{{ Math.max(...filteredData.map(d => d.netValue)).toFixed(4) }}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">最低</span>
        <span class="stat-value">{{ Math.min(...filteredData.map(d => d.netValue)).toFixed(4) }}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">数据点</span>
        <span class="stat-value">{{ filteredData.length }}</span>
      </div>
    </div>
    <div v-else-if="chartType === 'kline' && filteredKlineData.length > 0" class="chart-stats">
      <div class="stat-item">
        <span class="stat-label">最高</span>
        <span class="stat-value">{{ Math.max(...filteredKlineData.map(d => d.high)).toFixed(4) }}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">最低</span>
        <span class="stat-value">{{ Math.min(...filteredKlineData.map(d => d.low)).toFixed(4) }}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">K线数</span>
        <span class="stat-value">{{ filteredKlineData.length }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pro-chart {
  background: #fff;
  padding: 16px;
}

/* 图表类型切换 */
.chart-type-tabs {
  display: flex;
  gap: 12px;
  margin-bottom: 12px;
}

.type-tab {
  padding: 6px 16px;
  font-size: 14px;
  color: #666;
  background: #f5f5f5;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
}

.type-tab.active {
  color: #fff;
  background: #1989fa;
}

/* 时间周期选择器 */
.period-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
  overflow-x: auto;
}

.period-tab {
  padding: 6px 12px;
  font-size: 13px;
  color: #666;
  background: #f5f5f5;
  border-radius: 16px;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.2s;
}

.period-tab.active {
  color: #1989fa;
  background: rgba(25, 137, 250, 0.1);
  font-weight: 500;
}

/* 区间涨跌信息 */
.period-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.period-label {
  font-size: 14px;
  color: #666;
}

.period-value {
  font-size: 18px;
  font-weight: 600;
}

.period-value.up { color: #e4393c; }
.period-value.down { color: #1db82c; }
.period-value.flat { color: #999; }

/* 图表容器 */
.chart-wrapper {
  position: relative;
  min-height: 220px;
}

.chart-container {
  width: 100%;
  height: 220px;
}

.chart-loading,
.chart-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 220px;
  color: #999;
}

/* 数据统计 */
.chart-stats {
  display: flex;
  justify-content: space-around;
  padding-top: 16px;
  border-top: 1px solid #f0f0f0;
  margin-top: 16px;
}

.stat-item {
  text-align: center;
}

.stat-label {
  display: block;
  font-size: 12px;
  color: #999;
  margin-bottom: 4px;
}

.stat-value {
  font-size: 14px;
  color: #333;
  font-weight: 500;
}
</style>
