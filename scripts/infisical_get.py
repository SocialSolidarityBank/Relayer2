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

# 없으면 그냥 건너뛴다 — **AI 가 없어도 제품은 돈다.**
# 왼쪽이 Infisical 의 이름, 오른쪽이 앱이 읽는 이름이다.
OPTIONAL = {
    "RELAYER2_OPENAI_API_KEY": "OPENAI_API_KEY",
    "GEMINI_API_KEY": "GEMINI_API_KEY",
    "AI_PROVIDER": "AI_PROVIDER",
    "AI_MODEL": "AI_MODEL",
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

    lines = [f"{k}={got[k]}" for k in WANT]
    extra = [dst for src, dst in OPTIONAL.items() if src in got]
    lines += [f"{dst}={got[src]}" for src, dst in OPTIONAL.items() if src in got]
    lines.append(f"PORT={os.environ.get('PORT', '8790')}")
    env = pathlib.Path(".env")
    env.write_text("\n".join(lines) + "\n")
    env.chmod(0o600)
    print(f".env 작성: {' '.join(WANT)} PORT" + (f" + {' '.join(extra)}" if extra else " (AI 키 없음 — AI 정리는 503)"))


main()
