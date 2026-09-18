# Azure 기관별 배포 런북

릴레이어는 BSS가 `koreacentral`의 Azure Container Apps에서 기관당 앱 하나를 운영한다.
데이터베이스와 Speech 리소스는 기관 소유이고, Blob 저장소와 Container App은 기관별로
분리한다. 실제 자원 생성·DNS·인증서는 한 명령이 하되, APPLY 는 플래너의 별도 GO 뒤에만 한다.

## 고정 토폴로지

| 자원 | 기관별 이름 | 정책 |
|---|---|---|
| Resource Group | `relayer2-prod` | 기존 그룹 재사용 |
| Container Apps Environment | `relayer2-env` | 기존 환경 재사용 |
| Storage Account | `relayer2<slug>` | 공개 Blob 차단, TLS 1.2 이상, **계정 키 접근 끔**(관리 ID만) |
| Blob containers | `voice`, `documents` | 둘 다 비공개 |
| Container App | `relayer2-<slug>` | 외부 ingress, target port 8787, min 0/max 1 |
| Infisical | `prod:/RELAYER2/<slug>` | 기관별 시크릿 정본 |
| 공개 주소 | `https://<slug>.relayer.kr` | Cloudflare **DNS only** CNAME + `asuid.<slug>` TXT, ACA 관리형 인증서 |

Storage Account 이름에는 하이픈을 쓸 수 없으므로 스크립트가 slug의 하이픈만 제외한다.
전체 이름이 Azure의 24자 제한을 넘으면 자원을 만들기 전에 거절한다.

Container App에는 system-assigned managed identity를 붙이고 해당 기관 Storage Account
범위에만 `Storage Blob Data Contributor`를 부여한다. 앱은 `DefaultAzureCredential`로
Blob에 접근한다. Storage 연결 문자열과 account key는 만들거나 주입하지 않는다.

## 데이터와 시크릿 경계

- `DATABASE_URL`은 기관 소유 Supabase의 세션 풀러만 받는다. 호스트는
  `pooler.supabase.com` 하위, 포트는 `5432`여야 한다. 트랜잭션 풀러 `6543`과
  IPv6 전용 직접 주소 `db.<ref>.supabase.co`는 거절한다.
- Infisical `prod:/RELAYER2/<slug>`가 `DATABASE_URL`, `PII_ENC_KEY`,
  `SESSION_SECRET`의 정본이다. `ggbss-agent` Machine Identity는 프로젝트 Admin이므로
  기관 폴더는 정리 단위이지 접근 제어 경계가 아니다.
- `PII_ENC_KEY`와 `SESSION_SECRET`은 처음 프로비저닝할 때 자동 생성한다. 같은 이름이
  이미 있으면 값을 읽거나 덮지 않고 건너뛴다.
- ACA secret은 Infisical 정본의 사본이다. Infisical에서 받은 권한 `0600` `.env`로
  ACA 설정 파일을 만들며, 비밀값은 명령행 인자·출력·로그에 싣지 않는다.
- 음성과 문서는 업로드 전에 앱이 `PII_ENC_KEY`로 암호화한다. Azure의 서버 측 암호화는
  이 앱 수준 암호화를 대체하지 않는다.
- Key Vault는 추가하지 않는다. 같은 값을 두 비밀 시스템에서 따로 운영하지 않는다.

`PII_ENC_KEY`를 잃으면 DB의 PII와 키, Blob의 음성·문서를 모두 복구할 수 없다.
키 로테이션과 재암호화는 이 런북의 범위 밖이다.

## 한 명령 프로비저닝

기본 동작은 DRY-RUN이다.

```bash
scripts/azure/provision-institution.sh <slug>
```

명령은 TTY에서 `DATABASE_URL`을 무에코로 한 번 읽는다. 문자열을 인자, 환경 변수,
셸 기록, 화면에 넣지 않는다. DRY-RUN은 URL 형식만 검사하고 Azure, Infisical,
Supabase를 호출하지 않는다.

APPLY 전에는 `az`가 서비스 프린시펄로 로그인되어 있어야 한다. 자원 생성용
`Contributor`와 Storage 범위 역할 부여용 `Microsoft.Authorization/roleAssignments/write`
권한이 모두 필요하다. 후자는 `Role Based Access Control Administrator` 같은 별도
역할로 부여하며, 권한 확대 자체는 이 스크립트가 하지 않는다.

플래너가 실제 생성을 별도로 승인한 뒤에만 다음처럼 실행한다.

```bash
APPLY=1 scripts/azure/provision-institution.sh <slug>
```

APPLY 순서는 고정이다.

1. 세션 풀러 URL 형식을 검사하고 비밀을 argv에 넣지 않은 채 `select 1`로 연결한다.
2. 키를 생성하고 Infisical의 `/RELAYER2`, `/RELAYER2/<slug>` 폴더를 부모부터 만든다.
3. 기존 Infisical 이름을 덮지 않고 정본 `.env`를 다시 내려받는다.
4. Resource Group과 Container Apps Environment는 재사용하고 기관 Storage Account와
   `voice`, `documents` 컨테이너를 보장한다.
5. 공개 GHCR 이미지 `ghcr.io/socialsolidaritybank/relayer:0.2.0`으로 기관 ACA 앱을
   만들고 system managed identity를 켠다.
6. Storage Account 범위에 `Storage Blob Data Contributor`를 보장한다.
7. 컨테이너 안에서 `node api/src/migrate.ts --check`를 실행한다.
8. ACA 기본 FQDN의 `GET /auth/signup`이 `open:true`인지 확인한다.
9. Cloudflare 에 `<slug>` CNAME(프록시 없음 — 관리형 인증서가 CNAME 으로 검증한다)과
   `asuid.<slug>` TXT 를 보장한다. 토큰은 Infisical `prod:/` 의 `CLOUDFLARE_DNS_API_TOKEN`
   (Zone.DNS Edit, `relayer.kr` 한정)이다. 같은 값이면 건너뛰고, **다른 값이면 덮지 않고 멈춘다**.
10. `az containerapp hostname add` + `bind --validation-method CNAME` 으로 관리형 인증서를
    붙이고(발급 5~10분) `https://<slug>.relayer.kr/health` 를 확인한 뒤
    `https://<slug>.relayer.kr/#/signup`을 출력한다.

기존 Azure 자원과 Infisical 이름은 skip-if-exists다. 재실행은 값을 갱신하거나 기존
앱 구성을 덮지 않는다. 이미지 교체와 시크릿 회전은 별도 운영 변경이다.

## test2 스테이징

`test2`는 공개 주소 `https://test2.relayer.kr`과 전용 DB 스키마 `relayer_test2`를 쓴다.
2026-09-18 에 APPLY 했다 — DNS·인증서까지 붙어 있고, 첫 관리자·Speech 키·녹음 토글은
마법사로 등록했다. 재실행은 DRY-RUN 으로 계획만 본다:

```bash
PGSCHEMA=relayer_test2 scripts/azure/provision-institution.sh test2
```

프롬프트에 기관 Supabase 세션 풀러 URL을 붙여 넣는다. 출력에는
`relayer2test2`, `relayer2-test2`, `prod:/RELAYER2/test2`,
`BLOB_ACCOUNT=relayer2test2`, `PGSCHEMA=relayer_test2`와 실행 순서만 나타나야 한다.

## 옛 단일 자원

2026-09-18 에 정리했다: placeholder 앱 `relayer2`(MS 샘플 이미지, 실사용 없음)와 빈 Storage
Account `relayer2voice`(두 컨테이너 0건 확인)를 삭제하고 Infisical 의 `AZURE_STORAGE_ACCOUNT_KEY` 를
지웠다. 공용 `relayer2-prod`·`relayer2-env` 는 기관별 앱이 계속 재사용한다. 계정·권한 현황은
`docs/accounts.md` 다.
## 환경 변수

ACA secret reference로 주입하는 값:

- `DATABASE_URL`
- `PII_ENC_KEY`
- `SESSION_SECRET`
- Infisical에 있으면 AI 제공자 관련 선택 값

비밀이 아닌 배포 설정:

- `BLOB_ACCOUNT`: 기관 Storage Account 이름
- `RELAYER_SLUG`: 기관 slug
- `RELAYER_PUBLIC_URL`: 기관 공개 주소
- `PORT=8787`
- `PGSCHEMA`: 스테이징처럼 별도 스키마를 쓸 때만

Speech 키와 녹음 토글은 운영 env로 프로비저닝하지 않는다. 첫 관리자가 마법사에서
기관 소유 Speech 키를 등록하고 녹음 토글을 명시적으로 켠다.

## 자동 검증

```bash
bash scripts/azure/provision-institution.test.sh
```

이 검증은 Azure와 Infisical을 호출하지 않는다. `6543`과 직접 DB 주소 거절,
정상 세션 풀러 계획의 순서, test2 환경 변수, 입력 URL·비밀번호 비노출을 확인하고
`PROVISION_OK`를 출력한다.

APPLY 뒤의 운영 확인은 별도 승인된 창에서 수행한다. `migrate --check`,
`/auth/signup open:true`, 합성 음성 한 건의 실제 전사, 새 Blob이 평문과 다른 암호문인지
확인한다. 진단 출력에는 URL, 키, 본문을 남기지 않는다.
