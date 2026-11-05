import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In development the backend runs without API_PREFIX on :3000; the dev server maps /api to it so the
// app uses the same /api paths as behind the production proxy.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      // Collabora Online (LibreOffice editor), run locally on :9980. The Host header is kept so Collabora
      // accepts the editor's WebSocket origin (http://localhost:5173), as behind the production proxy.
      '/browser': { target: 'http://localhost:9980', changeOrigin: false },
      '/hosting': { target: 'http://localhost:9980', changeOrigin: false },
      '/cool': { target: 'ws://localhost:9980', ws: true, changeOrigin: false },
    },
  },
});
