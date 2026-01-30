# 基金宝

一款开源的基金实时估值查看工具，专为 Android 平台打造。

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Vue](https://img.shields.io/badge/Vue-3.x-brightgreen.svg)
![Capacitor](https://img.shields.io/badge/Capacitor-7.x-blue.svg)

## 功能特点

- **实时估值** - 秒级刷新基金实时估值数据
- **自选管理** - 添加、删除、排序自选基金
- **持仓管理** - 记录持仓，自动计算收益
- **走势曲线** - 专业的分时/走势图表展示
- **基金对比** - 多基金走势对比分析
- **回测模拟** - 定投/一次性买入回测
- **基金筛选** - 多维度筛选优质基金
- **基金经理** - 查看基金经理业绩排行
- **智能提醒** - 涨跌幅/净值预警提醒
- **收益报告** - 生成可分享的收益图片
- **投资日历** - 记录投资计划和事件
- **深色模式** - 支持浅色/深色主题切换

## 截图预览

<!-- TODO: 添加应用截图 -->

## 快速开始

### 下载安装

前往 [Releases](https://github.com/xiriovo/fund-app/releases) 下载最新版 APK 安装。

### 本地开发

```bash
# 克隆项目
git clone https://github.com/xiriovo/fund-app.git
cd fund-app

# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build
```

### Android APK 构建

```bash
# 同步 Capacitor
npm run cap:sync

# 使用 Android Studio 打开
npx cap open android

# 或命令行构建（需要 JDK 21）
cd android
./gradlew assembleDebug
```

APK 输出位置：`android/app/build/outputs/apk/debug/app-debug.apk`

## 技术栈

- **前端框架**：Vue 3 + TypeScript
- **构建工具**：Vite
- **UI 组件**：Vant 4
- **状态管理**：Pinia
- **图表绘制**：Canvas API + lightweight-charts
- **移动打包**：Capacitor

## 数据来源

本项目数据来源于公开的基金信息接口，仅供学习和个人使用。

## 免责声明

- 本工具仅供学习交流使用，不构成任何投资建议
- 基金估值数据仅供参考，以基金公司公布的净值为准
- 投资有风险，入市需谨慎

## 开源协议

本项目基于 [MIT License](./LICENSE) 开源。

## 贡献指南

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 创建 Pull Request

## 致谢

感谢所有为本项目做出贡献的开发者！
