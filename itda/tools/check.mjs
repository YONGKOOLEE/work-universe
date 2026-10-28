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
    node(label) { const cy = this.cy(); return cy ? cy.nodes().filter((n) => String(n.data('label')).includes(label)) : null; },
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
  await ev('localStorage.clear(); true');
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
  await check('02 김도윤 내 지도·팀 지도 안내', async () => {
    await nav('#/universe', mapReady);
    const labels = await H('labels()');
    const n = await H('nodes()');
    await must(n > 3, `노드 ${n}개`);
    await must(labels.some((l) => String(l).includes('김도윤의 업무')), `중심 라벨 없음: ${labels.slice(0, 5).join('|')}`);
    await must(await H(`click('button', '내 지도')`) || true, '');
    await shot('02-내지도');
    await must(await H(`click('button', '팀·부서 지도')`), '팀·부서 지도 칩 없음');
    await sleep(500);
    await must(await H(`find('[data-testid="map-lead-only"]','')!==null`), '팀장 전용 안내 없음');
    await shot('02-팀지도-안내');
    return `노드 ${n}, 중심 「김도윤의 업무」`;
  });

  // 3
  await check('03 팀장 팀·부서 지도·위험 점검·펼침', async () => {
    await must(await H(`user('박지훈')`), '박지훈 전환 실패');
    await nav('#/universe', mapReady);
    await sleep(800);
    const roots = await ev(`(() => { const cy = window.__h.cy(); return cy.nodes().filter((n) => n.data('core_type') === 'root').map((n) => n.data('label')); })()`);
    await must(roots.some((l) => l.includes('디지털신원팀')) && roots.some((l) => l.includes('출금이체팀')), `팀 중심: ${roots.join('|')}`);
    const risk = await ev(`(document.querySelector('[data-testid="map-risk"]')||{}).innerText || ''`);
    await must(risk.includes('혼자만 아는 일'), '위험 패널에 「혼자만 아는 일」 없음');
    const items = await ev(`document.querySelectorAll('[data-testid="map-solo-item"]').length`);
    await must(items > 0, '혼자만 아는 일 목록 비어 있음');
    await shot('03-팀장-접힘');
    const before = await H('nodes()');
    await ev(`(() => { const cy = window.__h.cy(); const t = cy.nodes().filter((n) => n.data('core_type') === 'root' && n.data('label').includes('디지털신원팀'))[0]; t.emit('dbltap'); return true; })()`);
    const grew = await wait(`window.__h.nodes() > ${before}`, 4000);
    await sleep(500);
    await shot('03-팀장-펼침');
    await must(grew, `dbltap 후 노드 수 그대로(${before})`);
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
    if (linkNote) { await must(await H(`user('김도윤')`), '김도윤 복귀 실패'); await nav('#/universe', mapReady); }
    // 숨기기
    await must(await H(`tap('비대면 출금동의 추진')`), '업무 노드 재선택 실패(3)');
    await wait(`!!document.querySelector('[data-testid="map-card"]')`, 3000);
    await must(await H(`clickId('map-hide')`), '숨기기 단추 없음');
    const gone = await wait(`!window.__h.labels().some((l) => String(l).includes('비대면 출금동의 추진'))`, 4000);
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
    await must(await H(`user('박지훈')`), '박지훈 전환 실패');
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
  await check('07 대시보드 혼자만 아는 업무', async () => {
    await must(await H(`user('박지훈')`), '박지훈 전환 실패');
    await nav('#/dashboard', `window.__h.has('AI가 발견한 누락')`);
    await sleep(500);
    const n = await ev(`(document.body.innerText.match(/혼자만 아는 업무/g) || []).length`);
    await shot('07-대시보드-팀장');
    await must(n >= 1, '「혼자만 아는 업무」 항목 없음');
    return `「혼자만 아는 업무」 ${n}곳`;
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
    const json = await ev(`document.querySelector('textarea[aria-label="백업 데이터"]').value`);
    const worksBefore = await ev(`JSON.parse(document.querySelector('textarea[aria-label="백업 데이터"]').value).works.length`);
    await must(await H(`click('button', '불러오기', true)`), '불러오기 탭 없음');
    await sleep(300);
    await must(await H(`click('[data-testid="merge-mode"] label', '합쳐 불러오기')`), '합쳐 불러오기 선택 불가');
    await sleep(200);
    await ev(`window.__h.setVal(document.getElementById('dt-paste'), ${JSON.stringify(json)}); true`);
    await must(await wait(`!!document.querySelector('[data-testid="merge-preview"]')`, 4000), '미리 보기 안 나옴');
    const prev = await ev(`document.querySelector('[data-testid="merge-preview"]').innerText.replace(/\\s+/g,' ').slice(0, 400)`);
    await shot('10-합치기-미리보기');
    await must(await H(`clickId('merge-confirm')`), '합쳐 불러오기 확인 단추 없음');
    await sleep(800);
    await H(`click('button', '데이터 옮기기')`);
    await sleep(400);
    await H(`click('button', '내보내기', true)`);
    await wait(`!!document.querySelector('textarea[aria-label="백업 데이터"]')`, 3000);
    const worksAfter = await ev(`JSON.parse(document.querySelector('textarea[aria-label="백업 데이터"]').value).works.length`);
    const usersAfter = await ev(`JSON.parse(document.querySelector('textarea[aria-label="백업 데이터"]').value).users.length`);
    await must(worksAfter === worksBefore, `업무 수 ${worksBefore}→${worksAfter} (같은 업무는 합쳐져야 함)`);
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
