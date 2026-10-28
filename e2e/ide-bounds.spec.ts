import { _electron as electron, expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

/**
 * Agent IDE: no menu, popover or dialog may leave the window. The window is made small (the worst case),
 * every overlay is opened in turn and its box is compared with the viewport.
 */

let app: ElectronApplication
let win: Page
let folder = ''

test.beforeEach(async () => {
  folder = mkdtempSync(join(tmpdir(), 'termflow-e2e-bounds-'))
  const repo = join(folder, 'shop-api')
  mkdirSync(repo)
  const git = (...args: string[]): void => { execFileSync('git', args, { cwd: repo, stdio: 'ignore' }) }
  git('init', '-b', 'main')
  git('config', 'user.email', 'e2e@test')
  git('config', 'user.name', 'e2e')
  writeFileSync(join(repo, 'README.md'), '# shop\n')
  git('add', '.')
  git('commit', '-m', 'init')
  git('worktree', 'add', '-b', 'fix-login', join(repo, '.termflow-worktrees', 'fix-login'))
  const userData = join(folder, 'user-data')
  mkdirSync(userData)
  writeFileSync(join(userData, 'settings.json'), JSON.stringify({
    gpuAcceleration: 'off', motion: 'off', showTips: false, closeToTray: false, confirmBeforeClose: false, restoreSession: false, agentCompanion: false,
    uiMode: 'ide', uiModeChosen: true, startupDirectory: 'custom', customStartupDirectory: repo,
    ide: { projects: [repo], sidebarWidth: 260, rightWidth: 300, rightOpen: true, rightTab: 'explorer' }
  }))
  app = await electron.launch({ args: ['.', '--no-sandbox'], env: { ...process.env, TERMFLOW_E2E: '1', TERMFLOW_E2E_USER_DATA: userData } })
  win = await app.firstWindow()
  await win.waitForSelector('.terminal-host .xterm')
})

test.afterEach(async () => {
  if (app) await app.close()
  rmSync(folder, { recursive: true, force: true })
})

const OVERLAYS = '[role="dialog"], [role="menu"], .ctx-menu, .ide-menu, .task-palette, .usage-popover, .modal'

/** Overlay boxes that are not fully inside the window right now. */
async function offscreen(page: Page): Promise<string[]> {
  return page.evaluate((selector) => {
    const out: string[] = []
    for (const el of document.querySelectorAll<HTMLElement>(selector)) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === 'hidden') continue
      const slack = 1
      if (r.left < -slack || r.top < -slack || r.right > window.innerWidth + slack || r.bottom > window.innerHeight + slack) {
        const name = el.getAttribute('aria-label') || el.className.toString().slice(0, 40)
        out.push(`${name}: ${Math.round(r.left)},${Math.round(r.top)} -> ${Math.round(r.right)},${Math.round(r.bottom)} in ${window.innerWidth}x${window.innerHeight}`)
      }
    }
    return out
  }, OVERLAYS)
}

type Step = [name: string, open: (page: Page) => Promise<void>, settle?: number]

const STEPS: Step[] = [
  ['application menu', (p) => p.getByRole('button', { name: 'Application menu' }).click()],
  ['workspace options', (p) => p.getByRole('button', { name: 'Workspace options' }).click()],
  ['help menu', (p) => p.getByRole('button', { name: 'Help', exact: true }).click()],
  ['agent activity', (p) => p.getByRole('button', { name: 'Agent activity' }).click()],
  ['create worktree', async (p) => { await p.getByRole('button', { name: 'Application menu' }).click(); await p.getByRole('menuitem', { name: 'New Worktree...' }).click() }],
  ['workspace board', (p) => p.getByRole('button', { name: 'Workspace board' }).click()],
  ['search palette', async (p) => { await p.locator('.terminal-host .xterm').first().click(); await p.keyboard.press('Control+Shift+J') }],
  ['command palette', async (p) => { await p.locator('.terminal-host .xterm').first().click(); await p.keyboard.press('Control+Shift+P') }],
  ['settings page', async (p) => { await p.getByRole('button', { name: 'Settings', exact: true }).click() }],
  ['keep awake menu', (p) => p.getByRole('button', { name: /Keep computer awake/ }).click()],
  ['resource manager (after it loads)', (p) => p.getByRole('button', { name: 'Resource Manager' }).click(), 4500],
  ['ports (after it loads)', (p) => p.getByRole('button', { name: 'Ports' }).click(), 4500],
  ['limits', async (p) => { const button = p.locator('.status-bar button', { hasText: 'Limits' }).first(); if (await button.count()) await button.click() }],
  ['new tab options', (p) => p.locator('.new-tab-caret, [aria-label="New tab options"]').first().click()],
  ['tab menu', (p) => p.locator('.tab').first().click({ button: 'right' })],
  ['quick commands', (p) => p.getByRole('button', { name: /Command/ }).first().click()],
  ['worktree menu', (p) => p.locator('.ide-tree-worktree', { hasText: 'fix-login' }).click({ button: 'right' })],
  ['project menu', (p) => p.locator('.ide-tree-project').first().click({ button: 'right' })],
  ['source control menu', async (p) => { await p.getByRole('tab', { name: 'Source Control' }).click(); await p.getByRole('button', { name: 'Source control actions' }).click() }],
  ['explorer menu', async (p) => { await p.getByRole('tab', { name: 'Explorer' }).click(); await p.getByRole('button', { name: /actions|More/i }).first().click() }]
]

for (const [width, height] of [[900, 560], [1280, 720]] as const) {
  test(`overlays stay inside a ${width}x${height} window`, async () => {
    await app.evaluate(({ BrowserWindow }, size) => {
      const w = BrowserWindow.getAllWindows()[0]!
      w.unmaximize()
      w.setSize(size[0]!, size[1]!)
    }, [width, height])
    await win.waitForTimeout(500)
    const problems: string[] = []
    for (const [name, open, settle] of STEPS) {
      try {
        await open(win)
        await win.waitForTimeout(settle ?? 400)
        for (const line of await offscreen(win)) problems.push(`[${name}] ${line}`)
      } catch (error) {
        problems.push(`[${name}] could not be opened: ${String(error).split('\n')[0]}`)
      }
      await win.keyboard.press('Escape')
      await win.keyboard.press('Escape')
      await win.waitForTimeout(150)
    }
    expect(problems).toEqual([])
  })
}
