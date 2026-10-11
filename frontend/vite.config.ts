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
    },
  },
});
