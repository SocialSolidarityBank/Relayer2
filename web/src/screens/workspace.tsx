/**
 * 기관 워크스페이스 요약(2026-09-17 Q·ASTRA 검토 C). 로그인한 누구나 **필요할 때 보는** 화면이다 —
 * 평소 로그인은 상담 일정으로 바로 간다. 마법사를 마친 직후에는 `?done=1` 로 와서 "마쳤어요" 를 함께 말한다.
 * 키·사업자번호·연락처 같은 상세는 여기 없다 — 기관 설정(관리자)에서 본다.
 */
import { type Me } from '../api.ts';
import { Button, Card, DataRows, FormActions, PageHeader } from '../ui.tsx';

export function WorkspaceScreen({ me, justDone }: { me: Me; justDone: boolean }) {
  const ws = me.workspace;
  return (
    <>
      <PageHeader
        title={justDone ? '기관 설정을 마쳤어요' : `${ws?.name ?? '기관'}의 기관 정보를 확인해요`}
        meta={justDone ? '이제 상담 일정과 당사자 등록부터 쓸 수 있어요' : undefined}
      />
      <Card title="기관 워크스페이스">
        <DataRows
          rows={[
            ['기관 이름', ws?.name ?? '아직 없어요'],
            ['주소 이름', ws?.slug ?? '배포 설정에 정해지지 않았어요'],
            ['내 계정', `${me.name}, ${me.role === 'admin' ? '관리자' : '실무자'}`],
            ['준비 상태', me.onboarded ? '준비를 마쳤어요' : '관리자가 준비하는 중이에요'],
          ]}
        />
        <FormActions>
          {me.role === 'admin' && (
            <a className="wire-button" href="#/settings/org">
              <span className="wire-button-text">기관 설정 보기</span>
            </a>
          )}
          <a className="wire-button" data-variant="primary" href="#/schedule">
            <span className="wire-button-text">상담 일정으로 이동하기</span>
          </a>
        </FormActions>
      </Card>
    </>
  );
}

/**
 * 기관 준비 중(실무자). 관리자가 마법사를 마치기 전에 초대로 먼저 들어온 실무자가 본다.
 * 서버 잠금은 없다 — 사업이 없으면 당사자 등록이 막히는 등 반쯤 열린 화면을 헤매지 않게 하는 안내다.
 */
export function SetupPendingScreen({ me, onRefresh }: { me: Me; onRefresh: () => void }) {
  return (
    <>
      <PageHeader title="기관을 준비하고 있어요" meta={me.workspace?.name ?? undefined} />
      <Card title="관리자가 초기 설정을 마치면 상담 일정과 기록을 이용할 수 있어요">
        <p className="panel-meta">사업 목록과 연결 설정이 끝나는 대로 열려요. 조금 뒤 다시 확인해 주세요.</p>
        <FormActions>
          <Button variant="primary" onClick={onRefresh}>
            다시 확인하기
          </Button>
        </FormActions>
      </Card>
    </>
  );
}
