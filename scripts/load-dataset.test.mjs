import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_CASES,
  STAFF,
  parseArgs,
  runDatasetLoad,
  statsForCases,
  transcriptFromDialogue,
} from './load-dataset.mjs';

const BASE = 'https://dataset.example/2026-09-17';

const manifest = {
  cases: [
    {
      id: 'C01',
      practitioner: '박지연',
      case_json: { url: `${BASE}/cases/C01/case.json` },
      sessions: [
        {
          seq: 1,
          date: '2026-01-01',
          method: 'in_person',
          place: '상담실',
          note: { url: `${BASE}/cases/C01/sessions/01.note.md` },
          dialogue: { url: `${BASE}/cases/C01/sessions/01.dialogue.json` },
          audio: { url: `${BASE}/cases/C01/sessions/01.mp3`, bytes: 3, duration_ms: 1_000 },
        },
        {
          seq: 2,
          date: '2026-01-08',
          method: 'phone',
          dialogue: { url: `${BASE}/cases/C01/sessions/02.dialogue.json` },
          audio: { url: `${BASE}/cases/C01/sessions/02.mp3`, bytes: 3, duration_ms: 2_000 },
        },
      ],
    },
    {
      id: 'C02',
      practitioner: '최은정',
      case_json: { url: `${BASE}/cases/C02/case.json` },
      sessions: [
        {
          seq: 1,
          date: '2026-02-01',
          method: 'visit',
          note: { url: `${BASE}/cases/C02/sessions/01.note.md` },
          dialogue: { url: `${BASE}/cases/C02/sessions/01.dialogue.json` },
        },
      ],
    },
  ],
};

const caseJson = {
  participant: { name: '합성 당사자', phone: '010-0000-0000', birth: '2000-01-01', address: '합성 주소' },
  practitioner: { name: '박지연' },
  sessions_planned: 2,
  speakers: { P: '실무자 박지연', C: '당사자 합성' },
  intake: {
    held_at: '2026-01-01T14:00:00+09:00',
    method: 'in_person',
    place: '상담실',
    detail: { application_reason_detail: '합성 신청 배경' },
    overall_goal: '합성 목표',
    promises: ['서류 준비'],
    questions: ['지원 이력'],
  },
};

const dialogue = {
  turns: [
    { s: 'P', t: '안녕하세요.' },
    { s: 'C', t: '네.' },
  ],
};

test('CLI keeps secrets in named environment variables and uses the five-case default', () => {
  const parsed = parseArgs(
    ['--base', BASE, '--api', 'http://127.0.0.1:8787', '--login', 'test1/RELAYER_PASSWORD'],
    { RELAYER_PASSWORD: 'admin-secret', RELAYER_STAFF_PASSWORD: 'staff-secret' },
  );

  assert.deepEqual(parsed.caseIds, DEFAULT_CASES);
  assert.equal(parsed.login, 'test1');
  assert.equal(parsed.password, 'admin-secret');
  assert.equal(parsed.staffPassword, 'staff-secret');
  assert.equal(parsed.base, BASE);
  assert.equal(parsed.api, 'http://127.0.0.1:8787');
  assert.throws(
    () => parseArgs(['--base', BASE, '--api', 'http://127.0.0.1:8787', '--login', 'test1/plaintext'], {}),
    /환경 변수 이름/,
  );
});

test('manifest totals follow requested case order and derive expected counts', () => {
  assert.deepEqual(statsForCases(manifest, ['C02', 'C01']), {
    cases: 2,
    sessions: 3,
    recordings: 2,
    notes: 2,
    audioBytes: 6,
  });
});

test('dialogue becomes a speaker-labelled approved transcript', () => {
  assert.equal(
    transcriptFromDialogue(dialogue, caseJson.speakers),
    '실무자 박지연: 안녕하세요.\n당사자 합성: 네.',
  );
  assert.equal(
    transcriptFromDialogue(
      { turns: [{ s: 'P', t: '' }, { s: 'C', t: '예를 들면:' }] },
      caseJson.speakers,
    ),
    '당사자 합성: 예를 들면:',
  );
});

test('load aborts before writing when automatic STT is configured', async () => {
  const api = {
    async login() {},
    async me() { return { id: 1, role: 'admin' }; },
    async speechStatus() { return { enabled: true, transcription_ready: true }; },
  };
  await assert.rejects(
    runDatasetLoad({
      config: {
        base: BASE,
        api: 'http://127.0.0.1:8787',
        caseIds: ['C01'],
        login: 'test1',
        password: 'admin-secret',
        staffPassword: 'staff-secret',
      },
      api,
      fetchResource: async () => {
        throw new Error('dataset fetch must not run');
      },
      receipts: {
        async load() { return null; },
        async save() { throw new Error('receipt write must not run'); },
      },
      log: () => {},
    }),
    /자동 전사.*꺼야/,
  );
});

test('a second run skips the pseudonym receipt but preserves staff and assignments', async () => {
  const resources = new Map([
    [`${BASE}/manifest.json`, manifest],
    [`${BASE}/cases/C01/case.json`, caseJson],
    [`${BASE}/cases/C01/sessions/01.note.md`, '# 1회차\n수기'],
    [`${BASE}/cases/C01/sessions/01.dialogue.json`, dialogue],
    [`${BASE}/cases/C01/sessions/01.mp3`, new Uint8Array([1, 2, 3])],
    [`${BASE}/cases/C01/sessions/02.dialogue.json`, dialogue],
    [`${BASE}/cases/C01/sessions/02.mp3`, new Uint8Array([4, 5, 6])],
  ]);
  const counts = {
    invites: 0,
    cases: 0,
    intakes: 0,
    plans: 0,
    starts: 0,
    patches: 0,
    recordings: 0,
    transcripts: 0,
    assignments: [],
  };
  const workers = [
    { id: 1, email: 'test1', name: '관리자', role: 'admin' },
    { id: 99, email: 'other.park', name: '박지연', role: 'worker' },
  ];
  const participants = [];
  let nextWorker = 2;
  let nextSession = 101;
  let pendingInvite;
  const api = {
    async login(login, password) {
      assert.equal(login, 'test1');
      assert.equal(password, 'admin-secret');
    },
    async me() { return { id: 1, role: 'admin' }; },
    async speechStatus() { return { enabled: true, transcription_ready: false }; },
    async listPrograms() { return [{ id: 7, name: '합성 사업' }]; },
    async listWorkers() { return workers; },
    async createInvite() {
      counts.invites += 1;
      pendingInvite = `token-${counts.invites}`;
      return { token: pendingInvite };
    },
    async acceptInvite(token, input) {
      assert.equal(token, pendingInvite);
      workers.push({ id: nextWorker++, email: input.email, name: input.name, role: 'worker' });
    },
    async listParticipants() { return participants; },
    async createCase(input) {
      counts.cases += 1;
      const row = { case_id: 10, pseudonym: '기러기-101', name: input.name, can_access: true };
      participants.push(row);
      return row;
    },
    async saveIntake() { counts.intakes += 1; return { session_id: nextSession++ }; },
    async planSession() { counts.plans += 1; return { session_id: nextSession++, seq: 2 }; },
    async startSession() { counts.starts += 1; },
    async updateSession() { counts.patches += 1; },
    async uploadRecording() { counts.recordings += 1; return { id: 200 + counts.recordings }; },
    async importTranscript() { counts.transcripts += 1; },
    async assignCase(caseId, userIds) { counts.assignments.push({ caseId, userIds }); },
  };
  let receipt = { version: 1, api: 'http://127.0.0.1:8787', cases: {} };
  const receipts = {
    async load() { return structuredClone(receipt); },
    async save(next) { receipt = structuredClone(next); },
  };
  const fetchResource = async (url, kind) => {
    const value = resources.get(url);
    assert.notEqual(value, undefined, `missing fixture ${url}`);
    if (kind === 'bytes') return value;
    if (kind === 'text') return value;
    return structuredClone(value);
  };
  const config = {
    base: BASE,
    api: 'http://127.0.0.1:8787',
    caseIds: ['C01'],
    login: 'test1',
    password: 'admin-secret',
    staffPassword: 'staff-secret',
  };

  const first = await runDatasetLoad({ config, api, fetchResource, receipts, log: () => {} });
  const second = await runDatasetLoad({ config, api, fetchResource, receipts, log: () => {} });

  assert.equal(STAFF.length, 3);
  assert.equal(counts.invites, 3);
  assert.equal(workers.length, 5);
  assert.deepEqual(first, { loaded: ['C01'], skipped: [], stats: { cases: 1, sessions: 2, recordings: 2, notes: 1, audioBytes: 6 } });
  assert.deepEqual(second, { loaded: [], skipped: ['C01'], stats: { cases: 1, sessions: 2, recordings: 2, notes: 1, audioBytes: 6 } });
  assert.deepEqual(
    { cases: counts.cases, intakes: counts.intakes, plans: counts.plans, starts: counts.starts, patches: counts.patches, recordings: counts.recordings, transcripts: counts.transcripts },
    { cases: 1, intakes: 1, plans: 1, starts: 1, patches: 1, recordings: 2, transcripts: 2 },
  );
  const park = workers.find((worker) => worker.email === 'curated.park');
  assert.deepEqual(counts.assignments, [
    { caseId: 10, userIds: [1, park.id] },
    { caseId: 10, userIds: [1, park.id] },
  ]);
  assert.deepEqual(receipt.cases.C01, { caseId: 10, pseudonym: '기러기-101', complete: true });
});
