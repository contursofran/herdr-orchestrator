import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { writeRegistry } from './build-plugins.ts'

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url))

writeRegistry(at('./'))

// Relative base: the app works under any path (tailscale serve --set-path /herdr-orchestrator).
export default defineConfig({
  root: at('./'),
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@shared': at('./shared'), '@client': at('./src'), '@plugins': at('./plugins'), '@core': at('../core') } },
  build: { outDir: at('./dist'), emptyOutDir: true, chunkSizeWarningLimit: 900 },
  server: { host: '127.0.0.1', allowedHosts: ['.ts.net'], proxy: { '/api': { target: process.env.HERDR_ORCH_API_URL || `http://127.0.0.1:${process.env.HERDR_ORCH_PORT || 7789}`, ws: true } } },
})
