/**
 * The (short) system-prompt guide.
 *
 * @module dsh-automations/prompt
 */

/**
 * @returns {string} the section text.
 */
export function guideText() {
	return [
		"## 自动化任务（dsh-automations）",
		"- 侧栏「生命周期自动化」面板管理规则；工具 automation_list / automation_save / automation_run / automation_remove / automation_runs 可读写同一批规则。",
		"- 触发时机：startup（DSH 启动）、session-start、session-idle、session-end、user-message、tool-after、daily、interval、manual；动作：shell、http、log。",
		"- 用户说「每次启动时…」「每天…」「会话结束后…」且动作可脚本化时，建一条规则，而不是每次手动执行。",
		"- shell 动作以非交互子进程运行并有超时；不要排定需要人工交互的命令。频繁事件上的规则要设 cooldownSeconds。",
	].join("\n");
}
