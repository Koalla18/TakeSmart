import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Локальный backend монтирует роуты под /api/v1, а фронт исторически зовёт /api/...
// (кроме /api/v1/admin/token). В dev проксируем /api на локальный backend и
// дописываем /v1, если его ещё нет. На прод-сборку это НЕ влияет (server.proxy
// действует только у dev-сервера). Цель меняется через VITE_BACKEND_PROXY.
const BACKEND = process.env.VITE_BACKEND_PROXY || 'http://127.0.0.1:8000'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: BACKEND,
        changeOrigin: true,
        rewrite: (path) => (path.startsWith('/api/v1') ? path : path.replace(/^\/api/, '/api/v1')),
      },
      '/static': { target: BACKEND, changeOrigin: true },
      '/uploads': { target: BACKEND, changeOrigin: true },
    },
  },
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
})
