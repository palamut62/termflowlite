import { _electron as electron, expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

/**
 * Agent IDE Faz 0 (docs/agent-ide/PRD.md): IDE build only (`npm run test:e2e:ide`).
 * First-run layout card, and switching layouts never restarts or remounts a terminal.
 */

let app: ElectronApplication
let win: Page
let userData = ''

test.beforeEach(async () => {
  userData = mkdtempSync(join(tmpdir(), 'termflow-e2e-ide-'))
  writeFileSync(join(userData, 'settings.json'), JSON.stringify({
    gpuAcceleration: 'off', motion: 'off', showTips: false, closeToTray: false, confirmBeforeClose: false, restoreSession: false
  }))
  app = await electron.launch({ args: ['.', '--no-sandbox'], env: { ...process.env, TERMFLOW_E2E: '1', TERMFLOW_E2E_USER_DATA: userData } })
  win = await app.firstWindow()
  await win.waitForSelector('.terminal-host .xterm')
})

test.afterEach(async () => {
  if (app) await app.close()
  rmSync(userData, { recursive: true, force: true })
})

const terminalText = (): Promise<string> => win.evaluate(() => document.querySelector('.terminal-host .xterm-rows')?.textContent ?? '')

test('first run asks for a layout once, then switching keeps the same live terminal', async () => {
  const card = win.getByRole('dialog', { name: 'How do you want to work?' })
  await expect(card).toBeVisible()
  expect(await app.evaluate(({ app }) => app.getName())).toBe('TermFlow Agent IDE')
  await card.getByRole('button', { name: /Agent IDE/ }).click()
  await expect(card).toHaveCount(0)
  await expect(win.locator('.app')).toHaveClass(/ui-ide/)
  await expect(win.locator('.ide-sidebar')).toBeVisible()
  await expect(win.getByRole('tab', { name: 'Explorer' })).toHaveAttribute('aria-selected', 'true')

  await expect.poll(terminalText, { timeout: 20_000 }).toContain('>')
  await win.locator('.terminal-host .xterm').first().click()
  await win.keyboard.type('echo layout-marker-4412')
  await win.keyboard.press('Enter')
  await expect.poll(async () => (await terminalText()).split('layout-marker-4412').length - 1, { timeout: 10_000 }).toBeGreaterThanOrEqual(2)
  // Tag the live xterm node: a remount would replace it.
  await win.evaluate(() => { (document.querySelector('.terminal-host .xterm') as HTMLElement & { __mark?: number }).__mark = 4412 })

  for (let i = 0; i < 5; i++) {
    await win.keyboard.press('Control+Shift+I')
    await expect(win.locator('.app')).toHaveClass(i % 2 === 0 ? /^app$/ : /ui-ide/)
  }
  expect(await win.evaluate(() => (document.querySelector('.terminal-host .xterm') as HTMLElement & { __mark?: number }).__mark)).toBe(4412)
  expect(await terminalText()).toContain('layout-marker-4412')
  await win.locator('.terminal-host .xterm').first().click()
  await win.keyboard.type('echo still-here-9')
  await win.keyboard.press('Enter')
  await expect.poll(terminalText, { timeout: 10_000 }).toContain('still-here-9')

  // Five switches from Agent IDE end in Terminal; the last layout and the choice are remembered.
  await app.close()
  app = await electron.launch({ args: ['.', '--no-sandbox'], env: { ...process.env, TERMFLOW_E2E: '1', TERMFLOW_E2E_USER_DATA: userData } })
  win = await app.firstWindow()
  await win.waitForSelector('.terminal-host .xterm')
  await expect(win.locator('.app')).toHaveClass(/^app$/)
  await expect(win.getByRole('dialog', { name: 'How do you want to work?' })).toHaveCount(0)
})
