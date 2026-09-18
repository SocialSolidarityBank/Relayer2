import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const SCRIPT = join(ROOT, 'scripts/azure/provision.sh');
const DEPLOY_SCRIPT = join(ROOT, 'scripts/azure/deploy.py');
const LOGIN_SCRIPT = join(ROOT, 'scripts/azure/login.py');

function fakeAzure() {
  const dir = mkdtempSync(join(tmpdir(), 'relayer-azure-test-'));
  const log = join(dir, 'az.log');
  writeFileSync(log, '');
  const executable = join(dir, 'az');
  writeFileSync(
    executable,
    `#!/bin/sh\nprintf '%s\\n' "$*" >> "$AZ_TEST_LOG"\nif [ "$1 $2" = "account show" ]; then\n  printf '%s\\n' "\${AZ_ACCOUNT_TYPE:-servicePrincipal}"\n  exit 0\nfi\nexit 99\n`,
  );
  chmodSync(executable, 0o700);
  return { dir, log };
}

function runProvision(extraEnv: NodeJS.ProcessEnv = {}) {
  const fake = fakeAzure();
  const result = spawnSync('bash', [SCRIPT], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fake.dir}:${process.env.PATH}`,
      AZ_TEST_LOG: fake.log,
      ...extraEnv,
    },
  });
  const calls = readFileSync(fake.log, 'utf8');
  return { ...result, calls };
}
function runDeploy(extraEnv: NodeJS.ProcessEnv = {}, envMode = 0o600) {
  const dir = mkdtempSync(join(tmpdir(), 'relayer-azure-deploy-test-'));
  const envFile = join(dir, '.env');
  const azLog = join(dir, 'az.log');
  const specLog = join(dir, 'spec.json');
  const yamlPathLog = join(dir, 'yaml-path.log');
  const executable = join(dir, 'az');
  writeFileSync(
    envFile,
    [
      'DATABASE_URL=postgres://example.invalid/relayer',
      'PII_ENC_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      'SESSION_SECRET=session-test-secret',
      'AZURE_STORAGE_ACCOUNT_KEY=storage-test-secret',
      'VOICE_ENABLED=1',
      'AZURE_SPEECH_REGION=koreacentral',
    ].join('\n') + '\n',
    { mode: envMode },
  );
  writeFileSync(azLog, '');
  writeFileSync(
    executable,
    `#!/bin/sh\nprintf '%s\\n' "$*" > "$AZ_TEST_LOG"\nprevious=\nfor arg in "$@"; do\n  if [ "$previous" = "--yaml" ]; then\n    cp "$arg" "$AZ_SPEC_LOG"\n    printf '%s\\n' "$arg" > "$AZ_YAML_PATH_LOG"\n  fi\n  previous="$arg"\ndone\nif [ "\${AZ_FAIL:-0}" = "1" ]; then\n  printf '%s\\n' 'storage-test-secret' >&2\n  exit 7\nfi\n`,
  );
  chmodSync(executable, 0o700);
  const result = spawnSync('python3', [DEPLOY_SCRIPT], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      ENV_FILE: envFile,
      PLANNER_GO: 'GO',
      AZ_TEST_LOG: azLog,
      AZ_SPEC_LOG: specLog,
      AZ_YAML_PATH_LOG: yamlPathLog,
      ...extraEnv,
    },
  });
  return { result, azLog, specLog, yamlPathLog };
}
function runLogin() {
  const dir = mkdtempSync(join(tmpdir(), 'relayer-azure-login-test-'));
  const envFile = join(dir, '.env');
  const argvLog = join(dir, 'argv.log');
  const executable = join(dir, 'az');
  writeFileSync(
    envFile,
    [
      'AZURE_CLIENT_ID=client-id-test-value',
      'AZURE_CLIENT_SECRET=client-secret-test-value',
      'AZURE_TENANT_ID=tenant-id-test-value',
      'AZURE_SUBSCRIPTION_ID=subscription-id-test-value',
    ].join('\n') + '\n',
    { mode: 0o600 },
  );
  writeFileSync(
    executable,
    `#!/bin/sh\nif [ "$1" = "login" ]; then\n  found=0\n  while [ "$#" -gt 0 ]; do\n    if [ "$1" = "-p" ]; then\n      shift\n      [ "$1" = "client-secret-test-value" ] && found=1\n    fi\n    shift\n  done\n  [ "$found" = "1" ] || exit 98\n  printf '%s\\n' 'login -p <redacted>' >> "$AZ_ARGV_LOG"\n  exit 0\nfi\nif [ "$1 $2" = "account set" ]; then\n  printf '%s\\n' 'account set --subscription <redacted>' >> "$AZ_ARGV_LOG"\n  exit 0\nfi\nif [ "$1 $2" = "account show" ]; then\n  printf '%s\\n' 'account show --query id --output tsv' >> "$AZ_ARGV_LOG"\n  printf '%s\\n' 'subscription-id-test-value'\n  exit 0\nfi\nexit 99\n`,
  );
  chmodSync(executable, 0o700);
  const result = spawnSync('python3', [LOGIN_SCRIPT], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      ENV_FILE: envFile,
      AZ_ARGV_LOG: argvLog,
    },
  });
  return { result, argvLog };
}

describe('Azure 프로비저닝 안전 계약', () => {
  it('dry-run은 생성 호출 없이 전체 koreacentral 계획을 출력한다', () => {
    const result = runProvision({ APPLY: '0' });

    expect(result.status).toBe(0);
    expect(result.calls.trim()).toBe('account show --query user.type --output tsv');
    expect(result.stdout).toContain('az group create --name relayer2-prod --location koreacentral');
    expect(result.stdout).toContain('az monitor log-analytics workspace create');
    expect(result.stdout).toContain('--min-tls-version TLS1_2');
    expect(result.stdout).toContain('--allow-blob-public-access false');
    expect(result.stdout).toContain('az storage container-rm create --name voice');
    expect(result.stdout).toContain('az storage container-rm create --name documents');
    expect(result.stdout).toContain('az containerapp env create');
    expect(result.stdout).toContain('--logs-destination log-analytics');
    expect(result.stdout).toContain('--logs-workspace-key');
    expect(result.stdout).toContain('mcr.microsoft.com/dotnet/samples:aspnetapp');
    expect(result.stdout).toContain('ASPNETCORE_HTTP_PORTS=8787');
    expect(result.stdout).toContain('--min-replicas 1 --max-replicas 1');
  });

  it('서비스 프린시펄이 아닌 Azure 세션은 거절한다', () => {
    const result = runProvision({ APPLY: '0', AZ_ACCOUNT_TYPE: 'user' });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('servicePrincipal');
  });

  it('APPLY만으로는 자원을 만들지 않고 플래너 GO를 요구한다', () => {
    const result = runProvision({ APPLY: '1' });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('PLANNER_GO=GO');
    expect(result.calls).toBe('');
  });
});
describe('Azure 서비스 프린시펄 로그인 안전 계약', () => {
  it('스크립트에서 -p 로그인하고 구독을 설정·대조하며 값을 출력하지 않는다', () => {
    const run = runLogin();

    expect(run.result.status).toBe(0);
    const argv = readFileSync(run.argvLog, 'utf8');
    expect(argv).toContain('login -p <redacted>');
    expect(argv).toContain('account set --subscription <redacted>');
    expect(`${run.result.stdout}${run.result.stderr}`).not.toContain('client-secret-test-value');
    expect(`${run.result.stdout}${run.result.stderr}`).not.toContain('client-id-test-value');
    expect(`${run.result.stdout}${run.result.stderr}`).not.toContain('subscription-id-test-value');
  });
});

describe('Azure 시크릿 배포 안전 계약', () => {
  it('값을 argv에 싣지 않고 0600 임시 YAML로 secretRef를 배포한다', () => {
    const run = runDeploy({ IMAGE: 'mcr.microsoft.com/dotnet/samples:aspnetapp' });

    expect(run.result.status).toBe(0);
    const argv = readFileSync(run.azLog, 'utf8');
    expect(argv).toContain('containerapp update --name relayer2 --resource-group relayer2-prod --yaml');
    expect(argv).not.toContain('session-test-secret');
    expect(argv).not.toContain('storage-test-secret');

    const spec = JSON.parse(readFileSync(run.specLog, 'utf8'));
    expect(spec.properties.configuration).not.toHaveProperty('ingress');
    expect(spec.properties.configuration.secrets).toContainEqual({
      name: 'database-url',
      value: 'postgres://example.invalid/relayer',
    });
    expect(spec.properties.configuration.secrets).toContainEqual({
      name: 'azure-storage-key',
      value: 'storage-test-secret',
    });
    expect(spec.properties.template.containers[0].env).toContainEqual({
      name: 'DATABASE_URL',
      secretRef: 'database-url',
    });
    expect(spec.properties.template.containers[0].image).toBe(
      'mcr.microsoft.com/dotnet/samples:aspnetapp',
    );
    expect(spec.properties.template.containers[0].env).toContainEqual({
      name: 'ASPNETCORE_HTTP_PORTS',
      value: '8787',
    });
    expect(spec.properties.template.scale).toEqual({ minReplicas: 1, maxReplicas: 1 });
    const temporaryYaml = readFileSync(run.yamlPathLog, 'utf8').trim();
    expect(existsSync(temporaryYaml)).toBe(false);
  });

  it('Azure CLI 실패 출력에 값이 있어도 밖으로 내지 않는다', () => {
    const run = runDeploy({ AZ_FAIL: '1' });

    expect(run.result.status).not.toBe(0);
    expect(`${run.result.stdout}${run.result.stderr}`).not.toContain('storage-test-secret');
    expect(`${run.result.stdout}${run.result.stderr}`).toContain('Azure 배포 실패');
  });

  it('PLANNER_GO 없이는 Azure CLI를 호출하지 않는다', () => {
    const run = runDeploy({ PLANNER_GO: '' });

    expect(run.result.status).not.toBe(0);
    expect(readFileSync(run.azLog, 'utf8')).toBe('');
    expect(`${run.result.stdout}${run.result.stderr}`).toContain('PLANNER_GO=GO');
  });

  it('group/world-readable env 파일을 거절한다', () => {
    const run = runDeploy({}, 0o644);

    expect(run.result.status).not.toBe(0);
    expect(readFileSync(run.azLog, 'utf8')).toBe('');
    expect(`${run.result.stdout}${run.result.stderr}`).toContain('0600');
  });
});
