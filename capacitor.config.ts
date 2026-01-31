// [WHY] Capacitor 配置文件，用于打包原生安卓 APP
// [WHAT] 配置应用名称、包名、构建目录等

import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  // [WHAT] 应用唯一标识符（安卓包名格式）
  appId: 'com.fundapp.realtime',
  // [WHAT] 应用显示名称
  appName: '基金估值',
  // [WHAT] Web 构建输出目录
  webDir: 'dist',
  server: {
    // [WHY] 开发模式下直接连接 Vite 开发服务器，方便调试
    // [EDGE] 生产构建时需要注释掉这行
    // url: 'http://192.168.2.6:5173',
    cleartext: true
  },
  android: {
    // [WHAT] 允许混合内容（HTTP + HTTPS）
    allowMixedContent: true
  },
  ios: {
    // [WHAT] 允许混合内容（HTTP + HTTPS）
    allowMixedContent: true
  }
}

export default config
