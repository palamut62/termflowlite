import { create } from 'zustand'
import type { RemoteSettingsView, RemoteTab, ServerMessage } from '../../shared/remote'
import type { AppSettings, ShellInfo } from '../../shared/types'
import type { ConnectionState, RemoteClient } from './client'

export type Screen = 'home' | 'workspaces' | 'terminal' | 'agents' | 'project' | 'desktop' | 'settings'

interface Toast {
  id: number
  text: string
  tone: 'info' | 'error'
}

interface RemoteState {
  client: RemoteClient | null
  connection: ConnectionState
  /** Filled by the first hello; null until the desktop answered once. */
  device: { id: string; name: string } | null
  settings: RemoteSettingsView | null
  shells: ShellInfo[]
  platform: string
  version: string
  home: string
  /** Desktop hostname for the home screen. */
  computer: string
  tabs: RemoteTab[]
  desktopActiveTabId: string | null
  /** The tab this phone is looking at (independent of the desktop focus). */
  currentTabId: string | null
  screen: Screen
  /** Size of the phone terminal; sent along when the phone opens a tab. */
  termSize: { cols: number; rows: number } | null
  toasts: Toast[]
  attach(client: RemoteClient): () => void
  setScreen(screen: Screen): void
  setCurrentTab(id: string | null): void
  toast(text: string, tone?: Toast['tone']): void
  dismissToast(id: number): void
  /** Persist a settings patch on the desktop; updates local state from the answer. */
  updateSettings(patch: Partial<AppSettings>): Promise<boolean>
}

let toastId = 0

export const useRemote = create<RemoteState>()((set, get) => ({
  client: null,
  connection: 'connecting',
  device: null,
  settings: null,
  shells: [],
  platform: 'win32',
  version: '',
  home: '',
  computer: '',
  tabs: [],
  desktopActiveTabId: null,
  currentTabId: null,
  screen: 'home',
  termSize: null,
  toasts: [],

  attach(client) {
    set({ client, connection: client.state })
    const offState = client.onState((connection) => set({ connection }))
    const offMessage = client.onMessage((message: ServerMessage) => {
      switch (message.t) {
        case 'hello': {
          const current = get().currentTabId
          const keep = current && message.tabs.some((t) => t.id === current)
          set({
            device: message.device,
            settings: message.settings,
            shells: message.shells,
            platform: message.platform,
            version: message.version,
            home: message.home,
            computer: message.computer ?? '',
            tabs: message.tabs,
            desktopActiveTabId: message.activeTabId,
            currentTabId: keep ? current : (message.activeTabId ?? message.tabs[0]?.id ?? null)
          })
          break
        }
        case 'tabs': {
          const current = get().currentTabId
          const stillOpen = current && message.tabs.some((t) => t.id === current)
          set({
            tabs: message.tabs,
            desktopActiveTabId: message.activeTabId,
            currentTabId: stillOpen ? current : (message.activeTabId ?? message.tabs[0]?.id ?? null)
          })
          break
        }
        case 'settings':
          set({ settings: message.settings })
          break
      }
    })
    return () => {
      offState()
      offMessage()
    }
  },

  setScreen: (screen) => set({ screen }),
  setCurrentTab: (currentTabId) => set({ currentTabId, screen: 'terminal' }),

  toast(text, tone = 'info') {
    const id = ++toastId
    set((s) => ({ toasts: [...s.toasts.slice(-2), { id, text, tone }] }))
    setTimeout(() => get().dismissToast(id), tone === 'error' ? 5000 : 3000)
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  async updateSettings(patch) {
    const { client, settings } = get()
    if (!client || !settings) return false
    set({ settings: { ...settings, ...patch } })
    try {
      const next = await client.ipc<RemoteSettingsView>('settings:set', patch)
      set({ settings: next })
      return true
    } catch (error) {
      set({ settings })
      get().toast(errorText(error), 'error')
      return false
    }
  }
}))

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'Something went wrong.'
}

/** Shortcut for components outside React render. */
export function client(): RemoteClient {
  const c = useRemote.getState().client
  if (!c) throw new Error('Not connected to the desktop.')
  return c
}
