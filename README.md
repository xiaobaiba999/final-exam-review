# 期末复习助手 📚

AI 驱动的大学期末复习工具：把不规范的 Word/PDF 题库文档一键变成可刷题、带解析的在线题库。
**纯客户端静态应用**——没有服务器、没有数据库，所有数据都存在你自己的浏览器里，支持多用户本地账号。

**在线使用**：<https://xiaobaiba999.github.io/final-exam-review/>

## ✨ 功能

- **用户登录**：注册昵称（可设密码）即用，每人题库/进度/错题本互相隔离；数据仅存本机浏览器
- **AI 题库识别**：上传 Word(.docx) / PDF / TXT，AI 流式识别单选、判断、填空、简答四种题型，自动回填文末答案表
- **双 AI 接口商**：我的 API 支持 **硅基流动**（推荐，国内直连）/ **DeepSeek 官方** / 自定义 OpenAI 兼容接口，接口地址与模型自动填充、可改
- **公共 API**：站长可内置一个公共 Key，新用户免配置直接用；也可随时切换自己的 Key
- **多种复习模式**：单题练习、顺序刷题、乱序刷题、背题模式（直接看答案解析）
- **错题本**：答错自动收入、答对自动移出，可只刷错题
- **收藏**：一键星标记号，支持只练收藏题
- **进度统计**：题库总量 / 错题数 / 收藏数 / 累计正确率一目了然，中途退出自动存档、可「继续上次」
- **移动端优先**：底部 Tab 导航、大触控目标、安全区适配，手机刷题体验佳

## 🚀 使用说明

1. 打开网页 → **注册一个昵称**（可不设密码）登录
2. AI 配置（二选一）：
   - **公共 API**：站长已内置 Key 时，什么都不用填，直接用
   - **我的 API**：右上角⚙设置 → 切到「我的 API」→ 选接口（硅基流动 / DeepSeek 官方）→ 填入自己的 Key
     - 硅基流动：<https://cloud.siliconflow.cn> → API 密钥 → 新建（`sk-` 开头）
     - DeepSeek 官方：<https://platform.deepseek.com> → API Keys → 创建
3. 上传题库文档（Word/PDF/TXT），AI 识别完成自动进题库

> 🔒 **隐私**：Key 与数据只保存在你自己浏览器的 localStorage/IndexedDB 中，浏览器直连 AI 接口，**不上传任何服务器**。

## 📦 换设备迁移

设置 → **导出文件**（旧设备）→ 新设备登录后 **导入文件**，题库与学习进度一键迁移。

## 🛠 部署

- **GitHub Pages（已上线）**：<https://xiaobaiba999.github.io/final-exam-review/>
  - 方式：构建静态导出后推送到 `gh-pages` 分支，Pages 源 = `gh-pages / root`（已启用，含 `.nojekyll`）
  - 更新流程：`DEPLOY_TARGET=pages NEXT_PUBLIC_BASE_PATH=/final-exam-review bunx next build` → 把 `out/` 内容强推到 `gh-pages` 分支
  - 自动部署（可选）：Actions 工作流暂存于 `scripts/deploy-pages.yml.disabled`；给 Token 勾上 `workflow` 权限后移回 `.github/workflows/deploy.yml` 并在 Pages 设置改选 "GitHub Actions" 即可恢复 push main 自动发布
- **公共 API 注入**（可选）：构建时设置环境变量
  - `NEXT_PUBLIC_PUBLIC_AI_KEY`（公共硅基流动 Key）
  - `NEXT_PUBLIC_PUBLIC_AI_BASE_URL`（默认 `https://api.siliconflow.cn/v1`）
  - `NEXT_PUBLIC_PUBLIC_AI_MODEL`（默认 `deepseek-ai/DeepSeek-V4.1-Flash`）
- **Cloudflare Pages 兼容**：构建命令 `bunx next build`（或 `npx next build`），输出目录 `out`，环境变量 `DEPLOY_TARGET=pages`、`NODE_VERSION=22`（无需 BASE_PATH）
- **Vercel 兼容**：仓库保留了 `vercel.json`，可直接导入部署

## 💻 本地开发

```bash
bun install
bun run dev   # http://localhost:3000
```

> 静态导出预览：`DEPLOY_TARGET=pages NEXT_PUBLIC_BASE_PATH=/final-exam-review bunx next build`，产物在 `out/`。

## 🧰 技术栈

Next.js 16 (App Router) + TypeScript + Tailwind CSS 4 + shadcn/ui + IndexedDB + 硅基流动 / DeepSeek AI（浏览器直连）
