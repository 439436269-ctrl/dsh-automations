# Changelog

## 0.2.0 — 2026-11-06

- 面板拆成「规则 / 运行」两个 tab：规则页只放规则卡片与模板，运行页展示完整运行历史（含触发类型、退出码、可展开输出），tab 选择记在 `localStorage`。
- shell 动作的工作目录有了默认值：规则里留空时使用 `defaultCwd` 配置，未配置则用**用户主目录**（不再落到宿主进程目录）。新建规则时表单会**预填**这个默认路径。
- 新增配置项 `defaultCwd`。
- 自检增至 14 项（默认工作目录、面板视图的 `defaultCwd`）。

## 0.1.0 — 2026-11-06

首个版本。

- 9 种触发时机：`startup`、`session-start`、`session-idle`、`session-end`、`user-message`、`tool-after`、`daily`、`interval`、`manual`。
- 3 种动作：本地 `shell` 命令（超时 + 进程树终止 + 有界输出）、`http` 请求、`log` 记录。
- 左侧栏「生命周期自动化」页面：规则卡片、启停、立即运行、编辑器（按 catalog 动态生成字段）、试运行、最近运行输出。
- 5 个模型工具：`automation_list` / `automation_save` / `automation_run` / `automation_remove` / `automation_runs`。
- 规则持久化到 `$DSH_HOME/storages/dsh-automations/`，含调度记忆（daily 当天去重、interval 计时）。
- 同一 turn 的多条 `user/message` 事件按 turn 去重，一条用户消息只触发一次。
- 中性命令串行执行队列（上限 200），触发侧 cooldown。
- 12 项离线自检（`node test/selftest.mjs`）。

