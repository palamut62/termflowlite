import { _electron as electron, expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { createServer, type Server } from 'http'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

/**
 * Voice input end to end (docs/voice-input.md): Chromium's fake microphone
 * records while Space is held, a local stand-in for OpenRouter answers, and
 * the answer is typed into the terminal without Enter.
 */

let app: ElectronApplication
let win: Page
let server: Server
let userData = ''
let openRouterUrl = ''
const requests: { model: string; system: string; audio: string }[] = []
let reply = 'git status --short'

test.beforeEach(async () => {
  requests.length = 0
  server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      const parsed = JSON.parse(body) as { model: string; messages: { content: unknown }[] }
      const parts = parsed.messages[1].content as { type: string; input_audio?: { data: string } }[]
      requests.push({ model: parsed.model, system: String(parsed.messages[0].content), audio: parts.find((p) => p.type === 'input_audio')?.input_audio?.data ?? '' })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: reply }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 5, cost: 0.00003 } }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  openRouterUrl = `http://127.0.0.1:${port}/api/v1/chat/completions`
  userData = mkdtempSync(join(tmpdir(), 'termflow-e2e-voice-'))
  writeFileSync(join(userData, 'settings.json'), JSON.stringify({
    gpuAcceleration: 'off', motion: 'off', showTips: false, closeToTray: false, confirmBeforeClose: false, restoreSession: false,
    voice: { enabled: true, model: 'google/gemini-2.5-flash-lite', holdMs: 300, cleanup: true, language: 'auto' }
  }))
  app = await electron.launch({
    args: ['.', '--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    env: { ...process.env, TERMFLOW_E2E: '1', TERMFLOW_E2E_USER_DATA: userData, TERMFLOW_E2E_OPENROUTER_URL: `http://127.0.0.1:${port}/api/v1/chat/completions` }
  })
  win = await app.firstWindow()
  await win.waitForSelector('.terminal-host .xterm')
  await win.evaluate(() => window.termflow.providerSecrets.set('termflow-memory', 'sk-or-e2e-test'))
  await win.locator('.terminal-host .xterm').first().click()
})

test.afterEach(async () => {
  if (app) await app.close()
  server?.close()
  rmSync(userData, { recursive: true, force: true })
})

const terminalText = (): Promise<string> => win.evaluate(() => document.querySelector('.terminal-host .xterm-rows')?.textContent ?? '')

test('holding Space dictates and types the cleaned text without Enter', async () => {
  await expect.poll(terminalText, { timeout: 15_000 }).toContain('>')
  await win.keyboard.down(' ')
  await expect(win.locator('.voice-indicator')).toContainText('Listening', { timeout: 5_000 })
  await win.waitForTimeout(1_200)
  await win.screenshot({ path: 'test-results/voice-listening.png' })
  await win.keyboard.up(' ')
  await expect.poll(terminalText, { timeout: 15_000 }).toContain('git status --short')
  await expect(win.locator('.voice-indicator')).toHaveCount(0)

  expect(requests).toHaveLength(1)
  expect(requests[0].model).toBe('google/gemini-2.5-flash-lite')
  expect(requests[0].system).toContain('PowerShell')
  expect(Buffer.from(requests[0].audio, 'base64').subarray(0, 4).toString()).toBe('RIFF')
  // Inserted, not run: the command's output never appears.
  await win.waitForTimeout(800)
  expect((await terminalText()).match(/git status --short/g)).toHaveLength(1)
})

test('a short Space press still types a space', async () => {
  await expect.poll(terminalText, { timeout: 15_000 }).toContain('>')
  await win.keyboard.type('echo voice')
  await win.keyboard.press(' ')
  await win.keyboard.type('ok')
  await win.keyboard.press('Enter')
  await expect.poll(terminalText, { timeout: 10_000 }).toMatch(/voice\s*ok/)
  expect(requests).toHaveLength(0)
})

test('Escape while recording cancels without uploading', async () => {
  await expect.poll(terminalText, { timeout: 15_000 }).toContain('>')
  await win.keyboard.down(' ')
  await expect(win.locator('.voice-indicator')).toContainText('Listening', { timeout: 5_000 })
  await win.keyboard.press('Escape')
  await win.keyboard.up(' ')
  await expect(win.locator('.voice-indicator')).toHaveCount(0)
  await win.waitForTimeout(500)
  expect(requests).toHaveLength(0)
})

/** 1.5 s of speech-like bursts, then 3 s of silence, as 16-bit mono WAV for Chromium's fake microphone. */
function speechThenSilence(file: string): void {
  const rate = 16_000
  const samples = new Int16Array(rate * 4.5)
  for (let i = 0; i < rate * 1.5; i++) {
    const t = i / rate
    // Syllable-like: a voice-band tone gated at 4 Hz, so noise suppression does not treat it as steady noise.
    samples[i] = Math.round(Math.sin(2 * Math.PI * 220 * t) * Math.max(0, Math.sin(2 * Math.PI * 4 * t)) * 0.5 * 32767)
  }
  const data = Buffer.from(samples.buffer)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8)
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22)
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34)
  header.write('data', 36); header.writeUInt32LE(data.length, 40)
  writeFileSync(file, Buffer.concat([header, data]))
}

test('Ctrl+Shift+Space records hands-free and stops by itself after silence', async () => {
  await app.close()
  const wav = join(userData, 'speech.wav')
  speechThenSilence(wav)
  app = await electron.launch({
    args: ['.', '--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${wav}%noloop`],
    env: { ...process.env, TERMFLOW_E2E: '1', TERMFLOW_E2E_USER_DATA: userData, TERMFLOW_E2E_OPENROUTER_URL: openRouterUrl }
  })
  win = await app.firstWindow()
  await win.waitForSelector('.terminal-host .xterm')
  await win.locator('.terminal-host .xterm').first().click()
  await expect.poll(terminalText, { timeout: 15_000 }).toContain('>')
  await win.keyboard.press('Control+Shift+Space')
  await expect(win.locator('.voice-indicator')).toContainText('Hands-free', { timeout: 5_000 })
  await win.screenshot({ path: 'test-results/voice-hands-free.png' })
  // No key is held: the silence after the speech must end it.
  await expect.poll(terminalText, { timeout: 15_000 }).toContain('git status --short')
  await expect(win.locator('.voice-indicator')).toHaveCount(0)
  expect(requests).toHaveLength(1)
})

test('Settings > Voice lists audio models and tests the selected one', async () => {
  reply = ''
  await win.keyboard.press('Control+,')
  await win.locator('.settings-nav-item', { hasText: 'Voice Input' }).click()
  await expect(win.getByRole('switch', { name: 'Enable voice input' })).toHaveAttribute('aria-checked', 'true')
  await win.getByRole('button', { name: 'Test', exact: true }).click()
  await expect(win.locator('.memory-status', { hasText: 'Test: Works' })).toBeVisible({ timeout: 10_000 })
  await win.screenshot({ path: 'test-results/voice-settings.png' })
  reply = 'git status --short'
})
