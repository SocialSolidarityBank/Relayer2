#!/usr/bin/env python3
"""Log Azure CLI in with Infisical SP values without printing or shell history."""

from __future__ import annotations

import os
from pathlib import Path
import subprocess

from deploy import load_env

SP_FIELDS = (
    "AZURE_CLIENT_ID",
    "AZURE_CLIENT_SECRET",
    "AZURE_TENANT_ID",
    "AZURE_SUBSCRIPTION_ID",
)


def run(args: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args,
        text=True,
        capture_output=True,
        check=False,
    )


def main() -> None:
    values = load_env(Path(os.environ.get("ENV_FILE", ".env")), SP_FIELDS)
    login = run(
        [
            "az",
            "login",
            "--service-principal",
            "-u",
            values["AZURE_CLIENT_ID"],
            "-p",
            values["AZURE_CLIENT_SECRET"],
            "--tenant",
            values["AZURE_TENANT_ID"],
            "--output",
            "none",
            "--only-show-errors",
        ]
    )
    if login.returncode != 0:
        raise SystemExit(f"Azure SP 로그인 실패(az exit {login.returncode}); 출력은 보안상 숨김")

    selected = run(
        [
            "az",
            "account",
            "set",
            "--subscription",
            values["AZURE_SUBSCRIPTION_ID"],
        ]
    )
    if selected.returncode != 0:
        raise SystemExit(
            f"Azure 구독 선택 실패(az exit {selected.returncode}); 출력은 보안상 숨김"
        )

    account = run(["az", "account", "show", "--query", "id", "--output", "tsv"])
    if account.returncode != 0 or account.stdout.strip() != values["AZURE_SUBSCRIPTION_ID"]:
        raise SystemExit("Azure SP 로그인 뒤 구독 대조 실패; 식별자 출력은 보안상 숨김")

    print("Azure SP 로그인 완료; Infisical 구독과 일치")


if __name__ == "__main__":
    main()
