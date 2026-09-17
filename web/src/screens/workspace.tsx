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
        title={justDone ? '기관 설정 완료' : `${ws?.name ?? '기관'} 기관 정보`}
        meta={justDone ? '상담 일정·당사자 등록 이용 가능' : undefined}
      />
      <Card title="기관 워크스페이스">
        <DataRows
          rows={[
            ['기관 이름', ws?.name ?? '없음'],
            ['주소 이름', ws?.slug ?? '미정'],
            ['내 계정', `${me.name}, ${me.role === 'admin' ? '관리자' : '실무자'}`],
            ['준비 상태', me.onboarded ? '준비 완료' : '관리자 준비 중'],
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
      <PageHeader title="기관 준비 중" meta={me.workspace?.name ?? undefined} />
      <Card title="관리자 초기 설정 완료 후 이용 가능">
        <p className="panel-meta">사업 목록·연결 설정 완료 시 열림 — 잠시 후 다시 확인</p>
        <FormActions>
          <Button variant="primary" onClick={onRefresh}>
            다시 확인하기
          </Button>
        </FormActions>
      </Card>
    </>
  );
}
