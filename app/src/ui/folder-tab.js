// 가져오기·내보내기 창의 「폴더 연결」 탭 화면(CR-14 C, R-27). 상태와 동작은 folder-link.js(조정기)가 맡는다.

import { el } from './dom.js';
import { FOLDER_TEXT } from './folder-link.js';

/**
 * @param {{folder:object, app:object, dialog:HTMLDialogElement, onImported:(id:string)=>void}} o
 * @param {() => void} rerender 창을 다시 그리는 함수
 */
export function folderTab(o, rerender) {
  const f = o.folder;
  const fs = f.state;
  const wrap = el('div', { class: 'editor folder-tab', 'data-testid': 'folder-tab' });
  if (!fs.supported) {
    wrap.append(el('p', { class: 'muted small', 'data-testid': 'folder-unsupported' }, FOLDER_TEXT.unsupported));
    return wrap;
  }
  // 처음 쓰는 사람을 위한 세 줄(FU-11): 팀원 각자 → 팀장 → 원본은 어디인가
  const howto = el('ol', { class: 'folder-howto', 'data-testid': 'folder-howto' },
    el('li', { 'data-testid': 'folder-howto-member' }, '팀원 각자: 같은 공유 폴더(공유 드라이브·동기화 폴더)를 「폴더 연결」로 고르면, 저장할 때마다 자기 파일이 그 폴더에 생깁니다.'),
    el('li', { 'data-testid': 'folder-howto-leader' }, '팀장: 같은 폴더를 고르고 「새로 고침」 → 동료 파일에 체크 → 「팀 지도로 묶기」.'),
    el('li', { 'data-testid': 'folder-howto-origin' }, '원본은 각자 브라우저에 저장되고, 폴더에는 저장할 때마다 사본이 생깁니다. 브라우저 기록을 지워도 폴더 사본을 「가져오기」하면 돌아옵니다.'));
  const blocks = [howto, el('p', { class: 'muted small', 'data-testid': 'folder-intro' }, FOLDER_TEXT.intro)];
  if (!fs.handle) {
    blocks.push(el('div', { class: 'row' }, el('button', { type: 'button', class: 'primary', 'data-testid': 'folder-connect', onclick: () => f.connect() }, '폴더 연결')));
  } else if (fs.needsPermission) {
    blocks.push(
      el('p', { 'data-testid': 'folder-name' }, `연결한 폴더: ${fs.name}`),
      el('p', { class: 'muted small' }, '브라우저를 다시 열어 폴더 허락이 풀렸습니다. 다시 허락해야 저장과 읽기가 됩니다.'),
      el('div', { class: 'row' },
        el('button', { type: 'button', class: 'primary', 'data-testid': 'folder-reauth', onclick: () => f.reauthorize() }, '폴더 다시 허락'),
        el('button', { type: 'button', 'data-testid': 'folder-disconnect', onclick: () => f.disconnect() }, '연결 끊기')));
  } else {
    blocks.push(
      el('p', { 'data-testid': 'folder-name' }, `연결한 폴더: ${fs.name}`),
      el('p', { class: 'muted small', 'data-testid': 'folder-myfile' }, `내 파일: ${f.myFile()}${fs.lastSaved ? ' (저장됨)' : ''}`),
      el('div', { class: 'row' },
        el('button', { type: 'button', 'data-testid': 'folder-save', onclick: () => f.saveNow() }, '지금 저장'),
        el('button', { type: 'button', 'data-testid': 'folder-refresh', disabled: fs.busy, onclick: () => f.refresh() }, '새로 고침'),
        el('button', { type: 'button', 'data-testid': 'folder-disconnect', onclick: () => f.disconnect() }, '연결 끊기')));
    if (fs.changed) blocks.push(el('p', { class: 'notice', 'data-testid': 'folder-changed' }, FOLDER_TEXT.changed));
    if (fs.warning) blocks.push(el('p', { class: 'error-text', 'data-testid': 'folder-warning' }, fs.warning));
    const rows = fs.plan.map((p) => el('li', { class: 'folder-file', 'data-testid': 'folder-file', 'data-name': p.name },
      p.mine || !p.ok || p.current ? null
        : el('input', { type: 'checkbox', 'aria-label': `${p.name} 묶기`, 'data-testid': 'folder-check', checked: fs.selected.get(p.name) === true, onchange: (e) => f.setSelected(p.name, e.target.checked) }),
      el('strong', {}, p.name),
      p.mine ? el('span', { class: 'chip', 'data-testid': 'folder-mine' }, '내 파일') : null,
      p.current && !p.mine ? el('span', { class: 'chip' }, '지금 연 업무 지도와 같은 ID') : null,
      p.ok
        ? el('span', { class: 'muted small' }, ` ${p.universe.name} (${p.universe.level})${p.exists && !p.mine && !p.current ? ' · 이 브라우저에 같은 ID가 있어 덮어씀' : ''}`)
        : el('span', { class: 'error-text small', 'data-testid': 'folder-bad' }, ` 건너뜀 — ${p.reason}`)));
    blocks.push(
      el('h4', {}, `폴더의 파일 ${fs.plan.length}개`),
      rows.length
        ? el('ul', { class: 'folder-files', 'data-testid': 'folder-files' }, ...rows)
        : el('p', { class: 'muted small', 'data-testid': 'folder-empty' }, '폴더에 .json 파일이 없습니다.'));
    if (fs.notes.length) {
      const why = (n) => `${n.name}(${n.reason === 'too_big' ? '1MB 초과' : '읽기 실패'})`;
      blocks.push(el('p', { class: 'muted small', 'data-testid': 'folder-notes' }, `읽지 않은 파일 ${fs.notes.length}개: ${fs.notes.map(why).join(', ')}`));
    }
    const peers = fs.plan.filter((p) => p.ok && !p.mine && !p.current).length;
    const bundle = async () => {
      const r = await f.bundle({ confirm: (m) => window.confirm(m) });
      if (r.ok) {
        o.dialog.close();
        o.onImported(r.id);
      } else {
        fs.message = r.message;
        rerender();
      }
    };
    blocks.push(el('div', { class: 'row' },
      el('button', { type: 'button', class: 'primary', 'data-testid': 'folder-bundle', disabled: !peers || o.app.readOnly, onclick: bundle }, '팀 지도로 묶기'),
      el('span', { class: 'muted small' }, '체크한 동료 파일을 이 브라우저로 가져와 지금 업무 지도와 묶습니다.')));
  }
  if (fs.message) blocks.push(el('p', { class: 'error-text', 'data-testid': 'folder-message', role: 'status' }, fs.message));
  wrap.append(...blocks.filter(Boolean));
  return wrap;
}
