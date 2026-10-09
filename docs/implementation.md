# 班级 AI 助手实现说明

## 1. 作品定位

班级 AI 助手将班级通知整理成可执行的任务。成员可以问“我今天需要做什么”，查看与原通知绑定的回答，反馈自己的完成状态；班干部可以先预览 AI 整理的通知草稿，再发布并查看汇总进度。

第一版的边界是通知、待办、可追溯问答、确认操作和完成统计。完成状态是成员自报，不代表系统核验过文件提交。微信自动抓取、成绩、缴费、自动排班和照片墙不属于当前版本。

## 2. 技术架构

- 前端：React + TypeScript + Vite + lucide-react，`src/App.tsx` 为页面和交互编排，`src/api.ts` 为同源 `/api` 客户端，`src/styles.css` 为响应式薄荷绿色视觉系统。
- 服务端：Hono Worker（`server/index.ts`），所有身份、权限、确认和数据写入在后端执行。
- 数据库：Cloudflare D1 SQLite。迁移文件位于 `migrations/0001_initial.sql`。
- AI：`server/ai.ts` 提供示例规则模式和 OpenAI 兼容工具调用适配层。API 密钥仅放在 Worker 的服务端环境变量中。
- 部署：Wrangler 静态资源 + Worker，同源请求避免前端暴露模型凭据。

数据流为：网页发送问题 → 服务端验证会话和班级 → AI 选择受限工具或读取示例规则 → 服务端执行班级范围内的查询 → 返回回答、来源卡或待确认操作。发布通知和修改完成状态都必须经确认接口，模型不能直接写库。

## 3. 本地运行

```powershell
pnpm install
pnpm build
pnpm start               # http://127.0.0.1:8787，同源网页和 API，自动迁移本地 SQLite
pnpm dev                 # 可选开发服务器，代理 API 到 8787
pnpm typecheck
pnpm build
pnpm test
```

推荐本机使用 Node.js 24.14+ 适配器，数据持久化到 `.local/class-ai.sqlite`。本机 workerd 因 Windows DLL 问题退出（3221225781），这不影响 Node 适配器。仅在支持 workerd 的机器上使用下面的 Wrangler 本地命令：

```powershell
pnpm db:migrate
pnpm worker:dev
```

复制 `.dev.vars.example` 为 `.dev.vars`，填写 `AI_API_KEY` 才会启用真实模型。没有 API Key 时，示例班级可使用有限规则演示；这不等于真实模型验收，也不会伪装成真实 AI。

## 4. 接口与权限摘要

- `POST /api/classes` 创建班级和管理员身份。
- `POST /api/join` 使用邀请码加入；`POST /api/session/recover` 使用一次展示的恢复码找回身份。
- `GET /api/tasks` 只返回当前成员可见任务；`GET /api/admin/tasks`、`GET /api/tasks/:id/progress` 仅管理员可用。
- `POST /api/drafts`、`POST /api/actions/:id/confirm` 负责通知预览和确认发布。
- `POST /api/actions` 产生任务状态确认卡；确认只影响当前成员。
- `/api/notices/:id` 的修改和撤回需要管理员及当前版本号。
- 查询按 `class_id` 限定，服务端不相信前端菜单或模型的权限判断。

## 5. 安全和数据约束

会话为 HttpOnly、SameSite Strict Cookie；恢复码只保存 SHA-256 摘要。写请求检查同源和请求大小，身份创建、加入、恢复及聊天等入口另外实施限流。通知原文只是资料，不能覆盖系统权限。确认卡有版本号和有效期，重复请求具有幂等结果，冲突时要求重新生成。演示班级和真实班级使用独立记录。

## 6. 已验证与待验证

自动验证当前包含：SQLite 迁移、44 个自动测试（25 项后端、19 项 AI 模拟服务测试）、TypeScript 检查、Vite 生产构建。真实模型需要配置可用凭据后再验证工具调用和回答内容。移动网络访问、手机日历客户端差异、课堂成员试用和线上部署尚未在本说明中虚构为已完成。

## 7. 实地试用记录（待填写）

| 日期 | 参与者数量和角色 | 使用通知数量 | 查找/整理/反馈观察 | 发现的问题 | 修改决定 |
|---|---:|---:|---|---|---|
| 待填写 | 待填写 | 待填写 | 待填写 | 待填写 | 待填写 |

填表时使用脱敏通知，不记录真实手机号、学号、恢复码或模型密钥。
