import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Proxy /api to the backend during dev.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET ?? 'http://localhost:4100',
        changeOrigin: true,
      },
    },
  },
});
