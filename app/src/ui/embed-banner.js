// 내용 포함 HTML(CR-13 B)의 화면 쪽: 앱 HTML 원본 잡기, 내장 데이터 읽기, 읽기 전용 메모리 저장소, 안내 줄, 내 유니버스로 가져오기.
// 브라우저 기능(DOM·저장소)을 쓰므로 단위 테스트 대상이 아니다. 순수 부분은 view/embed.js.

import { createApp } from '../app/app.js';
import { CODES } from '../model/schema.js';
import { validateDocument } from '../model/validate.js';
import { createStore, openStorage } from '../store/local.js';
import { EMBED_ID, buildEmbed, insertEmbed, parseEmbed, stripEmbed } from '../view/embed.js';
import { el } from './dom.js';
import { josa } from './messages.js';

/**
 * 지금 문서의 HTML 원본(doctype·주석·<html>)을 글로 잡는다. 앱이 DOM을 고치기 전(start() 맨 처음)에 불러야 한다.
 * file://에서는 자기 파일을 fetch할 수 없으므로 파서가 만든 DOM을 다시 글로 만든다(스크립트·스타일은 글 그대로).
 */
export function captureAppHtml(doc) {
  const parts = [];
  for (const n of doc.childNodes) {
    if (n.nodeType === 10) parts.push('<!doctype html>');
    else if (n.nodeType === 8) parts.push(`<!--${n.data}-->`);
    else if (n.nodeType === 1) parts.push(n.outerHTML);
  }
  return stripEmbed(parts.join('\n'));
}

/** 문서에 내장 데이터가 있으면 읽는다. 없으면 null, 있으면 parseEmbed 결과 */
export function readEmbedFromDocument(doc) {
  const node = doc.getElementById(EMBED_ID);
  return node ? parseEmbed(node.textContent) : null;
}

export const EMBED_WARNINGS = {
  json: '이 파일에 담긴 업무 지도 데이터가 깨져 있어 읽지 못했습니다. 평소처럼 앱을 엽니다.',
  shape: '이 파일에 담긴 업무 지도 데이터 형식이 맞지 않아 읽지 못했습니다. 평소처럼 앱을 엽니다.',
  version: '이 파일에 담긴 업무 지도 데이터의 형식 버전이 이 앱과 달라 읽지 못했습니다. 평소처럼 앱을 엽니다.',
};

// 읽기 전용으로 보기용 저장소: 브라우저 저장소를 쓰지 않고 메모리(Map)에만 둔다
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } };
}

/**
 * 내장 문서를 메모리 저장소에 넣은 읽기 전용 앱.
 * 문서마다 검증해(RV10C-2) 형식이 깨진 문서는 빼고 연다 — 하나가 깨졌다고 화면 전체가 멈추지 않게. 뺀 문서는 app.warnings에
 * {code:'E-SCHEMA', reason:'embed_skipped', names, count}로 남긴다. 꼭지 문서가 깨졌으면 남은 문서 중 첫 번째를 연다.
 */
export function createEmbedApp(embed, { samples, currentId, now }) {
  const store = createStore(memoryStorage());
  const good = [];
  const skipped = [];
  for (const d of embed.docs) {
    let ok = false;
    try {
      ok = validateDocument(d).ok;
    } catch {
      ok = false; // 검증기가 못 읽을 만큼 깨진 문서도 뺀다
    }
    if (ok) good.push(d);
    else skipped.push(d);
  }
  const embedded = new Set(good.map((d) => d.universe.id));
  for (const d of good) store.saveUniverse(JSON.parse(JSON.stringify(d)));
  // 같은 ID의 내장 샘플은 보내 온 판을 그대로 보이게 한다(앱이 새 샘플로 바꿔 넣지 않게)
  const rest = samples.filter((s) => !embedded.has(s.universe.id));
  const open = embedded.has(currentId) || !good.length ? currentId : good[0].universe.id;
  const app = createApp({ store, samples: rest.length ? rest : samples, currentId: open, now, locked: true });
  if (skipped.length) app.warnings.push({ code: CODES.SCHEMA, reason: 'embed_skipped', count: skipped.length, names: skipped.map((d) => (d && d.universe && (d.universe.name || d.universe.id)) || '이름 없음') });
  return app;
}

/** 내려받을 HTML: 앱 원본 + 지금 유니버스와 하위 유니버스. 넣을 자리가 없으면 null */
export function embedHtmlFor(appHtml, app) {
  return insertEmbed(appHtml, buildEmbed(app.doc, (id) => app.docOf(id)));
}

/**
 * 내장 문서를 실제 저장소로 가져온다(하위 먼저, 기존 importUniverse). 같은 ID가 있으면 덮어쓸지 묻는다.
 * @returns {{ok:true}|{ok:false, message:string, cancelled?:boolean}}
 */
export function importEmbedToStorage(embed, { samples, now, confirm = (m) => window.confirm(m) }) {
  const storage = openStorage(() => window.localStorage);
  if (!storage) return { ok: false, message: '이 브라우저의 저장소를 쓸 수 없어 가져올 수 없습니다.' };
  const app = createApp({ store: createStore(storage), samples, currentId: embed.root, now });
  if (app.readOnly) return { ok: false, message: '저장소에 쓸 수 없어 가져올 수 없습니다.' };
  // 먼저 모두 미리 확인하고(검증 오류가 있으면 하나도 가져오지 않는다), 같은 ID는 한 번에 묻는다
  const previews = embed.docs.map((d) => ({ d, p: app.previewImport(d) }));
  const bad = previews.find((x) => !x.p.ok);
  if (bad) return { ok: false, message: `「${bad.d.universe.name}」${josa(bad.d.universe.name, '은/는')} 형식 검사를 통과하지 못해 가져오지 않았습니다.` };
  const conflicts = previews.filter((x) => x.p.conflict);
  if (conflicts.length && !confirm(`같은 ID의 업무 지도가 이미 있습니다: ${conflicts.map((x) => `「${x.p.conflict.name}」`).join(', ')}. 덮어쓸까요? 덮어쓰면 그 업무 지도에 고친 내용은 사라집니다.`)) {
    return { ok: false, cancelled: true, message: '가져오기를 취소했습니다.' };
  }
  let done = 0;
  for (const { d, p } of previews) {
    const r = app.importUniverse(d, { overwrite: !!p.conflict });
    // 중간에 실패하면 앞에서 가져온 것은 그대로 남는다(되돌리지 않음) — 몇 개인지 알린다(folder-link.js와 같은 문구, RV10S-10)
    if (!r.ok) return { ok: false, message: `「${d.universe.name}」를 가져오지 못했습니다${done ? `(앞의 ${done}개는 이미 가져왔습니다)` : ''}.` };
    done += 1;
  }
  return { ok: true };
}

/** 머리글 아래 안내 줄. canImport가 false면 단추를 막고 이유를 보인다 */
export function renderEmbedBanner(slot, { name, canImport, reason, onImport }) {
  const children = [
    el('span', { 'data-testid': 'embed-text' }, `이 파일에 담긴 「${name}」${josa(name, '을/를')} 보고 있습니다(읽기 전용). 고치려면 「내 업무 지도로 가져오기」`),
    ' ',
    el('button', { type: 'button', class: 'primary', 'data-testid': 'embed-import', disabled: !canImport, onclick: onImport }, '내 업무 지도로 가져오기'),
  ];
  if (!canImport && reason) children.push(' ', el('span', { 'data-testid': 'embed-reason' }, reason));
  children.push(el('span', { 'data-testid': 'embed-message', class: 'embed-message', 'aria-live': 'polite' }));
  slot.replaceChildren(...children);
  slot.hidden = false;
}
