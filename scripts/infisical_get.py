"""Infisical의 기관 경로에서 값을 받아 현재 디렉터리의 `.env`(0600)로 쓴다.

읽기는 Machine Identity `ggbss-agent` universal-auth로 한다. 값은 출력하지 않는다.
"""
import argparse
import json
import os
import pathlib
import urllib.error
import urllib.parse
import urllib.request

API = "https://app.infisical.com/api"

# 없으면 배포를 멈춘다.
WANT = ("DATABASE_URL", "PII_ENC_KEY", "SESSION_SECRET")

# AI가 없어도 제품은 돈다. 왼쪽은 Infisical 이름, 오른쪽은 앱 환경 변수 이름이다.
OPTIONAL = {
    "RELAYER_OPENAI_API_KEY": "OPENAI_API_KEY",
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
    parser = argparse.ArgumentParser()
    parser.add_argument("secret_path", help="Infisical 경로. 예: /RELAYER2/test2")
    args = parser.parse_args()
    if not args.secret_path.startswith("/"):
        raise SystemExit("경로는 /로 시작해야 합니다.")

    token = login()
    query = urllib.parse.urlencode(
        {
            "workspaceId": os.environ["PROJECT_ID"],
            "environment": "prod",
            "secretPath": args.secret_path,
        }
    )
    req = urllib.request.Request(
        f"{API}/v3/secrets/raw?{query}", headers={"authorization": f"Bearer {token}"}
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            payload = json.loads(res.read())
    except urllib.error.HTTPError as error:
        raise SystemExit(f"읽기 실패 HTTP {error.code}")

    got = {item["secretKey"]: item["secretValue"] for item in payload.get("secrets", [])}
    missing = [name for name in WANT if name not in got]
    if missing:
        raise SystemExit(f"없는 값: {', '.join(missing)}")

    env = pathlib.Path(".env")
    previous = set()
    if env.exists():
        previous = {
            line.split("=", 1)[0]
            for line in env.read_text().splitlines()
            if "=" in line
        }
    vanished = [
        destination
        for source, destination in OPTIONAL.items()
        if destination in previous and source not in got
    ]

    lines = [f"{name}={got[name]}" for name in WANT]
    extra = [destination for source, destination in OPTIONAL.items() if source in got]
    lines += [
        f"{destination}={got[source]}"
        for source, destination in OPTIONAL.items()
        if source in got
    ]
    lines.append(f"PORT={os.environ.get('PORT', '8790')}")
    env.write_text("\n".join(lines) + "\n")
    env.chmod(0o600)
    print(
        f".env 작성: {' '.join(WANT)} PORT"
        + (f" + {' '.join(extra)}" if extra else " (AI 키 없음 — AI 정리는 503)")
    )
    for name in vanished:
        print(
            f"경고: 직전 .env 에 있던 {name}가 Infisical 응답에 없습니다.\n"
            "      이름이 바뀌었거나 다른 폴더로 옮겨졌을 수 있습니다. AI 정리는 503이 됩니다."
        )


if __name__ == "__main__":
    main()
