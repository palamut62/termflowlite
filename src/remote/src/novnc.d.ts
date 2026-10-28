/** noVNC ships no types; only what the Screen view uses is declared here. */
declare module '@novnc/novnc' {
  interface RFBOptions {
    credentials?: { username?: string; password?: string }
    shared?: boolean
    wsProtocols?: string[]
  }
  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, url: string | WebSocket, options?: RFBOptions)
    viewOnly: boolean
    scaleViewport: boolean
    resizeSession: boolean
    clipViewport: boolean
    background: string
    showDotCursor: boolean
    disconnect(): void
    focus(): void
    blur(): void
    sendCredentials(credentials: { username?: string; password?: string }): void
    sendKey(keysym: number, code: string | null, down?: boolean): void
    sendCtrlAltDel(): void
    machineShutdown(): void
  }
}
