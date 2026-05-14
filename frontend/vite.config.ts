import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const apiProxy = {
  '/api': {
    target: 'http://localhost:3000',
    changeOrigin: true,
  },
}

export default defineConfig({
  plugins: [react()],
  server: { proxy: apiProxy },
  preview: { port: 5173, proxy: apiProxy },
})
