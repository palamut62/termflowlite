# Changelog

## 1.31.0 - 2026-10-30

- Every agent in the catalogue is treated as an agent, not only Claude Code, Codex and OpenCode. In Antigravity, Gemini CLI, Qwen Code, GitHub Copilot CLI, Grok, Droid, Kimi, Pi, Codebuff, Cursor Agent, Amp, Aider and Crush tabs:
  - Voice input writes what you say as a request in words instead of shaping it into a shell command, and ending with "gönder", "send" or "enter" presses Enter.
  - Shift+Enter adds a new line in the agent's input box.
  - The tab counts as an agent on your phone and in the iOS widget and Live Activity.
  - What the agent is doing shows up in the Agent Inbox and on the widget, including when it is waiting for you.
- Hooks, permission modes (Safe/Workspace/Full) and usage meters are unchanged: those still need Claude Code or Codex, so in the other agents the state is read from the output and is a guess.

## 1.30.2 - 2026-10-30

- Git Bash and zsh keep tracking the folder you are in when its name contains a percent sign. Command blocks and the folder in the status bar used to freeze in those folders.
- Screen sharing on a slow connection pauses the picture instead of letting it pile up in memory, so a long session no longer grows without end.
- On the phone: the keyboard no longer throws the screen view into full screen while the phone is upright, and an unclosed quote in a profile's Arguments says so instead of quietly not saving.
- Agent Sessions and Memory find OpenCode when it was installed without npm (Scoop, WinGet or Go).
- Administrator tabs: the folder holding the PIN gets its restricted permissions even when it was created by an earlier version.
- Smaller fixes: a media file that shrank to nothing no longer fails to preview, and the Linux .deb update message is in English.

## 1.30.1 - 2026-10-30

- "Open in VS Code" works on folders again: the project and worktree menus in the sidebar and the folder menu in the file panel opened nothing before. Without a VS Code family editor the folder opens in Explorer.
- Windows Explorer menu: starting a folder with Gemini CLI, Antigravity, Grok, Qwen Code, GitHub Copilot CLI, Droid, Kimi, Pi, Codebuff, Cursor Agent, Amp, Aider or Crush opens that agent. It used to ignore the choice and open a PowerShell tab.

## 1.30.0 - 2026-10-29

- Hands-free voice input: press Ctrl+Shift+Space once and just talk, no key to hold. It stops by itself when you pause (1 to 4 seconds, or only with Space) and types the text. Hold-to-talk with Space works as before.
- Say "send" to submit: in Claude Code, Codex and OpenCode, end what you say with "gönder", "send" or "enter" and Enter is pressed after the text. Off by default and never at a shell prompt.
- Terms: list the names and words you use (Settings > Voice) and dictation spells them exactly like that.
- Broadcast: every split pane that receives your typing gets a red frame, and the badge shows how many panes get it, or "this tab only" when the open tab is not in the split. Split panes connected over SSH show their host in the corner.

## 1.29.1 - 2026-10-29

- Agent IDE: Tasks says what to do when the open terminal is not in a repository, instead of showing the raw git error. Automations now opens the editor on the automation you picked, whether you pressed Edit or started from a template.

## 1.29.0 - 2026-10-29

- The agent character animation (Ember, Miso and Piko) is gone. The pane beside agent terminals, its Appearance settings (animation, style, character, weather) and the live weather lookup were all removed, so nothing in TermFlow reaches out to a weather service any more.

## 1.28.0 - 2026-10-28

- Screen sharing: the phone shows your whole computer and controls it, the Windows sign-in screen and UAC prompts included. Touch moves the mouse, the phone keyboard types, and the bar has Ctrl+Alt+Del, watch only and full screen. Turn the phone sideways to fill its screen.
- It needs a VNC server running as a service on the computer (UltraVNC or TightVNC). TermFlow reaches it on this computer only and passes it to a paired phone over Tailscale, so the VNC server never has to accept connections from the network. Turn it on in Settings > Remote Access > Screen; the VNC password is asked on the phone and is never stored.

## 1.27.1 - 2026-10-24

- Phone: a dropped connection is detected by a heartbeat and reconnects by itself; the settings sheets are easier to use on a phone, and the tab strip shows only the selected workspace's terminals.
- Permission level menu on the status bar shield; tab scrollbar hidden; file paths with spaces are clickable; the Claude CLI update time is shown.

## 1.27.0 - 2026-10-18

- Background tasks: a Claude Code tab shows a small count when its background shell tasks or subagents have written output in the last 10 minutes. Click it to watch each one live in its own tab. In the Agent IDE the tab's right-click menu lists them too.
- Subagents (the Task/Agent tool) are watched as readable lines: the prompt, what the agent said, each tool call with a short input, and each result.

## 1.26.0 - 2026-10-17

- Launch at startup: Settings > Terminal (and the phone's settings) can start TermFlow when you sign in to Windows.
- Agent CLIs installed with npm (Claude Code, Codex, OpenCode, Gemini CLI, Qwen Code, Copilot CLI, Pi, Codebuff) update themselves in the background at start and once a day. Settings > Profiles shows each version and its state, and has Check for CLI updates now. Turn it off with Auto-update agent CLIs.
- Antigravity (`agy`) is a built-in agent profile and appears in the New Tab menu when installed.
- Several Claude accounts: Settings > Profiles > Add Claude account. Signed-in accounts are found by themselves, a tab can continue its session with another account, and an optional switch moves to the next account when a limit is hit.
- New project in the New Tab menu: pick a parent folder and a name, TermFlow creates the folder and opens the agent or shell in it.
- Administrator tabs from the phone: after one UAC approval on the PC, the phone can open an administrator terminal with a PIN.
- Limits read like Claude Code: percent used, the 5-hour limit before the weekly one.
- The phone interface has a Home screen, a workspace list and a terminal header with a neutral dark theme. The widget view takes its colours and window buttons from your theme, with the tab that needs you on top.
- Settings: Profiles and Profile Health moved next to Providers.

## 1.25.0 - 2026-10-15

- New worktree: one box takes a branch name, `#123` for a pull request, or a pull request or issue link. Advanced has a note, a parent worktree and sparse checkout (only the folders you list are checked out).
- Settings > Stats & Usage shows your agent sessions, commands run and command time, and Settings > Notifications has Send test notification.
- Settings now groups its sections and finds a setting from its keywords.
- Fixed: a collapsed group in the session rail opened again by itself a moment after you collapsed it.
- New sister app: TermFlow Agent IDE, a separate download with a project and worktree sidebar, source control, diff review and agent pages. TermFlow Lite stays a terminal.

## 1.24.2 - 2026-10-14

- The limit strip under the terminal now replaces the limit button in the status bar instead of repeating it. With the strip off, or before any data arrives, the button stays.

## 1.24.1 - 2026-10-14

- Memory update frequency: Settings > Memory > Update lets you pick every hour, day or week (it was fixed at 30 minutes). Only sessions that are new or changed since the last check are analysed; with none, nothing is sent to the model, and the last real run's usage stays visible.
- Limits are on by default and show what is left, like Codex: a one-line strip under the terminal with the 5-hour and weekly limit side by side, in your terminal colours (amber at 80% used, red at 95%). Turn it off with Limit strip in Settings > Agent Security.
- Fixed: Claude Code limits never reached TermFlow on Windows. The Claude limit helper no longer starts curl in the background.
- Fixed: the limits popover showed Codex while a Claude tab was active; the active agent now comes first.

## 1.24.0 - 2026-10-14

- Installed agent CLIs are found for you: Claude Code, Codex, OpenCode, Gemini CLI, Qwen Code, Copilot CLI, Grok, Droid, Kimi, Pi, Codebuff, Cursor Agent, Amp, Aider and Crush appear in the New Tab menu (and in the Explorer and phone menus) only when installed, each opening with its full-access flag. Installing or removing one updates the list on its own; Settings > Profiles has Rescan.
- Agent status comes from the agent itself: Claude Code through its hooks and Codex through its notifications, so a tab shows running, waiting for you or done without guessing from the screen.
- Notifications when an agent finishes or needs you: a dot on the tab, a bell with a count, a Windows taskbar badge, a system notification and a sound, with per-event settings in Settings > Notifications. Mark as Unread is in the terminal right-click menu.
- Ctrl+Shift+J jumps to a tab or a saved agent session: tabs waiting for you come first, 1-9 picks a row, typing searches tabs, folders, branches and sessions, Shift+Enter opens the tab beside the current pane.
- Reopen the app and every tab comes back with its last output (API keys masked), and Claude Code and Codex tabs continue their own conversation.
- Claude and Codex 5-hour and weekly limits show in the status bar. Claude's limits need the opt-in setting because they use Claude's status line.
- Worktree setup steps: files to copy (like .env) and commands to run (like npm ci) in every new worktree before the agent starts, with a failure screen that lets you start the agent anyway, open a shell or cancel.
- Terminal: Reset Terminal, OSC 52 clipboard, Shift+Enter for a new line in agents, link menu, importing Windows Terminal, iTerm2 and Ghostty themes, minimum contrast.
- Fixed: the tail of an API key typed into the terminal was left visible; the new worktree dialog could run off the window.

## 1.23.0 - 2026-10-09

- Voice input (Settings > Voice Input, off until you turn it on): hold Space in a terminal and speak, release it and the text is typed where the cursor is. A short press still types a space, and fast typing never starts a recording. Esc while recording cancels.
- The recording is turned into text by an OpenRouter model of your choice with your own key (the one Memory uses): punctuation and spelling fixed, filler words removed, commands, tool names and file names written the way you type them, in Turkish or English. The text is not sent with Enter, so you can check it first.
- It knows where you type: at a shell prompt it writes commands, in Claude Code, Codex or OpenCode it writes requests.
- Only models that accept audio are listed, with their audio price and the cost of ten seconds of speech. Test sends a short sound with your key and shows whether it works, how long it took and what it cost.

## 1.22.0 - 2026-10-09

- Scan the pairing QR from inside the phone app: the sign-in screen has a Scan QR code button that opens the camera and reads the code from the photo. It also works in the app you added to the iPhone home screen, which cannot take over a pairing from Safari or Edge.
- Next to every QR the computer now shows a short code you can type instead (for example 7KQ2M-X9HDA).
- Reconnect a paired phone: in Settings > Remote Access each phone has a Reconnect button with its own QR. Scanning it gives that phone a new key in the same place in the list, and the old key stops working, so moving from the browser to the home-screen app does not leave a second entry behind.
- The phone no longer squeezes the desktop: by default it mirrors the desktop terminal at its own size, scaled to the phone, with a Zoom of up to 3x. Tap Fit to have a tab take the phone's size while you watch it.
- Fixed: the app added to the iPhone home screen could open to a blank page after TermFlow Lite was updated, and the TermFlow logo was missing on the phone.

## 1.21.1 - 2026-10-09

- Typing on the phone: tap the terminal and the keyboard opens; every key reaches the shell or agent as you type, including in Claude Code, Codex and OpenCode input boxes. Word suggestions, autocorrect and Backspace on an empty line now work, and the special-key bar no longer closes the keyboard.
- The phone no longer answers the terminal's own questions a second time, which could drop stray characters into an agent's input.
- A tab opened from the phone starts at the phone's size, and switching to a tab gives the phone a clean redraw instead of leftovers from the wider desktop frame.
- When a phone is connected, a green phone icon now shows at the top right of the window. Hover it to see which phone, click it to open Remote Access settings.

## 1.21.0 - 2026-10-09

- Remote Access (Settings > Remote Access, off until you turn it on): control TermFlow Lite from your phone over Tailscale. Scan a QR code once and the phone stays connected until you disconnect it on the computer.
- The phone sees every tab live, line by line, and can type into it, with keys that are hard on a phone keyboard (Esc, Tab, Shift+Tab, Ctrl, Alt, arrows, Ctrl+C) and a message box for longer prompts. While you look at a tab on the phone it fits the phone screen; the computer gets its size back when you leave.
- Open, rename, restart and close tabs; pick any shell, agent, provider or SSH connection; resume Claude Code, Codex and OpenCode sessions; start saved commands and project tasks; browse folders; see git status, worktrees and pull requests.
- Change settings, profiles, providers (including writing a new API key), SSH connections and Agent Memory from the phone. Changes show up on the computer right away, and the other way round.
- The server listens only on the computer's Tailscale address, never on the local network or the internet. Pairing codes work once and expire after five minutes; device keys are stored only as hashes, and stored API keys never leave the computer.

## 1.20.1 - 2026-10-08

- The Memory model picker now shows every OpenRouter model when you open it, not only the ones matching the current model. Search by name or id, switch to Free to see only free models, and spot free models at a glance by their green Free badge. You can still type any model id that is not in the list.

## 1.20.0 - 2026-10-08

- Settings > Memory now lists every OpenRouter model. The list comes from OpenRouter itself, is cached for a day so it opens instantly and works offline, and can be refreshed with one click. The chosen model shows its context size and price, and a warning when it cannot return the structured summaries memory needs.
- Test the chosen model before you rely on it: one tiny request with your key shows whether it works, how long it took and what it cost.
- Typing over a selection now works in Claude Code. It draws its own cursor and parks the real one a column away, so a replaced word used to lose the wrong letters; TermFlow now follows the cursor Claude Code draws.
- Select the whole input (triple-click, drag past the end, or Select All) and press Delete or Backspace to clear it, or just type to replace it. Text outside the line you are typing is left alone.

## 1.19.1 - 2026-10-08

- Paste an image: when the clipboard holds only a picture (a screenshot, or Copy image in a browser), Paste and Ctrl+V now save it as a PNG and insert its path, so you can hand it straight to Claude Code, Codex or a command. A preview card shows up as with other pasted files. Pasted images are kept for 7 days.
- After Paste from the right-click menu you can keep typing; the terminal no longer loses focus.

## 1.19.0 - 2026-10-07

- Type over a selection: double-click a word in the line you are typing (shell prompt or an agent's input box such as Claude Code or Codex) and just start typing. The word is replaced in place and the cursor stays there instead of jumping to the end of the line. Backspace or Delete removes the selected word.

## 1.18.0 - 2026-10-06

- Agent Memory (Settings > Memory, off until you enable it): TermFlow reads your own Claude Code, Codex and OpenCode sessions from the last 30 days and keeps a short memory per project: where it stands, what is unfinished, which problems are still open, what was done and which decisions were made. Your agents read it at the start of a session and continue where the last one stopped instead of rediscovering the project.
- Summaries are written by an OpenRouter model of your choice with your own key (stored encrypted). Only a short digest of each session leaves the computer: your requests, the agent's final answers, task lists, changed file names, commit messages and failed check names. File contents and command output are never sent, and API keys are masked. A typical update costs a fraction of a cent.
- It only works when something changed: every 30 minutes TermFlow checks whether any session file changed and calls the model only for those. Entries older than 30 days are deleted, so the memory never grows.
- Connect Claude Code, Codex or OpenCode with one click. TermFlow registers a small, read-only memory server through each agent's own command (OpenCode: its config file, backed up first). It runs on your computer, reads only the memory folder, and works while TermFlow is closed. Exclude any project to delete its memory and never read it again.

## 1.17.2 - 2026-10-06

- TermFlow Lite is now freeware: still free to use, but the source code is closed. Installers and automatic updates keep coming from the same GitHub Releases page. Versions up to 1.17.1 stay under the MIT License.

## 1.17.1 - 2026-10-05

- Saved Commands: when Add is greyed out, the form now says why. A missing working folder for a scheduled command, a missing shell or agent, or an empty command gets a red border and a short note under the form.
- Settings > Terminal > Confirm Before Close now explains what it does: when it is off, the X button and Ctrl+W close a tab without asking.
- New terminals (+, Ctrl+T, split, and the tab that replaces the last closed one) always open in the startup folder from Settings > Terminal. Before, a folder opened once from Explorer, a saved command or a scheduled run stuck around, survived restarts and pulled every new shell into that project.

## 1.17.0 - 2026-10-04

- ASCII backgrounds: give any profile a picture and it is drawn in characters behind the terminal text, a dotted photo behind PowerShell, a logo behind Claude Code. Settings > Appearance > ASCII Background picks the profile and the picture (PNG, JPG, WEBP, BMP or GIF), the characters (dots, ASCII or blocks), the density and the opacity, with a live preview. Shells, custom profiles, providers and SSH hosts can each have their own.
- The picture is shrunk to a small copy kept in your settings; the original file is not used again. It is drawn once and only redrawn when the pane is resized, so it costs nothing while you work. Light themes flip it automatically, and it works over Mica and Acrylic.

## 1.16.0 - 2026-10-04

- Media previews: dropping or pasting an image or video, or a new one appearing in the tab's folder (screenshots, Playwright recordings, ffmpeg output), shows a preview card in the bottom-right corner of the terminal. After a few seconds it folds into a thumbnail in the info strip. Click to view it full size or play the video, open it, show it in its folder, copy its path or insert the path into the command line. Video thumbnails come from Windows itself, no ffmpeg needed. Settings > Terminal > Media Previews turns it off or limits it to drop and paste.

## 1.15.0 - 2026-10-03

- A file panel on the right (Files in the status bar, or Ctrl+Shift+E) lists the active tab's folder and follows every cd. Click a folder to open it, double-click a file to open it: code and text in VS Code, Cursor or Windsurf, everything else in its default app (programs are never run, only shown in Explorer). Right-click to reveal a file in Explorer, copy its path or type it into the terminal or agent prompt.
- A filter box narrows the list, and dotfiles, .git and node_modules stay hidden until you show them. Folders are read one level at a time, so big projects stay fast.
- While the file panel is open, the agent character steps aside and comes back when it closes.

## 1.14.0 - 2026-10-03

- Weather for the agent character, and it reacts to it: it opens an umbrella in the rain (drops bounce off it and splash on the floor), wears a scarf and shivers in the snow, sweats with red cheeks in the heat, squints and leans into the wind, and smiles on a sunny day. The sky sits high up at the top of the panel, behind the character: clouds drift by, the sun turns into the moon at night, and rain, snow and wind fall and blow down the whole panel without ever covering the character.
- Settings > Appearance > Weather: Off, Changing (a new sky every few minutes, no network) or Live (your city). Live weather comes from Open-Meteo, free and without an API key: the city is looked up once, then only its coordinates rounded to two decimals are sent, every 30 minutes, from the main process. The caption shows the temperature.
- The website demo has a weather picker.

## 1.13.2 - 2026-10-03

- Hover the agent character and it reacts: it notices you with wide eyes and a little hop, follows the cursor with its eyes and a lean of the head, and squints with a big smile when you point right at its face. Grumpy and error faces look but do not smile, a sleeping one keeps sleeping, and with motion off it stays still.

## 1.13.1 - 2026-10-03

- The agent character now follows what Claude Code and Codex are really doing. It reads their own busy spinner ("✻ Sautéing…", "esc to interrupt") instead of guessing from the prompt, so it types at the keyboard while the agent works, thinks when the spinner says "thinking", cheers when a turn ends ("Cooked for 8s") and goes idle when the agent waits. Before, their constantly redrawn input box kept it stuck on Thinking.
- Claude Code 2.x tool lines ("● Reading note.txt", "Read 1 file"), which it draws with cursor moves, are recognised, so the caption names the file again.
- Text that only mentions an error (like "fixed the error handling") no longer shows the error face.
- Wrapped is redrawn as terminal output: a box-drawn frame with a prompt line, thin bars for top tools, an hourly block chart, a [x] badge checklist, all in your terminal font and theme colors.

## 1.13.0 - 2026-10-03

- New agent characters from the TermFlow ASCII motion kit: Ember (flame), Miso (ear-tuft spirit) and Piko (robot), each with its own desk, props and colors. Settings > Appearance > Character picks one, or Auto: Claude Code Ember, Codex Miso, OpenCode Piko.
- Real facial expressions instead of frame swaps: eyes, pupils, brows, mouth and hands are separate layers that ease toward each state, with blinking and gaze.
  - Working: types at the keyboard (fingers and lit keys match), pauses, then reads the screen.
  - Thinking, Needs you (approval or question), Done (jump and confetti), Error (flinch), Idle.
  - Time rules, never guessed from output: after 20 minutes of steady work it keeps working with a tired face (heavy lids, slower typing, the odd yawn, coffee); waiting on you for 5 minutes makes it tired; 3 idle minutes put it to sleep, and it wakes up rested; a second error within 10 minutes makes it grumpy.
- ASCII and Pixel styles now draw the same character, over a faint full-panel ASCII field (slow wave plus drifting code glyphs) that never covers the character.
- Larger ASCII glyphs (one per 5x7.5 scene pixels, area-averaged so thin lines like the mouth and brows still show), so the character clearly reads as ASCII.
- The caption names the real work ("Editing widget.ts"); screen readers hear only the state label.
- Painting is batched per row and the background is cached, so a frame costs a few milliseconds.

## 1.12.0 - 2026-10-03

- The agent animation now follows what the agent is really doing, read from the tool lines Claude Code (`⏺ Read(...)`, `⏺ Update(...)`, `⏺ Bash(...)`) and Codex (`• Ran ...`, `• Edited ...`) print:
  - editing or writing a file: the critter types at a keyboard while code appears on its monitor,
  - running a command: it watches the output scroll past on the monitor,
  - running tests: it hops nervously next to an erupting volcano,
  - reading or searching: it digs, and files pop out of the ground,
  - otherwise: it sits and thinks under a flickering light bulb.
- The speech bubble says what is going on, naming the file or command ("Editing widget.ts", "Running npm test"), with an occasional short quip once an action has been going for a while.
- The ASCII style now shows the very same scenes and speech bubble, drawn in ASCII.
- Removed the garden and brick-wall scenes, which did not reflect the agent's work.

## 1.11.0 - 2026-10-03

- A new pixel-art critter for agent animations, drawn with proper shading: a hue-shifted five-tone ramp in the agent's own color (Claude Code orange, Codex blue), a selective outline, and walk, breathing, hop, cheer and sit poses.
- The ASCII style now shows the same critter, rendered as shaded ASCII glyphs over a moving ASCII field. Its pose and eyes show what the agent is doing: walking and scanning while it works, tired after a long run, sitting and watching the terminal while it waits, hopping with wide eyes at new output, cheering when it is done, red with X eyes on an error, and asleep when the session ends.
- The critter reacts to you and the agent: it turns to the terminal and says "Listening..." while you type, and it moves faster when output pours in.
- Eyes now move toward where the critter is looking.

## 1.10.0 - 2026-10-02

- New widget view: the window turns into a compact 640 x 260 status widget in the top-right corner, with one terminal-style line per session (running, done, needs you, failed, idle), a sweeping character meter and the elapsed time. Drag it anywhere, keep it on top or not, collapse it to a single line, and click a line to jump back to that terminal. Running commands and agents keep going through the switch, and the full window comes back exactly where it was. Open it from the tab bar or the command palette.
- Agent tabs get an optional animation panel on the right, drawn in the agent's own color (Claude Code orange, Codex blue). Choose the style in Settings > Appearance > Animation Style:
  - ASCII face: one shaded ASCII character whose glowing eyes show what the agent is doing: focused, tired after a long run, waiting for you, surprised by new output, proud when done, angry on an error, asleep when the session ends.
  - Pixel scenes: a pixel-art critter acts it out: a volcano erupting while tests run, laying bricks while it edits, digging while it explores, a flag and confetti when it is done, a storm on errors.
  Turn it off in Settings or with the x on the panel.
- Fixed idle shells showing as "Running" forever when shell integration is on. The status bar and widget now switch to "Waiting for input" when the prompt is back.
- Fixed the CRT overlay drawing a second frame inside the terminal.
- The built-in Codex profile color is now blue.

## 1.9.0 - 2026-10-02

- Shell integration for PowerShell, pwsh, Git Bash, bash and zsh: every command gets a status line (running, passed, failed, cancelled) and slow or failed commands show their duration and exit code. `Ctrl+Up` / `Ctrl+Down` jumps between commands. Nothing is written to your profile or dotfiles; CMD and WSL are unchanged.
- Right-click a command to copy the command, copy only its output, rerun it, or copy it formatted for an AI agent.
- Inline suggestions from your command history while typing; `→` or `End` accepts. Off when PSReadLine already shows its own prediction.
- Compiler and test locations such as `src/app.ts:42:7` and `app.ts(42,7)` are now clickable and open the file at that line in VS Code, Cursor or Windsurf. Previously they were not linked at all.
- A command that runs longer than 10 seconds in a background tab sends a system notification; clicking it brings the tab forward. Tabs flash green or red when a command finishes.
- New Motion setting (Off / Subtle / Full) with tab, split, menu, dialog and theme crossfade animations. The system "reduce motion" preference always turns them off.
- Windows 11 Mica, Acrylic and Mica Alt backdrops with an adjustable tint. The old Blur toggle carries over as Acrylic.
- Optional cursor trail and blaze effects, a scanline or CRT overlay, a live output sparkline in the status bar, synthesized key sounds and confetti when a test or build passes.
- Wrapped: local command stats and badges you can save as a PNG. Only counters and tool names are stored, never arguments or output.
- A dismissible tip card on first launch.
- Fixed PowerShell reporting a failed cmdlet with a stale native exit code, and Git Bash directories now resolve to Windows paths.

## 1.8.0 - 2026-09-23

- The new tab menu has a filter box: start typing to narrow shells, agents, providers and SSH connections, and press Enter to open the first match. The Settings entry at the bottom of the menu is no longer cut off.
- Settings can now be searched: type a word such as "tmux", "font" or "tray" and the matching section opens.
- "New worktree session..." now lists the worktrees TermFlow created earlier for the chosen repository, so you can reopen or remove them. A checkout with uncommitted changes is never removed silently, and branches are kept.
- The GitHub panel now shows why loading failed (network, login) instead of an empty list, asks for a repository before listing pull requests, and no longer calls `gh` on every keystroke.
- Security: SSH connections reject host, user or jump host values that start with "-" and extra arguments that would run local commands (ProxyCommand, LocalCommand, ...). Git and GitHub calls validate branch start points and repository names.
- Fixed menu and settings headings rendering as "PROFİLES" / "LİCENSE" on Turkish-locale systems.
- Settings text is now consistently English, and every text field in Settings uses the same style and width.
- The Agent Inbox closes with Esc, and the worktree dialog shows a correct example path.

## 1.7.0 - 2026-09-06

- SSH connections can now keep a persistent remote session: the connection attaches to a tmux (or screen) session on the host, so agents and long builds keep running when the link drops or the window closes, and reconnecting returns to the same session.
- Fixed SSH connections with a remote directory or command not allocating a remote TTY, which left the remote shell without a prompt.
- Added a GitHub panel: browse your repositories, list a repository's open pull requests, and open any pull request directly in its own worktree with the agent of your choice. It uses your existing GitHub CLI (`gh`) session — TermFlow never asks for or stores a token.
- Panes can now be rearranged by dragging: grab a pane by its grip and drop it on another pane's edge to re-tile the split, or on its center to swap the two.
- Added a session rail: an optional left sidebar that lists terminals as a repository -> session tree with live activity, worktree branches, collapsible groups and a drag-to-resize edge. Toggle it from the tab bar; the tab bar stays available.
- Added per-agent git worktrees: "New worktree session..." starts an agent or shell in its own isolated checkout of a repository, so several agents can work on the same project in parallel without overwriting each other. Closing the last tab of a worktree offers to remove the checkout, optionally with its branch; nothing is deleted without confirmation.

## 1.6.1 - 2026-09-01

- Added provider-independent agent handover: Claude Code, Codex, OpenCode, and compatible provider profiles can continue one another's work from the status bar.
- Resuming a saved session now defaults to the profile/provider that created it, while still allowing an explicit compatible profile choice.
- Added clickable terminal file and folder paths with working-directory resolution, context-menu actions, paths containing spaces, and safe reveal-only handling for executable files.
- Fixed the native profile selector popup using unreadable light colors on dark themes.
- Replaced the app icon with the MausCrew Workspace Core 6.1A set across the window, taskbar, shortcut, installer, and Linux package.
- The icon now has a transparent background, so it no longer shows a grey box on dark taskbars.

## 1.6.0 - 2026-08-21

- Fixed scheduled saved commands never running while a split layout was active: background tabs now start their terminals even when they are not part of the visible split tree.
- Clicking a background tab while a split layout is active now swaps it into the split instead of highlighting an unreachable terminal.
- The Explorer context menu is no longer re-registered on every settings change; it syncs only when profiles or shells actually change.
- Provider profiles now start approval-gated by default instead of with full access. Existing saved providers keep their current setting.
- Added a Reset button for edited built-in command profiles to restore their defaults.
- The persistent agent event log is now trimmed automatically instead of growing without bound.
- The status bar Git status refreshes every 30 seconds and pauses while the window is hidden, instead of polling every 5 seconds.
- Corrected the theme list and artifact versions in the README.

## 1.5.0 - 2026-08-20

- Closing the window now keeps TermFlow Lite running in the system tray, so terminals and agent sessions stay alive.
- Added a tray icon with Show/Hide and Quit; quitting from the tray menu really exits the app.
- Added a "Close to Tray" toggle in Settings > Terminal (on by default) that applies immediately.

## 1.4.3 - 2026-08-19

- Removed the empty gap between the session info strip and the status bar; the strip is no longer pushed up by the terminal padding setting and now spans the full width.
- Tightened the strip's own height so the information sits closer to the status bar.

## 1.4.2 - 2026-08-19

- Toned down the session info strip below the terminal: dimmer text, a fainter divider, and softer status colours so it no longer competes with the terminal.
- Moved the strip closer to the status bar by trimming its height and spacing.
- Hovering the strip (or focusing the folder button) restores full contrast.

## 1.4.1 - 2026-08-18

- Added an update indicator to the right side of the status bar: download a new version or restart to install without opening Settings.
- The indicator can be dismissed per version and shows live download progress.
- Refreshed the app icon with the Sade 2 Sunset set across window, taskbar, shortcut, and installer.

## 1.4.0 - 2026-08-18

- Added schedules to saved commands: run daily at a set time, weekly on a chosen day, or every N minutes.
- Added catch-up execution so a schedule missed while the app was closed runs as soon as the app starts.
- Scheduled commands open in a background tab so they never steal focus.
- Saved command list now shows the schedule summary and the next run time.

## 1.3.0 - 2026-08-16

- Added per-agent Safe, Workspace, and Full Access permission modes.
- Added a persistent, redacted agent event log with an Inbox and execution timeline.
- Added provider-aware Codex, Claude Code, and OpenCode launch adapters.
- Added approval, completion, failure, and security event notifications.
- Added Agent Security settings and permission controls to agent launch flows.
