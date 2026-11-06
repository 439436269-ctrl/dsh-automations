# dsh-automations

[![npm](https://img.shields.io/npm/v/dsh-automations.svg)](https://www.npmjs.com/package/dsh-automations)
[![ci](https://github.com/439436269-ctrl/dsh-automations/actions/workflows/ci.yml/badge.svg)](https://github.com/439436269-ctrl/dsh-automations/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/dsh-automations.svg)](LICENSE)

> DSH 自带的「自动化任务」按**时间**触发（每天 / 每周 / cron / 间隔）。
> 这个插件补上另一半：因为**发生了什么**而触发 —— DSH 启动、会话开始 / 空闲 / 结束、
> 收到用户消息、某个工具执行完 —— 再加上每天 / 固定间隔，动作可以是本机命令、
> HTTP 请求或一条运行记录。

左侧栏新增 **生命周期自动化**（英文界面为 **Automations**）入口，打开就是规则管理页：
建规则、启停、立即运行、看最近运行输出。同一批规则也能由模型用工具读写。

---

## 1. 触发时机（triggers）

| 类型 | 什么时候触发 | 参数 |
|---|---|---|
| `startup` | 宿主进程启动后一次（热重载不会重复） | `delayMs` 额外延迟 |
| `session-start` | 会话建立 / 恢复 / 清空 / 压缩后 | `source`：`any`/`startup`/`resume`/`clear`/`compact` |
| `session-idle` | 会话超过 N 秒没有任何新事件 | `idleSeconds`（≥30） |
| `session-end` | 会话被释放，或 DSH 退出 | — |
| `user-message` | 用户发来消息 | `mode`：`any` / `first-of-session` / `first-of-day`；`match` 子串过滤 |
| `tool-after` | 任意工具执行完成 | `tool` 工具名（`*` 全部）；`when`：`always`/`success`/`error` |
| `daily` | 本地时间每天 HH:MM | `time`、`weekdays`（1=周一…7=周日，空=每天） |
| `interval` | 每隔 N 分钟 | `minutes`（1–1440） |
| `manual` | 只在面板/工具里点「运行」 | — |

**语义细节（实测过的）：**

- 一次用户消息会产生多条 `user/message` 事件（消息本体 + 上下文）。插件按
  **turn** 去重，一条消息只触发一次。
- `daily` 错过窗口后会在启动后**补跑一次**（窗口 4 小时），不会再补更早的。
- `interval` 的计时从规则首次被看到时开始，持久化在 `meta.json`，重启后继续。
- `session-end` 在 DSH 正常退出时也会触发；此时动作可能来不及写盘，长命令不要挂在这里。
- `startup` 的「一次」是按**进程**算的：插件被 HMR 重载不会重复执行。

## 2. 动作（actions）

| 类型 | 做什么 | 说明 |
|---|---|---|
| `shell` | 起一个**非交互**子进程 | `command`、`cwd`、`shell`（`auto`/`powershell`/`cmd`/`bash`）、`timeoutMs`。捕获 stdout+stderr 尾部与退出码；超时会杀掉整个进程树。**`cwd` 留空 = `defaultCwd`（默认用户主目录）** |
| `http` | 发一个 HTTP 请求 | `url`、`method`、`headers`（JSON 对象字符串）、`body`、`timeoutMs`。适合 webhook、飞书机器人、本地探活 |
| `log` | 只写一条运行记录 | 无副作用，用来验证「时机到底有没有命中」 |

shell 动作会拿到这些环境变量，脚本里可以直接用：

```text
DSH_AUTOMATION_RULE_ID     规则 id
DSH_AUTOMATION_RULE_NAME   规则名
DSH_AUTOMATION_TRIGGER     触发类型
DSH_AUTOMATION_SESSION_ID  触发时的会话（可能为空）
DSH_AUTOMATION_TOOL        触发时的工具名（tool-after）
DSH_AUTOMATION_CONTEXT     一行 JSON（kind/sessionId/tool/source/at）
```

> ⚠️ `shell` 会以**当前用户权限**执行任意命令。规则文件在 `$DSH_HOME/storages/dsh-automations/`，
> 面板 API 走宿主已鉴权的 `/api` 通道（会话 cookie + Host/Origin 校验），但能改规则的人
> 本来就能在这台机器上执行命令 —— 请像对待 `~/.bashrc` 一样对待它。

## 3. 面板

- 左栏图标 → 主区页面：统计条 + **「规则 / 运行」两个 tab**。
- **规则** tab：规则卡片（启停 / 运行 / 编辑 / 删除）；空面板时给三个模板（启动写日志、每天 08:30 探活、会话空闲记录）。
- **运行** tab：完整运行历史（时间 / 规则 / 触发类型 / 状态 / 耗时），点一行展开输出，展开头部带触发与退出码。
- tab 选择记在 `localStorage`，刷新后停在上次那个 tab。
- 「新建规则」用同一份 **catalog** 动态生成表单：选触发时机后只出现相关字段，换动作同理；shell 规则的**工作目录会预填默认路径**（见下节）。
- 「试运行」不保存也能执行一次，便于调命令。

界面文案跟随 DSH 的语言（中文 / English）。

## 4. 给模型的工具

| 工具 | 用途 |
|---|---|
| `automation_list` | 列出规则（含触发/动作摘要、上次状态） |
| `automation_save` | 新建或按 id 更新规则；`triggerType` + `trigger` 字段包、`actionType` + `action` 字段包 |
| `automation_run` | 立即执行并返回输出/退出码 |
| `automation_remove` | 删除规则 |
| `automation_runs` | 查看最近运行，可只查一条规则 |

系统提示里加了一段短说明，因此用户说「每次 DSH 启动时帮我把 X 起起来」「每天 8:30 提醒我」
时，模型会建规则而不是每次手动执行。

## 5. 存储

```text
$DSH_HOME/storages/dsh-automations/
  rules.json   规则（原子写，损坏时另存 .broken-<ts> 并从空开始）
  runs.json    最近运行（上限 maxRunHistory）
  meta.json    调度记忆：今天哪些 daily 已跑、interval 上次时间、最近用户消息日
```

`stateDir` 配置项可以整体改到别处。

## 6. 配置（cordis.patch.yml）

```yaml
- id: dsh-automations
  name: dsh-automations
  config:
    enabled: true
    stateDir: ""              # 空 = $DSH_HOME/storages/dsh-automations
    maxRunHistory: 200
    maxOutputChars: 8000
    defaultTimeoutMs: 120000
    defaultCwd: ""            # shell 规则的默认工作目录；空 = 用户主目录
    startupDelayMs: 2000
    tickSeconds: 15
    promptEnabled: true
    promptOrder: 62
```

`patch` 对 `config` 是整块替换：想改一个键，就把要保留的键一起写上。

## 7. 安装

```powershell
# 从 npm 安装（推荐）
node "<dsh>/lib/bin.js" plugin --profile <profile> add dsh-automations
```

然后把 `dsh-automations` 加进该 profile `package.json` 的 `dsh.profile.bundles`，
重启宿主（或让插件管理器热加载）。

开发时可以直接链到源码目录，改完重启宿主即生效：

```powershell
node "<dsh>/lib/bin.js" plugin --profile <profile> add "link:D:\path\to\dsh-automations"
```

> `<dsh>` 指 `@deepseek-ai/dsh` 的安装目录（其 `lib/bin.js`）。桌面版则由插件页「安装」完成，
> 等价于上面的 pnpm 命令。

## 8. 兼容性

- DSH `0.2.0-rc.2` / `0.2.1-rc.3` 实测；宿主靠 `peerDependencies` 做真正的兼容门。
- Node `>=22`（用到全局 `fetch`、`AbortController`）。
- 面板通过客户端的 `slots` + `locale` 服务注册；没有这两个服务的极简组合只加载宿主半（工具与触发器仍可用）。
- `@deepseek-ai/schemastery` 是可选依赖：拿不到时插件照常加载，配置回落到代码内默认值。

## 9. 验证

```powershell
cd dsh-automations
node test/selftest.mjs     # 模型归一化 / 存储 / 引擎 / 触发器接线，12 项
```

真机验证（本仓库作者的流程）：临时 profile + `--no-open --port 0` 起 Web，用输出的
`?token=` 换 cookie 调 `/api/dsh-automations/state`，再用 Playwright 点侧栏入口、
跑规则、开编辑器；生命周期触发则新建一个会话发一条消息，检查
`session-start` / `user-message` / `tool-after` / `session-idle` 的运行记录。

## 10. 已知边界

- 没有「给 agent 发 prompt」的动作：本插件只做确定性动作（命令/HTTP/日志）。
  需要 agent 参与的定时任务，继续用自带的 `schedule` 工具/面板。
- 同一时刻的命令串行执行（队列上限 200），避免两条规则同时动同一个文件/端口。
- 规则由面板或工具修改；直接手改 `rules.json` 需要重启宿主才会读到。
- `session-end` 在进程退出路径上，动作可能来不及完成。

## 11. 反馈

- 仓库：<https://github.com/439436269-ctrl/dsh-automations>
- 问题与建议：<https://github.com/439436269-ctrl/dsh-automations/issues>
- npm：<https://www.npmjs.com/package/dsh-automations>

MIT License。
