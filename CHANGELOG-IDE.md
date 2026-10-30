# TermFlow Agent IDE - Changelog

## 1.30.2 - 2026-10-30

- Everything in TermFlow Lite 1.30.2: folders with a percent sign in the name are tracked again in Git Bash and zsh, screen sharing holds back instead of filling memory on a slow connection, the phone keyboard no longer forces full screen in portrait, and OpenCode is found when installed without npm.
- Following a subagent transcript reads it in bounded steps, so a long Claude Code session no longer pulls the whole file into memory at once.

## 1.30.1 - 2026-10-30

- Everything in TermFlow Lite 1.30.1: "Open in VS Code" works on folders (project, worktree and file panel menus), and the Windows Explorer menu starts the agent you picked instead of a PowerShell tab.
- Delegation: Antigravity, Gemini CLI, Qwen Code, GitHub Copilot CLI, Kimi and Droid keep the model and the on/off switch you set in Settings > Orchestration, and their Test and model list buttons work. Their settings were being discarded and the buttons answered "Unknown target".

## 1.30.0 - 2026-10-29

- Everything in TermFlow Lite 1.30.0: hands-free voice input (Ctrl+Shift+Space, stops when you pause), say "send" to submit in agent tabs, a terms list for dictation, and broadcast frames on the split panes that receive your typing, with the SSH host shown in the corner of remote panes.

## 1.29.1 - 2026-10-29

- Tasks says what to do when the open terminal is not in a repository, instead of showing the raw git error. Automations opens the editor on the automation you picked, whether you pressed Edit or started from a template.

## 1.29.0 - 2026-10-29

- Everything in TermFlow Lite 1.29.0: the agent character animation and its settings were removed.

## 1.28.0 - 2026-10-28

- Everything in TermFlow Lite 1.28.0: the phone's new Screen tab shows and controls the whole computer through a VNC server running on it, sign-in screen and UAC included.

## 1.27.1 - 2026-10-24

- Everything in TermFlow Lite 1.27.1: phone reconnect heartbeat, easier phone settings, permission level menu on the status bar shield.
- Sidebar: projects start collapsed, and the project "..." menu always stays inside the window (it moves up when it would run off the bottom).
- Redesigned keep-awake pill and tab work badge; Reveal icon and bottom bar alignment fixed.

## 1.27.0 - 2026-10-18

- Everything in TermFlow Lite 1.27.0: watch Claude Code background tasks and subagents live, each in its own tab (tab count badge, or the tab's right-click menu).
- The project and worktree menus in the sidebar list your agent profiles (Claude Code, Codex...) under New Terminal Here; each opens in that folder.

## 1.26.0 - 2026-10-17

- Everything in TermFlow Lite 1.26.0: launch at startup, background updates for npm-installed agent CLIs, the Antigravity profile, several Claude accounts, New project, administrator tabs from the phone.
- More orchestration workers: Antigravity, Gemini CLI, Qwen Code, GitHub Copilot CLI, Kimi and Droid can take delegated tasks when installed, next to OpenCode, Codex, Grok and Claude Code.
- Orchestration: a coding agent can hand work to another agent or model and check the result, to save its own usage limits. Turn it on in Settings > Orchestration and connect Claude Code, Codex or OpenCode; they get the termflow-agents MCP tools (list_agents, delegate_task, get_task_result, list_tasks, cancel_task, discard_task).
- Workers: OpenCode (free models such as opencode/deepseek-v4.1-flash-free and opencode/glm-5.3-flash-free), Codex, Grok, Claude Code and any Claude Code provider profile (DeepSeek, OpenRouter...). Each task runs headless in its own git worktree on a `deleg/` branch from the last commit; the result is a commit the coordinating agent reviews and applies with `git cherry-pick`.
- Optional check command per task (for example a test file); a task with no changes or a failing check is reported as failed, with the agent's output.
- list_agents shows which workers are free, your Claude and Codex usage, and suggests free workers when Claude's 5-hour usage passes a threshold you choose.
- Settings > Orchestration: model list from each CLI (cached a day, Refresh), a Test button that runs a tiny real task, tasks at the same time and a time limit (the whole process tree is stopped).
- Right panel: Delegated tasks with status, time, cost, changed files, check output, Open in a terminal, Copy apply command, Stop and Discard.

## 1.25.0 - 2026-10-15

First release. TermFlow Agent IDE is the TermFlow terminal with a workspace around your coding agents (Claude Code, Codex, OpenCode and the other agent CLIs TermFlow finds). It installs next to TermFlow Lite and keeps its own settings. Ctrl+Shift+I switches between the IDE layout and the plain terminal layout without restarting anything.

- Projects sidebar: every project with its git worktrees and the agent sessions running in each, live state (working, needs input, done), pin, sleep, notes, status and parent worktrees. Group by project, status or pull request, or open the Workspace board.
- Create worktree from a branch name, `#123`, or a pull request or issue link, pick the agent, and optionally a sparse checkout.
- Right panel: Explorer with file content search, Agents (past sessions by project), Source Control (stage, commit, push or publish, create a pull request) and Checks for the branch's pull request.
- Review changes: a diff of the worktree (unified or side by side) against HEAD or any branch, comments on lines, and Send to agent pastes all comments into the agent's prompt as one message without pressing Enter.
- Worktree notes in Markdown, stored with TermFlow, never in the project.
- Pages: Tasks (GitHub issues and pull requests, start a worktree from a row), Automations, Artifacts, Mobile (phone remote access), full page Settings with Stats & Usage.
- Floating workspace with a note and its own terminal, dockable back to the tabs.
- Status bar: keep the computer awake while agents work, a resource manager for terminals, and open ports.
- Search palette (Ctrl+Shift+J): tabs, worktrees, sessions, settings and actions, Tab filters by source.
