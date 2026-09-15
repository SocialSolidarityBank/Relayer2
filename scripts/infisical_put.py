"""Infisical 에 시크릿을 올린다. 값은 환경변수와 메모리에만 있고 출력하지 않는다.

절차 근거: ~/developer/tools/portwright/services/infisical.md
 (project access token 은 read 전용 → Machine Identity universal-auth 로 로그인해 쓴다)
출력은 이름과 HTTP 상태뿐이다.
"""
import json
import os
import urllib.error
import urllib.request

API = "https://app.infisical.com/api"


def post(path: str, body: dict, token: str | None = None) -> tuple[int, dict]:
    req = urllib.request.Request(
        f"{API}{path}",
        data=json.dumps(body).encode(),
        headers={"content-type": "application/json", **({"authorization": f"Bearer {token}"} if token else {})},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return res.status, json.loads(res.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def main() -> None:
    status, auth = post(
        "/v1/auth/universal-auth/login",
        {"clientId": os.environ["CLIENT_ID"], "clientSecret": os.environ["CLIENT_SECRET"]},
    )
    if status != 200:
        raise SystemExit(f"  로그인 실패 HTTP {status}")
    token = auth["accessToken"]
    print("  로그인 HTTP 200")

    project_id = os.environ["PROJECT_ID"]
    secret_path = os.environ["SECRET_PATH"]

    code, _ = post(
        "/v1/folders",
        {"workspaceId": project_id, "environment": "prod", "name": secret_path.lstrip("/"), "path": "/"},
        token,
    )
    print(f"  폴더 {secret_path}: HTTP {code}" + (" (이미 있음)" if code == 400 else ""))

    for line in open(os.environ["ENV_FILE"]):
        line = line.strip()
        if not line or "=" not in line:
            continue
        name, value = line.split("=", 1)
        body = {
            "projectId": project_id,
            "environment": "prod",
            "secretPath": secret_path,
            "secretValue": value,
            "type": "shared",
        }
        code, _ = post(f"/v4/secrets/{name}", body, token)
        if code >= 400:  # 이미 있으면 갱신
            req = urllib.request.Request(
                f"{API}/v4/secrets/{name}",
                data=json.dumps(body).encode(),
                headers={"content-type": "application/json", "authorization": f"Bearer {token}"},
                method="PATCH",
            )
            try:
                with urllib.request.urlopen(req, timeout=30) as res:
                    code = res.status
            except urllib.error.HTTPError as e:
                code = e.code
        print(f"  {name}: HTTP {code}")


main()
