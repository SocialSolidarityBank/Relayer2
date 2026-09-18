import { CONNECTION_GUIDES } from './connection-guide.js';

// 공개 랜딩의 설정 가이드. 앱 설정 아코디언도 같은 CONNECTION_GUIDES를 묶어 쓴다.
const guideDialog = document.querySelector('[data-connection-guide-dialog]');
const guideList = guideDialog?.querySelector('[data-connection-guide-list]');
if (guideDialog instanceof HTMLDialogElement && guideList) {
  for (const guide of CONNECTION_GUIDES) {
    const section = document.createElement('section');
    section.dataset.guideId = guide.id;
    const title = document.createElement('h3');
    title.textContent = guide.title;
    const steps = document.createElement('ol');
    steps.className = 'setup-guide-steps';
    steps.dataset.guideId = guide.id;
    for (const step of guide.steps) {
      const item = document.createElement('li');
      const label = document.createElement('strong');
      label.textContent = step.label;
      const body = document.createElement('span');
      for (const part of step.parts) {
        const node =
          part.kind === 'link'
            ? Object.assign(document.createElement('a'), { href: part.href, textContent: part.text, target: '_blank', rel: 'noreferrer' })
            : Object.assign(document.createElement(part.kind === 'code' ? 'code' : 'span'), { textContent: part.text });
        body.append(node);
      }
      item.append(label, body);
      steps.append(item);
    }
    section.append(title, steps);
    guideList.append(section);
  }
  document.querySelector('[data-connection-guide-open]')?.addEventListener('click', () => guideDialog.showModal());
}
// 이 페이지에 필요한 조작은 두 가지뿐이다. 펼침 목록과 가이드 목차 표시.
// 조작에 대한 답으로만 움직인다. 스크롤에 맞춰 나타나는 효과는 두지 않는다.

// 펼침 목록. 제목을 누르면 그 항목만 열리고, 오른쪽 화면 사진도 같이 바뀐다.
// 자바스크립트가 꺼져 있으면 첫 항목이 열린 채로 남는다. 글은 모두 HTML 안에 있다.
for (const group of document.querySelectorAll('[data-unfold]')) {
  const items = [...group.querySelectorAll('.unfold-item')];
  const shot = group.querySelector('[data-unfold-shot]');
  const caption = group.querySelector('[data-unfold-caption]');

  for (const item of items) {
    const head = item.querySelector('.unfold-head');
    head.addEventListener('click', () => {
      for (const other of items) {
        const open = other === item;
        other.dataset.open = String(open);
        other.querySelector('.unfold-head').setAttribute('aria-expanded', String(open));
      }
      if (shot) {
        shot.src = head.dataset.shot;
        shot.alt = head.dataset.alt || '';
      }
      if (caption) caption.textContent = head.dataset.caption || '';
    });
  }
}

// 가이드 목차. 지금 읽고 있는 구획을 표시한다.
const toc = document.querySelector('[data-toc]');
if (toc) {
  const links = new Map();
  for (const a of toc.querySelectorAll('a[href^="#"]')) {
    const target = document.getElementById(a.getAttribute('href').slice(1));
    if (target) links.set(target, a);
  }
  const mark = (current) => {
    for (const [, a] of links) a.removeAttribute('aria-current');
    if (current) current.setAttribute('aria-current', 'true');
  };
  const seen = new Set();
  const watch = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) seen.add(entry.target);
        else seen.delete(entry.target);
      }
      // 화면에 걸친 구획 가운데 가장 위에 있는 것을 현재로 본다.
      const top = [...seen].sort((a, b) => a.offsetTop - b.offsetTop)[0];
      mark(top ? links.get(top) : null);
    },
    { rootMargin: '-88px 0px -60% 0px' },
  );
  for (const [target] of links) watch.observe(target);
}
