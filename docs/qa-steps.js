// 시험용 번호표 — 브라우저 개발자 도구 콘솔에 통째로 붙여 넣는다.
// docs/q-check.md 의 단계 번호를 실제 화면 위에 띄운다. 제품 코드에 넣지 않는다.
//
//   켜기: 붙여 넣으면 바로
//   끄기: relayer번호.끄기()
//
// 화면이 바뀌면 자동으로 다시 붙는다(해시 라우팅이라 새로고침하지 않는 한 살아 있다).
(() => {
  document.getElementById('qa-steps-style')?.remove();
  window.relayer번호?.끄기?.();

  const STYLE = `
    .qa-badge{position:absolute;z-index:9998;transform:translate(-50%,-50%);
      display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 10px;
      border-radius:9999px;background:#6b46c1;color:#fff;font:600 12px/1 system-ui,sans-serif;
      white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.25);pointer-events:none}
    .qa-badge[data-tone="c"]{background:#0f766e}
    .qa-panel{position:fixed;right:16px;bottom:16px;z-index:9999;max-width:320px;
      padding:12px 14px;border-radius:12px;background:#111;color:#fff;
      font:400 12px/1.5 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.3)}
    .qa-panel b{color:#c4b5fd}
    .qa-panel ol{margin:6px 0 0;padding-left:18px}
    .qa-panel li[data-here="true"]{color:#fff;font-weight:600}
    .qa-panel li{color:#9ca3af}
  `;
  const style = document.createElement('style');
  style.id = 'qa-steps-style';
  style.textContent = STYLE;
  document.head.append(style);

  /** 단계 표: 화면(해시)마다 어느 카드에 몇 번을 붙일지. 글자는 q-check.md 와 같다. */
  const STEPS = [
    // 달력 카드는 제목이 없다. null 은 '첫 카드'(달력)다.
    {
      hash: /^#\/schedule$/,
      n: '1',
      screen: '상담 일정',
      marks: [
        [null, '① 월간 기본 · 월~일 · 꺽쇠 사이 날짜 누르면 달력 모달'],
        ['다가오는 일정', '① 줄을 펼치면 상세와 당사자 정보·상담 기록하기 버튼'],
      ],
    },
    // 목록 화면에는 제목 있는 카드가 없다 — 검색·걸개가 있는 도구 모음에 붙인다.
    {
      hash: /^#\/participants$/,
      n: '2',
      ns: ['2', '10'],
      screen: '당사자 목록',
      marks: [
        ['sel:.participant-toolbar', '② 이름으로 찾아지나 · 카드에 사업명·회차·다음 상담'],
        ['sel:.participant-toolbar', '⑩ 종결 배지가 보이나'],
      ],
    },
    {
      hash: /^#\/participants\/new$/,
      n: '3',
      screen: '당사자 등록',
      marks: [['당사자', '③ 이름·사업 고르고 개인정보 체크 → 등록하고 인테이크 쓰기']],
    },
    {
      hash: /\/intake$/,
      n: '4',
      screen: '인테이크',
      marks: [
        ['공적급여, 수급자 여부', '④-1 기초생활보장수급 고르면 수급 유형이 그 자리에 열리나'],
        ['수행할 과제', '④-2 과제 한 줄'],
        ['다음에 물어볼 것', '④-3 질문 한 줄 → 저장하고 상담 일정 잡기'],
      ],
    },
    {
      hash: /\/schedule$/,
      n: '5',
      screen: '상담 일정 등록',
      skipIf: /^#\/schedule$/,
      marks: [
        ['상담 일시', '⑤ 날짜 골라 선택 완료 · 오전·오후/시/분 → 일정 저장'],
        ['상담 내용', '⑤ 종결 상담 체크상자 보이나'],
      ],
    },
    // 15초 다시보기는 폐지 — 그 자리는 상담 기록하기 왼쪽 레일이다.
    {
      hash: /\/record$/,
      n: '6',
      ns: ['6', '7'],
      screen: '상담 기록하기',
      marks: [
        ['확인할 과제', '⑥ 방금 적은 과제가 1회차 달고 왔나 · 「진행 전」 누르기'],
        ['오늘 물어볼 것', '⑥ 여기는 아무것도 누르지 말 것 / ⑦ 안 누른 질문이 다시 올라왔나 ← 핵심'],
        ['1. 오늘 상담 내용', '⑥ 상담 내용만 적고 저장', 'c'],
      ],
    },
    {
      hash: /\/info$/,
      n: '8',
      ns: ['8', '9'],
      screen: '당사자 정보',
      marks: [
        ['회차별 요약', '⑧ 회차 펼치고 수정 / ⑨ 종결 뒤 「상담 종결」이 번호 없이 붙나'],
        ['회차별 원본 보기', '⑧ 원본 보기'],
        ['상담 종결', '⑨ 당사자 정보 탭에서 종결로 → 종결 기록 쓰기'],
      ],
    },
    {
      hash: /\/close$/,
      n: '9',
      screen: '상담 종결',
      marks: [
        ['미완료 과제', '⑨ 「○회차에서 시작」 보이나 · 종결해도 안 사라짐'],
        ['종결 사유', '⑨ 사유 고르고 종결 확정'],
      ],
    },
  ];

  const ORDER = [
    '1 상담 일정', '2 당사자 목록', '3 당사자 등록', '4 인테이크', '5 상담 일정 등록',
    '6 상담 기록하기', '7 다시 상담 기록하기', '8 당사자 정보', '9 상담 종결', '10 종결된 사례',
  ];

  // 'sel:…' 은 카드가 아닌 자리(도구 모음 등)에 붙일 때 쓰는 선택자다.
  const cardTitled = (text) =>
    [...document.querySelectorAll('section.wire-card')].find((c) => {
      const t = c.querySelector('.wire-card-title, .wire-item-title');
      return t && t.textContent.trim() === text;
    });

  function paint() {
    document.querySelectorAll('.qa-badge, .qa-panel').forEach((el) => el.remove());
    const hash = location.hash || '#/schedule';
    const step = STEPS.find((s) => s.hash.test(hash) && !(s.skipIf && s.skipIf.test(hash)));

    if (step) {
      const stacked = new Map();
      for (const [title, note, tone] of step.marks) {
        const card = title?.startsWith('sel:')
          ? document.querySelector(title.slice(4))
          : title
            ? cardTitled(title)
            : document.querySelector('section.wire-card');
        if (!card) continue;
        const box = card.getBoundingClientRect();
        const badge = document.createElement('div');
        badge.className = 'qa-badge';
        if (tone) badge.dataset.tone = tone;
        badge.textContent = note;
        badge.style.left = `${box.left + window.scrollX + 90}px`;
        // 한 카드에 배지가 겹치면 아래로 민다.
        const k = stacked.get(card) ?? 0;
        stacked.set(card, k + 1);
        badge.style.top = `${box.top + window.scrollY + k * 28}px`;
        document.body.append(badge);
      }
    }

    const panel = document.createElement('div');
    panel.className = 'qa-panel';
    panel.innerHTML =
      `<b>시험 번호표</b> · 지금: ${step ? `${step.n} ${step.screen}` : '해당 없음'}` +
      `<ol>${ORDER.map((line) => {
        const [n] = line.split(' ');
        return `<li data-here="${step?.n === n || step?.ns?.includes(n)}">${line.slice(n.length + 1)}</li>`;
      }).join('')}</ol>` +
      `<div style="margin-top:8px;color:#9ca3af">끄기: relayer번호.끄기()</div>`;
    document.body.append(panel);
  }

  const repaint = () => requestAnimationFrame(paint);
  const observer = new MutationObserver(repaint);
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('hashchange', repaint);
  window.addEventListener('resize', repaint);
  window.addEventListener('scroll', repaint, { passive: true });

  window.relayer번호 = {
    끄기() {
      observer.disconnect();
      window.removeEventListener('hashchange', repaint);
      window.removeEventListener('resize', repaint);
      window.removeEventListener('scroll', repaint);
      document.querySelectorAll('.qa-badge, .qa-panel').forEach((el) => el.remove());
      document.getElementById('qa-steps-style')?.remove();
      delete window.relayer번호;
    },
  };

  paint();
  console.log('%c시험 번호표 켜짐. 끄려면 relayer번호.끄기()', 'color:#6b46c1;font-weight:bold');
})();
