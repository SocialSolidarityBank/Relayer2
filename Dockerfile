# 한 프로세스가 API 와 화면을 함께 낸다. 업체를 가리지 않는 표준 컨테이너다.
# node 24: `.ts` 를 그대로 실행한다(타입 제거 기본값). 번들러를 두지 않는 이유다.
FROM node:24-slim AS build
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY api/package.json api/
COPY web/package.json web/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --dir web build

FROM node:24-slim AS run
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY api/package.json api/
# 화면은 이미 빌드됐다. 실행에는 API 의존성만 필요하다.
RUN pnpm install --frozen-lockfile --prod --filter @relayer/api

COPY api ./api
COPY migrations ./migrations
COPY --from=build /app/web/dist ./web/dist

EXPOSE 8787
# 부팅 때 마이그레이션을 맞추고 뜬다. 미적용 상태로 서비스가 열리면 안 된다.
CMD ["sh", "-c", "node api/src/migrate.ts && node api/src/index.ts"]
