<script setup lang="ts">
// [WHY] 智能提醒页面 - 设置涨跌幅提醒、定时提醒
// [WHAT] 管理基金提醒规则，支持多种提醒类型

import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useFundStore } from '@/stores/fund'
import { showToast, showConfirmDialog } from 'vant'

const router = useRouter()
const fundStore = useFundStore()

// [WHAT] 提醒规则类型
interface AlertRule {
  id: string
  code: string
  name: string
  type: 'up' | 'down' | 'time' | 'value'
  threshold: number
  enabled: boolean
  lastTriggered?: number
  createdAt: number
}

const alerts = ref<AlertRule[]>([])
const showAddSheet = ref(false)

// [WHAT] 新增提醒表单
const newAlert = ref({
  code: '',
  name: '',
  type: 'up' as 'up' | 'down' | 'time' | 'value',
  threshold: 3
})

// [WHAT] 基金搜索相关
const searchKeyword = ref('')
const searchResults = ref<{ code: string, name: string }[]>([])
const isSearching = ref(false)

onMounted(() => {
  loadAlerts()
})

function loadAlerts() {
  const stored = localStorage.getItem('fund_alerts')
  if (stored) {
    try {
      alerts.value = JSON.parse(stored)
    } catch {
      alerts.value = []
    }
  }
}

function saveAlerts() {
  localStorage.setItem('fund_alerts', JSON.stringify(alerts.value))
}

// [WHAT] 添加提醒
function addAlert() {
  if (!newAlert.value.code) {
    showToast('请选择基金')
    return
  }
  
  const rule: AlertRule = {
    id: `alert_${Date.now()}`,
    code: newAlert.value.code,
    name: newAlert.value.name,
    type: newAlert.value.type,
    threshold: newAlert.value.threshold,
    enabled: true,
    createdAt: Date.now()
  }
  
  alerts.value.push(rule)
  saveAlerts()
  showAddSheet.value = false
  showToast('添加成功')
  
  // 重置表单
  newAlert.value = { code: '', name: '', type: 'up', threshold: 3 }
}

// [WHAT] 切换提醒状态
function toggleAlert(id: string) {
  const alert = alerts.value.find(a => a.id === id)
  if (alert) {
    alert.enabled = !alert.enabled
    saveAlerts()
  }
}

// [WHAT] 删除提醒
async function deleteAlert(id: string) {
  try {
    await showConfirmDialog({
      title: '删除提醒',
      message: '确定删除这条提醒规则？'
    })
    alerts.value = alerts.value.filter(a => a.id !== id)
    saveAlerts()
    showToast('已删除')
  } catch {
    // 取消
  }
}

// [WHAT] 选择基金
function selectFund(fund: { code: string, name: string }) {
  newAlert.value.code = fund.code
  newAlert.value.name = fund.name
}

// [WHAT] 获取提醒类型描述
function getTypeDesc(type: string, threshold: number): string {
  switch (type) {
    case 'up': return `涨幅超过 ${threshold}%`
    case 'down': return `跌幅超过 ${threshold}%`
    case 'time': return `每日 ${threshold}:00 提醒`
    case 'value': return `净值达到 ${threshold}`
    default: return ''
  }
}

// [WHAT] 获取类型图标
function getTypeIcon(type: string): string {
  switch (type) {
    case 'up': return 'arrow-up'
    case 'down': return 'arrow-down'
    case 'time': return 'clock-o'
    case 'value': return 'chart-trending-o'
    default: return 'bell'
  }
}

function goBack() {
  router.back()
}

// [WHAT] 搜索基金
async function searchFunds() {
  if (!searchKeyword.value.trim()) {
    searchResults.value = []
    return
  }
  
  isSearching.value = true
  try {
    const { searchFund } = await import('@/api/fund')
    const results = await searchFund(searchKeyword.value)
    searchResults.value = results.slice(0, 10).map(f => ({
      code: f.code,
      name: f.name
    }))
  } catch {
    searchResults.value = []
  } finally {
    isSearching.value = false
  }
}

// [WHAT] 选择搜索结果中的基金
function selectSearchResult(fund: { code: string, name: string }) {
  newAlert.value.code = fund.code
  newAlert.value.name = fund.name
  searchKeyword.value = ''
  searchResults.value = []
}
</script>

<template>
  <div class="alerts-page">
    <!-- 顶部导航 -->
    <van-nav-bar 
      title="智能提醒" 
      left-arrow 
      @click-left="goBack"
    >
      <template #right>
        <van-icon name="plus" size="20" @click="showAddSheet = true" />
      </template>
    </van-nav-bar>
    
    <!-- 提醒列表 -->
    <div class="alert-list">
      <van-swipe-cell 
        v-for="alert in alerts" 
        :key="alert.id"
      >
        <div class="alert-item">
          <div class="alert-left">
            <van-icon :name="getTypeIcon(alert.type)" size="24" class="type-icon" />
            <div class="alert-info">
              <div class="alert-name">{{ alert.name }}</div>
              <div class="alert-desc">{{ getTypeDesc(alert.type, alert.threshold) }}</div>
            </div>
          </div>
          <van-switch 
            :model-value="alert.enabled" 
            size="20"
            @update:model-value="toggleAlert(alert.id)"
          />
        </div>
        
        <template #right>
          <van-button 
            square 
            type="danger" 
            text="删除"
            class="delete-btn"
            @click="deleteAlert(alert.id)"
          />
        </template>
      </van-swipe-cell>
      
      <!-- 空状态 -->
      <van-empty 
        v-if="alerts.length === 0"
        image="search"
        description="暂无提醒规则"
      >
        <van-button round type="primary" size="small" @click="showAddSheet = true">
          添加提醒
        </van-button>
      </van-empty>
    </div>
    
    <!-- 添加提醒弹窗 -->
    <van-action-sheet v-model:show="showAddSheet" title="添加提醒">
      <div class="add-form">
        <!-- 搜索选择基金 -->
        <div class="fund-select">
          <van-field
            v-model="searchKeyword"
            placeholder="搜索基金代码或名称"
            clearable
            @update:model-value="searchFunds"
          >
            <template #left-icon>
              <van-icon name="search" />
            </template>
          </van-field>
          
          <!-- 已选基金 -->
          <div v-if="newAlert.code" class="selected-fund">
            <span class="fund-name">{{ newAlert.name }}</span>
            <span class="fund-code">{{ newAlert.code }}</span>
            <van-icon name="cross" @click="newAlert.code = ''; newAlert.name = ''" />
          </div>
          
          <!-- 搜索结果 -->
          <div v-if="searchResults.length > 0" class="search-results">
            <div 
              v-for="fund in searchResults" 
              :key="fund.code"
              class="result-item"
              @click="selectSearchResult(fund)"
            >
              <span class="fund-name">{{ fund.name }}</span>
              <span class="fund-code">{{ fund.code }}</span>
            </div>
          </div>
        </div>
        
        <!-- 提醒类型 -->
        <div class="type-selector">
          <div class="type-label">提醒类型</div>
          <div class="type-options">
            <div 
              class="type-option" 
              :class="{ active: newAlert.type === 'up' }"
              @click="newAlert.type = 'up'"
            >
              <van-icon name="arrow-up" />
              <span>涨幅提醒</span>
            </div>
            <div 
              class="type-option" 
              :class="{ active: newAlert.type === 'down' }"
              @click="newAlert.type = 'down'"
            >
              <van-icon name="arrow-down" />
              <span>跌幅提醒</span>
            </div>
            <div 
              class="type-option" 
              :class="{ active: newAlert.type === 'time' }"
              @click="newAlert.type = 'time'"
            >
              <van-icon name="clock-o" />
              <span>定时提醒</span>
            </div>
            <div 
              class="type-option" 
              :class="{ active: newAlert.type === 'value' }"
              @click="newAlert.type = 'value'"
            >
              <van-icon name="chart-trending-o" />
              <span>净值提醒</span>
            </div>
          </div>
        </div>
        
        <!-- 阈值设置 -->
        <van-field
          v-model.number="newAlert.threshold"
          :label="newAlert.type === 'time' ? '提醒时间' : (newAlert.type === 'value' ? '目标净值' : '涨跌幅(%)')"
          type="number"
          :placeholder="newAlert.type === 'time' ? '如：9 表示9点' : (newAlert.type === 'value' ? '如：1.5' : '如：3 表示3%')"
        />
        
        <div class="form-actions">
          <van-button block type="primary" @click="addAlert">
            确认添加
          </van-button>
        </div>
      </div>
    </van-action-sheet>
  </div>
</template>

<style scoped>
.alerts-page {
  min-height: 100vh;
  background: var(--bg-primary);
}

.alert-list {
  padding: 12px;
}

.alert-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: var(--bg-secondary);
  padding: 16px;
  border-radius: 12px;
  margin-bottom: 12px;
}

.alert-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.type-icon {
  color: var(--color-primary);
}

.alert-info {
  flex: 1;
}

.alert-name {
  font-size: 15px;
  color: var(--text-primary);
  font-weight: 500;
}

.alert-desc {
  font-size: 13px;
  color: var(--text-secondary);
  margin-top: 4px;
}

.delete-btn {
  height: 100%;
}

/* 添加表单 */
.add-form {
  padding: 16px;
}

/* 基金搜索选择 */
.fund-select {
  margin-bottom: 16px;
}

.selected-fund {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  background: var(--bg-tertiary);
  border-radius: 8px;
  margin-top: 8px;
}

.selected-fund .fund-name {
  flex: 1;
  font-size: 14px;
  color: var(--text-primary);
}

.selected-fund .fund-code {
  font-size: 12px;
  color: var(--text-secondary);
}

.search-results {
  max-height: 200px;
  overflow-y: auto;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  margin-top: 8px;
}

.result-item {
  display: flex;
  justify-content: space-between;
  padding: 12px;
  border-bottom: 1px solid var(--border-color);
  cursor: pointer;
}

.result-item:last-child {
  border-bottom: none;
}

.result-item:active {
  background: var(--bg-tertiary);
}

.result-item .fund-name {
  font-size: 14px;
  color: var(--text-primary);
}

.result-item .fund-code {
  font-size: 12px;
  color: var(--text-secondary);
}

.type-selector {
  padding: 16px 0;
}

.type-label {
  font-size: 14px;
  color: var(--text-secondary);
  margin-bottom: 12px;
}

.type-options {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

.type-option {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 16px;
  background: var(--bg-tertiary);
  border-radius: 8px;
  cursor: pointer;
  border: 2px solid transparent;
  transition: all 0.2s;
}

.type-option.active {
  border-color: var(--color-primary);
  background: rgba(37, 99, 235, 0.1);
}

.type-option span {
  font-size: 13px;
  color: var(--text-secondary);
}

.type-option.active span {
  color: var(--color-primary);
}

.form-actions {
  margin-top: 24px;
}
</style>
