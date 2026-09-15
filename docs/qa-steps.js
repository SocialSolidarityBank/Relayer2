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
    // 제목이 날짜(3일 뒤 · 10월 8일)라 이름으로 못 집는다. null 은 '첫 카드'다.
    { hash: /^#\/schedule$/, n: '1', screen: '일정', marks: [[null, '① 날짜로 묶였나 · 과제 배지가 보이나']] },
    { hash: /^#\/participants$/, n: '2', screen: '당사자 목록', marks: [['목록', '② 이름으로 찾아지나']] },
    { hash: /^#\/participants\/new$/, n: '3', screen: '당사자 등록', marks: [['당사자', '③ 이름만 넣고 등록']] },
    {
      hash: /\/intake$/,
      n: '4',
      screen: '인테이크 작성하기',
      marks: [
        ['현재 어려움 관련 영역', '④-1 경제를 켜면 아래가 열리나'],
        ['우선적으로 필요한 도움', '④-2 1순위 고르면 2순위에서 빠지나'],
        ['수행할 과제', '④-3 약속 한 줄 (버튼 알약·한 행)'],
        ['다음에 물어볼 것', '④-4 질문 한 줄'],
      ],
    },
    {
      hash: /\/schedule$/,
      n: '5',
      screen: '상담 일정 등록',
      skipIf: /^#\/schedule$/,
      marks: [['일시와 상담 방식', '⑤ 일시만 넣고 등록 · 종결 상담 체크상자 보이나']],
    },
    {
      hash: /\/briefing$/,
      n: '6',
      screen: '15초 다시보기',
      marks: [
        ['확인할 과제', '⑥ 방금 적은 과제가 1회차 달고 왔나 / ⑧ 저장 뒤 다시 보면'],
        ['오늘 물어볼 것', '⑥·⑧ 안 누른 질문에 「지난 회차 미확인」이 붙나 ← 핵심'],
      ],
    },
    {
      hash: /\/record$/,
      n: '7',
      screen: '상담 기록하기',
      marks: [
        ['확인할 과제', '⑦-1 「못 함 · 계속」 누르기'],
        ['오늘 물어볼 것', '⑦-2 여기는 아무것도 누르지 말 것 ← ⑧ 을 보려면'],
        ['상담 일시와 상담 방식', 'Ⓒ 예정 없이 바로 기록 (이 구획이 뜨면 정상)', 'c'],
        ['1. 상담 내용', '⑦-3 내용 적고 저장'],
      ],
    },
    {
      hash: /\/info$/,
      n: '9',
      screen: '당사자 정보',
      marks: [
        ['회차별 요약', '⑨-1 원문 보기 / ⑩ 종결 뒤 「상담 종결」이 번호 없이 붙나'],
        ['기본 정보', '⑨-2 정보 탭'],
        ['상담 종결', '⑩-1 여기서 종결로'],
      ],
    },
    {
      hash: /\/close$/,
      n: '10',
      screen: '상담 종결',
      marks: [
        ['미완료 과제', '⑩-2 「○회차에서 시작」 보이나 · 종결해도 안 사라짐'],
        ['종결 사유', '⑩-3 사유 고르고 확정'],
      ],
    },
  ];

  const ORDER = [
    '1 일정', '2 당사자 목록', '3 당사자 등록', '4 인테이크', '5 상담 일정 등록',
    '6 15초 다시보기', '7 상담 기록하기', '8 다시 다시보기(미확인 확인)', '9 당사자 정보', '10 상담 종결',
  ];

  const cardTitled = (text) =>
    [...document.querySelectorAll('section.wire-card')].find((c) => {
      const t = c.querySelector('.wire-card-title');
      return t && t.textContent.trim() === text;
    });

  function paint() {
    document.querySelectorAll('.qa-badge, .qa-panel').forEach((el) => el.remove());
    const hash = location.hash || '#/schedule';
    const step = STEPS.find((s) => s.hash.test(hash) && !(s.skipIf && s.skipIf.test(hash)));

    if (step) {
      for (const [title, note, tone] of step.marks) {
        const card = title ? cardTitled(title) : document.querySelector('section.wire-card');
        if (!card) continue;
        const box = card.getBoundingClientRect();
        const badge = document.createElement('div');
        badge.className = 'qa-badge';
        if (tone) badge.dataset.tone = tone;
        badge.textContent = note;
        badge.style.left = `${box.left + window.scrollX + 90}px`;
        badge.style.top = `${box.top + window.scrollY}px`;
        document.body.append(badge);
      }
    }

    const panel = document.createElement('div');
    panel.className = 'qa-panel';
    panel.innerHTML =
      `<b>시험 번호표</b> · 지금: ${step ? `${step.n} ${step.screen}` : '해당 없음'}` +
      `<ol>${ORDER.map((line) => {
        const [n] = line.split(' ');
        return `<li data-here="${step?.n === n}">${line.slice(n.length + 1)}</li>`;
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
