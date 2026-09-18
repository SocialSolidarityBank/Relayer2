import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    // host: 같은 Wi-Fi 안의 다른 기기(참가자 노트북)에서 들어오게 한다. 공개 배포가 아니다.
    host: true,
    // 워크트리 여럿이 동시에 개발 서버를 띄운다 — 포트를 env 로 바꿀 수 있어야 남의 API 를 두드리지 않는다.
    port: Number(process.env.WEB_PORT ?? 5173),
    proxy: {
      '/api': { target: `http://localhost:${process.env.API_PORT ?? 8787}`, rewrite: (p) => p.replace(/^\/api/, '') },
    },
  },
});
