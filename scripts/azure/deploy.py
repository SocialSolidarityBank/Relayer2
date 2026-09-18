#!/usr/bin/env python3
"""Deploy RELAYER2 to Azure Container Apps without putting secret values in argv."""

from __future__ import annotations

import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile

RESOURCE_GROUP = "relayer2-prod"
APP_NAME = "relayer2"
PLACEHOLDER_IMAGE = "mcr.microsoft.com/dotnet/samples:aspnetapp"
IMAGE = os.environ.get("IMAGE", "ghcr.io/socialsolidaritybank/relayer:0.2.0")

# The names on the left are the app's environment variables. ACA secret names must
# be at most 20 characters, hence the shorter names on the right.
REQUIRED_SECRETS = {
    "DATABASE_URL": "database-url",
    "PII_ENC_KEY": "pii-enc-key",
    "SESSION_SECRET": "session-secret",
    "AZURE_STORAGE_ACCOUNT_KEY": "azure-storage-key",
}
OPTIONAL_SECRETS = {
    "OPENAI_API_KEY": "openai-api-key",
    "GEMINI_API_KEY": "gemini-api-key",
    "AZURE_SPEECH_KEY": "azure-speech-key",
}
OPTIONAL_ENV = (
    "AI_PROVIDER",
    "AI_MODEL",
    "AZURE_SPEECH_ENDPOINT",
    "AZURE_SPEECH_REGION",
    "VOICE_ENABLED",
    "RELAYER_SLUG",
    "RELAYER_PUBLIC_URL",
)


def load_env(
    path: Path, required: tuple[str, ...] = tuple(REQUIRED_SECRETS)
) -> dict[str, str]:
    if path.is_symlink():
        raise SystemExit(f"심볼릭 링크인 env 파일은 거절한다: {path}")
    info = path.stat()
    if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077:
        raise SystemExit(f"env 파일은 일반 파일·권한 0600이어야 한다: {path}")

    values: dict[str, str] = {}
    for number, raw in enumerate(path.read_text().splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            raise SystemExit(f"env 파일 {number}행 형식 오류")
        name, value = line.split("=", 1)
        values[name] = value
    missing = [name for name in required if not values.get(name)]
    if missing:
        raise SystemExit(f"env 파일에 필수 이름 없음: {', '.join(missing)}")
    return values


def deployment(values: dict[str, str]) -> dict[str, object]:
    secret_names = {**REQUIRED_SECRETS, **OPTIONAL_SECRETS}
    secrets = [
        {"name": secret_names[name], "value": values[name]}
        for name in secret_names
        if values.get(name)
    ]
    environment = [
        {"name": name, "secretRef": secret_names[name]}
        for name in secret_names
        if values.get(name)
    ]
    environment.extend(
        {"name": name, "value": values[name]}
        for name in OPTIONAL_ENV
        if values.get(name)
    )
    environment.extend(
        [
            {"name": "PORT", "value": "8787"},
            {"name": "STORAGE_BACKEND", "value": "blob"},
            {"name": "AZURE_STORAGE_ACCOUNT", "value": "relayer2voice"},
        ]
    )
    if IMAGE == PLACEHOLDER_IMAGE:
        environment.append({"name": "ASPNETCORE_HTTP_PORTS", "value": "8787"})
    return {
        "properties": {
            "configuration": {"secrets": secrets},
            "template": {
                "containers": [
                    {
                        "name": APP_NAME,
                        "image": IMAGE,
                        "resources": {"cpu": 0.25, "memory": "0.5Gi"},
                        "env": environment,
                    }
                ],
                "scale": {"minReplicas": 1, "maxReplicas": 1},
            },
        }
    }


def main() -> None:
    if os.environ.get("PLANNER_GO") != "GO":
        raise SystemExit("배포 차단: 플래너 GO 뒤 PLANNER_GO=GO를 지정한다")

    env_file = Path(os.environ.get("ENV_FILE", ".env"))
    values = load_env(env_file)
    spec = deployment(values)
    descriptor, temporary_name = tempfile.mkstemp(prefix="relayer2-aca-", suffix=".json")
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "w") as temporary:
            json.dump(spec, temporary, ensure_ascii=False)
        result = subprocess.run(
            [
                "az",
                "containerapp",
                "update",
                "--name",
                APP_NAME,
                "--resource-group",
                RESOURCE_GROUP,
                "--yaml",
                temporary_name,
                "--output",
                "none",
            ],
            text=True,
            capture_output=True,
            check=False,
        )
        if result.returncode != 0:
            raise SystemExit(
                f"Azure 배포 실패(az exit {result.returncode}); 출력은 보안상 숨김"
            )
    finally:
        Path(temporary_name).unlink(missing_ok=True)

    print(
        f"Container App 배포 요청 완료: image={IMAGE}, "
        f"secrets={len(spec['properties']['configuration']['secrets'])}개"
    )


if __name__ == "__main__":
    main()
