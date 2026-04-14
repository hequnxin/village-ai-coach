import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  build: {
    outDir: '../public/dist',
    emptyOutDir: true,
    rollupOptions: {
      input: 'index.html'
    }
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path
      }
    },
    host: '0.0.0.0',
    port: 5173
  }
});