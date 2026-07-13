import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import path from 'path';

export default defineConfig(({ mode }) => {
  const SINGLE = process.env.VITE_SINGLEFILE === '1' || mode === 'single';
  const STATIC = process.env.VITE_STATIC === '1' || mode === 'static' || SINGLE;
  return {
    root: path.resolve(__dirname),
    // Relative base so static/App builds work under any path or native scheme.
    base: STATIC ? './' : '/',
    define: STATIC ? { 'import.meta.env.VITE_STATIC': JSON.stringify('1') } : {},
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
  };
});
