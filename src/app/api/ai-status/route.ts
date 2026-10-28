// AI 服务状态：返回当前生效的供应商与模型（不发起真实请求，不泄露任何 Key 信息）
// GET /api/ai-status
// 用途：部署后通过访问该接口确认环境变量 SILICONFLOW_API_KEY 是否配置成功
import { getLlmStatus } from '@/lib/ai'

export const runtime = 'nodejs'

export async function GET() {
  const status = getLlmStatus()
  return Response.json({
    ...status,
    hint: status.envKeySet
      ? '已从部署平台环境变量读取到 SILICONFLOW_API_KEY，AI 识别与解析将使用硅基流动服务'
      : '未检测到环境变量 SILICONFLOW_API_KEY：请在部署平台（Vercel/服务器）的 Settings → Environment Variables 中配置后重新部署',
  })
}
