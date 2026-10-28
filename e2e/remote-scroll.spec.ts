import { _electron as electron, chromium, expect, test } from '@playwright/test'
import type { Browser, ElectronApplication, Page } from '@playwright/test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { request } from 'http'
import QRCode from 'qrcode'

/**
 * Remote Access end to end: the real app serves the phone client on a
 * loopback address (E2E stand-in for the Tailscale IP), a mobile-sized
 * browser pairs through the QR link, types into a desktop tab, opens a tab,
 * changes a setting and is disconnected from the desktop.
 */

let app: ElectronApplication
let win: Page
let browser: Browser
let phone: Page
let userData = ''
const port = 41000 + Math.floor(Math.random() * 9000)

test.beforeEach(async () => {
  userData = mkdtempSync(join(tmpdir(), 'termflow-e2e-remote-'))
  writeFileSync(join(userData, 'settings.json'), JSON.stringify({
    gpuAcceleration: 'off', motion: 'off', showTips: false, closeToTray: false, confirmBeforeClose: false, restoreSession: false,
    remote: { enabled: true, port }
  }))
  app = await electron.launch({
    args: ['.', '--no-sandbox'],
    env: { ...process.env, TERMFLOW_E2E: '1', TERMFLOW_E2E_USER_DATA: userData, TERMFLOW_E2E_REMOTE_HOST: '127.0.0.1' }
  })
  win = await app.firstWindow()
  await win.waitForSelector('.terminal-host .xterm')
  // Windows has Edge; elsewhere the Playwright Chromium build is used.
  browser = await chromium.launch(process.platform === 'win32' ? { channel: 'msedge' } : {})
  phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
})

test.afterEach(async () => {
  await browser?.close()
  if (app) await app.close()
  rmSync(userData, { recursive: true, force: true })
})

const phoneRows = (): Promise<string> => phone.evaluate(() => document.querySelector('.term-host .xterm-rows')?.textContent ?? '')

/** A one-finger vertical drag, sent as real touch events through CDP. */
async function swipe(from: number, to: number, x = 200): Promise<void> {
  const cdp = await phone.context().newCDPSession(phone)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: from }] })
  for (let i = 1; i <= 10; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: from + ((to - from) * i) / 10 }] })
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

test('dragging a finger on the phone terminal scrolls the history', async () => {
  const pairing = await win.evaluate(() => window.termflow.remote.pair())
  await phone.goto(pairing.url)
  // The phone opens on its Home screen (9b3e651); go to Terminal first, like remote.spec.ts.
  await expect(phone.locator('.home-title')).toBeVisible({ timeout: 15_000 })
  await phone.getByRole('button', { name: 'Terminal', exact: true }).click()
  await expect(phone.locator('.tab-chip.active')).toBeVisible({ timeout: 15_000 })
  await phone.locator('.compose-input').fill('1..300 | ForEach-Object { "scrollline$_" }')
  await phone.locator('.send').click()
  await expect.poll(phoneRows, { timeout: 15_000 }).toContain('scrollline300')

  const box = (await phone.locator('.term-wrap').boundingBox())!
  const mid = box.y + box.height / 2
  await swipe(mid - 100, mid + 100)
  await expect.poll(phoneRows).not.toContain('scrollline300')
  await phone.screenshot({ path: 'test-results/remote-phone-scrolled.png' })
  for (let i = 0; i < 3; i++) await swipe(mid + 100, mid - 100)
  await expect.poll(phoneRows).toContain('scrollline300')
})
