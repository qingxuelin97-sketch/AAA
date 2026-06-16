import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  root: path.resolve(__dirname),
  // Relative base so the static build works under any GitHub Pages subpath.
  base: process.env.VITE_STATIC === '1' ? './' : '/',
  plugins: [react({ include: /\.(js|jsx)$/ })],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000',
      '/uploads': 'http://localhost:4000'
    }
  },
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true
  }
});
