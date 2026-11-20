import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { writeRegistry } from './build-plugins.ts'

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url))

writeRegistry(at('./'))

// Relative base: the app works under any path (tailscale serve --set-path /herdr-orchestrator).
export default defineConfig({
  root: at('./'),
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'legacy-browser-storage',
      transformIndexHtml(html) {
        const prefix = execFileSync('python3', [at('../bin/migrate_legacy.py')], { encoding: 'utf8' }).trim()
        return html.replace('__ORCH_LEGACY_STORAGE_PREFIX__', JSON.stringify(prefix))
      },
    },
  ],
  resolve: { alias: { '@shared': at('./shared'), '@client': at('./src'), '@plugins': at('./plugins'), '@core': at('../core') } },
  build: { outDir: at('./dist'), emptyOutDir: true, chunkSizeWarningLimit: 900 },
  server: { host: '127.0.0.1', allowedHosts: ['.ts.net'], proxy: { '/api': { target: process.env.HERDR_ORCH_API_URL || `http://127.0.0.1:${process.env.HERDR_ORCH_PORT || 7789}`, ws: true } } },
})
