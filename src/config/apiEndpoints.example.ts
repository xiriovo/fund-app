// [WHY] API端点配置示例文件
// [WHAT] 复制此文件为 apiEndpoints.ts 并填入实际API地址
// [NOTE] apiEndpoints.ts 已加入 .gitignore，不会被提交

export const API_ENDPOINTS = {
  // 基金估值接口
  FUND_ESTIMATE: 'YOUR_FUND_ESTIMATE_API',
  
  // 天天基金API
  EASTMONEY_FUND: 'YOUR_EASTMONEY_FUND_API',
  EASTMONEY_API: 'YOUR_EASTMONEY_API',
  EASTMONEY_PUSH: 'YOUR_EASTMONEY_PUSH_API',
  EASTMONEY_RANK: 'YOUR_EASTMONEY_RANK_API',
  EASTMONEY_F10: 'YOUR_EASTMONEY_F10_API',
  
  // 财经资讯
  EASTMONEY_NEWS: 'YOUR_EASTMONEY_NEWS_API',
  EASTMONEY_7X24: 'YOUR_EASTMONEY_7X24_API',
  
  // 大盘指数
  SINA_INDEX: 'YOUR_SINA_INDEX_API',
}

// [WHAT] API路径模板
export const API_PATHS = {
  fundEstimate: (code: string) => `${API_ENDPOINTS.FUND_ESTIMATE}/${code}.js`,
  dividendRecords: (code: string) => `${API_ENDPOINTS.EASTMONEY_API}/f10/fhsp?fundcode=${code}`,
  fundRank: (params: string) => `${API_ENDPOINTS.EASTMONEY_RANK}?${params}`,
}
