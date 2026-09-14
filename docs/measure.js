// 관문 2 계수기 — 브라우저 개발자 도구 콘솔에 통째로 붙여 넣는다.
// 제품 코드에 넣지 않는다. 측정이 끝나면 새로고침만 하면 사라진다.
//
//   시작: 붙여 넣으면 바로 센다
//   끝:   relayer측정.끝()  → 표로 출력
//
// 세는 것: 채운 칸 수, 누른 버튼 수, 선택(라디오·체크) 수, 시작부터 저장까지 걸린 시간.
(() => {
  const started = Date.now();
  const filled = new Set();
  let clicks = 0;
  let choices = 0;
  let saves = [];

  const label = (el) => {
    const byFor = el.id && document.querySelector(`label[for="${el.id}"]`);
    return (
      byFor?.textContent?.trim() ||
      el.closest('label')?.textContent?.trim() ||
      el.getAttribute('aria-label') ||
      el.placeholder ||
      el.id ||
      el.type
    );
  };

  document.addEventListener(
    'input',
    (e) => {
      const el = e.target;
      if (!(el instanceof HTMLElement)) return;
      // 라디오·체크는 '선택'으로 따로 센다. 여기서 또 세면 두 번 센다.
      if (el.type === 'radio' || el.type === 'checkbox') return;
      if (el.value?.trim()) filled.add(label(el));
    },
    true,
  );

  document.addEventListener(
    'click',
    (e) => {
      const el = e.target.closest('button, a, input[type=radio], input[type=checkbox]');
      if (!el) return;
      if (el.tagName === 'INPUT') choices += 1;
      else {
        clicks += 1;
        const text = el.textContent.trim();
        if (text.startsWith('저장') || text.startsWith('등록') || text.startsWith('종결 확정')) {
          saves.push({ 무엇: text, 초: Math.round((Date.now() - started) / 1000) });
        }
      }
    },
    true,
  );

  window.relayer측정 = {
    끝() {
      const seconds = Math.round((Date.now() - started) / 1000);
      console.table([
        { 항목: '채운 칸', 값: filled.size },
        { 항목: '선택(라디오·체크)', 값: choices },
        { 항목: '누른 버튼·링크', 값: clicks },
        { 항목: '입력 수 합계', 값: filled.size + choices },
        { 항목: '총 시간(초)', 값: seconds },
        { 항목: '총 시간', 값: `${Math.floor(seconds / 60)}분 ${seconds % 60}초` },
      ]);
      console.table(saves);
      console.log('채운 칸 목록:', [...filled]);
      return { 채운칸: filled.size, 선택: choices, 버튼: clicks, 초: seconds, 저장: saves };
    },
  };

  console.log('%c계수기 시작. 끝나면 relayer측정.끝()', 'color:#6b46c1;font-weight:bold');
})();
