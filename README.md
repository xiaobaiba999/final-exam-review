# 期末复习助手 📚

AI 驱动的大学期末复习工具：把不规范的 Word/PDF 题库文档一键变成可刷题、带解析的在线题库。

## ✨ 功能

- **AI 题库识别**：上传 Word(.docx)/PDF/TXT，AI 流式识别单选、判断、填空、简答四种题型
  - 按题目边界智能分块、并发抽取、题号精准补扫、文末答案表自动回填
  - 片段级断点续跑：失败片段自动补跑，成功片段走缓存不重复消耗
  - 识别过程实时流式展示进度，断线自动重连
- **复习模式**：练习 / 背题双模式；顺序/乱序；单选判断自动判分，填空简答自评，即时展示解析
- **错题本**：答错自动收入、答对自动移出，可只刷错题；手动移出亦可
- **收藏**：任意题目一键星标，支持只练收藏题
- **进度记忆**：中途退出自动存档，下次打开一键「继续上次」；结果页可「只刷本轮错题」
- **统计总览**：题库总量 / 错题数 / 收藏数 / 累计正确率一目了然
- **AI 详细解析**：一键为缺少解析的题目批量生成简明解析
- **移动端优先**：底部 Tab 导航、44px+ 触控目标、底部安全区适配，手机刷题体验佳

## 🤖 AI 模型

通过 [硅基流动 SiliconFlow](https://siliconflow.cn) 调用 **`deepseek-ai/DeepSeek-V4.1-Flash`**（可用环境变量 `SILICONFLOW_MODEL` 更换）。

### API Key 配置（仅环境变量，前端无任何 Key 输入入口）

**页面 UI 故意不提供「添加 Key」按钮**——Key 只保存在部署平台的环境变量中：

| 配置位置 | 说明 | 安全性 |
|---------|------|--------|
| **Vercel → Settings → Environment Variables** | 部署时配置一次，全平台生效 | 平台加密存储，访客不可见 |
| **GitHub Secrets**（若用 Actions 部署） | 仓库 Settings → Secrets and variables → Actions | 加密存储，日志中自动打码 |

- 前端代码、网络请求、浏览器存储中**均不出现** API Key（Key 不经过浏览器）
- `.env` 已被 `.gitignore` 排除，仓库中只有 `.env.example` 模板，**永远不会把 Key 提交进仓库**
- 部署后可访问 `https://你的域名/api/ai-status` 验证：返回 `"envKeySet": true` 即配置成功

获取 Key：注册 [硅基流动](https://cloud.siliconflow.cn) → API 密钥 → 新建（`sk-` 开头）。

## 🚀 部署到 Vercel（免费、永久访问）

### 1. 准备免费 PostgreSQL 数据库（Neon）

Vercel 的函数没有持久磁盘，云端部署需用免费 Postgres（本地开发仍用 SQLite，无需任何改动）：

1. 注册 [Neon](https://neon.tech)（免费，无需绑卡）→ 新建 Project
2. 复制连接串（形如 `postgresql://user:pass@ep-xxx.aws.neon.tech/neondb?sslmode=require`）

### 2. 把代码推送到 GitHub

```bash
# 在本机克隆本仓库后执行，或使用你已有的仓库
git remote add origin https://github.com/xiaobaiba999/<你的仓库名>.git
git push -u origin main
```

### 3. Vercel 导入并配置环境变量

1. 打开 [vercel.com](https://vercel.com)（可用 GitHub 账号直接登录）→ **Add New → Project** → 选中刚推送的仓库 → Import
2. 展开 **Environment Variables**，添加：

   | Name | Value | 说明 |
   |------|-------|------|
   | `DATABASE_URL` | Neon 连接串 | 构建时会自动建表 |
   | `SILICONFLOW_API_KEY` | 你的硅基流动 Key（`sk-…`） | **加密保存，隐藏不外泄** |

3. 点 **Deploy**，等待构建完成即可获得永久访问地址（`https://<项目名>.vercel.app`）

> 部署配置已内置（`vercel.json`）：构建时自动使用 PostgreSQL schema 建表，无需手动迁移。
>
> GitHub Secrets 说明：GitHub 仓库 Settings → Secrets and variables → Actions 中配置的 Secrets 仅用于 GitHub Actions，**对访客完全不可见**；Vercel 的环境变量同理。

### 备选部署方案

- **Render / Railway**：支持持久卷 + SQLite，长连接识别无时长限制（Vercel 免费版单次函数上限约 60 秒，超出部分前端会自动重连并基于片段缓存无缝续跑，识别仍能完成，只是分几段进行）
- **本地/服务器自托管**：`bun install && bun run build && bun run start`（使用内置 SQLite，数据存 `db/custom.db`）

## 💻 本地开发

```bash
bun install
cp .env.example .env        # 填入 SILICONFLOW_API_KEY（沙箱/本地不填则回退内置调试模型）
bun run db:push             # 初始化 SQLite
bun run dev                 # http://localhost:3000
```

## 🧠 识别机制（为什么偶尔要等）

长文档会被按题目边界切成若干片段，并发交给 AI 抽取，随后执行：题号补扫 → 去重 → 文末答案表回填。
遇到限流（429）时自动指数退避并多轮补跑失败片段；**只有全部片段成功的结果才会进入缓存**，
部分失败的结果不缓存，点「重新识别」只会补跑失败片段，已成功片段瞬间从缓存恢复。

## ❓ 常见问题

- **识别出的题目比文档少？** 先点「重新识别」（只补失败片段），再不行用「强制重识（不用缓存）」；确认上传的是文字版文档（扫描版 PDF 暂不支持）
- **云端识别中途断了？** 前端会自动重连（最多 3 次）并从缓存续跑；也可手动再点「重新识别」
- **AI 相关报错「未配置」？** 在部署平台（Vercel/服务器）环境变量中配置 `SILICONFLOW_API_KEY` 后重新部署；本地开发写入 `.env` 即可
- **想换模型？** 部署平台环境变量加 `SILICONFLOW_MODEL=<模型全名>` 即可

## 🔒 隐私与安全

- API Key：仅存于部署平台环境变量（加密、打码），前端无 Key 输入入口，Key 不经过浏览器，绝不写入 Git 仓库或任何日志
- 题库数据：保存在你自己的数据库中，不经第三方
- 上传的文档仅用于当次识别，不做持久化存储
