<script setup lang="ts">
// [WHY] 专业交易所风格图表组件
// [WHAT] 深色主题、实时K线图、成交量柱状图、时间周期选择
// [HOW] Canvas绘制，requestAnimationFrame实现流畅实时动画

import { ref, onMounted, onUnmounted, watch, computed, nextTick } from 'vue'
import { fetchSimpleKLineData, calculatePeriodReturns, clearFundCache, type SimpleKLineData, type PeriodReturn } from '@/api/fundFast'
import { useThemeStore } from '@/stores/theme'
import { isTradingTime } from '@/api/tiantianApi'

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
// [WHY] 当日模式显示昨日数据 + 今日估值
const showIntradayChart = computed(() => isIntradayMode.value)

// [WHAT] 过滤数据
const filteredData = computed(() => {
  const currentPeriod = activePeriod.value // [WHY] 显式依赖，确保响应式
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  
  // [WHY] 当日模式：显示今日数据 + 实时估值
  if (showIntradayChart.value) {
    // [WHAT] 获取最近两天的数据（昨日 + 今日）
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000)
    let data = chartData.value
      .filter(item => new Date(item.time) >= twoDaysAgo)
      .map((item, i) => ({ 
        ...item, 
        volume: 50 + Math.abs(item.change) * 30 + (i % 5) * 10
      }))
    
    // [WHAT] 如果有实时估值且今天没有数据，添加今日数据点
    const hasTodayData = data.some(d => d.time === today)
    if (!hasTodayData && props.realtimeValue > 0) {
      data = [...data, {
        time: today,
        value: props.realtimeValue,
        change: props.realtimeChange,
        volume: 100
      }]
    } else if (hasTodayData && props.realtimeValue > 0) {
      // [WHAT] 更新今日数据为实时值
      data = data.map(d => d.time === today ? {
        ...d,
        value: props.realtimeValue,
        change: props.realtimeChange
      } : d)
    }
    
    // [EDGE] 如果没有数据，返回占位数据
    if (data.length === 0) {
      return [{
        time: today,
        value: props.lastClose || props.realtimeValue || 1,
        change: 0,
        volume: 50
      }]
    }
    
    return data
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
    
    
    await nextTick()
    drawChart()
  } catch (err) {
    console.error('加载图表数据失败:', err)
  } finally {
    isLoading.value = false
  }
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
  
  // [WHY] 计算整体涨跌
  const chartBottom = mainHeight
  const firstValue = data[0]?.value || 0
  const lastValue = data[data.length - 1]?.value || 0
  const isOverallUp = lastValue >= firstValue
  
  // [WHAT] 获取今日日期
  const now = new Date()
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  
  // ========== 当日模式特殊处理 ==========
  // [WHY] 非交易时间显示完整曲线，交易时间无数据时显示"等待开盘"
  const isTrading = isTradingTime()
  const hasRealtimeData = props.realtimeValue > 0
  const showWaitingState = isIntradayMode.value && isTrading && !hasRealtimeData
  
  if (isIntradayMode.value && data.length > 0 && showWaitingState) {
    // [WHAT] 交易时间但无实时数据：显示历史曲线 + 等待开盘
    ctx.beginPath()
    ctx.setLineDash([4, 4])
    data.forEach((point, i) => {
      const x = padding.left + (chartWidth / Math.max(data.length - 1, 1)) * i
      const y = padding.top + (mainHeight - padding.top) * (1 - (point.value - minValue) / valueRange)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.strokeStyle = colors.textSecondary
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.setLineDash([])
    
    // [WHAT] 绘制历史数据点
    data.forEach((point, i) => {
      const x = padding.left + (chartWidth / Math.max(data.length - 1, 1)) * i
      const y = padding.top + (mainHeight - padding.top) * (1 - (point.value - minValue) / valueRange)
      ctx.beginPath()
      ctx.arc(x, y, 3, 0, Math.PI * 2)
      ctx.fillStyle = colors.textSecondary
      ctx.fill()
    })
    
    // [WHAT] 在最后一个点右侧显示"等待开盘"
    const lastPoint = data[data.length - 1]!
    const lastX = padding.left + chartWidth
    const lastY = padding.top + (mainHeight - padding.top) * (1 - (lastPoint.value - minValue) / valueRange)
    
    // 绘制虚线延伸到右侧
    ctx.beginPath()
    ctx.setLineDash([4, 4])
    const prevX = padding.left + (chartWidth / Math.max(data.length - 1, 1)) * (data.length - 1)
    const prevY = padding.top + (mainHeight - padding.top) * (1 - (lastPoint.value - minValue) / valueRange)
    ctx.moveTo(prevX, prevY)
    ctx.lineTo(lastX, lastY)
    ctx.strokeStyle = colors.textSecondary
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.setLineDash([])
    
    // 显示"等待开盘"文字
    ctx.fillStyle = colors.textSecondary
    ctx.font = '12px Arial'
    ctx.textAlign = 'center'
    ctx.fillText('等待开盘', lastX - 40, lastY - 10)
    
    // 绘制闪烁的等待点
    const pulseSize = 3 + Math.sin(Date.now() / 300) * 1.5
    ctx.beginPath()
    ctx.arc(lastX, lastY, pulseSize, 0, Math.PI * 2)
    ctx.fillStyle = colors.textSecondary
    ctx.globalAlpha = 0.5 + Math.sin(Date.now() / 300) * 0.3
    ctx.fill()
    ctx.globalAlpha = 1
  } else {
    // ========== 其他模式：标准曲线图 ==========
    
    // [WHAT] 绘制填充区域
    ctx.beginPath()
    ctx.moveTo(padding.left, chartBottom)
    
    const fillPoints: { x: number, y: number }[] = data.map((point, i) => ({
      x: padding.left + (chartWidth / Math.max(data.length - 1, 1)) * i,
      y: padding.top + (mainHeight - padding.top) * (1 - (point.value - minValue) / valueRange)
    }))
    
    if (fillPoints.length > 0) {
      ctx.lineTo(fillPoints[0]!.x, fillPoints[0]!.y)
      
      // [WHY] 点数少于3时使用直线，点数足够时使用贝塞尔曲线
      if (fillPoints.length < 3) {
        for (let i = 1; i < fillPoints.length; i++) {
          ctx.lineTo(fillPoints[i]!.x, fillPoints[i]!.y)
        }
      } else {
        // [HOW] Catmull-Rom样条曲线
        for (let i = 0; i < fillPoints.length - 1; i++) {
          const p0 = fillPoints[Math.max(i - 1, 0)]!
          const p1 = fillPoints[i]!
          const p2 = fillPoints[i + 1]!
          const p3 = fillPoints[Math.min(i + 2, fillPoints.length - 1)]!
          
          const tension = 6
          const cp1x = p1.x + (p2.x - p0.x) / tension
          const cp1y = p1.y + (p2.y - p0.y) / tension
          const cp2x = p2.x - (p3.x - p1.x) / tension
          const cp2y = p2.y - (p3.y - p1.y) / tension
          
          ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y)
        }
      }
    }
    
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
    
    // [WHAT] 绘制平滑走势曲线
    ctx.beginPath()
    const points: { x: number, y: number }[] = data.map((point, i) => ({
      x: padding.left + (chartWidth / Math.max(data.length - 1, 1)) * i,
      y: padding.top + (mainHeight - padding.top) * (1 - (point.value - minValue) / valueRange)
    }))
    
    if (points.length > 0) {
      ctx.moveTo(points[0]!.x, points[0]!.y)
      
      // [WHY] 点数少于3时使用直线，点数足够时使用贝塞尔曲线
      if (points.length < 3) {
        // 直线连接
        for (let i = 1; i < points.length; i++) {
          ctx.lineTo(points[i]!.x, points[i]!.y)
        }
      } else {
        // [HOW] 使用Catmull-Rom样条曲线，自动生成平滑控制点
        for (let i = 0; i < points.length - 1; i++) {
          const p0 = points[Math.max(i - 1, 0)]!
          const p1 = points[i]!
          const p2 = points[i + 1]!
          const p3 = points[Math.min(i + 2, points.length - 1)]!
          
          // [WHAT] Catmull-Rom to Bezier转换，生成平滑曲线
          const tension = 6 // 张力系数
          const cp1x = p1.x + (p2.x - p0.x) / tension
          const cp1y = p1.y + (p2.y - p0.y) / tension
          const cp2x = p2.x - (p3.x - p1.x) / tension
          const cp2y = p2.y - (p3.y - p1.y) / tension
          
          ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y)
        }
      }
    }
    ctx.strokeStyle = isOverallUp ? upColor : downColor
    ctx.lineWidth = 2
    ctx.stroke()
    
    // 绘制最新点动画 + 精确数值标注
    if (data.length > 0) {
      const lastPoint = data[data.length - 1]!
      const lastPointX = padding.left + chartWidth
      const lastPointY = padding.top + (mainHeight - padding.top) * (1 - (lastPoint.value - minValue) / valueRange)
      
      // [WHAT] 绘制脉冲动画点
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
      
      // [WHAT] 在最新点旁边显示精确数值
      const priceText = lastPoint.value.toFixed(4)
      ctx.font = 'bold 11px Arial'
      ctx.textAlign = 'left'
      ctx.fillStyle = isOverallUp ? upColor : downColor
      
      // [WHY] 根据点位置决定标签显示在上方还是下方
      const labelY = lastPointY < mainHeight / 2 ? lastPointY + 18 : lastPointY - 8
      ctx.fillText(priceText, lastPointX + 8, labelY)
    }
  }
  
  // ========== 绘制X轴时间标签 ==========
  ctx.fillStyle = colors.textSecondary
  ctx.font = '10px Arial'
  ctx.textAlign = 'center'
  
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
