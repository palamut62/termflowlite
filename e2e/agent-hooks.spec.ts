import { _electron as electron, expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

/**
 * agent-hooks (docs/orca-parity/agent-hooks.md): a stand-in "claude" reads the
 * --settings file TermFlow passes, then calls its HTTP hooks the way Claude Code
 * does (headers from env). The tab follows working -> needs input -> done
 * without guessing from the screen.
 */

const FAKE_CLAUDE = String.raw`
const fs = require('fs')
const http = require('http')
const args = process.argv.slice(2)
const settingsFile = args[args.indexOf('--settings') + 1]
const hooks = args.includes('--settings') ? JSON.parse(fs.readFileSync(settingsFile, 'utf8')).hooks : {}
function fire(name, extra) {
  const hook = hooks[name] && hooks[name][0].hooks[0]
  if (!hook) return Promise.resolve()
  const headers = {}
  for (const [key, value] of Object.entries(hook.headers)) headers[key] = value.replace(/\$(\w+)/g, (_, v) => process.env[v] || '')
  return new Promise((resolve) => {
    const req = http.request(hook.url, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' } }, (res) => { res.resume(); resolve() })
    req.on('error', resolve)
    req.end(JSON.stringify({ session_id: 'e2e-session-1', hook_event_name: name, ...extra }))
  })
}
const say = (text) => process.stdout.write(text)
const resumeAt = args.indexOf('--resume')
if (resumeAt >= 0 && process.env.FAKE_FAIL_RESUME) { say('No conversation found\r\n'); process.exit(1) }
say('args resume=' + (resumeAt >= 0 ? args[resumeAt + 1] : 'none') + '\r\n')
fire('SessionStart', { source: 'startup' }).then(() => say('fake claude ready\r\n> '))
let awaiting = false
let line = ''
process.stdin.setRawMode && process.stdin.setRawMode(true)
process.stdin.on('data', async (chunk) => {
  for (const ch of chunk.toString()) {
    if (ch !== '\r' && ch !== '\n') { line += ch; say(ch); continue }
    const input = line; line = ''
    say('\r\n')
    if (awaiting) {
      awaiting = false
      await fire('PostToolUse', { tool_name: 'Bash' })
      say('approved, finishing\r\n')
      setTimeout(async () => { await fire('Stop', { last_assistant_message: 'All done: ' + input }); say('> ') }, 1500)
    } else {
      await fire('UserPromptSubmit', { prompt: input })
      say('thinking about ' + input + '\r\n')
      setTimeout(async () => { await fire('PermissionRequest', { tool_name: 'Bash' }); awaiting = true; say('Allow Bash? (y/n) ') }, 1500)
    }
  }
})
`

let app: ElectronApplication
let win: Page
let folder = ''

async function relaunch(env: Record<string, string> = {}): Promise<void> {
  app = await electron.launch({ args: ['.', '--no-sandbox'], env: { ...process.env, ...env, TERMFLOW_E2E: '1', TERMFLOW_E2E_USER_DATA: join(folder, 'user-data') } })
  win = await app.firstWindow()
  await win.waitForSelector('.terminal-host .xterm')
}

async function launch(agentHooks: boolean, extra: Record<string, unknown> = {}): Promise<void> {
  folder = mkdtempSync(join(tmpdir(), 'termflow-e2e-hooks-'))
  const userData = join(folder, 'user-data')
  writeFileSync(join(folder, 'claude.js'), FAKE_CLAUDE)
  let command: string
  if (process.platform === 'win32') {
    command = join(folder, 'claude.cmd')
    // Same shape as an npm shim, so TermFlow resolves it to node + claude.js.
    writeFileSync(command, '@node "%~dp0\\claude.js" %*\r\n')
  } else {
    command = join(folder, 'claude')
    writeFileSync(command, `#!/usr/bin/env node\nrequire(${JSON.stringify(join(folder, 'claude.js'))})\n`)
    chmodSync(command, 0o755)
  }
  require('fs').mkdirSync(userData)
  writeFileSync(join(userData, 'settings.json'), JSON.stringify({
    gpuAcceleration: 'off', motion: 'off', showTips: false, closeToTray: false, confirmBeforeClose: false, restoreSession: false,
    agentHooks, defaultAgentPermissionMode: 'workspace', defaultProfileId: 'fake-claude',
    profiles: [{ id: 'fake-claude', name: 'Fake Claude', command, args: [], fullPermissions: false }],
    ...extra
  }))
  await relaunch()
}

test.afterEach(async () => {
  if (app) await app.close()
  rmSync(folder, { recursive: true, force: true })
})

const terminalText = (): Promise<string> => win.evaluate(() => document.querySelector('.terminal-host .xterm-rows')?.textContent ?? '')
const activity = (): Promise<string | null> => win.locator('.tab-process-indicator').first().getAttribute('aria-label')

test('a Claude tab follows the agent hooks: working, needs input, done', async () => {
  await launch(true)
  await expect.poll(terminalText, { timeout: 20_000 }).toContain('fake claude ready')
  // Before the first prompt there is no hook (SessionStart has no http hooks); the prompt heuristic applies.
  await expect.poll(activity, { timeout: 5_000 }).toBe('Activity: waiting')

  await win.locator('.terminal-host .xterm').first().click()
  await win.keyboard.type('fix login')
  await win.keyboard.press('Enter')
  await expect.poll(activity, { timeout: 5_000 }).toBe('Activity: running')
  await expect.poll(terminalText, { timeout: 10_000 }).toContain('Allow Bash?')
  await expect.poll(activity, { timeout: 5_000 }).toBe('Activity: waiting')

  await win.keyboard.type('y')
  await win.keyboard.press('Enter')
  await expect.poll(activity, { timeout: 5_000 }).toBe('Activity: running')
  await expect.poll(activity, { timeout: 10_000 }).toBe('Activity: completed')
  // The prompt the fake agent redraws afterwards must not flip the tab back.
  await win.waitForTimeout(800)
  expect(await activity()).toBe('Activity: completed')
})

test('with agent status hooks off, no settings file is passed', async () => {
  await launch(false)
  await expect.poll(terminalText, { timeout: 20_000 }).toContain('fake claude ready')
  await win.locator('.terminal-host .xterm').first().click()
  await win.keyboard.type('x')
  await win.keyboard.press('Enter')
  await expect.poll(terminalText, { timeout: 10_000 }).toContain('Allow Bash?')
  // Without hooks the old prompt heuristic still drives the tab.
  expect(await activity()).not.toBe('Activity: completed')
})

test('a background tab that needs approval gets a dot, the bell lists it, visiting clears it', async () => {
  // No real toasts or chimes during the test run.
  const quiet = { system: false, sound: false }
  await launch(true, { agentAlerts: { needsInput: quiet, done: quiet, error: quiet, volume: 0, soundFile: '' } })
  await expect.poll(terminalText, { timeout: 20_000 }).toContain('fake claude ready')
  await win.locator('.terminal-host .xterm').first().click()
  await win.keyboard.type('fix login')
  await win.keyboard.press('Enter')
  // Leave the tab before the agent asks (it asks 1.5 s later).
  await win.keyboard.press('Control+Shift+T')
  await expect(win.locator('.tab')).toHaveCount(2)

  const firstTab = win.locator('.tab').first()
  await expect(firstTab.locator('.tab-attention-needs-input')).toBeVisible({ timeout: 10_000 })
  const bell = win.locator('.attention-bell-btn')
  await expect(bell).toContainText('1')
  await bell.click()
  await expect(win.locator('.attention-bell-item')).toContainText('Approve Bash')
  await win.screenshot({ path: 'test-results/attention-bell.png' })
  await win.locator('.attention-bell-item').first().click()
  await expect(firstTab.locator('.tab-attention')).toHaveCount(0)
  await expect(bell).toHaveCount(0)

  // Mark as Unread from the terminal menu keeps the dot even on the visible tab.
  await win.locator('.terminal-host .xterm').first().click({ button: 'right' })
  await win.getByRole('menuitem', { name: 'Mark as Unread' }).click()
  await expect(firstTab.locator('.tab-attention-done')).toBeVisible()
})

test('a restart resumes the conversation the agent reported, and falls back when it is gone', async () => {
  await launch(true, { restoreSession: true })
  await expect.poll(terminalText, { timeout: 20_000 }).toContain('args resume=none')
  await win.locator('.terminal-host .xterm').first().click()
  await win.keyboard.type('first prompt')
  await win.keyboard.press('Enter')
  await expect.poll(activity, { timeout: 5_000 }).toBe('Activity: running')
  await app.close()

  await relaunch()
  await expect.poll(terminalText, { timeout: 20_000 }).toContain('args resume=e2e-session-1')
  await app.close()

  // The conversation no longer exists: the tab starts fresh instead of showing an error.
  await relaunch({ FAKE_FAIL_RESUME: '1' })
  await expect(win.getByText('could not be resumed')).toBeVisible({ timeout: 20_000 })
  await expect.poll(terminalText, { timeout: 20_000 }).toContain('args resume=none')
})

test('Ctrl+Shift+J lists the waiting tab first, 1 jumps to it, Shift+Enter opens a tab beside', async () => {
  const quiet = { system: false, sound: false }
  await launch(true, { agentAlerts: { needsInput: quiet, done: quiet, error: quiet, volume: 0, soundFile: '' } })
  await expect.poll(terminalText, { timeout: 20_000 }).toContain('fake claude ready')
  await win.locator('.terminal-host .xterm').first().click()
  await win.keyboard.type('fix login')
  await win.keyboard.press('Enter')
  await win.keyboard.press('Control+Shift+T')
  await win.keyboard.press('Control+Shift+T')
  const tabs = win.locator('.tab')
  await expect(tabs).toHaveCount(3)
  await expect(tabs.first().locator('.tab-attention-needs-input')).toBeVisible({ timeout: 10_000 })

  await win.keyboard.press('Control+Shift+J')
  const rows = win.getByRole('listbox', { name: 'Tabs and sessions' }).getByRole('option')
  await expect(rows).toHaveCount(2) // the active tab is not listed
  await expect(rows.first().locator('.tab-attention-needs-input')).toBeVisible()
  await expect(rows.first()).toHaveAttribute('aria-label', /Needs your input/)
  await win.screenshot({ path: 'test-results/jump-palette.png' })
  await win.keyboard.press('1')
  await expect(win.getByRole('dialog', { name: 'Jump to tab or session' })).toHaveCount(0)
  await expect(tabs.first()).toHaveClass(/tab-active/)
  await expect(tabs.first().locator('.tab-attention')).toHaveCount(0)

  // The tab just left is now the most recent; Shift+Enter puts it beside this one.
  await win.keyboard.press('Control+Shift+J')
  await win.keyboard.press('Shift+Enter')
  await expect(win.locator('.pane-tree-split')).toHaveCount(1)
  await expect(win.locator('.terminal-host .xterm:visible')).toHaveCount(2)
})
