# 班枢智能体本地接入

本站后端直接调用 DeepSeek，不再请求 Vercel 云函数。模型密钥只放在服务端 `.dev.vars` 的 `API_KEY`（兼容旧名 `AI_API_KEY`），默认 `API_BASE=https://api.deepseek.com`、`MODEL=deepseek-chat`。Cloudflare 部署时通过 Worker Secret 配置 `API_KEY`，不要把密钥写进前端或 Git。

经身份验证后，`POST /api/chat` 支持原班枢契约：请求 `{ "message": "明天谁值日？", "history": [], "data": { "timetable": [], "duty": [{ "day": "周五", "member": "张三" }], "members": [], "notices": [] } }`，成功返回 `{ "reply": "..." }`。四个工具为 `get_timetable`、`get_duty`、`generate_duty_plan` 和 `get_notices`。一次模型返回多个工具调用时会逐个执行。工具只读取请求数据，排班只生成文字建议；不修改网页数据库。

网页仍使用同域 `/api/chat` 的原有流式交互。服务端从当前登录身份读取本人待办和已发布通知，调用同一个本地班枢模型循环，返回回答和可验证的原通知卡。网页不会自动保存模型回复里的操作建议；发布通知和完成反馈仍经用户点击确认。

本机已配置服务端模型密钥，并已通过本地真实请求验证 POST /api/chat 返回 reply。自动测试仍使用模拟响应以保证稳定，不消耗模型额度；部署前仍需在目标环境配置同名 Secret，并记录线上网络验证结果。
