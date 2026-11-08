# 验证记录

> 只记录实测过的证据；没测过的不写。

## 发布坐标

| 项 | 值 |
|---|---|
| npm | `dsh-automations@0.2.0`（2026-11-06，`latest`） |
| npm shasum | `c6aaf18a6f2df6a0994cdd832c1b82b7ff22178c` |
| npm integrity | `sha512-rP8giQiB80wYMJSDPbeztmRAvvjP6ByUsr4aOL3YaCM0KSXQFqjBMHkmPkioXKdtfJ8VEl2zWxFJUaxQ/rZZ0w==` |
| GitHub | `439436269-ctrl/dsh-automations`，tag `v0.1.0` / `v0.2.0` |
| CI | `ci #1`（2d79c71）、`ci #2`（ddfd5a5）均 success，Node 22/24 矩阵 |
| 市场 | `awesome-dsh-plugin` PR #12792（已合并；`check` 与 `Submission gate` 均 success） |

## 离线自检

```powershell
cd dsh-automations
node test/selftest.mjs
# PASS: 14/14 checks
```

覆盖：规则归一化与拒绝、存储往返与损坏文件自愈、冷却、命令超时、默认工作目录、HTTP、触发器接线（startup / session-start / user-message 去重）。

## 界面（隔离 profile + Playwright）

- 侧栏入口「生命周期自动化」可点开，`main` 面板渲染。
- 规则 / 运行两个 tab：规则页 3 张卡、0 条运行；运行页 3 条运行、0 张卡；展开显示触发与退出码。
- 编辑器：选 shell 时工作目录预填 `C:\Users\Lenovo`；换 action 为 http 时字段整组切换。
- 运行按钮产生新运行记录并弹 toast；无 console error。

## 生命周期（真实会话）

新建会话发一条消息后：

- `session-start` 1 次；
- `user-message` 1 次（同一 turn 的多条 `user/message` 事件已去重）；
- `tool-after` 每次工具调用 1 次；
- `session-idle` 在最后事件后 30 秒触发 1 次。

## 宿主热重载与规则实测

- 对 `include:dsh-automations` 先停用再启用，Host 半重新 import；空 `cwd` 的 shell 动作输出从 `~/.dsh/profiles/desktop` 变为 `C:\Users\Lenovo`。
- 0.2.0 产物：本地 `pnpm pack` 与 registry tarball **逐字节一致**，`dist.shasum` / `dist.integrity` 重算一致。
- 本机运营规则「dsh-superagent 随 DSH 启动」实测：`exit=0`、`already running (PID …); no duplicate started`。
