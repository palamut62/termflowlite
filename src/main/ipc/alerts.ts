import { app, dialog, ipcMain, nativeImage, type BrowserWindow } from 'electron'
import { copyFile, mkdir, readdir, readFile, stat, unlink } from 'fs/promises'
import { extname, join } from 'path'
import { IPC, type AttentionBadge } from '../../shared/ipc'
import type { PhonePushSettings } from '../../shared/types'
import { sendPhonePush, type PhonePushEvent, type PushAction } from '../remote/phonePush'

/**
 * agent-attention (docs/orca-parity/agent-attention.md): ozel uyari sesi ve
 * gorev cubugu rozeti. Ses dosyasi userData/sounds/alert.<uzanti> olarak kopyalanir;
 * renderer yol gormez, yalniz baytlari alir (CSP media-src degismez).
 */
const SOUND_EXTENSIONS = ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac']
const MAX_SOUND_BYTES = 5 * 1024 * 1024
const SOUND_NAME = /^alert\.(?:mp3|wav|ogg|m4a|aac|flac)$/

export function registerAlertsIpc(
  getWindow: () => BrowserWindow | null,
  getPush: () => PhonePushSettings | null,
  /** Approve / Reject buttons for a push that needs input (Remote Access must be running). */
  getActions: (tabId: string) => PushAction[] | undefined = () => undefined
): void {
  const soundsDir = join(app.getPath('userData'), 'sounds')

  // Server and topic are read here, never taken from the renderer; buildPushRequest validates the event.
  ipcMain.on(IPC.ALERTS_PHONE_PUSH, (_event, event: PhonePushEvent) => {
    const push = getPush()
    if (!push?.enabled || !event || typeof event !== 'object') return
    const actions = event.kind === 'needs-input' && typeof event.tabId === 'string' ? getActions(event.tabId) : undefined
    void sendPhonePush(push, event, fetch, actions).then((error) => { if (error) console.warn('[phone-push]', error) })
  })

  ipcMain.handle(IPC.ALERTS_PHONE_PUSH_TEST, async (): Promise<string | null> => {
    const push = getPush()
    if (!push) return 'Settings are not loaded yet.'
    return sendPhonePush(push, { tabId: 'test', kind: 'done', title: 'TermFlow test', body: 'Phone notifications work.' })
  })

  ipcMain.handle(IPC.ALERTS_PICK_SOUND, async (): Promise<{ file: string } | { error: string } | null> => {
    const window = getWindow()
    const options = { properties: ['openFile' as const], filters: [{ name: 'Audio', extensions: SOUND_EXTENSIONS }] }
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
    const source = result.canceled ? undefined : result.filePaths[0]
    if (!source) return null
    const ext = extname(source).slice(1).toLowerCase()
    if (!SOUND_EXTENSIONS.includes(ext)) return { error: 'Choose an MP3, WAV, OGG, M4A, AAC or FLAC file.' }
    if ((await stat(source)).size > MAX_SOUND_BYTES) return { error: 'The sound file is larger than 5 MB.' }
    await mkdir(soundsDir, { recursive: true })
    for (const old of await readdir(soundsDir)) if (SOUND_NAME.test(old)) await unlink(join(soundsDir, old)).catch(() => undefined)
    const file = `alert.${ext}`
    await copyFile(source, join(soundsDir, file))
    return { file }
  })

  ipcMain.handle(IPC.ALERTS_LOAD_SOUND, async (_event, file: unknown): Promise<Uint8Array | null> => {
    if (typeof file !== 'string' || !SOUND_NAME.test(file)) return null
    try {
      return new Uint8Array(await readFile(join(soundsDir, file)))
    } catch {
      return null
    }
  })

  ipcMain.on(IPC.WINDOW_ATTENTION, (_event, badge: AttentionBadge) => {
    const window = getWindow()
    if (!window || !badge || typeof badge.count !== 'number') return
    const count = Math.max(0, Math.min(99, Math.floor(badge.count)))
    if (process.platform === 'win32') {
      const icon = count > 0 && typeof badge.icon === 'string' && badge.icon.startsWith('data:image/png;base64,') && badge.icon.length < 100_000
        ? nativeImage.createFromDataURL(badge.icon)
        : null
      window.setOverlayIcon(icon, count > 0 ? `${count} agent${count === 1 ? '' : 's'} need attention` : '')
    } else {
      app.setBadgeCount(count)
    }
    if (badge.needsInput && !window.isFocused()) window.flashFrame(true)
    if (count === 0) window.flashFrame(false)
  })
}
