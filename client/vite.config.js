import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import path from 'path';

const SINGLE = process.env.VITE_SINGLEFILE === '1';

export default defineConfig({
  root: path.resolve(__dirname),
  // Relative base so the static build works under any GitHub Pages subpath.
  base: (process.env.VITE_STATIC === '1' || SINGLE) ? './' : '/',
  plugins: [react({ include: /\.(js|jsx)$/ }), ...(SINGLE ? [viteSingleFile()] : [])],
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
