# 班级 AI 助手

一个面向班干部和同学的班级通知、待办与 AI 问答网页。回答绑定班级原通知，涉及发布和状态修改的动作需要用户确认。

## 快速开始（本机推荐）

需要 Node.js 24.14 或更高版本以及 pnpm。

```powershell
pnpm install
pnpm build
pnpm start
```

访问 `http://127.0.0.1:8787`。本地适配器运行同一个 Hono 应用，自动迁移并持久化 SQLite 数据到 `.local/class-ai.sqlite`。不要将 `.local` 中的班级数据提交到仓库。

开发前端时可另开终端运行 `pnpm dev`；Vite 默认在 5173 端口，并将 `/api` 代理到 8787。

本机的 workerd 当前因 Windows DLL 问题退出（3221225781），因此提供上述 Node/SQLite 适配器。Cloudflare Worker 的部署配置仍保留，但未把本地适配器验证等同于 Cloudflare 线上验证。

## 模型配置

班枢智能体逻辑已经移入本项目后端，网页通过同域 `/api/chat` 调用，不再请求 Vercel 云函数。接口契约、四个工具及验证边界见 [本地智能体接入](docs/banshu-native.md)。

```powershell
Copy-Item .dev.vars.example .dev.vars
# 编辑 .dev.vars，填写 API_KEY，然后重启 pnpm start
```

`API_BASE`、`MODEL` 和 `API_KEY` 只在服务端环境配置；仍兼容此前的 `AI_BASE_URL`、`AI_MODEL` 和 `AI_API_KEY`。不要提交 `.dev.vars`、API Key 或真实班级数据。没有 Key 时，示例班级标明有限规则体验；真实班级的常规通知与待办仍能使用，真实 AI 会显示未配置。

## Cloudflare 本地运行和部署

在支持 workerd 的机器上：

```powershell
pnpm db:migrate
pnpm worker:dev
```

部署前创建 D1 数据库，把返回的真实 database_id 写入 `wrangler.jsonc`，运行远程迁移并配置 Worker Secret：

```powershell
pnpm exec wrangler d1 create class-ai
pnpm exec wrangler d1 migrations apply class-ai --remote
pnpm exec wrangler secret put API_KEY
pnpm build
pnpm exec wrangler deploy
```

不要用仓库内占位 database_id 部署，不自动升级付费套餐。上线后必须测试校园网和手机网络能否打开。

## 从 GitHub 自动部署到 Cloudflare

这个仓库已经配置了 Cloudflare Worker、静态资源和 D1。推荐把 GitHub 仓库连接到**当前已经创建的 `class-ai-assistant` Worker**，让 Cloudflare 从仓库构建并发布：

1. 将本项目源码推送到自己的 GitHub 仓库。不要上传 `.dev.vars`、`.env`、`.local`、`.wrangler`、`node_modules` 或 `dist`；`.gitignore` 已排除这些本机文件。
2. 在 Cloudflare Dashboard 打开 Workers & Pages，选择现有 `class-ai-assistant` Worker 的设置，连接 GitHub 仓库。选择要发布的分支。
3. 构建设置使用项目根目录，构建命令 `pnpm install --frozen-lockfile && pnpm build`，部署命令 `pnpm deploy`。如果界面只提供一个部署命令，使用 `pnpm install --frozen-lockfile && pnpm build && pnpm deploy`。
4. 确认 Worker 的 D1 绑定名是 `DB`，并指向 `class-ai`（当前 `wrangler.jsonc` 中的数据库 ID 对应已部署环境）。若改用另一个 Cloudflare 账号或数据库，先创建 D1 并更新 `database_id`，再应用迁移：`pnpm exec wrangler d1 migrations apply class-ai --remote`。
5. 在 Worker 设置的 Secrets 中添加 `API_KEY`，值为 DeepSeek API Key。不要把它放在 GitHub 源码、前端变量或普通明文配置中。`API_BASE` 与 `MODEL` 已在 `wrangler.jsonc` 中设置。
6. 先手动触发一次部署，确认构建成功后检查 `/api/health`、网页首页和登录后的 AI 对话。之后推送到所选分支会自动部署。

如果 Cloudflare 当前账号尚未授权 GitHub，先在 Cloudflare 页面完成授权。公开 GitHub 仓库不会公开 D1 中的数据或 Worker Secret；但源码中配置的 D1 数据库 ID 和 Worker 名称是部署标识，不是密钥。

## 检查

```powershell
pnpm typecheck
pnpm check:server
pnpm build
pnpm test
```

测试使用 Node 内置 SQLite 的内存数据库，覆盖真实 SQL 迁移和请求处理。SQLite 在当前 Node 版本可能输出实验性功能提示。

## 文档

- [实现说明](docs/implementation.md)：架构、接口、权限、数据边界和验证状态。
- [参赛交付说明](docs/contest.md)：演示脚本、AI 使用声明、第三方资源和提交前清单。
- [匿名通知测试集](docs/notification-cases.json)：20 条人工评审样例，包含时间歧义、指定成员、重复通知和提示注入。
- [测试说明](docs/testing.md)：自动测试覆盖及必须人工验证的部分。

## 当前验证边界

自动测试覆盖身份、权限、确认幂等、跨班级隔离、撤回和日历。真实模型回答质量、Cloudflare 部署、校园网访问、真实手机日历导入和成员试用需要相应条件具备后实测；不以猜测值替代记录。
