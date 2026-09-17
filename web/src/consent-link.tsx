// 동의 요청 링크 카드 — **한 벌만 만든다**(2026-09-18 Q "컴포넌트 형태 같은건 반복해서 써라").
// 당사자 정보 탭과 당사자 등록이 같은 부품을 쓴다. 두 자리의 차이는 세 가지뿐이라
// 속성으로 받는다: 아직 사례가 없을 때의 버튼 이름, 불러오는 중 상태, 카드 아래에 붙는 행동
// (`링크 끊기` / `인테이크 쓰기`).
//
// 링크와 확인 코드는 **발급 응답에만 있다** — 해시만 저장하므로 화면을 떠나면 다시 볼 수 없다.
// 그래서 발급 직후 그 자리에 보여 준다. 부품은 발급을 하지 않고 결과만 그린다.
import type { ReactNode } from 'react';
import { Button, Card, DataRows, Empty } from './ui.tsx';

export function ConsentLinkCard({
  status,
  link,
  code,
  busy = false,
  disabled = false,
  makeLabel,
  onMake,
  children,
}: {
  /** `loading` 은 링크 상태를 아직 못 받은 자리(당사자 정보 탭)다. */
  status: 'loading' | 'none' | 'active';
  /** 발급 직후에만 있는 값. 이미 살아 있는 링크를 되읽지는 못한다. */
  link: string | null;
  code: string | null;
  busy?: boolean;
  disabled?: boolean;
  /** 아직 만든 링크가 없을 때 버튼에 쓸 말. 있으면 `새로 만들기`다. */
  makeLabel: string;
  onMake: () => void;
  /** 카드 아래에 붙는 행동. 위험 행동을 제목 줄에 함께 세우지 않는다(2026-09-17 Q). */
  children?: ReactNode;
}) {
  return (
    <Card
      /**
       * 이 카드가 하는 일(2026-09-17 Q): 당사자 등록에서 초대로 동의를 받는 것이 기본이고,
       * 실무자가 직접 작성해 버린 경우에 **동의를 받으려고 보내는 링크**를 만드는 자리다.
       */
      title="개인정보 및 민감정보 처리 동의 링크"
      // 만들기 버튼은 제목과 같은 행 오른쪽 끝이다(2026-09-17 Q).
      action={
        status !== 'loading' && (
          <Button variant="primary" disabled={busy || disabled} onClick={onMake}>
            {status === 'active' ? '새로 만들기' : makeLabel}
          </Button>
        )
      }
    >
      {status === 'loading' ? (
        <Empty>불러오는 중</Empty>
      ) : (
        <>
          {link && code ? (
            <div className="wire-repeat-card">
              <p className="panel-meta">코드는 지금 한 번만 표시</p>
              <DataRows
                rows={[
                  ['링크', link],
                  ['확인 코드', code],
                ]}
              />
            </div>
          ) : (
            status === 'none' && <Empty>만든 링크 없음</Empty>
          )}
          {children}
        </>
      )}
    </Card>
  );
}
