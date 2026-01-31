// [WHY] 主题状态管理，支持亮色/深色模式切换
// [WHAT] 提供主题切换功能，自动保存用户偏好
// [DEPS] 依赖 localStorage 持久化主题设置

import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

export type ThemeMode = 'light' | 'dark' | 'auto'

const STORAGE_KEY = 'fund_theme'

// [WHAT] 获取系统主题偏好
function getSystemTheme(): 'light' | 'dark' {
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark'
  }
  return 'light'
}

// [WHAT] 从 localStorage 读取主题设置
// [WHY] 默认使用 light 主题，更明亮清爽
function loadTheme(): ThemeMode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) as ThemeMode
    if (saved && ['light', 'dark', 'auto'].includes(saved)) {
      return saved
    }
  } catch {
    // ignore
  }
  return 'light' // 默认浅色主题
}

// [WHAT] 应用主题到 DOM
// [WHY] 必须显式设置 data-theme 属性，CSS 才能正确切换
function applyTheme(mode: ThemeMode) {
  const root = document.documentElement
  
  // [WHY] 无论什么模式，都必须设置 data-theme 属性
  // auto 模式跟随系统，其他模式使用指定值
  const actualTheme = mode === 'auto' ? getSystemTheme() : mode
  root.setAttribute('data-theme', actualTheme)
  
  // [WHY] 同步更新 meta theme-color 以适配移动端状态栏
  const metaTheme = document.querySelector('meta[name="theme-color"]')
  if (metaTheme) {
    metaTheme.setAttribute('content', actualTheme === 'dark' ? '#0b0e11' : '#ffffff')
  }
}

export const useThemeStore = defineStore('theme', () => {
  // ========== State ==========
  
  /** 当前主题模式 */
  const mode = ref<ThemeMode>(loadTheme())
  
  /** 实际显示的主题 */
  const actualTheme = ref<'light' | 'dark'>(
    mode.value === 'auto' ? getSystemTheme() : mode.value
  )

  // ========== Actions ==========

  /**
   * 设置主题模式
   */
  function setTheme(newMode: ThemeMode) {
    mode.value = newMode
    localStorage.setItem(STORAGE_KEY, newMode)
    applyTheme(newMode)
    actualTheme.value = newMode === 'auto' ? getSystemTheme() : newMode
  }

  /**
   * 切换深色/亮色模式
   */
  function toggleTheme() {
    if (mode.value === 'auto') {
      setTheme(getSystemTheme() === 'dark' ? 'light' : 'dark')
    } else {
      setTheme(mode.value === 'dark' ? 'light' : 'dark')
    }
  }

  /**
   * 初始化主题
   */
  function initTheme() {
    applyTheme(mode.value)
    
    // 监听系统主题变化
    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        if (mode.value === 'auto') {
          actualTheme.value = e.matches ? 'dark' : 'light'
        }
      })
    }
  }

  return {
    mode,
    actualTheme,
    setTheme,
    toggleTheme,
    initTheme
  }
})
