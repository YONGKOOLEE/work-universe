// T-01 브라우저 점검(P-1·P-3). 설치된 Chrome·Edge를 DevTools 프로토콜로 조종해
// dist/index.html을 file://로 열고, 네트워크를 막은 상태에서 흐름을 확인한다.
// 사용: npm run build && npm run check:browser
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SAMPLE_A1 } from '../app/data/sample-a1.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pageUrl = pathToFileURL(join(root, 'dist/index.html')).href;
const tmp = join(root, '.tmp/browser-check');

const BROWSERS = [
  { name: 'Chrome', paths: ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'] },
  { name: 'Edge', paths: ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'] },
];

const NODES = SAMPLE_A1.nodes.length;
const EDGES = SAMPLE_A1.edges.length;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch(exe, profileDir, port) {
  const proc = spawn(exe, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    // 인터넷 차단: 모든 http(s) 요청을 닫힌 포트의 프록시로 보낸다
    '--proxy-server=http://127.0.0.1:9',
    '--proxy-bypass-list=<-loopback>',
    '--window-size=1280,800',
    'about:blank',
  ], { stdio: 'ignore' });
  for (let i = 0; i < 100; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return { proc, wsUrl: page.webSocketDebuggerUrl, browserWsUrl: version.webSocketDebuggerUrl, version: version.Browser };
    } catch { /* 아직 시작 전 */ }
    await sleep(100);
  }
  proc.kill();
  throw new Error('DevTools 연결 실패');
}

// 사용자가 창을 닫는 것과 같은 정상 종료(Browser.close). 강제 종료(kill)는 저장소 기록 전에 끝날 수 있다
async function close(session) {
  const exited = new Promise((r) => (session.proc.exitCode !== null ? r() : session.proc.once('exit', r)));
  try {
    const b = connect(session.browserWsUrl);
    await b.opened;
    await Promise.race([b.send('Browser.close'), sleep(3000)]);
  } catch { /* 이미 닫힘 */ }
  const done = await Promise.race([exited.then(() => true), sleep(10000).then(() => false)]);
  if (!done) session.proc.kill();
  await sleep(500); // 프로필 파일 잠금 해제 대기
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let seq = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    } else if (msg.method) listeners.forEach((l) => l(msg));
  };
  const opened = new Promise((r) => { ws.onopen = r; });
  return {
    opened,
    send(method, params = {}) {
      const id = ++seq;
      ws.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    on(fn) { listeners.push(fn); },
    close() { ws.close(); },
  };
}

async function evaluate(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}

async function waitFor(cdp, expression, timeout = 5000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try { if (await evaluate(cdp, expression)) return true; } catch { /* 로딩 중 */ }
    await sleep(100);
  }
  return false;
}

async function openSession(exe, profileDir, port, { blockStorage = false } = {}) {
  const b = await launch(exe, profileDir, port);
  const cdp = connect(b.wsUrl);
  await cdp.opened;
  const log = { errors: [], external: [] };
  cdp.on((msg) => {
    if (msg.method === 'Runtime.exceptionThrown') log.errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') log.errors.push(msg.params.entry.text);
    // 외부 네트워크 요청만 센다. Edge 새 탭 페이지의 내부 주소(chrome-search:// 등)는 페이지와 무관하다
    if (msg.method === 'Network.requestWillBeSent' && /^(https?|wss?):/i.test(msg.params.request.url)) log.external.push(msg.params.request.url);
  });
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Network.enable');
  await cdp.send('Page.enable');
  if (blockStorage) {
    // 쿠키·사이트 데이터 차단 시와 같은 동작: localStorage 접근이 SecurityError를 던진다
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: "Object.defineProperty(window,'localStorage',{get(){throw new DOMException('blocked','SecurityError')}})",
    });
  }
  await cdp.send('Page.navigate', { url: pageUrl });
  const ready = await waitFor(cdp, 'window.__wu && window.__wu.cy.nodes().length > 0');
  return { ...b, cdp, log, ready };
}

async function clickNode(cdp, nodeId) {
  const pos = await evaluate(cdp, `(() => {
    const n = window.__wu.cy.getElementById(${JSON.stringify(nodeId)});
    const p = n.renderedPosition();
    const r = document.getElementById('graph').getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  })()`);
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await cdp.send('Input.dispatchMouseEvent', { type, x: pos.x, y: pos.y, button: 'left', clickCount: 1 });
    await sleep(30);
  }
  await sleep(200);
}

async function submitAdd(cdp, coreType, label) {
  await evaluate(cdp, `(() => {
    const slot = document.getElementById('add-slot');
    const t = slot.querySelector('[data-testid=node-type]'); t.value = ${JSON.stringify(coreType)}; t.dispatchEvent(new Event('change'));
    slot.querySelector('[data-testid=node-label]').value = ${JSON.stringify(label)};
    slot.querySelector('button[type=submit]').click();
  })()`);
  await sleep(200);
  return evaluate(cdp, `(() => {
    const slot = document.getElementById('add-slot');
    const done = slot.querySelector('[data-testid=add-done]');
    const m = slot.querySelector('[data-testid=form-message]');
    return done ? { code: 'OK', text: done.textContent } : { code: (m && m.dataset.code) || '', text: m ? m.textContent : '' };
  })()`);
}

// 상세 패널의 편집 양식 채우기: fields = { 'data-testid 또는 CSS 선택자': 값 }
async function fillPanelForm(cdp, fields) {
  return evaluate(cdp, `(() => {
    const panel = document.getElementById('detail');
    for (const [sel, val] of Object.entries(${JSON.stringify(fields)})) {
      const el = panel.querySelector(sel.startsWith('.') || sel.startsWith('[') ? sel : \`[data-testid=\${sel}]\`);
      if (!el) return 'missing ' + sel;
      el.value = val;
      el.dispatchEvent(new Event('change'));
    }
    panel.querySelector('form button[type=submit]').click();
    return 'ok';
  })()`);
}
const panelMessage = (cdp) => evaluate(cdp, "(() => { const m = document.querySelector('#detail [data-testid=form-message]'); return m ? { code: m.dataset.code || '', text: m.textContent } : null; })()");
const clickTestId = (cdp, id) => evaluate(cdp, `document.querySelector('[data-testid=${id}]').click()`);

const text = (cdp, sel) => evaluate(cdp, `(document.querySelector(${JSON.stringify(sel)}) || {}).textContent || ''`);

// SHOT_DIR을 지정하면 화면을 PNG로 저장한다(사람이 화면을 검토할 때 쓴다)
async function shot(cdp, name) {
  if (!process.env.SHOT_DIR) return;
  await mkdir(process.env.SHOT_DIR, { recursive: true });
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(process.env.SHOT_DIR, `${name}.png`), Buffer.from(data, 'base64'));
}

const nodeCount = (cdp) => evaluate(cdp, 'window.__wu.cy.nodes().length');
const edgeCount = (cdp) => evaluate(cdp, 'window.__wu.cy.edges().length');
const hasLabel = (cdp, label) => evaluate(cdp, `window.__wu.cy.nodes().some(n => n.data('label') === ${JSON.stringify(label)})`);

async function checkBrowser(browser, port) {
  const exe = browser.paths.find(existsSync);
  if (!exe) return { browser: browser.name, skipped: '설치되지 않음' };
  const profile = join(tmp, browser.name.toLowerCase());
  await rm(profile, { recursive: true, force: true });
  const checks = [];
  const check = (name, pass, detail = '') => checks.push({ name, pass: !!pass, detail });
  const newLabel = `점검표 양식 ${Date.now() % 10000}`;

  // 1) 첫 실행: 표시 → 클릭 상세 → 추가 → 새로고침
  let s = await openSession(exe, profile, port);
  const version = s.version;
  check(`P-1 file:// 로드·그래프 표시(노드 ${NODES}, 연결 ${EDGES})`, s.ready && (await nodeCount(s.cdp)) === NODES && (await edgeCount(s.cdp)) === EDGES);
  check('저장소 경고 배너 없음(정상 환경)', await evaluate(s.cdp, "document.getElementById('banner').hidden"));

  // 처음 화면: 유니버스 개요와 범례
  const summary = await text(s.cdp, '#detail');
  check('처음 화면: 유니버스 개요와 사용법 안내', summary.includes('월말 정산 점검') && summary.includes('노드를 클릭하면'), summary.slice(0, 60));
  check('범례에 노드 유형이 보임', (await evaluate(s.cdp, "document.querySelectorAll('#legend li').length")) >= 5);
  await shot(s.cdp, `${browser.name}-1-start`);

  // 마우스를 올리면 이웃만 또렷하게(선택 전), 떼면 원래대로
  const hoverPos = await evaluate(s.cdp, `(() => { const p = window.__wu.cy.getElementById('U-A1/N-030').renderedPosition(); const r = document.getElementById('graph').getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; })()`);
  await s.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hoverPos.x, y: hoverPos.y });
  await sleep(150);
  const hoverFaded = await evaluate(s.cdp, "window.__wu.cy.elements('.faded').length");
  const hoodOk = await evaluate(s.cdp, "window.__wu.cy.getElementById('U-A1/N-001').hasClass('faded') === false");
  await shot(s.cdp, `${browser.name}-1b-hover`);
  const graphCorner = await evaluate(s.cdp, "(() => { const r = document.getElementById('graph').getBoundingClientRect(); return { x: r.left + 8, y: r.bottom - 8 }; })()");
  await s.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: graphCorner.x, y: graphCorner.y });
  await sleep(150);
  check('마우스 올림 → 이웃만 또렷하게, 떼면 원래대로', hoverFaded > 0 && hoodOk && (await evaluate(s.cdp, "window.__wu.cy.elements('.faded').length")) === 0);

  // R-01 ①: 노드 클릭 → 속성·연결 노드·이력이 같은 화면에
  await clickNode(s.cdp, 'U-A1/N-001');
  const detail = await text(s.cdp, '#detail');
  check('R-01 ① 노드 클릭 → 속성(설명·주기)', detail.includes('대사 확인') && detail.includes('매월') && detail.includes('원천 자료와 대조'), detail.slice(0, 80));
  const links = await text(s.cdp, '[data-testid=links]');
  check('R-01 ① 연결된 노드(관계·담당 기간)', ['월말 정산 점검', '서하늘', '윤바다', '한가람', '대사 불일치', '2026-10-01 ~ 진행 중'].every((t) => links.includes(t)), links.slice(0, 80));
  const history = await text(s.cdp, '[data-testid=history]');
  check('R-14 이력이 시간순 문장으로 보임', history.includes('한가람 → 윤바다 인수인계') && history.includes('윤바다 → 서하늘 인수인계') && history.indexOf('2025-03-01') < history.indexOf('2026-09-30'), history.slice(0, 60));
  check('선택한 노드 밖은 흐리게(이웃 강조)', (await evaluate(s.cdp, "window.__wu.cy.elements('.faded').length")) > 0);
  await shot(s.cdp, `${browser.name}-2-node`);

  // 상세 패널의 연결된 노드를 눌러 이동
  await evaluate(s.cdp, "[...document.querySelectorAll('[data-testid=links] button')].find(b => b.textContent === '대사 불일치').click()");
  await sleep(300);
  check('연결된 노드 링크를 누르면 그 노드로 이동', (await text(s.cdp, '#detail h2')) === '대사 불일치' && (await evaluate(s.cdp, 'window.__wu.selected')) === 'U-A1/N-030');

  // 빈 곳을 클릭하면 선택이 풀리고 개요로 돌아온다
  await evaluate(s.cdp, `(() => { const r = document.getElementById('graph').getBoundingClientRect(); window.__blank = { x: r.left + 8, y: r.top + 8 }; })()`);
  const blank = await evaluate(s.cdp, 'window.__blank');
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await s.cdp.send('Input.dispatchMouseEvent', { type, x: blank.x, y: blank.y, button: 'left', clickCount: 1 });
  await sleep(200);
  check('빈 곳 클릭 → 선택 해제, 개요로 복귀', (await evaluate(s.cdp, 'window.__wu.selected')) === null && (await text(s.cdp, '#detail')).includes('노드를 클릭하면'));

  const empty = await submitAdd(s.cdp, 'work', '   ');
  check('오류: 라벨 누락 → E-REQUIRED', empty.code === 'E-REQUIRED', empty.text);
  const dup = await submitAdd(s.cdp, 'work', '대사 확인');
  check('오류: 중복 → E-DUP + 기존 노드 링크', dup.code === 'E-DUP' && dup.text.includes('기존 노드 보기'), dup.text);

  const added = await submitAdd(s.cdp, 'artifact', newLabel);
  check('노드 1개 추가·저장', added.code === 'OK' && (await nodeCount(s.cdp)) === NODES + 1 && (await hasLabel(s.cdp, newLabel)), added.text);

  // 추가한 노드는 자동으로 선택된다. 연결이 없으면 "연결 없음"이고, 이어서 다른 노드를 계속 조작할 수 있다(R-01 ②)
  check('R-01 ② 연결 없는 노드 → "연결 없음"', await evaluate(s.cdp, "!!document.querySelector('[data-testid=no-links]')"));
  await shot(s.cdp, `${browser.name}-3-no-links`);
  await clickNode(s.cdp, 'U-A1/N-011');
  check('R-01 ② "연결 없음" 뒤에도 다른 노드를 계속 선택할 수 있음', (await text(s.cdp, '#detail h2')) === '윤바다' && !!(await evaluate(s.cdp, "!!document.querySelector('[data-testid=links]')")));

  // ── T-06 자료 편집 ──
  await evaluate(s.cdp, "window.confirm = () => true");
  // 수정: 설명을 바꾸면 상세에 반영되고 이력에 변경 전 값이 남는다(R-02 ②)
  await evaluate(s.cdp, "window.__wu.select('U-A1/N-001')");
  await clickTestId(s.cdp, 'btn-edit');
  await fillPanelForm(s.cdp, { 'node-description': '대조 결과를 점검표에 기록한다(수정)' });
  await sleep(250);
  const afterEdit = await text(s.cdp, '#detail');
  check('수정 → 상세에 바로 반영, 이력에 변경 전 값(R-02 ②)', afterEdit.includes('대조 결과를 점검표에 기록한다(수정)') && afterEdit.includes('수정 — 설명: 정산 결과를 원천 자료와 대조해 불일치를 찾는다 →'), afterEdit.slice(0, 80));
  // 수정 오류: 라벨을 비우면 저장되지 않는다(R-02 ③)
  await clickTestId(s.cdp, 'btn-edit');
  await fillPanelForm(s.cdp, { 'node-label': '  ' });
  await sleep(150);
  const editErr = await panelMessage(s.cdp);
  check('오류: 수정에서 라벨을 비우면 E-REQUIRED, 저장 안 됨', editErr && editErr.code === 'E-REQUIRED' && (await evaluate(s.cdp, "window.__wu.doc.nodes.find((n) => n.id === 'N-001').label")) === '대사 확인', editErr && editErr.text);
  await evaluate(s.cdp, "[...document.querySelectorAll('#detail button')].find((b) => b.textContent === '취소').click()");
  // 연결 추가: 서하늘 → 보고(수행)
  await evaluate(s.cdp, "window.__wu.select('U-A1/N-012')");
  await clickTestId(s.cdp, 'btn-edge');
  await fillPanelForm(s.cdp, { 'edge-type': 'performs', 'edge-direction': 'out', 'edge-other': 'N-003' });
  await sleep(250);
  check('연결 추가 → 그래프와 상세에 바로 반영', (await text(s.cdp, '[data-testid=links]')).includes('보고') && (await evaluate(s.cdp, "window.__wu.cy.edges().some((e) => e.data('source') === 'U-A1/N-012' && e.data('target') === 'U-A1/N-003')")));
  // 연결 오류: 주제가 업무를 수행할 수는 없다(E-PAIR)
  await evaluate(s.cdp, "window.__wu.select('U-A1/N-030')");
  await clickTestId(s.cdp, 'btn-edge');
  await fillPanelForm(s.cdp, { 'edge-type': 'performs', 'edge-direction': 'out', 'edge-other': 'N-001' });
  await sleep(150);
  const pairErr = await panelMessage(s.cdp);
  check('오류: 허용되지 않는 연결 → E-PAIR와 가능한 조합 안내', pairErr && pairErr.code === 'E-PAIR' && pairErr.text.includes('사람 → 업무'), pairErr && pairErr.text);
  // 연결 오류: 같은 연결(기간 겹침) → E-DUP
  await fillPanelForm(s.cdp, { 'edge-type': 'relates_to', 'edge-direction': 'in', 'edge-other': 'N-001' });
  await sleep(150);
  const edgeDup = await panelMessage(s.cdp);
  check('오류: 같은 연결 중복 → E-DUP', edgeDup && edgeDup.code === 'E-DUP', edgeDup && edgeDup.text);
  // 이력 추가: 메모
  await evaluate(s.cdp, "window.__wu.select('U-A1/N-001')");
  await clickTestId(s.cdp, 'btn-event');
  await fillPanelForm(s.cdp, { 'event-type': 'memo', 'event-date': '2026-10-02', 'event-note': '점검 기준 변경 논의' });
  await sleep(250);
  check('이력 추가(메모) → 이력 목록에 날짜와 함께 보임', (await text(s.cdp, '[data-testid=history]')).includes('2026-10-02메모점검 기준 변경 논의'));
  // 이력 오류: 인수인계에서 받는 사람을 비우면 거부
  await clickTestId(s.cdp, 'btn-event');
  await fillPanelForm(s.cdp, { 'event-type': 'handover', 'event-date': '2026-10-02' });
  await sleep(150);
  const evErr = await panelMessage(s.cdp);
  check('오류: 인수인계 필수값 누락 → E-REQUIRED', evErr && evErr.code === 'E-REQUIRED', evErr && evErr.text);
  await evaluate(s.cdp, "[...document.querySelectorAll('#detail button')].find((b) => b.textContent === '취소').click()");
  // 숨기기: 점검표 양식을 숨기면 그래프에서 빠지고, 이력은 남는다
  await evaluate(s.cdp, "window.__wu.select('U-A1/N-021')");
  await clickTestId(s.cdp, 'btn-hide');
  await sleep(250);
  check('숨기기 → 그래프에서 빠지고 문서에는 hidden으로 남음', !(await hasLabel(s.cdp, '점검표 양식')) && (await evaluate(s.cdp, "window.__wu.doc.nodes.find((n) => n.id === 'N-021').hidden === true && window.__wu.doc.events.some((e) => e.type === 'hidden' && e.payload.target_id === 'N-021')")));
  await shot(s.cdp, `${browser.name}-3b-edited`);

  // ── T-07 인수인계 초안 ──
  await evaluate(s.cdp, "window.__wu.select(null)");
  await clickTestId(s.cdp, 'btn-draft-universe');
  await sleep(150);
  // 오류: 받는 사람을 고르지 않으면 만들지 않는다
  await evaluate(s.cdp, `(() => {
    const set = (id, v) => { const e = document.querySelector('[data-testid=' + id + ']'); e.value = v; e.dispatchEvent(new Event('change')); };
    set('draft-target', 'U-A1/N-000'); set('draft-from', 'U-A1/N-011'); set('draft-to', '');
    document.querySelector('[data-testid=draft-form] button[type=submit]').click();
  })()`);
  await sleep(150);
  check('오류: 초안의 받는 사람 누락 → 만들지 않고 안내', (await text(s.cdp, '[data-testid=draft-message]')).includes('받는 사람') && !(await evaluate(s.cdp, "!!document.querySelector('[data-testid=draft-status]')")));
  await evaluate(s.cdp, `(() => {
    const e = document.querySelector('[data-testid=draft-to]'); e.value = 'U-A1/N-012'; e.dispatchEvent(new Event('change'));
    document.querySelector('[data-testid=draft-form] button[type=submit]').click();
  })()`);
  await sleep(250);
  const itemsCount = await evaluate(s.cdp, "document.querySelectorAll('[data-testid^=draft-item-]').length");
  check('R-03 초안 10개 항목, "초안" 상태와 생성 방식(규칙 기반) 표시(R-03 ③, R-04 ②)', itemsCount === 10 && (await text(s.cdp, '[data-testid=draft-status]')) === '초안' && (await text(s.cdp, '[data-testid=draft-method]')).includes('규칙 기반'));
  check('R-03 ① 항목에 근거 링크가 붙는다(관계자: 한가람, 이전 인수인계: 인수인계서)', (await text(s.cdp, '[data-testid=draft-item-관계자_연락처]')).includes('한가람') && (await evaluate(s.cdp, "document.querySelectorAll('[data-testid=draft-item-이전_인수인계] .evidence').length")) === 2);
  check('R-03 ② 근거가 없는 항목은 "이력 부족"(유사 경험자)', (await text(s.cdp, '[data-testid=draft-item-유사_경험자]')).includes('이력 부족'));
  check('숨긴 노드가 근거면 "숨김 처리된 노드"로 표시(점검표 양식을 숨긴 상태)', (await text(s.cdp, '[data-testid=draft-item-산출물_문서]')).includes('점검표 양식(숨김 처리된 노드)'));
  // 근거를 누르면 패널은 그대로 두고 그래프에서 그 노드를 보여 준다
  // CR-6 새 항목: 절차·마감·주의사항·진행 중·문의 연락처가 실제로 보인다
  const rich = {
    절차: await text(s.cdp, '[data-testid=draft-item-세부_업무_절차]'),
    마감: await text(s.cdp, '[data-testid=draft-item-일정_마감]'),
    주의: await text(s.cdp, '[data-testid=draft-item-주의사항]'),
    진행: await text(s.cdp, '[data-testid=draft-item-진행_중]'),
    연락: await text(s.cdp, '[data-testid=draft-item-관계자_연락처]'),
  };
  check('CR-6 초안에 절차·마감·주의사항·진행 중인 일·문의 연락처가 들어감', rich.절차.includes('진행 순서: 자료 수집 → 대사 확인 → 보고') && rich.절차.includes('절차: ① 점검표의 정산 합계') && rich.마감.includes('월 마감 후 3영업일 이내') && rich.주의.includes('월 경계 건은 따로 표시한다') && rich.진행.includes('회신 대기') && !rich.진행.includes('6월 불일치') && rich.연락.includes('문의: 보내는 사람 윤바다(V-1002)'), JSON.stringify(rich).slice(0, 160));
  await evaluate(s.cdp, "[...document.querySelectorAll('[data-testid=draft-item-관계자_연락처] li')].find((li) => li.textContent.startsWith('한가람')).querySelector('.evidence').click()");
  await sleep(250);
  check('근거 링크 → 그래프에서 해당 노드 선택, 초안은 그대로', (await evaluate(s.cdp, "window.__wu.cy.$(':selected').map((n) => n.id()).join()")) === 'U-A1/N-010' && (await evaluate(s.cdp, "!!document.querySelector('[data-testid=draft-status]')")));
  await shot(s.cdp, `${browser.name}-3c-draft`);
  // 화면 어디에도 'null' 글자가 들어가지 않는다(replaceChildren에 빈 값을 넘긴 실수 검출)
  const nullTexts = await evaluate(s.cdp, "(() => { document.querySelectorAll('details').forEach((d) => (d.open = true)); const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); const out = []; while (w.nextNode()) if (w.currentNode.textContent.trim() === 'null') out.push(w.currentNode.parentElement.id || w.currentNode.parentElement.className); return out; })()");
  check('화면에 "null" 글자 없음', nullTexts.length === 0, nullTexts.join(','));
  await evaluate(s.cdp, "[...document.querySelectorAll('[data-testid=draft-form] button')].find((b) => b.textContent === '닫기').click()");

  await s.cdp.send('Page.reload');
  await sleep(300);
  const reloaded = await waitFor(s.cdp, 'window.__wu && window.__wu.cy.nodes().length > 0');
  check('P-3 새로고침 후 추가·수정·숨김 유지', reloaded && (await nodeCount(s.cdp)) === NODES && (await hasLabel(s.cdp, newLabel)) && !(await hasLabel(s.cdp, '점검표 양식')));
  // CR-4 시제품: 팀 유니버스(접어서 보기, 펼치기, 묶기)
  await evaluate(s.cdp, "location.hash = 'U-T1'; location.reload()").catch(() => {});
  await sleep(500);
  const teamReady = await waitFor(s.cdp, "window.__wu && window.__wu.doc.universe.id === 'U-T1' && window.__wu.cy.nodes().length > 0", 8000);
  check('팀 유니버스: 접힌 상태로 19개 노드(꼭지·담당자·최상위 업무·공유 주제)', teamReady && (await nodeCount(s.cdp)) === 19);
  if (teamReady) {
  await shot(s.cdp, `${browser.name}-4-team`);
  // 카드승인 꼭지를 더블클릭해 펼친다
  const k1 = await evaluate(s.cdp, `(() => { const p = window.__wu.cy.getElementById('U-K1/N-000').renderedPosition(); const r = document.getElementById('graph').getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; })()`);
  for (const clickCount of [1, 2]) {
    for (const type of ['mousePressed', 'mouseReleased']) await s.cdp.send('Input.dispatchMouseEvent', { type, x: k1.x, y: k1.y, button: 'left', clickCount });
    await sleep(60);
  }
  await sleep(400);
  const expandedCount = await nodeCount(s.cdp);
  check('더블클릭 → 카드승인 유니버스 펼침(세부 노드가 나타남)', expandedCount > 40, String(expandedCount));
  await shot(s.cdp, `${browser.name}-5-team-expanded`);
  await evaluate(s.cdp, "window.__wu.toggle('U-K1')");
  await sleep(300);
  check('다시 접기 → 19개로 돌아옴', (await nodeCount(s.cdp)) === 19);
  // 위로 드러내기: 접힌 상태에서 노드의 상세에 체크 상자가 보인다
  await evaluate(s.cdp, "window.__wu.select('U-K1/N-101')");
  check('노드 상세에 "위층에 드러내기"와 기본 규칙 이유', (await text(s.cdp, '[data-testid=layer]')).includes('최상위 업무'));
  // 유니버스 묶기: 먼저 하나만 고르면 거부된다
  await evaluate(s.cdp, `(() => {
    document.getElementById('group-open').click();
    document.getElementById('group-name').value = '가상 점검팀';
    document.getElementById('group-owner').value = '가상 운영부';
    document.querySelector('#group-children input[value="U-A1"]').checked = true;
    document.querySelector('#group-form button[type=submit]').click();
  })()`);
  await sleep(200);
  check('오류: 유니버스를 1개만 고르면 묶지 않고 안내', (await text(s.cdp, '#group-message')).includes('2개 이상'));
  await evaluate(s.cdp, "document.getElementById('group-dialog').close()");
  await evaluate(s.cdp, `(() => {
    document.getElementById('group-open').click();
    document.getElementById('group-name').value = '가상 점검팀';
    document.getElementById('group-owner').value = '가상 운영부';
    document.querySelectorAll('#group-children input').forEach((i) => { if (i.value === 'U-A1' || i.value === 'U-K1') i.checked = true; });
    document.querySelector('#group-form button[type=submit]').click();
  })()`);
  await sleep(400);
  await waitFor(s.cdp, "window.__wu && window.__wu.doc.universe.name === '가상 점검팀'");
  // 새로 묶은 팀에는 주제 동일성 연결이 없어 "대사" 주제가 공유되지 않으므로 샘플 팀보다 1개 적다(18)
  check('유니버스 묶기 → 새 팀 유니버스가 열리고 두 업무가 접혀 보임(18개)', (await evaluate(s.cdp, "window.__wu.doc.universe.name")) === '가상 점검팀' && (await nodeCount(s.cdp)) === 18);
  // 묶음에서 빼기(확인 창은 자동 수락)
  await evaluate(s.cdp, "window.confirm = () => true; window.__wu.select('U-K1/N-000')");
  await evaluate(s.cdp, "[...document.querySelectorAll('[data-testid=layer] button')].find((b) => b.textContent === '묶음에서 빼기').click()");
  await sleep(300);
  check('묶음에서 빼기 → 카드승인 노드가 사라지고 월말 정산만 남음', !(await evaluate(s.cdp, "window.__wu.cy.nodes().some((n) => n.data('universe_id') === 'U-K1')")) && (await nodeCount(s.cdp)) === 8);
  }

  // 검토 결함 F1: 설명만 고쳤을 때 숫자 속성(순서: 1)이 글자로 바뀌어 "수정"으로 기록되지 않아야 한다
  await evaluate(s.cdp, "location.hash = 'U-K1'; location.reload()").catch(() => {});
  await sleep(500);
  if (await waitFor(s.cdp, "window.__wu && window.__wu.doc.universe.id === 'U-K1'", 8000)) {
    await evaluate(s.cdp, "window.confirm = () => true; window.__wu.select('U-K1/N-601')");
    await clickTestId(s.cdp, 'btn-edit');
    await fillPanelForm(s.cdp, { 'node-description': '필드 정의와 인코딩(수정)' });
    await sleep(250);
    const after = await evaluate(s.cdp, "(() => { const ev = window.__wu.doc.events.filter((e) => e.type === 'updated').at(-1); return ev ? Object.keys(ev.payload.after) : null; })()");
    check('수정 이력에 실제로 바꾼 필드만 남음(숫자 속성 유지)', JSON.stringify(after) === '["description"]', JSON.stringify(after));
  } else {
    check('수정 이력에 실제로 바꾼 필드만 남음(숫자 속성 유지)', false, '카드승인 유니버스를 열지 못함');
  }

  // ── T-08 유사 경험자(R-05) ──
  await evaluate(s.cdp, "location.hash = 'U-D1'; location.reload()").catch(() => {});
  await sleep(500);
  const deptReady = await waitFor(s.cdp, "window.__wu && window.__wu.doc.universe.id === 'U-D1' && window.__wu.cy.nodes().length > 0", 8000);
  check('부서 유니버스(부서 → 팀 → 업무 여러 단계)가 열림', deptReady);
  if (deptReady) {
    // 접힌 팀 꼭지를 펼쳐 대사 확인을 고를 수 있게 한다
    await evaluate(s.cdp, "window.__wu.toggle('U-T1')");
    await sleep(300);
    await evaluate(s.cdp, "window.__wu.toggle('U-A1')");
    await sleep(300);
    await evaluate(s.cdp, "window.__wu.select('U-A1/N-001')");
    await clickTestId(s.cdp, 'btn-similar');
    await sleep(200);
    const pickOk = await evaluate(s.cdp, "(() => { const p = document.querySelector('[data-testid=insight-work]'); return p.value; })()");
    check('업무 노드의 "유사 경험자" 버튼 → 그 업무가 미리 골라짐', pickOk === 'U-A1/N-001');
    const people = await text(s.cdp, '[data-testid=insight-people]');
    check('R-05 ① ④ 윤바다가 근거 업무·주제와 함께 나옴', people.includes('윤바다') && people.includes('2025 행사') && people.includes('같은 주제 「대사 불일치」(이름이 같은 주제, 연결 확인 전)'), people.slice(0, 120));
    check('R-05 ① 근거 버튼(공유 주제·업무)이 붙음', (await evaluate(s.cdp, "document.querySelectorAll('[data-testid=insight-people] .evidence').length")) >= 4);
    check('현재 담당자(서하늘)는 뺀다고 밝힘', (await text(s.cdp, '[data-testid=insight-excluded]')).includes('서하늘') && !people.includes('서하늘') && !people.includes('한가람'));
    check('R-05 ③ 결정은 사람이 한다는 안내', (await text(s.cdp, '#detail')).includes('사람이 정합니다'));
    await shot(s.cdp, `${browser.name}-6-similar`);
    // 근거를 누르면 그래프에서 그 노드를 강조한다
    await evaluate(s.cdp, "[...document.querySelectorAll('[data-testid=insight-people] .evidence')].find((b) => b.textContent === '2025 행사').click()");
    await sleep(250);
    check('근거 버튼 → 그래프에서 해당 노드 선택(패널은 그대로)', (await evaluate(s.cdp, "window.__wu.cy.$(':selected').map((n) => n.id()).join()")) === 'U-B/N-101' && !!(await evaluate(s.cdp, "!!document.querySelector('[data-testid=insight-people]')")));
    // 오류: 주제·산출물 연결이 없는 업무 → 데이터 부족
    await evaluate(s.cdp, `(() => { const p = document.querySelector('[data-testid=insight-work]'); p.value = 'U-A1/N-003'; p.dispatchEvent(new Event('change')); })()`);
    await sleep(150);
    check('오류(R-05 ②): 연결이 없는 업무 → "데이터 부족"만 표시', (await text(s.cdp, '[data-testid=insight-insufficient]')).includes('데이터 부족') && !(await evaluate(s.cdp, "!!document.querySelector('[data-testid=insight-people]')")));
    // 인수인계 초안의 유사 경험자 항목에도 같은 결과가 들어간다
    await evaluate(s.cdp, "window.__wu.select('U-A1/N-001')");
    await clickTestId(s.cdp, 'btn-draft');
    await evaluate(s.cdp, `(() => {
      const set = (id, v) => { const e = document.querySelector('[data-testid=' + id + ']'); e.value = v; e.dispatchEvent(new Event('change')); };
      set('draft-from', 'U-A1/N-011'); set('draft-to', 'U-A1/N-012');
      document.querySelector('[data-testid=draft-form] button[type=submit]').click();
    })()`);
    await sleep(250);
    const sim = await text(s.cdp, '[data-testid=draft-item-유사_경험자]');
    check('인수인계 초안의 "유사 경험자" 항목에 윤바다와 근거 링크가 들어감', sim.includes('윤바다(V-1002)') && !sim.includes('이력 부족') && (await evaluate(s.cdp, "document.querySelectorAll('[data-testid=draft-item-유사_경험자] .evidence').length")) >= 3);
    check('부서 화면에서도 화면에 "null" 글자 없음', (await evaluate(s.cdp, "(() => { const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); while (w.nextNode()) if (w.currentNode.textContent.trim() === 'null') return false; return true; })()")));
  }

  const errors1 = [...s.log.errors];
  const external1 = [...s.log.external];
  s.cdp.close();
  await close(s);

  // 2) 브라우저를 닫았다 다시 열기(같은 프로필)
  s = await openSession(exe, profile, port);
  check('P-3 브라우저 재시작 후 추가·수정·숨김 유지', s.ready && (await nodeCount(s.cdp)) === NODES && (await hasLabel(s.cdp, newLabel)) && (await evaluate(s.cdp, "window.__wu.doc.nodes.find((n) => n.id === 'N-001').description.includes('(수정)')")));
  const errors2 = [...s.log.errors];
  const external2 = [...s.log.external];
  s.cdp.close();
  await close(s);

  check('인터넷 차단 상태에서 외부 요청 0건', external1.length + external2.length === 0, [...external1, ...external2].join(', '));
  check('스크립트 오류 0건', errors1.length + errors2.length === 0, [...errors1, ...errors2].join(' | '));

  // 3) 저장소 차단
  const blockedProfile = `${profile}-blocked`;
  await rm(blockedProfile, { recursive: true, force: true });
  s = await openSession(exe, blockedProfile, port, { blockStorage: true });
  const banner = await evaluate(s.cdp, "({ hidden: document.getElementById('banner').hidden, code: document.getElementById('banner').dataset.code || '' })");
  check('오류: 저장소 차단 → W-STORAGE 배너', !banner.hidden && banner.code === 'W-STORAGE');
  check(`저장소 차단 시 샘플 읽기 전용 표시(노드 ${NODES}, 추가 비활성)`, s.ready && (await nodeCount(s.cdp)) === NODES && (await text(s.cdp, '#add-slot')).includes('읽기 전용'));
  s.cdp.close();
  await close(s);

  return { browser: browser.name, version, exe, checks };
}

await mkdir(tmp, { recursive: true });
if (!existsSync(join(root, 'dist/index.html'))) {
  console.error('dist/index.html이 없습니다. 먼저 npm run build를 실행하세요.');
  process.exit(1);
}
console.log(`대상: ${pageUrl}\n점검일: ${new Date().toISOString()}\n`);
let failed = 0;
let port = 9333;
for (const b of BROWSERS) {
  const r = await checkBrowser(b, port++);
  if (r.skipped) { console.log(`## ${r.browser}: 건너뜀(${r.skipped})\n`); continue; }
  console.log(`## ${r.browser} — ${r.version}`);
  for (const c of r.checks) {
    if (!c.pass) failed += 1;
    console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${!c.pass && c.detail ? `  [${c.detail}]` : ''}`);
  }
  console.log('');
}
await rm(tmp, { recursive: true, force: true }).catch(() => {});
console.log(failed ? `실패 ${failed}건` : '모두 통과');
process.exit(failed ? 1 : 0);
