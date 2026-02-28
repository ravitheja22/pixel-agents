declare function acquireVsCodeApi(): { postMessage(msg: unknown): void }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isVsCode = typeof (globalThis as any).acquireVsCodeApi === 'function'

function createWsChannel(): { postMessage(msg: unknown): void } {
  let ws: WebSocket | null = null
  const pending: string[] = []

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    ws = new WebSocket(`${proto}//${location.host}/ws`)

    ws.onopen = () => {
      for (const msg of pending) ws!.send(msg)
      pending.length = 0
    }

    ws.onmessage = (e) => {
      // Re-dispatch as a window 'message' event so useExtensionMessages.ts
      // continues to work with zero changes (it listens via window.addEventListener)
      window.dispatchEvent(
        new MessageEvent('message', { data: JSON.parse(e.data as string) }),
      )
    }

    ws.onclose = () => {
      // Auto-reconnect after 1s (handles server restart or tab reload race)
      setTimeout(connect, 1000)
    }

    ws.onerror = () => {
      // onclose will fire after onerror — reconnect handled there
    }
  }

  connect()

  return {
    postMessage(msg: unknown) {
      const json = JSON.stringify(msg)
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(json)
      } else {
        pending.push(json)
      }
    },
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const vscode = isVsCode ? acquireVsCodeApi() : createWsChannel()
