// 동의 요청 링크 카드 — **한 벌만 만든다**(2026-09-18 Q "컴포넌트 형태 같은건 반복해서 써라").
// 당사자 정보 탭의 `개인정보 및 민감정보 처리 동의 링크` 카드와 당사자 등록 화면이 같은 부품을 쓴다.
//
// 링크와 확인 코드는 **발급 응답에만 있다** — 화면을 떠나면 다시 볼 수 없어서 발급 직후 그 자리에
// 보여 준다. 부품은 발급을 하지 않고 결과만 그린다(누가 어떤 사례에 발급하는지는 화면이 안다).
import type { ReactNode } from 'react';
import { Button, Card, DataRows } from './ui.tsx';

export function ConsentLinkCard({
  link,
  code,
  busy = false,
  disabled = false,
  makeLabel = '동의 요청 링크 만들기',
  onMake,
  children,
}: {
  /** 발급된 링크. 아직 없으면 null. */
  link: string | null;
  code: string | null;
  busy?: boolean;
  disabled?: boolean;
  /** 아직 만들지 않았을 때 버튼에 쓸 말. 이미 있으면 `새로 만들기`다. */
  makeLabel?: string;
  onMake: () => void;
  /** 발급 뒤 카드 안에 이어 붙일 것(예: 다음 화면으로 가는 버튼). */
  children?: ReactNode;
}) {
  return (
    <Card
      title="개인정보 및 민감정보 처리 동의 링크"
      action={
        <Button variant="primary" disabled={busy || disabled} onClick={onMake}>
          {busy ? '만드는 중…' : link ? '새로 만들기' : makeLabel}
        </Button>
      }
    >
      {link && code ? (
        <>
          <DataRows
            rows={[
              ['링크', link],
              ['확인 코드', code],
            ]}
          />
          <p className="panel-meta">이 화면을 닫으면 코드는 다시 볼 수 없어요. 지금 전해 주세요.</p>
          {children}
        </>
      ) : (
        <p className="panel-meta">개인 정보 및 민감 정보 처리 동의 받기 링크를 생성하세요</p>
      )}
    </Card>
  );
}
