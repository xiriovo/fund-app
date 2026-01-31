<script setup lang="ts">
// [WHY] 搜索页 - 搜索基金并添加到自选
// [WHAT] 输入基金代码或名称搜索，点击添加到自选

import { ref, watch, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useFundStore } from '@/stores/fund'
import { searchFund } from '@/api/fund'
import { fetchFundEstimateFast } from '@/api/fundFast'
import { showToast, showLoadingToast, closeToast } from 'vant'
import type { FundInfo } from '@/types/fund'

const router = useRouter()
const route = useRoute()
const fundStore = useFundStore()

const keyword = ref('')

// [WHY] 从路由参数获取初始搜索关键词
onMounted(() => {
  const q = route.query.q as string
  if (q) {
    keyword.value = q
    doSearch(q)
  }
})

// [WHAT] 扩展的搜索结果，包含实时涨跌幅
interface FundInfoWithChange extends FundInfo {
  gszzl?: string  // 估算涨跌幅
}

const searchResults = ref<FundInfoWithChange[]>([])
const isSearching = ref(false)

// [WHAT] 防抖搜索 - 输入停止 300ms 后触发
let searchTimer: ReturnType<typeof setTimeout> | null = null

watch(keyword, (val) => {
  if (searchTimer) {
    clearTimeout(searchTimer)
  }
  
  if (!val.trim()) {
    searchResults.value = []
    return
  }
  
  searchTimer = setTimeout(() => {
    doSearch(val)
  }, 300)
})

// [WHAT] 执行搜索
async function doSearch(kw: string) {
  if (!kw.trim()) return
  
  isSearching.value = true
  try {
    const results = await searchFund(kw, 30)
    searchResults.value = results
    
    // [WHY] 异步获取涨跌幅数据，不阻塞搜索结果显示
    // [HOW] 并行请求前10个支持估值的基金
    // [EDGE] 过滤掉不支持估值的类型：期货、ETF联接、QDII、FOF
    const unsupportedTypes = ['期货', 'QDII', 'FOF', '联接', '其他']
    const supportedResults = results.filter(f => 
      !unsupportedTypes.some(t => f.type.includes(t) || f.name.includes(t))
    ).slice(0, 10)
    
    supportedResults.forEach(async (fund) => {
      try {
        const estimate = await fetchFundEstimateFast(fund.code)
        if (estimate?.gszzl) {
          // [WHAT] 找到对应的结果并更新
          const idx = searchResults.value.findIndex(r => r.code === fund.code)
          if (idx !== -1) {
            searchResults.value[idx]!.gszzl = estimate.gszzl
          }
        }
      } catch {
        // 忽略单个基金获取失败
      }
    })
  } catch (err) {
    showToast('搜索失败')
  } finally {
    isSearching.value = false
  }
}

// [WHAT] 格式化涨跌幅显示
function formatChange(gszzl?: string): string {
  if (!gszzl) return ''
  const val = parseFloat(gszzl)
  if (isNaN(val)) return ''
  const prefix = val >= 0 ? '+' : ''
  return `${prefix}${val.toFixed(2)}%`
}

// [WHAT] 获取涨跌幅颜色类名
function getChangeClass(gszzl?: string): string {
  if (!gszzl) return ''
  const val = parseFloat(gszzl)
  if (isNaN(val)) return ''
  return val >= 0 ? 'up' : 'down'
}

// [WHAT] 添加基金到自选
async function handleAdd(fund: FundInfo) {
  if (fundStore.isFundInWatchlist(fund.code)) {
    showToast('已在自选中')
    return
  }
  
  showLoadingToast({ message: '添加中...', forbidClick: true })
  
  try {
    await fundStore.addFund(fund.code, fund.name)
    closeToast()
    showToast('添加成功')
  } catch {
    closeToast()
    showToast('添加失败')
  }
}

// [WHAT] 返回上一页
function goBack() {
  router.back()
}

// [WHAT] 判断基金是否已在自选中
function isInWatchlist(code: string): boolean {
  return fundStore.isFundInWatchlist(code)
}
</script>

<template>
  <div class="search-page">
    <!-- 搜索栏 -->
    <van-nav-bar title="搜索基金" left-arrow @click-left="goBack">
      <template #right>
        <span v-if="isSearching" class="searching-text">搜索中...</span>
      </template>
    </van-nav-bar>

    <!-- 搜索输入框 -->
    <van-search
      v-model="keyword"
      placeholder="输入基金代码或名称"
      show-action
      autofocus
      @cancel="goBack"
    />

    <!-- 搜索结果列表 -->
    <div class="search-results">
      <div 
        v-for="fund in searchResults"
        :key="fund.code"
        class="fund-item"
        @click="handleAdd(fund)"
      >
        <div class="fund-info">
          <div class="fund-name">{{ fund.name }}</div>
          <div class="fund-meta">{{ fund.code }} · {{ fund.type }}</div>
        </div>
        <div class="fund-change-col">
          <span 
            v-if="fund.gszzl" 
            class="fund-change" 
            :class="getChangeClass(fund.gszzl)"
          >
            {{ formatChange(fund.gszzl) }}
          </span>
          <span v-else class="fund-change empty">--</span>
        </div>
        <div class="fund-action">
          <van-tag v-if="isInWatchlist(fund.code)" type="success" size="medium">已添加</van-tag>
          <van-icon v-else name="add-o" size="22" color="#1989fa" />
        </div>
      </div>

      <!-- 空状态 -->
      <van-empty
        v-if="keyword && searchResults.length === 0 && !isSearching"
        image="search"
        description="未找到相关基金"
      />

      <!-- 搜索提示 -->
      <div v-if="!keyword" class="search-tip">
        <van-icon name="info-o" />
        <span>输入基金代码（如 001186）或名称搜索</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.search-page {
  min-height: 100vh;
  background: var(--bg-primary);
  transition: background-color 0.3s;
}

.searching-text {
  font-size: 12px;
  color: var(--text-secondary);
}

.search-results {
  background: var(--bg-secondary);
}

.search-tip {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 40px 20px;
  color: var(--text-secondary);
  font-size: 14px;
}

/* [WHAT] 基金列表项样式 */
.fund-item {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color, #ebedf0);
  cursor: pointer;
  transition: background 0.2s;
}

.fund-item:active {
  background: var(--bg-active, #f2f3f5);
}

.fund-info {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.fund-name {
  font-size: 15px;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 4px;
}

.fund-meta {
  font-size: 12px;
  color: var(--text-secondary);
}

/* [WHAT] 涨跌幅列 - 固定宽度右对齐 */
.fund-change-col {
  width: 70px;
  text-align: right;
  margin-right: 12px;
  flex-shrink: 0;
}

.fund-change {
  font-size: 14px;
  font-weight: 600;
  font-family: 'DIN Alternate', 'Roboto Mono', monospace;
}

.fund-change.up {
  color: #f56c6c;
}

.fund-change.down {
  color: #67c23a;
}

.fund-change.empty {
  color: var(--text-tertiary, #c8c9cc);
}

/* [WHAT] 操作按钮列 */
.fund-action {
  width: 56px;
  display: flex;
  justify-content: center;
  align-items: center;
  flex-shrink: 0;
}
</style>
