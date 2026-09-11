import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: { outDir: 'dist/ui', emptyOutDir: true },
  server: {
    port: 5173,
    proxy: {
      // Dev: Vite serves the UI and forwards API calls to the Hono server
      '/api': 'http://localhost:3000',
    },
  },
})
