import { _electron as electron, expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

/** Agent IDE Faz 1 (docs/agent-ide/PRD.md F1.1-F1.4): project tree and the right panel. IDE build only. */

let app: ElectronApplication
let win: Page
let folder = ''

test.beforeEach(async () => {
  folder = mkdtempSync(join(tmpdir(), 'termflow-e2e-idews-'))
  const repo = join(folder, 'shop-api')
  mkdirSync(repo)
  const git = (...args: string[]): void => { execFileSync('git', args, { cwd: repo, stdio: 'ignore' }) }
  git('init', '-b', 'main')
  git('config', 'user.email', 'e2e@test')
  git('config', 'user.name', 'e2e')
  git('commit', '--allow-empty', '-m', 'init')
  git('worktree', 'add', '-b', 'fix-login', join(repo, '.termflow-worktrees', 'fix-login'))
  const userData = join(folder, 'user-data')
  mkdirSync(userData)
  writeFileSync(join(userData, 'settings.json'), JSON.stringify({
    gpuAcceleration: 'off', motion: 'off', showTips: false, closeToTray: false, confirmBeforeClose: false, restoreSession: false,
    uiMode: 'ide', uiModeChosen: true, startupDirectory: 'custom', customStartupDirectory: repo,
    ide: { projects: [repo], sidebarWidth: 260, rightWidth: 300, rightOpen: true, rightTab: 'explorer' }
  }))
  writeFileSync(join(repo, 'README.md'), '# shop\n')
  app = await electron.launch({ args: ['.', '--no-sandbox'], env: { ...process.env, TERMFLOW_E2E: '1', TERMFLOW_E2E_USER_DATA: userData } })
  win = await app.firstWindow()
  await win.waitForSelector('.terminal-host .xterm')
})

test.afterEach(async () => {
  if (app) await app.close()
  rmSync(folder, { recursive: true, force: true })
})

test('the tree shows the project, its worktrees and the open terminal', async () => {
  const tree = win.getByRole('tree', { name: 'Projects' })
  await expect(tree.locator('.ide-tree-project')).toHaveText(/shop-api/)
  const main = tree.locator('.ide-tree-worktree', { hasText: 'main' })
  await expect(main.locator('.ide-badge')).toHaveText('primary')
  await expect(tree.locator('.ide-child-chip')).toHaveText(/1 child/)
  await expect(tree.locator('.ide-tree-worktree', { hasText: 'fix-login' })).toBeVisible()
  // The startup terminal opened in the repo sits under the primary checkout.
  await expect(tree.locator('.ide-tree-session')).toHaveCount(1)
  await win.screenshot({ path: 'test-results/ide-workspace.png' })

  // A worktree without a terminal opens one in its folder; the strip then shows only that worktree's tabs (Orca).
  await tree.locator('.ide-tree-worktree', { hasText: 'fix-login' }).click()
  await expect(tree.locator('.ide-card-child', { hasText: 'fix-login' }).locator('.ide-tree-session')).toHaveCount(1)
  await expect(win.locator('.tab')).toHaveCount(1)
  await expect(tree.locator('.ide-tree-active')).toHaveCount(1)
  // "+" opens the new terminal in the same worktree, so it stays in this strip.
  await win.locator('.new-tab-btn').click()
  await expect(win.locator('.tab')).toHaveCount(2)
  await expect(tree.locator('.ide-card-child', { hasText: 'fix-login' }).locator('.ide-tree-session')).toHaveCount(2)
  // Back to main: its own single tab, no new terminal.
  await tree.locator('.ide-tree-worktree', { hasText: 'main' }).first().click()
  await expect(win.locator('.tab')).toHaveCount(1)
  await expect(win.locator('.terminal-area .terminal-view')).toHaveCount(3)
})

test('the right panel lists files, switches to Agents and hides with its shortcut', async () => {
  const panel = win.getByRole('complementary', { name: 'Workspace panel' })
  await expect(panel.getByText('README.md')).toBeVisible({ timeout: 10_000 })
  await panel.getByRole('tab', { name: 'Agents' }).click()
  await expect(panel.getByRole('radio', { name: 'Workspace' })).toHaveAttribute('aria-checked', 'true')
  await panel.getByRole('button', { name: 'Filter by agent' }).click()
  const agentFilter = win.getByRole('menu', { name: 'Filter by agent' })
  await agentFilter.getByRole('menuitemcheckbox', { name: 'Codex' }).click()
  await expect(agentFilter.getByRole('menuitemcheckbox', { name: 'Codex' })).toHaveAttribute('aria-checked', 'false')
  await win.keyboard.press('Escape')
  await win.locator('.terminal-host .xterm').first().click()
  await win.keyboard.press('Control+Shift+A')
  await expect(panel).toHaveCount(0)
  await win.keyboard.press('Control+Shift+E')
  await expect(win.getByRole('tab', { name: 'Explorer' })).toHaveAttribute('aria-selected', 'true')
})

test('the tab context menu colors a tab and closes the others', async () => {
  await win.locator('.new-tab-btn').click()
  await expect(win.locator('.tab')).toHaveCount(2)
  const first = win.locator('.tab').first()
  await first.click({ button: 'right' })
  const menu = win.getByRole('menu', { name: 'Tab actions' })
  await menu.getByRole('button', { name: 'Color #22c55e' }).click()
  await expect(first).toHaveClass(/tab-colored/)
  await first.click({ button: 'right' })
  await menu.getByRole('menuitem', { name: 'Close Others' }).click()
  await expect(win.locator('.tab')).toHaveCount(1)
  await expect(win.locator('.tab').first()).toHaveClass(/tab-colored/)
})

test('source control stages and commits a file, checks shows the branch state', async () => {
  const panel = win.getByRole('complementary', { name: 'Workspace panel' })
  await panel.getByRole('tab', { name: 'Source Control' }).click()
  await expect(panel.locator('.ide-scm-file', { hasText: 'README.md' })).toBeVisible({ timeout: 10_000 })
  await expect(panel.getByRole('button', { name: /Publish Branch/ })).toBeVisible()
  await panel.getByRole('button', { name: 'Stage README.md' }).click()
  await expect(panel.locator('.ide-scm-group', { hasText: 'Staged Changes' })).toContainText('README.md')
  await panel.getByRole('textbox', { name: 'Commit message' }).fill('docs: add readme')
  await panel.getByRole('button', { name: 'Commit', exact: true }).click()
  await expect(panel.locator('.ide-scm-commit').first()).toHaveText(/docs: add readme/)
  await expect(panel.locator('.ide-scm-file', { hasText: 'README.md' })).toHaveCount(0)
  await win.screenshot({ path: 'test-results/ide-scm.png' })
  await panel.getByRole('tab', { name: 'Checks' }).click()
  await expect(panel.getByText('Checks', { exact: true })).toBeVisible()
})

test('explorer searches file contents and offers its actions menu', async () => {
  const panel = win.getByRole('complementary', { name: 'Workspace panel' })
  await panel.getByRole('button', { name: 'Explorer actions' }).click()
  await expect(win.getByRole('menu', { name: 'Explorer actions' }).getByRole('menuitemcheckbox', { name: /Show Dotfiles/ })).toHaveAttribute('aria-checked', 'false')
  await win.keyboard.press('Escape')
  await panel.getByRole('radio', { name: 'Contents' }).click()
  await panel.getByRole('textbox', { name: 'Search in files' }).fill('SHOP')
  await expect(panel.getByRole('list', { name: 'Search results' })).toContainText('README.md', { timeout: 10_000 })
  await expect(panel.locator('.ide-search-line')).toHaveText(/1\s*# shop/)
  await panel.getByRole('button', { name: 'Match case' }).click()
  await expect(panel.getByText('No results.')).toBeVisible()
  await win.screenshot({ path: 'test-results/ide-search.png' })
})

test('worktree details, status board, group by status and pin', async () => {
  const tree = win.getByRole('tree', { name: 'Projects' })
  await tree.locator('.ide-tree-worktree', { hasText: 'fix-login' }).click({ button: 'right' })
  await win.getByRole('menuitem', { name: 'Update...' }).click()
  const dialog = win.getByRole('dialog', { name: 'Workspace details' })
  await dialog.getByLabel('Display name').fill('Login work')
  await dialog.getByLabel('Status').selectOption('in-review')
  await dialog.getByLabel('Note (Markdown)').fill('Fix the redirect loop')
  await dialog.getByRole('button', { name: 'Save' }).click()
  const card = tree.locator('.ide-card-child', { hasText: 'Login work' })
  await expect(card.locator('.ide-status')).toHaveText('In review')
  await expect(card.locator('.ide-tree-note')).toHaveText('Fix the redirect loop')

  await win.getByRole('button', { name: 'Workspace board' }).click()
  const board = win.getByRole('dialog', { name: 'Workspace board' })
  await expect(board.getByRole('region', { name: 'In review' })).toContainText('Login work')
  await board.getByLabel('Move Login work').selectOption('done')
  await expect(board.getByRole('region', { name: 'Done' })).toContainText('Login work')
  await win.screenshot({ path: 'test-results/ide-board.png' })
  await win.keyboard.press('Escape')
  await expect(board).toHaveCount(0)

  await win.getByRole('button', { name: 'Workspace options' }).click()
  await win.getByRole('menuitemcheckbox', { name: 'Status' }).click()
  await win.keyboard.press('Escape')
  await expect(tree.getByRole('group', { name: 'Done' })).toContainText('Login work')
  await tree.locator('.ide-tree-worktree', { hasText: 'Login work' }).click({ button: 'right' })
  await win.getByRole('menuitem', { name: 'Pin', exact: true }).click()
  await expect(tree.locator('.ide-tree-worktree', { hasText: 'Login work' }).getByLabel('Pinned')).toBeVisible()
  await win.screenshot({ path: 'test-results/ide-group-status.png' })
})

test('status bar: keep awake, resource manager and a terminal port', async () => {
  await win.locator('.terminal-host .xterm').first().click()
  await win.keyboard.type(`node -e "require('http').createServer().listen(4789, () => console.log('listening-4789'))"`)
  await win.keyboard.press('Enter')
  await expect.poll(() => win.evaluate(() => document.querySelector('.terminal-host .xterm-rows')?.textContent ?? ''), { timeout: 15_000 }).toContain('listening-4789')

  await win.getByRole('button', { name: 'Ports' }).click()
  await expect(win.getByRole('menu', { name: 'Ports' }).getByRole('menuitem', { name: /localhost:4789/ })).toBeVisible({ timeout: 15_000 })
  await win.keyboard.press('Escape')

  await win.getByRole('button', { name: 'Resource Manager' }).click()
  const resources = win.getByRole('menu', { name: 'Resource Manager' })
  await expect(resources.locator('.ide-res-table')).toContainText('TermFlow (app)', { timeout: 15_000 })
  await expect(resources.locator('.ide-res-table tbody tr')).toHaveCount(2)
  await win.screenshot({ path: 'test-results/ide-resources.png' })
  await win.keyboard.press('Escape')

  await win.getByRole('button', { name: /Keep computer awake/ }).click()
  await win.getByRole('menuitemradio', { name: /^On/ }).click()
  await expect(win.getByRole('button', { name: 'Keep computer awake: on' })).toHaveClass(/ide-awake-on/)
})

test('create worktree: note and parent from Advanced nest the new card', async () => {
  await win.getByRole('button', { name: 'Application menu' }).click()
  await win.getByRole('menuitem', { name: 'New Worktree...' }).click()
  await win.fill('#worktree-repo', join(folder, 'shop-api'))
  await expect(win.locator('.path-launch-hint').first()).toContainText('on main')
  // Bir kabuk sec: test gercek bir ajan baslatmasin.
  await win.evaluate(() => {
    const select = document.querySelector<HTMLSelectElement>('#worktree-profile')
    const shell = select?.querySelector<HTMLOptionElement>('optgroup[label="Shells"] option')
    if (select && shell) { select.value = shell.value; select.dispatchEvent(new Event('change', { bubbles: true })) }
  })
  await win.fill('#worktree-branch', 'feature-x')
  await expect(win.getByText('Branch feature-x (opened if it exists, created otherwise).')).toBeVisible()
  await win.getByText('Advanced', { exact: true }).click()
  await win.locator('#worktree-parent').selectOption({ label: 'fix-login' })
  await win.fill('#worktree-note', 'Child of login work')
  await win.keyboard.press('Control+Enter')
  await expect(win.locator('[aria-label="New worktree session"]')).toHaveCount(0, { timeout: 20_000 })
  const tree = win.getByRole('tree', { name: 'Projects' })
  const parentCard = tree.locator('.ide-card-child', { has: win.getByRole('treeitem', { name: 'fix-login' }) })
  await expect(parentCard.locator('.ide-card-child', { hasText: 'feature-x' })).toBeVisible({ timeout: 20_000 })
  await expect(parentCard.locator('.ide-tree-note')).toHaveText('Child of login work')
})

test('search palette finds settings and actions and filters by source with Tab', async () => {
  await win.locator('.terminal-host .xterm').first().click()
  await win.keyboard.press('Control+Shift+J')
  const palette = win.getByRole('dialog', { name: 'Jump to tab or session' })
  const input = palette.getByRole('combobox')
  await input.fill('scrollback')
  await expect(palette.getByRole('option', { name: /^Terminal, Settings/ })).toBeVisible()
  await input.fill('fix-login')
  await expect(palette.getByRole('option', { name: /^fix-login, shop-api/ })).toBeVisible()
  // Tab x5: All -> Tabs -> Worktrees -> Sessions -> Settings -> Actions
  await input.fill('')
  for (let i = 0; i < 5; i++) await input.press('Tab')
  await expect(palette.locator('.jump-source')).toHaveText('Actions')
  await input.fill('source control')
  await input.press('Enter')
  await expect(win.getByRole('tab', { name: 'Source Control' })).toHaveAttribute('aria-selected', 'true')
})

test('settings open as a full page with groups, stats and a test notification', async () => {
  await win.getByRole('button', { name: 'Settings', exact: true }).click()
  const settings = win.getByRole('dialog', { name: 'Settings' })
  await expect(win.locator('.settings-fullpage')).toBeVisible()
  await expect(settings.locator('.settings-nav-group')).toHaveText(['AI Capabilities', 'Set Up', 'Workflows', 'Interface', 'About'])
  await settings.getByRole('button', { name: 'Stats & Usage' }).click()
  await expect(settings.getByText('Agent sessions started')).toBeVisible()
  await settings.getByRole('button', { name: 'Notifications' }).click()
  await expect(settings.getByRole('button', { name: 'Send test notification' })).toBeVisible()
  // Appearance has several sections; on the full page they stack in one column, never side by side.
  await settings.getByRole('button', { name: 'Appearance' }).click()
  const lefts = await settings.locator('.settings-content > *').evaluateAll((els) => els.filter((el) => el.getBoundingClientRect().height > 0).map((el) => Math.round(el.getBoundingClientRect().left)))
  expect(lefts.length).toBeGreaterThan(1)
  expect(new Set(lefts).size).toBe(1)
  await win.screenshot({ path: 'test-results/ide-settings-appearance.png' })
  await win.keyboard.press('Control+f')
  await expect(settings.getByRole('searchbox', { name: 'Search settings' })).toBeFocused()
  await win.screenshot({ path: 'test-results/ide-settings.png' })
  await settings.getByRole('button', { name: 'Back to app' }).click()
  await expect(settings).toHaveCount(0)
})

test('center pages: tasks, automations template, artifacts, mobile', async () => {
  await win.evaluate(() => { (document.querySelector('.terminal-host .xterm') as HTMLElement & { __mark?: number }).__mark = 77 })
  const nav = win.getByRole('navigation', { name: 'Agent IDE' })

  await nav.getByRole('button', { name: 'Tasks' }).click()
  const tasks = win.getByRole('region', { name: 'Tasks' })
  await tasks.getByRole('radio', { name: 'Pull requests' }).click()
  await expect(tasks.getByRole('radio', { name: 'Needs review' })).toBeVisible()
  await expect(tasks.locator('.ide-note').first()).toBeVisible({ timeout: 20_000 })

  await nav.getByRole('button', { name: 'Automations' }).click()
  const automations = win.getByRole('region', { name: 'Automations' })
  await automations.getByRole('button', { name: /Hourly queue check/ }).click()
  await expect(win.getByRole('complementary', { name: 'Saved commands' })).toBeVisible()
  await win.getByRole('button', { name: 'Close saved commands' }).click()
  await expect(automations.getByRole('table', { name: 'Automations' })).toContainText('Every 60 min (paused)')
  await win.screenshot({ path: 'test-results/ide-automations.png' })

  await nav.getByRole('button', { name: 'Artifacts' }).click()
  await expect(win.getByText('No shared artifacts')).toBeVisible()
  await nav.getByRole('button', { name: 'Mobile' }).click()
  await expect(win.getByRole('region', { name: 'Mobile' }).getByText('Enable Remote Access')).toBeVisible()
  await win.getByRole('button', { name: 'Back to terminals' }).click()
  await expect(win.locator('.ide-page')).toHaveCount(0)
  // Sayfalar terminali yeniden kurmaz.
  expect(await win.evaluate(() => (document.querySelector('.terminal-host .xterm') as HTMLElement & { __mark?: number }).__mark)).toBe(77)

  await expect(win.getByRole('button', { name: 'Open floating workspace' })).toHaveCount(0)
  await expect(win.getByRole('region', { name: 'Floating workspace' })).toHaveCount(0)
})

test('review: a changed file opens as a diff, a line comment goes to the agent tab, notes persist', async () => {
  const panel = win.getByRole('complementary', { name: 'Workspace panel' })
  await panel.getByRole('tab', { name: 'Source Control' }).click()
  await panel.locator('.ide-scm-file', { hasText: 'README.md' }).locator('.ide-scm-name').click({ timeout: 10_000 })
  const page = win.getByRole('region', { name: 'Review changes' })
  await expect(page.getByRole('option', { name: /README\.md/ })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.ide-review-row.ide-review-add')).toHaveText(/\+# shop/)

  await page.getByRole('radio', { name: 'Side by side' }).click()
  await expect(page.locator('.ide-review-side.ide-review-add')).toHaveText(/# shop/)
  await page.getByRole('radio', { name: 'Unified' }).click()

  await page.getByRole('button', { name: 'Comment on line' }).first().click()
  await page.getByRole('textbox', { name: 'New review comment' }).fill('Add install steps')
  await page.getByRole('button', { name: 'Add comment' }).click()
  await expect(page.getByRole('textbox', { name: 'Review comment' })).toHaveValue('Add install steps')
  await expect(page.locator('.ide-review-footer')).toContainText('1 comment')
  await win.screenshot({ path: 'test-results/ide-review.png' })

  // The startup tab is a plain shell: a multi-line prompt is copied instead of being run line by line.
  await page.getByRole('button', { name: 'Send to agent' }).click()
  await expect(win.locator('.toast-stack')).toContainText(/pasted|copied to the clipboard/)

  await page.getByRole('combobox', { name: 'Base ref' }).selectOption('main')
  await expect(page.getByRole('option', { name: /README\.md/ })).toBeVisible()
  await page.getByRole('button', { name: 'Back to terminals' }).click()

  const tree = win.getByRole('tree', { name: 'Projects' })
  await tree.locator('.ide-tree-worktree', { hasText: 'fix-login' }).click({ button: 'right' })
  await win.getByRole('menuitem', { name: 'Open Notes' }).click()
  const notes = win.getByRole('region', { name: 'Notes' })
  await notes.getByRole('textbox', { name: 'Worktree notes (Markdown)' }).fill('# fix-login\n- check tokens')
  await expect(notes.getByRole('status')).toHaveText('Saved')
  await notes.getByRole('button', { name: 'Back to terminals' }).click()
  await tree.locator('.ide-tree-worktree', { hasText: 'fix-login' }).click({ button: 'right' })
  await win.getByRole('menuitem', { name: 'Open Notes' }).click()
  await expect(win.getByRole('textbox', { name: 'Worktree notes (Markdown)' })).toHaveValue('# fix-login\n- check tokens')
})

test('everything the Lite status bar and tab bar offer is reachable in the IDE layout', async () => {
  const bar = win.locator('.status-bar')
  for (const title of ['Command history (Ctrl+Shift+H)', 'Saved commands', 'Saved agent sessions', 'Live agent activity and timeline', 'Command palette (Ctrl+Shift+P)', 'Your TermFlow stats and badges']) {
    await expect(bar.locator(`button[title="${title}"]`)).toBeVisible()
  }
  await expect(bar.locator('.status-security')).toBeVisible()
  await expect(win.getByRole('button', { name: 'Switch to widget view' })).toBeVisible()
  // Files is the right panel Explorer in the IDE.
  await expect(bar.locator('.status-files')).toBeHidden()
  await bar.locator('button[title="Command history (Ctrl+Shift+H)"]').click()
  await expect(win.getByRole('complementary', { name: 'Command history' })).toBeVisible()
})
