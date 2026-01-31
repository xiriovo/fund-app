// [WHY] 封装基金数据 API，统一管理数据获取逻辑
// [WHAT] 提供基金实时估值、基金搜索、历史净值、重仓股等接口
// [DEPS] 依赖天天基金公开接口，禁止高频请求

import type { FundEstimate, FundInfo, NetValueRecord, StockHolding, MarketIndex, FundRankItem, FundFeeInfo, FundShareClass } from '@/types/fund'

// ========== K线数据类型 ==========
export interface KLineData {
  time: string      // YYYY-MM-DD
  open: number      // 开盘净值
  high: number      // 最高净值
  low: number       // 最低净值
  close: number     // 收盘净值
}

// ========== 分时数据类型 ==========
export interface TimeShareData {
  time: string      // HH:mm:ss
  value: number     // 估值
  change: number    // 涨跌幅
}

// 基金列表缓存（避免重复请求）
let fundListCache: FundInfo[] | null = null

// [WHY] 天天基金接口使用固定的 jsonpgz 回调函数名，需要用队列处理并发请求
interface PendingRequest {
  code: string
  resolve: (data: FundEstimate) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}
let pendingRequests: PendingRequest[] = []

// [WHAT] 初始化全局 jsonpgz 回调函数
function initJsonpCallback() {
  if (!(window as any).jsonpgz) {
    ;(window as any).jsonpgz = (data: FundEstimate) => {
      // [WHY] 根据返回的基金代码找到对应的请求
      const index = pendingRequests.findIndex(req => req.code === data.fundcode)
      if (index !== -1 && pendingRequests[index]) {
        const req = pendingRequests[index]!
        clearTimeout(req.timeout)
        pendingRequests.splice(index, 1)
        req.resolve(data)
      }
    }
  }
}

/**
 * 获取单只基金实时估值（JSONP 方式）
 * [WHY] 天天基金接口返回 JSONP 格式，回调函数名固定为 jsonpgz
 * [HOW] 创建 script 标签，通过全局回调函数接收数据
 * [EDGE] 非交易时间返回的估值可能是空或上一交易日数据
 * @param code 基金代码
 * @returns 基金估值数据
 */
export function fetchFundEstimate(code: string): Promise<FundEstimate> {
  initJsonpCallback()
  
  return new Promise((resolve, reject) => {
    const scriptId = `fund_${code}_${Date.now()}`
    
    const timeout = setTimeout(() => {
      cleanup()
      // [EDGE] 从队列中移除超时的请求
      const index = pendingRequests.findIndex(req => req.code === code)
      if (index !== -1) {
        pendingRequests.splice(index, 1)
      }
      reject(new Error(`请求超时: ${code}`))
    }, 10000)

    // [WHAT] 添加到待处理队列
    pendingRequests.push({ code, resolve, reject, timeout })

    function cleanup() {
      const script = document.getElementById(scriptId)
      if (script) {
        document.body.removeChild(script)
      }
    }

    // [HOW] 动态创建 script 标签发起 JSONP 请求
    const script = document.createElement('script')
    script.id = scriptId
    // [DEPS] 天天基金公开接口，返回格式：jsonpgz({...})
    script.src = `https://fundgz.1234567.com.cn/js/${code}.js?rt=${Date.now()}`
    script.onerror = () => {
      cleanup()
      const index = pendingRequests.findIndex(req => req.code === code)
      if (index !== -1 && pendingRequests[index]) {
        clearTimeout(pendingRequests[index]!.timeout)
        pendingRequests.splice(index, 1)
      }
      reject(new Error(`请求失败: ${code}`))
    }
    script.onload = () => {
      // [WHY] 脚本加载完成后清理 DOM，但回调可能还没执行
      setTimeout(cleanup, 100)
    }
    document.body.appendChild(script)
  })
}

/**
 * 批量获取基金实时估值
 * [WHY] 自选列表需要同时获取多只基金的估值
 * [EDGE] 部分基金可能请求失败，返回 null
 * @param codes 基金代码数组
 * @returns 基金估值数组（失败的为 null）
 */
export async function fetchFundEstimates(
  codes: string[]
): Promise<(FundEstimate | null)[]> {
  // [WHY] 并发请求所有基金，提高加载速度
  const promises = codes.map((code) =>
    fetchFundEstimate(code).catch(() => null)
  )
  return Promise.all(promises)
}

/**
 * 获取基金列表（用于搜索）
 * [WHY] 从本地 JSON 文件加载基金列表，速度快、稳定、离线可用
 * [HOW] 加载预生成的 /fund-list.json 文件
 * [EDGE] 首次请求后缓存到内存
 */
export async function fetchFundList(): Promise<FundInfo[]> {
  // [WHY] 已缓存则直接返回，避免重复请求
  if (fundListCache) {
    return fundListCache
  }

  // [WHAT] 尝试多个路径加载基金列表
  // [WHY] Capacitor WebView 中路径解析可能不同
  const paths = [
    './fund-list.json',           // 相对路径（Capacitor 推荐）
    '/fund-list.json',            // 绝对路径（Web）
    'fund-list.json'              // 无前缀
  ]
  
  for (const path of paths) {
    try {
      const response = await fetch(path)
      if (!response.ok) continue
      
      const data = await response.json()
      if (Array.isArray(data) && data.length > 0) {
        fundListCache = data as FundInfo[]
        console.log(`[Fund API] 加载基金列表成功 (${path}): ${fundListCache.length} 只`)
        return fundListCache
      }
    } catch {
      console.log(`[Fund API] 路径 ${path} 加载失败，尝试下一个`)
    }
  }
  
  console.error('[Fund API] 所有本地路径加载失败，回退到远程')
  // [EDGE] 本地文件加载失败时，回退到远程 JSONP 请求
  return fetchFundListFromRemote()
}

/**
 * 从远程获取基金列表（备用方案）
 * [WHY] 当本地 JSON 不存在时的回退方案
 */
async function fetchFundListFromRemote(): Promise<FundInfo[]> {
  return new Promise((resolve, reject) => {
    const callbackName = `fundlist_${Date.now()}`
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error('获取基金列表超时'))
    }, 30000)

    ;(window as any).r = null
    
    function cleanup() {
      clearTimeout(timeout)
      const script = document.getElementById(callbackName)
      if (script) {
        document.body.removeChild(script)
      }
    }

    const script = document.createElement('script')
    script.id = callbackName
    script.src = `https://fund.eastmoney.com/js/fundcode_search.js?rt=${Date.now()}`
    script.onload = () => {
      cleanup()
      const rawData = (window as any).r
      if (!rawData || !Array.isArray(rawData)) {
        reject(new Error('基金列表数据格式错误'))
        return
      }
      fundListCache = rawData.map((item: string[]) => ({
        code: item[0] || '',
        pinyin: item[1] || '',
        name: item[2] || '',
        type: item[3] || ''
      }))
      resolve(fundListCache!)
    }
    script.onerror = () => {
      cleanup()
      reject(new Error('获取基金列表失败'))
    }
    document.body.appendChild(script)
  })
}

/**
 * 搜索基金（本地过滤）
 * [WHY] 全量列表已缓存，本地搜索比服务端快
 * [WHAT] 支持按代码、名称、拼音搜索，支持关键词拆分匹配
 * @param keyword 搜索关键词
 * @param limit 返回数量限制
 */
export async function searchFund(
  keyword: string,
  limit = 50
): Promise<FundInfo[]> {
  const list = await fetchFundList()
  if (!keyword.trim()) {
    return []
  }
  const kw = keyword.toLowerCase().trim()
  
  // [WHAT] 板块名称到基金关键词的映射（扩展版）
  const sectorKeywords: Record<string, string[]> = {
    '农牧饲渔': ['农业', '养殖', '畜牧', '渔业', '饲料', '农产品', '种植', '粮食'],
    '造纸印刷': ['造纸', '印刷', '纸业', '包装', '纸'],
    '通信设备': ['通信', '5G', '设备', '网络', '互联网', '信息'],
    '装修装饰': ['装修', '装饰', '建材', '家居', '家装', '家电', '地产', '建筑', '房地产', '基建'],
    '电子化学品': ['电子', '化学', '化工', '材料', '新材料'],
    '旅游酒店': ['旅游', '酒店', '餐饮', '消费', '休闲', '服务'],
    '医药生物': ['医药', '生物', '医疗', '健康', '制药', '创新药'],
    '新能源': ['新能源', '光伏', '锂电', '风电', '储能', '电池', '太阳能'],
    '半导体': ['半导体', '芯片', '集成电路', '科技', '电子'],
    '白酒': ['白酒', '酒', '消费', '食品饮料'],
    '银行': ['银行', '金融'],
    '证券': ['证券', '券商', '金融'],
    '保险': ['保险', '金融'],
    '房地产': ['房地产', '地产', '房产', '建筑', '基建'],
    '汽车': ['汽车', '新能源车', '智能汽车', '车'],
    '军工': ['军工', '国防', '航空', '航天'],
    '钢铁': ['钢铁', '有色', '金属'],
    '煤炭': ['煤炭', '能源', '煤'],
  }
  
  // [WHAT] 检查是否是板块名称
  const mappedKeywords = sectorKeywords[kw]
  
  // [WHAT] 先尝试完整匹配
  let results = list.filter(
    (item) =>
      item.code.includes(kw) ||
      item.name.toLowerCase().includes(kw) ||
      item.pinyin.toLowerCase().includes(kw)
  )
  
  // [WHY] 如果是板块名称，用关键词补充搜索结果
  if (mappedKeywords) {
    const keywordResults = list.filter((item) => {
      const name = item.name.toLowerCase()
      return mappedKeywords.some(k => name.includes(k.toLowerCase()))
    })
    // [WHAT] 合并结果，去重
    const existingCodes = new Set(results.map(r => r.code))
    keywordResults.forEach(item => {
      if (!existingCodes.has(item.code)) {
        results.push(item)
        existingCodes.add(item.code)
      }
    })
  }
  
  // [WHY] 如果结果还是很少，尝试拆分关键词匹配
  if (results.length < 10 && kw.length >= 2 && !mappedKeywords) {
    const chars = kw.split('')
    const charResults = list.filter((item) => {
      const name = item.name.toLowerCase()
      // [HOW] 匹配包含任意一个字符的基金（至少匹配2个字符）
      const matchCount = chars.filter(c => name.includes(c)).length
      return matchCount >= Math.min(2, chars.length)
    })
    // [WHAT] 合并结果，去重
    const existingCodes = new Set(results.map(r => r.code))
    charResults.forEach(item => {
      if (!existingCodes.has(item.code)) {
        results.push(item)
        existingCodes.add(item.code)
      }
    })
  }
  
  return results.slice(0, limit)
}

/**
 * 获取基金历史净值
 * [WHY] 用于绘制净值走势图
 * [WHAT] 获取最近 N 天的单位净值数据
 * @param code 基金代码
 * @param pageSize 获取条数（默认30天）
 */
export async function fetchNetValueHistory(
  code: string,
  pageSize = 30
): Promise<NetValueRecord[]> {
  return new Promise((resolve, reject) => {
    const callbackName = `lsjz_${Date.now()}_${Math.random().toString(36).slice(2)}`
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error('获取历史净值超时'))
    }, 15000)

    ;(window as any)[callbackName] = (data: any) => {
      cleanup()
      if (!data || !data.Data || !data.Data.LSJZList) {
        resolve([])
        return
      }
      // [WHAT] 转换数据格式
      // 原始格式：{ FSRQ: "2024-01-30", DWJZ: "1.2345", LJJZ: "1.5678", JZZZL: "1.23" }
      const records: NetValueRecord[] = data.Data.LSJZList.map((item: any) => ({
        date: item.FSRQ,           // 净值日期
        netValue: parseFloat(item.DWJZ) || 0,    // 单位净值
        totalValue: parseFloat(item.LJJZ) || 0,  // 累计净值
        changeRate: parseFloat(item.JZZZL) || 0  // 日涨跌幅
      }))
      resolve(records)
    }

    function cleanup() {
      clearTimeout(timeout)
      delete (window as any)[callbackName]
      const script = document.getElementById(callbackName)
      if (script) {
        document.body.removeChild(script)
      }
    }

    const script = document.createElement('script')
    script.id = callbackName
    // [DEPS] 东方财富历史净值接口
    script.src = `https://api.fund.eastmoney.com/f10/lsjz?callback=${callbackName}&fundCode=${code}&pageIndex=1&pageSize=${pageSize}&_=${Date.now()}`
    script.onerror = () => {
      cleanup()
      reject(new Error('获取历史净值失败'))
    }
    document.body.appendChild(script)
  })
}

/**
 * 获取基金重仓股票
 * [WHY] 展示基金持有的股票及占比
 * [WHAT] 获取基金最新季度的重仓股数据
 * @param code 基金代码
 */
export async function fetchStockHoldings(code: string): Promise<StockHolding[]> {
  return new Promise((resolve, reject) => {
    const callbackName = `jjcc_${Date.now()}_${Math.random().toString(36).slice(2)}`
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error('获取重仓股超时'))
    }, 15000)

    ;(window as any)[callbackName] = (data: any) => {
      cleanup()
      if (!data || !data.content) {
        resolve([])
        return
      }
      // [WHAT] 解析 HTML 格式的返回数据
      // 数据格式是 HTML 表格，需要解析
      const holdings = parseStockHoldingsHtml(data.content)
      resolve(holdings)
    }

    function cleanup() {
      clearTimeout(timeout)
      delete (window as any)[callbackName]
      const script = document.getElementById(callbackName)
      if (script) {
        document.body.removeChild(script)
      }
    }

    const script = document.createElement('script')
    script.id = callbackName
    // [DEPS] 东方财富重仓股接口
    script.src = `https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc&code=${code}&topline=10&year=&month=&callback=${callbackName}&_=${Date.now()}`
    script.onerror = () => {
      cleanup()
      reject(new Error('获取重仓股失败'))
    }
    document.body.appendChild(script)
  })
}

/**
 * 解析重仓股 HTML 数据
 * [WHY] 东方财富返回的是 HTML 格式，需要解析
 * [WHAT] 提取股票代码、名称、占比等信息
 */
function parseStockHoldingsHtml(html: string): StockHolding[] {
  const holdings: StockHolding[] = []
  
  // [HOW] 使用正则匹配 HTML 表格中的数据
  // 格式：<td><a href="...">股票名称</a></td><td>占比</td>...
  const tableRegex = /<tr[^>]*>[\s\S]*?<\/tr>/gi
  const rows = html.match(tableRegex) || []
  
  for (const row of rows) {
    // 跳过表头
    if (row.includes('<th')) continue
    
    // 提取股票代码
    const codeMatch = row.match(/quote_(\d{6})\.html/i)
    // 提取股票名称
    const nameMatch = row.match(/<a[^>]*>([^<]+)<\/a>/i)
    // 提取持仓占比（第四列）
    const tdRegex = /<td[^>]*>([^<]*)<\/td>/gi
    const tds: string[] = []
    let tdMatch
    while ((tdMatch = tdRegex.exec(row)) !== null) {
      tds.push((tdMatch[1] || '').trim())
    }
    
    if (codeMatch && codeMatch[1] && nameMatch && nameMatch[1] && tds.length >= 4) {
      holdings.push({
        stockCode: codeMatch[1],
        stockName: nameMatch[1].trim(),
        holdingRatio: parseFloat((tds[3] || '0').replace('%', '')) || 0, // 占比
        holdingAmount: tds[2] || '0', // 持仓市值（万元）
        changeFromLast: tds[4] || '--' // 较上期变化
      })
    }
  }
  
  return holdings
}

// ========== 大盘指数和排行榜 API ==========

/**
 * 获取大盘指数数据
 * [WHY] 展示上证、深证、创业板等主要指数
 * [DEPS] 东方财富指数接口
 */
export async function fetchMarketIndices(): Promise<MarketIndex[]> {
  return new Promise((resolve) => {
    const callbackName = `index_${Date.now()}_${Math.random().toString(36).slice(2)}`
    const timeout = setTimeout(() => {
      cleanup()
      // [EDGE] 超时返回空数组
      resolve([])
    }, 10000)

    ;(window as any)[callbackName] = (data: any) => {
      cleanup()
      if (!data || !data.data || !data.data.diff) {
        // [EDGE] 接口失败时返回空数组，不使用模拟数据
        resolve([])
        return
      }
      
      const indices: MarketIndex[] = data.data.diff.map((item: any) => ({
        code: item.f12,
        name: item.f14,
        current: item.f2 / 100,
        change: item.f4 / 100,
        changeRate: item.f3 / 100,
        volume: item.f6 / 100000000
      }))
      resolve(indices)
    }

    function cleanup() {
      clearTimeout(timeout)
      delete (window as any)[callbackName]
      const script = document.getElementById(callbackName)
      if (script) document.body.removeChild(script)
    }

    const script = document.createElement('script')
    script.id = callbackName
    // [WHAT] 请求上证指数(1.000001)、深证成指(0.399001)、创业板指(0.399006)、科创50(1.000688)
    script.src = `https://push2.eastmoney.com/api/qt/ulist.np/get?cb=${callbackName}&fltt=2&secids=1.000001,0.399001,0.399006,1.000688&fields=f2,f3,f4,f6,f12,f14&_=${Date.now()}`
    script.onerror = () => {
      cleanup()
      resolve([])
    }
    document.body.appendChild(script)
  })
}

/**
 * 获取基金排行榜
 * [WHY] 展示涨幅榜、跌幅榜等排行数据
 * @param sortType 排序类型：r（日涨幅）、zzf（周涨幅）、1yzf（月涨幅）、6yzf（6月涨幅）、1nzf（年涨幅）
 * @param order 排序方向：desc（降序）、asc（升序）
 * @param pageSize 返回数量
 */
export async function fetchFundRanking(
  sortType = 'r',
  order = 'desc',
  pageSize = 20
): Promise<FundRankItem[]> {
  return new Promise((resolve) => {
    const callbackName = `rank_${Date.now()}_${Math.random().toString(36).slice(2)}`
    const timeout = setTimeout(() => {
      cleanup()
      resolve([])
    }, 15000)

    ;(window as any)[callbackName] = (data: any) => {
      cleanup()
      if (!data || !data.Data) {
        resolve([])
        return
      }
      
      // [WHAT] 解析排行数据
      const items: FundRankItem[] = data.Data.map((item: string) => {
        const parts = item.split(',')
        return {
          code: parts[0] || '',
          name: parts[1] || '',
          type: parts[3] || '',
          netValue: parseFloat(parts[4] ?? '0') || 0,
          dayChange: parseFloat(parts[6] ?? '0') || 0,
          weekChange: parseFloat(parts[7] ?? '0') || 0,
          monthChange: parseFloat(parts[8] ?? '0') || 0,
          yearChange: parseFloat(parts[11] ?? '0') || 0
        }
      })
      resolve(items)
    }

    function cleanup() {
      clearTimeout(timeout)
      delete (window as any)[callbackName]
      const script = document.getElementById(callbackName)
      if (script) document.body.removeChild(script)
    }

    const script = document.createElement('script')
    script.id = callbackName
    // [DEPS] 东方财富基金排行接口
    script.src = `https://fund.eastmoney.com/data/rankhandler.aspx?op=ph&dt=kf&ft=all&rs=&gs=0&sc=${sortType}&st=${order}&pi=1&pn=${pageSize}&dx=1&callback=${callbackName}&_=${Date.now()}`
    script.onerror = () => {
      cleanup()
      resolve([])
    }
    document.body.appendChild(script)
  })
}

// ========== K线数据 API ==========

/**
 * 获取基金K线数据（用于绘制K线图）
 * [WHY] 将历史净值数据转换为K线格式（OHLC）
 * [WHAT] 基金没有真正的OHLC，用相邻净值模拟
 * @param code 基金代码
 * @param days 获取天数
 */
export async function fetchKLineData(code: string, days = 120): Promise<KLineData[]> {
  // [WHY] 获取历史净值，然后转换为K线格式
  const history = await fetchNetValueHistory(code, days + 1)
  if (history.length < 2) return []

  const klineData: KLineData[] = []
  // [WHAT] 将净值数据转换为K线格式
  // 基金净值是收盘价，用前一日收盘作为开盘，计算当日高低点
  const reversed = [...history].reverse() // 按时间正序

  for (let i = 1; i < reversed.length; i++) {
    const prev = reversed[i - 1]
    const curr = reversed[i]
    const open = prev.netValue
    const close = curr.netValue
    // [WHAT] 模拟日内波动：高点和低点基于开盘收盘价的波动
    const volatility = Math.abs(close - open) * 0.3
    const high = Math.max(open, close) + volatility
    const low = Math.min(open, close) - volatility

    klineData.push({
      time: curr.date,
      open: parseFloat(open.toFixed(4)),
      high: parseFloat(high.toFixed(4)),
      low: parseFloat(Math.max(0.0001, low).toFixed(4)),
      close: parseFloat(close.toFixed(4))
    })
  }

  return klineData
}

// ========== 实时分时数据 API ==========

// [WHAT] 分时数据缓存，避免频繁请求
const timeShareCache: Map<string, { data: TimeShareData[]; timestamp: number }> = new Map()

/**
 * 获取基金当日分时数据
 * [WHY] 展示当日估值变化曲线，精确到秒
 * @param code 基金代码
 */
export async function fetchTimeShareData(code: string): Promise<TimeShareData[]> {
  // [EDGE] 5秒内返回缓存
  const cached = timeShareCache.get(code)
  if (cached && Date.now() - cached.timestamp < 5000) {
    return cached.data
  }

  return new Promise((resolve) => {
    const callbackName = `timeshare_${Date.now()}_${Math.random().toString(36).slice(2)}`
    const timeout = setTimeout(() => {
      cleanup()
      resolve([])
    }, 10000)

    ;(window as any)[callbackName] = (data: any) => {
      cleanup()
      // [WHAT] 解析分时数据
      // 天天基金分时接口返回格式：{Data: {netWorthTrend: [{x: timestamp, y: value, equityReturn: change}]}}
      if (!data || !data.Data || !data.Data.netWorthTrend) {
        resolve([])
        return
      }

      const result: TimeShareData[] = data.Data.netWorthTrend.map((item: any) => {
        const date = new Date(item.x)
        const hours = date.getHours().toString().padStart(2, '0')
        const minutes = date.getMinutes().toString().padStart(2, '0')
        const seconds = date.getSeconds().toString().padStart(2, '0')
        return {
          time: `${hours}:${minutes}:${seconds}`,
          value: item.y,
          change: item.equityReturn || 0
        }
      })

      timeShareCache.set(code, { data: result, timestamp: Date.now() })
      resolve(result)
    }

    function cleanup() {
      clearTimeout(timeout)
      delete (window as any)[callbackName]
      const script = document.getElementById(callbackName)
      if (script) document.body.removeChild(script)
    }

    const script = document.createElement('script')
    script.id = callbackName
    // [DEPS] 天天基金分时估值接口
    script.src = `https://fundgz.1234567.com.cn/js/${code}.js?rt=${Date.now()}`
    script.onerror = () => {
      cleanup()
      resolve([])
    }
    document.body.appendChild(script)
  })
}

// ========== 基金费率信息 API ==========

/**
 * 判断基金份额类型（A类/C类）
 * [WHY] 根据基金代码后缀或名称判断
 * @param code 基金代码
 * @param name 基金名称
 */
export function detectShareClass(code: string, name: string): FundShareClass {
  // [WHAT] C类基金通常代码结尾为奇数，或名称包含C
  const nameLower = name.toLowerCase()
  if (nameLower.includes('c类') || nameLower.endsWith('c') || nameLower.includes('(c)')) {
    return 'C'
  }
  if (nameLower.includes('a类') || nameLower.endsWith('a') || nameLower.includes('(a)')) {
    return 'A'
  }
  // [EDGE] 无法判断时默认为A类
  return 'A'
}

/**
 * 获取基金费率信息
 * [WHY] 用于计算买入/卖出手续费和销售服务费
 * @param code 基金代码
 */
export async function fetchFundFeeInfo(code: string): Promise<FundFeeInfo | null> {
  return new Promise((resolve) => {
    const callbackName = `fee_${Date.now()}_${Math.random().toString(36).slice(2)}`
    const timeout = setTimeout(() => {
      cleanup()
      // [EDGE] 无法获取时返回默认费率
      resolve(getDefaultFeeInfo(code))
    }, 10000)

    ;(window as any)[callbackName] = (data: any) => {
      cleanup()
      if (!data || !data.Datas) {
        resolve(getDefaultFeeInfo(code))
        return
      }

      try {
        const d = data.Datas
        // [WHAT] 解析费率数据
        const feeInfo: FundFeeInfo = {
          code,
          shareClass: detectShareClass(code, d.SHORTNAME || ''),
          buyFeeRate: parseFloat(d.MAXSG) || 0.15, // 申购费率
          sellFeeRates: parseSellFeeRates(d.SHFL), // 赎回费率
          serviceFeeRate: parseFloat(d.XSJF) || 0.4, // 销售服务费
          managementFeeRate: parseFloat(d.GLFL) || 0.5, // 管理费
          custodianFeeRate: parseFloat(d.TGFL) || 0.1 // 托管费
        }
        resolve(feeInfo)
      } catch {
        resolve(getDefaultFeeInfo(code))
      }
    }

    function cleanup() {
      clearTimeout(timeout)
      delete (window as any)[callbackName]
      const script = document.getElementById(callbackName)
      if (script) document.body.removeChild(script)
    }

    const script = document.createElement('script')
    script.id = callbackName
    // [DEPS] 天天基金费率接口
    script.src = `https://fundgz.1234567.com.cn/FundNew/GetFundMJJZ?callback=${callbackName}&fcode=${code}&_=${Date.now()}`
    script.onerror = () => {
      cleanup()
      resolve(getDefaultFeeInfo(code))
    }
    document.body.appendChild(script)
  })
}

/**
 * 解析赎回费率数组
 */
function parseSellFeeRates(shfl: string | undefined): FundFeeInfo['sellFeeRates'] {
  // [WHAT] 默认赎回费率（根据持有天数）
  const defaultRates = [
    { minDays: 0, maxDays: 7, rate: 1.5 },      // 7天内1.5%
    { minDays: 7, maxDays: 30, rate: 0.75 },    // 7-30天0.75%
    { minDays: 30, maxDays: 365, rate: 0.5 },   // 30天-1年0.5%
    { minDays: 365, maxDays: 730, rate: 0.25 }, // 1-2年0.25%
    { minDays: 730, maxDays: Infinity, rate: 0 } // 2年以上免费
  ]

  if (!shfl) return defaultRates

  // [WHAT] 尝试解析费率字符串（格式各异，使用默认值更稳妥）
  return defaultRates
}

/**
 * 返回默认费率信息
 */
function getDefaultFeeInfo(code: string): FundFeeInfo {
  return {
    code,
    shareClass: 'A',
    buyFeeRate: 0.15,
    sellFeeRates: [
      { minDays: 0, maxDays: 7, rate: 1.5 },
      { minDays: 7, maxDays: 30, rate: 0.75 },
      { minDays: 30, maxDays: 365, rate: 0.5 },
      { minDays: 365, maxDays: 730, rate: 0.25 },
      { minDays: 730, maxDays: Infinity, rate: 0 }
    ],
    serviceFeeRate: 0.4,
    managementFeeRate: 0.5,
    custodianFeeRate: 0.1
  }
}

/**
 * 计算A类基金买入手续费
 * [WHY] A类基金前端收费
 * @param amount 买入金额
 * @param feeRate 费率（%）
 * @param deduct 是否从金额中扣除
 */
export function calculateBuyFee(amount: number, feeRate: number, deduct: boolean): {
  fee: number
  actualAmount: number
  shares: number
  netValue: number
} & { calculateShares: (nv: number) => number } {
  const fee = amount * (feeRate / 100)
  const actualAmount = deduct ? amount - fee : amount

  return {
    fee: Math.round(fee * 100) / 100, // 四舍五入到分
    actualAmount,
    shares: 0,
    netValue: 0,
    calculateShares: (nv: number) => actualAmount / nv
  }
}

/**
 * 计算卖出手续费
 * [WHY] 根据持有天数计算赎回费率
 * @param shares 卖出份额
 * @param netValue 当前净值
 * @param holdingDays 持有天数
 * @param sellFeeRates 赎回费率数组
 */
export function calculateSellFee(
  shares: number,
  netValue: number,
  holdingDays: number,
  sellFeeRates: FundFeeInfo['sellFeeRates']
): number {
  const value = shares * netValue
  // [WHAT] 找到对应持有天数的费率
  const rateInfo = sellFeeRates.find(
    r => holdingDays >= r.minDays && holdingDays < r.maxDays
  )
  const rate = rateInfo ? rateInfo.rate : 0
  return Math.round(value * (rate / 100) * 100) / 100
}

/**
 * 计算C类基金每日销售服务费
 * [WHY] C类基金按日计提销售服务费
 * @param shares 持有份额
 * @param netValue 当前净值
 * @param annualRate 年化费率（%）
 */
export function calculateDailyServiceFee(
  shares: number,
  netValue: number,
  annualRate: number
): number {
  const value = shares * netValue
  // [WHAT] 日费率 = 年化费率 / 365
  const dailyRate = annualRate / 365 / 100
  const fee = value * dailyRate
  // [EDGE] 不满一分按一分算
  return fee < 0.01 && fee > 0 ? 0.01 : Math.round(fee * 100) / 100
}

// ========== 交易所风格 API（模仿欧易/币安） ==========

/**
 * 基金详细信息（包含基金经理、规模等）
 */
export interface FundDetailInfo {
  code: string
  name: string
  fullName: string
  type: string
  establishDate: string
  scale: number           // 规模（亿）
  scaleDate: string       // 规模日期
  company: string         // 基金公司
  manager: string         // 基金经理
  managerId: string
  managerPhoto: string
  custodian: string       // 托管人
  benchmark: string       // 业绩比较基准
  riskLevel: number       // 风险等级 1-5
  rating: number          // 评级 1-5星
  buyStatus: string       // 申购状态
  sellStatus: string      // 赎回状态
  minBuy: number          // 起购金额
  buyFeeRate: string      // 申购费率
  manageFeeRate: string   // 管理费率
  trustFeeRate: string    // 托管费率
  serviceFeeRate: string  // 销售服务费率
}

/**
 * 获取基金详细信息
 * [WHY] 模仿交易所显示详细的标的信息
 */
export async function fetchFundDetailInfo(code: string): Promise<FundDetailInfo | null> {
  return new Promise((resolve) => {
    const callbackName = `detail_${Date.now()}_${Math.random().toString(36).slice(2)}`
    const timeout = setTimeout(() => {
      cleanup()
      resolve(null)
    }, 15000)

    ;(window as any)[callbackName] = (data: any) => {
      cleanup()
      if (!data || !data.Datas) {
        resolve(null)
        return
      }
      
      try {
        const d = data.Datas
        resolve({
          code: d.FCODE || code,
          name: d.SHORTNAME || '',
          fullName: d.FULLNAME || '',
          type: d.FTYPE || '',
          establishDate: d.ESTABDATE || '',
          scale: parseFloat(d.ENDNAV) / 100000000 || 0,
          scaleDate: d.FEGMRQ || '',
          company: d.JJGS || '',
          manager: d.JJJL || '',
          managerId: '',
          managerPhoto: '',
          custodian: d.TGYH || '',
          benchmark: d.BENCH || '',
          riskLevel: parseInt(d.RISKLEVEL) || 3,
          rating: parseInt(d.RLEVEL_SZ) || 0,
          buyStatus: d.SGZT || '--',
          sellStatus: d.SHZT || '--',
          minBuy: parseFloat(d.MINSG) || 10,
          buyFeeRate: d.SOURCERATE || '--',
          manageFeeRate: d.MGREXP || '--',
          trustFeeRate: d.TRUSTEXP || '--',
          serviceFeeRate: d.SALESEXP || '--'
        })
      } catch {
        resolve(null)
      }
    }

    function cleanup() {
      clearTimeout(timeout)
      delete (window as any)[callbackName]
      const script = document.getElementById(callbackName)
      if (script) document.body.removeChild(script)
    }

    const script = document.createElement('script')
    script.id = callbackName
    script.src = `https://fundmobapi.eastmoney.com/FundMNewApi/FundMNDetailInformation?callback=${callbackName}&FCODE=${code}&_=${Date.now()}`
    script.onerror = () => {
      cleanup()
      resolve(null)
    }
    document.body.appendChild(script)
  })
}

/**
 * 阶段涨幅数据
 */
export interface PeriodChangeData {
  period: string          // 周期标识
  label: string           // 显示标签
  change: number          // 涨跌幅
  rank: number            // 同类排名
  total: number           // 同类总数
  avgChange: number       // 同类平均
  hs300Change: number     // 沪深300涨幅
}

/**
 * 获取基金阶段涨幅（模仿交易所24h/7d/30d涨跌）
 * [WHY] 使用fund.eastmoney.com的pingzhongdata接口获取更完整的数据
 */
export async function fetchPeriodChanges(code: string): Promise<PeriodChangeData[]> {
  return new Promise((resolve) => {
    const scriptId = `period_${Date.now()}`
    const timeout = setTimeout(() => {
      cleanup()
      // [WHAT] 如果API超时，使用历史净值计算阶段涨幅
      calculateFromHistory(code).then(resolve)
    }, 8000)

    // [WHAT] 尝试从pingzhongdata获取收益率数据
    const script = document.createElement('script')
    script.id = scriptId
    script.src = `https://fund.eastmoney.com/pingzhongdata/${code}.js?_=${Date.now()}`
    
    script.onload = () => {
      cleanup()
      try {
        // [WHAT] pingzhongdata会设置多个全局变量
        const syl_1n = (window as any).syl_1n || 0  // 近1年收益
        const syl_6y = (window as any).syl_6y || 0  // 近6月收益
        const syl_3y = (window as any).syl_3y || 0  // 近3月收益
        const syl_1y = (window as any).syl_1y || 0  // 近1月收益
        const Data_netWorthTrend = (window as any).Data_netWorthTrend || []
        
        const result: PeriodChangeData[] = []
        
        // [WHAT] 从历史净值计算各周期涨幅
        if (Data_netWorthTrend.length > 0) {
          const latestValue = Data_netWorthTrend[Data_netWorthTrend.length - 1]?.y || 0
          const now = Date.now()
          
          const periods = [
            { key: 'Z', label: '近1周', days: 7 },
            { key: 'Y', label: '近1月', days: 30 },
            { key: '3Y', label: '近3月', days: 90 },
            { key: '6Y', label: '近6月', days: 180 },
            { key: '1N', label: '近1年', days: 365 }
          ]
          
          periods.forEach(p => {
            const startTime = now - p.days * 24 * 60 * 60 * 1000
            const startData = Data_netWorthTrend.find((d: any) => d.x >= startTime)
            if (startData && latestValue > 0) {
              const change = ((latestValue - startData.y) / startData.y) * 100
              result.push({
                period: p.key,
                label: p.label,
                change: parseFloat(change.toFixed(2)),
                rank: 0,
                total: 0,
                avgChange: 0,
                hs300Change: 0
              })
            }
          })
        }
        
        resolve(result.length > 0 ? result : [])
      } catch (err) {
        console.error('解析阶段涨幅数据失败:', err)
        resolve([])
      }
    }
    
    script.onerror = () => {
      cleanup()
      calculateFromHistory(code).then(resolve)
    }

    function cleanup() {
      clearTimeout(timeout)
      const s = document.getElementById(scriptId)
      if (s) document.body.removeChild(s)
    }

    document.body.appendChild(script)
  })
}

/**
 * 从历史净值计算阶段涨幅（备用方案）
 */
async function calculateFromHistory(code: string): Promise<PeriodChangeData[]> {
  try {
    const history = await fetchNetValueHistory(code, 365)
    if (history.length < 2) return []
    
    const latest = history[0]
    const result: PeriodChangeData[] = []
    const now = new Date()
    
    const periods = [
      { key: 'Z', label: '近1周', days: 7 },
      { key: 'Y', label: '近1月', days: 30 },
      { key: '3Y', label: '近3月', days: 90 },
      { key: '6Y', label: '近6月', days: 180 },
      { key: '1N', label: '近1年', days: 365 }
    ]
    
    periods.forEach(p => {
      const startDate = new Date(now.getTime() - p.days * 24 * 60 * 60 * 1000)
      const startRecord = history.find(h => new Date(h.date) <= startDate)
      if (startRecord) {
        const change = ((latest.netValue - startRecord.netValue) / startRecord.netValue) * 100
        result.push({
          period: p.key,
          label: p.label,
          change: parseFloat(change.toFixed(2)),
          rank: 0,
          total: 0,
          avgChange: 0,
          hs300Change: 0
        })
      }
    })
    
    return result
  } catch {
    return []
  }
}

/**
 * 基金经理信息
 */
export interface FundManagerInfo {
  id: string
  name: string
  photo: string
  company: string
  workingDays: number     // 从业天数
  managedScale: number    // 管理规模（亿）
  managedCount: number    // 管理基金数
  bestReturn: number      // 最佳回报
  annualReturn: number    // 年化回报
  // 评分（10分制）
  overallScore: number    // 综合评分
  experienceScore: number // 经验值
  returnScore: number     // 收益率
  excessScore: number     // 超额收益
}

/**
 * 获取基金经理信息
 */
export async function fetchFundManagerInfo(managerId: string): Promise<FundManagerInfo | null> {
  return new Promise((resolve) => {
    const callbackName = `mgr_${Date.now()}_${Math.random().toString(36).slice(2)}`
    const timeout = setTimeout(() => {
      cleanup()
      resolve(null)
    }, 15000)

    ;(window as any)[callbackName] = (data: any) => {
      cleanup()
      if (!data || !data.Datas) {
        resolve(null)
        return
      }
      
      try {
        const d = data.Datas
        resolve({
          id: d.MGRID || managerId,
          name: d.MGRNAME || '',
          photo: d.NEWPHOTOURL || '',
          company: d.JJGS || '',
          workingDays: parseInt(d.TOTALDAYS) || 0,
          managedScale: parseFloat(d.NETNAV) / 100000000 || 0,
          managedCount: parseInt(d.FCOUNT) || 0,
          bestReturn: parseFloat(d.MAXPENAVGROWTH) || 0,
          annualReturn: parseFloat(d.YIELDSE) || 0,
          overallScore: parseFloat(d.MGOLD) || 0,
          experienceScore: parseFloat(d.SDAY) || 0,
          returnScore: parseFloat(d.SY1) || 0,
          excessScore: parseFloat(d.SINFO1) || 0
        })
      } catch {
        resolve(null)
      }
    }

    function cleanup() {
      clearTimeout(timeout)
      delete (window as any)[callbackName]
      const script = document.getElementById(callbackName)
      if (script) document.body.removeChild(script)
    }

    const script = document.createElement('script')
    script.id = callbackName
    script.src = `https://fundmobapi.eastmoney.com/FundMNewApi/FundMSNMangerInfo?callback=${callbackName}&FCODE=${managerId}&_=${Date.now()}`
    script.onerror = () => {
      cleanup()
      resolve(null)
    }
    document.body.appendChild(script)
  })
}

/**
 * 同类排名走势数据
 */
export interface RankTrendData {
  date: string
  rank: number
  total: number
}

/**
 * 获取同类排名走势（模仿交易所深度图）
 */
export async function fetchRankTrend(code: string, range = '1n'): Promise<RankTrendData[]> {
  return new Promise((resolve) => {
    const callbackName = `rank_${Date.now()}_${Math.random().toString(36).slice(2)}`
    const timeout = setTimeout(() => {
      cleanup()
      resolve([])
    }, 15000)

    ;(window as any)[callbackName] = (data: any) => {
      cleanup()
      if (!data || !data.Datas) {
        resolve([])
        return
      }
      
      const result: RankTrendData[] = data.Datas.map((item: any) => ({
        date: item.PDATE,
        rank: parseInt(item.QRANK) || 0,
        total: parseInt(item.QSC) || 0
      }))
      
      resolve(result)
    }

    function cleanup() {
      clearTimeout(timeout)
      delete (window as any)[callbackName]
      const script = document.getElementById(callbackName)
      if (script) document.body.removeChild(script)
    }

    const script = document.createElement('script')
    script.id = callbackName
    script.src = `https://fundmobapi.eastmoney.com/FundMNewApi/FundRankDiagram?callback=${callbackName}&FCODE=${code}&RANGE=${range}&_=${Date.now()}`
    script.onerror = () => {
      cleanup()
      resolve([])
    }
    document.body.appendChild(script)
  })
}

/**
 * 累计收益对比数据
 */
export interface AccumulatedReturnData {
  date: string
  fundReturn: number      // 基金收益
  indexReturn: number     // 指数收益
  avgReturn: number       // 同类平均
}

/**
 * 获取累计收益对比（模仿交易所收益曲线）
 */
export async function fetchAccumulatedReturn(
  code: string, 
  range = '1n', 
  indexCode = '000300'
): Promise<AccumulatedReturnData[]> {
  return new Promise((resolve) => {
    const callbackName = `acc_${Date.now()}_${Math.random().toString(36).slice(2)}`
    const timeout = setTimeout(() => {
      cleanup()
      resolve([])
    }, 15000)

    ;(window as any)[callbackName] = (data: any) => {
      cleanup()
      if (!data || !data.Datas) {
        resolve([])
        return
      }
      
      const result: AccumulatedReturnData[] = data.Datas.map((item: any) => ({
        date: item.PDATE,
        fundReturn: parseFloat(item.YIELD) || 0,
        indexReturn: parseFloat(item.INDEXYIELD) || 0,
        avgReturn: parseFloat(item.FUNDTYPEYIELD) || 0
      }))
      
      resolve(result)
    }

    function cleanup() {
      clearTimeout(timeout)
      delete (window as any)[callbackName]
      const script = document.getElementById(callbackName)
      if (script) document.body.removeChild(script)
    }

    const script = document.createElement('script')
    script.id = callbackName
    script.src = `https://fundmobapi.eastmoney.com/FundMNewApi/FundVPageAcc?callback=${callbackName}&FCODE=${code}&RANGE=${range}&INDEXCODE=${indexCode}&_=${Date.now()}`
    script.onerror = () => {
      cleanup()
      resolve([])
    }
    document.body.appendChild(script)
  })
}
