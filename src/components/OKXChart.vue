<script setup lang="ts">
// [WHY] 专业交易所风格图表组件
// [WHAT] 深色主题、实时K线图、成交量柱状图、时间周期选择
// [HOW] Canvas绘制，requestAnimationFrame实现流畅实时动画

import { ref, onMounted, onUnmounted, watch, computed, nextTick } from 'vue'
import { fetchSimpleKLineData, calculatePeriodReturns, clearFundCache, type SimpleKLineData, type PeriodReturn } from '@/api/fundFast'
import { useThemeStore } from '@/stores/theme'

const props = defineProps<{
  fundCode: string
  realtimeValue: number
  realtimeChange: number
  lastClose: number
}>()

const themeStore = useThemeStore()

// [WHY] 根据主题获取颜色
function getThemeColors() {
  const isDark = themeStore.actualTheme === 'dark'
  return {
    bgPrimary: isDark ? '#0b0e11' : '#ffffff',
    bgSecondary: isDark ? '#1e2329' : '#f5f5f5',
    textPrimary: isDark ? '#eaecef' : '#1a1a1a',
    textSecondary: isDark ? '#848e9c' : '#666666',
    borderColor: isDark ? '#2b3139' : '#e0e0e0',
    gridColor: isDark ? '#1e2329' : '#f0f0f0',
    upColor: '#f6465d',
    downColor: '#0ecb81',
  }
}

// ========== 状态 ==========
const chartData = ref<SimpleKLineData[]>([])
const periodReturns = ref<PeriodReturn[]>([])
const isLoading = ref(false)
const activePeriod = ref('5d') // 默认显示5日K线
const canvasRef = ref<HTMLCanvasElement | null>(null)

// [WHAT] 分时数据
interface IntradayPoint {
  time: string
  value: number
  volume: number // 模拟成交量
}
const intradayData = ref<IntradayPoint[]>([])
const baseValue = ref(0)

// [WHAT] 昨日数据（用于当日模式显示参考线）
const yesterdayData = ref<SimpleKLineData[]>([])

// [WHAT] 时间周期配置（适配基金每日净值数据）
const periods = [
  { key: '1d', label: '当日', days: 0 },    // 当日实时走势
  { key: '5d', label: '5日', days: 5 },     // 近5个交易日
  { key: '1m', label: '1月', days: 30 },    // 近1个月
  { key: '3m', label: '3月', days: 90 },    // 近3个月
  { key: '6m', label: '6月', days: 180 },   // 近6个月
  { key: '1y', label: '1年', days: 365 },   // 近1年
]

// [WHAT] 判断是否是当日分时模式
const isIntradayMode = computed(() => activePeriod.value === '1d')

// [WHAT] 只有当日模式且有实时数据时才显示分时图样式
// [WHY] 如果没有实时数据，使用K线样式显示历史数据
const showIntradayChart = computed(() => {
  if (!isIntradayMode.value) return false
  // 有分时数据或有实时估值才显示分时图
  return intradayData.value.length > 0 || props.realtimeValue > 0
})

// [WHAT] 过滤数据
const filteredData = computed(() => {
  const currentPeriod = activePeriod.value // [WHY] 显式依赖，确保响应式
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  
  // [WHY] 当日分时模式
  if (showIntradayChart.value) {
    // 如果有实时数据，使用实时数据
    if (intradayData.value.length > 0) {
      return intradayData.value.map(p => ({
        time: p.time,
        value: p.value,
        change: baseValue.value > 0 ? ((p.value - baseValue.value) / baseValue.value) * 100 : 0,
        volume: p.volume
      }))
    }
    
    // [WHY] 没有实时数据时，检查是否有有效的估值
    if (props.realtimeValue > 0) {
      const base = baseValue.value || props.lastClose || props.realtimeValue
      const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
      return [{
        time: timeStr,
        value: props.realtimeValue,
        change: base > 0 ? ((props.realtimeValue - base) / base) * 100 : 0,
        volume: 50
      }]
    }
    
    // [WHY] 估值也没有时，使用最近5天的K线数据作为替代显示
    console.log('[当日模式] 无实时数据，使用K线数据替代')
    const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000)
    const fallbackData = chartData.value
      .filter(item => new Date(item.time) >= fiveDaysAgo)
      .map((item, i) => ({ 
        ...item, 
        volume: 50 + Math.abs(item.change) * 30 + (i % 5) * 10
      }))
    
    // [WHY] 如果连K线数据都没有，返回一个占位数据防止图表空白
    if (fallbackData.length === 0) {
      return [{
        time: today,
        value: 1,
        change: 0,
        volume: 50
      }]
    }
    return fallbackData
  }
  
  // [WHY] 其他情况统一使用K线数据
  const period = periods.find(p => p.key === currentPeriod)
  // 当日模式但数据不足时，显示5日K线
  const days = (period?.days === 0 || !period) ? 5 : period.days
  
  const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
  
  let data = chartData.value
    .filter(item => new Date(item.time) >= startDate)
    .map((item, i) => ({ 
      ...item, 
      volume: 50 + Math.abs(item.change) * 30 + (i % 5) * 10
    }))
  
  // [WHY] 实时更新当日K线数据点
  if (props.realtimeValue > 0 && data.length > 0) {
    const lastIndex = data.length - 1
    const lastItem = data[lastIndex]!
    
    if (lastItem.time === today) {
      data = [...data.slice(0, lastIndex), {
        ...lastItem,
        value: props.realtimeValue,
        change: props.realtimeChange,
        volume: lastItem.volume
      }]
    } else {
      data = [...data, {
        time: today,
        value: props.realtimeValue,
        change: props.realtimeChange,
        volume: 50 + Math.abs(props.realtimeChange) * 30
      }]
    }
  }
  
  return data
})

// [WHAT] 当前涨跌
const currentChange = computed(() => {
  if (isIntradayMode.value && baseValue.value > 0 && props.realtimeValue > 0) {
    return ((props.realtimeValue - baseValue.value) / baseValue.value) * 100
  }
  return props.realtimeChange || 0
})

// [WHAT] 统计数据
const stats = computed(() => {
  const data = filteredData.value
  if (data.length === 0) return { open: 0, high: 0, low: 0, close: 0 }
  const values = data.map(d => d.value)
  return {
    open: data[0]?.value || 0,
    high: Math.max(...values),
    low: Math.min(...values),
    close: data[data.length - 1]?.value || 0
  }
})

// ========== 分时数据 ==========
function addIntradayPoint(value: number) {
  if (!value || value <= 0) return
  
  const now = new Date()
  const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`
  
  if (baseValue.value === 0) {
    baseValue.value = props.lastClose || value
  }
  
  // 模拟成交量（基于价格变化）
  const lastValue = intradayData.value.length > 0 ? intradayData.value[intradayData.value.length - 1]!.value : value
  const priceChange = Math.abs(value - lastValue)
  const volume = 100 + priceChange * 10000 + Math.random() * 50
  
  const maxPoints = 500
  if (intradayData.value.length >= maxPoints) {
    intradayData.value = intradayData.value.slice(-maxPoints + 1)
  }
  
  intradayData.value.push({ time: timeStr, value, volume })
}

function resetIntradayData() {
  intradayData.value = []
  baseValue.value = props.lastClose || 0
}

// ========== 数据加载 ==========
async function loadData() {
  if (!props.fundCode) return
  
  isLoading.value = true
  try {
    clearFundCache(props.fundCode)
    
    const [kline, returns] = await Promise.all([
      fetchSimpleKLineData(props.fundCode, 400),
      calculatePeriodReturns(props.fundCode)
    ])
    
    chartData.value = kline
    periodReturns.value = returns
    
    // [WHAT] 提取昨日数据用于当日模式显示
    // [WHY] 获取最近2天的数据，第一条是昨天
    if (kline.length >= 2) {
      // 获取昨日完整走势（模拟，基金只有日终净值）
      const yesterdayValue = kline[1]?.value || 0
      const beforeYesterdayValue = kline[2]?.value || yesterdayValue
      // [WHAT] 生成昨日模拟分时数据（用于参考线）
      yesterdayData.value = generateYesterdayIntraday(beforeYesterdayValue, yesterdayValue, kline[1]?.time || '')
    }
    
    await nextTick()
    drawChart()
  } catch (err) {
    console.error('加载图表数据失败:', err)
  } finally {
    isLoading.value = false
  }
}

// [WHAT] 生成昨日模拟分时数据
// [WHY] 基金没有真实分时数据，用开收盘净值模拟一条平滑曲线
function generateYesterdayIntraday(openValue: number, closeValue: number, date: string): SimpleKLineData[] {
  const points: SimpleKLineData[] = []
  const steps = 20 // 模拟20个时间点
  
  for (let i = 0; i <= steps; i++) {
    const progress = i / steps
    // [WHAT] 使用正弦曲线模拟日内波动
    const wave = Math.sin(progress * Math.PI * 2) * 0.002 * openValue
    const value = openValue + (closeValue - openValue) * progress + wave
    points.push({
      time: date,
      value: value,
      change: openValue > 0 ? ((value - openValue) / openValue) * 100 : 0
    })
  }
  return points
}

// ========== Canvas绘图（专业风格） ==========
function drawChart() {
  const canvas = canvasRef.value
  if (!canvas) {
    setTimeout(drawChart, 50)
    return
  }
  
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  
  const data = filteredData.value
  if (data.length === 0) return
  
  const dpr = window.devicePixelRatio || 1
  const rect = canvas.getBoundingClientRect()
  
  if (rect.width === 0 || rect.height === 0) {
    setTimeout(drawChart, 50)
    return
  }
  
  canvas.width = rect.width * dpr
  canvas.height = rect.height * dpr
  ctx.scale(dpr, dpr)
  
  const width = rect.width
  const height = rect.height
  
  // [WHAT] 布局：分时图占满高度，K线图有成交量区
  let mainHeight: number
  let volumeHeight: number
  let volumeTop: number
  
  // [WHY] 曲线图布局：图表占满高度，不显示成交量
  mainHeight = height - 25 // 留出底部X轴空间
  volumeHeight = 0
  volumeTop = height
  
  const padding = { top: 15, right: 60, bottom: 25, left: 55 }
  const chartWidth = width - padding.left - padding.right
  
  // [WHY] 获取当前主题颜色
  const colors = getThemeColors()
  
  // 清除画布
  ctx.fillStyle = colors.bgPrimary
  ctx.fillRect(0, 0, width, height)
  
  // 计算价格范围
  const values = data.map(d => d.value)
  let minValue = Math.min(...values)
  let maxValue = Math.max(...values)
  
  // [WHY] 价格范围增加边距，让曲线不贴边
  const margin = (maxValue - minValue) * 0.1 || 0.01
  minValue -= margin
  maxValue += margin
  
  const valueRange = maxValue - minValue || 1
  
  // 成交量范围
  const volumes = data.map(d => (d as any).volume || 0)
  const maxVolume = Math.max(...volumes, 1)
  
  // ========== 绘制网格线 ==========
  ctx.strokeStyle = colors.gridColor
  ctx.lineWidth = 1
  
  // 水平网格线（主图区）
  for (let i = 0; i <= 4; i++) {
    const y = padding.top + (mainHeight - padding.top) * i / 4
    ctx.beginPath()
    ctx.moveTo(padding.left, y)
    ctx.lineTo(width - padding.right, y)
    ctx.stroke()
  }
  
  // ========== 绘制Y轴刻度（右侧） ==========
  ctx.fillStyle = colors.textSecondary
  ctx.font = '10px Arial'
  ctx.textAlign = 'left'
  
  for (let i = 0; i <= 4; i++) {
    const value = maxValue - valueRange * i / 4
    const y = padding.top + (mainHeight - padding.top) * i / 4
    ctx.fillText(value.toFixed(4), width - padding.right + 5, y + 3)
  }
  
  // ========== 绘制价格线/K线 ==========
  const isUp = currentChange.value >= 0
  // [WHY] 国内股市/基金习惯：红涨绿跌
  const upColor = colors.upColor
  const downColor = colors.downColor
  const lineColor = isUp ? upColor : downColor
  
  // [WHY] 当日模式显示昨日+今日双曲线，其他模式显示历史曲线
  const chartBottom = mainHeight
  const firstValue = data[0]?.value || 0
  const lastValue = data[data.length - 1]?.value || 0
  const isOverallUp = lastValue >= firstValue
  
  // ========== 当日模式：绘制昨日参考曲线 ==========
  if (isIntradayMode.value && yesterdayData.value.length > 0) {
    // [WHAT] 计算中间分隔线位置（昨日和今日各占一半）
    const midX = padding.left + chartWidth / 2
    
    // [WHAT] 绘制日期分隔线
    ctx.beginPath()
    ctx.setLineDash([4, 4])
    ctx.strokeStyle = colors.borderColor
    ctx.moveTo(midX, padding.top)
    ctx.lineTo(midX, chartBottom)
    ctx.stroke()
    ctx.setLineDash([])
    
    // [WHAT] 绘制昨日曲线（左半部分，灰色虚线）
    const yesterdayPoints = yesterdayData.value
    const halfWidth = chartWidth / 2 - 10 // 留出间距
    
    ctx.beginPath()
    ctx.setLineDash([3, 3])
    yesterdayPoints.forEach((point, i) => {
      const x = padding.left + (halfWidth / Math.max(yesterdayPoints.length - 1, 1)) * i
      const y = padding.top + (mainHeight - padding.top) * (1 - (point.value - minValue) / valueRange)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.strokeStyle = colors.textSecondary
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.setLineDash([])
    
    // [WHAT] 绘制日期标签
    ctx.fillStyle = colors.textSecondary
    ctx.font = '10px Arial'
    ctx.textAlign = 'center'
    
    // 昨日日期
    if (yesterdayPoints[0]?.time) {
      const parts = yesterdayPoints[0].time.split('-')
      const yesterdayLabel = parts.length >= 3 ? `${parts[1]}-${parts[2]}` : '昨日'
      ctx.fillText(yesterdayLabel, padding.left + halfWidth / 2, padding.top - 5)
    }
    
    // 今日日期
    const now = new Date()
    const todayLabel = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    ctx.fillText(todayLabel, midX + halfWidth / 2 + 10, padding.top - 5)
    
    // [WHAT] 绘制今日曲线（右半部分）
    ctx.beginPath()
    const todayStartX = midX + 10
    
    // 今日填充
    ctx.moveTo(todayStartX, chartBottom)
    data.forEach((point, i) => {
      const x = todayStartX + (halfWidth / Math.max(data.length - 1, 1)) * i
      const y = padding.top + (mainHeight - padding.top) * (1 - (point.value - minValue) / valueRange)
      ctx.lineTo(x, y)
    })
    const todayEndX = todayStartX + halfWidth
    ctx.lineTo(todayEndX, chartBottom)
    ctx.closePath()
    
    const fillGradient = ctx.createLinearGradient(0, padding.top, 0, chartBottom)
    if (isOverallUp) {
      fillGradient.addColorStop(0, 'rgba(246, 70, 93, 0.25)')
      fillGradient.addColorStop(1, 'rgba(246, 70, 93, 0)')
    } else {
      fillGradient.addColorStop(0, 'rgba(14, 203, 129, 0.25)')
      fillGradient.addColorStop(1, 'rgba(14, 203, 129, 0)')
    }
    ctx.fillStyle = fillGradient
    ctx.fill()
    
    // 今日曲线
    ctx.beginPath()
    data.forEach((point, i) => {
      const x = todayStartX + (halfWidth / Math.max(data.length - 1, 1)) * i
      const y = padding.top + (mainHeight - padding.top) * (1 - (point.value - minValue) / valueRange)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.strokeStyle = isOverallUp ? upColor : downColor
    ctx.lineWidth = 2
    ctx.stroke()
    
    // 今日最新点动画
    if (data.length > 0) {
      const lastPoint = data[data.length - 1]!
      const lastPointX = todayStartX + halfWidth * Math.min(data.length / 20, 1) // 根据数据量调整位置
      const lastPointY = padding.top + (mainHeight - padding.top) * (1 - (lastPoint.value - minValue) / valueRange)
      
      const pulseSize = 3 + Math.sin(Date.now() / 200) * 1.5
      ctx.beginPath()
      ctx.arc(lastPointX, lastPointY, pulseSize, 0, Math.PI * 2)
      ctx.fillStyle = isOverallUp ? upColor : downColor
      ctx.fill()
      
      ctx.beginPath()
      ctx.arc(lastPointX, lastPointY, pulseSize + 3, 0, Math.PI * 2)
      ctx.strokeStyle = isOverallUp ? upColor : downColor
      ctx.lineWidth = 1
      ctx.globalAlpha = 0.4
      ctx.stroke()
      ctx.globalAlpha = 1
    }
  } else {
    // ========== 非当日模式：标准曲线图 ==========
    
    // 绘制填充区域（曲线下方到底部）
    ctx.beginPath()
    ctx.moveTo(padding.left, chartBottom)
    
    data.forEach((point, i) => {
      const x = padding.left + (chartWidth / Math.max(data.length - 1, 1)) * i
      const y = padding.top + (mainHeight - padding.top) * (1 - (point.value - minValue) / valueRange)
      ctx.lineTo(x, y)
    })
    
    // 闭合路径
    const lastX = padding.left + chartWidth
    ctx.lineTo(lastX, chartBottom)
    ctx.closePath()
    
    // 填充渐变
    const fillGradient = ctx.createLinearGradient(0, padding.top, 0, chartBottom)
    if (isOverallUp) {
      fillGradient.addColorStop(0, 'rgba(246, 70, 93, 0.25)')
      fillGradient.addColorStop(0.5, 'rgba(246, 70, 93, 0.1)')
      fillGradient.addColorStop(1, 'rgba(246, 70, 93, 0)')
    } else {
      fillGradient.addColorStop(0, 'rgba(14, 203, 129, 0.25)')
      fillGradient.addColorStop(0.5, 'rgba(14, 203, 129, 0.1)')
      fillGradient.addColorStop(1, 'rgba(14, 203, 129, 0)')
    }
    ctx.fillStyle = fillGradient
    ctx.fill()
    
    // 绘制走势曲线
    ctx.beginPath()
    data.forEach((point, i) => {
      const x = padding.left + (chartWidth / Math.max(data.length - 1, 1)) * i
      const y = padding.top + (mainHeight - padding.top) * (1 - (point.value - minValue) / valueRange)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.strokeStyle = isOverallUp ? upColor : downColor
    ctx.lineWidth = 2
    ctx.stroke()
    
    // 绘制最新点动画
    if (data.length > 0) {
      const lastPoint = data[data.length - 1]!
      const lastPointX = padding.left + chartWidth
      const lastPointY = padding.top + (mainHeight - padding.top) * (1 - (lastPoint.value - minValue) / valueRange)
      
      const pulseSize = 3 + Math.sin(Date.now() / 200) * 1.5
      ctx.beginPath()
      ctx.arc(lastPointX, lastPointY, pulseSize, 0, Math.PI * 2)
      ctx.fillStyle = isOverallUp ? upColor : downColor
      ctx.fill()
      
      ctx.beginPath()
      ctx.arc(lastPointX, lastPointY, pulseSize + 3, 0, Math.PI * 2)
      ctx.strokeStyle = isOverallUp ? upColor : downColor
      ctx.lineWidth = 1
      ctx.globalAlpha = 0.4
      ctx.stroke()
      ctx.globalAlpha = 1
    }
  }
  
  // ========== 绘制X轴时间标签 ==========
  ctx.fillStyle = colors.textSecondary
  ctx.font = '10px Arial'
  ctx.textAlign = 'center'
  
  // [WHY] 当日模式的 X 轴标签已在上面绘制（昨日/今日日期）
  if (!isIntradayMode.value || yesterdayData.value.length === 0) {
    const labelCount = Math.min(5, data.length)
    for (let i = 0; i < labelCount; i++) {
      const idx = Math.floor((data.length - 1) * i / Math.max(labelCount - 1, 1))
      const point = data[idx]
      if (!point) continue
      const x = padding.left + (chartWidth / Math.max(data.length - 1, 1)) * idx
      
      // [WHAT] 显示时间标签
      const parts = point.time.split('-')
      const label = parts.length >= 3 ? `${parts[1]}-${parts[2]}` : point.time.slice(-5)
      ctx.fillText(label, x, height - 5)
    }
  } else {
    // [WHAT] 当日模式：显示固定时间标签
    const midX = padding.left + chartWidth / 2
    ctx.fillText('09:30', padding.left + 20, height - 5)
    ctx.fillText('15:00', midX - 20, height - 5)
    ctx.fillText('09:30', midX + 20, height - 5)
    ctx.fillText('15:00', padding.left + chartWidth - 20, height - 5)
  }
}

function formatVolume(v: number): string {
  if (v >= 1000000) return (v / 1000000).toFixed(1) + 'M'
  if (v >= 1000) return (v / 1000).toFixed(1) + 'K'
  return v.toFixed(0)
}

// ========== 事件处理 ==========
function selectPeriod(key: string) {
  // [WHY] 先停止动画，避免旧数据干扰
  stopAnimation()
  
  // [WHY] 当日模式重置分时数据并添加当前点
  if (key === '1d') {
    resetIntradayData()
    // 确保添加至少一个数据点
    const val = props.realtimeValue || props.lastClose || 1
    if (val > 0) {
      addIntradayPoint(val)
    }
  }
  
  // [WHY] 更新周期
  activePeriod.value = key
  
  // [WHY] 使用 nextTick 确保 Vue 响应式更新完成后再绘图
  nextTick(() => {
    drawChart()
    startAnimation()
  })
}

// ========== 动画 ==========
let animationFrame: number | null = null

function startAnimation() {
  if (animationFrame) return
  
  let lastTime = 0
  function animate(time: number) {
    // [WHY] 所有模式都持续动画，实现K线实时走动
    if (time - lastTime > 33) { // 约30fps
      lastTime = time
      drawChart()
    }
    animationFrame = requestAnimationFrame(animate)
  }
  
  animationFrame = requestAnimationFrame(animate)
}

function stopAnimation() {
  if (animationFrame) {
    cancelAnimationFrame(animationFrame)
    animationFrame = null
  }
}

// ========== 生命周期 ==========
watch(() => props.fundCode, () => {
  resetIntradayData()
  loadData()
}, { immediate: true })

watch(() => props.realtimeValue, (newVal) => {
  if (newVal && newVal > 0) {
    // [WHY] 分时模式累积数据点，K线模式由computed自动更新
    if (isIntradayMode.value) {
      addIntradayPoint(newVal)
    }
    // 动画循环会自动重绘，无需手动调用
  }
})

watch(() => props.lastClose, (newVal) => {
  if (newVal && newVal > 0 && baseValue.value === 0) {
    baseValue.value = newVal
  }
})

// [WHY] 监控周期变化，强制重绘
watch(activePeriod, () => {
  nextTick(drawChart)
})

// [WHY] 监控主题变化，重绘图表
watch(() => themeStore.actualTheme, () => {
  nextTick(drawChart)
})

let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  if (canvasRef.value) {
    resizeObserver = new ResizeObserver(() => drawChart())
    resizeObserver.observe(canvasRef.value.parentElement!)
  }
  
  if (props.realtimeValue > 0) {
    addIntradayPoint(props.realtimeValue)
  }
  
  // [WHY] 所有模式都启用动画，实现实时走动
  setTimeout(startAnimation, 500)
})

onUnmounted(() => {
  stopAnimation()
  resizeObserver?.disconnect()
})
</script>

<template>
  <div class="pro-chart">
    <!-- 时间周期选择器 -->
    <div class="period-selector">
      <div
        v-for="p in periods"
        :key="p.key"
        class="period-btn"
        :class="{ active: activePeriod === p.key }"
        @click.stop="selectPeriod(p.key)"
      >
        {{ p.label }}
      </div>
      <div class="period-tools">
        <span class="tool-label">实时</span>
        <span class="live-dot"></span>
      </div>
    </div>

    <!-- OHLC信息栏 -->
    <div class="ohlc-bar">
      <span class="ohlc-item">
        <span class="ohlc-label">开</span>
        <span class="ohlc-value">{{ stats.open.toFixed(4) }}</span>
      </span>
      <span class="ohlc-item">
        <span class="ohlc-label">高</span>
        <span class="ohlc-value up">{{ stats.high.toFixed(4) }}</span>
      </span>
      <span class="ohlc-item">
        <span class="ohlc-label">低</span>
        <span class="ohlc-value down">{{ stats.low.toFixed(4) }}</span>
      </span>
      <span class="ohlc-item">
        <span class="ohlc-label">收</span>
        <span class="ohlc-value" :class="currentChange >= 0 ? 'up' : 'down'">
          {{ realtimeValue > 0 ? realtimeValue.toFixed(4) : stats.close.toFixed(4) }}
        </span>
      </span>
      <span class="ohlc-item">
        <span class="ohlc-label">涨跌</span>
        <span class="ohlc-value" :class="currentChange >= 0 ? 'up' : 'down'">
          {{ currentChange >= 0 ? '+' : '' }}{{ currentChange.toFixed(2) }}%
        </span>
      </span>
    </div>

    <!-- 图表区域 -->
    <div class="chart-container">
      <div v-if="isLoading" class="chart-loading">
        <van-loading size="24px" color="#0ecb81">加载中...</van-loading>
      </div>
      <canvas v-else ref="canvasRef" class="chart-canvas"></canvas>
    </div>

    <!-- 成交量标签 -->
    <div class="volume-label">
      <span>成交量(Volume)</span>
      <span class="volume-value">{{ formatVolume((filteredData[filteredData.length - 1] as any)?.volume || 0) }}</span>
    </div>

    <!-- 阶段涨幅 -->
    <div v-if="periodReturns.length > 0" class="returns-bar">
      <div v-for="r in periodReturns" :key="r.period" class="return-item">
        <span class="return-label">{{ r.label }}</span>
        <span class="return-value" :class="r.change >= 0 ? 'up' : 'down'">
          {{ r.change >= 0 ? '+' : '' }}{{ r.change.toFixed(2) }}%
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ========== 移动端适配 + 主题支持 ========== */
/* [WHY] 使用CSS变量实现黑白主题切换 */

.pro-chart {
  background: var(--bg-primary);
  border-bottom: 1px solid var(--border-color);
  overscroll-behavior: contain;
  transition: background-color 0.3s;
}

/* 时间周期选择器 */
.period-selector {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  gap: 2px;
  border-bottom: 1px solid var(--border-color);
  overflow-x: auto;
  scrollbar-width: none;
  -ms-overflow-style: none;
  -webkit-overflow-scrolling: touch;
}

.period-selector::-webkit-scrollbar {
  display: none;
}

.period-btn {
  min-height: 36px;
  min-width: 44px;
  padding: 8px 14px;
  font-size: 14px;
  color: var(--text-secondary);
  background: transparent;
  border-radius: 6px;
  white-space: nowrap;
  cursor: pointer;
  transition: all 0.15s ease;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
  user-select: none;
}

.period-btn:active {
  transform: scale(0.95);
  opacity: 0.8;
}

.period-btn.active {
  color: var(--color-primary);
  background: var(--color-primary-bg);
  font-weight: 500;
}

.period-tools {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.tool-label {
  font-size: 12px;
  color: var(--color-down);
  padding: 5px 10px;
  background: var(--color-down-bg);
  border-radius: 4px;
}

.live-dot {
  width: 8px;
  height: 8px;
  background: var(--color-down);
  border-radius: 50%;
  animation: pulse 1.5s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(1.3); }
}

/* OHLC信息栏 */
.ohlc-bar {
  display: flex;
  gap: 12px;
  padding: 10px 12px;
  font-size: 13px;
  border-bottom: 1px solid var(--border-color);
  overflow-x: auto;
  scrollbar-width: none;
  -ms-overflow-style: none;
  -webkit-overflow-scrolling: touch;
}

.ohlc-bar::-webkit-scrollbar {
  display: none;
}

.ohlc-item {
  display: flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
  flex-shrink: 0;
}

.ohlc-label {
  color: var(--text-secondary);
}

.ohlc-value {
  font-family: -apple-system, 'SF Mono', 'Roboto Mono', monospace;
  color: var(--text-primary);
  font-weight: 500;
}

/* [WHY] 红涨绿跌 */
.ohlc-value.up { color: var(--color-up); }
.ohlc-value.down { color: var(--color-down); }

/* 图表容器 */
.chart-container {
  position: relative;
  /* [WHY] 使用vw单位适配不同屏幕 */
  height: max(200px, 45vw);
  max-height: 320px;
  /* [WHY] 防止图表区域意外滚动 */
  touch-action: pan-x pan-y;
}

.chart-canvas {
  width: 100%;
  height: 100%;
  /* [WHY] 防止Canvas模糊 */
  image-rendering: -webkit-optimize-contrast;
}

.chart-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}

/* 成交量标签 */
.volume-label {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  font-size: 12px;
  color: var(--text-secondary);
  border-top: 1px solid var(--border-color);
}

.volume-value {
  font-family: -apple-system, 'SF Mono', 'Roboto Mono', monospace;
  color: var(--text-primary);
}

/* 阶段涨幅 */
.returns-bar {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(60px, 1fr));
  gap: 8px;
  padding: 12px;
  border-top: 1px solid var(--border-color);
}

.return-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 4px;
}

.return-label {
  font-size: 12px;
  color: var(--text-secondary);
}

.return-value {
  font-size: 14px;
  font-weight: 600;
  font-family: -apple-system, 'SF Mono', 'Roboto Mono', monospace;
}

/* [WHY] 红涨绿跌 */
.return-value.up { color: var(--color-up); }
.return-value.down { color: var(--color-down); }

/* ========== 响应式适配 ========== */
@media screen and (max-width: 375px) {
  /* 小屏手机（iPhone SE等） */
  .period-btn {
    padding: 6px 10px;
    font-size: 13px;
    min-width: 40px;
  }
  
  .ohlc-bar {
    gap: 8px;
    font-size: 12px;
  }
  
  .chart-container {
    height: 200px;
  }
  
  .returns-bar {
    grid-template-columns: repeat(3, 1fr);
  }
}

@media screen and (min-width: 414px) {
  /* 大屏手机（iPhone Plus/Max等） */
  .period-btn {
    padding: 10px 16px;
    font-size: 15px;
  }
  
  .chart-container {
    height: 280px;
  }
}

/* [WHY] 安全区域适配（刘海屏、底部横条） */
@supports (padding-bottom: env(safe-area-inset-bottom)) {
  .pro-chart {
    padding-bottom: env(safe-area-inset-bottom);
  }
}
</style>
