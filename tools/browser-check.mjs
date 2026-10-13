// T-01 브라우저 점검(P-1·P-3). 설치된 Chrome·Edge를 DevTools 프로토콜로 조종해
// dist/index.html을 file://로 열고, 네트워크를 막은 상태에서 흐름을 확인한다.
// 사용: npm run build && npm run check:browser
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SAMPLE_A1 } from '../app/data/sample-a1.js';
import { SAMPLES } from '../app/data/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// PAGE를 주면 그 파일을 점검한다(T-15: 제출 압축을 푼 index.html)
const pageUrl = `${pathToFileURL(process.env.PAGE || join(root, 'dist/index.html')).href}?check`; // ?check: 점검용 전역(window.__wu)을 켠다
const tmp = join(root, '.tmp/browser-check');

const BROWSERS = [
  { name: 'Chrome', paths: ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'] },
  { name: 'Edge', paths: ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'] },
];

const NODES = SAMPLE_A1.nodes.length;
const EDGES = SAMPLE_A1.edges.length;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch(exe, profileDir, port, retry = true) {
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
  for (let i = 0; i < 400; i += 1) { // 40초: Edge는 점검 직후 시작이 느릴 때가 있다
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return { proc, wsUrl: page.webSocketDebuggerUrl, browserWsUrl: version.webSocketDebuggerUrl, version: version.Browser };
    } catch { /* 아직 시작 전 */ }
    await sleep(100);
  }
  proc.kill();
  // 같은 프로필을 닫자마자 다시 열면 이전 프로세스가 잠금을 쥔 채일 수 있다: 한 번 더 시도
  if (retry) {
    await sleep(4000);
    return launch(exe, profileDir, port, false);
  }
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
  await sleep(1500); // 프로필 파일 잠금 해제 대기
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
  await cdp.send('Page.navigate', { url: `${pageUrl}#U-A1` });
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

// 주소의 #유니버스ID를 지우고 다시 연다 = 더블클릭으로 처음 연 상태(시작 화면)
async function goBare(cdp) {
  await evaluate(cdp, "history.replaceState(null, '', location.pathname + location.search); location.reload()").catch(() => {});
  await sleep(500);
  return waitFor(cdp, 'window.__wu && window.__wu.start === true', 8000);
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
  const check = (name, pass, detail = '') => { checks.push({ name, pass: !!pass, detail }); if (process.env.CHECK_LIVE) console.log((pass ? 'PASS ' : 'FAIL ') + name + (pass ? '' : '  [' + detail + ']')); };
  const newLabel = `점검표 양식 ${Date.now() % 10000}`;

  // 1) 첫 실행: 표시 → 클릭 상세 → 추가 → 새로고침
  let s = await openSession(exe, profile, port);
  const version = s.version;
  check(`P-1 file:// 로드·그래프 표시(노드 ${NODES}, 연결 ${EDGES})`, s.ready && (await nodeCount(s.cdp)) === NODES && (await edgeCount(s.cdp)) === EDGES);

  // ── 흐름 정렬(시제품, 조력자 의견 2026-10-12): 가로 = 선후, 세로 = 유형 층. 기본 배치와 나란히 화면을 남긴다 ──
  const flowShot = async (id, tag) => {
    await evaluate(s.cdp, `location.hash = '${id}'; location.reload()`).catch(() => {});
    await sleep(600);
    await waitFor(s.cdp, `window.__wu && window.__wu.doc && window.__wu.doc.universe.id === '${id}' && window.__wu.cy.nodes().length > 0`, 8000);
    await evaluate(s.cdp, "window.__wu.select(null)");
    await sleep(300);
    await shot(s.cdp, `${browser.name}-20${tag}-ring-${id}`);
    await clickTestId(s.cdp, 'flowlayout').catch(() => evaluate(s.cdp, "document.getElementById('flowlayout').click()"));
    await sleep(500);
  };
  await flowShot('U-A1', 'a');
  const flowPos = await evaluate(s.cdp, `(() => { const cy = window.__wu.cy; const by = (l) => cy.nodes().filter((n) => n.data('label') === l)[0]; const p = (l) => by(l).position(); return { collect: p('자료 수집').x, check: p('대사 확인').x, report: p('보고').x, personY: p('서하늘').y, workY: p('대사 확인').y, docY: p('점검표 양식').y }; })()`);
  check('흐름 정렬: 자료 수집 → 대사 확인 → 보고가 왼쪽에서 오른쪽, 사람은 업무 위, 산출물은 아래', flowPos.collect < flowPos.check && flowPos.check < flowPos.report && flowPos.personY < flowPos.workY && flowPos.docY > flowPos.workY, JSON.stringify(flowPos));
  check('흐름 정렬: 화면 밖으로 나간 노드 없음, 이름이 읽히는 크기', await evaluate(s.cdp, "(() => { const cy = window.__wu.cy; const r = document.getElementById('graph').getBoundingClientRect(); return cy.nodes().every((n) => { const b = n.renderedBoundingBox({ includeLabels: false }); return b.x2 > 0 && b.y2 > 0 && b.x1 < r.width && b.y1 < r.height; }); })()"));
  await shot(s.cdp, `${browser.name}-20b-flow-U-A1`);
  await evaluate(s.cdp, "document.getElementById('relayout').click()");
  await sleep(500);
  check('흐름 정렬 뒤 「다시 정렬」 → 원래 고리 배치로 돌아감(업무 y가 한 줄에 모이지 않음)', await evaluate(s.cdp, "(() => { const ys = window.__wu.cy.nodes().filter((n) => n.data('core_type') === 'work').map((n) => Math.round(n.position().y)); return new Set(ys).size > 1; })()"));
  await flowShot('U-D1', 'c');
  await shot(s.cdp, `${browser.name}-20d-flow-U-D1`);
  check('흐름 정렬(부서 화면): 모든 노드가 화면 안에 있음', await evaluate(s.cdp, "(() => { const cy = window.__wu.cy; const r = document.getElementById('graph').getBoundingClientRect(); return cy.nodes().every((n) => { const b = n.renderedBoundingBox({ includeLabels: false }); return b.x2 > 0 && b.y2 > 0 && b.x1 < r.width && b.y1 < r.height; }); })()"));
  await evaluate(s.cdp, "location.hash = 'U-A1'; location.reload()").catch(() => {});
  await sleep(600);
  await waitFor(s.cdp, "window.__wu && window.__wu.doc && window.__wu.doc.universe.id === 'U-A1' && window.__wu.cy.nodes().length > 0", 8000);
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
  // 검토5 U-1: 자기 유니버스 노드를 고른 상세 패널(드러내기 상자 포함)에 "null" 글자가 없다
  check('노드를 고른 상세 패널에 "null" 글자 없음', (await evaluate(s.cdp, "(() => { const w = document.createTreeWalker(document.getElementById('detail'), NodeFilter.SHOW_TEXT); while (w.nextNode()) if (w.currentNode.textContent.trim() === 'null') return false; return true; })()")));
  check('드러내기 상자는 묶은 상위 유니버스 이름을 말한다(검토5 U-4)', (await text(s.cdp, '[data-testid=layer]')).includes('「가상정산팀」 화면에서도'));
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

  // 여섯 번째 검토 U-1: 업무 유형이면 사번 칸이 보이지 않는다(hidden 속성이 CSS에 지던 결함). 사람이면 보인다
  const empH = () => evaluate(s.cdp, "(() => { const e = document.querySelector('#add-slot [data-testid=node-empno]'); const f = e && e.closest('label, .field'); return f ? Math.round(f.getBoundingClientRect().height) : -1; })()");
  await evaluate(s.cdp, "(() => { const t = document.querySelector('#add-slot [data-testid=node-type]'); t.value = 'work'; t.dispatchEvent(new Event('change')); })()");
  const hWork = await empH();
  await evaluate(s.cdp, "(() => { const t = document.querySelector('#add-slot [data-testid=node-type]'); t.value = 'person'; t.dispatchEvent(new Event('change')); })()");
  const hPerson = await empH();
  await evaluate(s.cdp, "(() => { const t = document.querySelector('#add-slot [data-testid=node-type]'); t.value = 'work'; t.dispatchEvent(new Event('change')); })()");
  check('U-1: 노드 추가 양식 — 업무 유형이면 사번 칸 높이 0, 사람이면 보임', hWork === 0 && hPerson > 0, hWork + '/' + hPerson);
  check('U-14: 양식 칸 이름이 「이름」(「라벨」 아님)', (await text(s.cdp, '#add-slot')).includes('이름') && !(await text(s.cdp, '#add-slot')).includes('라벨'));
  const empty = await submitAdd(s.cdp, 'work', '   ');
  check('오류: 이름 누락 → E-REQUIRED, 받침에 맞는 조사(「이름을」)', empty.code === 'E-REQUIRED' && empty.text.includes('이름을 입력하세요'), empty.text);
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
  check('N-4 연결 오류에 고른 두 노드의 유형과 쓸 수 있는 관계(관련: 대사 확인 → 대사 불일치)', !!pairErr && pairErr.text.includes('「대사 불일치」는 주제') && pairErr.text.includes('「대사 확인」은 업무') && pairErr.text.includes('「관련」(대사 확인 → 대사 불일치)'), pairErr && pairErr.text);
  // 연결 오류: 같은 연결(기간 겹침) → E-DUP
  await fillPanelForm(s.cdp, { 'edge-type': 'relates_to', 'edge-direction': 'in', 'edge-other': 'N-001' });
  await sleep(150);
  const edgeDup = await panelMessage(s.cdp);
  check('오류: 같은 연결 중복 → E-DUP', edgeDup && edgeDup.code === 'E-DUP', edgeDup && edgeDup.text);
  // 이력 추가: 메모
  await evaluate(s.cdp, "window.__wu.select('U-A1/N-001')");
  await clickTestId(s.cdp, 'btn-event');
  // 여섯 번째 검토 U-2: 내용이 빈 메모는 저장하지 않는다(이력은 지울 수 없다)
  const eventsBefore = await evaluate(s.cdp, 'window.__wu.doc.events.length');
  await fillPanelForm(s.cdp, { 'event-type': 'memo', 'event-date': '2026-10-02', 'event-note': '   ' });
  await sleep(150);
  const emptyMemo = await panelMessage(s.cdp);
  check('U-2: 내용 없는 메모 → 「메모 내용을 입력하세요」, 이력이 늘지 않음', !!emptyMemo && emptyMemo.code === 'E-REQUIRED' && emptyMemo.text.includes('메모 내용을 입력하세요') && (await evaluate(s.cdp, 'window.__wu.doc.events.length')) === eventsBefore, emptyMemo && emptyMemo.text);
  // C-1 연도 오타 날짜는 거부
  await fillPanelForm(s.cdp, { 'event-type': 'memo', 'event-date': '0202-06-01', 'event-note': '연도 오타' });
  await sleep(150);
  const badYear = await panelMessage(s.cdp);
  check('C-1: 연도 오타 날짜(0202-06-01) → 날짜 오류, 이력이 늘지 않음', !!badYear && badYear.text.includes('1900~2200') && (await evaluate(s.cdp, 'window.__wu.doc.events.length')) === eventsBefore, badYear && badYear.text);
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

  // ── T-12 생성 방식 설정: 기본은 사전 생성. 이 단계는 앞에서 데이터를 고친 상태라 규칙 기반 문장을 점검하려고 「규칙 기반만」으로 바꾼다 ──
  check('R-15: 머리글에 지금 생성 방식(사전 생성) 표시', (await text(s.cdp, '#settings-open')).includes('사전 생성'));
  const pickProvider = async (name) => {
    await evaluate(s.cdp, "document.getElementById('settings-open').click()");
    await sleep(150);
    await evaluate(s.cdp, `(() => { const r = document.querySelector('[data-testid=provider-${name}]'); r.checked = true; r.dispatchEvent(new Event('change')); })()`);
    await sleep(100);
    await clickTestId(s.cdp, 'settings-close');
    await sleep(100);
  };
  await pickProvider('none');
  check('설정에서 「규칙 기반만」을 고르면 머리글 표시가 바뀌고 저장된다(12.4)', (await text(s.cdp, '#settings-open')).includes('규칙 기반만') && (await evaluate(s.cdp, "JSON.parse(localStorage.getItem('wu:v1:settings')).provider")) === 'none');

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
  // 검토5 I-1: 이전 인수인계는 E-002(+인수인계서)와 E-007(구두) 두 줄 → 근거 3개
  check('R-03 ① 항목에 근거 링크가 붙는다(관계자: 한가람, 이전 인수인계: 문서·구두 두 건)', (await text(s.cdp, '[data-testid=draft-item-관계자_연락처]')).includes('한가람') && (await evaluate(s.cdp, "document.querySelectorAll('[data-testid=draft-item-이전_인수인계] .evidence').length")) === 3 && (await text(s.cdp, '[data-testid=draft-item-이전_인수인계]')).includes('2026-09-30 윤바다 → 서하늘'));
  // N-5: 유니버스 전체가 대상이면 비교할 다른 업무가 없어 '해당 없음'(이력 부족과 구별). R-03 ② 이력 부족은 교육팀 신규 과정 단계에서 확인
  const simItem = await text(s.cdp, '[data-testid=draft-item-유사_경험자]');
  check('N-5 유사 경험자: 비교했지만 해당자 없음 → "해당 없음"과 이유(이력 부족과 구별)', simItem.includes('해당 없음') && simItem.includes('비교할 다른 업무가 없습니다') && !simItem.includes('이력 부족'), simItem.slice(0, 120));
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
  // R-04 ③ 화면 시연: 「실패 흉내」를 고르고 같은 초안을 만들면 규칙 기반으로 바뀌고 원인이 보인다
  await pickProvider('fail');
  await evaluate(s.cdp, "window.__wu.select(null)");
  await clickTestId(s.cdp, 'btn-draft-universe');
  await sleep(150);
  await evaluate(s.cdp, `(() => {
    const set = (id, v) => { const e = document.querySelector('[data-testid=' + id + ']'); e.value = v; e.dispatchEvent(new Event('change')); };
    set('draft-target', 'U-A1/N-000'); set('draft-from', 'U-A1/N-011'); set('draft-to', 'U-A1/N-012');
    document.querySelector('[data-testid=draft-form] button[type=submit]').click();
  })()`);
  await sleep(250);
  check('R-04 ③: 실패 흉내 → 생성 방식 규칙 기반과 원인(호출 실패) 표시, 초안은 그대로 10개 항목', (await text(s.cdp, '[data-testid=draft-method]')).includes('규칙 기반') && (await text(s.cdp, '[data-testid=draft-fallback]')).includes('호출 실패') && (await evaluate(s.cdp, "document.querySelectorAll('[data-testid^=draft-item-]').length")) === 10);
  await shot(s.cdp, `${browser.name}-3d-draft-fail`);
  // 화면 어디에도 'null' 글자가 들어가지 않는다(replaceChildren에 빈 값을 넘긴 실수 검출)
  const nullTexts = await evaluate(s.cdp, "(() => { document.querySelectorAll('details').forEach((d) => (d.open = true)); const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); const out = []; while (w.nextNode()) if (w.currentNode.textContent.trim() === 'null') out.push(w.currentNode.parentElement.id || w.currentNode.parentElement.className); return out; })()");
  check('화면에 "null" 글자 없음', nullTexts.length === 0, nullTexts.join(','));
  await evaluate(s.cdp, "[...document.querySelectorAll('[data-testid=draft-form] button')].find((b) => b.textContent === '닫기').click()");

  await pickProvider('pregen'); // 이후 단계는 기본 생성 방식으로
  await s.cdp.send('Page.reload');
  await sleep(300);
  const reloaded = await waitFor(s.cdp, 'window.__wu && window.__wu.cy.nodes().length > 0');
  check('P-3 새로고침 후 추가·수정·숨김 유지', reloaded && (await nodeCount(s.cdp)) === NODES && (await hasLabel(s.cdp, newLabel)) && !(await hasLabel(s.cdp, '점검표 양식')));
  // CR-4 시제품: 팀 유니버스(접어서 보기, 펼치기, 묶기)
  await evaluate(s.cdp, "location.hash = 'U-T1'; location.reload()").catch(() => {});
  await sleep(500);
  const teamReady = await waitFor(s.cdp, "window.__wu && window.__wu.doc.universe.id === 'U-T1' && window.__wu.cy.nodes().length > 0", 8000);
  check('묶은 유니버스(팀)에서는 「노드 추가」를 강제로 펼치지 않는다(최종 검토)', await evaluate(s.cdp, "(() => { const d = document.querySelector('details.add'); d.open = false; window.__wu.select(null); return d.open === false; })()"));
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
  // 재검증: 띄어쓰기 있는 긴 이름은 글자 단위로 끊지 않는다(text-overflow-wrap anywhere는 긴 낱말 노드에만)
  check('띄어쓰기 있는 긴 노드 이름은 낱말 가운데서 끊지 않음', await evaluate(s.cdp, "(() => { const n = window.__wu.cy.$id('U-K1/N-000'); return !!n && n.style('text-overflow-wrap') === 'whitespace'; })()"));
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

  // ── T-14 시작 화면(R-08) ──
  await evaluate(s.cdp, 'window.confirm = () => true');
  const onStart = await goBare(s.cdp);
  check('R-08 주소에 유니버스가 없으면(처음 더블클릭) 시작 화면이 열림', onStart);
  if (onStart) {
    const startText = await text(s.cdp, '#start-screen');
    // 눌러지는 것과 눈에 보이는 것은 다르다: 핵심 요소가 실제로 화면에 그려지는지(크기가 있는지) 확인한다
    check('R-08 시작 화면의 제목·설명·추천 버튼이 실제로 보임', await evaluate(s.cdp, "['.start-hero h1', '.start-hero .lead', '[data-testid=start-primary]', '[data-testid=start-create]'].every((q) => { const r = document.querySelector(q).getBoundingClientRect(); return r.width > 0 && r.height > 0; })"));
    check('R-08 시작 화면에 이게 무엇인지 한 줄 설명과 가상 데이터 안내', startText.includes('누가 무엇을 해 왔는지 한눈에 보고 인수인계를 돕는 도구') && startText.includes('모든 이름과 데이터는 가상'));
    check('R-08 "처음이라면 이 순서로" 4단계 안내', (await evaluate(s.cdp, "document.querySelectorAll('[data-testid=start-steps] li').length")) === 4);
    check(`샘플 카드 ${SAMPLES.length}개(내장 샘플 전부)와 추천(월말 정산) 표시, 내 유니버스 안내`, (await evaluate(s.cdp, "document.querySelectorAll('[data-testid=start-samples] .card').length")) === SAMPLES.length && (await evaluate(s.cdp, "document.querySelector('[data-testid=card-U-A1]').classList.contains('recommended')")) && !!(await evaluate(s.cdp, "!!document.querySelector('[data-testid=start-mine], [data-testid=start-mine-empty]')")));
    check('시작 화면에 "null" 글자 없음', await evaluate(s.cdp, "(() => { const w = document.createTreeWalker(document.getElementById('start-screen'), NodeFilter.SHOW_TEXT); while (w.nextNode()) if (w.currentNode.textContent.trim() === 'null') return false; return true; })()"));
    await evaluate(s.cdp, 'window.scrollTo(0, 0)');
    await shot(s.cdp, `${browser.name}-0-start`);
    // 한 번 눌러 탐색 시작(R-08): 추천 샘플이 열리고 그래프가 보인다
    await evaluate(s.cdp, "document.querySelector('[data-testid=start-primary]').click()");
    await sleep(500);
    const opened = await waitFor(s.cdp, "window.__wu && window.__wu.doc && window.__wu.doc.universe.id === 'U-A1' && window.__wu.cy.nodes().length > 0", 8000);
    check('R-08 "샘플 바로 열기" 한 번으로 그래프 탐색이 시작됨', opened);
    // 제목을 누르면 시작 화면으로 돌아온다
    await evaluate(s.cdp, "document.getElementById('home').click()").catch(() => {});
    await sleep(500);
    check('머리글 제목을 누르면 시작 화면으로 돌아옴', await waitFor(s.cdp, 'window.__wu && window.__wu.start === true', 8000));
    await evaluate(s.cdp, "document.querySelector('[data-testid=open-U-D1]').click()");
    await sleep(500);
    check('카드의 "열기"로 다른 샘플(가상 운영부)을 열 수 있음', await waitFor(s.cdp, "window.__wu && window.__wu.doc && window.__wu.doc.universe.id === 'U-D1'", 8000));
  }
  await evaluate(s.cdp, "location.hash = 'U-A1'; location.reload()").catch(() => {});
  await sleep(500);
  await waitFor(s.cdp, "window.__wu && window.__wu.doc && window.__wu.doc.universe.id === 'U-A1'", 8000);

  // ── T-09 새 유니버스(R-12)와 하위 유형 ──
  await evaluate(s.cdp, "window.confirm = () => true; window.__wu.select(null)");
  const submitCreate = (name, level, owner) => evaluate(s.cdp, `(() => {
    document.getElementById('create-open').click();
    document.getElementById('create-name').value = ${JSON.stringify(name)};
    document.getElementById('create-level').value = ${JSON.stringify(level)};
    document.getElementById('create-owner').value = ${JSON.stringify(owner)};
    document.querySelector('#create-form button[type=submit]').click();
  })()`);
  await submitCreate('', '업무', '가상 교육팀');
  await sleep(150);
  check('오류(R-12 ②): 이름이 비면 만들지 않고 사유 표시', (await evaluate(s.cdp, "document.getElementById('create-message').dataset.code")) === 'E-REQUIRED' && (await text(s.cdp, '#create-message')).includes('이름'));
  await evaluate(s.cdp, "document.getElementById('create-dialog').close()");
  await submitCreate('연말 교육 운영', '업무', '가상 교육팀');
  await sleep(500);
  const created = await waitFor(s.cdp, "window.__wu && window.__wu.doc.universe.name === '연말 교육 운영' && window.__wu.cy.nodes().length === 1", 8000);
  check('R-12 ① 새 유니버스를 만들면 꼭지만 있는 빈 유니버스가 열림', created);
  if (created) {
    const addR = await submitAdd(s.cdp, 'work', '교육 안내');
    check('R-12 ① 새 유니버스에 노드를 추가할 수 있음(업무는 꼭지에 바로 연결)', addR.code === 'OK' && (await nodeCount(s.cdp)) === 2 && (await edgeCount(s.cdp)) === 1, addR.text);
    await evaluate(s.cdp, `(() => {
      const slot = document.getElementById('add-slot');
      const t = slot.querySelector('[data-testid=node-type]'); t.value = 'artifact'; t.dispatchEvent(new Event('change'));
      const st = slot.querySelector('[data-testid=node-subtype]'); st.value = '__new__'; st.dispatchEvent(new Event('change'));
      slot.querySelector('[data-testid=node-subtype-new]').value = '회의록';
      slot.querySelector('[data-testid=node-label]').value = '10월 회의록';
      slot.querySelector('button[type=submit]').click();
    })()`);
    await sleep(250);
    check('하위 유형을 새로 추가하면서 노드를 만들 수 있음(데이터만 늘고 코드 변경 없음)', await evaluate(s.cdp, "window.__wu.doc.universe.subtypes.some((x) => x.name === '회의록') && window.__wu.doc.nodes.some((n) => n.label === '10월 회의록' && n.subtype === '회의록')"));
    check('추가한 하위 유형이 상세에 보임', (await text(s.cdp, '#detail')).includes('산출물 > 회의록'));
    await evaluate(s.cdp, `(() => {
      const slot = document.getElementById('add-slot');
      const t = slot.querySelector('[data-testid=node-type]'); t.value = 'artifact'; t.dispatchEvent(new Event('change'));
      const st = slot.querySelector('[data-testid=node-subtype]'); st.value = '__new__'; st.dispatchEvent(new Event('change'));
      slot.querySelector('[data-testid=node-label]').value = '11월 회의록';
      slot.querySelector('button[type=submit]').click();
    })()`);
    await sleep(200);
    check('오류: 새 하위 유형 이름을 비우면 거부', (await evaluate(s.cdp, "((document.querySelector('#add-slot [data-testid=form-message]') || {}).dataset || {}).code")) === 'E-REQUIRED' && !(await evaluate(s.cdp, "window.__wu.doc.nodes.some((n) => n.label === '11월 회의록')")));
    await shot(s.cdp, `${browser.name}-8-new-universe`);
    // 오류(R-05 ②): 인수인계·메모 기록이 없는 새 유니버스의 반복 비효율 → 결론 없이 "데이터 부족"과 마지막 입력 시점
    await evaluate(s.cdp, "window.__wu.select(null)");
    await clickTestId(s.cdp, 'btn-insight-universe');
    await sleep(200);
    const insuf = await text(s.cdp, '[data-testid=repeat-insufficient]');
    check('오류(R-05 ②): 기록이 없는 새 유니버스 → 반복 비효율 "데이터 부족"과 "입력된 업무 이력 없음"(생성 이력은 입력이 아님)', insuf.includes('데이터 부족') && insuf.includes('입력된 업무 이력 없음') && !(await evaluate(s.cdp, "!!document.querySelector('[data-testid=repeat-patterns]')")), insuf);
    await clickTestId(s.cdp, 'tab-density');
    await sleep(150);
    const dinsuf = await text(s.cdp, '[data-testid=density-insufficient]');
    check('오류(R-05 ②): 담당 연결이 없는 새 유니버스 → 밀집·공백도 "데이터 부족"만(표·목록 없음)', dinsuf.includes('데이터 부족') && !(await evaluate(s.cdp, "!!document.querySelector('[data-testid=density-groups]')")), dinsuf);
  }
  const countBefore = await evaluate(s.cdp, "document.getElementById('universe-picker').options.length");
  // 페이지를 다시 열면 confirm이 원래대로 돌아가 자동화가 멈추므로 다시 자동 수락으로 바꾼다
  await evaluate(s.cdp, 'window.confirm = () => true');
  await submitCreate('연말 교육 운영', '업무', '가상 교육팀');
  await sleep(500);
  await waitFor(s.cdp, "window.__wu && window.__wu.doc.universe.name === '연말 교육 운영' && window.__wu.cy.nodes().length === 1", 8000);
  check('같은 이름·단위 유니버스는 확인 후 만들어짐(유니버스 수 +1)', (await evaluate(s.cdp, "document.getElementById('universe-picker').options.length")) === countBefore + 1);
  await evaluate(s.cdp, "location.hash = 'U-A1'; location.reload()").catch(() => {});
  await sleep(500);
  await waitFor(s.cdp, "window.__wu && window.__wu.doc.universe.id === 'U-A1'", 8000);

  // ── T-17 가져오기: 문서 초벌 변환(CR-5 ②) → 미리 보기 → 가져오기, JSON 파일, 내보내기(D-06) ──
  await evaluate(s.cdp, "window.confirm = () => true; document.getElementById('import-open').click()");
  await sleep(200);
  check('T-17 머리글 「가져오기·내보내기」 → 창이 열림', await evaluate(s.cdp, "document.getElementById('import-dialog').open && !!document.querySelector('[data-testid=import-convert]')"));
  await clickTestId(s.cdp, 'import-convert');
  await sleep(150);
  check('오류: 빈 문서로 초벌 변환 → 변환하지 않고 사유 표시', (await text(s.cdp, '[data-testid=import-message]')).includes('붙여 넣거나') && !(await evaluate(s.cdp, "!!document.querySelector('[data-testid=import-confirm]')")));
  await clickTestId(s.cdp, 'import-example');
  await sleep(100);
  await clickTestId(s.cdp, 'import-convert');
  await sleep(300);
  const pv = await text(s.cdp, '[data-testid=import-preview]');
  check('T-17 예시 문서 초벌 변환 → 미리 보기(노드 18개, 세분화 맞음, 원문 근거 18/18, 표시 보존)', (await text(s.cdp, '[data-testid=import-summary]')).includes('노드 18개') && (await text(s.cdp, '[data-testid=import-granularity]')).includes('맞음') && (await text(s.cdp, '[data-testid=import-source]')).includes('18/18') && (await text(s.cdp, '[data-testid=import-marks]')).includes('[미확인] 노드 2개'), pv.slice(0, 120));
  check('T-17 원문의 절 → 유니버스 표(업무 흐름은 절차 속성, 질문·리스크는 메모)', (await evaluate(s.cdp, "document.querySelectorAll('[data-testid=import-sections] tbody tr').length")) === 9 && pv.includes('절차 속성 5단계') && pv.includes('메모 5건'));
  check('U-6: 작성 주체만 비었으면 빨간 오류가 아니라 안내(notice)로 보이고 「가져오기」는 막힘', await evaluate(s.cdp, "(() => { const e = document.querySelector('[data-testid=import-errors]'); return !!e && !e.classList.contains('error-text') && e.classList.contains('notice') && !e.textContent.includes('가져올 수 없습니다'); })()") && await evaluate(s.cdp, "document.querySelector('[data-testid=import-confirm]').disabled"));
  check('U-7: 변환 단추 옆에 「생성 방식: 사전 생성」 대신 규칙으로 읽는다는 안내', (await text(s.cdp, '[data-testid=import-method-note]')).includes('규칙으로 읽습니다') && !(await text(s.cdp, '#import-dialog')).includes('생성 방식: 사전 생성'));
  check('CR-3 AC ③: 작성 주체가 비면 「가져오기」가 막히고 고칠 것 표시', (await evaluate(s.cdp, "document.querySelector('[data-testid=import-confirm]').disabled")) && (await text(s.cdp, '[data-testid=import-errors]')).includes('작성 주체'));
  check('미리 보기의 핵심 요소가 실제로 그려짐(크기 있음)', await evaluate(s.cdp, "['[data-testid=import-summary]', '[data-testid=import-sections]', '[data-testid=import-nodes]', '[data-testid=import-confirm]'].every((q) => { const r = document.querySelector(q).getBoundingClientRect(); return r.width > 0 && r.height > 0; })"));
  check('R-16 ① 가져오기 미리 보기에 표준 양식 요약(업무 n개 중 m개에 권장 항목 비어 있음)이 보이고 가져오기를 막지 않음', (await text(s.cdp, '[data-testid=import-form] summary')).includes('표준 양식: 업무') && (await text(s.cdp, '[data-testid=import-form] summary')).includes('권장 항목'));
  await shot(s.cdp, browser.name + '-17a-import-preview');
  await evaluate(s.cdp, "(() => { const i = document.getElementById('import-owner'); i.focus(); i.value = '가상 시스템분석팀'; i.dispatchEvent(new Event('input', { bubbles: true })); })()");
  await sleep(150);
  check('작성 주체를 넣으면 「가져오기」가 켜지고 입력 칸이 그대로(포커스 유지)', !(await evaluate(s.cdp, "document.querySelector('[data-testid=import-confirm]').disabled")) && (await evaluate(s.cdp, "!!document.activeElement && document.activeElement.id === 'import-owner'")));
  await shot(s.cdp, browser.name + '-17a2-import-ready');
  await evaluate(s.cdp, "(() => { const d = document.getElementById('import-dialog'); d.scrollTop = document.querySelector('[data-testid=import-sections]').offsetTop - 40; })()");
  await shot(s.cdp, browser.name + '-17a3-import-sections');
  await evaluate(s.cdp, "(() => { const d = document.getElementById('import-dialog'); d.scrollTop = d.scrollHeight; })()");
  await shot(s.cdp, browser.name + '-17a4-import-nodes');
  check('머리글이 한 줄(1280px 창에서 버튼이 아래로 넘어가지 않음)', (await evaluate(s.cdp, "document.querySelector('body > header').getBoundingClientRect().height")) < 70);
  check('머리글 버튼 글자가 한 줄(꺾이지 않음)', await evaluate(s.cdp, "[...document.querySelectorAll('header button:not(#home)')].filter((b) => b.offsetParent).every((b) => b.getBoundingClientRect().height < 44)"));
  await clickTestId(s.cdp, 'import-confirm');
  await sleep(600);
  const imported = await waitFor(s.cdp, "window.__wu && window.__wu.doc && (window.__wu.doc.universe.tags || []).includes('문서 변환') && window.__wu.cy.nodes().length === 18", 8000);
  check('T-17 「가져오기」 → 가져온 유니버스가 열리고 그래프로 탐색됨(노드 18)', imported);
  let exported = null;
  if (imported) {
    const mainId = await evaluate(s.cdp, "window.__wu.doc.universe.id + '/' + window.__wu.doc.nodes.find((n) => n.label === '승인').id");
    await clickNode(s.cdp, mainId);
    const d17 = await text(s.cdp, '#detail');
    check('가져온 업무 노드에 원문 근거와 절차(①~⑤)가 보임', d17.includes('§1 범위, §2') && d17.includes('①') && d17.includes('⑤'), d17.slice(0, 100));
    await shot(s.cdp, browser.name + '-17b-imported');
    // 내보내기: a[download] 클릭을 가로채 파일 이름과 내용을 확인한다
    await evaluate(s.cdp, "(() => { window.__dl = null; const orig = URL.createObjectURL; URL.createObjectURL = (b) => { window.__blob = b; return orig.call(URL, b); }; HTMLAnchorElement.prototype.click = function () { window.__dl = this.getAttribute('download'); }; document.getElementById('import-open').click(); document.querySelector('[data-testid=import-tab-export]').click(); document.querySelector('[data-testid=export-download]').click(); document.getElementById('import-dialog').close(); })()");
    await sleep(200);
    const dl = await evaluate(s.cdp, 'window.__dl');
    const curId = await evaluate(s.cdp, 'window.__wu.doc.universe.id');
    exported = await evaluate(s.cdp, 'window.__blob ? window.__blob.text() : null');
    const parsedExport = exported ? JSON.parse(exported) : null;
    check('D-06 「가져오기·내보내기」의 내보내기 탭 → 이름-ID.json 파일, 내용은 지금 유니버스', typeof dl === 'string' && dl.endsWith('.json') && dl.includes(curId) && !!parsedExport && parsedExport.universe.id === curId && parsedExport.nodes.length === 18, String(dl));
  }
  // JSON 파일 쪽 오류와 덮어쓰기
  const pasteJson = async (value) => {
    await evaluate(s.cdp, "window.confirm = () => true; document.getElementById('import-open').click()");
    await sleep(150);
    await clickTestId(s.cdp, 'import-tab-json');
    await evaluate(s.cdp, '(() => { document.getElementById("import-json").value = ' + JSON.stringify(value) + '; document.querySelector("[data-testid=import-check]").click(); })()');
    await sleep(250);
  };
  await pasteJson('{"schema_version": "1.0", "universe": ');
  check('오류: 형식이 깨진 JSON → 가져오지 않고 원인 표시', (await text(s.cdp, '[data-testid=import-message]')).includes('JSON 형식이 아닙니다') && !(await evaluate(s.cdp, "!!document.querySelector('[data-testid=import-confirm]')")));
  await evaluate(s.cdp, "document.getElementById('import-dialog').close()");
  if (exported) {
    const v2 = JSON.parse(exported);
    v2.schema_version = '2.0';
    await pasteJson(JSON.stringify(v2));
    check('오류: 스키마 버전이 다른 파일 → 가져오지 않고 버전 차이 표시', (await text(s.cdp, '[data-testid=import-errors]')).includes('형식 버전이 다릅니다') && (await evaluate(s.cdp, "document.querySelector('[data-testid=import-confirm]').disabled")));
    await evaluate(s.cdp, "document.getElementById('import-dialog').close()");
    const same = JSON.parse(exported);
    same.universe.description = '덮어쓴 판';
    await pasteJson(JSON.stringify(same));
    check('같은 ID 유니버스가 있으면 미리 보기에 덮어쓰기 안내', (await text(s.cdp, '[data-testid=import-conflict]')).includes('이미 있습니다'));
    await evaluate(s.cdp, "window.confirm = () => true; document.querySelector('[data-testid=import-confirm]').click()").catch(() => {});
    await sleep(600);
    check('덮어쓰기 확인 → 같은 유니버스가 새 내용으로 열림', await waitFor(s.cdp, "window.__wu && window.__wu.doc && window.__wu.doc.universe.description === '덮어쓴 판'", 8000));
  } else {
    check('내보낸 파일로 JSON 가져오기 점검', false, '내보내기 결과 없음');
  }
  check('가져오기 화면에 "null" 글자 없음', await evaluate(s.cdp, "(() => { const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); while (w.nextNode()) if (w.currentNode.textContent.trim() === 'null') return false; return true; })()"));
  if (await goBare(s.cdp)) {
    await evaluate(s.cdp, "document.querySelector('[data-testid=start-import]').click()");
    await sleep(200);
    check('시작 화면의 「문서·파일 가져오기」로도 가져오기 창이 열림(내보내기 탭은 없음), 가져온 유니버스는 「내 유니버스」에', (await evaluate(s.cdp, "document.getElementById('import-dialog').open && !document.querySelector('[data-testid=import-tab-export]')")) && (await text(s.cdp, '[data-testid=start-mine]')).includes('대형가맹점 A 카드승인'));
    await evaluate(s.cdp, "document.getElementById('import-dialog').close()");
  } else {
    check('시작 화면의 「문서·파일 가져오기」', false, '시작 화면이 열리지 않음');
  }
  await evaluate(s.cdp, "location.hash = 'U-A1'; location.reload()").catch(() => {});
  await sleep(500);
  await waitFor(s.cdp, "window.__wu && window.__wu.doc && window.__wu.doc.universe.id === 'U-A1'", 8000);

  // ── D-4-10: ?check 없이 열면(제출본을 그냥 더블클릭) 점검용 전역이 없고 화면은 그대로 동작 ──
  await s.cdp.send('Page.navigate', { url: pageUrl.replace(/\?check$/, '') });
  await sleep(1200);
  check('D-4-10 ?check 없이 열면 window.__wu가 없고 시작 화면 카드가 보임', await evaluate(s.cdp, "typeof window.__wu === 'undefined' && document.querySelectorAll('[data-testid=start-samples] .card').length > 0"));
  await evaluate(s.cdp, "document.querySelector('[data-testid=start-primary]').click()");
  await sleep(1500);
  check('D-4-10 ?check 없이도 샘플을 열면 그래프가 그려짐(캔버스 크기 있음)', await evaluate(s.cdp, "(() => { const c = document.querySelector('#graph canvas'); return typeof window.__wu === 'undefined' && !!c && c.width > 0 && location.hash === '#U-A1'; })()"));
  await s.cdp.send('Page.navigate', { url: `${pageUrl}#U-A1` });
  await sleep(500);
  await waitFor(s.cdp, "window.__wu && window.__wu.doc && window.__wu.doc.universe.id === 'U-A1'", 8000);

  // ── T-11 반복 비효율(R-05 ⑤) ──
  await evaluate(s.cdp, "location.hash = 'U-A1'; location.reload()").catch(() => {});
  await sleep(500);
  if (await waitFor(s.cdp, "window.__wu && window.__wu.doc.universe.id === 'U-A1' && window.__wu.cy.nodes().length > 0", 8000)) {
    await evaluate(s.cdp, "window.__wu.select(null)");
    await clickTestId(s.cdp, 'btn-insight-universe');
    await sleep(200);
    const rep = await text(s.cdp, '[data-testid=repeat-patterns]');
    check('R-05 ⑤ 반복 비효율: 이전 인수인계서를 이어받지 않은 인수인계가 근거 이벤트와 함께 나옴', rep.includes('인수인계 2회 중 1회가 이전 인수인계서를 이어받지 않아') && rep.includes('2026-09-30 윤바다 → 서하늘 (인수인계서 없음) — 이전 인수인계서를 이어받지 않음') && (await evaluate(s.cdp, "document.querySelectorAll('[data-testid=repeat-patterns] .evidence').length")) >= 2, rep.slice(0, 120));
    check('R-05 ③ 결정은 사람이 한다는 안내', (await text(s.cdp, '[data-testid=insight-note]')).includes('사람이 정합니다'));
    await shot(s.cdp, `${browser.name}-7-repeat`);
    // 탭을 바꾸면 유사 경험자가 열린다
    await clickTestId(s.cdp, 'tab-similar');
    await sleep(150);
    check('탭 전환: 유사 경험자', !!(await evaluate(s.cdp, "!!document.querySelector('[data-testid=insight-work]')")));
    await clickTestId(s.cdp, 'tab-repeat');
    // ── T-11 밀집·공백(R-05) ──
    await clickTestId(s.cdp, 'tab-density');
    await sleep(150);
    const groups = await text(s.cdp, '[data-testid=density-groups]');
    const gapsTxt = await text(s.cdp, '[data-testid=density-gaps]');
    // 앞의 편집 점검에서 서하늘 → 보고 수행 연결을 더했으므로 보고는 공백이 아니다
    check('R-05 밀집·공백: 조직별 집계 표와 공백 업무(자료 수집, 이전 담당자만 있음 — 마지막 담당 윤바다)가 근거와 함께 나오고, 앞에서 담당자를 연결한 보고는 빠짐', groups.includes('월말 정산') && gapsTxt.includes('자료 수집') && !gapsTxt.includes('보고') && gapsTxt.includes('이전 담당자만 있음(윤바다, 2026-09-30까지)') && (await evaluate(s.cdp, "document.querySelectorAll('[data-testid=density-gaps] .evidence').length")) >= 1, gapsTxt.slice(0, 120));
    check('밀집·공백 표가 실제로 그려짐(크기 있음)', (await evaluate(s.cdp, "(() => { const r = document.querySelector('[data-testid=density-groups]').getBoundingClientRect(); return r.width > 50 && r.height > 20; })()")));
    check('N=3이면 밀집 없음', !(await evaluate(s.cdp, "!!document.querySelector('[data-testid=density-dense]')")));
    await evaluate(s.cdp, "(() => { const i = document.querySelector('[data-testid=dense-n]'); i.value = '1'; i.dispatchEvent(new Event('input')); })()");
    await sleep(150);
    const today = await evaluate(s.cdp, "(() => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; })()");
    const expectDense = today >= '2026-10-01' ? '서하늘' : '윤바다';
    check(`N을 1로 바꾸면 밀집에 현재 담당자(${expectDense})가 나옴`, (await text(s.cdp, '[data-testid=density-dense]')).includes(expectDense));
    check('밀집 사람에도 근거 버튼(사람 + 업무)이 붙음', (await evaluate(s.cdp, "document.querySelectorAll('[data-testid=density-dense] .evidence').length")) >= 2);
    await shot(s.cdp, `${browser.name}-7b-density`);
    // 업무 상세: 현재 담당·공백 한 줄, 수행 연결의 현재·종료 표시, 반복 비효율 포함 한 줄
    await evaluate(s.cdp, "window.__wu.select('U-A1/N-002')");
    await sleep(150);
    check('업무 상세(자료 수집): 이전 담당자 윤바다가 떠난 공백(2026-09-30까지)', (await text(s.cdp, '[data-testid=work-load]')).includes('윤바다') && (await text(s.cdp, '[data-testid=work-load]')).includes('2026-09-30'), await text(s.cdp, '[data-testid=work-load]'));
    await evaluate(s.cdp, "window.__wu.select('U-A1/N-001')");
    await sleep(150);
    check('업무 상세(대사 확인): "현재 담당: 서하늘"', (await text(s.cdp, '[data-testid=work-load]')).includes('현재 담당: 서하늘'));
    const statuses = await evaluate(s.cdp, "[...document.querySelectorAll('[data-testid=link-status]')].map((x) => x.textContent).sort().join()");
    check('수행 연결에 현재·종료 표시(현재 1, 종료 2)', statuses === '종료,종료,현재', statuses);
    check('업무 상세(대사 확인): 반복 비효율 패턴 포함 한 줄', (await text(s.cdp, '[data-testid=repeat-note]')).includes('인수인계 반복'));
    await shot(s.cdp, `${browser.name}-7c-work-detail`);
    await clickTestId(s.cdp, 'btn-repeat-note');
    await sleep(150);
    check('「반복 비효율 보기」 → 반복 비효율 탭이 열림', !!(await evaluate(s.cdp, "!!document.querySelector('[data-testid=repeat-patterns]')")));
    // 초안: 대상 업무의 현재 담당자가 한 명이면 보내는 사람으로 미리 골라짐
    await evaluate(s.cdp, "window.__wu.select('U-A1/N-001')");
    await sleep(150);
    await clickTestId(s.cdp, 'btn-draft');
    await sleep(150);
    check('초안: 현재 담당 표시와 보내는 사람 미리 고름(서하늘)', (await text(s.cdp, '[data-testid=draft-holder]')).includes('서하늘') && (await evaluate(s.cdp, "document.querySelector('[data-testid=draft-from]').value")) === 'U-A1/N-012');

    // ── T-11 시간 슬라이더·흐름 변화(R-05, R-14) ──
    await evaluate(s.cdp, "window.__wu.select(null)");
    await sleep(150);
    check('시간 슬라이더가 그래프 아래에 있고 처음엔 오늘 기준', (await text(s.cdp, '[data-testid=time-when]')).startsWith('오늘(') && (await evaluate(s.cdp, "(() => { const r = document.querySelector('[data-testid=time-range]').getBoundingClientRect(); return r.width > 100 && r.height > 5; })()")));
    const setMonth = (m) => evaluate(s.cdp, `(() => { const r = document.querySelector('[data-testid=time-range]'); const months = []; const [y0, m0] = [2025, 3]; for (let i = 0; i <= Number(r.max); i += 1) { const t = (m0 - 1) + i; months.push(String(y0 + Math.floor(t / 12)) + '-' + String((t % 12) + 1).padStart(2, '0')); } r.value = String(months.indexOf(${JSON.stringify(m)})); r.dispatchEvent(new Event('input')); return r.value; })()`);
    // 검토3 UI-1: 실제 키보드로 움직이기(화살표 3번 → 3달 전, 포커스 유지). 값을 직접 넣는 점검은 이 결함을 못 잡았다
    await evaluate(s.cdp, "document.querySelector('[data-testid=time-range]').focus()");
    for (let i = 0; i < 3; i += 1) {
      await s.cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 });
      await s.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 });
      await sleep(120);
    }
    const kb = await evaluate(s.cdp, "({ when: document.querySelector('[data-testid=time-when]').textContent, focused: document.activeElement && document.activeElement.dataset.testid })");
    const threeBack = await evaluate(s.cdp, "(() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 3); const y = d.getFullYear(), m = d.getMonth() + 1; const last = new Date(y, m, 0).getDate(); return `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')} 기준`; })()");
    check('검토3 UI-1: 화살표 키 3번 → 3달 전 기준, 슬라이더 포커스 유지', kb.when === threeBack && kb.focused === 'time-range', `${kb.when} / ${kb.focused} / 기대 ${threeBack}`);
    // 검토3 UI-3·UI-2: 초안을 만든 뒤 슬라이더를 움직여도 초안이 남고, 초안은 오늘 기준이라는 안내
    await evaluate(s.cdp, "window.__wu.select(null)");
    await clickTestId(s.cdp, 'btn-draft-universe');
    await sleep(150);
    await evaluate(s.cdp, `(() => { const set = (id, v) => { const e = document.querySelector('[data-testid=' + id + ']'); e.value = v; e.dispatchEvent(new Event('change')); }; set('draft-target', 'U-A1/N-000'); set('draft-from', 'U-A1/N-011'); set('draft-to', 'U-A1/N-012'); document.querySelector('[data-testid=draft-form] button[type=submit]').click(); })()`);
    await sleep(250);
    check('검토3 UI-2: 지난 날짜를 보는 중 초안 패널에 "초안은 오늘 기준" 안내', (await text(s.cdp, '[data-testid=draft-today]')).includes('오늘'));
    await setMonth('2025-09');
    await sleep(200);
    check('검토3 UI-3: 슬라이더를 움직여도 만든 초안(10개 항목)과 받는 사람 선택이 남는다', (await evaluate(s.cdp, "document.querySelectorAll('[data-testid^=draft-item-]').length")) === 10 && (await evaluate(s.cdp, "document.querySelector('[data-testid=draft-to]').value")) === 'U-A1/N-012');
    await evaluate(s.cdp, "window.__wu.select(null)");
    await setMonth('2025-06');
    await sleep(200);
    check('슬라이더를 2025-06으로 → "2025-06-30 기준"', (await text(s.cdp, '[data-testid=time-when]')) === '2025-06-30 기준');
    const offOf = (src) => evaluate(s.cdp, `window.__wu.cy.edges().filter((e) => e.source().id() === '${src}' && e.target().id() === 'U-A1/N-001').every((e) => e.hasClass('time-off'))`);
    check('2025-06: 윤바다·서하늘의 대사 확인 담당 연결은 흐림, 한가람은 또렷', (await offOf('U-A1/N-011')) && (await offOf('U-A1/N-012')) && !(await offOf('U-A1/N-010')));
    check('2025-06: 그때 맡은 일이 없는 윤바다 노드는 흐림, 한가람은 또렷', await evaluate(s.cdp, "window.__wu.cy.getElementById('U-A1/N-011').hasClass('time-off') && !window.__wu.cy.getElementById('U-A1/N-010').hasClass('time-off')"));
    await evaluate(s.cdp, "window.__wu.select('U-A1/N-001')");
    await sleep(150);
    check('2025-06 기준 업무 상세: "2025-06-30 기준 담당: 한가람"(검토3 UI-5: 지난 날짜엔 기준일을 밝힘)', (await text(s.cdp, '[data-testid=work-load]')).includes('2025-06-30 기준 담당: 한가람'));
    check('기준일 이후 이력은 흐리게(after) 표시', (await evaluate(s.cdp, "document.querySelectorAll('[data-testid=history] li.after').length")) > 0);
    await shot(s.cdp, `${browser.name}-7d-time-2025-06`);
    await setMonth('2026-02');
    await sleep(200);
    await evaluate(s.cdp, "window.__wu.select('U-A1/N-010')");
    await sleep(150);
    check('R-14: 2026-02 기준 한가람 소속(기준일)은 "미기재 — 2026-01-01 소속 변경…"', (await text(s.cdp, '[data-testid=attrs]')).includes('미기재 — 2026-01-01 소속 변경'));
    // 흐름 변화 탭
    await evaluate(s.cdp, "window.__wu.select(null)");
    await clickTestId(s.cdp, 'btn-insight-universe');
    await sleep(200);
    check('과거 기준일로 볼 때 인사이트에 기준일 안내', (await text(s.cdp, '[data-testid=insight-asof]')).includes('2026-02-28 기준'));
    await clickTestId(s.cdp, 'tab-flow');
    await sleep(200);
    const flow = await text(s.cdp, '[data-testid=flow-table]');
    check('R-05 흐름 변화: 월별 표(2025-03 ~ 이번 달)와 2026-01·2026-06 행', flow.includes('2025-03') && flow.includes('2026-01') && flow.includes('2026-06'), flow.slice(0, 80));
    check('검토3 UI-4: 흐름 변화 표가 패널 안에 들어온다(오른쪽이 잘리지 않음)', await evaluate(s.cdp, "(() => { const t = document.querySelector('[data-testid=flow-table]').getBoundingClientRect(); const a = document.getElementById('detail').getBoundingClientRect(); return t.right <= a.right + 1; })()"));
    check('흐름 변화 표가 실제로 그려짐(크기 있음)', await evaluate(s.cdp, "(() => { const r = document.querySelector('[data-testid=flow-table]').getBoundingClientRect(); return r.width > 100 && r.height > 100; })()"));
    check('흐름 변화 표의 마지막 열(인원)이 패널 안에 다 보임(재검증: 열 잘림)', await evaluate(s.cdp, "(() => { const t = document.querySelector('[data-testid=flow-table]'); const a = document.querySelector('aside'); if (!t || !a) return false; const last = t.querySelector('thead th:last-child').getBoundingClientRect(); return last.width > 0 && last.right <= a.getBoundingClientRect().right + 1; })()"));
    await shot(s.cdp, `${browser.name}-7e-flow`);
    await clickTestId(s.cdp, 'flow-goto-2026-06');
    await sleep(250);
    check('흐름 변화 「보기」 → 슬라이더가 그 달(2026-06-30 기준)로', (await text(s.cdp, '[data-testid=time-when]')) === '2026-06-30 기준');
    await evaluate(s.cdp, "(() => { const u = document.querySelector('[data-testid=flow-unit]'); if (u) { u.value = 'quarter'; u.dispatchEvent(new Event('change')); } })()");
    await sleep(150);
    check('분기 단위로 바꾸면 2026-Q1 행', (await text(s.cdp, '[data-testid=flow-table]')).includes('2026-Q1'));
    await clickTestId(s.cdp, 'time-today');
    await sleep(200);
    check('「오늘로」 → 오늘 기준, 흐림 해제', (await text(s.cdp, '[data-testid=time-when]')).startsWith('오늘(') && (await evaluate(s.cdp, "window.__wu.cy.elements('.time-off').length")) === 0);
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
    check('U-18: 유사 경험자의 역할 노드(운영 담당·정산 담당)에 「역할 · 담당자 미연결」 표시, 실제 사람(윤바다)에는 없음', (await evaluate(s.cdp, "document.querySelectorAll('[data-testid=insight-people] [data-testid=role-chip]').length")) >= 2 && (await evaluate(s.cdp, "[...document.querySelectorAll('[data-testid=insight-people] li')].filter((li) => li.querySelector('strong').textContent === '윤바다').every((li) => !li.querySelector('[data-testid=role-chip]'))")));
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
    // D3-31: 보내는 사람(윤바다)은 「문의」로 이미 나오므로 유사 경험자에서 뺀다 → 카드승인의 운영 담당·정산 담당만
    check('인수인계 초안의 "유사 경험자" 항목에 카드승인 담당자와 근거 링크가 들어가고 보내는 사람(윤바다)은 빠짐', sim.includes('운영 담당(V-4002)') && !sim.includes('윤바다(V-1002)') && !sim.includes('이력 부족') && (await evaluate(s.cdp, "document.querySelectorAll('[data-testid=draft-item-유사_경험자] .evidence').length")) >= 3);
    // 밀집·공백(부서 화면): 조직별 표, 끝난 업무는 "이전 담당자만 있음", 도하람 3개 밀집
    await evaluate(s.cdp, "window.__wu.select(null)");
    await clickTestId(s.cdp, 'btn-insight-universe');
    await sleep(200);
    await clickTestId(s.cdp, 'tab-density');
    await sleep(150);
    const dg = await text(s.cdp, '[data-testid=density-groups]');
    check('부서 화면 밀집·공백: 조직(유니버스)별로 집계', ['월말 정산', '카드승인', '행사'].every((k) => dg.includes(k)), dg.slice(0, 120));
    check('끝난 업무(2025 행사)는 "이전 담당자만 있음"과 마지막 담당자로 표시', (await text(s.cdp, '[data-testid=density-gaps]')).includes('이전 담당자만 있음(윤바다, 2025-12-15까지)'));
    check('밀집(3개 이상): 도하람', (await text(s.cdp, '[data-testid=density-dense]')).includes('도하람'));
    await shot(s.cdp, `${browser.name}-9b-density-dept`);
    // 개요의 인사이트 안내, 사람 상세의 "지금 맡은 업무 N개 — 밀집 기준에 해당"
    await evaluate(s.cdp, "window.__wu.select(null)");
    await sleep(150);
    check('개요에 인사이트 종류 안내(밀집·공백 포함)', (await text(s.cdp, '[data-testid=insight-hint]')).includes('밀집·공백'));
    await evaluate(s.cdp, "window.__wu.select(window.__wu.view.canonical('U-B/N-201'))");
    await sleep(200);
    const load = await text(s.cdp, '[data-testid=person-load]');
    check('사람 상세: 도하람 "지금 맡은 업무 3개 — 밀집 기준(3개 이상)에 해당"', load.includes('지금 맡은 업무 3개') && load.includes('밀집 기준(3개 이상)에 해당'), load);
    check('사람 상세의 한 줄이 실제로 그려짐(크기 있음)', (await evaluate(s.cdp, "(() => { const r = document.querySelector('[data-testid=person-load]').getBoundingClientRect(); return r.width > 50 && r.height > 10; })()")));
    await shot(s.cdp, `${browser.name}-9c-person-load`);
    await clickTestId(s.cdp, 'btn-person-density');
    await sleep(200);
    check('「밀집·공백 보기」 → 인사이트 밀집·공백 탭이 열림', (await text(s.cdp, '[data-testid=density-dense]')).includes('도하람'));
    // N을 4로 바꾸면 사람 상세도 같은 기준으로 바뀐다
    await evaluate(s.cdp, "(() => { const i = document.querySelector('[data-testid=dense-n]'); i.value = '4'; i.dispatchEvent(new Event('input')); })()");
    await sleep(150);
    await evaluate(s.cdp, "window.__wu.select(window.__wu.view.canonical('U-B/N-201'))");
    await sleep(200);
    check('N을 4로 바꾸면 사람 상세도 "밀집 기준(4개 이상) 아래"', (await text(s.cdp, '[data-testid=person-load]')).includes('밀집 기준(4개 이상) 아래'));
    // 접힌 하위 유니버스(카드승인) 안의 공백 업무 근거를 누르면 펼쳐서 보여 준다
    const hiddenGid = await evaluate(s.cdp, "window.__wu.view.nodes.find((n) => n.label === '요청 검증').gid");
    check('요청 검증(하위 단계 업무)은 접힌 유니버스 안이라 그래프에 없음', await evaluate(s.cdp, `window.__wu.cy.getElementById(${JSON.stringify(hiddenGid)}).empty()`));
    await evaluate(s.cdp, "window.__wu.select(null)");
    await clickTestId(s.cdp, 'btn-insight-universe');
    await sleep(200);
    await clickTestId(s.cdp, 'tab-density');
    await sleep(150);
    await evaluate(s.cdp, "[...document.querySelectorAll('[data-testid=density-gaps] .evidence')].find((b) => b.textContent === '요청 검증').click()");
    await sleep(500);
    check('근거 버튼 → 접힌 유니버스를 펼쳐 그 노드를 보여 줌', !(await evaluate(s.cdp, `window.__wu.cy.getElementById(${JSON.stringify(hiddenGid)}).empty()`)));
    await shot(s.cdp, `${browser.name}-9d-reveal`);
    // T-13: 부서 화면 개요에 교육팀의 사번 충돌(V-1002 윤바다/윤바다라)
    await evaluate(s.cdp, "window.__wu.select(null)");
    await sleep(150);
    const conflict = await text(s.cdp, '[data-testid=empno-conflict]');
    check('T-13 예외: 부서 개요에 사번 충돌 V-1002(윤바다·윤바다라) 알림', conflict.includes('V-1002') && conflict.includes('윤바다라'), conflict);

    // ── T-10 통합 확인(R-11 ②③④⑤) ──
    const hint = await text(s.cdp, '[data-testid=merge-hint]');
    check('T-10: 부서 개요에 통합 확인 대기 건수와 「통합 확인 목록」', hint.includes('통합 확인 대기') && hint.includes('통합 확인 목록'), hint);
    await clickTestId(s.cdp, 'btn-merge');
    await sleep(200);
    const persons = await text(s.cdp, '[data-testid=merge-persons]');
    const worksTxt = await text(s.cdp, '[data-testid=merge-works]');
    check('R-11 ③: 사번 충돌(윤바다/윤바다라)과 사번 없음(임가온)이 확인 목록에', persons.includes('사번 충돌') && persons.includes('윤바다라') && persons.includes('임가온'), persons.slice(0, 80));
    check('R-11 ②: 업무 후보(장소 섭외 ↔ 강의실·강사 섭외)와 이유(사전 생성), 자동으로 합치지 않음', worksTxt.includes('장소 섭외') && worksTxt.includes('강의실·강사 섭외') && worksTxt.includes('사전 생성') && worksTxt.includes('일정에 맞춰 장소를 알아보고'), worksTxt.slice(0, 80));
    check('U-12: 사번 없음 카드에 고치는 방법(유니버스를 열어 「수정」에서 사번)이 적혀 있음', persons.includes('고치는 방법') && persons.includes('「수정」에서 사번을 넣으세요'));
    await shot(s.cdp, `${browser.name}-9e-merge`);
    const before = await evaluate(s.cdp, "window.__wu.view.canonical('U-C/N-102') === window.__wu.view.canonical('U-B/N-103')");
    // 장소 섭외 후보의 「같은 업무」
    await evaluate(s.cdp, "[...document.querySelectorAll('[data-testid=merge-works] li')].find((li) => li.textContent.includes('강의실·강사 섭외') && li.textContent.includes('장소 섭외')).querySelector('[data-testid=merge-same]').click()");
    await sleep(400);
    const after = await evaluate(s.cdp, "window.__wu.view.canonical('U-C/N-102') === window.__wu.view.canonical('U-B/N-103')");
    const worksAfter = await text(s.cdp, '[data-testid=merge-works]');
    check('R-11 ②④: 「같은 업무」를 누르면 통합 화면에서 한 노드가 되고 후보에서 빠지며 판정 기록에 남음', !before && after && !(await evaluate(s.cdp, "[...document.querySelectorAll('[data-testid=merge-works] li strong')].some((x) => x.textContent.includes('장소 섭외') && x.textContent.includes('강의실·강사 섭외'))")) && (await text(s.cdp, '[data-testid=merge-decided]')).includes('같음'));
    // 사번 충돌 「다른 사람」 → 개요 알림이 사라짐
    await evaluate(s.cdp, "[...document.querySelectorAll('[data-testid=merge-persons] li')].find((li) => li.dataset.type === 'conflict').querySelector('[data-testid=merge-diff]').click()");
    await sleep(400);
    await evaluate(s.cdp, "window.__wu.select(null)");
    await sleep(150);
    check('R-11 ③: 사번 충돌을 「다른 사람」으로 판정하면 개요의 충돌 알림이 사라짐(다시 묻지 않음)', !(await evaluate(s.cdp, "!!document.querySelector('[data-testid=empno-conflict]')")));
    const original = await evaluate(s.cdp, "(() => { const d = JSON.parse(localStorage.getItem('wu:v1:u:U-C')); return d.identity_links.length + ':' + d.nodes.find((n) => n.id === 'N-102').label; })()");
    check('R-11 ⑤: 판정은 부서 유니버스에만 저장되고 교육팀 원본은 그대로', original === '0:강의실·강사 섭외', original);
  }

  // ── T-13 조직관리(U-O): 입력 중단, 조직개편 소속, 데이터 부족 ──
  await evaluate(s.cdp, "location.hash = 'U-O'; location.reload()").catch(() => {});
  await sleep(500);
  if (await waitFor(s.cdp, "window.__wu && window.__wu.doc.universe.id === 'U-O' && window.__wu.cy.nodes().length > 0", 8000)) {
    await evaluate(s.cdp, "window.__wu.select(null)");
    await clickTestId(s.cdp, 'btn-insight-universe');
    await sleep(200);
    await clickTestId(s.cdp, 'tab-flow');
    await sleep(200);
    const nodata = await text(s.cdp, '[data-testid=flow-nodata]');
    check('R-05 ②: 조직관리 흐름 변화 — 마지막 입력(2026-03-10) 이후 기간은 "입력 없음"으로 알림', nodata.includes('2026-03-10') && (await text(s.cdp, '[data-testid=flow-table]')).includes('입력 없음 — 데이터 부족'), nodata);
    const explainO = await text(s.cdp, '[data-testid=insight-explain]');
    check('T-12 인사이트 설명(사전 생성): 조직관리 흐름 변화에 2차 조직개편 설명과 방식 표시', explainO.includes('2차 조직개편') && (await evaluate(s.cdp, "document.querySelector('[data-testid=insight-explain]').dataset.method")) === 'pregen', explainO.slice(0, 80));
    check('조직개편 2026-01 행에 소속 변경 12', await evaluate(s.cdp, `(() => { const tr = document.querySelector('[data-testid=flow-table] tr[data-key="2026-01"]'); return !!tr && tr.children[4].textContent === '12'; })()`));
    check('흐름 변화 표의 마지막 열(인원)이 패널 안에 다 보임(재검증: 열 잘림)', await evaluate(s.cdp, "(() => { const t = document.querySelector('[data-testid=flow-table]'); const a = document.querySelector('aside'); if (!t || !a) return false; const last = t.querySelector('thead th:last-child').getBoundingClientRect(); return last.width > 0 && last.right <= a.getBoundingClientRect().right + 1; })()"));
    await shot(s.cdp, `${browser.name}-10-org-flow`);
    await clickTestId(s.cdp, 'tab-density');
    await sleep(150);
    check('R-05 ②: 조직관리 밀집·공백 — 데이터 부족과 마지막 입력', (await text(s.cdp, '[data-testid=density-insufficient]')).includes('마지막 입력 2026-03-10'));
    // 시간 보기: 2025-12에는 가상운영팀 소속, 2026-02에는 가상정산팀(소속 연결). 슬라이더는 2025-01부터
    await evaluate(s.cdp, "window.__wu.select('U-O/N-101')");
    await sleep(150);
    const setOrgMonth = (m) => evaluate(s.cdp, `(() => { const r = document.querySelector('[data-testid=time-range]'); const [ty, tm] = ${JSON.stringify(m)}.split('-').map(Number); r.value = String((ty - 2025) * 12 + (tm - 1)); r.dispatchEvent(new Event('input')); return r.value; })()`);
    await setOrgMonth('2025-12');
    await sleep(200);
    const before = await text(s.cdp, '[data-testid=attrs]');
    await setOrgMonth('2026-02');
    await sleep(200);
    const after = await text(s.cdp, '[data-testid=attrs]');
    check('R-14 시간 보기: 한가람 소속 2025-12 가상운영팀 → 2026-02 가상정산팀', before.includes('가상운영팀') && after.includes('가상정산팀'), `${before.slice(0, 60)} / ${after.slice(0, 60)}`);
    await shot(s.cdp, `${browser.name}-10b-org-time`);
    await clickTestId(s.cdp, 'time-today');
  }

  // ── T-13 교육팀(U-C): 이력 부족 ──
  await evaluate(s.cdp, "location.hash = 'U-C'; location.reload()").catch(() => {});
  await sleep(500);
  if (await waitFor(s.cdp, "window.__wu && window.__wu.doc.universe.id === 'U-C' && window.__wu.cy.nodes().length > 0", 8000)) {
    await evaluate(s.cdp, "window.__wu.select('U-C/N-105')");
    await sleep(150);
    check('교육팀 「신규 교육 과정」 상세: "공백 — 담당 기록 없음", 이력 없음', (await text(s.cdp, '[data-testid=work-load]')).includes('담당 기록 없음') && !!(await evaluate(s.cdp, "!!document.querySelector('[data-testid=no-history]')")));
    await clickTestId(s.cdp, 'btn-draft');
    await sleep(150);
    await evaluate(s.cdp, "(() => { const f = document.querySelector('[data-testid=draft-form]'); const set = (t, v) => { const e = f.querySelector('[data-testid=' + t + ']'); e.value = v; e.dispatchEvent(new Event('change')); }; set('draft-from', 'U-C/N-202'); set('draft-to', 'U-C/N-203'); f.querySelector('button[type=submit]').click(); })()");
    await sleep(250);
    const shortCount = await evaluate(s.cdp, "[...document.querySelectorAll('[data-testid^=draft-item-]')].filter((x) => x.textContent.includes('이력 부족')).length");
    check('R-03 ② 예외 5: 「신규 교육 과정」 초안은 8개 항목이 "이력 부족"', shortCount === 8, String(shortCount));
    await shot(s.cdp, `${browser.name}-11-edu-short`);
    // T-12 사전 생성 초안: 신입 교육 운영, 이든빛 → 나래솔(데이터를 고치지 않은 상태)
    await evaluate(s.cdp, "(() => { const f = document.querySelector('[data-testid=draft-form]'); const set = (t, v) => { const e = f.querySelector('[data-testid=' + t + ']'); e.value = v; e.dispatchEvent(new Event('change')); }; set('draft-target', 'U-C/N-101'); set('draft-from', 'U-C/N-202'); set('draft-to', 'U-C/N-201'); f.querySelector('button[type=submit]').click(); })()");
    await sleep(250);
    const pregenChips = await evaluate(s.cdp, "[...document.querySelectorAll('[data-testid=item-method]')].filter((x) => x.textContent === '사전 생성').length");
    check('T-12 사전 생성: 생성 방식 표시와 9개 항목(이력 부족 제외)에 「사전 생성」, 근거 버튼 유지', (await text(s.cdp, '[data-testid=draft-method]')).includes('사전 생성') && pregenChips === 9 && (await text(s.cdp, '[data-testid=draft-item-세부_업무_절차]')).includes('강의실·강사 섭외를 마쳐야 교육을 열 수 있고') && (await evaluate(s.cdp, "document.querySelectorAll('[data-testid=draft-item-세부_업무_절차] .evidence').length")) >= 4, String(pregenChips));
    await shot(s.cdp, `${browser.name}-11b-edu-pregen`);
    // 새로 입력한 데이터: 메모를 하나 더하면 최근 이슈만 규칙 기반으로 돌아간다(K-9)
    await evaluate(s.cdp, "window.__wu.select('U-C/N-101')");
    await sleep(150);
    await clickTestId(s.cdp, 'btn-event');
    await sleep(150);
    const memoOk = await evaluate(s.cdp, "(() => { const f = document.querySelector('[data-testid=event-form]'); if (!f) return 'no form'; const set = (t, v) => { const e = f.querySelector('[data-testid=' + t + ']'); if (!e) return false; e.value = v; e.dispatchEvent(new Event('change')); return true; }; set('event-type', 'memo'); set('event-date', '2026-10-02'); set('event-note', '10월 강의실 예약 시스템 점검 예정'); f.querySelector('button[type=submit]').click(); return 'ok'; })()");
    await sleep(250);
    await evaluate(s.cdp, "window.__wu.select('U-C/N-101')");
    await sleep(150);
    await clickTestId(s.cdp, 'btn-draft');
    await sleep(150);
    await evaluate(s.cdp, "(() => { const f = document.querySelector('[data-testid=draft-form]'); const set = (t, v) => { const e = f.querySelector('[data-testid=' + t + ']'); e.value = v; e.dispatchEvent(new Event('change')); }; set('draft-from', 'U-C/N-202'); set('draft-to', 'U-C/N-201'); f.querySelector('button[type=submit]').click(); })()");
    await sleep(250);
    const issueMethod = await text(s.cdp, '[data-testid=draft-item-최근_이슈] [data-testid=item-method]');
    check('K-9: 새 메모를 더하면 최근 이슈만 규칙 기반, 나머지는 사전 생성(개수 안내)', memoOk === 'ok' && issueMethod === '규칙 기반' && (await text(s.cdp, '[data-testid=draft-counts]')).includes('나머지 1개는 규칙 기반'), `${memoOk} ${issueMethod}`);
  }
  // ── T-18 큰 화면 탐색: 찾기·거르기·주변만 보기(R-17 ①~⑧). 실제 키 입력(CDP)으로 ──
  await evaluate(s.cdp, "location.hash = 'U-D1'; location.reload()").catch(() => {});
  await sleep(500);
  if (await waitFor(s.cdp, "window.__wu && window.__wu.doc.universe.id === 'U-D1' && window.__wu.cy.nodes().length > 0", 8000)) {
    // Enter는 실제 키보드처럼 글자(\r)를 함께 보내야 버튼의 기본 동작(누르기)이 일어난다
    const key = async (k, code = k, vk = 0) => {
      await s.cdp.send('Input.dispatchKeyEvent', k === 'Enter' ? { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, text: '\r', unmodifiedText: '\r' } : { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk });
      await s.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk });
      await sleep(120);
    };
    const typeFind = async (q) => {
      await evaluate(s.cdp, "(() => { const i = document.querySelector('[data-testid=find-input]'); i.value = ''; i.focus(); })()");
      await s.cdp.send('Input.insertText', { text: q });
      await sleep(200);
    };
    const eventsTotal = () => evaluate(s.cdp, "window.__wu.view.events.length");
    const ev0 = await eventsTotal();
    // 여섯 번째 검토 U-5: 패널 넓게 보기. 오른쪽 패널이 넓어지고 그래프는 줄어도 남고, 한 번 더 누르면 원래대로
    const asideW = () => evaluate(s.cdp, "({ aside: Math.round(document.querySelector('aside').getBoundingClientRect().width), graph: Math.round(document.getElementById('graph').getBoundingClientRect().width), pressed: document.getElementById('wide-toggle').getAttribute('aria-pressed'), label: document.getElementById('wide-toggle').textContent })");
    const w0 = await asideW();
    await evaluate(s.cdp, "document.getElementById('wide-toggle').click()");
    await sleep(400);
    const w1 = await asideW();
    await evaluate(s.cdp, "document.getElementById('wide-toggle').click()");
    await sleep(400);
    const w2 = await asideW();
    check('U-5: 「패널 넓게 보기」 → 오른쪽 패널이 넓어지고(그래프는 줄어도 300px 이상), 한 번 더 누르면 원래대로', w1.aside > w0.aside + 150 && w1.graph >= 300 && w1.pressed === 'true' && w1.label.includes('좁게') && w2.aside === w0.aside && w2.pressed === 'false', JSON.stringify([w0, w1, w2]));
    // 첫 화면 배율(나중에 펼쳤다 접은 뒤와 비교: 키운 이름이 배치를 넓히지 않는지)
    const firstZoom = await evaluate(s.cdp, 'window.__wu.cy.zoom()');
    await evaluate(s.cdp, "window.__wu.toggle('U-C')");
    await sleep(400);
    await evaluate(s.cdp, "window.__wu.toggle('U-C')");
    await sleep(400);
    const backZoom = await evaluate(s.cdp, 'window.__wu.cy.zoom()');
    const tinyBack = await evaluate(s.cdp, "window.__wu.cy.nodes('.tiny-label').length");
    // 배율 자체는 「다시 정렬」 결과가 그래프 영역 크기에 따라 달라 첫 화면과 같지 않다(T-18 전부터 그랬음: 첫 화면 0.612 → 다시 정렬 0.668). 판정은 이름이 숨지 않는지와 화면 밖 노드
    const offBack = await evaluate(s.cdp, "(() => { const cy = window.__wu.cy; return cy.nodes().filter((n) => { const p = n.renderedPosition(); return p.x < 0 || p.y < 0 || p.x > cy.width() || p.y > cy.height(); }).length; })()");
    check('T-18 재검증 R1: 하위 유니버스를 펼쳤다 접으면 숨은 이름 0, 화면 밖 노드 0(배율이 첫 화면과 비슷)', tinyBack === 0 && offBack === 0 && backZoom > firstZoom * 0.75, `${firstZoom.toFixed(3)} → ${backZoom.toFixed(3)}, 숨김 ${tinyBack}, 밖 ${offBack}`);
    const shownCount = () => evaluate(s.cdp, 'window.__wu.cy.nodes().length');
    // 렌더된 글자 크기(px) = 글자 크기 × 확대 배율
    const renderedPx = (gid) => evaluate(s.cdp, `(() => { const n = window.__wu.cy.getElementById(${JSON.stringify(gid)}); return n.empty() ? -1 : n.pstyle('font-size').pfValue * window.__wu.cy.zoom(); })()`);
    check('T-18: 그래프 위에 찾기 칸·거르기·「다시 정렬」「전체 보기」가 한 줄에 보임(크기 있음)', await evaluate(s.cdp, "(() => { const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 ? b : null; }; const f = r('[data-testid=find-input]'), g = r('[data-testid=filter-open]'), t = r('#fit'); return !!(f && g && t) && Math.abs(f.top - t.top) < 20; })()"));

    // ① 찾기 → ⑧ 키보드로 결과 목록 → Enter로 노드 열기(접힌 하위 유니버스 안이면 펼침)
    const collapsedBefore = await evaluate(s.cdp, "window.__wu.cy.getElementById('U-A1/N-001').empty()");
    await typeFind('대사');
    const hits = await evaluate(s.cdp, "[...document.querySelectorAll('[data-testid=find-hit]')].map((b) => b.dataset.gid + '|' + b.textContent)");
    check('R-17 ① 찾기 「대사」 → 맞는 노드 목록(유형·유니버스 이름 포함), 접힌 하위 유니버스 안 노드도', hits.length >= 2 && hits.some((h) => h.startsWith('U-A1/N-001|') && h.includes('업무') && h.includes('월말 정산 점검')) && collapsedBefore, hits.slice(0, 3).join(', '));
    await key('ArrowDown', 'ArrowDown', 40);
    const focusedHit = await evaluate(s.cdp, "document.activeElement && document.activeElement.dataset.testid === 'find-hit' ? document.activeElement.dataset.gid : ''");
    await key('ArrowDown', 'ArrowDown', 40);
    await key('ArrowUp', 'ArrowUp', 38);
    await key('Enter', 'Enter', 13);
    await sleep(400);
    const picked = await evaluate(s.cdp, '({ sel: window.__wu.selected, h2: (document.querySelector(\'#detail h2\') || {}).textContent, focusH2: document.activeElement && document.activeElement.tagName === \'H2\', inGraph: !window.__wu.cy.getElementById(window.__wu.selected || \'x\').empty() })');
    check('R-17 ⑧ 키보드만: 찾기 칸 입력 → ↓로 목록 → Enter → 그 노드 상세가 열리고 초점이 상세 제목으로', !!focusedHit && picked.sel === focusedHit && !!picked.h2 && picked.focusH2 && picked.inGraph, JSON.stringify(picked));
    await sleep(300);
    const pickedPx = await renderedPx(picked.sel);
    check('R-17 ①⑦ 찾은 노드로 이동·확대: 고른 노드 이름이 화면에서 15px 이상', pickedPx >= 15, pickedPx.toFixed(1));
    check('R-17 ① 상태 줄에 「찾음」', (await text(s.cdp, '[data-testid=explore-note]')).includes('찾음'));
    const mid = await evaluate(s.cdp, "(() => { const cy = window.__wu.cy; const p = cy.getElementById(window.__wu.selected).renderedPosition(); return { dx: Math.round(p.x - cy.width() / 2), dy: Math.round(p.y - cy.height() / 2) }; })()");
    // cytoscape의 가운데 맞춤은 동그라미와 아래 이름을 합친 상자를 가운데에 둔다: 동그라미는 이름 높이만큼 위에 있다(수렴 재검증 3번: 상태 줄을 먼저 바꿔 55px → 25px)
    check('R-17 ① 찾은 노드가 그래프 가운데 근처로(가로 10px, 세로 30px 안)', Math.abs(mid.dx) <= 10 && Math.abs(mid.dy) <= 30, JSON.stringify(mid));
    await shot(s.cdp, `${browser.name}-12-find-picked`);
    await key('Escape', 'Escape', 27);
    check('R-17 ⑧ Esc(상세 제목에 초점) → 노드 선택 해제', (await evaluate(s.cdp, 'window.__wu.selected')) === null);
    await key('Escape', 'Escape', 27);
    check('R-17 ⑧ 선택이 없을 때 Esc → 아무 일 없음(오류 없음, 유니버스 요약 그대로)', (await evaluate(s.cdp, 'window.__wu.selected')) === null && (await text(s.cdp, '#detail')).length > 0);
    // ② 없는 이름, Enter 바로 누르기
    await typeFind('없는이름xyz');
    check('R-17 ② 없는 이름 → 「찾는 노드 없음」', (await text(s.cdp, '[data-testid=find-none]')).includes('찾는 노드 없음'));
    // 검토 B-5·6: 결과 목록에서 Esc → 목록이 닫힌 채 찾기 칸으로(다시 열리지 않음), 찾기 칸 Esc는 글자를 지우지 않음
    await typeFind('대사');
    await key('ArrowDown', 'ArrowDown', 40);
    await key('Escape', 'Escape', 27);
    const escList = await evaluate(s.cdp, "({ hidden: document.querySelector('[data-testid=find-results]').hidden, focus: document.activeElement && document.activeElement.dataset.testid, value: document.querySelector('[data-testid=find-input]').value })");
    await key('ArrowDown', 'ArrowDown', 40); // 목록이 닫혀 있으면 아무 일 없음
    await typeFind('대사');
    await key('Escape', 'Escape', 27);
    const escInput = await evaluate(s.cdp, "({ hidden: document.querySelector('[data-testid=find-results]').hidden, value: document.querySelector('[data-testid=find-input]').value })");
    check('R-17 ⑧ 결과 목록 Esc → 목록 닫히고 찾기 칸으로, 찾기 칸 Esc → 목록만 닫고 글자는 남김', escList.hidden && escList.focus === 'find-input' && escList.value === '대사' && escInput.hidden && escInput.value === '대사', JSON.stringify([escList, escInput]));
    await evaluate(s.cdp, "document.querySelector('[data-testid=find-input]').blur()");
    await typeFind('정산 담당');
    await key('Enter', 'Enter', 13);
    await sleep(300);
    check('R-17 ⑧ 찾기 칸에서 Enter를 바로 누르면 첫 결과를 연다', ((await evaluate(s.cdp, "(window.__wu.view.getNode(window.__wu.selected || '') || {}).label")) || '').includes('정산 담당'));
    await evaluate(s.cdp, 'window.__wu.select(null)');

    // ③ 거르기: 유형(업무) → 나머지 흐림, 상태 표시, 한 번에 풀기
    await clickTestId(s.cdp, 'filter-open');
    await sleep(150);
    await clickTestId(s.cdp, 'filter-type-work');
    await sleep(400);
    const fw = await evaluate(s.cdp, "(() => { const cy = window.__wu.cy; const out = cy.nodes('.filtered-out'); const wrong = cy.nodes().filter((n) => { const t = n.data('core_type'); return (t === 'work' || t === 'root') === n.hasClass('filtered-out'); }); return { out: out.length, wrong: wrong.length, op: out.length ? out[0].pstyle('opacity').value : null }; })()");
    check('R-17 ③ 유형 거르기(업무) → 업무·꼭지만 또렷, 나머지 흐림(유형이 맞지 않는 노드 0)', fw.out > 0 && fw.wrong === 0 && Number(fw.op) < 0.2, JSON.stringify(fw));
    check('R-17 ③ 거르기 중 표시(n/전체 또렷)와 「거르기 풀기」', /거르기 중: 업무 — \d+\/\d+개 또렷/.test(await text(s.cdp, '[data-testid=filter-on]')) && !!(await evaluate(s.cdp, "!!document.querySelector('[data-testid=filter-clear]')")));
    await shot(s.cdp, `${browser.name}-13-filter-work`);
    // 시간 막대를 옮겨도 거르기 흐림이 그대로(표시와 실제가 일치)
    await evaluate(s.cdp, "(() => { const r = document.querySelector('[data-testid=time-range]'); r.value = '0'; r.dispatchEvent(new Event('input')); })()");
    await sleep(250);
    const afterTime = await evaluate(s.cdp, "window.__wu.cy.nodes('.filtered-out').length");
    check('R-17 ③ 거르기 중 시간 막대 이동 → 흐림·표시 그대로', afterTime === fw.out && (await text(s.cdp, '[data-testid=filter-on]')).includes('거르기 중'), `${afterTime}/${fw.out}`);
    await clickTestId(s.cdp, 'time-today');
    await clickTestId(s.cdp, 'filter-clear');
    await sleep(300);
    check('R-17 ③ 「거르기 풀기」 한 번 → 흐림 0, 표시 사라짐', (await evaluate(s.cdp, "window.__wu.cy.nodes('.filtered-out').length")) === 0 && !(await evaluate(s.cdp, "!!document.querySelector('[data-testid=filter-on]')")));
    // 사람 하나
    await evaluate(s.cdp, "window.__wu.toggle('U-B')");
    await sleep(300);
    await clickTestId(s.cdp, 'filter-open');
    await sleep(150);
    await evaluate(s.cdp, "(() => { const sel = document.querySelector('[data-testid=filter-person]'); sel.value = 'U-B/N-201'; sel.dispatchEvent(new Event('change')); })()");
    await sleep(300);
    const fp = await evaluate(s.cdp, "window.__wu.cy.nodes().not('.filtered-out').map((n) => n.data('label') + ':' + n.data('core_type'))");
    check('R-17 ③ 사람 하나(도하람) → 그 사람과 맡은 업무(2026 행사·장소 섭외·참가자 모집)와 꼭지만 또렷', fp.includes('도하람:person') && fp.includes('장소 섭외:work') && fp.includes('참가자 모집:work') && !fp.some((x) => x.endsWith(':topic')) && !fp.includes('윤바다:person'), fp.join(', '));
    await sleep(300); // 맞춤 애니메이션
    const fpRead = await evaluate(s.cdp, "(() => { const cy = window.__wu.cy; const z = cy.zoom(); return cy.nodes().not('.filtered-out').filter((n) => n.data('core_type') !== 'root').map((n) => Math.round(n.pstyle('font-size').pfValue * z * 10) / 10 + (n.hasClass('tiny-label') ? '숨김' : '')); })()");
    check('R-17 ③⑦ 사람 거르기 뒤 남은 노드(꼭지 제외)에 화면을 맞춰 이름이 모두 읽힘(6px 이상, 숨김 없음)', fpRead.length >= 2 && fpRead.every((x) => !String(x).includes('숨김') && Number(x) >= 6), fpRead.join(', '));
    await shot(s.cdp, `${browser.name}-14-filter-person`);
    await clickTestId(s.cdp, 'filter-clear');
    await sleep(200);

    // ⑦ 모두 펼친 부서 화면: 작은 이름은 숨김(6px 미만), 마우스를 올린 노드 이름은 크게
    // 앞 단계(찾기)에서 이미 펼친 것이 있으므로, 접힌 것만 펼치기를 반복한다(펼치면 그 안의 하위가 새로 접힌 것으로 나타남)
    await evaluate(s.cdp, "(() => { for (let i = 0; i < 5 && window.__wu.display.collapsed.size; i += 1) for (const u of [...window.__wu.display.collapsed.keys()]) window.__wu.toggle(u); })()");
    await sleep(600);
    await evaluate(s.cdp, "document.getElementById('fit').click()");
    await sleep(400);
    const small = await evaluate(s.cdp, "(() => { const cy = window.__wu.cy; const z = cy.zoom(); const all = cy.nodes(); const tiny = all.filter((n) => n.pstyle('font-size').pfValue * z < 6); const hidden = all.filter((n) => n.hasClass('tiny-label') && Number(n.pstyle('text-opacity').value) === 0); const mismatch = all.filter((n) => (n.pstyle('font-size').pfValue * z < 6) !== n.hasClass('tiny-label')); return { total: all.length, tiny: tiny.length, hidden: hidden.length, mismatch: mismatch.length, zoom: z }; })()");
    check('R-17 ⑦ 모두 펼친 부서 화면: 화면에서 6px보다 작은 이름은 모두 숨기고, 6px 이상은 보임(판정 불일치 0)', small.total >= 60 && small.tiny > 0 && small.hidden === small.tiny && small.mismatch === 0, JSON.stringify(small));
    // T-18 재검증 R1~R3: 키운 이름(꼭지 11px 등)이 배치·맞춤 계산에 들어가 화면 밖으로 넘치거나 「다시 정렬」마다 모양이 달라지면 안 된다
    const geo = () => evaluate(s.cdp, "(() => { const cy = window.__wu.cy; const w = cy.width(), h = cy.height(); const off = cy.nodes().filter((n) => { const p = n.renderedPosition(); return p.x < 0 || p.y < 0 || p.x > w || p.y > h; }).length; const pos = cy.nodes().map((n) => Math.round(n.position('x')) + ',' + Math.round(n.position('y'))).join(';'); return { z: +cy.zoom().toFixed(3), off, pos }; })()");
    await evaluate(s.cdp, "document.getElementById('relayout').click()");
    await sleep(300);
    const g1 = await geo();
    await evaluate(s.cdp, "document.getElementById('relayout').click()");
    await sleep(300);
    const g2 = await geo();
    check('T-18 재검증: 모두 펼친 부서 화면 「다시 정렬」 두 번 → 같은 모양·배율, 화면 밖 노드 0', g1.z === g2.z && g1.pos === g2.pos && g1.off === 0 && g2.off === 0, `${g1.z}/${g2.z}, 밖 ${g1.off}/${g2.off}`);
    const hoverGid = await evaluate(s.cdp, "window.__wu.cy.nodes('[core_type = \"work\"]').filter((n) => !n.hasClass('time-off'))[3].id()");
    const hp = await evaluate(s.cdp, `(() => { const n = window.__wu.cy.getElementById(${JSON.stringify(hoverGid)}); const p = n.renderedPosition(); const r = document.getElementById('graph').getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; })()`);
    await s.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hp.x, y: hp.y });
    await sleep(250);
    const hoverPx = await renderedPx(hoverGid);
    check('R-17 ⑦ 마우스를 올린 노드 이름은 화면에서 15px 이상', hoverPx >= 14.9, `${hoverPx.toFixed(1)}px (배율 ${small.zoom.toFixed(2)})`);
    await shot(s.cdp, `${browser.name}-15-dept-expanded-hover`);
    // 노드에서 그래프 밖(머리글)으로 바로 나가도 원래 크기로(mouseleave)
    await s.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
    await sleep(150);
    check('R-17 ⑦ 마우스를 그래프 밖으로 떼면 그 노드 이름은 원래 크기로', (await renderedPx(hoverGid)) < hoverPx);

    // ④ 주변만 보기 1·2단계 → 「전체 보기」로 돌아가기
    const before = await shownCount();
    await evaluate(s.cdp, "window.__wu.select('U-A1/N-001')");
    await sleep(150);
    await clickTestId(s.cdp, 'btn-nbhd');
    await sleep(500);
    const nb1 = await evaluate(s.cdp, "(() => { const cy = window.__wu.cy; const z = cy.zoom(); return { n: cy.nodes().length, minPx: Math.min(...cy.nodes().map((x) => x.pstyle('font-size').pfValue * z)), nb: window.__wu.nbhd }; })()");
    check('R-17 ④ 주변만 보기 → 고른 노드와 1단계 이웃만 다시 배치, 모든 이름이 6px 이상(읽힘)', nb1.nb && nb1.nb.depth === 1 && nb1.n < before && nb1.n >= 2 && nb1.minPx >= 6, JSON.stringify(nb1));
    check('R-17 ④ 주변만 보기 표시와 「전체 보기로」', (await text(s.cdp, '[data-testid=nbhd-on]')).includes('주변만 보기: 「대사 확인」 1단계'));
    await shot(s.cdp, `${browser.name}-16-nbhd-1`);
    await clickTestId(s.cdp, 'nbhd-depth');
    await sleep(500);
    const nb2 = await shownCount();
    check('R-17 ④ 2단계 → 더 넓게', nb2 > nb1.n && (await evaluate(s.cdp, 'window.__wu.nbhd.depth')) === 2, `${nb1.n} → ${nb2}`);
    check('U-16: 주변 2단계에서 가운데 노드를 고른 채 2단계째 노드가 흐려지지 않음', (await evaluate(s.cdp, "window.__wu.cy.nodes('.faded').length")) === 0);
    await evaluate(s.cdp, "document.getElementById('fit').click()");
    await sleep(500);
    check('R-17 ④ 「전체 보기」 → 전체 그래프로 돌아감', (await evaluate(s.cdp, 'window.__wu.nbhd')) === null && (await shownCount()) === before, `${await shownCount()}/${before}`);

    // ⑤ 데이터 불변
    check('R-17 ⑤ 찾기·거르기·주변만 보기 뒤 이력 수 그대로(데이터 불변)', (await eventsTotal()) === ev0, `${ev0} → ${await eventsTotal()}`);

    // ④ 오류: 이웃 없는 노드 → 알림, 화면 그대로. 거르기 중 저장해도 흐림 유지
    await clickTestId(s.cdp, 'filter-open');
    await sleep(150);
    await clickTestId(s.cdp, 'filter-type-work');
    await sleep(300);
    const outBefore = await evaluate(s.cdp, "window.__wu.cy.nodes('.filtered-out').length");
    await evaluate(s.cdp, "window.__wu.select(null)");
    await evaluate(s.cdp, "document.querySelector('details.add').open = true");
    const lonely = 'T18 외톨이 메모';
    const addR = await submitAdd(s.cdp, 'topic', lonely); // 주제는 꼭지에 바로 잇지 않는 것이 기본(연결 없는 노드)
    await sleep(300);
    const lonelyGid = await evaluate(s.cdp, `(window.__wu.view.nodes.find((n) => n.label === ${JSON.stringify(lonely)}) || {}).gid || ''`);
    const outAfter = await evaluate(s.cdp, "window.__wu.cy.nodes('.filtered-out').length");
    check('R-17 ③ 거르기 중 저장(노드 추가) → 새 주제 노드는 거르기에서 빠지지만(표시 유지), 고른 노드라 또렷하게 보임(R-02 ①)', addR.code === 'OK' && !!lonelyGid && outAfter === outBefore + 1 && (await text(s.cdp, '[data-testid=filter-on]')).includes('거르기 중') && Number(await evaluate(s.cdp, `window.__wu.cy.getElementById(${JSON.stringify(lonelyGid)}).pstyle('opacity').value`)) === 1, `${outBefore} → ${outAfter}`);
    // 검토 A·B 중간-1: 거르기(업무) 중 찾기로 업무가 아닌 노드를 고르면 그 노드는 또렷하고 이름이 보인다
    await typeFind('정산 담당');
    await key('Enter', 'Enter', 13);
    await sleep(400);
    const pickedIn = await evaluate(s.cdp, "(() => { const n = window.__wu.cy.getElementById(window.__wu.selected || 'x'); return n.empty() ? null : { out: n.hasClass('filtered-out'), op: Number(n.pstyle('opacity').value), to: Number(n.pstyle('text-opacity').value), px: n.pstyle('font-size').pfValue * window.__wu.cy.zoom() }; })()");
    check('R-17 ①③⑦ 거르기 중 찾기로 고른(거르기에서 빠진) 노드도 또렷하고 이름이 15px 이상', !!pickedIn && pickedIn.out && pickedIn.op === 1 && pickedIn.to === 1 && pickedIn.px >= 15, JSON.stringify(pickedIn));
    await clickTestId(s.cdp, 'filter-clear');
    await evaluate(s.cdp, `window.__wu.select(${JSON.stringify(lonelyGid)})`);
    await sleep(150);
    const countLonely = await shownCount();
    await clickTestId(s.cdp, 'btn-nbhd');
    await sleep(300);
    check('R-17 ④ 오류: 이웃 없는 노드 → 「이어진 노드 없음」 알림, 화면 그대로', (await text(s.cdp, '[data-testid=explore-note]')).includes('이어진 노드 없음') && (await evaluate(s.cdp, 'window.__wu.nbhd')) === null && (await shownCount()) === countLonely);
    // 숨긴 노드는 찾기에 나오지 않음
    await evaluate(s.cdp, "window.confirm = () => true");
    await evaluate(s.cdp, "(document.querySelector('[data-testid=btn-hide]') || { click() {} }).click()");
    await sleep(300);
    await typeFind('T18 외톨이');
    check('R-17 ② 숨긴 노드는 찾기에 나오지 않음', !!(await evaluate(s.cdp, "!!document.querySelector('[data-testid=find-none]')")));
    await key('Escape', 'Escape', 27);
    // 검토 A·B 중간-2: 주변만 보기 중 노드 추가(주변 밖) → 전체로 돌아가 새 노드가 그래프에 보이고 선택됨
    await evaluate(s.cdp, "window.__wu.select('U-A1/N-001')");
    await sleep(150);
    await clickTestId(s.cdp, 'btn-nbhd');
    await sleep(400);
    await evaluate(s.cdp, "window.__wu.select(null)");
    await evaluate(s.cdp, "document.querySelector('details.add').open = true");
    const addNb = await submitAdd(s.cdp, 'work', 'T18 주변 밖 새 업무');
    await sleep(400);
    const nbAdd = await evaluate(s.cdp, "(() => { const g = window.__wu.selected; return { nbhd: window.__wu.nbhd, inGraph: !!g && !window.__wu.cy.getElementById(g).empty(), label: (window.__wu.view.getNode(g || '') || {}).label }; })()");
    check('R-17 ④·R-02 ① 주변만 보기 중 노드 추가 → 전체로 돌아가 새 노드가 그래프에 보이고 선택됨', addNb.code === 'OK' && nbAdd.nbhd === null && nbAdd.inGraph && nbAdd.label === 'T18 주변 밖 새 업무', JSON.stringify(nbAdd));
    // 검토 B-3: 주변만 보기 중 하위 유니버스 꼭지 펼치기(더블클릭과 같은 toggle) → 주변만 보기를 끝내고 전체에서 펼침
    await evaluate(s.cdp, "window.__wu.select('U-D1/N-000')");
    await sleep(150);
    await clickTestId(s.cdp, 'btn-nbhd');
    await sleep(400);
    await evaluate(s.cdp, "window.__wu.toggle('U-B')");
    await sleep(400);
    check('R-17 ④ 주변만 보기 중 펼치기·접기 → 주변만 보기를 끝내고 전체 그래프에서 바뀜', (await evaluate(s.cdp, 'window.__wu.nbhd')) === null && (await shownCount()) > 5, `${await shownCount()}`);
    // 꼭지 이름은 화면이 작아도 숨기지 않음(검토 B-4, C10-6)
    const rootsShown = await evaluate(s.cdp, "(() => { const cy = window.__wu.cy; const z = cy.zoom(); return cy.nodes('[core_type = \"root\"]').map((n) => !n.hasClass('tiny-label') && n.pstyle('font-size').pfValue * z >= 11); })()");
    check('C10-6 꼭지 이름은 늘 보임(화면 11px 이상)', rootsShown.length > 0 && rootsShown.every(Boolean), JSON.stringify(rootsShown));
  }
  {
    check('부서 화면에서도 화면에 "null" 글자 없음', (await evaluate(s.cdp, "(() => { const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); while (w.nextNode()) if (w.currentNode.textContent.trim() === 'null') return false; return true; })()")));
  }

  const errors1 = [...s.log.errors];
  const external1 = [...s.log.external];
  s.cdp.close();
  await close(s);

  // 2) 브라우저를 닫았다 다시 열기(같은 프로필)
  s = await openSession(exe, profile, port);
  check('P-3 브라우저 재시작 후 추가·수정·숨김 유지', s.ready && (await nodeCount(s.cdp)) === NODES && (await hasLabel(s.cdp, newLabel)) && (await evaluate(s.cdp, "window.__wu.doc.nodes.find((n) => n.id === 'N-001').description.includes('(수정)')")));
  // E1(12.1): 저장된 문서의 스키마 버전이 다르면 경고하고 읽기 전용으로 연다
  await evaluate(s.cdp, `(() => { const k = 'wu:v1:u:U-A1'; const d = JSON.parse(localStorage.getItem(k)); d.schema_version = '2.0'; localStorage.setItem(k, JSON.stringify(d)); location.reload(); })()`).catch(() => {});
  await sleep(500);
  await waitFor(s.cdp, "window.__wu && window.__wu.doc && window.__wu.doc.universe.id === 'U-A1'", 8000);
  check('오류(12.1): 스키마 버전이 다른 문서 → 경고 배너와 읽기 전용(추가 불가)', (await text(s.cdp, '#banner')).includes('읽기 전용으로 엽니다') && (await text(s.cdp, '#add-slot')).includes('읽기 전용'));
  // NFR 가용성·복구: 「가상 데이터 초기화」로 처음 상태로 돌아간다(위 버전 문제도 함께 풀림)
  await evaluate(s.cdp, "sessionStorage.setItem('__confirmMsg', ''); window.confirm = (m) => { sessionStorage.setItem('__confirmMsg', m); return true; }; document.getElementById('reset').click()").catch(() => {});
  await sleep(600);
  await waitFor(s.cdp, "window.__wu && window.__wu.doc && window.__wu.cy.nodes().length > 0", 8000);
  const resetMsg = (await evaluate(s.cdp, "sessionStorage.getItem('__confirmMsg')").catch(() => '')) || '';
  await waitFor(s.cdp, "window.__wu && window.__wu.doc && window.__wu.doc.universe.id === 'U-A1' && window.__wu.cy.nodes().length > 0", 8000);
  check('U-9: 초기화 확인 문구가 직접 만들거나 가져온 유니버스도 지워진다고 알림', resetMsg.includes('초기 샘플로 되돌립니다') && resetMsg.includes('직접 만들거나 가져온 유니버스') && resetMsg.includes('내보내세요'), resetMsg);
  check('NFR 복구: 가상 데이터 초기화 → 샘플이 처음 상태(추가 노드 없음, 수정 되돌림, 쓰기 가능)', (await nodeCount(s.cdp)) === NODES && !(await hasLabel(s.cdp, newLabel)) && !(await evaluate(s.cdp, "window.__wu.readOnly")) && !(await evaluate(s.cdp, "(window.__wu.doc.nodes.find((n) => n.id === 'N-001').description || '').includes('(수정)')")));
  // ── R-03 ③ 초안 확정(CR-8): 초기화한 깨끗한 월말 정산에서 확정 → 인수인계서·이력 → 다음 초안의 이전 인수인계 근거 ──
  await evaluate(s.cdp, "window.confirm = () => true; window.__wu.select(null)");
  await clickTestId(s.cdp, 'btn-draft-universe');
  await sleep(150);
  const makeDraft = (target, from, to) => evaluate(s.cdp, `(() => {
    const set = (id, v) => { const e = document.querySelector('[data-testid=' + id + ']'); e.value = v; e.dispatchEvent(new Event('change')); };
    set('draft-target', '${target}'); set('draft-from', '${from}'); set('draft-to', '${to}');
    document.querySelector('[data-testid=draft-form] button[type=submit]').click();
  })()`);
  await makeDraft('U-A1/N-001', 'U-A1/N-012', 'U-A1/N-011');
  await sleep(250);
  check('U-14: 유니버스가 하나인 화면의 초안 선택 목록에는 이름 뒤 유니버스 접미사가 없음', await evaluate(s.cdp, "[...document.querySelectorAll('[data-testid=draft-from] option')].every((o) => !o.textContent.includes('(월말 정산 점검)'))"));
  check('R-03 ③ 초안 아래에 「확정해 인수인계서로 저장」이 보임(크기 있음)', await evaluate(s.cdp, "(() => { const b = document.querySelector('[data-testid=draft-confirm]'); if (!b) return false; const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !b.disabled; })()"));
  await shot(s.cdp, `${browser.name}-12a-confirm-box`);
  await clickTestId(s.cdp, 'draft-confirm');
  await sleep(400);
  const confirmedDetail = await text(s.cdp, '#detail');
  check('R-03 ③ 확정 → 새 인수인계서가 열리고 확정자·확정 시각·보내는/받는 사람이 보임', (await text(s.cdp, '#detail h2')).includes('대사 확인 인수인계서') && confirmedDetail.includes('사용자(이 브라우저)') && confirmedDetail.includes('확정 시각') && confirmedDetail.includes('서하늘') && confirmedDetail.includes('윤바다'), confirmedDetail.slice(0, 120));
  check('R-03 ③ 확정 → 인수인계 이력이 바로 앞 인수인계를 가리킴(이어받음)', await evaluate(s.cdp, "(() => { const ev = window.__wu.doc.events.filter((e) => e.type === 'handover').pop(); return ev.payload.work_id === 'N-001' && ev.payload.from_person_id === 'N-012' && ev.payload.to_person_id === 'N-011' && ev.payload.previous_handover_id === 'E-007' && !!ev.payload.artifact_id; })()"));
  const doneNote = await text(s.cdp, '[data-testid=confirm-done]');
  const detailTop = await evaluate(s.cdp, "(() => { const a = document.querySelector('aside'); const n = document.querySelector('[data-testid=confirm-done]'); const r = n ? n.getBoundingClientRect() : null; const ar = a.getBoundingClientRect(); return { scroll: a.scrollTop, visible: !!r && r.top >= ar.top - 1 && r.bottom <= ar.bottom + 1 }; })()");
  check('U-3: 확정 직후 패널이 맨 위이고 「인수인계서로 저장했습니다」 안내가 보임', doneNote.includes('인수인계서로 저장했습니다') && doneNote.includes('대사 확인') && detailTop.scroll === 0 && detailTop.visible, JSON.stringify(detailTop) + ' ' + doneNote);
  check('U-3: 확정한 새 인수인계서 노드가 그래프에서 고른 상태', (await evaluate(s.cdp, "(window.__wu.view.getNode(window.__wu.selected || '') || {}).label || ''")).includes('인수인계서'));
  await shot(s.cdp, `${browser.name}-12b-confirmed`);
  // 같은 날 같은 확정은 다시 하지 않는다
  await evaluate(s.cdp, "window.__wu.select(null)");
  await clickTestId(s.cdp, 'btn-draft-universe');
  await sleep(150);
  await makeDraft('U-A1/N-001', 'U-A1/N-012', 'U-A1/N-011');
  await sleep(250);
  await clickTestId(s.cdp, 'draft-confirm');
  await sleep(250);
  check('오류: 같은 날 같은 인수인계를 두 번 확정하면 막고 이유 표시', (await text(s.cdp, '[data-testid=confirm-message]')).includes('이미 확정했습니다'));
  // 다음 초안(윤바다 → 한가람)의 이전 인수인계에 확정한 인수인계서가 근거로
  await makeDraft('U-A1/N-001', 'U-A1/N-011', 'U-A1/N-010');
  await sleep(250);
  const prevItem = await text(s.cdp, '[data-testid=draft-item-이전_인수인계]');
  check('확정한 인수인계가 다음 초안의 「이전 인수인계」에 인수인계서 근거와 함께 나옴', prevItem.includes('서하늘 → 윤바다') && prevItem.includes('대사 확인 인수인계서'), prevItem.slice(0, 160));
  // ── R-19 ① ② ③ 인수인계서 내려받기·인쇄(CR-12 A, D-21): 초안 화면과 확정 인수인계서 상세 ──
  await evaluate(s.cdp, `(() => {
    window.__dl = null; window.__blob = null; window.__prints = [];
    const orig = URL.createObjectURL; URL.createObjectURL = (b) => { window.__blob = b; return orig.call(URL, b); };
    window.__origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { window.__dl = this.getAttribute('download'); };
    const d = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');
    window.__origCW = d;
    Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', { configurable: true, get() {
      const w = d.get.call(this);
      if (!w) return w;
      return new Proxy(w, { get(t, k) {
        if (k === 'print') return () => { window.__prints.push({ html: t.document.documentElement.outerHTML, interactive: t.document.querySelectorAll('button,canvas,svg,nav,script,input,select').length }); };
        const v = t[k];
        return typeof v === 'function' ? v.bind(t) : v;
      } });
    } });
  })()`);
  const btnBox = (id) => evaluate(s.cdp, `(() => { const b = document.querySelector('[data-testid=${id}]'); if (!b) return false; const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !b.disabled; })()`);
  check('R-19 ① ② 초안 화면에 「내려받기」「인쇄」 버튼이 보임(크기 있음)', (await btnBox('draft-download')) && (await btnBox('draft-print')));
  const screenEvidence = await evaluate(s.cdp, "(() => { const e = document.querySelector('[data-testid=draft-result] .evidence'); return e ? e.textContent : ''; })()");
  const screenLack = await evaluate(s.cdp, "(() => { const r = document.querySelector('[data-testid=draft-result]').textContent; return { lack: r.includes('이력 부족'), none: r.includes('해당 없음') }; })()");
  await clickTestId(s.cdp, 'draft-download');
  await sleep(200);
  const r19name = await evaluate(s.cdp, 'window.__dl');
  const r19html = await evaluate(s.cdp, 'window.__blob ? window.__blob.text() : null');
  check('R-19 ① 초안 내려받기 → 날짜-대상-인수인계서(초안).html, 스크립트·외부 파일 없는 완전한 HTML', typeof r19name === 'string' && /^\d{4}-\d{2}-\d{2}-.+-인수인계서\(초안\)\.html$/.test(r19name) && !!r19html && r19html.startsWith('<!doctype html>') && !/<script|src=|href=/.test(r19html), String(r19name));
  check('R-19 ③ 초안 파일에 화면의 근거 이름·이력 부족/해당 없음·생성 방식(항목별·전체)이 남음', !!r19html && (!screenEvidence || r19html.includes(screenEvidence.replace(/&/g, '&amp;'))) && (!screenLack.lack || r19html.includes('이력 부족')) && (!screenLack.none || r19html.includes('해당 없음')) && r19html.includes('생성 방식:') && /class="chip">(규칙 기반|사전 생성|LLM)</.test(r19html), screenEvidence);
  await clickTestId(s.cdp, 'draft-print');
  await sleep(500);
  const r19print = await evaluate(s.cdp, 'window.__prints');
  check('R-19 ② 초안 인쇄 → 숨긴 iframe의 print() 호출, 문서에 버튼·그래프·스크립트 없음, A4 세로 지정', r19print.length === 1 && r19print[0].interactive === 0 && r19print[0].html.includes('이력') && (await evaluate(s.cdp, "!!document.querySelector('iframe[data-testid=print-frame]')")) && r19html.includes('size: A4 portrait'), JSON.stringify(r19print.map((p) => p.interactive)));
  await evaluate(s.cdp, "document.querySelectorAll('iframe[data-testid=print-frame]').forEach((f) => f.remove()); window.__prints = []; window.__dl = null; window.__blob = null; window.__confirmedDoc = window.__wu.doc.nodes.filter((n) => n.subtype === '인수인계서' && !n.hidden && n.label.includes('대사 확인 인수인계서')).pop().id; window.__wu.select(window.__wu.doc.universe.id + '/' + window.__confirmedDoc)");
  await sleep(250);
  check('R-19 ① ② 확정 인수인계서 상세에 「내려받기」「인쇄」 버튼이 보임(크기 있음)', (await btnBox('doc-download')) && (await btnBox('doc-print')));
  await clickTestId(s.cdp, 'doc-download');
  await sleep(200);
  const r19cname = await evaluate(s.cdp, 'window.__dl');
  const r19chtml = await evaluate(s.cdp, 'window.__blob ? window.__blob.text() : null');
  check('R-19 ① 확정본 내려받기 → …-대사_확인-인수인계서(확정).html, 본문·확정자·확정 시각·보내는/받는 사람 포함', typeof r19cname === 'string' && r19cname.endsWith('-대사_확인-인수인계서(확정).html') && !!r19chtml && r19chtml.includes('확정자: 사용자(이 브라우저)') && r19chtml.includes('확정 시각:') && r19chtml.includes('서하늘') && r19chtml.includes('윤바다') && r19chtml.includes('■ 업무 개요'), String(r19cname));
  await clickTestId(s.cdp, 'doc-print');
  await sleep(500);
  const r19cprint = await evaluate(s.cdp, 'window.__prints');
  check('R-19 ② 확정본 인쇄 → iframe print() 호출, 문서에 버튼·그래프 없음', r19cprint.length === 1 && r19cprint[0].interactive === 0 && r19cprint[0].html.includes('확정'), JSON.stringify(r19cprint.map((p) => p.interactive)));
  await evaluate(s.cdp, "document.querySelectorAll('iframe[data-testid=print-frame]').forEach((f) => f.remove()); HTMLAnchorElement.prototype.click = window.__origClick; Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', window.__origCW); window.__wu.select(null)");
  // ── R-20 ① ② ③ 미해결 이슈 보기와 「해결로 표시」(CR-12 B, D-22): 대사 확인 업무(U-A1/N-001) ──
  const r20Draft = async () => { // 같은 업무 초안의 「진행 중」 문장들
    await evaluate(s.cdp, "window.__wu.select(null)");
    await sleep(150);
    await clickTestId(s.cdp, 'btn-draft-universe');
    await sleep(150);
    await makeDraft('U-A1/N-001', 'U-A1/N-011', 'U-A1/N-010');
    await sleep(250);
    return evaluate(s.cdp, "[...document.querySelectorAll('[data-testid=draft-item-진행_중] li > span:first-child')].map((x) => x.textContent)");
  };
  const r20Count = () => evaluate(s.cdp, "(() => { const p = document.querySelector('#detail [data-testid=issue-count]'); return p ? { n: Number(p.dataset.count), text: p.textContent } : null; })()");
  const r20Items = () => evaluate(s.cdp, "[...document.querySelectorAll('[data-testid=issue-item]')].map((li) => ({ gid: li.dataset.gid, chip: li.querySelector('.chip').textContent, text: li.children[1].textContent, hasBtn: !!li.querySelector('[data-testid=btn-resolve]') }))");
  const r20Draft0 = await r20Draft();
  await evaluate(s.cdp, "window.__wu.select('U-A1/N-001')");
  await sleep(200);
  const r20c0 = await r20Count();
  check('R-20 ① 업무 상세에 「미해결 n건」 버튼이 보임(크기 있음)', !!r20c0 && r20c0.n > 0 && r20c0.text.includes(`미해결 ${r20c0.n}건`) && (await btnBox('btn-issues')), JSON.stringify(r20c0));
  await clickTestId(s.cdp, 'btn-issues');
  await sleep(200);
  const r20Items0 = await r20Items();
  check('R-20 ① 누르면 목록(날짜·업무·내용·해결로 표시)이 뜨고 건수가 같음', r20Items0.length === r20c0.n && (await text(s.cdp, '#detail h2')).includes(`미해결 ${r20c0.n}건`) && (await btnBox('btn-resolve')) && r20Items0.every((x) => x.hasBtn), JSON.stringify(r20Items0.map((x) => x.gid)));
  const r20Prog0 = r20Items0.filter((x) => x.chip === '진행 중');
  check('R-20 ③ 목록의 「진행 중」 항목이 같은 업무 인수인계 초안의 「진행 중」과 같은 메모', r20Prog0.length === r20Draft0.length && r20Draft0.length > 0 && r20Draft0.every((d) => r20Prog0.some((x) => d.includes(x.text))), JSON.stringify([r20Prog0.length, r20Draft0.length]));
  await shot(s.cdp, `${browser.name}-13a-issues`);
  const r20Target = r20Prog0[0];
  const r20Ev = (gid) => evaluate(s.cdp, `JSON.stringify(window.__wu.doc.events.find((e) => e.id === '${gid.split('/')[1]}'))`);
  const r20Orig0 = await r20Ev(r20Target.gid);
  const r20e0 = await evaluate(s.cdp, 'window.__wu.doc.events.length');
  await evaluate(s.cdp, `document.querySelector('[data-gid="${r20Target.gid}"] [data-testid=btn-resolve]').click()`);
  await sleep(250);
  const r20Items1 = await r20Items();
  const r20e1 = await evaluate(s.cdp, 'window.__wu.doc.events.length');
  const r20Added = await evaluate(s.cdp, 'JSON.stringify(window.__wu.doc.events.at(-1))');
  const r20AddedObj = JSON.parse(r20Added);
  check('R-20 ② 해결로 표시 → 목록에서 빠져 n-1건, 이력에 「해결됨」 메모가 정확히 1건 늘고 원래 메모는 그대로', !r20Items1.some((x) => x.gid === r20Target.gid) && (await text(s.cdp, '#detail h2')).includes(`미해결 ${r20Items1.length}건`) && r20Items1.length < r20c0.n && r20e1 === r20e0 + 1 && r20AddedObj.type === 'memo' && r20AddedObj.payload.category === 'resolved' && r20AddedObj.note.startsWith('해결: ') && (await r20Ev(r20Target.gid)) === r20Orig0, `${r20c0.n} -> ${r20Items1.length}, ${r20Added.slice(0, 150)}`);
  await shot(s.cdp, `${browser.name}-13b-issues-resolved`);
  await clickTestId(s.cdp, 'issue-close');
  await sleep(150);
  const r20c1 = await r20Count();
  check('R-20 ① 닫으면 업무 상세로 돌아가 「미해결 n건」이 줄어든 값으로 보임', !!r20c1 && r20c1.n === r20Items1.length, JSON.stringify(r20c1));
  const r20Draft1 = await r20Draft();
  const r20Prog1 = r20Items1.filter((x) => x.chip === '진행 중');
  check('R-20 ③ 해결 표시 뒤에도 초안의 「진행 중」과 목록의 「진행 중」이 같은 메모(1건 줄어듦)', r20Draft1.length === r20Draft0.length - 1 && r20Draft1.length === r20Prog1.length && r20Draft1.every((d) => r20Prog1.some((x) => d.includes(x.text))), JSON.stringify([r20Draft0.length, r20Draft1.length, r20Prog1.length]));
  await evaluate(s.cdp, "window.__wu.select(null)");
  await sleep(200);
  const r20Ov = await r20Count();
  check('R-20 ① 유니버스 개요에도 「미해결 n건」이 보임(업무 한 건보다 크거나 같음)', !!r20Ov && r20Ov.n >= r20c1.n && (await btnBox('btn-issues')), JSON.stringify(r20Ov));
  await clickTestId(s.cdp, 'btn-issues');
  await sleep(200);
  check('R-20 ① 개요의 목록 건수가 「미해결 n건」과 같음', (await r20Items()).length === r20Ov.n, String(r20Ov.n));
  await shot(s.cdp, `${browser.name}-13c-issues-overview`);
  await clickTestId(s.cdp, 'issue-close');
  await sleep(100);
  // ── T-19 표로 추가·고치기(R-18 ①~⑥, D-18): 붙여 넣기 → 한 번에 저장 → 오류 행 → 고치기 → 긴 이름 겹침 없음 ──
  await evaluate(s.cdp, "window.confirm = () => true; window.__wu.select(null); document.querySelector('details.add').open = true");
  const t19Paste = async (text) => evaluate(s.cdp, `(() => { const t = document.querySelector('[data-testid=table-paste]'); t.value = ${JSON.stringify(text)}; t.dispatchEvent(new Event('input')); document.querySelector('[data-testid=table-paste-apply]').click(); return document.querySelectorAll('[data-testid=table-grid] tbody tr:not(.row-msg-line)').length; })()`);
  const t19Count = () => evaluate(s.cdp, 'window.__wu.doc.nodes.length');
  const t19Events = () => evaluate(s.cdp, 'window.__wu.doc.events.length');
  const t19n0 = await t19Count();
  const t19e0 = await t19Events();
  await clickTestId(s.cdp, 'btn-table-add');
  await sleep(200);
  check('R-18: 「표로 추가」 대화상자가 열리고 표(크기 있음)가 보임', await evaluate(s.cdp, "(() => { const d = document.getElementById('table-dialog'); const g = document.querySelector('[data-testid=table-grid]'); const r = g ? g.getBoundingClientRect() : null; return d.open && !!r && r.width > 300 && r.height > 20; })()"));
  const rows5 = await t19Paste('유형\t이름\t설명\t속성\n업무\tT19 표 업무 1\t표로 넣은 첫 업무\t주기=월; 마감=5일\n업무\tT19 표 업무 2\t\t\n사람\tT19 가상 인물\t\t\n산출물\tT19 보고서\t\t\n조직\tT19 가상 조직\t\t');
  check('R-18 ④: 스프레드시트 탭 구분 글을 붙여 넣으면 머리글을 인식해 5행으로 들어감', rows5 === 5 && (await text(s.cdp, '[data-testid=table-note]')).includes('머리글'), `${rows5}행`);
  await shot(s.cdp, `${browser.name}-19a-table-add`);
  await evaluate(s.cdp, "window.__t19w = 0; window.__t19orig = Storage.prototype.setItem; Storage.prototype.setItem = function (...a) { window.__t19w += 1; return window.__t19orig.apply(this, a); };");
  await clickTestId(s.cdp, 'table-save');
  await sleep(400);
  const t19writes = await evaluate(s.cdp, 'window.__t19w');
  await evaluate(s.cdp, 'Storage.prototype.setItem = window.__t19orig');
  check('R-18 ①⑤: 저장 → 대화상자가 닫히고 노드 5개 추가, 이력 7건(생성 5+꼭지 연결 2), 저장소 쓰기 2회 이하(본문+목록)', !(await evaluate(s.cdp, "document.getElementById('table-dialog').open")) && (await t19Count()) === t19n0 + 5 && (await t19Events()) === t19e0 + 7 && t19writes >= 1 && t19writes <= 2, `노드 ${t19n0}→${await t19Count()}, 이력 ${t19e0}→${await t19Events()}, 쓰기 ${t19writes}`);
  check('R-18 ①: 새 노드가 그래프에 보이고 마지막 새 노드가 선택됨', (await hasLabel(s.cdp, 'T19 가상 조직')) && (await hasLabel(s.cdp, 'T19 표 업무 1')) && (await evaluate(s.cdp, "(window.__wu.view.getNode(window.__wu.selected || '') || {}).label")) === 'T19 가상 조직');
  check('R-18 ①: 안내 문구(추가·고침 개수)가 보임', (await text(s.cdp, '[data-testid=add-done]')).includes('5개를 추가하고 0개를 고쳤습니다'));

  // ③ 오류 행: 한 행이라도 문제면 아무것도 저장하지 않고 그 행과 사유 표시, 고치면 전부 저장
  const t19n1 = await t19Count();
  const t19e1 = await t19Events();
  await clickTestId(s.cdp, 'btn-table-add');
  await sleep(150);
  await t19Paste('업무\tT19 오류시험 가\n업무\t\n업무\tT19 표 업무 1\n없는유형\tT19 오류시험 다');
  await clickTestId(s.cdp, 'table-save');
  await sleep(300);
  const t19err = await evaluate(s.cdp, "[...document.querySelectorAll('[data-testid^=table-msg-]')].map((e) => e.textContent)");
  check('R-18 ③: 오류 행 3개(이름 빔·기존과 중복·모르는 유형)를 사유와 함께 표시하고 아무것도 저장하지 않음', (await t19Count()) === t19n1 && (await t19Events()) === t19e1 && t19err[0] === '' && t19err[1].includes('이름') && t19err[2].includes('같은 노드') && t19err[3].includes('알 수 없는 유형') && (await evaluate(s.cdp, "document.getElementById('table-dialog').open")), JSON.stringify(t19err));
  check('R-18 ③: 「아무것도 저장하지 않았습니다」 안내', (await text(s.cdp, '[data-testid=table-message]')).includes('아무것도 저장하지 않았습니다'));
  await shot(s.cdp, `${browser.name}-19b-table-error`);
  await evaluate(s.cdp, "(() => { const set = (i, k, v) => { document.querySelector('[data-testid=table-' + k + '-' + i + ']').value = v; }; set(1, 'label', 'T19 오류시험 나'); set(2, 'label', 'T19 오류시험 둘'); set(3, 'type', '주제'); set(3, 'label', 'T19 오류시험 다'); })()");
  await clickTestId(s.cdp, 'table-save');
  await sleep(400);
  check('R-18 ③: 고친 뒤 다시 저장하면 전부 저장됨(4개)', (await t19Count()) === t19n1 + 4 && !(await evaluate(s.cdp, "document.getElementById('table-dialog').open")), `${t19n1} → ${await t19Count()}`);

  // ② 표로 고치기: 바꾼 행만 수정 이력(변경 전·후), 표에 없는 속성은 남음
  const t19e2 = await t19Events();
  await clickTestId(s.cdp, 'btn-table-edit');
  await sleep(200);
  const t19edit = await evaluate(s.cdp, `(() => {
    const rows = [...document.querySelectorAll('[data-testid=table-grid] tbody tr:not(.row-msg-line)')];
    const row = rows.find((r) => r.querySelector('[data-col=label]').value === 'T19 표 업무 1');
    if (!row) return { missing: true, n: rows.length };
    row.querySelector('[data-col=description]').value = '표에서 고친 설명';
    row.querySelector('[data-col=attrs]').value = '마감=7일';
    return { n: rows.length, typeReadonly: row.querySelector('[data-col=type]').readOnly };
  })()`);
  await clickTestId(s.cdp, 'table-save');
  await sleep(400);
  const t19node = await evaluate(s.cdp, "(() => { const n = window.__wu.doc.nodes.find((x) => x.label === 'T19 표 업무 1'); const ev = window.__wu.doc.events.filter((e) => e.type === 'updated' && e.payload.target_id === n.id).pop(); return { d: n.description, attrs: n.attrs, before: ev && ev.payload.before.description, after: ev && ev.payload.after.description }; })()");
  check('R-18 ②: 표로 고치기 → 바꾼 행 하나만 수정 이력(전·후 값), 표에 없는 속성(주기)은 남고 유형 칸은 읽기 전용', !t19edit.missing && t19edit.typeReadonly && (await t19Events()) === t19e2 + 1 && t19node.d === '표에서 고친 설명' && t19node.attrs['주기'] === '월' && t19node.attrs['마감'] === '7일' && t19node.before === '표로 넣은 첫 업무' && t19node.after === '표에서 고친 설명', JSON.stringify({ t19edit, t19node }));

  // B-P4 긴 이름 여러 개를 연달아 넣어도 서로·기존 노드와 이름이 겹치지 않는다
  const longNames = Array.from({ length: 8 }, (_, i) => `T19 긴 이름 시험 카드사 가맹점 정산 대사 및 월말 마감 보고서 ${i + 1}`);
  await clickTestId(s.cdp, 'btn-table-add');
  await sleep(150);
  await t19Paste(longNames.map((n) => `업무\t${n}`).join('\n'));
  await clickTestId(s.cdp, 'table-save');
  await sleep(500);
  // 고른 노드는 이름이 크게 보이므로(R-17 ⑦) 겹침은 고르지 않은 상태의 이름 크기로 잰다
  await evaluate(s.cdp, 'window.__wu.select(null)');
  await sleep(300);
  const overlap = await evaluate(s.cdp, `(() => {
    const cy = window.__wu.cy;
    const names = ${JSON.stringify(longNames)};
    const boxes = names.map((n) => cy.nodes().filter((x) => x.data('label') === n)).map((c) => c.boundingBox({ includeLabels: true }));
    const hit = (a, b) => a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
    let pairs = 0;
    for (let i = 0; i < boxes.length; i += 1) for (let j = i + 1; j < boxes.length; j += 1) if (hit(boxes[i], boxes[j])) pairs += 1;
    const others = cy.nodes().filter((x) => !names.includes(x.data('label')));
    let withOthers = 0;
    for (const b of boxes) for (const o of others) { const p = o.position(); const r = 12; if (b.x1 < p.x + r && b.x2 > p.x - r && b.y1 < p.y + r && b.y2 > p.y - r) withOthers += 1; }
    return { pairs, withOthers, n: boxes.length };
  })()`);
  check('B-P4: 긴 이름 노드 8개를 한 번에 넣어도 서로 이름이 겹치지 않고 기존 노드 위에도 놓이지 않음', overlap.n === 8 && overlap.pairs === 0 && overlap.withOthers === 0, JSON.stringify(overlap));
  await shot(s.cdp, `${browser.name}-19c-long-names`);
  // ── 담당 이력 ↔ 수행 연결(조력자 의견 2026-10-12) + 이력 많을 때 접기 ──
  await evaluate(s.cdp, "window.__wu.select(null)");
  const a19Node = (label) => evaluate(s.cdp, `(window.__wu.view.nodes.find((n) => n.label === ${JSON.stringify(label)}) || {}).gid || ''`);
  const a19Edges = () => evaluate(s.cdp, "window.__wu.doc.edges.filter((e) => e.core_type === 'performs').length");
  const a19Person = await a19Node('T19 가상 인물');
  const a19Work = await a19Node('T19 표 업무 2');
  await evaluate(s.cdp, `window.__wu.select(${JSON.stringify(a19Work)})`);
  await sleep(150);
  await clickTestId(s.cdp, 'btn-event');
  const a19e0 = await a19Edges();
  const a19pid = a19Person.split('/')[1];
  await fillPanelForm(s.cdp, { 'event-type': 'assign_start', 'event-date': '2026-10-03' });
  await sleep(150);
  // 사람 칸을 채워야 하므로 먼저 필수값 오류가 나고 연결은 늘지 않는다
  const a19Missing = await panelMessage(s.cdp);
  check('담당 시작: 사람을 비우면 거부되고 수행 연결이 늘지 않음', !!a19Missing && a19Missing.code === 'E-REQUIRED' && (await a19Edges()) === a19e0, JSON.stringify(a19Missing));
  check('담당 시작·종료 양식에 「수행 연결도 함께」 안내가 보임', (await text(s.cdp, '[data-testid=assign-hint]')).includes('수행'));
  await evaluate(s.cdp, `(() => { const f = document.querySelector('[data-testid=event-form]'); const sel = [...f.querySelectorAll('select')]; const p = sel.find((x) => [...x.options].some((o) => o.value === ${JSON.stringify(a19pid)})); p.value = ${JSON.stringify(a19pid)}; f.querySelector('button[type=submit]').click(); })()`);
  await sleep(300);
  check('담당 시작 → 수행 연결이 시작일과 함께 생기고 업무 상세에 현재 담당으로 보임', (await a19Edges()) === a19e0 + 1 && (await evaluate(s.cdp, `window.__wu.doc.edges.some((e) => e.core_type === 'performs' && e.target === ${JSON.stringify(a19Work.split('/')[1])} && e.period && e.period.start === '2026-10-03' && !e.period.end)`)) && (await text(s.cdp, '[data-testid=work-load]')).includes('T19 가상 인물'), await text(s.cdp, '[data-testid=work-load]'));
  await clickTestId(s.cdp, 'btn-event');
  await sleep(100);
  await evaluate(s.cdp, `(() => { const f = document.querySelector('[data-testid=event-form]'); const t = f.querySelector('[data-testid=event-type]'); t.value = 'assign_start'; t.dispatchEvent(new Event('change')); f.querySelector('[data-testid=event-date]').value = '2026-10-04'; const p = [...f.querySelectorAll('select')].find((x) => [...x.options].some((o) => o.value === ${JSON.stringify(a19pid)})); p.value = ${JSON.stringify(a19pid)}; f.querySelector('button[type=submit]').click(); })()`);
  await sleep(250);
  const a19dup = await panelMessage(s.cdp);
  check('담당 시작: 이미 담당 중이면 E-DUP(이미 담당 중), 연결이 늘지 않음', !!a19dup && a19dup.code === 'E-DUP' && a19dup.text.includes('이미') && (await a19Edges()) === a19e0 + 1, JSON.stringify(a19dup));
  await evaluate(s.cdp, `(() => { const f = document.querySelector('[data-testid=event-form]'); const t = f.querySelector('[data-testid=event-type]'); t.value = 'assign_end'; t.dispatchEvent(new Event('change')); f.querySelector('[data-testid=event-date]').value = '2026-10-09'; const p = [...f.querySelectorAll('select')].find((x) => [...x.options].some((o) => o.value === ${JSON.stringify(a19pid)})); p.value = ${JSON.stringify(a19pid)}; f.querySelector('button[type=submit]').click(); })()`);
  await sleep(300);
  check('담당 종료 → 수행 연결에 끝 날짜가 채워지고 공백으로 바뀜', await evaluate(s.cdp, `window.__wu.doc.edges.some((e) => e.core_type === 'performs' && e.target === ${JSON.stringify(a19Work.split('/')[1])} && e.period && e.period.end === '2026-10-09')`));

  // 이력이 15건을 넘으면 최근 10건만 먼저 보이고 「모두 보기」로 폅니다
  await evaluate(s.cdp, "window.__wu.select('U-A1/N-001')");
  await sleep(150);
  for (let i = 0; i < 12; i += 1) {
    await clickTestId(s.cdp, 'btn-event');
    await fillPanelForm(s.cdp, { 'event-type': 'memo', 'event-date': `2026-10-0${(i % 9) + 1}`, 'event-note': `T19 이력 접기 시험 ${i + 1}` });
    await sleep(120);
  }
  const hist = await evaluate(s.cdp, "({ li: document.querySelectorAll('[data-testid=history] li').length, count: (document.querySelector('[data-testid=history-count]') || {}).textContent || '' })");
  check('이력 15건 초과 → 최근 10건만 보이고 「모두 보기(이전 N건)」 안내', hist.li === 10 && hist.count.includes('최근 10건') && hist.count.includes('모두 보기'), JSON.stringify(hist));
  await clickTestId(s.cdp, 'history-toggle');
  await sleep(100);
  const histAll = await evaluate(s.cdp, "document.querySelectorAll('[data-testid=history] li').length");
  check('「모두 보기」 → 전체 이력(10건보다 많음)이 보임', histAll > 15, String(histAll));

  // R-16 ①②: 상세 패널의 표준 양식 한 줄
  await evaluate(s.cdp, 'window.__wu.select(' + JSON.stringify('U-A1/N-003') + ')');
  await sleep(150);
  check('R-16 ② 권장 항목을 모두 채운 업무(보고)에는 표준 양식 알림이 없음', !(await evaluate(s.cdp, "!!document.querySelector('[data-testid=form-missing]')")));
  await evaluate(s.cdp, 'window.__wu.select(' + JSON.stringify(a19Work) + ')');
  await sleep(150);
  const formLine = await text(s.cdp, '[data-testid=form-missing]');
  check('R-16 ① 권장 항목이 빈 업무(표로 넣은 T19 표 업무 2)에는 「권장 항목 n개 비어 있음」과 빈 항목 이름이 보이고, 저장은 막지 않음', formLine.includes('권장 항목') && formLine.includes('절차') && formLine.includes('관련 문서'), formLine);

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
  if (await goBare(s.cdp)) {
    check('오류: 저장소 차단 시 시작 화면에도 경고가 보이고 새 유니버스는 막힘', (await text(s.cdp, '[data-testid=start-warning]')).includes('저장소를 쓸 수 없습니다') && (await evaluate(s.cdp, "document.querySelector('[data-testid=start-create]').disabled")));
  } else {
    check('오류: 저장소 차단 시 시작 화면에도 경고가 보이고 새 유니버스는 막힘', false, '시작 화면이 열리지 않음');
  }
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
