# 期末复习助手 📚

AI 驱动的大学期末复习工具：把不规范的 Word/PDF 题库文档一键变成可刷题、带解析的在线题库。
**纯客户端静态应用**——没有服务器、没有数据库，所有数据都存在你自己的浏览器里。

**在线使用**：<https://xiaobaiba999.github.io/final-exam-review/>

## ✨ 功能

- **AI 题库识别**：上传 Word(.docx) / PDF / TXT，AI 流式识别单选、判断、填空、简答四种题型，自动回填文末答案表
- **多种复习模式**：单题练习、顺序刷题、乱序刷题、背题模式（直接看答案解析）
- **错题本**：答错自动收入、答对自动移出，可只刷错题
- **收藏**：一键星标记号，支持只练收藏题
- **进度统计**：题库总量 / 错题数 / 收藏数 / 累计正确率一目了然，中途退出自动存档、可「继续上次」
- **移动端优先**：底部 Tab 导航、大触控目标、安全区适配，手机刷题体验佳

## 🚀 使用说明（三步开始刷题）

1. 打开网页，点**右上角设置**
2. 填入**硅基流动 API Key**：
   - 到 <https://cloud.siliconflow.cn> 注册 → API 密钥 → 新建（`sk-` 开头）
   - 默认模型 `deepseek-ai/DeepSeek-V4.1-Flash`，无需额外配置
3. 回到首页**上传题库文档**（Word/PDF/TXT），点识别即可

> 🔒 **隐私**：API Key 只保存在你自己浏览器的 localStorage 中，仅用于浏览器直连硅基流动 API，**不上传任何服务器**；题库数据同样只存在本机浏览器（IndexedDB）。

## ☁️ GitHub 云同步（可选功能）

数据默认存在浏览器 IndexedDB 里，换设备或清浏览器数据会丢失。可选配置 GitHub 同步实现跨设备备份/恢复：

1. 准备 GitHub PAT（Personal Access Token）：
   - **classic**：在 GitHub → Settings → Developer settings 创建，勾选 **repo** 权限
   - **fine-grained**：仅勾选目标仓库的 **Contents 读写** 权限（更安全，推荐）
2. 在本应用设置页填入 PAT，点 **「一键创建私有数据仓库」**：应用自动检测用户名并创建私有仓库 `final-exam-review-data`（也可手动创建后填入仓库名）
3. 点同步：题库、进度、错题本、收藏（**不含 API Key 和 PAT 本身**）会以 JSON 形式提交到该仓库的 `data/review-data.json`
4. 换新设备时：打开页面 → 设置 → 填同样的 PAT → 从仓库拉取即可恢复

> 推荐用独立私有数据仓库存学习数据；不要填本代码仓库，否则每次自动同步都会触发 Pages 重新部署，且题库会公开可见

## 🛠 部署

- **GitHub Pages（已上线）**：<https://xiaobaiba999.github.io/final-exam-review/>
  - 方式：本地/沙箱构建静态导出后推送到 `gh-pages` 分支，Pages 源 = `gh-pages / root`（已启用，含 `.nojekyll`）
  - 更新流程：改代码 → `DEPLOY_TARGET=pages NEXT_PUBLIC_BASE_PATH=/final-exam-review bunx next build` → 把 `out/` 内容强推到 `gh-pages` 分支即可
  - 自动部署（可选）：当前 Token 无 `workflow` 权限，Actions 工作流暂存于 `scripts/deploy-pages.yml.disabled`；将来给 Token 勾上 `workflow` 权限后，把它移回 `.github/workflows/deploy.yml` 并在 Pages 设置改选 "GitHub Actions"，即可恢复 push main 自动发布
- **Vercel 兼容**：仓库保留了 `vercel.json`，同样可以直接导入 Vercel 部署（二选一即可）

## 💻 本地开发

```bash
bun install
bun run dev   # http://localhost:3000
```

> 静态导出预览：`DEPLOY_TARGET=pages NEXT_PUBLIC_BASE_PATH=/final-exam-review bunx next build`，产物在 `out/`。

## 🧰 技术栈

Next.js 16 (App Router) + TypeScript + Tailwind CSS 4 + shadcn/ui + IndexedDB + 硅基流动 AI（浏览器直连）
