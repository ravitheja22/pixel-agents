import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Vite config for standalone server build.
// Outputs to server/public/ with absolute asset paths (base: '/')
// so the Bun HTTP server can serve them correctly.
//
// Usage: cd webview-ui && npx vite build --config vite.server.config.ts
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../server/public',
    emptyOutDir: true,
  },
  base: '/',
  server: {
    // Dev mode: proxy WebSocket to the running Bun server
    proxy: {
      '/ws': { target: 'ws://localhost:7375', ws: true },
    },
  },
})
