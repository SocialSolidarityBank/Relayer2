"""Infisical 에서 값을 받아 `.env` 로 쓴다. 값은 출력하지 않는다.

읽기는 **Machine Identity `ggbss-agent`** 로 한다(universal-auth).
`ggbss_project_access_token` 은 서비스 토큰이라 스코프가 루트 `/` 뿐이고
`/RELAYER2` 같은 하위 경로를 읽지 못한다(2026-09-15 실측: 주입 0건). 쓰지 않는다.
"""
import json
import os
import pathlib
import urllib.error
import urllib.parse
import urllib.request

API = "https://app.infisical.com/api"

# 없으면 배포를 멈춘다.
WANT = ("DATABASE_URL", "PII_ENC_KEY", "SESSION_SECRET")

# 없는 이름은 건너뛴다. 각 소비자(deploy.py·azure/login.py)가 자기 필수 이름을 검사한다.
# 왼쪽이 Infisical 이름, 오른쪽이 로컬 env 이름이다.
OPTIONAL = {
    "RELAYER_OPENAI_API_KEY": "OPENAI_API_KEY",
    "GEMINI_API_KEY": "GEMINI_API_KEY",
    "AI_PROVIDER": "AI_PROVIDER",
    "AI_MODEL": "AI_MODEL",
    "AZURE_SPEECH_KEY": "AZURE_SPEECH_KEY",
    "AZURE_SPEECH_ENDPOINT": "AZURE_SPEECH_ENDPOINT",
    "AZURE_SPEECH_REGION": "AZURE_SPEECH_REGION",
    "VOICE_ENABLED": "VOICE_ENABLED",
    "AZURE_STORAGE_ACCOUNT_KEY": "AZURE_STORAGE_ACCOUNT_KEY",
    "AZURE_CLIENT_ID": "AZURE_CLIENT_ID",
    "AZURE_CLIENT_SECRET": "AZURE_CLIENT_SECRET",
    "AZURE_TENANT_ID": "AZURE_TENANT_ID",
    "AZURE_SUBSCRIPTION_ID": "AZURE_SUBSCRIPTION_ID",
    "RELAYER_SLUG": "RELAYER_SLUG",
    "RELAYER_PUBLIC_URL": "RELAYER_PUBLIC_URL",
    "VOICE_ROOT": "VOICE_ROOT",
}


def login() -> str:
    body = json.dumps(
        {"clientId": os.environ["CLIENT_ID"], "clientSecret": os.environ["CLIENT_SECRET"]}
    ).encode()
    req = urllib.request.Request(
        f"{API}/v1/auth/universal-auth/login",
        data=body,
        headers={"content-type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as res:
        return json.loads(res.read())["accessToken"]


def main() -> None:
    token = login()
    query = urllib.parse.urlencode(
        {
            "workspaceId": os.environ["PROJECT_ID"],
            "environment": "prod",
            "secretPath": os.environ["SECRET_PATH"],
        }
    )
    req = urllib.request.Request(
        f"{API}/v3/secrets/raw?{query}", headers={"authorization": f"Bearer {token}"}
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            payload = json.loads(res.read())
    except urllib.error.HTTPError as e:
        raise SystemExit(f"읽기 실패 HTTP {e.code}")

    got = {s["secretKey"]: s["secretValue"] for s in payload.get("secrets", [])}
    missing = [k for k in WANT if k not in got]
    if missing:
        raise SystemExit(f"없는 값: {', '.join(missing)}")

    # 직전 .env 에 있던 선택 키가 이번 응답에 없으면 조용히 빠지는 게 아니라
    # Infisical 쪽에서 개명·이동된 것이다. 이름만 비교한다 — 값은 보지 않는다.
    env = pathlib.Path(".env")
    prev = set()
    if env.exists():
        prev = {line.split("=", 1)[0] for line in env.read_text().splitlines() if "=" in line}
    vanished = [dst for src, dst in OPTIONAL.items() if dst in prev and src not in got]

    lines = [f"{k}={got[k]}" for k in WANT]
    extra = [dst for src, dst in OPTIONAL.items() if src in got]
    lines += [f"{dst}={got[src]}" for src, dst in OPTIONAL.items() if src in got]
    lines.append(f"PORT={os.environ.get('PORT', '8790')}")
    env.write_text("\n".join(lines) + "\n")
    env.chmod(0o600)
    print(f".env 작성: {' '.join(WANT)} PORT" + (f" + {' '.join(extra)}" if extra else " (AI 키 없음 — AI 정리는 503)"))
    for name in vanished:
        print(f"경고: 직전 .env 에 있던 {name} 가 Infisical 응답에 없습니다.\n"
              "      이름이 바뀌었거나 다른 폴더로 옮겨졌을 수 있어 해당 기능·배포를 중단해야 합니다.")


main()
