import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:8790', '/view': 'http://127.0.0.1:8790', '/library-files': 'http://127.0.0.1:8790' },
  },
  build: { sourcemap: false },
});
