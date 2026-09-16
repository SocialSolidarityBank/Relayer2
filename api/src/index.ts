import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { app } from './routes.ts';
import { startRetentionSweep } from './retention.ts';

const port = Number(process.env.PORT ?? 8787);

// 배포에서는 한 프로세스가 API 와 화면을 함께 낸다. 앞단을 둘로 두면 쿠키·프록시가 따라 늘어난다.
// 개발에서는 vite 가 화면을 내므로 dist 가 없고, 이 블록은 건너뛴다.
const webDist = join(dirname(fileURLToPath(import.meta.url)), '../../web/dist');
if (existsSync(webDist)) {
  const root = './web/dist';
  app.use('/assets/*', serveStatic({ root }));
  app.get('/favicon.ico', serveStatic({ root, path: './favicon.ico' }));
  // 해시 라우팅이라 경로는 하나뿐이지만, 새로고침이 404 로 떨어지지 않게 한 장을 돌려준다.
  app.get('*', serveStatic({ root, path: './index.html' }));
  console.log('serving web from', webDist);
}

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`relayer on http://localhost:${info.port}`);
  // 보유기간 청소. 뜰 때 한 번, 그 뒤 하루 한 번(2026-09-16 검수 — 아무도 안 부르고 있었다).
  startRetentionSweep();
});
