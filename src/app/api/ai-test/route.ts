// AI 连接测试：用给定 Key 发起一次极小的补全请求，验证 Key 与模型可用性
// POST /api/ai-test，可携带 x-ai-key 头或 body { key }
import { NextRequest } from 'next/server'
import { chatSafe, getLlmStatus } from '@/lib/ai'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const headerKey = req.headers.get('x-ai-key') ?? ''
  const body = (await req.json().catch(() => ({}))) as { key?: string }
  const key = (body.key ?? '').trim() || headerKey.trim()
  const status = getLlmStatus(key)

  if (status.provider === 'builtin') {
    return Response.json({
      ok: false,
      model: status.model,
      error: '未提供 API Key：请在输入框填写硅基流动 API Key（sk-…）后再测试',
    })
  }

  const t0 = Date.now()
  try {
    const reply = await chatSafe(
      [{ role: 'user', content: '请只回复四个字：连接成功' }],
      { apiKey: key, timeoutMs: 30_000 }
    )
    return Response.json({
      ok: true,
      model: status.model,
      reply: reply.slice(0, 50),
      ms: Date.now() - t0,
    })
  } catch (e) {
    return Response.json({
      ok: false,
      model: status.model,
      error: e instanceof Error ? e.message : String(e),
      ms: Date.now() - t0,
    })
  }
}
