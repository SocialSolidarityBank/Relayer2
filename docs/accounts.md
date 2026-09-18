# 배포 체인 계정·권한 장부

릴레이어를 만들고 돌리는 데 쓰는 **모든 계정과 그 권한**을 한 장에 둔다. 값은 여기 없다 —
어디에 보관하는지만 적는다. 계정을 만들거나 권한을 바꾸면 이 표를 같이 고친다.
정리 기준일 2026-09-18. CCC 프로젝트 자원(`ccc-beta-krc`, `ccc-stt`)과 1Password 의
사람 로그인 항목은 이 장부의 범위 밖이다.

## 세 층

| 층 | 누구 | 원칙 |
|---|---|---|
| **사람 소유자** | Q 한 사람 | 전권. 로봇이 못 하는 일(권한 확대·삭제 승인·결제)만 직접 한다 |
| **운영 자동화** | 맥미니·플래너가 쓰는 로봇 | 기관을 만들고 비밀을 옮길 만큼만. 값은 1Password 서비스 계정을 거쳐 Infisical 에서 메모리로 |
| **앱 런타임** | 기관별 Container App | 자기 창고 하나만. 열쇠 없음(관리 ID) |

## Azure — 구독 `Azure subscription 1`, 테넌트 socialsolidaritybank

| 주체 | 종류 | 역할 | 범위 | 비밀 보관 | 용도 |
|---|---|---|---|---|---|
| `account@socialsolidaritybank.onmicrosoft.com` | 사람 | Owner | 구독 | 브라우저 로그인 | 승인·권한 확대·결제 |
| `relayer2-deploy` (appId `d0cd1081…`, objectId `9cfae4d8…`) | 서비스 프린시펄 | Contributor + **Role Based Access Control Administrator** | RG `relayer2-prod` | Infisical `prod:/RELAYER2` `AZURE_CLIENT_ID`·`AZURE_CLIENT_SECRET`·`AZURE_TENANT_ID`·`AZURE_SUBSCRIPTION_ID` (비밀 만료 2027-09-18) | `provision-institution.sh` 무인 실행. RBAC Admin 은 관리 ID에 Blob 역할을 붙이기 위해서다(2026-09-18 부여) |
| `relayer2-test2` (`dacd5066…`) | 시스템 관리 ID | Storage Blob Data Contributor | Storage `relayer2test2` | 없음 | test2 앱의 음성·문서 저장 |

기관을 추가하면 관리 ID 행이 하나씩 는다. 창고는 **계정 키 접근 꺼짐**(`allowSharedKeyAccess=false`)이
기본이다 — 앱은 관리 ID만 쓰고, 사람이 안을 볼 때는 Q 계정에 `Storage Blob Data Reader` 를
잠깐 붙였다 뗀다.

2026-09-18 에 지운 것: placeholder 앱 `relayer2`(MS 샘플 이미지), 빈 창고 `relayer2voice`,
그 계정 키 `AZURE_STORAGE_ACCOUNT_KEY`(Infisical).

## Cloudflare — 계정 `account@bss.or.kr`, zone `relayer.kr`

| 토큰 | 권한 | 보관 | 용도 |
|---|---|---|---|
| `relayer-dns-edit` (id `0512…29ff`) | Zone.DNS **Edit**, zone `relayer.kr` 만 | Infisical `prod:/` `CLOUDFLARE_DNS_API_TOKEN` | 기관 `<slug>` CNAME + `asuid.<slug>` TXT (`scripts/cloudflare_dns.py`) |
| `Cloudflare Workers` | Workers 배포 14개 권한, 전 zone, 2027-08 만료 | Infisical `prod:/` `CLOUDFLARE_WORKERS_API_TOKEN` | CCC 프리뷰 Workers 배포. 릴레이어는 쓰지 않는다 |
| `ccc-access-setup` | (CCC) | — | 릴레이어 범위 밖. 건드리지 않는다 |

`relayer.kr` 루트는 맥미니 cloudflared 터널(프록시)이고, 기관 주소는 **DNS only** CNAME 이다 —
ACA 관리형 인증서가 CNAME 으로 검증하기 때문에 프록시를 켜면 인증서가 안 나온다.
Cloudflare 로그인 자체(비밀번호)는 1Password `BSS` 금고 `Cloudflare · account@bss.or.kr`.

## Infisical — 프로젝트 `ggbss-agent` (`a7c44b37-…`), 환경 `prod`

| 주체 | 종류 | 역할 | 보관 | 용도 |
|---|---|---|---|---|
| `ggbss-agent` | Machine Identity (universal auth) | **Admin** | 1Password `BSS` › `Infisical · account@ggbss.or.kr` (item `l34nxgvhlqrca67cikcdpetsfe`) `ggbss_client_ID`·`ggbss_client_secret` | 모든 스크립트의 읽기·쓰기. Admin 이라 기관 폴더는 정리 단위이지 접근 경계가 아니다 |
| `agent` | Machine Identity | viewer | — | (다른 프로젝트 용도) |

경로별 내용(이름만):

| 경로 | 이름 | 소비자 |
|---|---|---|
| `/` | `CLOUDFLARE_DNS_API_TOKEN`, `CLOUDFLARE_WORKERS_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | 프로비저닝 DNS, CCC |
| `/RELAYER2` | `DATABASE_URL`, `PII_ENC_KEY`, `SESSION_SECRET`, `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION`, `VOICE_ENABLED`, `RELAYER_OPENAI_API_KEY`, `AZURE_CLIENT_*`·`AZURE_TENANT_ID`·`AZURE_SUBSCRIPTION_ID` | 맥미니 `relayer.kr` 운영(`scripts/pull-secrets.sh`), 로봇 로그인 |
| `/RELAYER2/test2` | `DATABASE_URL`, `PII_ENC_KEY`, `SESSION_SECRET` | ACA `relayer2-test2` secretRef |

`AZURE_SPEECH_KEY`·`VOICE_ENABLED` 는 env 폴백이다 — 기관 앱은 마법사에서 DB에 넣은 키와
토글을 먼저 쓴다. 맥미니 운영이 DB 설정으로 옮겨가면 이 둘은 지운다.

## 1Password — 서비스 계정 (RUN 프로필)

| 주체 | 권한 | 보관 | 용도 |
|---|---|---|---|
| 공용 RUN 서비스 계정 (두 Mac 공유) | 금고 `BSS`, `DEVELOPER` 읽기 | 소스 Mac: Keychain `opsvc-default`; 미니: 소유자 전용 토큰 파일 | `~/.dotfiles/scripts/opsvc` 로만 접근. Infisical 자격 하나를 꺼내는 데 쓴다 |

`op://` 참조는 항목 **ID**로 쓴다 — 제목의 `·` 는 참조에서 거절된다.

## GitHub — `SocialSolidarityBank/Relayer2`

| 주체 | 권한 | 보관 | 용도 |
|---|---|---|---|
| `SocialSolidarityBank` (gh 활성) | repo, workflow, read:org | gh keyring | PR·머지·태그 |
| `GITHUB_TOKEN` (Actions) | `packages: write` 워크플로 안에서만 | 자동 | `v*` 태그 → `ghcr.io/socialsolidaritybank/relayer` |
| `foxion37` (gh 비활성) | 개인 | gh keyring | 릴레이어에 쓰지 않는다 |

사람 계정 토큰에 `write:packages` 를 더하지 않는다 — 이미지는 워크플로 토큰이 낸다.

## Supabase

| 주체 | 보관 | 용도 |
|---|---|---|
| 기관 프로젝트 세션 풀러 `DATABASE_URL` (`*.pooler.supabase.com:5432`) | Infisical `/RELAYER2`, `/RELAYER2/test2` | 운영 `public`, test2 는 같은 DB의 `relayer_test2` 스키마 |
| 대시보드 로그인 | 1Password `BSS` › `Supabase / Relayer` | 사람만 |

## 바꿀 때 순서

1. 이 표를 먼저 고친다(무엇을·왜).
2. 발급자에서 만들거나 지운다(Azure/Cloudflare/GitHub).
3. Infisical 값을 넣거나 지운다. 값은 화면·argv·로그에 싣지 않는다.
4. 소비자(스크립트·ACA secretRef)를 옮기고 **옛 값이 거절되는지, 새 값이 통하는지** 따로 확인한다.
