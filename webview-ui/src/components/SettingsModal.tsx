import { useState, useEffect } from 'react'
import { vscode } from '../vscodeApi.js'
import { isSoundEnabled, setSoundEnabled } from '../notificationSound.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isStandalone = typeof (globalThis as any).acquireVsCodeApi !== 'function'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
  isDebugMode: boolean
  onToggleDebugMode: () => void
  launchDir?: string
}

const menuItemBase: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  width: '100%',
  padding: '6px 10px',
  fontSize: '24px',
  color: 'rgba(255, 255, 255, 0.8)',
  background: 'transparent',
  border: 'none',
  borderRadius: 0,
  cursor: 'pointer',
  textAlign: 'left',
}

export function SettingsModal({ isOpen, onClose, isDebugMode, onToggleDebugMode, launchDir }: SettingsModalProps) {
  const [hovered, setHovered] = useState<string | null>(null)
  const [soundLocal, setSoundLocal] = useState(isSoundEnabled)
  const [launchDirInput, setLaunchDirInput] = useState(launchDir ?? '')

  // Sync input when prop arrives for the first time (settingsLoaded message fires shortly after mount)
  useEffect(() => {
    if (launchDir !== undefined) {
      setLaunchDirInput(launchDir)
    }
  }, [launchDir])

  if (!isOpen) return null

  const commitLaunchDir = () => {
    if (launchDirInput.trim()) {
      vscode.postMessage({ type: 'setLaunchDir', dir: launchDirInput.trim() })
    }
  }

  const handleImportLayout = () => {
    onClose()
    if (!isStandalone) {
      vscode.postMessage({ type: 'importLayout' })
      return
    }
    // Browser mode: read file client-side then send data to server
    void (async () => {
      try {
        let text: string
        const w = window as Window & {
          showOpenFilePicker?: (opts?: unknown) => Promise<Array<{ getFile: () => Promise<File> }>>
        }
        if (typeof w.showOpenFilePicker === 'function') {
          const [handle] = await w.showOpenFilePicker({
            types: [{ description: 'JSON Files', accept: { 'application/json': ['.json'] } }],
          })
          const file = await handle.getFile()
          text = await file.text()
        } else {
          text = await new Promise<string>((resolve, reject) => {
            const input = document.createElement('input')
            input.type = 'file'
            input.accept = '.json,application/json'
            input.onchange = () => {
              const file = input.files?.[0]
              if (file) {
                void file.text().then(resolve)
              } else {
                reject(new Error('No file selected'))
              }
            }
            input.click()
          })
        }
        const parsed = JSON.parse(text) as Record<string, unknown>
        if (parsed?.version === 1 && Array.isArray(parsed.tiles)) {
          vscode.postMessage({ type: 'importLayout', layout: parsed })
        }
      } catch { /* user cancelled or invalid file */ }
    })()
  }

  return (
    <>
      {/* Dark backdrop — click to close */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          background: 'rgba(0, 0, 0, 0.5)',
          zIndex: 49,
        }}
      />
      {/* Centered modal */}
      <div
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 50,
          background: 'var(--pixel-bg)',
          border: '2px solid var(--pixel-border)',
          borderRadius: 0,
          padding: '4px',
          boxShadow: 'var(--pixel-shadow)',
          minWidth: 200,
        }}
      >
        {/* Header with title and X button */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '4px 10px',
            borderBottom: '1px solid var(--pixel-border)',
            marginBottom: '4px',
          }}
        >
          <span style={{ fontSize: '24px', color: 'rgba(255, 255, 255, 0.9)' }}>Settings</span>
          <button
            onClick={onClose}
            onMouseEnter={() => setHovered('close')}
            onMouseLeave={() => setHovered(null)}
            style={{
              background: hovered === 'close' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
              border: 'none',
              borderRadius: 0,
              color: 'rgba(255, 255, 255, 0.6)',
              fontSize: '24px',
              cursor: 'pointer',
              padding: '0 4px',
              lineHeight: 1,
            }}
          >
            X
          </button>
        </div>
        {/* Launch directory — only shown in standalone (browser) mode */}
        {isStandalone && (
          <div style={{ padding: '6px 10px', borderBottom: '1px solid var(--pixel-border)', marginBottom: '4px' }}>
            <div style={{ fontSize: '20px', color: 'rgba(255, 255, 255, 0.6)', marginBottom: '4px' }}>
              Launch Directory
            </div>
            <input
              type="text"
              value={launchDirInput}
              onChange={(e) => setLaunchDirInput(e.target.value)}
              onBlur={commitLaunchDir}
              onKeyDown={(e) => { if (e.key === 'Enter') { commitLaunchDir(); e.currentTarget.blur() } }}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                background: 'rgba(255, 255, 255, 0.06)',
                border: '2px solid var(--pixel-border)',
                borderRadius: 0,
                color: 'rgba(255, 255, 255, 0.9)',
                fontSize: '20px',
                padding: '4px 6px',
                outline: 'none',
              }}
            />
          </div>
        )}
        {/* Menu items */}
        <button
          onClick={() => {
            vscode.postMessage({ type: 'openSessionsFolder' })
            onClose()
          }}
          onMouseEnter={() => setHovered('sessions')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...menuItemBase,
            background: hovered === 'sessions' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
          }}
        >
          Open Sessions Folder
        </button>
        <button
          onClick={() => {
            vscode.postMessage({ type: 'exportLayout' })
            onClose()
          }}
          onMouseEnter={() => setHovered('export')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...menuItemBase,
            background: hovered === 'export' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
          }}
        >
          Export Layout
        </button>
        <button
          onClick={handleImportLayout}
          onMouseEnter={() => setHovered('import')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...menuItemBase,
            background: hovered === 'import' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
          }}
        >
          Import Layout
        </button>
        <button
          onClick={() => {
            const newVal = !isSoundEnabled()
            setSoundEnabled(newVal)
            setSoundLocal(newVal)
            vscode.postMessage({ type: 'setSoundEnabled', enabled: newVal })
          }}
          onMouseEnter={() => setHovered('sound')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...menuItemBase,
            background: hovered === 'sound' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
          }}
        >
          <span>Sound Notifications</span>
          <span
            style={{
              width: 14,
              height: 14,
              border: '2px solid rgba(255, 255, 255, 0.5)',
              borderRadius: 0,
              background: soundLocal ? 'rgba(90, 140, 255, 0.8)' : 'transparent',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '12px',
              lineHeight: 1,
              color: '#fff',
            }}
          >
            {soundLocal ? 'X' : ''}
          </span>
        </button>
        <button
          onClick={onToggleDebugMode}
          onMouseEnter={() => setHovered('debug')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...menuItemBase,
            background: hovered === 'debug' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
          }}
        >
          <span>Debug View</span>
          {isDebugMode && (
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: 'rgba(90, 140, 255, 0.8)',
                flexShrink: 0,
              }}
            />
          )}
        </button>
      </div>
    </>
  )
}
