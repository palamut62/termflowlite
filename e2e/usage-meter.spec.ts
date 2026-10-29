import { _electron as electron, expect, test } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

/** usage-meter (docs/orca-parity/usage-meter.md): Codex limits come from its own session file. */

let app: ElectronApplication | null = null
let folder = ''

test.afterEach(async () => {
  if (app) await app.close()
  app = null
  rmSync(folder, { recursive: true, force: true })
})

test('the status bar shows the active Codex tab limits from the local session file', async () => {
  folder = mkdtempSync(join(tmpdir(), 'termflow-e2e-usage-'))
  const home = join(folder, 'home')
  const day = join(home, '.codex', 'sessions', '2026', '10', '14')
  mkdirSync(day, { recursive: true })
  const resetsAt = Math.floor(Date.now() / 1000) + 3 * 3600
  writeFileSync(join(day, 'rollout-e2e.jsonl'), JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', rate_limits: {
    primary: { used_percent: 85, window_minutes: 300, resets_at: resetsAt },
    secondary: { used_percent: 12, window_minutes: 10080, resets_at: resetsAt + 86400 }
  } } }) + '\n')

  // A stand-in "codex" so the active tab is a Codex tab.
  writeFileSync(join(folder, 'codex.js'), "process.stdout.write('fake codex\\r\\n'); setInterval(() => {}, 1000)")
  let command: string
  if (process.platform === 'win32') {
    command = join(folder, 'codex.cmd')
    writeFileSync(command, '@node "%~dp0\\codex.js" %*\r\n')
  } else {
    command = join(folder, 'codex')
    writeFileSync(command, `#!/usr/bin/env node\nrequire(${JSON.stringify(join(folder, 'codex.js'))})\n`)
    chmodSync(command, 0o755)
  }
  const userData = join(folder, 'user-data')
  mkdirSync(userData)
  writeFileSync(join(userData, 'settings.json'), JSON.stringify({
    gpuAcceleration: 'off', motion: 'off', showTips: false, closeToTray: false, confirmBeforeClose: false, restoreSession: false, usageCard: false,
    defaultAgentPermissionMode: 'full', defaultProfileId: 'fake-codex', profiles: [{ id: 'fake-codex', name: 'Fake Codex', command, args: [], fullPermissions: false }]
  }))
  app = await electron.launch({ args: ['.', '--no-sandbox'], env: { ...process.env, USERPROFILE: home, HOME: home, TERMFLOW_E2E: '1', TERMFLOW_E2E_USER_DATA: userData } })
  const win = await app.firstWindow()
  await win.waitForSelector('.terminal-host .xterm')

  const meter = win.locator('.usage-meter-btn')
  // Default: percent used, like Claude Code's own status line (62bb2de).
  await expect(meter).toHaveText(/5h 85% · 7d 12%/, { timeout: 15_000 })
  await expect(meter).toHaveClass(/usage-warn/)
  await meter.click()
  await expect(win.locator('.usage-popover')).toContainText(/resets in (2h 59m|3h 0m)/)

  await win.keyboard.press('Escape')
  await win.keyboard.press('Control+,')
  await win.locator('.settings-nav-item', { hasText: 'Agent Security' }).click()
  await win.locator('select').filter({ has: win.locator('option[value="used"]') }).selectOption('remaining')
  await win.keyboard.press('Escape')
  await expect(meter).toHaveText(/5h 15% left · 7d 88% left/)

  // Limit strip on: one line under the terminal, both windows side by side, and the status bar button hides.
  await win.keyboard.press('Control+,')
  await win.locator('.settings-nav-item', { hasText: 'Agent Security' }).click()
  await win.getByLabel('Limit strip').click()
  await win.keyboard.press('Escape')
  const strip = win.locator('.usage-strip')
  await expect(strip.locator('.usage-strip-warn')).toContainText('5h')
  await expect(strip.locator('.usage-strip-ok')).toContainText('7d')
  await expect(meter).toHaveCount(0)
  const tops = await strip.locator('.usage-strip-item').evaluateAll((items) => items.map((item) => Math.round(item.getBoundingClientRect().top)))
  expect(new Set(tops).size).toBe(1)
})
