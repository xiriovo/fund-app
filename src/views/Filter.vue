<script setup lang="ts">
// [WHY] 基金筛选器 - 按类型、规模、收益率等条件筛选基金
// [WHAT] 从 Eastmoney API 获取基金列表并支持多维度筛选

import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { showToast } from 'vant'

const router = useRouter()

// 筛选条件
const fundType = ref<string>('')          // 基金类型
const minReturn = ref<string>('')          // 最低收益率
const sortBy = ref<'dayReturn' | 'weekReturn' | 'monthReturn' | 'yearReturn'>('dayReturn')

// 基金类型选项
const typeOptions = [
  { value: '', label: '全部类型' },
  { value: 'gp', label: '股票型' },
  { value: 'hh', label: '混合型' },
  { value: 'zq', label: '债券型' },
  { value: 'zs', label: '指数型' },
  { value: 'qdii', label: 'QDII' },
  { value: 'fof', label: 'FOF' },
  { value: 'hb', label: '货币型' }
]

// 排序选项
const sortOptions = [
  { value: 'dayReturn', label: '日涨幅' },
  { value: 'weekReturn', label: '周涨幅' },
  { value: 'monthReturn', label: '月涨幅' },
  { value: 'yearReturn', label: '年涨幅' }
]

// 数据
interface FilteredFund {
  code: string
  name: string
  type: string
  dayReturn: number
  weekReturn: number
  monthReturn: number
  yearReturn: number
  netValue: number
}

const fundList = ref<FilteredFund[]>([])
const isLoading = ref(false)
const isRefreshing = ref(false)
const hasMore = ref(true)
const page = ref(1)
const pageSize = 30

// [WHAT] 获取基金类型代码映射
function getTypeCode(type: string): string {
  const typeMap: Record<string, string> = {
    'gp': '001',   // 股票型
    'hh': '002',   // 混合型
    'zq': '003',   // 债券型
    'zs': '005',   // 指数型
    'qdii': '006', // QDII
    'fof': '015',  // FOF
    'hb': '004'    // 货币型
  }
  return typeMap[type] || ''
}

// [WHAT] 获取排序字段映射
function getSortField(sort: string): string {
  const sortMap: Record<string, string> = {
    'dayReturn': 'rzdf',   // 日涨跌幅
    'weekReturn': 'zzf',   // 周涨幅
    'monthReturn': 'jzzzf', // 月涨幅
    'yearReturn': 'lnzz'   // 年涨幅
  }
  return sortMap[sort] || 'rzdf'
}

// [WHAT] 加载基金数据
async function loadFunds(reset = false) {
  // [WHY] 防止重复加载
  if (isLoading.value) return
  if (!reset && !hasMore.value) return
  
  if (reset) {
    page.value = 1
    fundList.value = []
    hasMore.value = true
  }
  
  isLoading.value = true
  
  try {
    const typeCode = fundType.value ? getTypeCode(fundType.value) : ''
    const sortField = getSortField(sortBy.value)
    const url = `API_ENDPOINT/data/rankhandler.aspx?op=ph&dt=kf&ft=${typeCode}&rs=&gs=0&sc=${sortField}&st=desc&pi=${page.value}&pn=${pageSize}&dx=1&v=${Date.now()}`
    
    // [WHY] 使用简单的 Promise + setTimeout 避免阻塞
    const response = await new Promise<FilteredFund[]>((resolve) => {
      const scriptId = `filter_${Date.now()}_${Math.random().toString(36).slice(2)}`
      const script = document.createElement('script')
      script.id = scriptId
      
      // 清除旧数据
      delete (window as any).rankData
      
      let resolved = false
      const done = (data: FilteredFund[]) => {
        if (resolved) return
        resolved = true
        const s = document.getElementById(scriptId)
        if (s && s.parentNode) s.parentNode.removeChild(s)
        resolve(data)
      }
      
      script.onload = () => {
        // 等待数据设置
        setTimeout(() => {
          try {
            const rankData = (window as any).rankData
            if (rankData?.datas?.length) {
              const funds = rankData.datas.map((item: string) => {
                const p = item.split(',')
                return {
                  code: p[0] || '', name: p[1] || '',
                  type: typeOptions.find(t => t.value === fundType.value)?.label || '混合型',
                  dayReturn: parseFloat(p[6] ?? '0') || 0,
                  weekReturn: parseFloat(p[7] ?? '0') || 0,
                  monthReturn: parseFloat(p[8] ?? '0') || 0,
                  yearReturn: parseFloat(p[11] ?? '0') || 0,
                  netValue: parseFloat(p[4] ?? '0') || 0
                }
              }).filter((f: FilteredFund) => f.code && f.name)
              done(funds)
            } else {
              done([])
            }
          } catch { done([]) }
        }, 150)
      }
      
      script.onerror = () => done([])
      
      // 3秒超时
      setTimeout(() => done([]), 3000)
      
      script.src = url
      document.body.appendChild(script)
    })
    
    if (response.length < pageSize) {
      hasMore.value = false
    }
    
    // [WHAT] 应用收益率过滤
    let filtered = response
    if (minReturn.value) {
      const minVal = parseFloat(minReturn.value)
      if (!isNaN(minVal)) {
        const sortKey = sortBy.value
        filtered = response.filter(f => f[sortKey] >= minVal)
      }
    }
    
    fundList.value = reset ? filtered : [...fundList.value, ...filtered]
    page.value++
    
  } catch (err) {
    console.error('加载基金列表失败:', err)
    showToast('加载失败')
  } finally {
    isLoading.value = false
  }
}

// [WHAT] 应用筛选条件
function applyFilter() {
  loadFunds(true)
}

// [WHAT] 下拉刷新处理
async function onRefresh() {
  isRefreshing.value = true
  try {
    await loadFunds(true)
    showToast('刷新成功')
  } finally {
    isRefreshing.value = false
  }
}

// [WHAT] 获取排序字段的当前值
function getSortValue(fund: FilteredFund): number {
  return fund[sortBy.value]
}

// [WHAT] 跳转到基金详情
function goToDetail(code: string) {
  router.push(`/detail/${code}`)
}

// [WHAT] 获取涨跌样式类
function getChangeClass(value: number): string {
  if (value > 0) return 'up'
  if (value < 0) return 'down'
  return 'flat'
}

// 排序按钮显示
const showSortPicker = ref(false)
const showTypePicker = ref(false)

// [WHY] van-list 会自动触发 @load，不需要在 onMounted 中调用
// 初始加载由 van-list 的 immediate-check 触发
</script>

<template>
  <div class="filter-page">
    <!-- 导航栏 -->
    <van-nav-bar 
      title="基金筛选" 
      left-arrow 
      @click-left="router.back()"
    />
    
    <!-- 筛选栏 -->
    <div class="filter-bar">
      <!-- 类型筛选 -->
      <div class="filter-item" @click="showTypePicker = true">
        <span>{{ typeOptions.find(t => t.value === fundType)?.label || '全部类型' }}</span>
        <van-icon name="arrow-down" size="12" />
      </div>
      
      <!-- 排序方式 -->
      <div class="filter-item" @click="showSortPicker = true">
        <span>{{ sortOptions.find(s => s.value === sortBy)?.label }}</span>
        <van-icon name="arrow-down" size="12" />
      </div>
      
      <!-- 最低收益率 -->
      <div class="filter-item input-item">
        <input 
          v-model="minReturn"
          type="number"
          placeholder="最低%"
          class="min-return-input"
          @change="applyFilter"
        />
      </div>
    </div>
    
    <!-- 基金列表 -->
    <div class="fund-list">
      <van-pull-refresh v-model="isRefreshing" @refresh="onRefresh">
        <van-list
          :loading="isLoading"
          :finished="!hasMore"
          finished-text="没有更多了"
          :immediate-check="true"
          @load="loadFunds"
        >
          <!-- 表头 -->
          <div class="list-header">
            <span class="col-name">基金名称</span>
            <span class="col-type">类型</span>
            <span class="col-return">{{ sortOptions.find(s => s.value === sortBy)?.label }}</span>
          </div>
          
          <!-- 列表项 -->
          <div 
            v-for="fund in fundList" 
            :key="fund.code"
            class="fund-item"
            @click="goToDetail(fund.code)"
          >
            <div class="col-name">
              <span class="fund-name">{{ fund.name }}</span>
              <span class="fund-code">{{ fund.code }}</span>
            </div>
            <span class="col-type">{{ fund.type }}</span>
            <span class="col-return" :class="getChangeClass(getSortValue(fund))">
              {{ getSortValue(fund) >= 0 ? '+' : '' }}{{ getSortValue(fund).toFixed(2) }}%
            </span>
          </div>
        </van-list>
      </van-pull-refresh>
    </div>
    
    <!-- 类型选择器 -->
    <van-popup v-model:show="showTypePicker" position="bottom" round>
      <van-picker
        :columns="typeOptions.map(t => ({ text: t.label, value: t.value }))"
        @confirm="(val: { selectedValues: string[] }) => { fundType = val.selectedValues[0] || ''; showTypePicker = false; applyFilter() }"
        @cancel="showTypePicker = false"
      />
    </van-popup>
    
    <!-- 排序选择器 -->
    <van-popup v-model:show="showSortPicker" position="bottom" round>
      <van-picker
        :columns="sortOptions.map(s => ({ text: s.label, value: s.value }))"
        @confirm="(val: { selectedValues: string[] }) => { sortBy = (val.selectedValues[0] || 'dayReturn') as any; showSortPicker = false; applyFilter() }"
        @cancel="showSortPicker = false"
      />
    </van-popup>
  </div>
</template>

<style scoped>
.filter-page {
  min-height: 100vh;
  background: var(--bg-primary);
  display: flex;
  flex-direction: column;
}

/* 筛选栏 */
.filter-bar {
  display: flex;
  align-items: center;
  padding: 10px 12px;
  background: var(--bg-secondary);
  gap: 8px;
  border-bottom: 1px solid var(--border-color);
}

.filter-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 12px;
  font-size: 13px;
  color: var(--text-primary);
  background: var(--bg-tertiary);
  border-radius: 6px;
  cursor: pointer;
  white-space: nowrap;
}

.filter-item.input-item {
  padding: 0;
  background: transparent;
}

.min-return-input {
  width: 70px;
  padding: 8px 10px;
  font-size: 13px;
  color: var(--text-primary);
  background: var(--bg-tertiary);
  border: none;
  border-radius: 6px;
  text-align: center;
}

.min-return-input::placeholder {
  color: var(--text-muted);
}

/* 基金列表 */
.fund-list {
  flex: 1;
  /* [WHY] 固定高度才能让滚动和下拉刷新正常工作 */
  height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior-y: contain;
}

.list-header {
  display: grid;
  grid-template-columns: 1fr 60px 80px;
  padding: 12px 16px;
  font-size: 12px;
  color: var(--text-secondary);
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
  position: sticky;
  top: 0;
  z-index: 1;
}

.fund-item {
  display: grid;
  grid-template-columns: 1fr 60px 80px;
  align-items: center;
  padding: 14px 16px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
  cursor: pointer;
  transition: background-color 0.2s;
}

.fund-item:active {
  background: var(--bg-tertiary);
}

.col-name {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.fund-name {
  font-size: 14px;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fund-code {
  font-size: 12px;
  color: var(--text-muted);
  font-family: 'Roboto Mono', monospace;
}

.col-type {
  font-size: 12px;
  color: var(--text-secondary);
  text-align: center;
}

.col-return {
  font-size: 14px;
  font-weight: 600;
  text-align: right;
  font-family: 'DIN Alternate', 'Roboto Mono', monospace;
}

.col-return.up { color: var(--color-up); }
.col-return.down { color: var(--color-down); }
.col-return.flat { color: var(--text-secondary); }

/* 移动端适配 */
@media (max-width: 400px) {
  .filter-bar {
    flex-wrap: wrap;
  }
  
  .list-header,
  .fund-item {
    grid-template-columns: 1fr 50px 70px;
  }
}
</style>
