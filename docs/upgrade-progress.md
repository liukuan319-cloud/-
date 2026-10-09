# 官方版升级进度

## 阶段 1：成员批量导入（2026-10-09）
- 新增 0002：学号（班级内非空唯一）与备注，兼容现有成员。
- 管理员粘贴/UTF-8 CSV上传，支持中英文表头、制表符、CSV引号/换行、空白及角色校验；先学号后姓名去重，逐行返回原因，最多500人。
- 设置页显示成员名单与导入统计。批量插入采用 D1 原子 batch。
- RED：新增2个导入测试因接口404失败；GREEN：pnpm build 成功，pnpm test 51/51通过；pnpm check:server通过。
- AI测试夹具应用0002并使用显式列插入；没有修改AI实现。

## 阶段 2：名单登录与邀请码（2026-10-09）
- 0003新增 allow_self_join，默认关闭；管理员设置页可切换并轮换邀请码。
- 姓名或学号配合邀请码登录已有成员；名单外默认403，姓名/学号冲突409；开启自行加入也只能产生成员角色。
- 删除恢复入口/弹窗/设置说明及响应凭证；恢复API返回404。legacy recovery_hash仅随机占位，从未用于认证。
- RED：身份复用、恢复移除、名单策略测试失败；GREEN：pnpm build成功、pnpm test53/53通过、pnpm check:server通过。
- Race test: two simultaneous overlapping imports both return 200, import each unique row once, and report one skipped conflict.
- Populated local Wrangler D1 migration check: 0001-0004 applied; PRAGMA foreign_key_check returned no rows; legacy member ID, nickname, student number, note, notice author ID, and session reference survived.
- Stage 3 checks: pnpm build passed; pnpm test 58/58 passed; pnpm check:server passed.

## 阶段 4：课程表、值日与班枢上下文（2026-10-09）
- 新增 0005：按班级保存星期课表和值日成员 ID；管理员可替换、查询及逐行导入 CSV，普通成员只读；响应只公开昵称，不含学号。
- 设置页增加重复课表和值日编辑及 CSV 导入；保存前可检查结果并显示错误行。
- 班枢接口保留 `{message,history,data}` 与 `{reply}` 兼容契约，但班级数据始终由已认证身份从数据库装载；客户端 `data` 不作为班级事实。主 SSE 与 JSON 兼容入口共用该上下文。
- AI工具可查询班级名、班干部/成员姓名（不含学号）、课表、值日、近七天通知关键词、本人任务（含逾期/截止时间）；班干部另可查任务完成汇总。值日无安排时由服务端结果兜底，不让模型编造。AI工具只读或生成建议。
- 验证：SQLite测试夹具从 0001 连续应用至 0005；`pnpm test` 62/62通过，含 SSE 数据隔离和学生学号不进入任何模型请求的测试；`pnpm build`通过，`pnpm check:server`通过。
