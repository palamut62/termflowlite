import { useCallback, useEffect, useRef, useState } from 'react'
import { Bell, Copy, QrCode, ShieldCheck, Smartphone, Trash2 } from 'lucide-react'
import type { RemoteDeviceInfo, RemotePairing, RemoteStatus } from '../../../shared/remote'
import type { ElevationStatus, PhonePushSettings as PushSettings } from '../../../shared/types'
import { useSettingsStore } from '../store/settingsStore'
import { useToastStore } from '../store/toastStore'
import { Field, NumberInput, TextInput, Toggle } from './Settings'

function statusText(status: RemoteStatus | null): string {
  if (!status) return 'Loading...'
  switch (status.state) {
    case 'off': return 'Off'
    case 'starting': return 'Starting...'
    case 'running': return `Listening on ${status.url} (Tailscale only)`
    case 'no-tailscale': return 'Waiting for Tailscale. Connect this computer to your tailnet.'
    case 'error': return status.error ?? 'The remote server could not start.'
  }
}

const date = (time: number): string => new Date(time).toLocaleString()
const ipcError = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : fallback

/** Agent alerts on the phone through ntfy, also when TermFlow Remote is closed (docs/orca-parity/remote-attention.md). */
function PhonePushSettings(): React.JSX.Element {
  const remote = useSettingsStore((s) => s.settings.remote)
  const update = useSettingsStore((s) => s.update)
  const toast = useToastStore((s) => s.show)
  const push = remote.push
  const [server, setServer] = useState(push.server)
  const [testing, setTesting] = useState(false)
  useEffect(() => setServer(push.server), [push.server])

  const save = (next: Partial<PushSettings>): Promise<void> => update({ remote: { ...remote, push: { ...push, ...next } } })
  const sendTest = async (): Promise<void> => {
    setTesting(true)
    const error = await window.termflow.alerts.testPhonePush()
    setTesting(false)
    toast(error ?? 'Test notification sent. Check your phone.', error ? 'error' : 'success')
  }
  const copyTopic = async (): Promise<void> => {
    await window.termflow.clipboard.writeText(push.topic)
    toast('Topic copied.', 'success')
  }

  return (
    <>
      <div className="settings-section-title"><Bell size={14} /> Phone notifications</div>
      <p className="settings-note">
        When an agent finishes, needs you or stops with an error while you are not looking, your phone gets a notification,
        even when TermFlow Remote is closed. Install the free ntfy app, subscribe to the topic below on the same server;
        tapping a notification opens that tab in the TermFlow iPhone app. Only the alert title and tab name are sent, never
        terminal output. On a public server anyone who knows the topic can read these alerts, so keep it private.
        "Needs you" alerts carry Approve (Enter) and Reject (Esc) buttons while Remote Access is on; each button works once,
        for 10 minutes, and only from your Tailscale network.
      </p>
      <Field label="Enable phone notifications">
        <Toggle checked={push.enabled} label="Enable phone notifications" onChange={(on) => void save({ enabled: on })} />
      </Field>
      {push.enabled && (
        <>
          <Field label="ntfy server" hint="https://ntfy.sh or your own ntfy server">
            <span className="memory-inline">
              <TextInput className="settings-input-wide" value={server} onChange={(e) => setServer(e.target.value)} />
              <button className="settings-btn settings-btn-small" disabled={server === push.server} onClick={() => void save({ server })}>Apply</button>
            </span>
          </Field>
          <Field label="Topic" hint="Subscribe to this topic in the ntfy app">
            <span className="memory-inline">
              <code>{push.topic}</code>
              <button className="settings-btn settings-btn-small" onClick={() => void copyTopic()} aria-label="Copy topic"><Copy size={12} /> Copy</button>
              <button className="settings-btn settings-btn-small" onClick={() => void save({ topic: '' })} title="Old subscriptions stop receiving alerts">New topic</button>
              <button className="settings-btn settings-btn-small settings-btn-primary" disabled={testing} onClick={() => void sendTest()}>Send test</button>
            </span>
          </Field>
        </>
      )}
    </>
  )
}

/** Admin tabs opened from the phone: set up once here under UAC, then approved with a PIN on the phone. */
function AdminTabsSettings(): React.JSX.Element | null {
  const toast = useToastStore((s) => s.show)
  const [status, setStatus] = useState<ElevationStatus | null>(null)
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { void window.termflow.remote.elevationStatus().then(setStatus) }, [])
  if (status === null || status === 'unsupported') return null

  const run = async (action: () => Promise<void>, done: string): Promise<void> => {
    setBusy(true)
    try {
      await action()
      setPin('')
      toast(done, 'success')
    } catch (error) {
      toast(ipcError(error, 'Windows did not finish the change.'), 'error')
    } finally {
      setStatus(await window.termflow.remote.elevationStatus())
      setBusy(false)
    }
  }

  return (
    <>
      <div className="settings-section-title"><ShieldCheck size={14} /> Administrator tabs from the phone</div>
      <p className="settings-note">
        Windows does not let any app click a UAC prompt, so this PC approves once: Windows asks for administrator rights
        one time, then the phone can open an administrator terminal after you enter this PIN there. Without the PIN nothing
        is elevated. Changing the PIN or turning this off asks for UAC again.
      </p>
      <Field label="Status" hint={status === 'on' ? 'On. On the phone: New tab > Run as administrator.' : 'Off'}>
        {status === 'on' && <button className="settings-btn settings-btn-small settings-btn-danger" disabled={busy} onClick={() => void run(() => window.termflow.remote.disableElevation(), 'Administrator tabs turned off.')}>Turn off</button>}
      </Field>
      <Field label={status === 'on' ? 'New PIN' : 'PIN'} hint="6 to 12 digits; entered on the phone for every administrator tab">
        <span className="memory-inline">
          <input className="settings-input-narrow" type="password" inputMode="numeric" autoComplete="new-password" aria-label="Administrator PIN" maxLength={12}
            value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
          <button className="settings-btn settings-btn-small settings-btn-primary" disabled={busy || pin.length < 6}
            onClick={() => void run(() => window.termflow.remote.enableElevation(pin), 'Administrator tabs are ready on the phone.')}>
            {status === 'on' ? 'Change PIN' : 'Turn on'}
          </button>
        </span>
      </Field>
    </>
  )
}

export function RemoteSettings(): React.JSX.Element {
  const remote = useSettingsStore((s) => s.settings.remote)
  const update = useSettingsStore((s) => s.update)
  const toast = useToastStore((s) => s.show)
  const [status, setStatus] = useState<RemoteStatus | null>(null)
  const [devices, setDevices] = useState<RemoteDeviceInfo[]>([])
  const [pairing, setPairing] = useState<RemotePairing | null>(null)
  const [port, setPort] = useState(remote.port)
  const [confirmAll, setConfirmAll] = useState(false)
  const [now, setNow] = useState(Date.now())

  const refreshDevices = useCallback(async (): Promise<void> => {
    setDevices(await window.termflow.remote.devices())
  }, [])

  useEffect(() => {
    void window.termflow.remote.status().then(setStatus)
    void refreshDevices()
    return window.termflow.remote.onStatus((next) => {
      setStatus(next)
      void refreshDevices()
    })
  }, [refreshDevices])

  useEffect(() => setPort(remote.port), [remote.port])

  // A phone used the code (new pairing or renewal): close the QR.
  const shownAt = useRef(0)
  const lastPairedAt = status?.lastPairedAt ?? null
  useEffect(() => {
    if (!pairing || lastPairedAt === null || lastPairedAt < shownAt.current) return
    const renewed = pairing.deviceId ? devices.find((d) => d.id === pairing.deviceId)?.name : null
    setPairing(null)
    toast(renewed ? `${renewed} reconnected with a new key.` : 'Phone paired.')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastPairedAt])

  useEffect(() => {
    if (!pairing) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [pairing])

  useEffect(() => () => { void window.termflow.remote.cancelPair() }, [])

  const setEnabled = async (enabled: boolean): Promise<void> => {
    if (!enabled) setPairing(null)
    await update({ remote: { ...remote, enabled } })
  }

  const savePort = async (): Promise<void> => {
    if (port === remote.port) return
    await update({ remote: { ...remote, port } })
    toast(`Remote Access now uses port ${port}. Pair phones again if they cannot connect.`)
  }

  /** deviceId: a QR that renews that paired phone (same entry, new key). */
  const showQr = async (deviceId?: string): Promise<void> => {
    try {
      shownAt.current = Date.now()
      setPairing(await window.termflow.remote.pair(deviceId))
      setNow(Date.now())
    } catch (error) {
      toast(ipcError(error, 'Could not create a pairing code.'))
    }
  }

  const hideQr = (): void => {
    setPairing(null)
    void window.termflow.remote.cancelPair()
  }

  const revoke = async (deviceId: string | null): Promise<void> => {
    await window.termflow.remote.revoke(deviceId)
    setConfirmAll(false)
    await refreshDevices()
    toast(deviceId ? 'Device disconnected.' : 'All devices disconnected.')
  }

  const secondsLeft = pairing ? Math.max(0, Math.round((pairing.expiresAt - now) / 1000)) : 0
  const running = status?.state === 'running'

  const pairingPanel = pairing && (
    <div className="remote-pairing">
      {secondsLeft > 0
        ? <img className="remote-qr" alt="Pairing QR code" src={`data:image/svg+xml;utf8,${encodeURIComponent(pairing.svg)}`} />
        : <div className="remote-qr remote-qr-expired">Expired</div>}
      <div className="remote-pairing-info">
        <span>{secondsLeft > 0 ? `One-time code, valid for ${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}` : 'This code expired.'}</span>
        {secondsLeft > 0 && <span className="remote-code" aria-label="Pairing code">{pairing.code}</span>}
        <span>
          {pairing.deviceId
            ? 'Scan with "Scan QR code" on the phone (or type the code). The phone keeps its place in this list with a new key; the old key stops working.'
            : 'Scan it with the phone camera, or with "Scan QR code" in the TermFlow app on the phone.'}
          {' '}No camera? Open {status?.url} on the phone and type the code.
        </span>
        {secondsLeft === 0 && <button className="settings-btn settings-btn-small" onClick={() => void showQr(pairing.deviceId)}>New code</button>}
      </div>
    </div>
  )

  return (
    <div className="settings-section">
      <div className="settings-section-title"><Smartphone size={14} /> Remote Access</div>
      <p className="settings-note">
        Control this TermFlow Lite from your phone over Tailscale: watch and type in every tab, open and close tabs,
        manage profiles, providers and settings. The server listens only on this computer's Tailscale address,
        never on your local network or the internet. A phone stays connected until you disconnect it here.
        If the phone cannot reach the address, allow TermFlow Lite when Windows Firewall asks.
      </p>
      <Field label="Enable Remote Access" hint={statusText(status)}>
        <Toggle checked={remote.enabled} label="Enable Remote Access" onChange={(on) => void setEnabled(on)} />
      </Field>
      <Field label="Port" hint="TCP port on the Tailscale address">
        <span className="memory-inline">
          <NumberInput value={port} min={1024} max={65535} onChange={setPort} />
          <button className="settings-btn settings-btn-small" disabled={port === remote.port} onClick={() => void savePort()}>Apply</button>
        </span>
      </Field>

      {remote.enabled && (
        <Field label="Pair a phone" hint="Scan the code with the phone's camera. Both devices must be signed in to the same tailnet.">
          {pairing && !pairing.deviceId
            ? <button className="settings-btn settings-btn-small" onClick={hideQr}>Hide code</button>
            : <button className="settings-btn settings-btn-small settings-btn-primary" disabled={!running} onClick={() => void showQr()}>Show QR code</button>}
        </Field>
      )}
      {pairing && !pairing.deviceId && pairingPanel}

      <div className="settings-section-title">Paired devices</div>
      {devices.length === 0 && <p className="settings-note">No phone is paired yet.</p>}
      {devices.map((device) => (
        <div key={device.id}>
          <Field label={device.name} hint={`${device.connected ? 'Connected now' : `Last seen ${date(device.lastSeenAt)}`} · paired ${date(device.createdAt)}`}>
            <span className="memory-inline">
              {pairing?.deviceId === device.id
                ? <button className="settings-btn settings-btn-small" onClick={hideQr}>Hide code</button>
                : (
                  <button className="settings-btn settings-btn-small" disabled={!running} onClick={() => void showQr(device.id)} aria-label={`Reconnect ${device.name}`} title="Show a QR that gives this phone a new key, e.g. after adding the app to the home screen">
                    <QrCode size={12} /> Reconnect
                  </button>
                )}
              <button className="settings-btn settings-btn-small settings-btn-danger" onClick={() => void revoke(device.id)} aria-label={`Disconnect ${device.name}`}>
                <Trash2 size={12} /> Disconnect
              </button>
            </span>
          </Field>
          {pairing?.deviceId === device.id && pairingPanel}
        </div>
      ))}
      {devices.length > 1 && (confirmAll
        ? (
          <div className="profile-form-actions">
            <button className="settings-btn settings-btn-danger" onClick={() => void revoke(null)}>Disconnect all devices</button>
            <button className="settings-btn" onClick={() => setConfirmAll(false)}>Cancel</button>
          </div>
        )
        : <button className="settings-btn" onClick={() => setConfirmAll(true)}>Disconnect all...</button>)}
      <AdminTabsSettings />
      <PhonePushSettings />
    </div>
  )
}
