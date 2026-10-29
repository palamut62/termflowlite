import { _electron as electron, expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

/** scrollback-restore (docs/orca-parity/scrollback-restore.md): output survives a restart. */

let app: ElectronApplication | null = null
let win: Page
let userData = ''

async function launch(): Promise<void> {
  app = await electron.launch({ args: ['.', '--no-sandbox'], env: { ...process.env, TERMFLOW_E2E: '1', TERMFLOW_E2E_USER_DATA: userData } })
  win = await app.firstWindow()
  await win.waitForSelector('.terminal-host .xterm')
}

test.beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'termflow-e2e-scrollback-'))
  writeFileSync(join(userData, 'settings.json'), JSON.stringify({
    gpuAcceleration: 'off', motion: 'off', showTips: false, closeToTray: false, confirmBeforeClose: false, restoreSession: true
  }))
})

test.afterEach(async () => {
  if (app) await app.close()
  app = null
  rmSync(userData, { recursive: true, force: true })
})

const terminalText = (): Promise<string> => win.evaluate(() => document.querySelector('.terminal-host .xterm-rows')?.textContent ?? '')

test('the last output comes back after a restart, with keys masked on disk', async () => {
  await launch()
  await expect.poll(terminalText, { timeout: 20_000 }).toContain('>')
  await win.locator('.terminal-host .xterm').first().click()
  await win.keyboard.type("echo restore-marker-7731 ('sk-ant-abcdefghij' + 'klmnopqrstuvwxyz0123456789')")
  await win.keyboard.press('Enter')
  await expect.poll(async () => (await terminalText()).split('restore-marker-7731').length - 1, { timeout: 10_000 }).toBeGreaterThanOrEqual(2)
  await expect.poll(terminalText, { timeout: 10_000 }).toContain('klmnopqrstuvwxyz0123456789')
  await app!.close()
  app = null

  const folder = join(userData, 'scrollback')
  expect(existsSync(folder)).toBe(true)
  const saved = readdirSync(folder).map((name) => readFileSync(join(folder, name), 'utf8')).join('\n')
  expect(saved).toContain('restore-marker-7731')
  // The key exists whole only in the echo output; it must be masked on disk.
  expect(saved).not.toContain('sk-ant-abcdefghijklmnopqrstuvwxyz0123456789')
  expect(saved).toContain('************')

  await launch()
  await expect.poll(terminalText, { timeout: 20_000 }).toContain('--- restored')
  expect(await terminalText()).toContain('restore-marker-7731')
  await win.screenshot({ path: 'test-results/scrollback-restored.png' })
})

test('turning the setting off deletes the saved output', async () => {
  await launch()
  await expect.poll(terminalText, { timeout: 20_000 }).toContain('>')
  await win.locator('.terminal-host .xterm').first().click()
  await win.keyboard.type('echo will-be-gone')
  await win.keyboard.press('Enter')
  await app!.close()
  app = null
  expect(readdirSync(join(userData, 'scrollback')).length).toBeGreaterThan(0)

  await launch()
  await win.evaluate(() => { window.termflow.scrollback.clear(); return window.termflow.settings.set({ restoreScrollback: false }) })
  await expect.poll(() => existsSync(join(userData, 'scrollback'))).toBe(false)
  await app!.close()
  app = null
  await launch()
  await expect.poll(terminalText, { timeout: 20_000 }).toContain('>')
  expect(await terminalText()).not.toContain('--- restored')
})
