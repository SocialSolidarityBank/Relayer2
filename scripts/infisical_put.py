"""Infisical에 시크릿을 올린다. 값은 환경변수와 메모리에만 있고 출력하지 않는다.

쓰기 자격은 Machine Identity universal-auth로 받는다. 출력은 경로·이름·HTTP 상태뿐이다.
"""
import argparse
import json
import os
import urllib.error
import urllib.parse
import urllib.request

API = "https://app.infisical.com/api"


def request(
    method: str,
    path: str,
    body: dict | None = None,
    token: str | None = None,
) -> tuple[int, dict]:
    req = urllib.request.Request(
        f"{API}{path}",
        data=json.dumps(body).encode() if body is not None else None,
        headers={
            "content-type": "application/json",
            **({"authorization": f"Bearer {token}"} if token else {}),
        },
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return res.status, json.loads(res.read() or b"{}")
    except urllib.error.HTTPError as error:
        raw = error.read()
        try:
            payload = json.loads(raw or b"{}")
        except json.JSONDecodeError:
            payload = {}
        return error.code, payload


def normalized_path(raw: str) -> str:
    parts = [part for part in raw.split("/") if part]
    if not parts or raw != f"/{'/'.join(parts)}":
        raise SystemExit("SECRET_PATH는 /RELAYER2/<slug> 형식이어야 합니다.")
    return f"/{'/'.join(parts)}"


def ensure_folders(project_id: str, secret_path: str, token: str) -> None:
    parent = "/"
    for name in secret_path.lstrip("/").split("/"):
        code, _ = request(
            "POST",
            "/v1/folders",
            {
                "workspaceId": project_id,
                "environment": "prod",
                "name": name,
                "path": parent,
            },
            token,
        )
        current = f"{parent.rstrip('/')}/{name}"
        if code in (200, 201):
            print(f"  폴더 {current}: HTTP {code}")
        elif code in (400, 409):
            print(f"  폴더 {current}: 건너뜀 (이미 있음)")
        else:
            raise SystemExit(f"  폴더 {current}: HTTP {code}")
        parent = current


def read_existing_names(project_id: str, secret_path: str, token: str) -> set[str]:
    query = urllib.parse.urlencode(
        {
            "workspaceId": project_id,
            "environment": "prod",
            "secretPath": secret_path,
        }
    )
    code, payload = request("GET", f"/v3/secrets/raw?{query}", token=token)
    if code != 200:
        raise SystemExit(f"  기존 시크릿 확인 실패 HTTP {code}")
    return {item["secretKey"] for item in payload.get("secrets", [])}


def read_env_file(path: str) -> list[tuple[str, str]]:
    secrets: list[tuple[str, str]] = []
    with open(path, encoding="utf-8") as env_file:
        for raw_line in env_file:
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            secrets.append(tuple(line.split("=", 1)))
    return secrets


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--skip-if-exists",
        action="store_true",
        help="이미 있는 시크릿은 값을 읽거나 덮지 않고 이름만 보고한다.",
    )
    args = parser.parse_args()

    status, auth = request(
        "POST",
        "/v1/auth/universal-auth/login",
        {"clientId": os.environ["CLIENT_ID"], "clientSecret": os.environ["CLIENT_SECRET"]},
    )
    if status != 200:
        raise SystemExit(f"  로그인 실패 HTTP {status}")
    token = auth["accessToken"]
    print("  로그인 HTTP 200")

    project_id = os.environ["PROJECT_ID"]
    secret_path = normalized_path(os.environ["SECRET_PATH"])
    ensure_folders(project_id, secret_path, token)
    existing = read_existing_names(project_id, secret_path, token) if args.skip_if_exists else set()

    for name, value in read_env_file(os.environ["ENV_FILE"]):
        if name in existing:
            print(f"  {name}: 건너뜀 (이미 있음)")
            continue

        body = {
            "projectId": project_id,
            "environment": "prod",
            "secretPath": secret_path,
            "secretValue": value,
            "type": "shared",
        }
        encoded_name = urllib.parse.quote(name, safe="")
        code, _ = request("POST", f"/v4/secrets/{encoded_name}", body, token)
        if args.skip_if_exists and code in (400, 409):
            print(f"  {name}: 건너뜀 (이미 있음)")
            continue
        if code >= 400:
            code, _ = request("PATCH", f"/v4/secrets/{encoded_name}", body, token)
        if code >= 400:
            raise SystemExit(f"  {name}: HTTP {code}")
        print(f"  {name}: HTTP {code}")


if __name__ == "__main__":
    main()
