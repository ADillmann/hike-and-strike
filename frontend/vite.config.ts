import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const proxy = {
  '/api': 'http://localhost:7500',
  '/uploads': 'http://localhost:7500',
  '/ws': { target: 'ws://localhost:7500', ws: true },
}

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: '0.0.0.0',
    proxy,
    watch: {
      usePolling: true,
      interval: 1000,
      ignored: ['**/node_modules/**', '**/.git/**'],
    },
  },
  preview: {
    port: 5173,
    host: '0.0.0.0',
    proxy,
  },
})
