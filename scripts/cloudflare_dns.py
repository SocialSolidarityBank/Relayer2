"""기관 공개 주소의 DNS 레코드를 Cloudflare 에 보장한다.

    python3 scripts/cloudflare_dns.py <host> <cname-target> <asuid-verification-id>

토큰은 Infisical `prod:/` 의 `CLOUDFLARE_DNS_API_TOKEN`(Zone.DNS Edit, relayer.kr 한정) 을
메모리로만 받는다. 레코드 둘을 만든다 — 둘 다 프록시 없음(ACA 관리형 인증서가 CNAME 으로 검증한다):

    CNAME <host>        -> <cname-target>   (proxied=false)
    TXT   asuid.<host>  -> <verification-id>

같은 값이 이미 있으면 건너뛰고, **다른 값이 있으면 덮지 않고 멈춘다** — 옛 기관 주소를 조용히
가로채지 않기 위해서다. 출력에 토큰은 실리지 않는다.
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

from infisical_get import API, login

CF = "https://api.cloudflare.com/client/v4"


def dns_token() -> str:
    token = login()
    query = urllib.parse.urlencode(
        {"workspaceId": os.environ["PROJECT_ID"], "environment": "prod", "secretPath": "/"}
    )
    req = urllib.request.Request(f"{API}/v3/secrets/raw?{query}", headers={"authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, timeout=30) as res:
        secrets = {s["secretKey"]: s["secretValue"] for s in json.loads(res.read())["secrets"]}
    value = secrets.get("CLOUDFLARE_DNS_API_TOKEN")
    if not value:
        raise SystemExit("오류: Infisical prod:/ 에 CLOUDFLARE_DNS_API_TOKEN 이 없습니다.")
    return value


def cf(token: str, method: str, path: str, body: dict | None = None) -> dict:
    req = urllib.request.Request(
        CF + path,
        data=json.dumps(body).encode() if body is not None else None,
        method=method,
        headers={"authorization": f"Bearer {token}", "content-type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            payload = json.loads(res.read())
    except urllib.error.HTTPError as error:
        payload = json.loads(error.read())
    if not payload.get("success"):
        messages = "; ".join(e.get("message", "?") for e in payload.get("errors", []))
        raise SystemExit(f"오류: Cloudflare {method} {path}: {messages}")
    return payload["result"]


def ensure(token: str, zone_id: str, record: dict) -> None:
    label = f"{record['type']} {record['name']}"
    query = urllib.parse.urlencode({"type": record["type"], "name": record["name"]})
    existing = cf(token, "GET", f"/zones/{zone_id}/dns_records?{query}")
    if not existing:
        cf(token, "POST", f"/zones/{zone_id}/dns_records", record)
        print(f"  생성: {label}")
        return
    current = existing[0]
    same_content = current["content"].strip('"') == record["content"]
    same_proxy = record["type"] != "CNAME" or current.get("proxied") is False
    if same_content and same_proxy:
        print(f"  있음: {label}")
        return
    raise SystemExit(
        f"오류: {label} 가 다른 값으로 이미 있습니다. 옛 기관 주소일 수 있어 덮지 않습니다 — 수동으로 확인하세요."
    )


def main() -> None:
    if len(sys.argv) != 4:
        raise SystemExit("사용법: cloudflare_dns.py <host> <cname-target> <asuid-verification-id>")
    host, target, verification = sys.argv[1:]
    zone_name = host.split(".", 1)[1]
    token = dns_token()
    zones = cf(token, "GET", f"/zones?{urllib.parse.urlencode({'name': zone_name})}")
    if not zones:
        raise SystemExit(f"오류: 이 토큰으로 보이는 zone 에 {zone_name} 이 없습니다.")
    zone_id = zones[0]["id"]
    ensure(token, zone_id, {"type": "CNAME", "name": host, "content": target, "proxied": False, "ttl": 1})
    ensure(token, zone_id, {"type": "TXT", "name": f"asuid.{host}", "content": verification, "ttl": 1})


if __name__ == "__main__":
    main()
