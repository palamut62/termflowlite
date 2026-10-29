import { _electron as electron, expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { execFileSync } from 'child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { request } from 'http'
import { tmpdir } from 'os'
import { delimiter, join } from 'path'

/**
 * Orchestration (docs/agent-ide/orchestration.md), IDE build only (`npm run test:e2e:ide`).
 * A fake `opencode` CLI on PATH stands in for the real agent: the local API queues the task, the agent writes a
 * file in its own worktree, the check passes, the Delegated panel shows it and Discard removes the worktree.
 */

let app: ElectronApplication
let win: Page
let folder = ''
let repo = ''

const FAKE_AGENT = `
const fs = require('fs'), path = require('path')
const args = process.argv.slice(2)
const dir = args[args.indexOf('--dir') + 1]
fs.writeFileSync(path.join(dir, 'delegated.txt'), 'hello')
fs.writeFileSync(path.join(process.env.FAKE_LOG_DIR, 'args.json'), JSON.stringify(args))
console.log(JSON.stringify({ type: 'text', part: { type: 'text', text: 'Wrote delegated.txt' } }))
console.log(JSON.stringify({ type: 'step_finish', part: { type: 'step-finish', cost: 0, tokens: { total: 42 } } }))
`

function fakeOpencode(bin: string): void {
  writeFileSync(join(bin, 'fake-opencode.js'), FAKE_AGENT)
  if (process.platform === 'win32') {
    // npm-style shim: TermFlow resolves it to node + the script, never runs it through cmd.
    writeFileSync(join(bin, 'opencode.cmd'), '@node "%~dp0\\fake-opencode.js" %*\r\n')
  } else {
    writeFileSync(join(bin, 'opencode'), `#!/usr/bin/env node\n${FAKE_AGENT}`)
    chmodSync(join(bin, 'opencode'), 0o755)
  }
}

function api(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; json: Record<string, any> }> {
  const endpoint = JSON.parse(readFileSync(join(folder, 'user-data', 'orchestration', 'endpoint.json'), 'utf8')) as { url: string; token: string }
  const url = new URL(path, endpoint.url)
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: url.port, path: url.pathname + url.search, method, headers: { 'x-termflow-token': endpoint.token, 'content-type': 'application/json' } }, (res) => {
      let text = ''
      res.on('data', (chunk) => { text += chunk })
      res.on('end', () => resolve({ status: res.statusCode ?? 0, json: JSON.parse(text || '{}') }))
    })
    req.on('error', reject)
    req.end(body === undefined ? undefined : JSON.stringify(body))
  })
}

test.beforeEach(async () => {
  folder = mkdtempSync(join(tmpdir(), 'termflow-e2e-orch-'))
  const bin = join(folder, 'bin')
  mkdirSync(bin)
  mkdirSync(join(folder, 'user-data'))
  mkdirSync(join(folder, 'logs'))
  fakeOpencode(bin)
  repo = join(folder, 'app')
  execFileSync('git', ['init', '-q', repo])
  writeFileSync(join(repo, 'README.md'), 'hi\n')
  execFileSync('git', ['add', '.'], { cwd: repo })
  execFileSync('git', ['-c', 'user.email=e2e@t', '-c', 'user.name=e2e', 'commit', '-qm', 'init'], { cwd: repo })
  writeFileSync(join(folder, 'user-data', 'settings.json'), JSON.stringify({
    gpuAcceleration: 'off', motion: 'off', showTips: false, closeToTray: false, confirmBeforeClose: false, restoreSession: false,
    uiMode: 'ide', uiModeChosen: true,
    orchestration: { enabled: true, maxConcurrent: 2, timeoutMinutes: 10, claudeThreshold: 70, targets: { opencode: { enabled: true, model: 'opencode/fake-free' } } }
  }))
  const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path') ?? 'PATH'
  app = await electron.launch({
    args: ['.', '--no-sandbox'],
    env: { ...process.env, [pathKey]: `${bin}${delimiter}${process.env[pathKey] ?? ''}`, FAKE_LOG_DIR: join(folder, 'logs'), TERMFLOW_E2E: '1', TERMFLOW_E2E_USER_DATA: join(folder, 'user-data') }
  })
  win = await app.firstWindow()
  await win.waitForSelector('.terminal-host .xterm')
})

test.afterEach(async () => {
  if (app) await app.close()
  rmSync(folder, { recursive: true, force: true })
})

test('a delegated task runs in its own worktree, shows up in the Delegated panel and is discarded', async () => {
  await expect.poll(() => existsSync(join(folder, 'user-data', 'orchestration', 'endpoint.json')), { timeout: 15_000 }).toBe(true)

  // Settings > Orchestration lists the fake OpenCode as installed and running.
  await win.keyboard.press('Control+,')
  await win.locator('.settings-nav-item', { hasText: 'Orchestration' }).click()
  await expect(win.locator('.memory-status', { hasText: 'Running' })).toBeVisible()
  await expect(win.locator('.orchestration-target .profile-row', { hasText: 'OpenCode' })).toContainText('Installed')
  await win.getByRole('button', { name: 'Back to app' }).click()

  const agents = await api('GET', '/v1/agents')
  expect(agents.status).toBe(200)
  expect(agents.json.report).toContain('- opencode · OpenCode · opencode/fake-free · FREE')

  const check = `node -e "process.exit(require('fs').readFileSync('delegated.txt','utf8')==='hello'?0:1)"`
  const created = await api('POST', '/v1/tasks', { agent: 'opencode', prompt: 'Write delegated.txt', cwd: repo, check_command: check, requested_by: 'e2e' })
  expect(created.status).toBe(201)
  const id = created.json.task.id as string

  const done = await api('GET', `/v1/tasks/${id}?wait=30&full_diff=1`)
  expect(done.json.task).toMatchObject({ status: 'done', changedFiles: ['delegated.txt'], lastMessage: 'Wrote delegated.txt', tokens: 42, check: { code: 0 } })
  expect(done.json.diff).toContain('+hello')
  // The agent got the worktree and the model explicitly; the user's checkout is untouched.
  const args = JSON.parse(readFileSync(join(folder, 'logs', 'args.json'), 'utf8')) as string[]
  expect(args.slice(0, 5)).toEqual(['run', '--dir', done.json.task.worktreePath, '-m', 'opencode/fake-free'])
  expect(existsSync(join(repo, 'delegated.txt'))).toBe(false)
  expect(execFileSync('git', ['branch', '--list', `deleg/${id}`], { cwd: repo }).toString()).toContain(`deleg/${id}`)

  await win.getByRole('tab', { name: 'Delegated tasks' }).click()
  const row = win.locator('.delegated-task', { hasText: 'Write delegated.txt' })
  await expect(row).toContainText('done')
  await expect(row).toContainText('1 files')
  await row.locator('.delegated-head').click()
  await expect(row.getByRole('button', { name: 'Copy apply command' })).toBeVisible()
  await expect(row).toContainText('From e2e')
  await row.getByRole('button', { name: 'Discard' }).click()
  await row.getByRole('button', { name: 'Click again to delete' }).click()
  await expect(win.locator('.delegated-task')).toHaveCount(0)
  expect(existsSync(done.json.task.worktreePath)).toBe(false)
  expect(execFileSync('git', ['branch', '--list', `deleg/${id}`], { cwd: repo }).toString().trim()).toBe('')
})

test('the API refuses bad requests and Orchestration stays out of the Terminal layout', async () => {
  await expect.poll(() => existsSync(join(folder, 'user-data', 'orchestration', 'endpoint.json')), { timeout: 15_000 }).toBe(true)
  expect((await api('POST', '/v1/tasks', { agent: 'opencode', prompt: 'x', cwd: folder })).json.error).toContain('Not inside a git repository')
  expect((await api('POST', '/v1/tasks', { agent: 'gemini', prompt: 'x', cwd: repo })).json.error).toContain('Unknown agent')

  await expect(win.locator('.app')).toHaveClass(/ui-ide/)
  await win.locator('.terminal-host .xterm').first().click()
  await win.keyboard.press('Control+Shift+I')
  await expect(win.locator('.app')).not.toHaveClass(/ui-ide/)
  await win.keyboard.press('Control+,')
  await expect(win.locator('.settings-nav-item', { hasText: 'Memory' })).toBeVisible()
  await expect(win.locator('.settings-nav-item', { hasText: 'Orchestration' })).toHaveCount(0)
})
