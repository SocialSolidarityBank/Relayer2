#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { chmod, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEFAULT_CASES = ['C02', 'C08', 'C01', 'C10', 'C03'];
export const STAFF = [
  { email: 'curated.park', name: '박지연' },
  { email: 'curated.lee', name: '이도현' },
  { email: 'curated.choi', name: '최은정' },
];
const CONSENTS = [
  'personal_data_collection_use',
  'sensitive_information_processing',
  'counseling_recording',
  'external_stt_processing',
  'external_llm_cross_border_processing',
  'voice_original_retention_period',
  'document_attachment',
];
const USER_AGENT = 'relayer-curated-dataset/0.2.1';
const DEFAULT_RECEIPT = '.relayer-dataset-receipt.json';

const usage = `사용법:
  RELAYER_PASSWORD=... RELAYER_STAFF_PASSWORD=... node scripts/load-dataset.mjs \\
    --base <dataset-url> --cases C02,C08,C01,C10,C03 \\
    --api <relayer-url> --login test1/RELAYER_PASSWORD

--login 의 슬래시 뒤에는 비밀번호 값이 아니라 환경 변수 이름을 적습니다.
원격 API는 플래너 GO 뒤 RELAYER_DATASET_ALLOW_REMOTE=1을 함께 설정해야 합니다.`;

const take = (args, index, name) => {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} 값 필요`);
  return value;
};

export function parseArgs(args, env = process.env) {
  let base;
  let api;
  let cases;
  let loginSpec;
  let receiptPath = DEFAULT_RECEIPT;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--base') base = take(args, i++, '--base');
    else if (arg === '--api') api = take(args, i++, '--api');
    else if (arg === '--cases') cases = take(args, i++, '--cases');
    else if (arg === '--login') loginSpec = take(args, i++, '--login');
    else if (arg === '--receipt') receiptPath = take(args, i++, '--receipt');
    else if (arg === '--help' || arg === '-h') return { help: true };
    else throw new Error(`알 수 없는 인자: ${arg}`);
  }
  if (!base || !api || !loginSpec) throw new Error('--base, --api, --login 필요');
  const slash = loginSpec.indexOf('/');
  if (slash <= 0 || slash === loginSpec.length - 1) {
    throw new Error('--login 형식은 아이디/환경변수이름');
  }
  const login = loginSpec.slice(0, slash);
  const passwordEnv = loginSpec.slice(slash + 1);
  if (!/^[A-Z_][A-Z0-9_]*$/.test(passwordEnv)) {
    throw new Error('--login 슬래시 뒤에는 비밀번호 값이 아닌 환경 변수 이름 필요');
  }
  const password = env[passwordEnv];
  if (!password) throw new Error(`${passwordEnv} 환경 변수 필요`);
  const staffPassword = env.RELAYER_STAFF_PASSWORD;
  if (!staffPassword) throw new Error('RELAYER_STAFF_PASSWORD 환경 변수 필요');
  const caseIds = cases ? cases.split(',').map((id) => id.trim()).filter(Boolean) : [...DEFAULT_CASES];
  if (caseIds.length === 0 || new Set(caseIds).size !== caseIds.length) throw new Error('--cases 중복 또는 빈 값');
  const apiUrl = new URL(api);
  if (!['http:', 'https:'].includes(apiUrl.protocol)) throw new Error('--api 는 http(s) URL 필요');
  if (!['127.0.0.1', 'localhost', '::1'].includes(apiUrl.hostname) && env.RELAYER_DATASET_ALLOW_REMOTE !== '1') {
    throw new Error('원격 API 차단됨, 플래너 GO 뒤 RELAYER_DATASET_ALLOW_REMOTE=1 필요');
  }
  return {
    base: base.replace(/\/$/, ''),
    api: api.replace(/\/$/, ''),
    caseIds,
    login,
    password,
    staffPassword,
    receiptPath: resolve(receiptPath),
  };
}

export function statsForCases(manifest, caseIds) {
  const byId = new Map(manifest.cases.map((entry) => [entry.id, entry]));
  return caseIds.reduce(
    (totals, id) => {
      const entry = byId.get(id);
      if (!entry) throw new Error(`manifest 사례 없음: ${id}`);
      totals.cases += 1;
      totals.sessions += entry.sessions.length;
      totals.recordings += entry.sessions.filter((session) => session.audio).length;
      totals.notes += entry.sessions.filter((session) => session.note).length;
      totals.audioBytes += entry.sessions.reduce((sum, session) => sum + (session.audio?.bytes ?? 0), 0);
      return totals;
    },
    { cases: 0, sessions: 0, recordings: 0, notes: 0, audioBytes: 0 },
  );
}

export function transcriptFromDialogue(dialogue, speakers = {}) {
  if (!Array.isArray(dialogue?.turns)) throw new Error('dialogue.turns 형식 오류');
  return dialogue.turns
    .filter((turn) => String(turn.t ?? '').trim())
    .map((turn) => `${speakers[turn.s] ?? turn.s}: ${String(turn.t ?? '').trim()}`)
    .join('\n');
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export async function fetchDatasetResource(url, kind, asset) {
  const response = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
  if (!response.ok) throw new Error(`dataset GET 실패 ${response.status}: ${url}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (asset?.sha256 && sha256(bytes) !== asset.sha256) throw new Error(`dataset sha256 불일치: ${url}`);
  if (kind === 'bytes') return bytes;
  const text = new TextDecoder().decode(bytes);
  return kind === 'text' ? text : JSON.parse(text);
}

class Api {
  constructor(base) {
    this.base = base;
    this.cookie = '';
  }

  async request(method, path, body, contentType = 'application/json') {
    const headers = { 'content-type': contentType };
    if (this.cookie) headers.cookie = this.cookie;
    const response = await fetch(`${this.base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : contentType === 'application/json' ? JSON.stringify(body) : body,
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0];
    const text = await response.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch { data = text; }
    }
    if (!response.ok) {
      const message = typeof data === 'object' && data?.error ? data.error : `HTTP ${response.status}`;
      throw new Error(`${method} ${path}: ${message}`);
    }
    return data;
  }

  login(email, password) { return this.request('POST', '/auth/login', { email, password }); }
  me() { return this.request('GET', '/me'); }
  speechStatus() { return this.request('GET', '/speech/status'); }
  listPrograms() { return this.request('GET', '/settings/programs'); }
  listWorkers() { return this.request('GET', '/settings/workers'); }
  createInvite(note) { return this.request('POST', '/settings/invites', { role: 'worker', note }); }
  acceptInvite(token, input) {
    const guest = new Api(this.base);
    return guest.request('POST', `/auth/invite/${encodeURIComponent(token)}`, input);
  }
  listParticipants() { return this.request('GET', '/participants'); }
  createCase(input) { return this.request('POST', '/cases', input); }
  saveIntake(caseId, input) { return this.request('PUT', `/cases/${caseId}/intake`, input); }
  planSession(caseId, input) { return this.request('POST', `/cases/${caseId}/sessions`, input); }
  startSession(caseId, input) { return this.request('POST', `/cases/${caseId}/sessions/start`, input); }
  updateSession(sessionId, input) { return this.request('PATCH', `/sessions/${sessionId}`, input); }
  uploadRecording(sessionId, bytes, durationMs) {
    return this.request(
      'POST',
      `/sessions/${sessionId}/recordings?duration_ms=${durationMs}`,
      bytes,
      'audio/mpeg',
    );
  }
  importTranscript(sessionId, recordingId, text) {
    return this.request('POST', `/sessions/${sessionId}/transcript/import`, { recording_id: recordingId, text });
  }
  assignCase(caseId, userIds) {
    return this.request('PUT', `/cases/${caseId}/assignments`, { user_ids: userIds });
  }
}

function fileReceipts(path) {
  return {
    async load() {
      try { return JSON.parse(await readFile(path, 'utf8')); }
      catch (error) {
        if (error?.code === 'ENOENT') return null;
        throw error;
      }
    },
    async save(receipt) {
      const temp = `${path}.${process.pid}.tmp`;
      await writeFile(temp, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
      await chmod(temp, 0o600);
      await rename(temp, path);
    },
  };
}

async function ensureStaff(api, password) {
  let workers = await api.listWorkers();
  for (const staff of STAFF) {
    const found = workers.find((worker) => worker.email === staff.email);
    if (found) {
      if (found.name !== staff.name || found.role !== 'worker' || found.deactivated_at) {
        throw new Error(`기존 실무자 계정 충돌: ${staff.email}`);
      }
      continue;
    }
    const invited = await api.createInvite(`합성 데이터셋 실무자 ${staff.name}`);
    await api.acceptInvite(invited.token, { ...staff, password });
    workers = await api.listWorkers();
    if (!workers.some((worker) => worker.email === staff.email && worker.name === staff.name)) {
      throw new Error(`실무자 가입 확인 실패: ${staff.name}`);
    }
  }
  return new Map(STAFF.map((staff) => {
    const worker = workers.find((candidate) => candidate.email === staff.email);
    if (!worker) throw new Error(`실무자 가입 확인 실패: ${staff.name}`);
    return [staff.name, worker];
  }));
}

const asset = async (fetchResource, descriptor, kind) => {
  if (!descriptor?.url) throw new Error(`dataset ${kind} URL 없음`);
  return fetchResource(descriptor.url, kind, descriptor);
};

const heldAt = (session) => `${session.date}T14:00:00+09:00`;
const durationMin = (session) => Math.max(1, Math.round(session.audio?.duration_ms / 60_000 || session.minutes || 1));

export async function runDatasetLoad({ config, api, fetchResource = fetchDatasetResource, receipts, log = console.log }) {
  await api.login(config.login, config.password);
  const me = await api.me();
  if (me.role !== 'admin') throw new Error('데이터셋 적재는 관리자 계정 필요');
  const speech = await api.speechStatus();
  if (speech.transcription_ready) {
    throw new Error('자동 전사 연결을 먼저 꺼야 합니다. 적재 중 Azure STT 중복 호출을 허용하지 않습니다.');
  }
  const programs = await api.listPrograms();
  if (!programs.length) throw new Error('활성 사업 없음, 마법사에서 사업을 먼저 등록');
  const program = programs[0];
  const staffByName = await ensureStaff(api, config.staffPassword);

  const manifest = await fetchResource(`${config.base}/manifest.json`, 'json');
  if (manifest.synthetic !== undefined && manifest.synthetic !== true) throw new Error('합성 데이터 manifest 아님');
  const stats = statsForCases(manifest, config.caseIds);
  const manifestById = new Map(manifest.cases.map((entry) => [entry.id, entry]));
  const receiptStore = receipts ?? fileReceipts(config.receiptPath);
  const saved = (await receiptStore.load()) ?? { version: 1, api: config.api, cases: {} };
  if (saved.version !== 1 || !saved.cases || (Object.keys(saved.cases).length > 0 && saved.api !== config.api)) {
    throw new Error('receipt 형식 또는 API 불일치');
  }
  saved.api = config.api;

  const loaded = [];
  const skipped = [];
  for (const datasetId of config.caseIds) {
    const entry = manifestById.get(datasetId);
    const practitionerName = typeof entry.practitioner === 'string' ? entry.practitioner : entry.practitioner?.name;
    const practitioner = staffByName.get(practitionerName);
    if (!practitioner) throw new Error(`${datasetId} 실무자 없음: ${practitionerName}`);

    const prior = saved.cases[datasetId];
    if (prior) {
      const participants = await api.listParticipants();
      const found = participants.find((row) => row.pseudonym === prior.pseudonym);
      if (!found) throw new Error(`${datasetId} receipt 가명 없음: ${prior.pseudonym}`);
      if (!prior.complete) throw new Error(`${datasetId} 이전 적재 미완료, 일회용 DB를 초기화한 뒤 다시 실행`);
      await api.assignCase(found.case_id ?? prior.caseId, [me.id, practitioner.id]);
      skipped.push(datasetId);
      log(`${datasetId} 건너뜀, 가명 ${prior.pseudonym}`);
      continue;
    }

    const source = await asset(fetchResource, entry.case_json, 'json');
    const participant = source.participant;
    const created = await api.createCase({
      ...Object.fromEntries(
        Object.entries({
          name: participant.name,
          phone: participant.phone,
          birth: participant.birth,
          address: participant.address,
          email: participant.email,
        }).filter(([, value]) => value != null),
      ),
      program_id: program.id,
      sessions_planned: source.sessions_planned,
      consents: CONSENTS.map((domain) => ({ domain, decision: 'grant' })),
    });
    saved.cases[datasetId] = { caseId: created.case_id, pseudonym: created.pseudonym, complete: false };
    await receiptStore.save(saved);

    const first = entry.sessions[0];
    const firstMemo = first.note ? await asset(fetchResource, first.note, 'text') : '';
    const intake = await api.saveIntake(created.case_id, {
      held_at: source.intake.held_at,
      method: source.intake.method,
      place: source.intake.place ?? null,
      memo: firstMemo,
      overall_goal: source.intake.overall_goal ?? null,
      detail: source.intake.detail,
      cards: [
        ...(source.intake.promises ?? []).map((text) => ({ kind: 'promise', text, section: 'promise' })),
        ...(source.intake.questions ?? []).map((text) => ({ kind: 'question', text, section: 'question' })),
      ],
    });

    for (const session of entry.sessions) {
      let sessionId = intake.session_id;
      if (session.seq > 1) {
        const planned = await api.planSession(created.case_id, {
          scheduled_at: heldAt(session),
          method: session.method,
          ...(session.method === 'in_person' && session.place ? { place: session.place } : {}),
          is_closing: session.seq === entry.sessions.at(-1).seq,
          duration_min: durationMin(session),
        });
        sessionId = planned.session_id;
        await api.startSession(created.case_id, {
          session_id: sessionId,
          method: session.method,
          is_closing: session.seq === entry.sessions.at(-1).seq,
        });
        const patch = {
          held_at: heldAt(session),
          method: session.method,
          is_closing: session.seq === entry.sessions.at(-1).seq,
          duration_min: durationMin(session),
        };
        if (session.note) patch.memo = await asset(fetchResource, session.note, 'text');
        await api.updateSession(sessionId, patch);
      }
      if (session.audio) {
        const bytes = await asset(fetchResource, session.audio, 'bytes');
        const recording = await api.uploadRecording(sessionId, bytes, session.audio.duration_ms);
        const dialogue = await asset(fetchResource, session.dialogue, 'json');
        await api.importTranscript(sessionId, recording.id, transcriptFromDialogue(dialogue, source.speakers));
      }
      log(`${datasetId} ${String(session.seq).padStart(2, '0')}/${entry.sessions.length}`);
    }

    await api.assignCase(created.case_id, [me.id, practitioner.id]);
    saved.cases[datasetId].complete = true;
    await receiptStore.save(saved);
    loaded.push(datasetId);
  }
  return { loaded, skipped, stats };
}

async function main() {
  let config;
  try { config = parseArgs(process.argv.slice(2)); }
  catch (error) {
    console.error(error.message);
    console.error(usage);
    process.exitCode = 2;
    return;
  }
  if (config.help) {
    console.log(usage);
    return;
  }
  const result = await runDatasetLoad({ config, api: new Api(config.api) });
  console.log(
    `적재 ${result.loaded.length}건, 건너뜀 ${result.skipped.length}건, ` +
    `manifest 당사자 ${result.stats.cases}·회차 ${result.stats.sessions}·녹음 ${result.stats.recordings}·수기 ${result.stats.notes}`,
  );
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invoked) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
