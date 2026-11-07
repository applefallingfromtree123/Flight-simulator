// Where career and airline flights start: at the gate (boarding, pushback, taxi, ATC) or straight on the runway.
export type DepMode = 'gate' | 'runway';
const KEY = 'sky.depMode';
export function getDepMode(): DepMode { try { return localStorage.getItem(KEY) === 'runway' ? 'runway' : 'gate'; } catch { return 'gate'; } }
function setDepMode(m: DepMode) { try { localStorage.setItem(KEY, m); } catch { /* ignore */ } }
export function depModeHtml() {
  const m = getDepMode();
  return `<div class="dep-mode"><span>출발 방식</span>
    <button data-dep="gate" class="${m === 'gate' ? 'on' : ''}">🧳 게이트 출발<small>탑승 · 푸시백 · 택시 · 관제</small></button>
    <button data-dep="runway" class="${m === 'runway' ? 'on' : ''}">⚡ 바로 출발<small>활주로에서 이륙 준비 완료</small></button></div>`;
}
export function bindDepMode(el: HTMLElement) {
  el.querySelectorAll<HTMLButtonElement>('[data-dep]').forEach(b => b.onclick = () => {
    setDepMode(b.dataset.dep as DepMode);
    el.querySelectorAll<HTMLButtonElement>('[data-dep]').forEach(x => x.classList.toggle('on', x === b));
  });
}
