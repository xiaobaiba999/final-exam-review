// mammoth 浏览器 bundle 的最小类型声明（仅用到 extractRawText）
declare module 'mammoth/mammoth.browser' {
  export interface RawTextResult {
    value: string
    messages: Array<{ type: string; message: string }>
  }
  export function extractRawText(input: { arrayBuffer: ArrayBuffer }): Promise<RawTextResult>
}
