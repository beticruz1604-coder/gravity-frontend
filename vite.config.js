import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // El front llama a /backstage/... y Vite lo reenvía al backend de Backstage (evita CORS y deja una sola URL pública).
  const proxy = {
    '/backstage': {
      target: env.BACKSTAGE_URL || 'http://localhost:7007',
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/backstage/, ''),
    },
  }
  return {
    plugins: [react()],
    server: { proxy },
    preview: { proxy },
  }
})
