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
        target: 'http://127.0.0.1:3001',  // 使用 127.0.0.1 而不是 localhost
        changeOrigin: true,               // 重要：修改请求头中的 origin
        secure: false,
        rewrite: (path) => path          // 保持原路径
      }
    },
    host: '0.0.0.0',                     // 确保监听所有网络接口
    port: 5173
  }
});