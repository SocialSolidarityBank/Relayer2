import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    // host: 같은 Wi-Fi 안의 다른 기기(참가자 노트북)에서 들어오게 한다. 공개 배포가 아니다.
    host: true,
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:8787', rewrite: (p) => p.replace(/^\/api/, '') } },
  },
});
