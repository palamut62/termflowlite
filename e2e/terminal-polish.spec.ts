import { _electron as electron, expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

/** terminal-polish (docs/orca-parity/terminal-polish.md). */

// Stand-in "claude" that prints every byte it receives, so Shift+Enter is visible.
const ECHO_AGENT = String.raw`
process.stdin.setRawMode && process.stdin.setRawMode(true)
process.stdout.write('echo agent ready\r\n')
process.stdin.on('data', (chunk) => process.stdout.write('got ' + JSON.stringify(chunk.toString()) + '\r\n'))
`

let app: ElectronApplication
let win: Page
let folder = ''

async function launch(settings: Record<string, unknown> = {}): Promise<void> {
  folder = mkdtempSync(join(tmpdir(), 'termflow-e2e-polish-'))
  const userData = join(folder, 'user-data')
  mkdirSync(userData)
  writeFileSync(join(folder, 'claude.js'), ECHO_AGENT)
  let command: string
  if (process.platform === 'win32') {
    command = join(folder, 'claude.cmd')
    writeFileSync(command, '@node "%~dp0\\claude.js" %*\r\n')
  } else {
    command = join(folder, 'claude')
    writeFileSync(command, `#!/usr/bin/env node\nrequire(${JSON.stringify(join(folder, 'claude.js'))})\n`)
    chmodSync(command, 0o755)
  }
  writeFileSync(join(userData, 'settings.json'), JSON.stringify({
    gpuAcceleration: 'off', motion: 'off', showTips: false, closeToTray: false, confirmBeforeClose: false, restoreSession: false,
    profiles: [{ id: 'echo-claude', name: 'Echo Claude', command, args: [], fullPermissions: false }],
    ...settings
  }))
  app = await electron.launch({ args: ['.', '--no-sandbox'], env: { ...process.env, TERMFLOW_E2E: '1', TERMFLOW_E2E_USER_DATA: userData } })
  win = await app.firstWindow()
  await win.waitForSelector('.terminal-host .xterm')
}

test.afterEach(async () => {
  if (app) await app.close()
  rmSync(folder, { recursive: true, force: true })
})

const terminalText = (): Promise<string> => win.evaluate(() => [...document.querySelectorAll('.terminal-host .xterm-rows')].map((el) => el.textContent ?? '').join('\n'))

test('Shift+Enter sends Meta+Enter to Claude instead of submitting', async () => {
  await launch({ defaultProfileId: 'echo-claude' })
  await expect.poll(terminalText, { timeout: 20_000 }).toContain('echo agent ready')
  await win.locator('.terminal-host .xterm').first().click()
  await win.keyboard.press('Shift+Enter')
  await expect.poll(terminalText, { timeout: 5_000 }).toContain('got "\\u001b\\r"')
})

test('OSC 52 writes to the clipboard and Reset Terminal keeps the shell', async () => {
  await launch()
  await expect.poll(terminalText, { timeout: 20_000 }).toContain('>')
  await win.locator('.terminal-host .xterm').first().click()
  await app.evaluate(({ clipboard }) => clipboard.writeText('before'))
  // PowerShell: ESC ] 52 ; c ; base64("from-osc52") BEL
  await win.keyboard.type("Write-Host -NoNewline \"$([char]27)]52;c;ZnJvbS1vc2M1Mg==$([char]7)\"")
  await win.keyboard.press('Enter')
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText()), { timeout: 5_000 }).toBe('from-osc52')

  // A crashed TUI can leave the alternate screen on; Reset brings the terminal back.
  await win.keyboard.type("Write-Host -NoNewline \"$([char]27)[?1049h\"")
  await win.keyboard.press('Enter')
  await win.locator('.terminal-host .xterm').first().click({ button: 'right' })
  await win.getByRole('menuitem', { name: 'Reset Terminal' }).click()
  await win.keyboard.type('echo still-alive')
  await win.keyboard.press('Enter')
  await expect.poll(terminalText, { timeout: 10_000 }).toContain('still-alive')
})

test('importing a Ghostty theme replaces the Custom theme', async () => {
  await launch()
  const palette = Array.from({ length: 16 }, (_, i) => `palette = ${i}=#${(i * 16).toString(16).padStart(2, '0')}1020`).join('\n')
  const file = join(folder, 'imported-dark')
  writeFileSync(file, `${palette}\nbackground = #123456\nforeground = #fedcba\n`)
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, file)
  await win.keyboard.press('Control+,')
  await win.getByRole('button', { name: 'Import...' }).click()
  await expect(win.getByText('Imported imported-dark as the Custom theme')).toBeVisible()
  const settings = await win.evaluate(() => window.termflow.settings.get())
  expect(settings.themeId).toBe('custom')
  expect(settings.customTheme?.background).toBe('#123456')
})
