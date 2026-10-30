// 업무잇다 브라우저 자동 점검(CR-24). 사용: npm run check:chrome   (CHECK_PORT 또는 첫 인자로 포트, 기본 9851)
// dist-single/index.html(npx vite build --mode single)을 file://로 열어 화면을 실제로 눌러 본다.
// 'DevTools 연결 실패'가 나면 다른 포트로 다시: CHECK_PORT=9861 npm run check:chrome
// 앱 소스는 고치지 않는다. 결함은 FAIL로 보고만 한다. 자기 임시 프로필로 띄운 Chrome만 정리한다.
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch, sleep, waitFor } from './cdp.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = resolve(ROOT, '../.tmp/itda-check');
const port = Number(process.argv[2] || process.env.CHECK_PORT || 9851);
const HTML = resolve(ROOT, 'dist-single/index.html');

if (!process.env.CHECK_NO_BUILD || !existsSync(HTML)) {
  console.log('빌드: npx vite build --mode single');
  try { execSync('npx vite build --mode single', { cwd: ROOT, stdio: 'ignore' }); } catch (e) { console.log('빌드 실패 — 먼저 npm run single 로 오류를 확인하세요'); process.exit(2); }
}
await mkdir(SHOTS, { recursive: true });

let b;
try { b = await launch({ port, profile: `C:/AI/work-universe/.tmp/itda-check-${port}` }); }
catch (e) { console.log(`${e.message} — 다른 포트로 다시 시도하세요(예: CHECK_PORT=${port + 10} npm run check:chrome)`); process.exit(2); }
const { cdp, ev, logs } = b;

// ---------- 페이지 안 도우미 ----------
const HELPERS = `
(() => {
  const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const vis = (e) => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
  window.__h = {
    find(sel, text, exact) {
      return [...document.querySelectorAll(sel)].filter(vis).find((e) => { const t = norm(e.textContent); return exact ? t === text : t.includes(text); }) || null;
    },
    click(sel, text, exact) { const e = this.find(sel, text, exact); if (!e) return false; e.click(); return true; },
    clickId(id) { const e = document.querySelector('[data-testid="' + id + '"]'); if (!e) return false; e.click(); return true; },
    setVal(el, v) {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
      el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    },
    setId(id, v) { const e = document.querySelector('[data-testid="' + id + '"]'); if (!e) return false; this.setVal(e, v); return true; },
    user(name) {
      const s = document.getElementById('user-switch'); const o = [...s.options].find((x) => x.textContent.includes(name));
      if (!o) return false; this.setVal(s, o.value); return true;
    },
    go(hash) { if (location.hash !== hash) { window.__itdaMap = null; location.hash = hash; } },
    cy() { return window.__itdaMap && window.__itdaMap.graph && window.__itdaMap.graph.cy; },
    nodes() { const cy = this.cy(); return cy ? cy.nodes().length : -1; },
    edges() { const cy = this.cy(); return cy ? cy.edges().length : -1; },
    labels() { const cy = this.cy(); return cy ? cy.nodes().map((n) => n.data('label')) : []; },
    node(label) { const cy = this.cy(); if (!cy) return null; const ex = cy.nodes().filter((n) => String(n.data('label')) === label); return ex.length ? ex : cy.nodes().filter((n) => String(n.data('label')).includes(label)); },
    tap(label) { const n = this.node(label); if (!n || !n.length) return false; n.first().emit('tap'); return true; },
    text() { return norm(document.body.innerText); },
    has(t) { return this.text().includes(t); },
  };
})()`;

const run = (js) => ev(`(${js})`);
const H = (call) => ev(`window.__h.${call}`);
const wait = (expr, ms) => waitFor(ev, expr, ms);
const must = async (cond, msg) => { if (!cond) throw new Error(msg); };

async function fresh() {
  await cdp.send('Page.navigate', { url: pathToFileURL(HTML).href });
  await wait('document.readyState === "complete" && document.querySelector("#root")?.children.length > 0', 15000);
  // CHECK_MAP_STYLE=basic|space|clean|mix: 유니버스 화면 시안을 켠 채로 점검(없으면 기본값 가+나)
  // CHECK_THEME=light|dark: 화면 밝기를 고정한 채로 점검(16번은 자동에서 시작하므로 건너뜀)
  await ev(`localStorage.clear(); ${/^(basic|space|clean|mix)$/.test(process.env.CHECK_MAP_STYLE || '') ? `localStorage.setItem('itda-map-style', '${process.env.CHECK_MAP_STYLE}');` : ''} ${/^(light|dark)$/.test(process.env.CHECK_THEME || '') ? `localStorage.setItem('itda-theme', '${process.env.CHECK_THEME}');` : ''} true`);
  await cdp.send('Page.reload');
  await sleep(300);
  await wait('document.readyState === "complete" && document.querySelector("#root")?.children.length > 0 && !!document.getElementById("user-switch")', 15000);
  await ev(HELPERS);
  await sleep(300);
}

async function shot(name) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(resolve(SHOTS, `${name}.png`), Buffer.from(data, 'base64'));
}

async function nav(hash, readyExpr, ms = 8000) {
  await H(`go(${JSON.stringify(hash)})`);
  await sleep(300);
  if (readyExpr) { const ok = await wait(readyExpr, ms); await must(ok, `화면 준비 실패: ${hash} (${readyExpr})`); }
}
const mapReady = 'window.__h.nodes() > 0';

// ---------- 점검 틀 ----------
const results = [];
const detail = (...a) => a.join(' ');
async function check(name, fn, { keepState = false } = {}) {
  // CHECK_ONLY=20 처럼 번호를 주면 그 점검만 돌린다(개발 중 빠른 확인용). 비우면 전부
  if (process.env.CHECK_ONLY && !process.env.CHECK_ONLY.split(',').some((x) => name.startsWith(x.trim()))) return;
  const start = logs.length;
  let ok = true, note = '';
  try {
    if (!keepState) await fresh();
    const out = await fn();
    note = out || '';
  } catch (e) {
    ok = false; note = String(e.message || e).split('\n')[0];
    try { await shot(`FAIL-${name}`); } catch {}
  }
  const errs = logs.slice(start).filter((l) => l.kind === 'exception' || l.kind === 'error');
  if (errs.length) { ok = false; note += ` | 콘솔 오류 ${errs.length}건: ` + errs.slice(0, 3).map((l) => `[${l.kind}] ${String(l.text).slice(0, 160)}`).join(' / '); }
  results.push({ name, ok, note });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ' — ' + note : ''}`);
}

const MENUS = [
  ['대시보드', '/dashboard'], ['업무 관리', '/works'], ['문서함', '/docs'], ['업무 타임라인', '/timeline'],
  ['회의록', '/meetings'], ['AI 업무 검색', '/search'], ['업무 인계 관리', '/handover'], ['업무 유니버스', '/universe'],
];

try {
  // 1
  await check('01 메뉴 8개', async () => {
    const seen = [];
    for (const [label, path] of MENUS) {
      await ev('window.__itdaMap = null; true');
      const ok = await H(`click('nav a', ${JSON.stringify(label)}, true)`);
      await must(ok, `메뉴 없음: ${label}`);
      await sleep(900);
      const hash = await ev('location.hash');
      await must(hash.startsWith('#' + path), `${label}: 경로 ${hash}`);
      const len = await ev('document.querySelector("main")?.innerText.length ?? document.body.innerText.length');
      await must(len > 40, `${label}: 화면이 비어 있음`);
      await shot(`01-메뉴-${label}`);
      seen.push(label);
    }
    return `${seen.length}개 열림`;
  });

  // 2
  await check('02 김도윤 내 지도·조직 지도(팀 → 부 → 본부 → 회사)', async () => {
    await nav('#/universe', mapReady);
    // 첫 범위는 자기 소속 조직(사용자 결정 2026-10-29) → 「내 지도」 칩으로 바꿔 본다
    const first = await H('labels()');
    await must(first.some((l) => String(l).includes('디지털신원팀')), `첫 범위가 소속 팀이 아님: ${first.slice(0, 5).join('|')}`);
    await must(await H(`click('button', '내 지도')`), '「내 지도」 칩 없음');
    await must(await wait(`window.__h.labels().some((l) => String(l).includes('김도윤의 업무'))`, 6000), '내 지도로 안 바뀜');
    const labels = await H('labels()');
    const n = await H('nodes()');
    await must(n > 3, `노드 ${n}개`);
    await shot('02-내지도');
    // 조직 지도는 모두가 본다(2026-10-29) — 팀원 김도윤도 자기 팀부터 회사까지 칩이 있다
    for (const c of ['디지털신원팀 · 업무', '전자금융부 · 업무', '결제서비스본부 · 업무', '우리 기관 · 업무']) await must(await ev(`!!window.__h.find('button', ${JSON.stringify(c)})`), `범위 칩 「${c}」 없음`);
    await must(await H(`click('button', '디지털신원팀 · 업무')`), '팀 칩 누르기 실패');
    await must(await wait(`window.__h.nodes() > 3 && window.__h.labels().some((l) => String(l).includes('디지털신원팀'))`, 6000), '팀원에게 팀 지도가 안 보임');
    await shot('02-팀지도-팀원');
    // 회사 지도: 처음엔 본부 둘만 접혀 있고, 본부 사이 연결이 선으로 보인다
    await must(await H(`click('button', '우리 기관 · 업무')`), '회사 칩 누르기 실패');
    await must(await wait(`window.__h.labels().some((l) => String(l).includes('경영지원본부'))`, 6000), '회사 지도에 본부가 없음');
    await sleep(600);
    const top = await ev(`(() => { const cy = window.__h.cy(); return { works: cy.nodes().filter((x) => x.data('core_type') === 'work').length, roots: cy.nodes().filter((x) => x.data('core_type') === 'root').map((x) => x.data('label')), cross: cy.edges().filter((e) => { const ab = String(e.source().data('label')) + '|' + String(e.target().data('label')); return ab.includes('결제서비스본부') && ab.includes('경영지원본부'); }).length }; })()`);
    await must(top.works === 0, `회사 지도 첫 화면에 업무 ${top.works}개(접혀 있어야 함)`);
    await must(top.cross > 0, '본부 사이 연결 선 없음');
    await shot('02-회사지도');
    // 본부를 두 번 누르면 부가 펼쳐진다
    const before = await H('nodes()');
    await ev(`(() => { const t = window.__h.node('결제서비스본부').first(); t.emit('dbltap'); return true; })()`);
    await must(await wait(`window.__h.labels().some((l) => String(l).includes('전자금융부'))`, 4000), `본부를 펼쳐도 부가 안 보임(노드 ${before})`);
    await shot('02-회사지도-본부펼침');
    return `노드 ${n}, 중심 「김도윤의 업무」 / 회사 지도 본부 [${top.roots.join(', ')}], 본부 사이 선 ${top.cross}`;
  });

  // 3
  await check('03 팀장 팀·부서 지도·위험 점검·펼침', async () => {
    await must(await H(`user('박지훈')`), '박지훈 전환 실패');
    await nav('#/universe', mapReady);
    await sleep(800);
    // 팀장 첫 범위는 소속 팀 → 부 칩으로 두 팀을 함께 본다
    const firstRoots = await ev(`window.__h.cy().nodes().filter((n) => n.data('core_type') === 'root').map((n) => n.data('label'))`);
    await must(firstRoots.some((l) => l.includes('디지털신원팀')) && !firstRoots.some((l) => l.includes('출금이체팀')), `팀장 첫 범위가 소속 팀이 아님: ${firstRoots.join('|')}`);
    await must(await H(`click('button', '전자금융부 · 업무')`), '부 칩 누르기 실패');
    await wait(`window.__h.cy().nodes().filter((n) => n.data('core_type') === 'root').some((n) => String(n.data('label')).includes('출금이체팀'))`, 6000);
    await sleep(500);
    const roots = await ev(`(() => { const cy = window.__h.cy(); return cy.nodes().filter((n) => n.data('core_type') === 'root').map((n) => n.data('label')); })()`);
    await must(roots.some((l) => l.includes('디지털신원팀')) && roots.some((l) => l.includes('출금이체팀')), `팀 중심: ${roots.join('|')}`);
    const risk = await ev(`(document.querySelector('[data-testid="map-risk"]')||{}).innerText || ''`);
    await must(risk.includes('혼자만 아는 일'), '위험 패널에 「혼자만 아는 일」 없음');
    const items = await ev(`document.querySelectorAll('[data-testid="insight-item"]').length`);
    await must(items > 0, '인계 위험 인사이트 목록 비어 있음');
    // Claude 인사이트: 키 없는 점검 프로필 → 단추 없이 안내 한 줄(외부 호출 없음)
    await must(await ev(`!!document.querySelector('[data-testid="insight-claude-hint"]')`), 'Claude 인사이트 안내 없음(키 없음)');
    await must(await ev(`!document.querySelector('[data-testid="claude-insight-run"]')`), '키가 없는데 「Claude로 더 찾기」 단추가 보임');
    for (const k of ['bottleneck', 'dense', 'gap']) await must(await ev(`!(document.querySelector('[data-testid="insight-kind-${k}"]')||{disabled:true}).disabled`), `인사이트 종류 ${k} 0건`);
    await shot('03-팀장-접힘');
    const before = await H('nodes()');
    await ev(`(() => { const cy = window.__h.cy(); const t = cy.nodes().filter((n) => n.data('core_type') === 'root' && n.data('label').includes('디지털신원팀'))[0]; t.emit('dbltap'); return true; })()`);
    const grew = await wait(`window.__h.nodes() > ${before}`, 4000);
    await sleep(500);
    await shot('03-팀장-펼침');
    await must(grew, `dbltap 후 노드 수 그대로(${before})`);
    // 인사이트 항목을 누르면 근거가 노랗게 강조되고 카드가 열린다
    await ev(`document.querySelector('[data-testid="insight-kind-bottleneck"]').click()`);
    await sleep(200);
    await ev(`document.querySelector('[data-testid="insight-item"]').click()`);
    const lit = await wait(`window.__h.cy().nodes('.mk-issue').length > 0`, 3000);
    await shot('03-팀장-인사이트-강조');
    await must(lit, '인사이트 항목을 눌러도 지도 강조 없음');
    await ev(`document.querySelector('[data-testid="insight-item"]').click()`);
    await ev(`document.querySelector('[data-testid="insight-kind-all"]').click()`);
    return `팀 중심 [${roots.join(', ')}], 목록 ${items}건, 노드 ${before}→${await H('nodes()')}`;
  });

  // 4
  await check('04 지도에서 고치기(메모·주제·잇기·숨기기)', async () => {
    await nav('#/universe', mapReady);
    const MEMO = '점검메모-' + Date.now().toString().slice(-6);
    await must(await H(`tap('비대면 출금동의 추진')`), '업무 노드 없음');
    await must(await wait(`!!document.querySelector('[data-testid="map-card"]')`, 3000), '카드 안 열림');
    const title = await ev(`document.querySelector('[data-testid="map-card-title"]').innerText`);
    await must(title.includes('비대면 출금동의 추진'), `카드 제목: ${title}`);
    // 메모
    await must(await H(`clickId('map-edit-memo')`), '메모 남기기 단추 없음');
    await must(await wait(`!!document.querySelector('[data-testid="map-memo-text"]')`, 2000), '메모 입력란 없음');
    await H(`setId('map-memo-text', ${JSON.stringify(MEMO)})`);
    await sleep(150);
    await must(await H(`clickId('map-memo-save')`), '메모 저장 단추 없음');
    await sleep(500);
    await nav('#/works/W-001');
    await sleep(800);
    let found = await H(`has(${JSON.stringify(MEMO)})`);
    if (!found) { // 다른 탭에 있을 수 있음
      for (const t of ['개요', '유의사항', '유의 사항']) { if (await H(`click('button, a', ${JSON.stringify(t)}, true)`)) { await sleep(400); if (await H(`has(${JSON.stringify(MEMO)})`)) { found = true; break; } } }
    }
    await must(found, '업무 상세에서 메모 글을 못 찾음');
    await shot('04-메모-업무상세');
    // 주제
    await nav('#/universe', mapReady);
    const n0 = await H('nodes()');
    await must(await H(`tap('비대면 출금동의 추진')`), '업무 노드 재선택 실패');
    await wait(`!!document.querySelector('[data-testid="map-card"]')`, 3000);
    await must(await H(`clickId('map-edit-topic')`), '주제 붙이기 단추 없음');
    await must(await wait(`!!document.querySelector('[data-testid="map-topic-text"]')`, 2000), '주제 입력란 없음');
    const TOPIC = '점검주제' + Date.now().toString().slice(-4);
    await H(`setId('map-topic-text', ${JSON.stringify(TOPIC)})`);
    await sleep(150);
    await must(await H(`clickId('map-topic-save')`), '주제 저장 단추 없음');
    const topicOk = await wait(`window.__h.labels().some((l) => String(l).includes(${JSON.stringify(TOPIC)}))`, 4000);
    await must(topicOk, '지도에 주제 노드 안 생김');
    const n1 = await H('nodes()');
    // 업무 잇기
    await must(await H(`tap('비대면 출금동의 추진')`), '업무 노드 재선택 실패(2)');
    await wait(`!!document.querySelector('[data-testid="map-card"]')`, 3000);
    await must(await H(`clickId('map-edit-link')`), '업무 잇기 단추 없음');
    let linkNote = '';
    if (!(await wait(`!!document.querySelector('[data-testid="map-link-to"]')`, 1500))) {
      const msg = await ev(`(document.querySelector('[data-testid="map-edit-link"]').closest('[data-testid="map-card"]')||document.body).innerText.includes('이을 다른 업무가 없습니다')`);
      await must(msg, '잇기 폼도 안내 문구도 없음');
      linkNote = '(김도윤은 볼 수 있는 업무가 1건뿐이라 이을 후보 없음 → 박지훈 팀 지도로 대신 점검) ';
      await must(await H(`user('박지훈')`), '박지훈 전환 실패');
      await nav('#/universe', mapReady);
      await H(`click('button', '팀·부서 지도')`);
      await sleep(1200);
      await ev(`(() => { window.__h.cy().nodes().filter((n) => n.data('core_type') === 'root').forEach((n) => n.emit('dbltap')); return true; })()`);
      await sleep(1000);
      await must(await H(`tap('비대면 출금동의 추진')`), '팀 지도에서 업무 노드 없음');
      await wait(`!!document.querySelector('[data-testid="map-edit-link"]')`, 3000);
      await must(await H(`clickId('map-edit-link')`), '업무 잇기 단추 없음(팀장)');
      await must(await wait(`!!document.querySelector('[data-testid="map-link-to"]')`, 2000), '잇기 폼 없음(팀장)');
    }
    const e0 = await H('edges()');
    const opts = await ev(`[...document.querySelector('[data-testid="map-link-to"]').options].map((o) => o.value + ':' + o.textContent)`);
    const pick = opts.find((o) => o.split(':')[0]) ;
    await must(pick, '이을 업무 후보 없음');
    await H(`setId('map-link-to', ${JSON.stringify(pick.split(':')[0])})`);
    await sleep(150);
    await must(await H(`clickId('map-link-save')`), '잇기 저장 단추 없음');
    await sleep(800);
    const e1 = await H('edges()');
    const n2 = await H('nodes()');
    await must(e1 > e0 || n2 > n1, `잇기 후 선/노드 증가 없음 (edges ${e0}→${e1}, nodes ${n1}→${n2}, 선택: ${pick})`);
    await shot('04-잇기후');
    if (linkNote) { await ev('window.__itdaMap = null; true'); await must(await H(`user('김도윤')`), '김도윤 복귀 실패'); await sleep(500); await H(`click('button', '내 지도')`); await must(await wait(mapReady, 6000), '김도윤 지도 안 그려짐'); await sleep(800); }
    // 숨기기
    await must(await H(`tap('비대면 출금동의 추진')`), '업무 노드 재선택 실패(3)');
    await wait(`!!document.querySelector('[data-testid="map-card"]')`, 3000);
    await must(await H(`clickId('map-hide')`), '숨기기 단추 없음');
    const gone = await wait(`!window.__h.labels().some((l) => String(l) === '비대면 출금동의 추진')`, 4000);
    await must(gone, '숨긴 뒤에도 노드가 지도에 남음');
    await shot('04-숨긴후');
    await nav('#/works/W-001');
    await sleep(600);
    await must(await H(`has('비대면 출금동의 추진')`), '숨긴 뒤 업무 화면에서 업무가 사라짐');
    return `${linkNote}메모 반영, 주제(노드 ${n0}→${n1}), 잇기(선 ${e0}→${e1}, 노드 ${n1}→${n2}, 선택 ${pick}), 숨기기 후 업무 화면 유지`;
  });

  // 5
  await check('05 업무 상세 업무 지도 탭', async () => {
    await nav('#/works/W-001?tab=map', `!!document.querySelector('[data-testid="itda-workmap"]') && window.__h.nodes() > 0`);
    await sleep(600);
    const labels = await H('labels()');
    const name = await ev(`(document.querySelector('h1')||{}).innerText || ''`);
    const center = await ev(`(() => { const cy = window.__h.cy(); return cy.nodes().filter((n) => n.data('core_type') === 'root').map((n) => n.data('label')); })()`);
    await shot('05-업무지도탭');
    await must(center.length >= 1 && center.some((c) => String(c).includes('비대면 출금동의')), `지도 중심: ${center.join('|')} (제목 ${name})`);
    return `노드 ${labels.length}, 중심 ${center.join('|')}`;
  });

  // 6
  await check('06 스냅샷 인계 당시 ↔ 지금 지도', async () => {
    // 출금이체팀 인계(HO-002) — 조직 기준 열람(2026-10-29): 같은 부의 부장 서지안이 본다(다른 팀 팀장 박지훈은 못 봄)
    await must(await H(`user('서지안')`), '서지안 전환 실패');
    await nav('#/snapshots/S-101', `!!document.querySelector('[data-testid="snapshot-maps"]')`);
    await sleep(1500);
    const two = await ev(`!!document.querySelector('[data-testid="snapshot-map-then"]') && !!document.querySelector('[data-testid="snapshot-map-now"]')`);
    await must(two, 'then/now 지도 컨테이너 없음');
    const info = await ev(`(() => { const cy = window.__h.cy(); const box = cy.container(); const id = box.getAttribute('data-testid'); return { id, past: cy.edges('.past').length, nodes: cy.nodes().length }; })()`);
    await shot('06-스냅샷-비교');
    await must(info.id === 'snapshot-map-now', `__itdaMap이 가리키는 지도: ${info.id} (도구 한계: 마지막 그려진 지도만 접근)`);
    await must(info.past >= 1, `지금 지도의 past 선 ${info.past}개`);
    return `지금 지도 노드 ${info.nodes}, past 선 ${info.past}`;
  });

  // 7
  await check('07 대시보드 기록 점검·인계 위험 인사이트', async () => {
    await must(await H(`user('박지훈')`), '박지훈 전환 실패');
    await nav('#/dashboard', `window.__h.has('인계 위험 인사이트')`);
    await sleep(500);
    await must(await ev(`window.__h.has('기록 점검')`), '「기록 점검」 카드 없음');
    await must(!(await ev(`window.__h.has('AI가 발견한')`)), '규칙 결과에 「AI가 발견한」 이름이 남음');
    const n = await ev(`document.querySelectorAll('[data-testid="dash-insight-item"]').length`);
    const solo = await ev(`(document.querySelector('[data-testid="dash-insights"]')?.innerText.match(/혼자만 아는 일/g) || []).length`);
    await shot('07-대시보드-팀장');
    await must(n >= 1 && solo >= 1, `인사이트 ${n}건, 혼자만 아는 일 ${solo}`);
    return `인사이트 ${n}건(혼자만 아는 일 표시 ${solo}곳)`;
  });

  // 8
  await check('08 AI 설정·키가 내보내기에 안 섞임', async () => {
    await must(await H(`clickId('ai-settings-open')`), '열쇠 단추 없음');
    await wait(`!!document.querySelector('[data-testid="ai-key-status"]')`, 3000);
    let st = await ev(`document.querySelector('[data-testid="ai-key-status"]').innerText`);
    await must(st.includes('키 없음'), `처음 상태: ${st}`);
    await H(`setId('ai-key-input', 'sk-ant-test-0000')`);
    await sleep(150);
    await must(await H(`clickId('ai-key-save')`), '키 저장 단추 없음');
    await wait(`document.querySelector('[data-testid="ai-key-status"]')?.innerText.includes('키 있음')`, 4000);
    st = await ev(`document.querySelector('[data-testid="ai-key-status"]')?.innerText || '(상태 없음: 창이 닫혔을 수 있음)'`);
    if (!st.includes('키 있음')) { await H(`clickId('ai-settings-open')`); await sleep(400); st = await ev(`document.querySelector('[data-testid="ai-key-status"]')?.innerText || ''`); }
    await must(st.includes('키 있음'), `저장 뒤 상태: ${st}`);
    const eng = await ev(`(() => { const c = document.querySelector('[data-testid="engine-claude"]'); const r = document.querySelector('[data-testid="engine-rule"]'); return { c: c && c.className, r: r && r.className, ct: c && c.getAttribute('aria-pressed') }; })()`);
    await must(eng.c && /bg-brand/.test(eng.c) && !/bg-brand/.test(eng.r || ''), `Claude 엔진 선택 표시 아님: ${JSON.stringify(eng)}`);
    await shot('08-AI설정');
    await must(await ev(`!!document.querySelector('[data-testid="ai-internal-note"]')`), 'AI 설정에 사내 LLM 안내 없음');
    // 사내 LLM(자리만): 고르면 「사내」 칸이 칠해지고 실제 동작은 규칙 — 안내 문구가 바뀐다. 다시 Claude로 돌려놓는다
    await must(await H(`clickId('engine-internal')`), '사내 엔진 단추 없음');
    await sleep(300);
    const inn = await ev(`(() => { const g = document.querySelector('[data-testid="engine-toggle"]'); const n = document.querySelector('[data-testid="engine-note"]'); return { v: g && g.dataset.value, c: document.querySelector('[data-testid="engine-claude"]').className, note: n ? n.innerText : '' }; })()`);
    await must(inn.v === 'internal' && !/bg-brand/.test(inn.c) && inn.note.includes('사내 AI'), `사내 엔진 선택 표시·안내 아님: ${JSON.stringify(inn)}`);
    await must(await H(`clickId('engine-claude')`), 'Claude 엔진 단추 없음');
    await sleep(300);
    await must((await ev(`document.querySelector('[data-testid="engine-toggle"]').dataset.value`)) === 'claude', 'Claude로 되돌리지 못함');
    // 창 닫기 → 데이터 옮기기
    await ev(`(() => { const e = window.__h.find('button','닫기') || window.__h.find('button','취소'); if (e) e.click(); else document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); return true; })()`);
    await sleep(400);
    await must(await H(`click('button', '데이터 옮기기')`), '데이터 옮기기 단추 없음');
    await wait(`!!document.querySelector('textarea[aria-label="백업 데이터"]')`, 3000);
    const json = await ev(`document.querySelector('textarea[aria-label="백업 데이터"]').value`);
    await must(json.length > 100, '내보내기 JSON이 비어 있음');
    await must(!json.includes('sk-ant'), '내보내기 JSON에 sk-ant 문자열이 섞임');
    const ls = await ev(`Object.keys(localStorage).join(',')`);
    await ev(`(() => { const e = window.__h.find('button','닫기'); if (e) e.click(); return true; })()`);
    await sleep(300);
    await H(`clickId('ai-settings-open')`);
    await wait(`!!document.querySelector('[data-testid="ai-key-clear"]')`, 3000);
    await must(await H(`clickId('ai-key-clear')`), '키 지우기 단추 없음');
    await sleep(500);
    return `내보내기 ${json.length}자에 sk-ant 없음, localStorage 키: ${ls}`;
  });

  // 9
  const MINUTES = `대사 확인 개선 회의록
일시: 2026. 10. 26.(월) 10:00 / 작성 부서: 가상정산팀
1. 회의 목적
월말 대사 확인에서 반복되는 불일치를 줄이는 방안을 정한다.
2. 결정 사항
① 불일치 건은 원인 코드를 붙여 기록한다.
② 대사 결과는 보고 전에 두 사람이 확인한다.
3. 후속 조치
과제 담당 기한
불일치 원인 코드표 정리 서하늘 2026. 11. 6.
대사 결과 이중 확인 절차 마련 윤바다 2026. 11. 13.
4. 유의 사항
대사 불일치가 3건 이상이면 보고 전에 팀장에게 먼저 알린다.`;
  await check('09 키 없는 문서 분석(규칙)·표 담당', async () => {
    await nav('#/docs', `window.__h.has('문서')`);
    await must(await H(`click('button', '문서 등록')`), '문서 등록 단추 없음');
    await must(await wait(`!!document.getElementById('dr-text')`, 4000), '등록 창 없음');
    await ev(`window.__h.setVal(document.getElementById('dr-text'), ${JSON.stringify(MINUTES)}); true`);
    await ev(`window.__h.setVal(document.getElementById('dr-title'), '대사 확인 개선 회의록(점검)'); true`);
    await sleep(300);
    await must(await H(`click('button', 'AI 분석')`), 'AI 분석 단추 없음(비활성일 수 있음)');
    const ok = await wait(`document.querySelectorAll('[data-testid="proposal-owner"]').length >= 1`, 20000);
    await sleep(500);
    await shot('09-문서분석-미리보기');
    await must(ok, '향후 조치 제안(담당 select) 안 나옴');
    const owners = await ev(`[...document.querySelectorAll('[data-testid="proposal-owner"]')].map((s) => s.options[s.selectedIndex].textContent + ' | value=' + s.value)`);
    await must(owners.length >= 2, `조치 제안 ${owners.length}건: ${owners.join(' / ')}`);
    await must(owners.some((o) => o.includes('서하늘') || o.includes('윤바다')), `담당에 서하늘/윤바다 없음: ${owners.join(' / ')}`);
    return `조치 ${owners.length}건 — ${owners.join(' / ')}`;
  });

  // 10
  await check('10 합쳐 불러오기', async () => {
    await must(await H(`click('button', '데이터 옮기기')`), '데이터 옮기기 단추 없음');
    await wait(`!!document.querySelector('textarea[aria-label="백업 데이터"]')`, 3000);
    // 가져온 파일의 첫 업무를 다른 사람이 고친 것처럼(현재 상황 한 줄 더함·요약 고침) — '내용이 다른 칸'이 나오는지 본다
    const json = await ev(`(() => { const d = JSON.parse(document.querySelector('textarea[aria-label="백업 데이터"]').value); const w = d.works[0]; w.summary = (w.summary || '') + ' (다른 쪽에서 고친 요약)'; if (w.current.length) w.current.push({ ...w.current[0], id: 's-chk-1', text: '다른 담당자가 더한 현재 상황(점검용)' }); return JSON.stringify(d); })()`);
    const worksBefore = await ev(`JSON.parse(document.querySelector('textarea[aria-label="백업 데이터"]').value).works.length`);
    await must(await H(`click('button', '불러오기', true)`), '불러오기 탭 없음');
    await sleep(300);
    await must(await H(`click('[data-testid="merge-mode"] label', '합쳐 불러오기')`), '합쳐 불러오기 선택 불가');
    await sleep(200);
    await ev(`window.__h.setVal(document.getElementById('dt-paste'), ${JSON.stringify(json)}); true`);
    await must(await wait(`!!document.querySelector('[data-testid="merge-preview"]')`, 4000), '미리 보기 안 나옴');
    const prev = await ev(`document.querySelector('[data-testid="merge-preview"]').innerText.replace(/\\s+/g,' ').slice(0, 400)`);
    const cf = await ev(`[...document.querySelectorAll('[data-testid="merge-conflict"]')].map((e) => e.dataset.field + ':' + e.querySelectorAll('[data-testid="merge-conflict-choice"]').length).join(',')`);
    await must(cf === 'current:3,summary:2', `다른 칸 구역이 기대와 다름: ${cf}`);
    await shot('10-합치기-미리보기');
    await ev(`document.querySelector('[data-testid="merge-conflicts"]').scrollIntoView({ block: 'center' }); true`);
    await shot('10-합치기-다른칸');
    await must(await H(`clickId('merge-confirm')`), '합쳐 불러오기 확인 단추 없음');
    await sleep(800);
    await H(`click('button', '데이터 옮기기')`);
    await sleep(400);
    await H(`click('button', '내보내기', true)`);
    await wait(`!!document.querySelector('textarea[aria-label="백업 데이터"]')`, 3000);
    const worksAfter = await ev(`JSON.parse(document.querySelector('textarea[aria-label="백업 데이터"]').value).works.length`);
    const usersAfter = await ev(`JSON.parse(document.querySelector('textarea[aria-label="백업 데이터"]').value).users.length`);
    await must(worksAfter === worksBefore, `업무 수 ${worksBefore}→${worksAfter} (같은 업무는 합쳐져야 함)`);
    const kept = await ev(`JSON.parse(document.querySelector('textarea[aria-label="백업 데이터"]').value).works.some((w) => w.current.some((x) => x.text.includes('다른 담당자가 더한 현재 상황')))`);
    await must(kept, '다른 담당자가 더한 현재 상황이 합친 뒤 빠짐(기본은 둘 다 남기기)');
    return `업무 ${worksBefore}→${worksAfter}, 사용자 수 ${usersAfter}. 미리 보기: ${prev}`;
  });

  // 11
  await check('11 인계 흐름 회귀(W-001 → 이서연)', async () => {
    await must(await H(`user('김도윤')`), '김도윤 전환 실패');
    await nav('#/handover', `window.__h.has('새 인계 시작')`);
    await ev(`(() => { const s = document.getElementById('ho-work'); if (s) { window.__h.setVal(s, 'W-001'); } return true; })()`);
    await sleep(200);
    await ev(`(() => { const s = document.getElementById('ho-to'); const o = [...s.options].find((x) => x.textContent.includes('이서연')); window.__h.setVal(s, o.value); return true; })()`);
    await sleep(200);
    await must(await H(`click('button', '인계 시작', true)`), '인계 시작 단추 없음');
    await must(await wait(`location.hash.startsWith('#/handover/HO-')`, 4000), '인계 상세로 이동 안 함: ' + await ev('location.hash'));
    const hoId = (await ev('location.hash')).split('/').pop();
    await sleep(500);
    await must(await H(`click('button', '점검 실행')`), '점검 실행 단추 없음');
    await must(await wait(`!document.getElementById('chk-' + ([...document.querySelectorAll('input[id^=chk-]')][0]||{id:'x'}).id.slice(4))?.disabled && document.querySelectorAll('input[id^=chk-]').length>0 && !document.querySelector('input[id^=chk-]').disabled`, 5000), '사전 점검 뒤 체크 활성화 안 됨');
    const nChk = await ev(`(() => { const c = [...document.querySelectorAll('input[id^=chk-]')]; c.forEach((e) => e.click()); return c.length; })()`);
    await must(nChk === 4, `체크 ${nChk}개`);
    await sleep(200);
    await must(await H(`click('label', '담당에서 빠짐')`), '담당 여부 선택 불가');
    await sleep(200);
    await must(await H(`click('button', '인계 제출', true)`), '인계 제출 단추 없음');
    await sleep(500);
    await shot('11-제출후');
    await must(await H(`click('button', '이서연(으)로 전환')`), '이서연 전환 단추 없음');
    await sleep(500);
    await must(await H(`click('button', '인수 확인', true)`), '인수 확인 단추 없음');
    await sleep(500);
    await must(await H(`click('button', '인계 확정 및 업무정보 스냅샷 보존')`), '인계 확정 단추 없음');
    await sleep(800);
    await shot('11-확정후');
    const snap = await ev(`JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => /state|worklink|itda/i.test(k))) || 'null')`).catch(() => null);
    await must(await H(`has('스냅샷')`), '확정 화면에 스냅샷 안내 없음');
    await must(await H(`user('박지훈')`), '박지훈 전환 실패');
    await nav('#/universe', mapReady);
    await sleep(800);
    await ev(`(() => { const cy = window.__h.cy(); cy.nodes().filter((n) => n.data('core_type') === 'root').forEach((n) => n.emit('dbltap')); return true; })()`);
    await sleep(1000);
    const past = await ev(`window.__h.cy().edges('.past').length`);
    const w1 = await ev(`(() => { const cy = window.__h.cy(); return cy.edges('.past').map((e) => e.source().data('label') + '→' + e.target().data('label')).slice(0, 4); })()`);
    await shot('11-팀지도-past');
    await must(past >= 1, `W-001 전 담당(past) 선 없음 (past ${past})`);
    return `${hoId} 확정, past 선 ${past}: ${w1.join(', ')}`;
  });

  await check('14 지도 담당 넘기기 → 인계 시작·바로 바꾸기 확인', async () => {
    await must(await H(`user('정하준')`), '정하준 전환 실패');
    await nav('#/universe', mapReady);
    await must(await H(`tap('출금이체 월 정산')`), '업무 노드 없음');
    await must(await wait(`!!document.querySelector('[data-testid="map-card"]')`, 3000), '카드 안 열림');
    await must(await H(`clickId('map-edit-owner')`), '담당 넘기기 단추 없음');
    await must(await wait(`!!document.querySelector('[data-testid="map-owner-handover"]')`, 2000), '「인계 시작(정식 절차)」 단추 없음');
    // 받는 사람은 미리 골라 두지 않는다(2026-10-29) → 강예린을 고른다
    await must(await ev(`document.querySelector('[data-testid="map-owner-who"]').value === ''`), '받는 사람이 미리 골라져 있음');
    await H(`setId('map-owner-who', 'U6')`);
    await sleep(150);
    // 바로 바꾸기는 한 번 더 묻고, 묻는 동안 아무것도 바뀌지 않는다
    await must(await H(`clickId('map-owner-save')`), '「담당만 바로 바꾸기」 단추 없음');
    await must(await wait(`!!document.querySelector('[data-testid="map-owner-confirm-box"]')`, 2000), '바로 바꾸기 확인 창 없음');
    await shot('14-담당-바로바꾸기-확인');
    await must(await H(`click('button', '취소')`), '확인 창 취소 단추 없음');
    const who = await ev(`document.querySelector('[data-testid="map-owner-who"]').value`);
    await must(await H(`clickId('map-owner-handover')`), '인계 시작 단추 누르기 실패');
    await must(await wait(`location.hash.startsWith('#/handover')`, 3000), `인계 화면으로 안 감: ${await ev('location.hash')}`);
    await sleep(400);
    const picked = await ev(`[...document.querySelectorAll('select')].some((s) => s.value === ${JSON.stringify(who)})`);
    await must(picked, `받을 사람(${who})이 미리 골라져 있지 않음`);
    await shot('14-인계시작-받는사람');
    const owners = await ev(`(() => { const k = Object.keys(localStorage).find((x) => x.startsWith('worklink')); return JSON.stringify(JSON.parse(localStorage.getItem(k)).works.find((w) => w.id === 'W-004').owners); })()`);
    await must(owners === '["U5"]', `확인 없이 담당이 바뀜: ${owners}`);
    return `확인 창 → 취소, 인계 화면 받는 사람 ${who}, W-004 담당 ${owners}`;
  });

  await check('15 조직 화면(추가·지우기)·업무 관리 조직 거르기', async () => {
    await must(await H(`user('박지훈')`), '박지훈 전환 실패');
    await nav('#/people', `!!document.querySelector('[data-testid="org-section"]')`);
    const rows = await ev(`document.querySelectorAll('[data-testid="org-row"]').length`);
    await must(rows >= 10, `조직 ${rows}개`);
    await H(`setId('org-add-name', '점검용임시팀')`);
    await H(`setId('org-add-level', '팀')`);
    await H(`setId('org-add-parent', 'O-009')`);
    await sleep(150);
    await must(await H(`clickId('org-add-save')`), '조직 추가 단추 없음');
    await must(await wait(`document.querySelectorAll('[data-testid="org-row"]').length === ${rows + 1} && window.__h.has('점검용임시팀')`, 3000), '조직이 안 늘어남');
    await shot('15-조직-추가');
    const id = await ev(`(() => { const k = Object.keys(localStorage).find((x) => x.startsWith('worklink')); return JSON.parse(localStorage.getItem(k)).orgs.find((o) => o.name === '점검용임시팀').id; })()`);
    await must(await H(`clickId('org-remove-${id}')`), '조직 지우기 단추 없음');
    await must(await wait(`document.querySelectorAll('[data-testid="org-row"]').length === ${rows}`, 3000), '조직이 안 지워짐');
    // 쓰이는 조직은 지우지 못한다
    await must(await H(`clickId('org-remove-O-010')`), '보안점검팀 지우기 단추 없음');
    await must(await wait(`!!document.querySelector('[data-testid="org-error"]')`, 2000), '쓰이는 조직 지우기 오류 안내 없음');
    await nav('#/works', `!!document.getElementById('works-org')`);
    await ev(`(() => { window.__h.setVal(document.getElementById('works-org'), 'O-009'); return true; })()`);
    await sleep(300);
    const n = await ev(`document.querySelectorAll('tbody tr').length`);
    await must(n === 2, `정보보호부 거르기 결과 ${n}행(2행이어야 함)`);
    await shot('15-업무관리-조직거르기');
    return `조직 ${rows}개, 추가·지우기 확인, 쓰이는 조직 지우기 막힘, 정보보호부 업무 ${n}건`;
  });

  await check('13 남의 업무는 읽기 전용·나만 보기 메모', async () => {
    await must(await H(`user('김도윤')`), '김도윤 전환 실패');
    await nav('#/works', `!!document.querySelector('[data-testid="works-scope-all"]')`);
    await must(await H(`clickId('works-scope-all')`), '「전체」 칩 없음');
    await sleep(300);
    await nav('#/works/W-004', `window.__h.has('출금이체 월 정산')`);
    await must(await ev(`!!document.querySelector('[data-testid="work-readonly"]')`), '남의 업무에 읽기 전용 안내 없음');
    await must(!(await H(`find('button','업무정보 수정')`)), '남의 업무에 「업무정보 수정」 단추가 보임');
    await ev(`(() => { const i = document.querySelector('[data-testid="private-memo-text"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, '점검용 나만 보기 메모'); i.dispatchEvent(new Event('input', { bubbles: true })); i.form.requestSubmit(); return true; })()`);
    await must(await wait(`window.__h.has('점검용 나만 보기 메모')`, 3000), '나만 보기 메모가 안 남음');
    await shot('13-남의업무-읽기전용');
    await must(await H(`user('정하준')`), '정하준 전환 실패');
    await nav('#/works/W-004', `window.__h.has('출금이체 월 정산')`);
    await sleep(300);
    await must(!(await ev(`window.__h.has('점검용 나만 보기 메모')`)), '남의 「나만 보기」 메모가 담당자에게 보임');
    await must(!(await ev(`!!document.querySelector('[data-testid="work-readonly"]')`)), '담당자에게 읽기 전용 안내가 뜸');
    await must(await H(`user('김도윤')`), '김도윤 복귀 실패');
    return '김도윤: W-004 읽기 전용·메모 남김 / 정하준: 메모 안 보임·편집 가능';
  });

  await check('17 근거 문서 다시 분석(규칙)·인사이트 두 묶음·한눈에 줄', async () => {
    await must(await H(`user('김도윤')`), '김도윤 전환 실패');
    await nav('#/works/W-001', `!!document.querySelector('[data-testid="glance-source"]')`);
    const src = await ev(`document.querySelector('[data-testid="glance-source"]').innerText`);
    await must(/분석|문서/.test(src), `한눈에 보기 출처 글이 이상함: ${src}`);
    await must(await H(`clickId('glance-reanalyze')`), '「근거 문서 다시 분석」 단추 없음');
    await must(await wait(`!!document.querySelector('[data-testid="glance-reanalyze-menu"] button')`, 2000), '문서 고르기 목록 없음');
    await ev(`document.querySelector('[data-testid="glance-reanalyze-menu"] button').click(); true`);
    await must(await wait(`!!document.querySelector('[data-testid="reanalyze-run"]')`, 4000), '다시 분석 창이 안 열림');
    const runOnce = async () => {
      await must(await H(`clickId('reanalyze-run')`), '분석 단추 없음');
      await must(await wait(`/새 제안/.test(document.querySelector('[data-testid="reanalyze-status"]').innerText)`, 15000), '분석 결과가 안 나옴');
      const t = await ev(`document.querySelector('[data-testid="reanalyze-status"]').innerText`);
      const n = (re) => Number((t.match(re) || [])[1] ?? NaN);
      return { t, approved: n(/승인 (\d+)/), fresh: n(/새 제안 (\d+)/) };
    };
    const a = await runOnce();
    await shot('17-다시분석-미리보기');
    // 새 제안이 있으면 「반영」, 0건이면 「닫기」(reanalyze-done)가 기본 단추
    if (a.fresh > 0) await must(await H(`clickId('reanalyze-apply')`), '반영 단추 없음');
    else await must((await ev(`!document.querySelector('[data-testid="reanalyze-apply"]')`)) && (await H(`clickId('reanalyze-done')`)), '새 제안 0건인데 닫기 단추 없음(또는 반영 단추가 보임)');
    await must(await wait(`!document.querySelector('[data-testid="reanalyze-run"]')`, 3000), '반영·닫기 뒤 창이 안 닫힘');
    const hash = await ev('location.hash');
    await ev(`location.hash = ${JSON.stringify('#/docs/')} + location.hash.split('/docs/')[1].split('?')[0] + '?reanalyze=1'; true`);
    await must(await wait(`!!document.querySelector('[data-testid="reanalyze-run"]')`, 4000), '두 번째 다시 분석 창이 안 열림');
    const b = await runOnce();
    await must(b.fresh <= a.fresh - a.approved, `같은 문서를 다시 분석했는데 새 제안이 줄지 않음(1차 ${a.t} / 2차 ${b.t})`);
    await H(`clickId('reanalyze-cancel')`);
    await sleep(200);
    await must(await H(`user('박지훈')`), '박지훈 전환 실패');
    await nav('#/universe', mapReady);
    await must(await wait(`!!document.querySelector('[data-testid="insight-summary"]') && !!document.querySelector('[data-testid="insight-group-risk"]') && !!document.querySelector('[data-testid="insight-group-flow"]')`, 4000), '인사이트 한눈에 줄·두 묶음이 없음');
    const sum = await ev(`document.querySelector('[data-testid="insight-summary"]').innerText`);
    await ev(`document.querySelector('[data-testid="insight-group-flow"]').scrollIntoView({ block: 'center' }); true`);
    await shot('17-인사이트-두묶음');
    await must(await H(`user('김도윤')`), '김도윤 복귀 실패');
    return `1차 ${a.t.split(' — ')[0]} → 2차 ${b.t.split(' — ')[0]} (${hash}) / ${sum.slice(0, 80)}`;
  });

  if (!process.env.CHECK_THEME) await check('16 화면 밝기(자동 → 밝게 → 어둡게)·가+나 지도', async () => {
    await must(await H(`user('박지훈')`), '박지훈 전환 실패');
    await nav('#/universe', mapReady);
    const bg = () => ev(`getComputedStyle(document.body).backgroundColor`);
    const st = () => ev(`document.querySelector('[data-map-style]')?.dataset.mapStyle ?? ''`);
    await must((await ev(`document.querySelector('[data-testid="theme-toggle"]').dataset.value`)) === 'auto', '처음 밝기가 자동이 아님');
    // 자동은 PC 밝기를 따른다(2026-10-29): PC가 밝으면 흰 판(clean), 어두우면 우주 판(mix). 시안 단추는 숨김
    const pcDark = await ev(`matchMedia('(prefers-color-scheme: dark)').matches`);
    await must((await st()) === (pcDark ? 'mix' : 'clean'), `자동(PC ${pcDark ? '어두움' : '밝음'})에서 지도 모양 ${await st()}`);
    await must(await ev(`!document.querySelector('[data-testid="map-style-mix"]')`), '시안 단추가 보임(숨겨야 함)');
    await must(await H(`clickId('theme-toggle')`), '밝기 단추 없음');
    await must(await wait(`document.documentElement.dataset.theme === 'light' && window.__h.nodes() > 0`, 4000), '밝게로 안 바뀜');
    await sleep(800);
    const lightStyle = await st();
    await must(lightStyle === 'clean', `밝게에서 지도 모양 ${lightStyle}(흰 판이어야 함)`);
    const lightBg = await bg();
    await shot('16-밝게-지도');
    await must(await H(`clickId('theme-toggle')`), '밝기 단추 없음(2)');
    await must(await wait(`document.documentElement.dataset.theme === 'dark' && window.__h.nodes() > 0`, 4000), '어둡게로 안 바뀜');
    await sleep(800);
    await must((await st()) === 'mix', `어둡게에서 지도 모양 ${await st()}`);
    const darkBg = await bg();
    await must(lightBg !== darkBg, `밝게·어둡게 바탕색이 같음(${lightBg})`);
    // 고르기 칸 목록 항목: 바탕과 글씨가 같은 밝기면 안 보인다(사용자 선택 칸 — 2026-10-29)
    const opt = await ev(`(() => { const o = document.querySelector('#user-switch option'); const c = getComputedStyle(o); return c.backgroundColor + '|' + c.color; })()`);
    const lum = (rgb) => { const [r, g, b] = rgb.match(/\d+/g).map(Number); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const [ob, oc] = opt.split('|');
    await must(Math.abs(lum(ob) - lum(oc)) > 100, `어둡게에서 사용자 목록 항목 색 대비 부족(${opt})`);
    await shot('16-어둡게-지도');
    await nav('#/dashboard', `!!document.querySelector('main')`);
    await shot('16-어둡게-대시보드');
    await must(await H(`clickId('theme-toggle')`), '밝기 단추 없음(3)');
    await must(await wait(`!document.documentElement.dataset.theme`, 2000), '자동으로 안 돌아옴');
    await must(await H(`user('김도윤')`), '김도윤 복귀 실패');
    return `밝게 바탕 ${lightBg}·지도 흰 판 / 어둡게 바탕 ${darkBg}·우주 판 / 자동 복귀`;
  });

  // 18 조직 기준 권한·전출·퇴직 → 위험·규칙 검색(사람 질문) — 2026-10-29 사용자 결정
  await check('18 조직 권한·전출·퇴직 위험 반영·사람 질문 검색', async () => {
    await must(await H(`user('김도윤')`), '김도윤 전환 실패');
    await nav('#/people', `!!document.querySelector('[data-testid="people-row"]')`);
    await must(await ev(`!!document.querySelector('[data-testid="people-readonly-note"]') && !document.querySelector('[data-testid="people-add"]')`), '팀원에게 사람 편집 단추가 보임');
    await must(await H(`user('박지훈')`), '박지훈 전환 실패');
    await nav('#/works/W-004', `window.__h.has('출금이체 월 정산')`);
    await must(await ev(`!!document.querySelector('[data-testid="work-readonly"]')`), '다른 팀 팀장이 W-004를 고칠 수 있음');
    await must(await H(`user('서지안')`), '서지안 전환 실패');
    await nav('#/works/W-004', `window.__h.has('출금이체 월 정산')`);
    await sleep(300);
    await must(await ev(`!document.querySelector('[data-testid="work-readonly"]')`), '부장이 같은 부 업무(W-004)를 못 고침');
    // 규칙 검색: 사람이 빠지면 무엇이 막히나
    await nav('#/search?q=' + encodeURIComponent('정하준이 빠지면 무엇이 막히나요?'), `window.__h.has('출금이체 월 정산') && window.__h.has('인계 후보')`);
    await shot('18-검색-사람질문');
    // 전출·퇴직 → 유니버스 「한눈에」에 바로 반영, 바로가기 단추
    await nav('#/universe', mapReady);
    const before = await ev(`document.querySelector('[data-testid="insight-summary"]').innerText`);
    await nav('#/people', `!!document.querySelector('[data-testid="people-row"]')`);
    await ev(`[...document.querySelectorAll('[data-testid="people-row"]')].find((r) => r.innerText.includes('정하준')).querySelector('[data-testid="people-left"]').click(); true`);
    await must(await wait(`!!document.querySelector('[data-testid="people-confirm-left"]')`, 2000), '전출·퇴직 확인 창 없음');
    await must(await ev(`document.querySelector('[data-testid="people-confirm-left"]').innerText.includes('출금이체 월 정산')`), '확인 창에 담당 업무 이름 없음');
    await must(await H(`clickId('people-confirm-left-ok')`), '전출·퇴직 확인 단추 없음');
    await must(await wait(`!!document.querySelector('[data-testid="people-left-handover"]')`, 2000), '「이 사람 업무 넘기기」 바로가기 없음');
    await shot('18-전출퇴직-바로가기');
    await nav('#/universe', mapReady);
    const after = await ev(`document.querySelector('[data-testid="insight-summary"]').innerText`);
    await shot('18-전출퇴직-인사이트');
    await must(after !== before && after.includes('정하준') && after.includes('전출·퇴직'), `전출·퇴직이 한눈에 줄에 반영 안 됨: ${after}`);
    // 되돌리기
    await nav('#/people', `!!document.querySelector('[data-testid="people-row"]')`);
    await ev(`[...document.querySelectorAll('[data-testid="people-row"]')].find((r) => r.innerText.includes('정하준')).querySelector('[data-testid="people-left"]').click(); true`);
    await sleep(300);
    await must(await H(`user('김도윤')`), '김도윤 복귀 실패');
    return `팀원 사람 편집 막힘 · 박지훈 W-004 읽기 전용 · 서지안 W-004 편집 · 검색 답 · 한눈에: ${after.slice(0, 80)}`;
  });

  // 19 사용자 검수 반영(2026-10-29): 마지막 AI 점검 저장·바로 찾기(Ctrl+K)·업무 매뉴얼 유형·문서 삭제
  await check('19 AI 점검 저장·바로 찾기·업무 매뉴얼·문서 삭제', async () => {
    await must(await H(`user('김도윤')`), '김도윤 전환 실패');
    await nav('#/works/W-001', `window.__h.has('비대면 출금동의')`);
    // 키 없이 화면을 보려고, 저장된 점검 결과 하나를 저장소에 넣는다(점검 뒤 기록이 바뀐 상태 = 지난 버전)
    const injected = await ev(`(() => {
      const k = Object.keys(localStorage).find((x) => x.startsWith('worklink'));
      if (!k) return 'no-key';
      const o = JSON.parse(localStorage.getItem(k)); const st = o.state ?? o; const w = st.works.find((x) => x.id === 'W-001');
      st.aiChecks = { 'W-001': { at: '2026-10-29T05:32:00.000Z', byId: w.owners[0], engine: 'claude', model: 'claude-opus-5-5', workVersion: w.version - 1,
        findings: [{ kind: 'missing_action', severity: 'high', title: '시험용 저장 결과', detail: '점검 도구가 넣은 가상 결과', quote: '개정 조문 초안 구성은 10월 중 확정할 예정임.', cite: { docId: 'D-101', anchor: 'p-4' }, recordLine: null }], dropped: 0 } };
      localStorage.setItem(k, JSON.stringify(o)); return 'ok';
    })()`);
    await must(injected === 'ok', `저장소 키를 못 찾음(${injected})`);
    await cdp.send('Page.reload');
    await sleep(300);
    await wait('document.readyState === "complete" && !!document.getElementById("user-switch")', 15000);
    await ev(HELPERS);
    await nav('#/works/W-001', `!!document.querySelector('[data-testid="ai-check-saved"]')`);
    const saved = await ev(`document.querySelector('[data-testid="ai-check-saved"]').innerText`);
    await must(await ev(`!!document.querySelector('[data-testid="ai-check-at"]') && !!document.querySelector('[data-testid="ai-check-stale"]')`), `저장 결과의 일시·「기록 바뀜」 표시 없음: ${saved}`);
    await ev(`document.querySelector('[data-testid="ai-check-saved"]').scrollIntoView({ block: 'center' }); true`);
    await shot('19-AI점검-저장');
    // 바로 찾기: Ctrl+K → 초성 → 합쳐 불러오기
    const ctrlK = () => ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, bubbles: true })); true`);
    const esc = () => ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })); true`);
    const items = () => ev(`[...document.querySelectorAll('[data-testid="quick-find-item"]')].map((e) => e.dataset.kind + ':' + e.innerText.replace(/\\s+/g, ' ')).join(' | ')`);
    await ctrlK();
    await must(await wait(`!!document.querySelector('[data-testid="quick-find-input"]')`, 2000), 'Ctrl+K로 바로 찾기가 안 열림');
    await H(`setId('quick-find-input', 'ㄷㅇㅌ')`);
    await sleep(200);
    await must(/action:[^|]*데이터 옮기기/.test(await items()), `초성 ㄷㅇㅌ로 데이터 옮기기를 못 찾음: ${await items()}`);
    await H(`setId('quick-find-input', '합쳐')`);
    await sleep(200);
    await shot('19-바로찾기');
    await must(await H(`click('[data-testid="quick-find-item"]', '합쳐 불러오기')`), `「합쳐 불러오기」 결과 없음: ${await items()}`);
    await must(await wait(`!!document.querySelector('input[name="dt-mode"][value="merge"]:checked')`, 3000), '합쳐 불러오기가 불러오기 탭·합치기 모드로 안 열림');
    await shot('19-바로찾기-합쳐불러오기');
    await esc();
    await must(await wait(`!document.querySelector('input[name="dt-mode"]')`, 2000), 'Esc로 데이터 옮기기 창이 안 닫힘');
    // 문서 찾기 → 업무 매뉴얼 유형
    await ctrlK();
    await must(await wait(`!!document.querySelector('[data-testid="quick-find-input"]')`, 2000), '바로 찾기가 다시 안 열림');
    await H(`setId('quick-find-input', '오류 대응')`);
    await sleep(200);
    const docHit = await H(`click('[data-testid="quick-find-item"][data-kind="doc"]', '오류 대응 매뉴얼')`);
    if (docHit) {
      await must(await wait(`location.hash.includes('D-105') && window.__h.has('업무 매뉴얼')`, 3000), `문서로 이동하지 않았거나 유형이 업무 매뉴얼이 아님(${await ev('location.hash')})`);
    } else {
      await esc(); // 김도윤 보기 범위 밖일 수 있다 — 범위 밖이면 결과에 없어야 맞다
    }
    // 질문은 AI 업무 검색으로 넘기는 줄
    await ctrlK();
    await must(await wait(`!!document.querySelector('[data-testid="quick-find-input"]')`, 2000), '바로 찾기가 세 번째로 안 열림');
    await H(`setId('quick-find-input', '정하준이 빠지면 무엇이 막히나요')`);
    await sleep(200);
    await must(await ev(`!!document.querySelector('[data-testid="quick-find-ask"]')`), '질문에 「AI 업무 검색으로 묻기」 줄이 없음');
    await esc();
    await must(await wait(`!document.querySelector('[data-testid="quick-find-input"]')`, 2000), 'Esc로 바로 찾기가 안 닫힘');
    // 문서함에 있는 채로 바로 찾기 「문서 등록」 → 등록 창이 열림(검토 6)
    await nav('#/docs', `!!document.querySelector('main')`);
    await ctrlK();
    await must(await wait(`!!document.querySelector('[data-testid="quick-find-input"]')`, 2000), '문서함에서 바로 찾기가 안 열림');
    await H(`setId('quick-find-input', '문서 등록')`);
    await sleep(200);
    await must(await H(`click('[data-testid="quick-find-item"][data-kind="action"]', '문서 등록')`), `「문서 등록」 기능이 결과에 없음: ${await items()}`);
    await must(await wait(`!!document.getElementById('dr-type')`, 3000), '문서함에서 고른 「문서 등록」이 등록 창을 안 엶');
    await must(await ev(`[...document.querySelectorAll('#dr-type option')].some((o) => o.value === '업무 매뉴얼')`), '등록 창 유형에 업무 매뉴얼이 없음');
    await esc();
    await sleep(300);
    // 문서 삭제(올린 사람·담당): 영향 건수 → 삭제 → 문서함, 업무 화면은 그대로 열리고 지운 문서는 안내 화면
    // D-101은 김도윤 업무와 남의 업무(약관·시행세칙 개정안 마련)에 걸려 있음 → 김도윤은 단추 꺼짐 + 이유, 팀장 박지훈은 삭제 가능(검토 3)
    await nav('#/docs/D-101', `!!document.querySelector('[data-testid="doc-delete"]')`);
    await must(await ev(`document.querySelector('[data-testid="doc-delete"]').disabled && !!document.querySelector('[data-testid="doc-delete-blocked"]')`), '남의 업무에 걸린 문서인데 김도윤에게 삭제 단추가 켜져 있음(또는 이유 없음)');
    const blocked = await ev(`document.querySelector('[data-testid="doc-delete-blocked"]').innerText`);
    await shot('19-문서삭제-막힘');
    await must(await H(`user('박지훈')`), '박지훈 전환 실패');
    await nav('#/docs/D-101', `!!document.querySelector('[data-testid="doc-delete"]') && !document.querySelector('[data-testid="doc-delete"]').disabled`);
    await must(await H(`clickId('doc-delete')`), '문서 삭제 단추 없음');
    await must(await wait(`!!document.querySelector('[data-testid="doc-delete-confirm"]')`, 2000), '삭제 확인 창 없음');
    const impact = await ev(`document.querySelector('[data-testid="doc-delete-confirm"]').innerText.replace(/\\s+/g, ' ')`);
    await shot('19-문서삭제-확인');
    await must(await H(`clickId('doc-delete-do')`), '삭제 확인 단추 없음');
    await must(await wait(`/^#\\/docs\\/?(\\?|$)/.test(location.hash)`, 3000), `삭제 뒤 문서함으로 안 감(${await ev('location.hash')})`);
    // 저장된 점검 결과가 지운 문서(D-101)를 근거로 들었으면 머리말에 「근거 문서 일부 삭제됨」
    await nav('#/works/W-001', `!!document.querySelector('[data-testid="ai-check-saved"]')`);
    await must(await ev(`!!document.querySelector('[data-testid="ai-check-docs-gone"]')`), '근거 문서를 지웠는데 저장 결과에 「근거 문서 일부 삭제됨」이 없음');
    await nav('#/docs/D-101', `window.__h.has('문서를 찾을 수 없습니다')`);
    await nav('#/docs/D-105', `!!document.querySelector('main')`);
    await sleep(300);
    await must(await ev(`!document.querySelector('[data-testid="doc-delete"]')`), '고칠 수 없는 사람에게 문서 삭제 단추가 보임(박지훈·D-105)');
    await must(await H(`user('김도윤')`), '김도윤 복귀 실패');
    return `저장 결과: ${saved.slice(0, 60)} · 매뉴얼 문서 찾기 ${docHit ? '이동' : '범위 밖'} · 김도윤 막힘: ${blocked.slice(0, 50)} · 박지훈 삭제 영향: ${impact.slice(0, 90)}`;
  });

  // 20
  await check('20 AI 비서: 고객 18명·상세·수정·이력 복원·브리핑·미팅 후 질문·예시 분석·묻기·권한·유지·백업 왕복', async () => {
    const notes = [];
    const esc = () => ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })); true`);
    const q = (sel) => ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
    const txt = (sel) => ev(`(document.querySelector(${JSON.stringify(sel)})?.innerText || '').replace(/\\s+/g, ' ')`);
    const tab = async (label) => { await must(await H(`click('[data-testid="asst-detail"] button[role="tab"]', ${JSON.stringify(label)})`), `탭 없음: ${label}`); await sleep(350); };
    const reloadPage = async () => {
      await cdp.send('Page.reload');
      await sleep(300);
      await wait('document.readyState === "complete" && !!document.getElementById("user-switch")', 15000);
      await ev(HELPERS);
    };

    // 1) 메뉴·오늘 화면·고객 18명
    await must(await H(`click('nav a', 'AI 비서')`), '왼쪽 메뉴에 AI 비서가 없음');
    await must(await wait(`location.hash.startsWith('#/assistant') && !!document.querySelector('[data-testid="asst-today"]')`, 4000), '오늘 화면이 안 열림');
    const unread = await txt('[data-testid="asst-nav-unread"]');
    await must(Number(unread) > 0, `메뉴에 안 읽은 알림 수가 없음(${unread})`);
    await must((await q('[data-testid="asst-today-recs"]')) === 1 && (await ev(`window.__h.has('규칙 기반')`)), '다음 할 일 추천·「규칙 기반」 표시 없음');
    await must((await q('[data-testid="asst-notice"]')) > 0, '알림 목록이 비어 있음');
    await shot('20-01-오늘');
    await nav('#/assistant/customers', `!!document.querySelector('[data-testid="asst-cust-count"]')`);
    await must((await txt('[data-testid="asst-cust-count"]')).startsWith('18명'), `고객 수 표시: ${await txt('[data-testid="asst-cust-count"]')}`);
    await must((await q('[data-testid="asst-cust-row"]')) === 18, `표 행 수 ${await q('[data-testid="asst-cust-row"]')} (18이어야 함)`);
    await H(`setId('asst-cust-search', '은행')`); await sleep(250);
    const bank = await q('[data-testid="asst-cust-row"]');
    await must(bank > 0 && bank < 18, `「은행」 찾기 결과 ${bank}명`);
    await H(`setId('asst-cust-search', '')`); await sleep(250);
    await H(`clickId('asst-layout-card')`); await sleep(300);
    await must((await q('[data-testid="asst-cust-row"]')) === 18 && (await q('table')) === 0, '카드 보기에서 표가 같이 보이거나 18명이 아님(표/카드는 하나만)');
    await shot('20-02-고객-카드');
    await H(`clickId('asst-layout-table')`); await sleep(300);
    notes.push(`고객 18명(은행 찾기 ${bank}명)`);
    // 바로 찾기(Ctrl+K): 메뉴 「AI 비서」(초성 ㅂㅅ)와 기능 「고객 추가」(초성 ㄱㄱㅊㄱ) → 등록 창
    await nav('#/dashboard', `!!document.querySelector('main')`);
    const ctrlK = () => ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, bubbles: true })); true`);
    await ctrlK();
    await must(await wait(`!!document.querySelector('[data-testid="quick-find-input"]')`, 2000), '바로 찾기가 안 열림');
    await H(`setId('quick-find-input', 'ㅂㅅ')`); await sleep(200);
    await must(await ev(`[...document.querySelectorAll('[data-testid="quick-find-item"][data-kind="menu"]')].some((e) => e.dataset.key === 'menu:/assistant')`), '초성 ㅂㅅ로 메뉴 AI 비서를 못 찾음');
    await H(`setId('quick-find-input', 'ㄱㄱㅊㄱ')`); await sleep(200);
    await must(await H(`click('[data-testid="quick-find-item"][data-kind="action"]', '고객 추가')`), '초성 ㄱㄱㅊㄱ로 「고객 추가」를 못 찾음');
    await must(await wait(`!!document.querySelector('[data-testid="asst-cust-form"]')`, 4000), '「고객 추가」가 고객 등록 창을 안 엶');
    await esc();
    await must(await wait(`!document.querySelector('[data-testid="asst-cust-form"]')`, 2000), 'Esc로 고객 등록 창이 안 닫힘');
    await must(!(await ev(`location.hash.includes('new=1')`)), '주소에 new=1이 남아 있음(새로 고침하면 다시 열림)');
    notes.push('바로 찾기(AI 비서·고객 추가 초성)');

    // 2) 고객 상세 → 값 수정 → 변경 이력 → 복원
    await must(await H(`click('[data-testid="asst-cust-row"]', '김도현')`), '김도현 행 없음');
    await must(await wait(`/#\\/assistant\\/customers\\/CU-\\d+/.test(location.hash) && !!document.querySelector('[data-testid="asst-detail"]')`, 4000), '고객 상세가 안 열림');
    const cid = (await ev('location.hash')).split('/').pop().split('?')[0];
    await must((await txt('[data-testid="asst-detail-name"]')).includes('김도현'), '상세 이름 표시');
    await shot('20-03-상세');
    await tab('선호·관심사');
    const oldDislike = await txt('[data-testid="asst-v-foodDislikes"]');
    await must(oldDislike.length > 0, '기피 음식 값이 비어 있음(가상 고객 김도현은 값이 있어야 함)');
    await must((await txt('[data-testid="asst-meta-foodDislikes"]')).includes('수정 이력 없음'), `항목별 수정 정보: ${await txt('[data-testid="asst-meta-foodDislikes"]')}`);
    await must(await H(`clickId('asst-edit-open')`), '수정 단추 없음');
    await must(await wait(`!!document.querySelector('[data-testid="asst-f-foodDislikes"]')`, 3000), '수정 창이 안 열림');
    await H(`setId('asst-f-foodDislikes', '점검용 기피 음식')`); await sleep(150);
    await shot('20-04-수정창');
    await must(await H(`clickId('asst-cust-save')`), '저장 단추 없음');
    await must(await wait(`!document.querySelector('[data-testid="asst-cust-form"]')`, 3000), '저장 뒤 창이 안 닫힘');
    await must((await txt('[data-testid="asst-v-foodDislikes"]')) === '점검용 기피 음식', `수정한 값이 화면에 안 보임: ${await txt('[data-testid="asst-v-foodDislikes"]')}`);
    await must((await txt('[data-testid="asst-meta-foodDislikes"]')).includes('직접 입력'), `수정 뒤 출처: ${await txt('[data-testid="asst-meta-foodDislikes"]')}`);
    await tab('변경 이력');
    await must((await q('[data-testid="asst-change-row"][data-field="foodDislikes"]')) === 1, '변경 이력 1건이 없음');
    await shot('20-05-변경이력');
    await must(await H(`clickId('asst-restore')`), '복원 단추 없음');
    await must(await wait(`document.querySelectorAll('[data-testid="asst-change-row"]').length === 2`, 3000), '복원도 새 이력으로 남아야 함(2건)');
    const srcs = await ev(`[...document.querySelectorAll('[data-testid="asst-change-row"]')].map((e) => e.innerText.replace(/\\s+/g, ' ')).join(' || ')`);
    await must(srcs.includes('이전 값 복원'), `복원 출처 표시 없음: ${srcs.slice(0, 160)}`);
    await tab('선호·관심사');
    await must((await txt('[data-testid="asst-v-foodDislikes"]')) === oldDislike, `복원 뒤 값 ${await txt('[data-testid="asst-v-foodDislikes"]')} ≠ 처음 값 ${oldDislike}`);
    notes.push('수정→이력→복원 왕복');

    // 3) 브리핑(인쇄 단추·규칙 기반) + 닫으면 초점 복귀
    await ev(`document.querySelector('[data-testid="asst-brief-open"]')?.focus(); true`); // 키보드로 단추에 와서 누른 것과 같게(프로그램 클릭은 초점을 옮기지 않는다)
    await must(await H(`clickId('asst-brief-open')`), '브리핑 단추 없음');
    await must(await wait(`!!document.querySelector('[data-testid="asst-briefing-body"]')`, 3000), '브리핑이 안 열림');
    const brief = await txt('[data-testid="asst-briefing"]');
    await must(brief.includes('읽는 시간') && brief.includes('규칙 기반'), `브리핑에 읽는 시간·규칙 기반 표시가 없음: ${brief.slice(0, 120)}`);
    await must((await q('[data-testid="asst-brief-print"]')) === 1, '인쇄 단추 없음');
    await must(await ev(`document.activeElement && !!document.activeElement.closest('[role="dialog"]')`), '대화상자를 열었는데 초점이 안쪽으로 안 옴');
    await shot('20-06-브리핑');
    await esc();
    await must(await wait(`!document.querySelector('[data-testid="asst-briefing"]')`, 2000), 'Esc로 브리핑이 안 닫힘');
    await must(await ev(`document.activeElement?.dataset?.testid === 'asst-brief-open'`), '닫은 뒤 초점이 브리핑 단추로 돌아오지 않음');
    notes.push('브리핑');

    // 4) 미팅 후 질문 — 체크한 것만 저장
    await nav('#/assistant', `document.querySelectorAll('[data-testid="asst-fu-wait"]').length > 0`);
    await must(await ev(`(() => { const b = [...document.querySelectorAll('[data-testid="asst-fu-wait"] button')].find((x) => x.textContent.includes('질문 답하기')); if (!b) return false; b.click(); return true; })()`), '질문 답하기 단추 없음');
    await must(await wait(`!!document.querySelector('[data-testid="asst-fu-q-request"]')`, 3000), '미팅 후 질문 화면이 안 열림');
    const fuHash = await ev('location.hash');
    await must(await H(`clickId('asst-fu-opt-request-자료 요청')`), '요청 선택지 없음');
    await sleep(200);
    await H(`setId('asst-fu-in-request-content', '점검용 자료 전달')`);
    await must(await H(`clickId('asst-fu-opt-food_pref-like')`), '음식 선택지 없음(이 고객은 음식 질문이 없음?)');
    await sleep(200);
    await H(`setId('asst-fu-in-food_pref-like', '점검용국밥')`);
    await must(await H(`clickId('asst-fu-opt-interest-취미·여가')`), '관심사 선택지 없음');
    await sleep(200);
    await H(`setId('asst-fu-in-interest-text', '점검용테니스')`);
    await sleep(150);
    await shot('20-07-미팅후질문');
    await must(await H(`clickId('asst-fu-review-btn')`), '답변 확인 단추 없음');
    await must(await wait(`!!document.querySelector('[data-testid="asst-fu-review"]')`, 3000), '반영안 화면이 안 열림');
    const props = await ev(`[...document.querySelectorAll('[data-testid="asst-fu-prop"]')].map((e) => e.innerText.replace(/\\s+/g, ' ').slice(0, 60))`);
    await must(props.length >= 3, `반영안 ${props.length}건: ${props.join(' / ')}`);
    await shot('20-08-반영안');
    // 「선호 음식」 반영안만 체크 해제
    const unchecked = await ev(`(() => { const row = [...document.querySelectorAll('[data-testid="asst-fu-prop"]')].find((e) => e.innerText.includes('선호 음식')); if (!row) return false; row.querySelector('[data-testid="asst-fu-chk"]').click(); return true; })()`);
    await must(unchecked, '선호 음식 반영안이 없음');
    await must(await H(`clickId('asst-fu-apply')`), '저장 단추 없음');
    await must(await wait(`location.hash.includes('?tab=history')`, 4000), `저장 뒤 고객 히스토리로 안 감: ${await ev('location.hash')}`);
    const fcid = (await ev('location.hash')).split('/').pop().split('?')[0];
    await tab('요청');
    await must((await txt('[data-testid="asst-detail"]')).includes('점검용 자료 전달'), '체크한 요청이 저장되지 않음');
    await tab('선호·관심사');
    const prefs = await txt('[data-testid="asst-detail"]');
    await must(prefs.includes('점검용테니스'), '체크한 취미 반영안이 저장되지 않음');
    await must(!prefs.includes('점검용국밥'), '체크 해제한 선호 음식이 저장됨');
    await tab('변경 이력');
    const fuHist = await txt('[data-testid="asst-changes"]');
    await must(fuHist.includes('미팅 후 질문') && !fuHist.includes('점검용국밥'), `변경 이력에 미팅 후 질문 출처만 있어야 함: ${fuHist.slice(0, 120)}`);
    await nav('#/assistant', `!!document.querySelector('[data-testid="asst-today"]')`);
    notes.push(`미팅 후 질문(${fuHash.split('/').pop()}) 체크한 것만 저장`);

    // 5) 예시 분석(AI 미사용) 승인
    await nav('#/assistant/analyze', `!!document.querySelector('[data-testid="asst-an-sample"]')`);
    await must((await txt('[data-testid="asst-an-engine"]')).includes('예시 분석(AI 미사용)'), '키 없을 때 예시 분석 안내 문구 없음');
    await must((await q('[data-testid="asst-an-preview-btn"]')) === 0, '키가 없는데 Claude 전송 단추가 보임');
    await H(`setId('asst-an-customer', ${JSON.stringify(cid)})`); await sleep(200);
    await must(await H(`clickId('asst-an-sample')`), '예시 분석 단추 없음');
    await must(await wait(`!!document.querySelector('[data-testid="asst-an-review"]')`, 3000), '승인 화면이 안 열림');
    await must((await txt('[data-testid="asst-an-label"]')).includes('예시 분석(AI 미사용)'), '예시 분석 라벨 없음');
    const nItems = await q('[data-testid="asst-an-item"]');
    await must(nItems === 9, `분석 항목 ${nItems}건(9건이어야 함)`);
    const draftInStore = await ev(`Object.values(localStorage).some((v) => String(v).includes('저는 회는 별로고 고기가 좋아요'))`);
    await must(!draftInStore, '승인 전 초안·원문이 저장소에 들어 있음(메모리에만 있어야 함)');
    await shot('20-09-예시분석');
    // 첫 항목(선호 음식)을 체크 해제하고 저장
    await must(await ev(`(() => { const c = document.querySelector('[data-testid="asst-an-item"] [data-testid="asst-an-chk"]'); if (!c) return false; c.click(); return true; })()`), '항목 체크 상자 없음');
    await sleep(150);
    await must(await H(`clickId('asst-an-apply')`), '저장 단추 없음');
    await must(await wait(`!!document.querySelector('[data-testid="asst-an-done"]')`, 4000), '저장 완료 표시 없음');
    await nav(`#/assistant/customers/${cid}?tab=changes`, `!!document.querySelector('[data-testid="asst-detail"]')`);
    const anHist = await txt('[data-testid="asst-detail"]');
    await must(anHist.includes('예시 분석(AI 미사용)'), '변경 이력에 「예시 분석(AI 미사용)」 출처가 없음');
    await must(!(await ev(`Object.values(localStorage).some((v) => String(v).includes('저는 회는 별로고 고기가 좋아요'))`)), '저장 뒤에도 대화 원문이 저장소에 있음(원문 보관을 안 골랐음)');
    await tab('요청');
    await must((await txt('[data-testid="asst-detail"]')).includes('출금 실패'), '승인한 요청이 저장되지 않음');
    notes.push('예시 분석 승인(원문 저장 안 됨)');

    // 6) 묻기
    await nav('#/assistant/ask', `!!document.querySelector('[data-testid="asst-ask-input"]')`);
    await must((await q('[data-testid="asst-ask-ex"]')) === 6, '예시 질문이 6개가 아님');
    await must(await ev(`(() => { const b = [...document.querySelectorAll('[data-testid="asst-ask-ex"]')].find((x) => x.textContent.includes('골프')); b.click(); return true; })()`), '골프 예시 없음');
    await must(await wait(`!!document.querySelector('[data-testid="asst-ask-result"]')`, 4000), '검색 결과가 안 나옴');
    await must((await ev(`document.querySelector('[data-testid="asst-ask-mode"]').dataset.mode`)) === 'rule', '규칙 해석 표시가 아님');
    await must((await txt('[data-testid="asst-ask-result"]')).includes('김도현'), '골프 예시에서 김도현이 안 나옴');
    await must((await txt('[data-testid="asst-ask-explain"]')).length > 0, '해석된 조건 표시 없음');
    await H(`setId('asst-ask-input', '해산물 못 드시는 분')`); await sleep(100);
    await H(`clickId('asst-ask-submit')`);
    await must(await wait(`document.querySelectorAll('[data-testid="asst-ask-cust"]').length > 0`, 4000), '「해산물 못 드시는 분」 결과 0명');
    await must((await q('[data-testid="asst-ask-evidence"] mark')) > 0, '근거의 검색어가 강조되지 않음');
    await shot('20-10-묻기-해산물');
    await H(`setId('asst-ask-input', '이번 달에 내가 챙겨야 할 사람 누구야')`); await sleep(100);
    await H(`clickId('asst-ask-submit')`);
    await must(await wait(`document.querySelectorAll('[data-testid="asst-ask-cust"]').length > 0`, 4000), '「이번 달에 챙겨야 할 사람」 결과 0명');
    notes.push('묻기 예시 6개·해산물·챙겨야 할 사람');

    // 7) 권한: 이서연은 열람만, 자기 고객은 고칠 수 있고 김도윤은 그 고객을 못 고침
    await must(await H(`user('이서연')`), '이서연 전환 실패');
    await nav(`#/assistant/customers/${cid}`, `!!document.querySelector('[data-testid="asst-detail"]')`);
    await must(await ev(`document.querySelector('[data-testid="asst-edit-open"]').disabled && document.querySelector('[data-testid="asst-cust-delete"]').disabled`), '담당이 아닌 사용자에게 수정·삭제 단추가 켜져 있음');
    await must((await q('[data-testid="asst-readonly"]')) === 1, '읽기 전용 안내 없음');
    await must(await ev(`document.querySelector('[data-testid="asst-edit-open"]').parentElement.title.length > 0`), '막힌 이유(툴팁)가 없음');
    await tab('히스토리');
    await must(await ev(`document.querySelector('[data-testid="asst-act-add"]').disabled`), '활동 추가가 막히지 않음');
    await nav('#/assistant/activities', `document.querySelectorAll('[data-testid="asst-act-row"]').length > 0`);
    await must(await ev(`[...document.querySelectorAll('[data-testid="asst-act-row"] button[aria-label$="수정"]')].every((b) => b.disabled)`), '활동·요청 화면의 수정 단추가 막히지 않음');
    await nav('#/assistant/analyze', `window.__h.has('분석할 수 있는 고객이 없습니다')`);
    await nav(fuHash, `!!document.querySelector('[data-testid="asst-followup"]')`);
    await must((await q('[data-testid="asst-fu-q-request"]')) === 0 && (await q('[data-testid="asst-readonly"]')) === 1, '권한 없는 사용자에게 미팅 후 질문이 열려 있음');
    await shot('20-11-권한-읽기전용');
    // 이서연이 새 고객 등록(바로 찾기의 「고객 추가」 경로) → 담당은 이서연
    await nav('#/assistant/customers?new=1', `!!document.querySelector('[data-testid="asst-cust-form"]')`);
    await must((await ev(`document.getElementById('asst-f-owner').value`)).includes('이서연'), '새 고객의 담당이 현재 사용자가 아님');
    await H(`setId('asst-f-name', '점검용고객')`);
    await H(`setId('asst-f-company', '점검용상사(가상)')`);
    await H(`setId('asst-f-mobile', '010-0000-9999')`);
    await H(`clickId('asst-cust-save')`);
    await must(await wait(`/#\\/assistant\\/customers\\/CU-\\d+/.test(location.hash) && (document.querySelector('[data-testid="asst-detail-name"]')?.innerText || '').includes('점검용고객')`, 4000), '등록 뒤 새 고객 상세로 안 감');
    const newCid = (await ev('location.hash')).split('/').pop().split('?')[0];
    await must(await ev(`!document.querySelector('[data-testid="asst-edit-open"]').disabled`), '자기 고객인데 수정이 막힘');
    // 같은 이름·소속으로 다시 등록하면 중복 안내 → 「그래도 등록」
    await nav('#/assistant/customers?new=1', `!!document.querySelector('[data-testid="asst-cust-form"]')`);
    await H(`setId('asst-f-name', '점검용고객')`);
    await H(`setId('asst-f-company', '점검용상사(가상)')`);
    await H(`clickId('asst-cust-save')`);
    await must(await wait(`!!document.querySelector('[data-testid="asst-dup"]')`, 3000), '중복 안내가 안 나옴');
    await must(await H(`clickId('asst-dup-force')`), '그래도 등록 단추 없음');
    await must(await wait(`/#\\/assistant\\/customers\\/CU-\\d+/.test(location.hash) && location.hash !== '#/assistant/customers/${newCid}'`, 4000), '그래도 등록 뒤 이동 안 함');
    await must(await H(`user('김도윤')`), '김도윤 전환 실패');
    await nav(`#/assistant/customers/${newCid}`, `!!document.querySelector('[data-testid="asst-detail"]')`);
    await must(await ev(`document.querySelector('[data-testid="asst-edit-open"]').disabled`), '김도윤이 이서연 고객을 고칠 수 있음');
    // 조직장(박지훈)은 담당 영업자를 바꿀 수 있다
    await must(await H(`user('박지훈')`), '박지훈 전환 실패');
    await nav(`#/assistant/customers/${cid}`, `!!document.querySelector('[data-testid="asst-detail"]')`);
    await must(await ev(`!document.querySelector('[data-testid="asst-edit-open"]').disabled`), '조직장이 범위 안 고객을 못 고침');
    await H(`clickId('asst-edit-open')`);
    await must(await wait(`!!document.querySelector('[data-testid="asst-f-owner"]')`, 3000), '조직장에게 담당 영업자 선택 칸이 없음');
    await H(`setId('asst-f-owner', 'U2')`); await sleep(150);
    await H(`clickId('asst-cust-save')`);
    await must(await wait(`(document.querySelector('[data-testid="asst-detail-owner"]')?.innerText || '').includes('이서연')`, 3000), '담당 영업자 변경이 반영되지 않음');
    await must(await H(`user('김도윤')`), '김도윤 복귀 실패');
    notes.push('권한(열람 전용·새 고객 담당·중복 안내·조직장 담당 변경)');

    // 8) 새로 고침 뒤에도 유지
    await reloadPage();
    await nav('#/assistant/customers', `!!document.querySelector('[data-testid="asst-cust-count"]')`);
    const cnt = await txt('[data-testid="asst-cust-count"]');
    await must(cnt.startsWith('20명'), `새로 고침 뒤 고객 수 ${cnt}(20명이어야 함: 가상 18 + 점검용 2)`);
    await nav(`#/assistant/customers/${fcid}?tab=prefs`, `!!document.querySelector('[data-testid="asst-detail"]')`);
    await must((await txt('[data-testid="asst-detail"]')).includes('점검용테니스'), '새로 고침 뒤 미팅 후 질문 반영이 사라짐');
    notes.push('새로 고침 뒤 유지');

    // 9) 백업 내보내기에 assistant 포함·가져오기(바꿔 불러오기·합쳐 불러오기) 왕복
    await must(await H(`click('button', '데이터 옮기기')`), '데이터 옮기기 단추 없음');
    await wait(`!!document.querySelector('textarea[aria-label="백업 데이터"]')`, 3000);
    const stats = await ev(`(() => { const d = JSON.parse(document.querySelector('textarea[aria-label="백업 데이터"]').value); const a = d.assistant; return a ? { c: a.customers.length, i: a.interactions.length, r: a.requests.length, h: a.changes.length, n: a.anniversaries.length, hasKey: JSON.stringify(d).includes('sk-ant') } : null; })()`);
    await must(stats && stats.c === 20 && stats.h >= 4 && !stats.hasKey, `백업에 assistant가 빠졌거나 기대와 다름: ${JSON.stringify(stats)}`);
    const renamed = await ev(`(() => { const d = JSON.parse(document.querySelector('textarea[aria-label="백업 데이터"]').value); d.assistant.customers[0].name = '왕복점검'; return JSON.stringify(d); })()`);
    const original = await ev(`document.querySelector('textarea[aria-label="백업 데이터"]').value`);
    await must(await H(`click('button', '불러오기', true)`), '불러오기 탭 없음');
    await sleep(300);
    await ev(`document.querySelector('input[name="dt-mode"][value="replace"]').click(); true`);
    await sleep(200);
    await ev(`window.__h.setVal(document.getElementById('dt-paste'), ${JSON.stringify(renamed)}); true`);
    await must(await wait(`!!document.querySelector('[data-testid="replace-start"]')`, 4000), '바꿔 불러오기 확인이 안 나옴');
    await H(`clickId('replace-start')`);
    await must(await H(`clickId('replace-confirm')`), '바꿔서 불러오기 단추 없음');
    await sleep(600);
    await nav('#/assistant/customers', `!!document.querySelector('[data-testid="asst-cust-count"]')`);
    await must((await txt('[data-testid="asst-cust-count"]')).startsWith('20명'), `바꿔 불러온 뒤 고객 수 ${await txt('[data-testid="asst-cust-count"]')}`);
    await H(`setId('asst-cust-search', '왕복점검')`); await sleep(250);
    await must((await q('[data-testid="asst-cust-row"]')) === 1, '바꿔 불러온 고객 이름이 화면에 안 보임');
    await H(`setId('asst-cust-search', '')`); await sleep(200);
    // 합쳐 불러오기: 이름만 다른 같은 고객(휴대전화 같음)은 새 고객으로 더하지 않는다
    await must(await H(`click('button', '데이터 옮기기')`), '데이터 옮기기 단추 없음(2)');
    await sleep(300);
    await H(`click('button', '불러오기', true)`);
    await sleep(300);
    await H(`click('[data-testid="merge-mode"] label', '합쳐 불러오기')`);
    await sleep(200);
    await ev(`window.__h.setVal(document.getElementById('dt-paste'), ${JSON.stringify(original)}); true`);
    await must(await wait(`!!document.querySelector('[data-testid="merge-preview"]')`, 4000), '합치기 미리 보기 안 나옴');
    await must(await H(`clickId('merge-confirm')`), '합쳐 불러오기 확인 단추 없음');
    await sleep(800);
    await nav('#/assistant/customers', `!!document.querySelector('[data-testid="asst-cust-count"]')`);
    await must((await txt('[data-testid="asst-cust-count"]')).startsWith('20명'), `합쳐 불러온 뒤 고객 수 ${await txt('[data-testid="asst-cust-count"]')}(같은 고객이 중복으로 늘면 안 됨)`);
    notes.push(`백업 assistant ${stats.c}명·이력 ${stats.h}건 포함, 바꿔·합쳐 불러오기 왕복 20명 유지`);

    // 10) 설정: 가상 데이터 삭제 → 다시 채우지 않음(새로 고침 뒤에도) → 다시 채우기. 지우기는 「내가 고칠 수 있는 고객」만 대상이라 두 팀원의 고객을 모두 고칠 수 있는 팀장으로 한다
    await must(await H(`user('박지훈')`), '박지훈 전환 실패(2)');
    await nav('#/assistant', `!!document.querySelector('[data-testid="asst-today"]')`);
    await must(await H(`clickId('asst-settings-open')`), '설정 단추 없음');
    await must(await wait(`!!document.querySelector('[data-testid="asst-settings"]')`, 3000), '설정 창이 안 열림');
    await shot('20-12-설정');
    await H(`clickId('asst-s-del-demo')`);
    await must(await wait(`!!document.querySelector('[data-testid="asst-s-confirm-demo"]')`, 2000), '가상 데이터 삭제 확인이 안 나옴');
    await H(`clickId('asst-s-confirm-demo-ok')`);
    await sleep(500);
    await esc();
    await reloadPage();
    await nav('#/assistant/customers', `!!document.querySelector('[data-testid="asst-cust-count"]')`);
    const demoLeft = await ev(`(() => { const k = Object.keys(localStorage).find((x) => x.startsWith('worklink')); const o = JSON.parse(localStorage.getItem(k)); const st = o.state ?? o; return st.assistant.customers.filter((c) => c.isDemo).length; })()`);
    await must(demoLeft === 0, `가상 고객이 다시 채워졌거나 안 지워짐(${demoLeft}명)`);
    const afterDel = await txt('[data-testid="asst-cust-count"]');
    await must(afterDel.startsWith('2명'), `가상 데이터 삭제 뒤 고객 수 ${afterDel}(직접 등록한 2명만 남아야 함)`);
    await nav('#/assistant', `!!document.querySelector('[data-testid="asst-today"]')`);
    await H(`clickId('asst-settings-open')`);
    await wait(`!!document.querySelector('[data-testid="asst-s-restore"]')`, 3000);
    await H(`clickId('asst-s-restore')`);
    await sleep(500);
    await esc();
    await nav('#/assistant/customers', `!!document.querySelector('[data-testid="asst-cust-count"]')`);
    await must((await txt('[data-testid="asst-cust-count"]')).startsWith('20명'), `가상 데이터 다시 채운 뒤 고객 수 ${await txt('[data-testid="asst-cust-count"]')}`);
    await must(await H(`user('김도윤')`), '김도윤 복귀 실패(2)');
    notes.push('가상 데이터 삭제·새로 고침 뒤 다시 안 채움·복원');
    return notes.join(' · ');
  });

  // 20b: 키가 있는 Claude 엔진 화면(전송 내용 확인·동의·가림 끄기·질문 안내). 실제 호출은 하지 않는다(외부 통신 차단)
  await check('20b AI 비서: Claude 엔진 화면(전송 내용 확인·동의·가림 끄기·질문 안내)', async () => {
    const q = (sel) => ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
    const txt = (sel) => ev(`(document.querySelector(${JSON.stringify(sel)})?.innerText || '').replace(/\\s+/g, ' ')`);
    await must(await H(`clickId('ai-settings-open')`), '열쇠 단추 없음');
    await wait(`!!document.querySelector('[data-testid="ai-key-input"]')`, 3000);
    await H(`setId('ai-key-input', 'sk-ant-test-0000')`);
    await sleep(150);
    await H(`clickId('ai-key-save')`);
    await sleep(500);
    await nav('#/assistant/ask', `!!document.querySelector('[data-testid="asst-ask-note"]')`);
    const note = await txt('[data-testid="asst-ask-note"]');
    await must(note.includes('질문 문장과 오늘 날짜뿐') && note.includes('고객 이름'), `묻기 안내에 전송 범위가 없음: ${note.slice(0, 120)}`);
    await nav('#/assistant/analyze', `!!document.querySelector('[data-testid="asst-an-text"]')`);
    await must((await q('[data-testid="asst-an-preview-btn"]')) === 1, 'Claude 엔진인데 「전송 내용 확인」 단추가 없음');
    await H(`setId('asst-an-text', '고객: 제 번호는 010-1234-5678이고 메일은 abc@test.example 입니다.\\n나: 네 알겠습니다.')`);
    await H(`setId('asst-an-myname', '김도윤')`);
    await sleep(150);
    await must(await H(`clickId('asst-an-preview-btn')`), '전송 내용 확인 단추 없음');
    await must(await wait(`!!document.querySelector('[data-testid="asst-an-sent"]')`, 3000), '전송 내용 확인 화면이 안 나옴');
    const sent = await txt('[data-testid="asst-an-sent"]');
    await must(sent.includes('[휴대전화]') && sent.includes('[이메일]') && !sent.includes('010-1234-5678') && !sent.includes('abc@test.example'), `가린 결과가 기대와 다름: ${sent}`);
    await must(await ev(`document.querySelector('[data-testid="asst-an-send"]').disabled`), '동의 전인데 분석 단추가 켜져 있음');
    await H(`clickId('asst-an-consent')`); await sleep(150);
    await must(await ev(`!document.querySelector('[data-testid="asst-an-send"]').disabled`), '동의했는데 분석 단추가 안 켜짐');
    await H(`clickId('asst-an-nomask')`); await sleep(250);
    const sent2 = await txt('[data-testid="asst-an-sent"]');
    await must(sent2.includes('010-1234-5678'), '가림 끄기를 눌렀는데 원문이 그대로 안 보임');
    await must(await ev(`document.querySelector('[data-testid="asst-an-send"]').disabled`), '가림을 바꿨는데 동의가 풀리지 않음');
    await shot('20-13-전송내용확인');
    return '전송 내용 확인·가림·동의 게이트 확인(실제 호출 없음)';
  });

  // 20c: 검토(2026-10-30) 반영 — 보는 범위·고객 등록 오류 위치·상단 질문창·바로 찾기 고객·작은 선택 상자·대화 분석 안내·미팅 후 질문 안내·불러오기 확인
  await check('20c AI 비서 검토 반영: 보는 범위·등록 오류 위치·상단 질문창·바로 찾기 고객·선택 상자·분석 안내·질문 안내·불러오기 확인', async () => {
    const notes = [];
    const q = (sel) => ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
    const txt = (sel) => ev(`(document.querySelector(${JSON.stringify(sel)})?.innerText || '').replace(/\\s+/g, ' ')`);
    const esc = () => ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })); true`);
    const ctrlK = () => ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, bubbles: true })); true`);
    const submitTop = (text) => ev(`(() => { const i = document.getElementById('global-ask'); window.__h.setVal(i, ${JSON.stringify(text)}); i.form.requestSubmit(); return true; })()`);
    const toastText = () => ev(`(document.querySelector('[role="status"].fixed')?.innerText || [...document.querySelectorAll('[role="status"]')].map((e) => e.innerText).join(' ') || '').replace(/\\s+/g, ' ')`);

    // 1) 상단 질문창: AI 비서에서는 고객 질문(묻기), 다른 화면은 AI 업무 검색. 1280 폭에서도 안내 글이 잘리지 않는다
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await sleep(300);
    await nav('#/dashboard', `!!document.getElementById('global-ask')`);
    await must((await ev(`document.getElementById('global-ask').placeholder`)) === '업무에 대해 질문하세요', `대시보드 안내 글: ${await ev(`document.getElementById('global-ask').placeholder`)}`);
    const fits = (id) => ev(`(() => { const i = document.getElementById(${JSON.stringify(id)}); const cs = getComputedStyle(i); const c = document.createElement('canvas').getContext('2d'); c.font = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily; const w = c.measureText(i.placeholder).width; const room = i.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight); return { w: Math.round(w), room: Math.round(room) }; })()`);
    const f1 = await fits('global-ask');
    await must(f1.w <= f1.room, `1280 폭에서 상단 검색창 안내 글이 잘림(글 ${f1.w}px > 칸 ${f1.room}px)`);
    await nav('#/assistant', `!!document.querySelector('[data-testid="asst-today"]')`);
    await must((await ev(`document.getElementById('global-ask').placeholder`)) === '고객에 대해 질문하세요', '비서 화면의 상단 질문창 안내가 「고객에 대해 질문하세요」가 아님');
    const f2 = await fits('global-ask');
    await must(f2.w <= f2.room, `비서 화면 안내 글이 잘림(${f2.w} > ${f2.room})`);
    await submitTop('골프 좋아하는 사람');
    await must(await wait(`location.hash.startsWith('#/assistant/ask') && !!document.querySelector('[data-testid="asst-ask-result"]')`, 5000), `상단 질문이 묻기 결과로 안 감: ${await ev('location.hash')}`);
    await must((await txt('[data-testid="asst-ask-result"]')).includes('김도현'), '상단 질문 「골프 좋아하는 사람」 결과에 김도현이 없음');
    await must(!(await ev('location.hash')).includes('q='), '주소에 q가 남아 있음(되풀이 검색 방지)');
    await nav('#/dashboard', `!!document.getElementById('global-ask')`);
    await submitTop('현재 추진 경과는?');
    await must(await wait(`location.hash.startsWith('#/search')`, 3000), '다른 화면의 상단 질문이 AI 업무 검색으로 안 감');
    await cdp.send('Emulation.clearDeviceMetricsOverride');
    // AI 업무 검색에 답이 없으면 고객 질문은 비서로 가라는 링크
    await nav('#/search?q=' + encodeURIComponent('우주선 고객 연락처'), `!!document.querySelector('[data-testid="search-to-assistant"]')`, 8000);
    await must(await H(`click('[data-testid="search-to-assistant"] a', '묻기')`), '「AI 비서 → 묻기」 링크 없음');
    await must(await wait(`location.hash.startsWith('#/assistant/ask') && !!document.querySelector('[data-testid="asst-ask-result"]')`, 5000), '링크가 묻기 결과로 안 감');
    notes.push('상단 질문창·묻기 링크');

    // 2) 바로 찾기(Ctrl+K)에 고객
    await nav('#/dashboard', `!!document.querySelector('main')`);
    await ctrlK();
    await must(await wait(`!!document.querySelector('[data-testid="quick-find-input"]')`, 2000), '바로 찾기가 안 열림');
    await H(`setId('quick-find-input', '김도현')`); await sleep(200);
    await must(await H(`click('[data-testid="quick-find-item"][data-kind="customer"]', '김도현')`), '바로 찾기에 고객 김도현이 없음');
    await must(await wait(`/#\\/assistant\\/customers\\/CU-\\d+/.test(location.hash) && !!document.querySelector('[data-testid="asst-detail"]')`, 4000), '고른 고객 상세로 안 감');
    await ctrlK(); await wait(`!!document.querySelector('[data-testid="quick-find-input"]')`, 2000);
    await H(`setId('quick-find-input', 'ㄱㅇㅇㅎ')`); await sleep(200);
    await must((await q('[data-testid="quick-find-item"][data-kind="customer"]')) > 0, '소속 초성(ㄱㅇㅇㅎ=가온은행)으로 고객을 못 찾음');
    await esc(); await sleep(200);
    notes.push('바로 찾기 고객');

    // 3) 고객 등록: 오류는 그 칸 옆에, 그 칸으로 초점·스크롤
    await nav('#/assistant/customers?new=1', `!!document.querySelector('[data-testid="asst-cust-form"]')`);
    await H(`setId('asst-f-companyAddress', '서울 가상구')`); await sleep(100);
    await ev(`document.querySelector('.asst-dialog-body').scrollTo(0, 99999); true`); await sleep(150);
    await must(await H(`clickId('asst-cust-save')`), '등록 단추 없음');
    await sleep(300);
    await must((await txt('[data-testid="asst-f-name-error"]')).includes('이름은 필수'), `이름 칸 옆 오류가 없음: ${await txt('[data-testid="asst-f-name-error"]')}`);
    await must(await ev(`document.activeElement?.id === 'asst-f-name'`), '오류 칸(이름)으로 초점이 안 감');
    await must(await ev(`(() => { const r = document.getElementById('asst-f-name').getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight; })()`), '이름 칸이 화면 밖에 있음(스크롤 안 됨)');
    await H(`setId('asst-f-name', '오류시험')`); await H(`setId('asst-f-email', 'abc')`); await sleep(100);
    await H(`clickId('asst-cust-save')`); await sleep(300);
    await must((await txt('[data-testid="asst-f-email-error"]')).includes('이메일 형식'), `이메일 오류: ${await txt('[data-testid="asst-f-email-error"]')}`);
    await must(await ev(`document.activeElement?.id === 'asst-f-email'`), '이메일 칸으로 초점이 안 감');
    await H(`setId('asst-f-email', 'ok@test.example')`); await H(`setId('asst-f-mobile', '123')`); await H(`clickId('asst-cust-save')`); await sleep(300);
    await must((await txt('[data-testid="asst-f-mobile-error"]')).includes('8자리'), `휴대전화 오류: ${await txt('[data-testid="asst-f-mobile-error"]')}`);
    await H(`setId('asst-f-mobile', '010-0000-9999')`); await H(`setId('asst-f-birthDate', '2999-01-01')`); await H(`clickId('asst-cust-save')`); await sleep(300);
    await must((await txt('[data-testid="asst-f-birthDate-error"]')).includes('오늘 이후'), `생년월일 오류: ${await txt('[data-testid="asst-f-birthDate-error"]')}`);
    await shot('20-14-등록오류');
    await esc(); await sleep(300);
    notes.push('등록 오류가 칸 옆에');

    // 4) 요청 목록 상태 선택 상자: 글자가 잘리지 않고, 저장한 담당자가 목록에 보인다
    await nav('#/assistant/activities?sec=reqs', `document.querySelectorAll('[data-testid="asst-req-row"]').length > 0`);
    const sel = await ev(`(() => { const s = document.querySelector('[data-testid="asst-req-row"] select'); const cs = getComputedStyle(s); return { h: s.clientHeight, pt: cs.paddingTop, pb: cs.paddingBottom, sw: s.scrollWidth, cw: s.clientWidth, fs: parseFloat(cs.fontSize) }; })()`);
    await must(sel.h >= 28 && sel.pt === '0px' && sel.pb === '0px' && sel.sw <= sel.cw, `상태 선택 상자가 잘림: ${JSON.stringify(sel)}`);
    await must((await q('[data-testid="asst-req-assignee"]')) > 0, '요청 목록에 저장한 담당자가 안 보임');
    await shot('20-15-요청목록');
    notes.push('선택 상자·담당자');

    // 5) 대화 분석(예시): 이동 시 사라진다는 안내, 시험용 표시, 버리기 확인
    await nav('#/assistant/analyze', `!!document.querySelector('[data-testid="asst-an-sample"]')`);
    await H(`setId('asst-an-customer', ${JSON.stringify(await ev(`[...document.getElementById('asst-an-customer').options].find((o) => o.textContent.includes('김도현')).value`))})`); await sleep(150);
    await H(`clickId('asst-an-sample')`);
    await must(await wait(`!!document.querySelector('[data-testid="asst-an-review"]')`, 3000), '승인 화면이 안 열림');
    await must((await txt('[data-testid="asst-an-leave-warn"]')).includes('저장 전에 다른 곳으로 이동하면 결과가 사라집니다'), '결과 화면 위에 「이동하면 결과가 사라집니다」 안내가 없음');
    await must(await ev(`(() => { const r = document.querySelector('[data-testid="asst-an-leave-warn"]').getBoundingClientRect(); const c = document.querySelector('[data-testid="asst-an-label"]').getBoundingClientRect(); return r.bottom <= c.top + 4; })()`), '안내가 결과(라벨)보다 위에 있지 않음');
    await must((await txt('[data-testid="asst-an-sample-warn"]')).includes('시험용: 승인하면 이 고객 값이 실제로 바뀝니다'), '예시 분석에 「시험용: 승인하면 이 고객 값이 실제로 바뀝니다」가 없음');
    await shot('20-16-분석-안내');
    await H(`clickId('asst-an-discard')`);
    await must(await wait(`!!document.querySelector('[data-testid="asst-an-discard-confirm"]')`, 2000), '버리기가 확인 창 없이 처리됨');
    await esc(); await sleep(300);
    await must((await q('[data-testid="asst-an-review"]')) === 1, '확인 창에서 취소했는데 결과가 사라짐');
    await H(`clickId('asst-an-discard')`); await wait(`!!document.querySelector('[data-testid="asst-an-discard-confirm"]')`, 2000);
    await H(`clickId('asst-an-discard-confirm-ok')`);
    await must(await wait(`!document.querySelector('[data-testid="asst-an-review"]') && (document.querySelector('[data-testid="asst-an-notice"]')?.innerText || '').includes('버렸습니다')`, 2000), '확인 뒤 버려지지 않음');
    // 승인하면 최근 연락일은 그대로, 변경 이력 메모에 고객 이름이 든 파일명이 없다
    await nav('#/assistant/customers', `document.querySelectorAll('[data-testid="asst-cust-row"]').length > 0`);
    await must(await H(`click('[data-testid="asst-cust-row"]', '김도현')`), '김도현 행 없음');
    await wait(`!!document.querySelector('[data-testid="asst-detail"]')`, 3000);
    const kid = (await ev('location.hash')).split('/').pop().split('?')[0];
    const lcBefore = await txt('[data-testid="asst-v-lastContactDate"]');
    await nav('#/assistant/analyze', `!!document.querySelector('[data-testid="asst-an-sample"]')`);
    await H(`setId('asst-an-customer', ${JSON.stringify(kid)})`); await sleep(150);
    await H(`clickId('asst-an-sample')`); await wait(`!!document.querySelector('[data-testid="asst-an-review"]')`, 3000);
    await H(`clickId('asst-an-apply')`);
    await must(await wait(`!!document.querySelector('[data-testid="asst-an-done"]')`, 4000), '저장 완료 표시 없음');
    await nav(`#/assistant/customers/${kid}`, `!!document.querySelector('[data-testid="asst-v-lastContactDate"]')`);
    await must((await txt('[data-testid="asst-v-lastContactDate"]')) === lcBefore, `예시 분석 승인으로 최근 연락일이 바뀜(${lcBefore} → ${await txt('[data-testid="asst-v-lastContactDate"]')})`);
    await nav(`#/assistant/customers/${kid}?tab=changes`, `!!document.querySelector('[data-testid="asst-changes"]')`);
    const chg = await txt('[data-testid="asst-changes"]');
    await must(chg.includes('예시 대화') && !/kimdohyun|sample_call/.test(chg), `변경 이력의 예시 분석 메모: ${chg.slice(0, 160)}`);
    notes.push('분석 안내·버리기 확인·최근 연락일 유지');

    // 6) 변경 이력 복원 토스트, 완료한 미팅의 「미팅 후 질문 완료」 표시
    await must(await H(`clickId('asst-restore')`), '복원 단추 없음');
    await sleep(300);
    await must((await toastText()).includes('이전 값') && (await toastText()).includes('복원했습니다'), `복원 뒤 알림: ${await toastText()}`);
    notes.push('복원 알림');

    // 7) 보는 범위: 담당 고객이 없는 이서연은 안내와 「전체 보기」, 팀장은 「내 조직 전체」, 읽음은 사용자별
    await nav('#/assistant', `!!document.querySelector('[data-testid="asst-today"]')`);
    await must((await ev(`document.querySelector('[data-testid="asst-scope"]').dataset.value`)) === 'mine', '기본 범위가 「내 담당」이 아님');
    const n1 = Number(await txt('[data-testid="asst-nav-unread"]'));
    await must(n1 > 0, `김도윤 메뉴 숫자 ${n1}`);
    await must(await H(`user('이서연')`), '이서연 전환 실패');
    await sleep(500);
    await must(await wait(`!!document.querySelector('[data-testid="asst-today-noowned"]')`, 3000), '담당 고객이 없는 사용자에게 안내가 없음');
    await must((await txt('[data-testid="asst-today-noowned"]')).includes('담당하는 고객이 없습니다') && (await txt('[data-testid="asst-today-noowned"]')).includes('전체 보기'), `안내 글: ${await txt('[data-testid="asst-today-noowned"]')}`);
    await must((await q('[data-testid="asst-nav-unread"]')) === 0, '담당 고객이 없는데 메뉴에 알림 숫자가 있음');
    await shot('20-17-담당고객없음');
    await H(`clickId('asst-scope-goall')`);
    await must(await wait(`document.querySelectorAll('[data-testid="asst-notice"]').length > 0`, 3000), '전체 보기로 바꿨는데 알림이 안 보임');
    const nAll = Number(await txt('[data-testid="asst-nav-unread"]'));
    await must(nAll === n1, `전체 보기의 안 읽은 알림 ${nAll} ≠ 김도윤 ${n1}(읽음은 사용자별이라 같아야 함)`);
    await ev(`document.querySelector('[data-testid="asst-notice-read"]')?.click(); true`); await sleep(300);
    await must(Number(await txt('[data-testid="asst-nav-unread"]')) === nAll - 1, '읽음 표시가 메뉴 숫자에 반영되지 않음');
    await must(await ev(`localStorage.getItem('itda-asst-scope:U2') === 'all'`), '고른 범위가 사용자별로 기억되지 않음');
    await must(await H(`user('김도윤')`), '김도윤 복귀 실패');
    await sleep(500);
    await must((await ev(`document.querySelector('[data-testid="asst-scope"]').dataset.value`)) === 'mine', '다른 사용자의 범위 선택이 김도윤에게 넘어옴');
    await must(Number(await txt('[data-testid="asst-nav-unread"]')) === n1, '이서연이 읽은 알림이 김도윤의 안 읽은 숫자를 줄임');
    await must(await H(`user('박지훈')`), '박지훈 전환 실패');
    await sleep(500);
    await must(await wait(`!!document.querySelector('[data-testid="asst-scope-org"]')`, 3000), '조직장에게 「내 조직 전체」가 없음');
    await H(`clickId('asst-scope-org')`); await sleep(400);
    await must((await q('[data-testid="asst-notice"]')) > 0, '내 조직 전체로 바꿨는데 알림이 없음(같은 팀 김도윤의 고객)');
    // 조직장이 남의 고객을 열면 「조직장이라 수정할 수 있습니다」
    await nav('#/assistant/customers', `document.querySelectorAll('[data-testid="asst-cust-row"]').length > 0`);
    await must(await H(`click('[data-testid="asst-cust-row"]', '김도현')`), '김도현 행 없음');
    await wait(`!!document.querySelector('[data-testid="asst-detail"]')`, 3000);
    await must((await txt('[data-testid="asst-lead-note"]')).includes('조직장이라 수정할 수 있습니다'), '조직장이 남의 고객을 볼 때 안내가 없음');
    // 「내 담당만」 0명 문구
    await nav('#/assistant/customers', `!!document.querySelector('[data-testid="asst-cust-mine"]')`);
    await H(`clickId('asst-cust-mine')`); await sleep(300);
    await must(await ev(`document.querySelector('[data-testid="asst-customers"]').innerText.includes('내가 담당하는 고객이 없습니다')`), '「내 담당만」 0명 문구가 없음');
    await must(await H(`user('김도윤')`), '김도윤 복귀 실패(2)');
    notes.push('보는 범위·사용자별 읽음·조직장 안내');

    // 8) 미팅 후 질문: 날짜 없는 연기는 다음 단계로 못 가고, 비운 답은 그 질문에 안내
    await nav('#/assistant', `document.querySelectorAll('[data-testid="asst-fu-wait"]').length > 0`);
    await must(await ev(`(() => { const b = [...document.querySelectorAll('[data-testid="asst-fu-wait"] button')].find((x) => x.textContent.includes('질문 답하기')); if (!b) return false; b.click(); return true; })()`), '질문 답하기 단추 없음');
    await must(await wait(`!!document.querySelector('[data-testid="asst-fu-q-request"]')`, 3000), '미팅 후 질문 화면이 안 열림');
    const rq = await txt('[data-testid="asst-fu-q-request"]');
    await must(/^Q2 (오늘|\d+월 \d+일) /.test(rq), `질문 문구의 날짜: ${rq.slice(0, 40)}`);
    await must(await H(`clickId('asst-fu-opt-held-moved')`), '연기 선택지 없음');
    await must(await H(`clickId('asst-fu-opt-request-자료 요청')`), '요청 선택지 없음');
    await sleep(250);
    await must((await txt('[data-testid="asst-fu-q-held"]')).includes('바뀐 날짜를 입력해 주세요'), '날짜 없는 연기에 날짜 입력 안내가 없음');
    await must((await txt('[data-testid="asst-fu-q-request"]')).includes('내용을 적어야 저장됩니다'), '비운 요청 내용에 안내가 없음');
    await must(await ev(`document.querySelector('[data-testid="asst-fu-review-btn"]').disabled`), '날짜 없는 연기인데 「답변 확인」이 켜져 있음');
    await H(`setId('asst-fu-in-held-new_date', '2026-12-24')`); await sleep(200);
    await must(await ev(`!document.querySelector('[data-testid="asst-fu-review-btn"]').disabled`), '날짜를 넣었는데 「답변 확인」이 안 켜짐');
    // 연기 대신 「예정대로 진행됨」으로 바꿔 끝까지 저장 → 활동 목록에 「미팅 후 질문 완료」
    await H(`clickId('asst-fu-opt-held-yes')`); await sleep(150);
    await H(`clickId('asst-fu-opt-request-none')`); await sleep(150);
    await H(`clickId('asst-fu-review-btn')`);
    await must(await wait(`!!document.querySelector('[data-testid="asst-fu-review"]')`, 3000), '반영안 화면이 안 열림');
    await H(`clickId('asst-fu-apply')`);
    await must(await wait(`location.hash.includes('?tab=history')`, 4000), '저장 뒤 히스토리로 안 감');
    await must((await q('[data-testid="asst-fu-done"]')) >= 1, '완료한 미팅에 「미팅 후 질문 완료」 표시가 없음');
    notes.push('미팅 후 질문 안내·완료 표시');

    // 9) 데이터 옮기기: 내보내기에 고객 수, 바꿔 불러오기 확인에 고객 수(지금 → 파일), 칸 없는 파일은 지금 고객 유지, 합쳐 불러오기는 가상 고객 제외
    await must(await H(`click('button', '데이터 옮기기')`), '데이터 옮기기 단추 없음');
    await must(await wait(`!!document.querySelector('[data-testid="export-customers"]')`, 3000), '내보내기에 고객 수 표시가 없음');
    await must((await txt('[data-testid="export-customers"]')) === '18', `내보내기 고객 수 ${await txt('[data-testid="export-customers"]')}`);
    await must(await H(`click('button', '불러오기')`), '불러오기 탭 없음');
    const file = await ev(`(() => { const k = Object.keys(localStorage).find((x) => x.startsWith('worklink')); const o = JSON.parse(localStorage.getItem(k)); const st = o.state ?? o; delete st.assistant; return JSON.stringify(st); })()`);
    await ev(`(() => { const r = document.querySelector('input[name="dt-mode"][value="replace"]'); r.click(); return true; })()`);
    await H(`setId('dt-paste', '')`);
    await ev(`window.__h.setVal(document.getElementById('dt-paste'), ${JSON.stringify(file)}); true`);
    await must(await wait(`!!document.querySelector('[data-testid="replace-customers"]')`, 4000), '바꿔 불러오기 확인에 고객 수가 안 나옴');
    const rc = await txt('[data-testid="replace-customers"]');
    await must(rc.includes('지금 18명') && rc.includes('파일 칸 없음') && rc.includes('그대로 둡니다'), `확인 창 고객 수: ${rc}`);
    await ev(`document.querySelector('input[name="dt-mode"][value="merge"]').click(); true`);
    await must(await wait(`!!document.querySelector('[data-testid="merge-customers"]')`, 4000), '합쳐 불러오기 미리 보기에 고객 수가 없음');
    await must((await txt('[data-testid="merge-customers"]')) === '0', `합쳐 불러오기 고객 수 ${await txt('[data-testid="merge-customers"]')}(칸이 없는 파일은 0)`);
    await esc(); await sleep(300);
    notes.push('불러오기 고객 수');

    // 10) 설정 안내·초기화 문구
    await nav('#/assistant', `!!document.querySelector('[data-testid="asst-today"]')`);
    await H(`clickId('asst-settings-open')`);
    await must(await wait(`!!document.querySelector('[data-testid="asst-s-req"]')`, 3000), '설정이 안 열림');
    await must((await txt('[data-testid="asst-settings"]')).includes('며칠 전에 알릴지(쉼표로 구분)'), '설정의 「7,2,0」 설명이 없음');
    await H(`clickId('asst-s-restore')`); await sleep(400);
    await must((await toastText()).includes('건너뜀'), `다시 채우기 알림: ${await toastText()}`);
    await esc(); await sleep(300);
    await must(await H(`click('button', '초기화')`), '초기화 단추 없음');
    await sleep(300);
    await must(await ev(`document.body.innerText.includes('AI 비서의 고객·활동·요청사항')`), '초기화 확인 문구에 AI 비서 고객·활동·요청이 지워진다는 말이 없음');
    await esc(); await sleep(200);
    await ev(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '취소')?.click(); true`);
    notes.push('설정 안내·초기화 문구');
    return notes.join(' · ');
  });

  // 12
  const exc = logs.filter((l) => l.kind === 'exception');
  const err = logs.filter((l) => l.kind === 'error');
  const bad = exc.length;
  results.push({ name: '12 콘솔 exception 0', ok: bad === 0, note: `exception ${exc.length}건, console.error ${err.length}건` });
  console.log(`${bad === 0 ? 'PASS' : 'FAIL'}  12 콘솔 exception 0 — exception ${exc.length}건, console.error ${err.length}건`);
  if (bad) exc.slice(0, 5).forEach((l) => console.log('   ', String(l.text).slice(0, 300)));
} finally {
  await b.close();
}

const fail = results.filter((r) => !r.ok);
console.log(`\nPASS ${results.length - fail.length} · FAIL ${fail.length}`);
fail.forEach((r) => console.log(`  - ${r.name}: ${r.note}`));
console.log(`스크린샷: ${SHOTS}`);
process.exit(fail.length ? 1 : 0);
