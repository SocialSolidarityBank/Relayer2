import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { DATABASE_URL, sql } from '../src/db.ts';
import { app } from '../src/routes.ts';
import { ensureProgram } from './voice-fixture.ts';
import { issueCookie } from '../src/auth.ts';
import { encryptText } from '../src/pii.ts';

const enabled = process.env.RELAYER_INTEGRATION === '1';
if (enabled) {
  const db = new URL(DATABASE_URL);
  if (!['localhost', '127.0.0.1'].includes(db.hostname) || !db.pathname.startsWith('/relayer_shared_check_'))
    throw new Error('Integration tests require an isolated relayer_shared_check_ database on localhost.');
}
const cookie=(id:number)=>issueCookie(id).split(';')[0];
const req=(path:string,actor:number,method='GET',body?:unknown)=>app.request(path,{
  method,headers:{cookie:cookie(actor),'content-type':'application/json'},body:body?JSON.stringify(body):undefined,
});

// A real, short PCM WAV container; synthetic silence, no external recording.
function silentWav(): Uint8Array {
  const data=Buffer.alloc(44+3200);
  data.write('RIFF',0);data.writeUInt32LE(data.length-8,4);data.write('WAVEfmt ',8);
  data.writeUInt32LE(16,16);data.writeUInt16LE(1,20);data.writeUInt16LE(1,22);
  data.writeUInt32LE(16000,24);data.writeUInt32LE(32000,28);data.writeUInt16LE(2,32);data.writeUInt16LE(16,34);
  data.write('data',36);data.writeUInt32LE(data.length-44,40);
  return data;
}

describe.skipIf(!enabled)('recording access and comparison',()=>{
  it('protects stored audio, requires reviewed text, and denies a removed member without losing the remaining member',async()=>{
    const prefix=randomUUID();
    const users=await sql<Array<{id:number}>>`insert into users(email,name,role) values
      (${prefix+'a'},'음성 A','worker'),(${prefix+'b'},'음성 B','worker'),(${prefix+'m'},'음성 관리자','admin') returning id`;
    const [a,b,admin]=users.map(u=>u.id);
    const created=await req('/cases',a,'POST',{name:'음성 합성',program_id:await ensureProgram('음성 검증'),consents:[
      {domain:'personal_data_collection_use',decision:'grant'},
      {domain:'sensitive_information_processing',decision:'grant'},
      {domain:'counseling_recording',decision:'grant'},
      {domain:'voice_original_retention_period',decision:'grant'},
      {domain:'external_stt_processing',decision:'grant'},
    ]});
    expect(created.status).toBe(201);
    const {case_id}=await created.json();
    const planned=await req(`/cases/${case_id}/sessions`,a,'POST',{scheduled_at:'2026-09-20T01:00:00Z',method:'phone'});
    const {session_id}=await planned.json();
    expect((await req(`/sessions/${session_id}`,a,'PATCH',{memo:'연체 3건입니다.',method:'phone'})).status).toBe(200);
    const upload=()=>app.request(`/sessions/${session_id}/recordings`,{method:'POST',headers:{cookie:cookie(a),'content-type':'audio/wav'},body:silentWav()});
    const saved=await upload();
    expect(saved.status).toBe(201);
    const recording=await saved.json();
    for(const actor of [b,admin]) {
      expect((await req(`/recordings/${recording.id}/audio`,actor)).status).toBe(403);
      expect((await req(`/recordings/${recording.id}/transcript`,actor,'POST',{})).status).toBe(403);
    }
    const audio=await req(`/recordings/${recording.id}/audio`,a);
    expect(audio.status).toBe(200);
    expect(Buffer.from(await audio.arrayBuffer())).toEqual(Buffer.from(silentWav()));
    const missing=await (await req(`/sessions/${session_id}/mismatches`,a)).json();
    expect(missing.voice_status).toBe('unavailable');
    expect(missing.voice_vs_written).toEqual([]);
    // A synthetic transcript fixture checks comparison independently of an external STT model.
    // It is not evidence that live Azure transcription succeeded.
    const [draft]=await sql<Array<{id:number}>>`insert into transcripts(recording_id,session_id,status,text,mask_hits,engine,created_by)
      values(${recording.id},${session_id},'draft',${encryptText('연체 4건입니다.')},'{}','test-fixture',${a}) returning id`;
    const unreviewed=await (await req(`/sessions/${session_id}/mismatches`,a)).json();
    expect(unreviewed.voice_status).toBe('needs_review');
    const approved=await req(`/sessions/${session_id}/transcript/approve`,a,'POST',{transcript_id:draft.id,text:'연체 4건입니다.'});
    expect(approved.status).toBe(200);
    const compared=await (await req(`/sessions/${session_id}/mismatches`,a)).json();
    expect(compared.voice_status).toBe('ready');
    expect(compared.scope).toBe('numeric');
    expect(compared.voice_vs_written).toEqual(expect.arrayContaining([expect.objectContaining({label:'연체 건수',left:'4',right:'3'})]));
    await req('/settings/assign',admin,'POST',{case_id,user_ids:[a,b]});
    expect((await req(`/recordings/${recording.id}/audio`,b)).status).toBe(200);
    await req('/settings/assign',admin,'POST',{case_id,user_ids:[b]});
    expect((await req(`/recordings/${recording.id}/audio`,a)).status).toBe(403);
    expect((await req(`/sessions/${session_id}/mismatches`,b)).status).toBe(200);
  });
});
