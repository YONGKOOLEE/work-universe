// T-01 브라우저 점검(P-1·P-3). 설치된 Chrome·Edge를 DevTools 프로토콜로 조종해
// dist/index.html을 file://로 열고, 네트워크를 막은 상태에서 흐름을 확인한다.
// 사용: npm run build && npm run check:browser
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { killOwnBrowsers, pickBrowsers } from './browsers.mjs';
import { SAMPLE_A1 } from '../app/data/sample-a1.js';
import { SAMPLES } from '../app/data/index.js';
import { readEmbedFromHtml, stripEmbed } from '../app/src/view/embed.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// PAGE를 주면 그 파일을 점검한다(T-15: 제출 압축을 푼 index.html)
const pageUrl = `${pathToFileURL(process.env.PAGE || join(root, 'dist/index.html')).href}?check`; // ?check: 점검용 전역(window.__wu)을 켠다
const tmp = process.env.CHECK_TMP || join(root, '.tmp/browser-check'); // 다른 작업과 겹치지 않게 임시 프로필 폴더·포트를 바꿀 수 있다(CHECK_TMP, CHECK_PORT)

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
    killOwnBrowsers(profileDir);
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
  // 「내려받기」를 누르는 점검이 사용자의 다운로드 폴더에 파일을 남기지 않게 점검용 프로필 안으로 보낸다
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: join(profileDir, 'downloads') });
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
// 화면 전체(열린 대화상자 포함)에서 글자가 정확히 "null"인 곳을 모은다(replaceChildren에 빈 값을 넘긴 실수. 검토7 U-1)
const nullTextSpots = (cdp) => evaluate(cdp, "(() => { const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); const out = []; while (w.nextNode()) if (w.currentNode.textContent.trim() === 'null') out.push(w.currentNode.parentElement.id || w.currentNode.parentElement.className || w.currentNode.parentElement.tagName); return out; })()");
const panelMessage = (cdp) => evaluate(cdp, "(() => { const m = document.querySelector('#detail [data-testid=form-message]'); return m ? { code: m.dataset.code || '', text: m.textContent } : null; })()");
const clickTestId = (cdp, id) => evaluate(cdp, `document.querySelector('[data-testid=${id}]').click()`);
// 머리글 「?」는 이제 도움말 상자를 연다(FU-9, 처음 사용 W2). 예전 「?」 동작(따라 하기 다시 보기)은 상자의 「따라 하기 다시 보기」 단추다
const openTourViaHelp = async (cdp) => { await clickTestId(cdp, 'tour-open'); await sleep(150); await clickTestId(cdp, 'help-tour'); };

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
  killOwnBrowsers(profile); // 앞선 점검이 멈춰 남긴 것만(-blocked 프로필 포함). 사용자 브라우저는 그대로
  await rm(profile, { recursive: true, force: true });
  const checks = [];
  const check = (name, pass, detail = '') => { checks.push({ name, pass: !!pass, detail }); if (process.env.CHECK_LIVE) console.log((pass ? 'PASS ' : 'FAIL ') + name + (pass ? '' : '  [' + detail + ']')); };
  const newLabel = `점검표 양식 ${Date.now() % 10000}`;

  // 1) 첫 실행: 표시 → 클릭 상세 → 추가 → 새로고침
  let s = await openSession(exe, profile, port);
  const version = s.version;
  check(`P-1 file:// 로드·그래프 표시(노드 ${NODES}, 연결 ${EDGES})`, s.ready && (await nodeCount(s.cdp)) === NODES && (await edgeCount(s.cdp)) === EDGES);

  // ── CR-13 A(2026-10-18) 「도구 더 보기」: 새 프로필은 기본 접힘(흐름 정렬·거르기·설명·속성까지가 보이지 않음), 펼치면 기억, 접으면 기억.
  //    아래 흐름 정렬·거르기·설명·속성까지 점검은 도구가 보여야 하므로(크기 확인) 이 단계가 끝나면 펼친 채로 둔다 ──
  const reloadReady = async () => {
    await evaluate(s.cdp, 'location.reload()').catch(() => {});
    await sleep(500);
    return waitFor(s.cdp, 'window.__wu && window.__wu.cy && window.__wu.cy.nodes().length > 0', 8000);
  };
  const visibleSize = (sel) => evaluate(s.cdp, `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; })()`);
  const toolsVisible = async () => ({ flow: await visibleSize('#flowlayout'), filter: await visibleSize('[data-testid=filter-open]') }); // 재검증 R-1: 「설명·속성까지」는 찾기 칸 옆이라 접히지 않는다(keepVisible)
  const keepVisible = async () => ({ find: await visibleSize('[data-testid=find-input]'), wide: await visibleSize('[data-testid=find-wide]'), relayout: await visibleSize('#relayout'), fit: await visibleSize('#fit'), time: await visibleSize('[data-testid=time-range]'), toggle: await visibleSize('#tools-toggle') });
  const toolState = async () => ({ ...(await toolsVisible()), open: await evaluate(s.cdp, 'window.__wu.toolsOpen'), aria: await evaluate(s.cdp, "document.getElementById('tools-toggle').getAttribute('aria-expanded')") });
  const t0 = await toolState();
  const keep0 = await keepVisible();
  check('CR-13 A 새 프로필: 「흐름 정렬」「거르기」는 기본 접힘(보이지 않음), 「도구 더 보기」는 보이고 aria-expanded=false', !t0.flow && !t0.filter && t0.open === false && t0.aria === 'false' && keep0.toggle, JSON.stringify(t0));
  check('CR-13 A 접혀 있어도 「노드 찾기」「설명·속성까지」「다시 정렬」「전체 보기」「시간 보기」 막대는 그대로 보임(크기 있음)', Object.values(keep0).every(Boolean), JSON.stringify(keep0));
  await shot(s.cdp, `${browser.name}-35-tools-collapsed`);
  await clickTestId(s.cdp, 'tools-toggle');
  await sleep(250);
  const t1 = await toolState();
  check('CR-13 A 「도구 더 보기」를 누르면 「흐름 정렬」「거르기」가 보임(크기 있음), aria-expanded=true', t1.flow && t1.filter && t1.open === true && t1.aria === 'true', JSON.stringify(t1));
  await shot(s.cdp, `${browser.name}-35b-tools-open`);
  const r1 = await reloadReady();
  const t2 = await toolState();
  check('CR-13 A 한 번 펼치면 설정에 기억: 다시 열어도 펼쳐 있음(settings.moreTools)', r1 && t2.flow && t2.filter && (await evaluate(s.cdp, "JSON.parse(localStorage.getItem('wu:v1:settings')).moreTools")) === true, JSON.stringify(t2));
  await clickTestId(s.cdp, 'tools-toggle');
  await sleep(200);
  await reloadReady();
  const t3 = await toolState();
  check('CR-13 A 접으면 그것도 기억: 다시 열어도 접혀 있고 설정에 필드가 없음', !t3.flow && !t3.filter && t3.open === false && (await evaluate(s.cdp, "JSON.parse(localStorage.getItem('wu:v1:settings')).moreTools")) === undefined, JSON.stringify(t3));
  // 깨진 값("yes")은 접힘
  await evaluate(s.cdp, "(() => { const v = JSON.parse(localStorage.getItem('wu:v1:settings') || '{}'); v.moreTools = 'yes'; localStorage.setItem('wu:v1:settings', JSON.stringify(v)); })()");
  await reloadReady();
  check('CR-13 A 설정 값이 깨져 있으면("yes") 접힘으로 열림', (await evaluate(s.cdp, 'window.__wu.toolsOpen')) === false && !(await visibleSize('#flowlayout')));
  await clickTestId(s.cdp, 'tools-toggle'); // 이 아래 점검을 위해 펼친 채로 둔다(저장됨)
  await sleep(200);
  await reloadReady();
  check('CR-13 A (이 아래 점검용) 펼친 상태가 저장되어 다시 열어도 펼쳐 있음', (await evaluate(s.cdp, 'window.__wu.toolsOpen')) === true && (await visibleSize('#flowlayout')));

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
  await flowShot('U-K1', 'k');
  const flowK1 = await evaluate(s.cdp, `(() => { const cy = window.__wu.cy; const ts = cy.nodes().filter((n) => n.data('core_type') === 'topic'); let dx = 0; let k = 0; ts.forEach((t) => { t.neighborhood('node').filter((m) => m.data('core_type') === 'work').forEach((w) => { dx += Math.abs(w.position().x - t.position().x); k += 1; }); }); return { k, dx }; })()`);
  check('흐름 정렬 U-K1(R7-1): 주제-업무 연결의 가로 거리 합이 개선 전(10800)의 절반 아래', flowK1.k > 0 && flowK1.dx < 5400, JSON.stringify(flowK1));
  await shot(s.cdp, `${browser.name}-20e-flow-U-K1`);
  await evaluate(s.cdp, "location.hash = 'U-A1'; location.reload()").catch(() => {});
  await sleep(600);
  await waitFor(s.cdp, "window.__wu && window.__wu.doc && window.__wu.doc.universe.id === 'U-A1' && window.__wu.cy.nodes().length > 0", 8000);
  // ── 일곱 번째 검토 화면 수정 확인(U-2·U-3·U-4·U-7). 데이터를 바꾸지 않는다 ──
  const escKey = async () => {
    await s.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await s.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(200);
  };
  const activeId = () => evaluate(s.cdp, "(document.activeElement && (document.activeElement.dataset.testid || document.activeElement.id)) || ''");
  await evaluate(s.cdp, "document.getElementById('flowlayout').click()");
  await sleep(300);
  const pressedOn = await evaluate(s.cdp, "document.getElementById('flowlayout').getAttribute('aria-pressed')");
  await evaluate(s.cdp, "document.getElementById('relayout').click()");
  await sleep(300);
  const pressedOff = await evaluate(s.cdp, "document.getElementById('flowlayout').getAttribute('aria-pressed')");
  check('U-7: 「흐름 정렬」을 누르면 눌림 표시(aria-pressed=true), 「다시 정렬」 뒤 풀림', pressedOn === 'true' && pressedOff === 'false', `${pressedOn}/${pressedOff}`);
  // U-3: 미해결·숨긴 노드 패널은 열면 「닫기」에 포커스, Esc로 닫히고 연 단추로 돌아감
  await evaluate(s.cdp, "window.__wu.select('U-A1/N-001')");
  await sleep(200);
  await evaluate(s.cdp, "document.querySelector('[data-testid=btn-issues]').focus(); document.querySelector('[data-testid=btn-issues]').click()");
  await sleep(250);
  const issueFocus = await activeId();
  await escKey();
  const issueClosed = await evaluate(s.cdp, "!document.querySelector('[data-testid=issue-panel]')");
  const issueBack = await activeId();
  check('U-3: 미해결 패널 — 열면 「닫기」에 포커스, Esc로 닫히고 「미해결 n건」 단추로 포커스가 돌아감', issueFocus === 'issue-close' && issueClosed && issueBack === 'btn-issues', `${issueFocus} → ${issueClosed} → ${issueBack}`);
  // U-4: 표 대화상자는 화면 폭에 맞춰 넓어진다(1280 창에서 900px보다 넓음)
  await evaluate(s.cdp, "window.__wu.select(null); document.querySelector('details.add').open = true");
  await sleep(150);
  await clickTestId(s.cdp, 'btn-table-add');
  await sleep(250);
  const tableW = await evaluate(s.cdp, "Math.round(document.getElementById('table-dialog').getBoundingClientRect().width)");
  check('U-4: 표 대화상자가 화면 폭에 맞춰 넓어짐(900px보다 넓음)', tableW > 1000, `${tableW}px`);
  await clickTestId(s.cdp, 'table-close');
  await sleep(150);
  // U-2: 묶은 화면(부서)의 「표로 고치기」는 빈 표·저장 대신 안내
  await evaluate(s.cdp, "location.hash = 'U-D1'; location.reload()").catch(() => {});
  await sleep(600);
  await waitFor(s.cdp, "window.__wu && window.__wu.doc && window.__wu.doc.universe.id === 'U-D1' && window.__wu.cy.nodes().length > 0", 8000);
  await evaluate(s.cdp, "document.querySelector('details.add').open = true");
  await sleep(150);
  await clickTestId(s.cdp, 'btn-table-edit');
  await sleep(250);
  const grouped = await evaluate(s.cdp, "({ text: document.getElementById('table-dialog').textContent, save: !!document.querySelector('#table-dialog [data-testid=table-save]') })");
  check('U-2: 묶은 화면의 「표로 고치기」는 각 유니버스를 열어 고치라는 안내만 보이고 저장 단추가 없음', grouped.text.includes('묶은') && !grouped.save, grouped.text.slice(0, 80));
  await shot(s.cdp, `${browser.name}-22a-grouped-table-edit`);
  await evaluate(s.cdp, "(document.querySelector('[data-testid=table-close]') || { click() {} }).click()");
  await evaluate(s.cdp, "location.hash = 'U-A1'; location.reload()").catch(() => {});
  await sleep(600);
  await waitFor(s.cdp, "window.__wu && window.__wu.doc && window.__wu.doc.universe.id === 'U-A1' && window.__wu.cy.nodes().length > 0", 8000);
  check('저장소 경고 배너 없음(정상 환경)', await evaluate(s.cdp, "document.getElementById('banner').hidden"));

  // 처음 화면: 유니버스 개요와 범례
  const summary = await text(s.cdp, '#detail');
  check('처음 화면: 유니버스 개요와 사용법 안내', summary.includes('월말 정산 점검') && summary.includes('항목을 클릭하면'), summary.slice(0, 60)); // CR-18-2
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
  check('노드를 고른 화면 전체(상세 패널 포함)에 "null" 글자 없음', (await nullTextSpots(s.cdp)).length === 0, (await nullTextSpots(s.cdp)).join(','));
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
  check('빈 곳 클릭 → 선택 해제, 개요로 복귀', (await evaluate(s.cdp, 'window.__wu.selected')) === null && (await text(s.cdp, '#detail')).includes('항목을 클릭하면')); // CR-18-2

  // 여섯 번째 검토 U-1: 업무 유형이면 사번 칸이 보이지 않는다(hidden 속성이 CSS에 지던 결함). 사람이면 보인다
  const empH = () => evaluate(s.cdp, "(() => { const e = document.querySelector('#add-slot [data-testid=node-empno]'); const f = e && e.closest('label, .field'); return f ? Math.round(f.getBoundingClientRect().height) : -1; })()");
  await evaluate(s.cdp, "(() => { const t = document.querySelector('#add-slot [data-testid=node-type]'); t.value = 'work'; t.dispatchEvent(new Event('change')); })()");
  const hWork = await empH();
  await evaluate(s.cdp, "(() => { const t = document.querySelector('#add-slot [data-testid=node-type]'); t.value = 'person'; t.dispatchEvent(new Event('change')); })()");
  const hPerson = await empH();
  await evaluate(s.cdp, "(() => { const t = document.querySelector('#add-slot [data-testid=node-type]'); t.value = 'work'; t.dispatchEvent(new Event('change')); })()");
  check('U-1: 사람·업무·문서 추가 양식 — 업무 유형이면 사번 칸 높이 0, 사람이면 보임', hWork === 0 && hPerson > 0, hWork + '/' + hPerson);
  check('U-14: 양식 칸 이름이 「이름」(「라벨」 아님)', (await text(s.cdp, '#add-slot')).includes('이름') && !(await text(s.cdp, '#add-slot')).includes('라벨'));
  const empty = await submitAdd(s.cdp, 'work', '   ');
  check('오류: 이름 누락 → E-REQUIRED, 받침에 맞는 조사(「이름을」)', empty.code === 'E-REQUIRED' && empty.text.includes('이름을 입력하세요'), empty.text);
  const dup = await submitAdd(s.cdp, 'work', '대사 확인');
  check('오류: 중복 → E-DUP + 기존 노드 링크', dup.code === 'E-DUP' && dup.text.includes('기존 항목 보기'), dup.text); // CR-18-2

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
  // 연결 오류: 주제가 업무를 수행할 수는 없다. 처음 사용 5회차(FU5-9)로 바뀜 — 예전에는 고른 「수행」이 남아 저장할 때 E-PAIR를 보였지만(이 조합에는 못 씀 묶음의 값이 골라진 채 남아 실무자가 오류를 봄),
  // 이제는 못 쓰는 보기는 고를 수 없다: 상대를 고르면 쓸 수 있는 첫 관계로 바꾸고 한 줄로 알리며, 못 쓰는 값을 넣어도(change) 되돌린다. E-PAIR 문구 자체는 단위 시험(tests/messages.test.js)이 본다
  await evaluate(s.cdp, "window.__wu.select('U-A1/N-030')");
  await clickTestId(s.cdp, 'btn-edge');
  const fu5Edges0 = await evaluate(s.cdp, 'window.__wu.doc.edges.length');
  const fu5Pair = await evaluate(s.cdp, `(() => {
    const f = document.querySelector('[data-testid=edge-form]'); const q = (id) => f.querySelector('[data-testid=' + id + ']');
    const set = (id, v) => { const e = q(id); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); };
    set('edge-type', 'performs'); set('edge-direction', 'out'); set('edge-other', 'N-001');
    const afterPick = { value: q('edge-type').value, hint: q('edge-only').hidden ? '' : q('edge-only').textContent, blocked: [...q('edge-type').querySelectorAll('optgroup option')].filter((o) => o.disabled).map((o) => o.value) };
    set('edge-type', 'performs'); // 스크립트로 못 쓰는 값을 다시 넣어도
    const forced = q('edge-type').value; const msg = f.querySelector('[data-testid=form-message]');
    return { afterPick, forced, err: msg ? msg.dataset.code || '' : '' };
  })()`);
  await sleep(150);
  check('FU5-9 연결 추가: 주제 → 업무에서 고른 「수행」은 못 쓰는 값이라 쓸 수 있는 관계(관련)로 바뀌고 알림 한 줄, 못 쓰는 묶음에 「수행」(disabled), 다시 넣어도 되돌아가며 오류 없음·저장 안 됨',
    fu5Pair.afterPick.value === 'relates_to' && fu5Pair.afterPick.hint.includes('「수행」은 이 조합에 쓸 수 없어 「관련」으로 바꿨습니다') && fu5Pair.afterPick.blocked.includes('performs') && fu5Pair.forced === 'relates_to' && fu5Pair.err === '' && (await evaluate(s.cdp, 'window.__wu.doc.edges.length')) === fu5Edges0, JSON.stringify(fu5Pair));
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
  // CR-18 D-14: 이력 목록은 이슈 메모에도 「[이슈]」 꼬리표가 붙는다(분류 없는 메모는 이슈로 본다)
  check('이력 추가(메모) → 이력 목록에 날짜·꼬리표와 함께 보임', (await text(s.cdp, '[data-testid=history]')).includes('2026-10-02메모[이슈] 점검 기준 변경 논의'), (await text(s.cdp, '[data-testid=history]')).slice(0, 200));
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
  check('R-15: 머리글 「설정」 단추에 지금 생성 방식(사전 생성)이 설명으로 붙음', (await text(s.cdp, '#settings-open')) === '설정' && (await evaluate(s.cdp, "document.getElementById('settings-open').getAttribute('title') || ''")).includes('사전 생성'));
  const pickProvider = async (name) => {
    await evaluate(s.cdp, "document.getElementById('settings-open').click()");
    await sleep(150);
    await evaluate(s.cdp, `(() => { const r = document.querySelector('[data-testid=provider-${name}]'); r.checked = true; r.dispatchEvent(new Event('change')); })()`);
    await sleep(100);
    await clickTestId(s.cdp, 'settings-close');
    await sleep(100);
  };
  await pickProvider('none');
  check('설정에서 「규칙 기반만」을 고르면 머리글 표시가 바뀌고 저장된다(12.4)', (await evaluate(s.cdp, "document.getElementById('settings-open').getAttribute('title') || ''")).includes('규칙 기반만') && (await evaluate(s.cdp, "JSON.parse(localStorage.getItem('wu:v1:settings')).provider")) === 'none');

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
  check('R-03 초안 11개 항목, "초안" 상태와 생성 방식(규칙 기반) 표시(R-03 ③, R-04 ②)', itemsCount === 11 && (await text(s.cdp, '[data-testid=draft-status]')) === '초안' && (await text(s.cdp, '[data-testid=draft-method]')).includes('규칙 기반'));
  // 검토5 I-1: 이전 인수인계는 E-002(+인수인계서)와 E-007(구두) 두 줄 → 근거 3개
  check('R-03 ① 항목에 근거 링크가 붙는다(관계자: 한가람, 이전 인수인계: 문서·구두 두 건)', (await text(s.cdp, '[data-testid=draft-item-관계자_연락처]')).includes('한가람') && (await evaluate(s.cdp, "document.querySelectorAll('[data-testid=draft-item-이전_인수인계] .evidence').length")) === 3 && (await text(s.cdp, '[data-testid=draft-item-이전_인수인계]')).includes('2026-09-30 윤바다 → 서하늘'));
  // N-5: 유니버스 전체가 대상이면 비교할 다른 업무가 없어 '해당 없음'(이력 부족과 구별). R-03 ② 이력 부족은 교육팀 신규 과정 단계에서 확인
  const simItem = await text(s.cdp, '[data-testid=draft-item-유사_경험자]');
  check('N-5·CR-17 B 유사 경험자: 지도 전체 대상이면 이전 담당 한가람이 「직접 해 봄」으로 먼저 나오고 이력 부족이 아님(해당 없음과 이력 부족의 구별은 단위 테스트 SE-2)', simItem.includes('한가람') && simItem.includes('직접 해 봄') && !simItem.includes('이력 부족'), simItem.slice(0, 120));
  check('숨긴 노드가 근거면 "숨김 처리된 항목"로 표시(점검표 양식을 숨긴 상태)', (await text(s.cdp, '[data-testid=draft-item-산출물_문서]')).includes('점검표 양식(숨김 처리된 항목)')); // CR-18-2
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
  check('R-04 ③: 실패 흉내 → 생성 방식 규칙 기반과 원인(호출 실패) 표시, 초안은 그대로 11개 항목', (await text(s.cdp, '[data-testid=draft-method]')).includes('규칙 기반') && (await text(s.cdp, '[data-testid=draft-fallback]')).includes('호출 실패') && (await evaluate(s.cdp, "document.querySelectorAll('[data-testid^=draft-item-]').length")) === 11);
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
  check('묶은 유니버스(팀)에서는 「사람·업무·문서 추가」를 강제로 펼치지 않는다(최종 검토)', await evaluate(s.cdp, "(() => { const d = document.querySelector('details.add'); d.open = false; window.__wu.select(null); return d.open === false; })()"));
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
  // 업무 지도 묶기: 먼저 하나만 고르면 거부된다
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
  check('업무 지도 묶기 → 새 팀 유니버스가 열리고 두 업무가 접혀 보임(18개)', (await evaluate(s.cdp, "window.__wu.doc.universe.name")) === '가상 점검팀' && (await nodeCount(s.cdp)) === 18);
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
  await evaluate(s.cdp, "(() => { const v = JSON.parse(localStorage.getItem('wu:v1:settings') || '{}'); delete v.lastOpenedId; delete v.tourDone; localStorage.setItem('wu:v1:settings', JSON.stringify(v)); })()"); // CR-18 D-1·D-2: 처음 열었을 때의 시작 화면을 재려고 「이어서 보기」·「따라 하기 했음」 기록을 지운다
  const onStart = await goBare(s.cdp);
  check('R-08 주소에 유니버스가 없으면(처음 더블클릭) 시작 화면이 열림', onStart);
  if (onStart) {
    const startText = await text(s.cdp, '#start-screen');
    // 눌러지는 것과 눈에 보이는 것은 다르다: 핵심 요소가 실제로 화면에 그려지는지(크기가 있는지) 확인한다
    check('R-08 시작 화면의 제목·설명·추천 버튼이 실제로 보임', await evaluate(s.cdp, "['.start-hero h1', '[data-testid=why-block]', '[data-testid=start-primary]', '[data-testid=start-create]'].every((q) => { const r = document.querySelector(q).getBoundingClientRect(); return r.width > 0 && r.height > 0; })"));
    check('R-08 시작 화면에 이게 무엇인지(CR-16 「왜」 덩어리: 전·후 한 줄) 설명과 가상 데이터 안내', startText.includes('담당자가 바뀌어도 끊기지 않는 업무 지도') && startText.includes('머릿속에서만 넘어가던 업무') && startText.includes('근거 달린 인수인계 초안') && startText.includes('모든 이름과 데이터는 가상'));
    check('R-08 "처음이라면 이 순서로" 4단계 안내', (await evaluate(s.cdp, "document.querySelectorAll('[data-testid=start-steps] li').length")) === 4);
    check(`샘플 카드 ${SAMPLES.length}개(내장 샘플 전부)와 추천(월말 정산) 표시, 내 업무 지도 안내`, (await evaluate(s.cdp, "document.querySelectorAll('[data-testid=start-samples] .card').length")) === SAMPLES.length && (await evaluate(s.cdp, "document.querySelector('[data-testid=card-U-A1]').classList.contains('recommended')")) && !!(await evaluate(s.cdp, "!!document.querySelector('[data-testid=start-mine], [data-testid=start-mine-empty]')")));
    // ── CR-16 ① 「왜」 덩어리(2026-10-23): 크기 있음·칸 3개, 1366×768에서 세 갈래 카드 첫 장이 첫 화면(768px) 안 ──
    const whyInfo = await evaluate(s.cdp, "(() => { const b = document.querySelector('[data-testid=why-block]'); if (!b) return null; const r = b.getBoundingClientRect(); const steps = [...document.querySelectorAll('[data-testid=why-step]')].map((e) => { const q = e.getBoundingClientRect(); return { w: q.width, h: q.height, left: q.left, top: q.top }; }); return { w: r.width, h: r.height, n: steps.length, steps, text: b.textContent }; })()");
    check('CR-16 ① 시작 화면 「왜」 덩어리가 그려지고(크기 있음) 칸(why-step)이 3개이며 각 칸도 크기가 있음', !!whyInfo && whyInfo.w > 0 && whyInfo.h > 0 && whyInfo.n === 3 && whyInfo.steps.every((q) => q.w > 0 && q.h > 0), JSON.stringify(whyInfo));
    check('CR-16 ① 「왜」 덩어리: 제목과 세 칸 글(전 → 기록이 쌓이는 업무 지도 → 근거 달린 초안·경고)이 있음', !!whyInfo && whyInfo.text.includes('담당자가 바뀌어도 끊기지 않는 업무 지도') && whyInfo.text.includes('담당자가 바뀔 때') && whyInfo.text.includes('기록이 쌓이는 업무 지도') && whyInfo.text.includes('혼자만 아는 업무 경고'), whyInfo && whyInfo.text);
    check('CR-16 ① 현재 창 너비(900 이상)에서는 세 칸이 한 줄(top이 같음), 왼쪽부터 순서대로', !!whyInfo && ((await evaluate(s.cdp, 'window.innerWidth')) < 900 || (whyInfo.steps.every((q) => Math.abs(q.top - whyInfo.steps[0].top) < 2) && whyInfo.steps[0].left < whyInfo.steps[1].left && whyInfo.steps[1].left < whyInfo.steps[2].left)), JSON.stringify(whyInfo && whyInfo.steps));
    await s.cdp.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
    await sleep(300);
    await evaluate(s.cdp, 'window.scrollTo(0, 0)');
    const whyFold = await evaluate(s.cdp, "(() => ['start-way-handover', 'start-way-mine', 'start-way-team'].map((id) => { const r = document.querySelector('[data-testid=' + id + ']').getBoundingClientRect(); return { id, top: Math.round(r.top), bottom: Math.round(r.bottom), w: Math.round(r.width) }; }))()");
    check('CR-16 ① 1366×768 시작 화면: 세 갈래 카드 세 장의 아래가 모두 768px 안(스크롤 없이 첫 화면)', whyFold.every((c) => c.w > 0 && c.bottom <= 768), JSON.stringify(whyFold));
    await shot(s.cdp, `${browser.name}-0b-start-why-1366`);
    await s.cdp.send('Emulation.clearDeviceMetricsOverride');
    await sleep(200);
    check('CR-16 ② 시작 화면 처음 보이는 글에 「유니버스」가 없음(단추 이름 「…」·접힌 「샘플·처음 순서 더 보기」 안은 제외)', await evaluate(s.cdp, "(() => { const c = document.getElementById('start-screen').cloneNode(true); c.querySelectorAll('button, summary, details, [data-testid=start-mine]').forEach((e) => e.remove()); return !c.textContent.replace(/「[^」]*」/g, '').includes('유니버스'); })()"));
    check('시작 화면에 "null" 글자 없음', await evaluate(s.cdp, "(() => { const w = document.createTreeWalker(document.getElementById('start-screen'), NodeFilter.SHOW_TEXT); while (w.nextNode()) if (w.currentNode.textContent.trim() === 'null') return false; return true; })()"));
    await evaluate(s.cdp, 'window.scrollTo(0, 0)');
    await shot(s.cdp, `${browser.name}-0-start`);
    // ── 처음 사용 W2(2026-10-24, FU-4·FU-11 일부): 「왜」 셋째 칸에 AI가 하는 일, 팀 카드 아래 한 줄. 높이는 위 whyFold(1366×768에서 잰 값)로 확인 ──
    const w2Start = await evaluate(s.cdp, "(() => { const steps = [...document.querySelectorAll('[data-testid=why-step]')]; const n = document.querySelector('[data-testid=start-way-team-note]'); const r = n ? n.getBoundingClientRect() : { width: 0, height: 0 }; return { third: steps[2] ? steps[2].textContent : '', hasAi: steps[2] ? /AI/.test(steps[2].textContent) : false, note: n ? n.textContent : null, noteSize: r.width > 0 && r.height > 0, noteInTeam: !!(n && n.closest('[data-testid=start-way-team]')), noteFont: n ? getComputedStyle(n).fontSize : '' }; })()");
    check('처음 사용 W2(FU-4) 「왜」 덩어리 셋째 칸에 「AI」 글자: 머리(근거 달린 인수인계 초안 · 혼자만 아는 업무 경고)는 그대로, 본문 「AI가 기록만 보고 쓰고, 앱이 근거를 검사합니다」', w2Start.hasAi && w2Start.third.includes('근거 달린 인수인계 초안 · 혼자만 아는 업무 경고') && w2Start.third.includes('AI가 기록만 보고 쓰고, 앱이 근거를 검사합니다'), w2Start.third);
    check('처음 사용 W2(FU-4) 1366×768에서 「AI」 본문을 넣은 뒤에도 세 갈래 카드 세 장의 아래가 모두 768px 안(CR-16 whyFold와 같은 측정)', whyFold.length === 3 && whyFold.every((c) => c.w > 0 && c.bottom <= 768), JSON.stringify(whyFold));
    check('처음 사용 W2(FU-11) 「팀 업무를 한눈에 보고 싶어요」 카드 안(설명 아래)에 작은 글씨 안내 「팀원 각자 만든 지도는 공유 폴더(「폴더 연결」)나 「가져오기」로 모아 묶습니다」가 보임(크기 있음, 12px)', w2Start.note === '팀원 각자 만든 지도는 공유 폴더(「폴더 연결」)나 「가져오기」로 모아 묶습니다' && w2Start.noteSize && w2Start.noteInTeam && w2Start.noteFont === '12px', JSON.stringify(w2Start));
    // ── CR-13 A(2026-10-18) 시작 화면 세 갈래 + 앱 안 따라 하기 ──
    // 바꾼 이유: 예전에는 「샘플 바로 열기」(start-primary)로 R-08 "첫 화면에서 탐색을 시작할 수 있음"을 확인했다. 이제 첫 화면의 중심은
    // 「무엇을 하고 싶어요?」 세 갈래 카드라서 R-08은 카드로 확인하고, 「샘플 바로 열기」는 따라 하기 없이 열리는 별도 점검으로 남긴다.
    const cardInfo = await evaluate(s.cdp, "(() => { const ids = ['start-way-handover', 'start-way-mine', 'start-way-team']; return ids.map((id) => { const e = document.querySelector('[data-testid=' + id + ']'); if (!e) return null; const r = e.getBoundingClientRect(); return { w: r.width > 0 && r.height > 0, text: e.textContent }; }); })()");
    check('CR-13 A 시작 화면에 「무엇을 하고 싶어요?」 세 갈래 카드(인수인계를 앞두고 있어요·내 업무를 정리해 두고 싶어요·팀 업무를 한눈에 보고 싶어요)가 실제로 보임(크기 있음)', cardInfo.every((c) => c && c.w) && cardInfo[0].text.includes('인수인계를 앞두고 있어요') && cardInfo[0].text.includes('넘기는 쪽도 받는 쪽도 — 예시 업무로 인수인계 초안을 봅니다(3분)') && cardInfo[1].text.includes('내 업무를 정리해 두고 싶어요') && cardInfo[1].text.includes('업무 하나부터 작은 지도를 만듭니다') && cardInfo[2].text.includes('팀 업무를 한눈에 보고 싶어요') && cardInfo[2].text.includes('여러 업무를 묶은 팀·부서 지도를 봅니다'), JSON.stringify(cardInfo));
    const smallInfo = await evaluate(s.cdp, "({ more: document.querySelector('[data-testid=start-more]').open, stepsVisible: document.querySelector('[data-testid=start-steps]').checkVisibility(), samplesVisible: document.querySelector('[data-testid=start-samples]').checkVisibility(), primary: document.querySelector('[data-testid=start-primary]').textContent, mine: !!document.querySelector('[data-testid=start-mine], [data-testid=start-mine-empty]') })");
    check('CR-13 A 「처음이라면 이 순서로」와 샘플 카드 7개는 「샘플·처음 순서 더 보기」 안에 기본 접힘, 「샘플 바로 열기: 월말 정산 점검」·내 업무 지도는 그대로 보임', smallInfo.more === false && !smallInfo.stepsVisible && !smallInfo.samplesVisible && smallInfo.primary === '샘플 바로 열기: 월말 정산 점검' && smallInfo.mine, JSON.stringify(smallInfo));
    // 쉬운 말: 세 갈래 카드 문구에 유니버스·노드·꼭지가 없다
    check('CR-13 A 세 갈래 카드에는 어려운 낱말(유니버스·노드·꼭지)을 쓰지 않음', cardInfo.every((c) => !/유니버스|노드|꼭지/.test(c.text)));
    await evaluate(s.cdp, "(() => { const v = JSON.parse(localStorage.getItem('wu:v1:settings') || '{}'); delete v.moreTools; localStorage.setItem('wu:v1:settings', JSON.stringify(v)); })()"); // 끝 카드의 「도구 더 보기」 안내를 보려고 접힘으로(이 아래에서 다시 펼침)
    // 재검증 N-7: 작은 단추는 강조(primary)가 아니고 세 갈래 카드가 강조되며, 접힘 제목은 「샘플·처음 순서 더 보기」
    const emph = await evaluate(s.cdp, "(() => { const b = document.querySelector('[data-testid=start-primary]'); const w = document.querySelector('[data-testid=start-way-handover]'); const cs = getComputedStyle(b); const wc = getComputedStyle(w); return { primaryClass: b.classList.contains('primary'), btnBg: cs.backgroundColor, wayBorder: wc.borderTopColor, wayBorderW: wc.borderTopWidth, wayBg: wc.backgroundColor, summary: document.querySelector('[data-testid=start-more] > summary').textContent, accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() }; })()");
    check('N-7 시작 화면: 작은 단추 「샘플 바로 열기」는 primary(초록 채움)가 아니고, 세 갈래 카드는 accent 테두리(2px)·배경이 있으며, 접힘 제목이 「샘플·처음 순서 더 보기」', !emph.primaryClass && emph.btnBg !== 'rgb(166, 216, 107)' && emph.wayBorder === 'rgb(166, 216, 107)' && emph.wayBorderW === '2px' && emph.wayBg !== 'rgba(0, 0, 0, 0)' && emph.summary === '샘플·처음 순서 더 보기', JSON.stringify(emph));
    await shot(s.cdp, `${browser.name}-34a-start-emphasis`);
    // 재검증 N-3: 「새 업무 지도 만들기」 대화상자는 두 모양. 작은 단추 = 예전 모양, 「내 업무를 정리해 두고 싶어요」 = 「내 업무 지도 만들기」
    const dlgInfo = () => evaluate(s.cdp, `(() => { const d = document.getElementById('create-dialog'); const v = (id) => { const e = document.getElementById(id); const r = e.getBoundingClientRect(); return e.checkVisibility() && r.width > 0 && r.height > 0; }; const pos = (a, b) => !!(document.getElementById(a).compareDocumentPosition(document.getElementById(b)) & Node.DOCUMENT_POSITION_FOLLOWING); const info = document.getElementById('create-info'); return { open: d.open, title: document.getElementById('create-title').textContent, work: v('create-start-work'), name: v('create-name'), level: v('create-level'), owner: v('create-owner'), infoHidden: info.hidden, infoOpen: info.open, summary: info.querySelector('summary').textContent, starterBeforeMeta: pos('create-start-work', 'create-name'), metaInInfo: info.contains(document.getElementById('create-name')), focus: document.activeElement && document.activeElement.id }; })()`);
    await evaluate(s.cdp, "document.querySelector('[data-testid=start-create]').click()");
    await sleep(250);
    const dNormal = await dlgInfo();
    check('N-3 기존 「새 업무 지도 만들기」(시작 화면 작은 단추)는 예전 모양: 제목, 이름·단위·작성 주체가 보이고 첫 업무 칸 위에 있으며 「지도 정보」 접힘 상자 없음', dNormal.open && dNormal.title === '새 업무 지도 만들기' && dNormal.name && dNormal.level && dNormal.owner && dNormal.work && !dNormal.starterBeforeMeta && dNormal.infoHidden && !dNormal.metaInInfo, JSON.stringify(dNormal));
    await evaluate(s.cdp, "document.getElementById('create-cancel').click()");
    await sleep(150);
    await evaluate(s.cdp, "document.querySelector('[data-testid=start-way-mine]').click()");
    await sleep(250);
    const dMine = await dlgInfo();
    check('N-3 「내 업무를 정리해 두고 싶어요」 → 「내 업무 지도 만들기」: 첫 업무 칸이 맨 위(보임), 이름·단위·작성 주체는 접힌 「지도 정보(비우면 자동으로 채움)」 안(안 보임), 초점은 업무 이름 칸', dMine.open && dMine.title === '내 업무 지도 만들기' && dMine.work && !dMine.name && !dMine.level && !dMine.owner && !dMine.infoHidden && !dMine.infoOpen && dMine.summary === '지도 정보(비우면 자동으로 채움)' && dMine.starterBeforeMeta && dMine.metaInInfo && dMine.focus === 'create-start-work', JSON.stringify(dMine));
    await shot(s.cdp, `${browser.name}-34b-mine-dialog`);
    // 업무 이름이 비면 막고 그 칸에 초점, 담당자만 적어도 마찬가지
    await evaluate(s.cdp, "(() => { document.getElementById('create-start-person').value = '김가상'; document.querySelector('#create-form button[type=submit]').click(); })()");
    await sleep(200);
    const mineErr = await evaluate(s.cdp, "({ code: document.getElementById('create-message').dataset.code, msg: document.getElementById('create-message').textContent, focus: document.activeElement && document.activeElement.id, open: document.getElementById('create-dialog').open })");
    check('N-3 내 업무 모드에서 업무 이름을 비우면 만들지 않고 안내하며 업무 이름 칸에 초점', mineErr.code === 'mine-work-required' && mineErr.msg.includes('업무 이름') && mineErr.focus === 'create-start-work' && mineErr.open, JSON.stringify(mineErr));
    await evaluate(s.cdp, "document.getElementById('create-cancel').click()");
    await sleep(150);
    await evaluate(s.cdp, "document.querySelector('[data-testid=start-create]').click()");
    await sleep(250);
    const dNormal2 = await dlgInfo();
    check('N-3 내 업무 모드를 닫고 다시 「새 업무 지도 만들기」를 열면 예전 모양으로 돌아옴(입력도 비어 있음)', dNormal2.title === '새 업무 지도 만들기' && dNormal2.name && !dNormal2.starterBeforeMeta && dNormal2.infoHidden && (await evaluate(s.cdp, "document.getElementById('create-start-person').value")) === '', JSON.stringify(dNormal2));
    // 어느 모드든 오류가 나면 해당 칸에 초점: 새 업무 지도(예전 모양)에서 이름이 비면 이름 칸
    await evaluate(s.cdp, "document.querySelector('#create-form button[type=submit]').click()");
    await sleep(200);
    check('N-3 기존 모양에서도 오류가 나면 해당 칸(이름)에 초점', (await evaluate(s.cdp, "document.activeElement && document.activeElement.id")) === 'create-name' && (await evaluate(s.cdp, "document.getElementById('create-message').dataset.code")) === 'E-REQUIRED');
    await evaluate(s.cdp, "document.getElementById('create-cancel').click()");
    await sleep(150);

    const tourInfo = () => evaluate(s.cdp, 'window.__wu.tour');
    const nameOnScreen = (name) => evaluate(s.cdp, `(() => { const n = ${JSON.stringify(name)}; const box = document.createElement('div'); for (const q of ['header', 'main']) { const c = document.querySelector(q).cloneNode(true); const slot = c.querySelector('#tour-slot'); if (slot) slot.remove(); box.append(c); } if (box.textContent.includes(n)) return true; if ([...document.querySelectorAll('[aria-label],[placeholder]')].some((e) => (e.getAttribute('aria-label') || '').includes(n) || (e.getAttribute('placeholder') || '').includes(n))) return true; return window.__wu.cy.nodes().some((x) => x.data('label') === n); })()`);
    // 지금 단계 문구의 「…」 이름이 실제 화면에 있는지(「다음」은 따라 하기 카드의 단추)
    const stepNamesOk = async () => {
      const t = await text(s.cdp, '[data-testid=tour-task]');
      const names = [...t.matchAll(/「([^」]+)」/g)].map((m) => m[1]);
      const missing = [];
      for (const n of names) {
        const ok = n === '다음' ? await evaluate(s.cdp, "!!document.querySelector('[data-testid=tour-next]')") : await nameOnScreen(n);
        if (!ok) missing.push(n);
      }
      return { names, missing };
    };
    const blankClick = async () => {
      const b = await evaluate(s.cdp, "(() => { const r = document.getElementById('graph').getBoundingClientRect(); return { x: r.left + 12, y: r.top + 12 }; })()");
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) { await s.cdp.send('Input.dispatchMouseEvent', { type, x: b.x, y: b.y, button: 'left', clickCount: 1 }); await sleep(30); }
      await sleep(250);
    };
    // 깜빡임은 꺼진 순간이 있으므로, 짚은 노드는 잠시 지켜보며 한 번이라도 켜진 것을 센다
    const blinkIds = async () => { for (let i = 0; i < 12; i += 1) { const ids = await evaluate(s.cdp, "window.__wu.cy.nodes('.tour-target').map((n) => n.id())"); if (ids.length) return ids; await sleep(150); } return []; };
    const tourMarks = () => evaluate(s.cdp, "({ dom: document.querySelectorAll('.tour-target').length, cy: window.__wu.cy.nodes('.tour-target').length })");
    const hashClean = () => evaluate(s.cdp, "!location.hash.includes('tour')");
    const hasNext = () => evaluate(s.cdp, "!!document.querySelector('[data-testid=tour-next]')");

    // 갈래 a: 인수인계 → 월말 정산(U-A1)이 열리고 따라 하기 1/4
    await evaluate(s.cdp, "(() => { const v = JSON.parse(localStorage.getItem('wu:v1:settings') || '{}'); delete v.tourDone; localStorage.setItem('wu:v1:settings', JSON.stringify(v)); })()"); // CR-18 D-2: 앞 점검에서 끝낸·건너뛴 기록이 있으면 카드로 들어가도 따라 하기가 뜨지 않으므로 지운다
    await evaluate(s.cdp, "document.querySelector('[data-testid=start-way-handover]').click()");
    await sleep(500);
    const opened = await waitFor(s.cdp, "window.__wu && window.__wu.doc && window.__wu.doc.universe.id === 'U-A1' && window.__wu.cy.nodes().length > 0", 8000);
    check('R-08 첫 화면의 세 갈래 카드 「인수인계를 앞두고 있어요」 한 번으로 월말 정산이 열려 탐색이 시작됨(CR-13 A로 확인 방법 변경)', opened);
    await sleep(400);
    let ti = await tourInfo();
    check('CR-13 A 갈래 a → 따라 하기 1/5 카드: 이야기 한 줄(윤바다가 9월 말 서하늘에게…, FU-27), 할 일 한 줄, 「건너뛰기」, 읽기 단계가 아니라 「다음」 없음, 주소의 ~tour 표시는 지워짐', !!ti && ti.mode === 'step' && ti.scenario === 'handover' && ti.index === 0 && (await text(s.cdp, '[data-testid=tour-count]')) === '따라 하기 1/5' && (await text(s.cdp, '[data-testid=tour-story]')).includes('윤바다가 9월 말 서하늘에게 월말 정산을 넘겼습니다') && (await text(s.cdp, '[data-testid=tour-task]')).includes('대사 확인') && (await text(s.cdp, '[data-testid=tour-skip]')) === '건너뛰기' && !(await hasNext()) && (await hashClean()), JSON.stringify(ti));
    const sn1 = await stepNamesOk();
    check('CR-13 A 1단계 문구의 「」 이름(대사 확인)이 실제 화면에 있고, 깜빡이는 대상은 그래프의 「대사 확인」 노드', sn1.missing.length === 0 && sn1.names.length >= 1 && (await blinkIds()).join() === 'U-A1/N-001', JSON.stringify(sn1));
    await shot(s.cdp, `${browser.name}-36a-tour-handover-1`);
    // 행동 없이 다른 노드를 누르면 진행하지 않는다(완료 조건은 「대사 확인」 선택)
    await clickNode(s.cdp, 'U-A1/N-002');
    check('CR-13 A 1단계: 다른 노드(자료 수집)를 누르면 진행하지 않음', (await tourInfo()).index === 0);
    await clickNode(s.cdp, 'U-A1/N-001');
    ti = await tourInfo();
    check('CR-13 A 1단계 → 「대사 확인」을 실제로 누르면 2/5, 읽기 단계라 「다음」이 보임', ti.index === 1 && (await text(s.cdp, '[data-testid=tour-count]')) === '따라 하기 2/5' && (await hasNext()), JSON.stringify(ti));
    const sn2 = await stepNamesOk();
    check('CR-13 A 2단계 문구의 「」 이름(미해결·다음)이 실제 화면에 있음', sn2.missing.length === 0 && sn2.names.includes('미해결') && sn2.names.includes('다음'), JSON.stringify(sn2));
    await shot(s.cdp, `${browser.name}-36b-tour-handover-2`);
    // 재검증 N-6: 선택을 풀면(Esc) 보조 문구 「대사 확인」을 다시 누르면 이력이 보입니다(그 노드를 다시 짚음), 다시 고르면 사라짐
    const subText = () => evaluate(s.cdp, "(() => { const e = document.querySelector('[data-testid=tour-sub]'); return e && !e.hidden ? e.textContent : null; })()");
    check('N-6 handover 2단계: 「대사 확인」을 고른 상태에서는 보조 문구가 없고 문구에 「오른쪽을 아래로 내려」가 있음', (await subText()) === null && (await text(s.cdp, '[data-testid=tour-task]')).includes('오른쪽을 아래로 내려'));
    await evaluate(s.cdp, "window.__wu.select(null)");
    await sleep(300);
    check('N-6 handover 2단계에서 선택을 풀면 보조 문구 「대사 확인」을 다시 누르면 이력이 보입니다가 보이고, 깜빡이는 대상이 그래프의 「대사 확인」, 단계는 그대로(2/4)', (await subText()) === '「대사 확인」을 다시 누르면 이력이 보입니다' && (await blinkIds()).join() === 'U-A1/N-001' && (await tourInfo()).index === 1);
    await shot(s.cdp, `${browser.name}-36b2-tour-handover-2-deselected`);
    await clickNode(s.cdp, 'U-A1/N-001');
    await sleep(300);
    check('N-6 「대사 확인」을 다시 누르면 보조 문구가 사라지고 2단계 그대로', (await subText()) === null && (await tourInfo()).index === 1);
    // 재검증 N-4·N-5: 카드는 「패널 넓게 보기」를 가리지 않고(간격 8px 이상), 패널을 내려도 카드 위에 틈이 없어 뒤 내용이 비치거나 눌리지 않는다
    await s.cdp.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
    await sleep(400);
    const cardGap = await evaluate(s.cdp, "(() => { const c = document.getElementById('tour-slot').getBoundingClientRect(); const w = document.getElementById('wide-toggle').getBoundingClientRect(); return { cardBottom: c.bottom, wideTop: w.top, gap: w.top - c.bottom }; })()");
    check('N-4 따라 하기 카드와 「패널 넓게 보기」가 겹치지 않고 간격이 8px 이상', cardGap.gap >= 8, JSON.stringify(cardGap));
    const peek = await evaluate(s.cdp, "(() => { const a = document.querySelector('aside'); a.scrollTop = 160; const ar = a.getBoundingClientRect(); const c = document.getElementById('tour-slot').getBoundingClientRect(); const x = c.left + 20; const hits = [ar.top + 1, ar.top + 8, ar.top + 15].map((y) => { const e = document.elementFromPoint(x, y); return !!(e && document.getElementById('tour-slot').contains(e)); }); return { scrolled: a.scrollTop, cardTopGap: c.top - ar.top, hits }; })()");
    await shot(s.cdp, `${browser.name}-36b3-tour-card-scrolled`);
    check('N-5 패널을 아래로 내려도 카드가 패널 맨 위에 붙어 있고(틈 0), 카드 위쪽 16px 안의 어느 점을 눌러도 카드(뒤 내용이 아님)', peek.scrolled > 0 && Math.abs(peek.cardTopGap) <= 1 && peek.hits.every(Boolean), JSON.stringify(peek));
    await evaluate(s.cdp, "document.querySelector('aside').scrollTop = 0");
    await s.cdp.send('Emulation.clearDeviceMetricsOverride');
    await evaluate(s.cdp, "document.querySelector('[data-testid=tour-next]').click()");
    await sleep(250);
    ti = await tourInfo();
    check('CR-13 A 「다음」 → 3/5(초안 만들기), 「다음」 단추는 사라짐', ti.index === 2 && (await text(s.cdp, '[data-testid=tour-count]')) === '따라 하기 3/5' && !(await hasNext()), JSON.stringify(ti));
    const sn3 = await stepNamesOk();
    check('CR-13 A 3단계 문구의 「」 이름(인수인계 초안 만들기·초안 만들기)이 실제 화면에 있음', sn3.missing.length === 0 && sn3.names.length >= 2, JSON.stringify(sn3));
    // 재검증 N-2: 「빈 곳을 누르세요」 단계에서는 그래프 안쪽 아래 가운데에 표지가 보이고(크기 있음, 눌림을 막지 않음), 테두리는 안쪽(음수 오프셋)
    const hintInfo = () => evaluate(s.cdp, "(() => { const h = document.querySelector('[data-testid=tour-blank-hint]'); const g = document.getElementById('graph'); if (!h) return null; const r = h.getBoundingClientRect(); const gr = g.getBoundingClientRect(); const cs = getComputedStyle(h); const gs = getComputedStyle(g); return { text: h.textContent, w: r.width, h: r.height, inside: r.left >= gr.left && r.right <= gr.right && r.top >= gr.top && r.bottom <= gr.bottom, centerOff: Math.abs((r.left + r.right) / 2 - (gr.left + gr.right) / 2), nearBottom: gr.bottom - r.bottom < 60, noPointer: cs.pointerEvents === 'none', anim: cs.animationName, graphInset: g.classList.contains('tour-target') && g.classList.contains('tour-inset') && gs.outlineOffset.startsWith('-'), onTop: document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2) === g || g.contains(document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2)) }; })()");
    // 처음 사용 점검 2회차 FU-26: 3단계는 「빈 곳을 누르고」 없이 오른쪽 상세의 「인수인계 초안 만들기」 단추(btn-draft)를 짚는다. 「빈 곳」 표지(N-2)는 team 5단계·handover 5단계에서 확인한다
    const hi3 = await hintInfo();
    check('처음 사용 W4(FU-26) handover 3단계(「대사 확인」을 고른 상태): 문구가 「오른쪽의 「인수인계 초안 만들기」를 누른 뒤 「초안 만들기」를 누르세요.」이고 「빈 곳」 표지는 없으며, 깜빡이는 대상은 상세의 「인수인계 초안 만들기」 단추', hi3 === null && (await text(s.cdp, '[data-testid=tour-task]')) === '오른쪽의 「인수인계 초안 만들기」를 누른 뒤 「초안 만들기」를 누르세요.' && (await evaluate(s.cdp, "document.querySelector('[data-testid=btn-draft]').classList.contains('tour-target')")), JSON.stringify(hi3));
    await shot(s.cdp, `${browser.name}-36b4-tour-draft-button`);
    await evaluate(s.cdp, "document.querySelector('[data-testid=btn-draft]').click()");
    await sleep(300);
    const preset = await evaluate(s.cdp, "({ target: document.querySelector('[data-testid=draft-target]').selectedOptions[0].textContent, from: document.querySelector('[data-testid=draft-from]').selectedOptions[0].textContent, to: document.querySelector('[data-testid=draft-to]').selectedOptions[0].textContent })");
    check('CR-13 A 3단계 초안 화면: 대상 월말 정산 점검(지도 전체, FU-2)·보내는 사람 윤바다·받는 사람 서하늘이 미리 골라져 있고, 화면만 열어서는 진행하지 않음', preset.target === '월말 정산 점검' && preset.from === '윤바다' && preset.to === '서하늘' && (await tourInfo()).index === 2, JSON.stringify(preset));
    await shot(s.cdp, `${browser.name}-36c-tour-handover-3`);
    await evaluate(s.cdp, "document.querySelector('[data-testid=draft-form] button[type=submit]').click()");
    await sleep(400);
    ti = await tourInfo();
    check('CR-13 A 「초안 만들기」로 초안 결과가 그려지면 4/5(근거 칩)', ti.index === 3 && (await text(s.cdp, '[data-testid=tour-count]')) === '따라 하기 4/5' && (await evaluate(s.cdp, "document.querySelectorAll('.draft .evidence').length")) > 5, JSON.stringify(ti));
    const chips3 = await evaluate(s.cdp, "[...document.querySelectorAll('.draft [data-testid=item-method]')].map((c) => c.textContent)");
    // 앞 블록들이 샘플을 고쳐 둔 상태라 근거가 바뀐 몇 항목은 사전 생성 문장이 낡았다고 판정돼 규칙 기반이 된다(의도된 검증). 깨끗한 샘플에서 전부 사전 생성인 것은 단위 테스트(first-use-w1)가 본다
    const target3 = await evaluate(s.cdp, "(document.querySelector('[data-testid=draft-target]') || {}).value");
    check('처음 사용 W1(FU-2) 따라 하기 끝 초안: 대상이 지도 전체(월말 정산 점검)로 잡히고 「사전 생성」 칩이 대부분, 「이 조합에는 미리 써 둔 문장이 없어」 안내(draft-rule-reason)는 없음', target3 === 'U-A1/N-000' && chips3.length >= 6 && chips3.filter((t) => t === '사전 생성').length >= 5 && !(await evaluate(s.cdp, "!!document.querySelector('[data-testid=draft-rule-reason]')")), JSON.stringify({ target3, chips3 }));
    const sn4 = await stepNamesOk();
    check('CR-13 A 4단계 문구의 「」 이름(근거:)이 실제 화면에 있고, 깜빡이는 대상은 근거 칩', sn4.missing.length === 0 && (await evaluate(s.cdp, "document.querySelector('.draft .evidence').classList.contains('tour-target')")), JSON.stringify(sn4));
    await shot(s.cdp, `${browser.name}-36d-tour-handover-4`);
    await evaluate(s.cdp, "document.querySelector('.draft .evidence').click()");
    await sleep(400);
    ti = await tourInfo();
    check('R9-1 근거 칩을 누르면 5/5(직접 고쳐 보고 되감기), 끝 카드는 아직', ti.mode !== 'end' && ti.index === 4 && (await text(s.cdp, '[data-testid=tour-count]')) === '따라 하기 5/5', JSON.stringify(ti));
    // 처음 사용 3회차(W6): 5/5 본문은 한두 줄, 세부 순서는 보조 문구로
    const w6Tour = { task: await text(s.cdp, '[data-testid=tour-task]'), sub: await text(s.cdp, '[data-testid=tour-sub]') };
    check('처음 사용 W6 따라 하기 5/5 본문이 짧다: 「(연습, 건너뛰어도 됩니다) 「대사 확인」의 설명을 조금 고쳐 저장한 뒤, 「편집 되감기」로 고치기 전 지도를 봅니다.」, 세부 순서(수정·글자 하나·저장·빈 곳)는 보조 문구', w6Tour.task === '(연습, 건너뛰어도 됩니다) 「대사 확인」의 설명을 조금 고쳐 저장한 뒤, 「편집 되감기」로 고치기 전 지도를 봅니다.' && w6Tour.task.length <= 80 && w6Tour.sub.startsWith('순서:') && w6Tour.sub.includes('글자 하나') && w6Tour.sub.includes('「수정」') && w6Tour.sub.includes('「저장」') && w6Tour.sub.includes('빈 곳'), JSON.stringify(w6Tour));
    // 처음 사용 점검 2회차 FU-24·FU-29(처음 사용 W4): 키가 없는 사전 생성 초안 위 안내 한 줄, 방금 누른 근거 칩 아래 근거 글 한 줄
    const w4Hint = await evaluate(s.cdp, "(() => { const h = document.querySelector('[data-testid=draft-live-hint]'); const first = document.querySelector('.draft [data-testid^=draft-item-]'); const note = document.querySelector('[data-testid=draft-method-note]'); const r = h ? h.getBoundingClientRect() : { width: 0, height: 0 }; return { text: h ? h.textContent : null, size: r.width > 0 && r.height > 0, last: !!(h && h.parentElement && h.parentElement.lastElementChild === h), below: !!(h && first && (h.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_PRECEDING)), next: !!document.querySelector('[data-testid=draft-next]'), note: note ? note.textContent : null, oldWord: document.querySelector('.draft').textContent.includes('개발 중') }; })()");
    // 처음 사용 3회차(W6): 한 줄이 항목들 아래 맨 끝으로 옮겨졌고 말투가 바뀌었다. 사전 생성 안내는 「예시 지도의 기록을 앱을 만들 때 Claude에 넣어 미리 받아 둔 문장입니다(받은 날짜)」
    check('처음 사용 W6(FU-24 이동) 키가 없는 사전 생성 초안: 항목들 아래 맨 끝에 「지금 문장은 미리 받아 둔 것입니다. 「설정」에 Claude API 키를 넣으면 이 초안을 Claude가 새로 씁니다(선택).」 한 줄(크기 있음)과 사전 생성 안내(받은 날짜 포함), 옛 「실시간으로 다시 쓰려면」·「개발 중」 글자 없음', ['지금 문장은 미리 받아 둔 것입니다. 「설정」에 Claude API 키를 넣으면 이 초안을 Claude가 새로 씁니다(선택).', '일부는 미리 받아 둔 문장, 나머지는 기록을 모은 문장입니다. 「설정」에 Claude API 키를 넣으면 이 초안을 Claude가 새로 씁니다(선택).'].includes(w4Hint.text) && w4Hint.size && w4Hint.last && w4Hint.below && w4Hint.next && /^예시 지도의 기록을 앱을 만들 때 Claude에 넣어 미리 받아 둔 문장입니다\(\d{4}-\d{2}-\d{2}\)\. 열 때마다 앱이 근거를 검사하고, 맞지 않으면 기록을 그대로 모은 문장으로 바꿉니다\.$/.test(w4Hint.note) && !w4Hint.oldWord && !w4Hint.text.includes('실시간으로 다시 쓰려면'), JSON.stringify(w4Hint));
    const w4Ev = await evaluate(s.cdp, "(() => { const c = document.querySelector('.draft .evidence'); const li = c && c.closest('li'); const t = li && li.querySelector('[data-testid=evidence-text]'); const r = t ? t.getBoundingClientRect() : { width: 0, height: 0 }; return { has: !!t, text: t ? t.textContent : '', below: !!(t && (c.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING)), size: r.width > 0 && r.height > 0, noGidHead: t ? !/^U-[A-Z0-9]+\\//.test(t.textContent) : false, pressed: c ? c.getAttribute('aria-pressed') : null }; })()");
    check('처음 사용 W4(FU-29) 근거 칩을 누르면 그 항목(칩 묶음) 아래에 근거 글 한 줄(크기 있음, 앞의 gid는 뗌)', w4Ev.has && w4Ev.text.length > 8 && w4Ev.below && w4Ev.size && w4Ev.noGidHead && w4Ev.pressed === 'true', JSON.stringify(w4Ev));
    await shot(s.cdp, `${browser.name}-w4-evidence-text`);
    const w4Ev2 = await evaluate(s.cdp, "(() => { const c = document.querySelector('.draft .evidence'); const li = c.closest('li'); c.click(); const closed = !li.querySelector('[data-testid=evidence-text]'); c.click(); const reopened = !!li.querySelector('[data-testid=evidence-text]'); c.click(); const multi = [...document.querySelectorAll('.draft li')].find((x) => x.querySelectorAll('.evidence').length >= 2); let switched = null; if (multi) { const [a, b] = multi.querySelectorAll('.evidence'); a.click(); const ta = multi.querySelector('[data-testid=evidence-text]').textContent; b.click(); const tb = multi.querySelector('[data-testid=evidence-text]'); switched = { changed: !!tb && tb.textContent !== ta, one: multi.querySelectorAll('[data-testid=evidence-text]').length === 1 }; } return { closed, reopened, switched }; })()");
    check('처음 사용 W4(FU-29) 같은 칩을 다시 누르면 근거 글이 접히고(다시 누르면 열림), 같은 묶음의 다른 칩을 누르면 글이 바뀜(한 줄만 보임)', w4Ev2.closed && w4Ev2.reopened && (w4Ev2.switched === null || (w4Ev2.switched.changed && w4Ev2.switched.one)), JSON.stringify(w4Ev2));
    await shot(s.cdp, `${browser.name}-36d2-tour-handover-5`);
    // 5단계: 「대사 확인」 → 「수정」 → 설명 끝에 글자 하나 → 「저장」 → 빈 곳 → 「편집 되감기」
    await evaluate(s.cdp, "window.__wu.select('U-A1/N-001')");
    await sleep(200);
    check('R9-1 5단계에서 노드를 고르면 짚는 대상이 「수정」 단추', await evaluate(s.cdp, "!!document.querySelector('[data-testid=btn-edit].tour-target')"));
    await clickTestId(s.cdp, 'btn-edit');
    await sleep(200);
    const curDesc = await evaluate(s.cdp, "document.querySelector('[data-testid=node-description]').value");
    await fillPanelForm(s.cdp, { 'node-description': curDesc + '.' });
    await sleep(400);
    ti = await tourInfo();
    check('R9-1 저장만으로는 끝나지 않고 보조 문구 「고쳐서 저장했어요…」가 보임', ti.index === 4 && (await text(s.cdp, '[data-testid=tour-sub]')).includes('고쳐서 저장했어요'), JSON.stringify(ti));
    await evaluate(s.cdp, "window.__wu.select(null)");
    await sleep(200);
    check('R9-1 빈 곳을 누르면 짚는 대상이 「편집 되감기」 단추(활성)', await evaluate(s.cdp, "(() => { const b = document.querySelector('[data-testid=btn-rewind]'); return !!b && !b.disabled && b.classList.contains('tour-target'); })()"));
    await clickTestId(s.cdp, 'btn-rewind');
    await sleep(500);
    ti = await tourInfo();
    check('R9-1 「편집 되감기」를 누르면 띠가 보이고 끝 카드: 「끝! 이제 내 업무로 해 볼까요?」', ti.mode === 'end' && !(await evaluate(s.cdp, "document.querySelector('[data-testid=rewind-band]').hidden")) && (await text(s.cdp, '[data-testid=tour-end]')) === '끝! 이제 내 업무로 해 볼까요?', JSON.stringify(ti));
    await clickTestId(s.cdp, 'btn-rewind-back');
    await sleep(300);
    check('CR-13 A 근거 칩을 누르면 끝 카드: 「끝! 이제 내 업무로 해 볼까요?」, 「이제 내 업무로 해 보기」, 「닫기」, 접힌 상태면 「도구 더 보기」 안내 한 줄(강제로 펼치지 않음)', ti.mode === 'end' && (await text(s.cdp, '[data-testid=tour-end]')) === '끝! 이제 내 업무로 해 볼까요?' && (await text(s.cdp, '[data-testid=tour-mine]')) === '이제 내 업무로 해 보기' && (await text(s.cdp, '[data-testid=tour-skip]')) === '닫기' && (await text(s.cdp, '[data-testid=tour-tools-hint]')).includes('「도구 더 보기」에서 흐름 정렬·거르기도 써 보세요') && (await evaluate(s.cdp, 'window.__wu.toolsOpen')) === false, JSON.stringify(ti));
    const wbEnd = await evaluate(s.cdp, "(() => { const m = document.querySelector('[data-testid=tour-mine]'); const g = document.querySelector('[data-testid=tour-end-guide]'); const k = document.querySelector('[data-testid=tour-make]'); return { mine: m ? { text: m.textContent, primary: m.classList.contains('primary'), disabled: m.disabled, visible: m.checkVisibility() } : null, guide: g ? g.textContent : '', make: !!k, skip: !!document.querySelector('[data-testid=tour-skip]') }; })()");
    check('처음 사용 W-B(CR-18-3) 따라 하기 끝 카드: 안내 「예시를 봤으면, 내 업무 이름 하나로 작은 지도를 만들어 보세요.」, 으뜸 단추 「이제 내 업무로 해 보기」(켜짐·보임), 같은 일 하던 「내 업무 지도 만들기」는 없고 「닫기」는 그대로', !!wbEnd.mine && wbEnd.mine.text === '이제 내 업무로 해 보기' && wbEnd.mine.primary && !wbEnd.mine.disabled && wbEnd.mine.visible && wbEnd.guide === '예시를 봤으면, 내 업무 이름 하나로 작은 지도를 만들어 보세요.' && !wbEnd.make && wbEnd.skip, JSON.stringify(wbEnd));
    await shot(s.cdp, `${browser.name}-36e-tour-end`);
    await evaluate(s.cdp, "document.querySelector('[data-testid=tour-mine]').click()");
    await sleep(300);
    check('CR-13 A·W-B 끝 카드 「이제 내 업무로 해 보기」 → 「내 업무 지도 만들기」 창이 열리고 따라 하기 카드는 닫힘', (await evaluate(s.cdp, "document.getElementById('create-dialog').open")) && (await tourInfo()).mode === 'off' && (await evaluate(s.cdp, "document.getElementById('tour-slot').hidden")));
    const dEnd = await dlgInfo();
    check('N-3·W-B 끝 카드 「이제 내 업무로 해 보기」로 열면 「내 업무 지도 만들기」 모양(첫 업무 칸 맨 위, 지도 정보 접힘, 초점은 업무 이름)', dEnd.title === '내 업무 지도 만들기' && dEnd.work && !dEnd.name && dEnd.metaInInfo && !dEnd.infoOpen && dEnd.focus === 'create-start-work', JSON.stringify(dEnd));
    await shot(s.cdp, `${browser.name}-36f-mine-dialog-from-end`);
    const authorSet = await evaluate(s.cdp, "(JSON.parse(localStorage.getItem('wu:v1:settings') || '{}').authorName || '')");
    await evaluate(s.cdp, "(() => { document.getElementById('create-start-work').value = '재검증 시험 업무'; document.querySelector('#create-form button[type=submit]').click(); })()");
    await sleep(600);
    const mineDoc = await waitFor(s.cdp, "window.__wu && window.__wu.doc && window.__wu.doc.universe.name === '재검증 시험 업무 업무 지도'", 8000);
    const mineU = await evaluate(s.cdp, "window.__wu.doc ? { name: window.__wu.doc.universe.name, level: window.__wu.doc.universe.level, owner: window.__wu.doc.universe.owner, nodes: window.__wu.doc.nodes.map((n) => n.core_type + ':' + n.label) } : null");
    check('N-3 업무 이름만 넣고 만들기 → 지도가 생기고 이름 「재검증 시험 업무 업무 지도」, 단위 「업무」, 작성 주체는 작성자 이름이 있으면 「…의 팀」 없으면 「내 팀」, 업무 노드가 있음', mineDoc && mineU.level === '업무' && mineU.owner === (authorSet ? authorSet + '의 팀' : '내 팀') && mineU.nodes.includes('work:재검증 시험 업무'), JSON.stringify({ mineU, authorSet }));
    await shot(s.cdp, `${browser.name}-36g-mine-created`);
    await evaluate(s.cdp, "location.hash = 'U-A1'; location.reload()").catch(() => {});
    await sleep(500);
    await waitFor(s.cdp, "window.__wu && window.__wu.doc && window.__wu.doc.universe.id === 'U-A1' && window.__wu.cy.nodes().length > 0", 8000);
    await evaluate(s.cdp, "document.getElementById('create-open').click()");
    await sleep(250);
    const dHead = await dlgInfo();
    check('N-3 머리글 「새 업무 지도」로 열면 예전 모양(제목·이름 칸 보임·지도 정보 상자 없음)', dHead.title === '새 업무 지도 만들기' && dHead.name && dHead.work && !dHead.starterBeforeMeta && dHead.infoHidden, JSON.stringify(dHead));
    await evaluate(s.cdp, "document.getElementById('create-cancel').click()");
    await sleep(150);
    // 「?」로 다시 시작(U-A1이면 handover), 「건너뛰기」로 닫기, 대상 표시도 사라짐
    await openTourViaHelp(s.cdp);
    await sleep(300);
    ti = await tourInfo();
    // 처음 사용 W2(FU-9)로 바뀜: 「?」는 도움말 상자를 열고(title 「도움말…」), 상자의 「따라 하기 다시 보기」가 예전 「?」 동작이다
    check('CR-13 A 머리글 「?」 → 도움말 상자의 「따라 하기 다시 보기」(처음 사용 W2로 바뀜): 월말 정산 화면에서는 인수인계 따라 하기가 처음부터 다시 시작됨, 상자는 닫힘', ti.mode === 'step' && ti.scenario === 'handover' && ti.index === 0 && (await evaluate(s.cdp, "document.getElementById('tour-open').title")).startsWith('도움말') && !(await evaluate(s.cdp, "document.getElementById('help-dialog').open")), JSON.stringify(ti));
    await evaluate(s.cdp, "document.querySelector('[data-testid=tour-skip]').click()");
    await sleep(200);
    // ── 처음 사용 W2(2026-10-24, FU-9) 「?」 도움말 상자: 보임(크기)·용어 4개·생성 방식 3개·「따라 하기 다시 보기」·Esc로 닫힘·"null" 없음 ──
    await clickTestId(s.cdp, 'tour-open');
    await sleep(250);
    const hb = await evaluate(s.cdp, "(() => { const b = document.querySelector('[data-testid=help-box]'); if (!b) return null; const r = b.getBoundingClientRect(); const q = (id) => document.querySelector('[data-testid=' + id + ']'); const t = q('help-tour'); return { open: b.open, w: r.width, h: r.height, terms: [...document.querySelectorAll('[data-testid=help-terms] dt')].map((e) => e.textContent), gen: [...document.querySelectorAll('[data-testid=help-gen] dt')].map((e) => e.textContent), intro: (q('help-intro') || {}).textContent || '', tour: t ? t.textContent : null, tourSize: t ? t.getBoundingClientRect().width > 0 : false, close: (q('help-close') || {}).textContent || '', text: b.textContent, inView: r.top >= 0 && r.bottom <= window.innerHeight }; })()");
    check('처음 사용 W2(FU-9) 「?」 → 도움말 상자가 열리고 크기가 있으며 화면 안에 들어옴(따라 하기는 아직 시작되지 않음)', !!hb && hb.open === true && hb.w > 0 && hb.h > 0 && hb.inView && (await tourInfo()).mode === 'off', JSON.stringify(hb && { ...hb, text: '' }));
    check('처음 사용 W2(FU-9) 도움말 한 줄 설명과 용어 4개(업무 지도·노드·꼭지·근거 칩)·생성 방식 3개(사전 생성·규칙 기반·Claude API)', !!hb && hb.intro.includes('누가 언제 무엇을 했는지 기록해 두고') && hb.intro.includes('「혼자만 아는 업무」 경고') && JSON.stringify(hb.terms) === JSON.stringify(['업무 지도', '항목', '지도 중심', '근거 칩']) && JSON.stringify(hb.gen) === JSON.stringify(['사전 생성', '규칙 기반', 'Claude API']), JSON.stringify(hb && { terms: hb.terms, gen: hb.gen })); // CR-18-2
    check('처음 사용 W2(FU-9) 도움말 상자에 「따라 하기 다시 보기」(크기 있음)와 「닫기」 단추가 있고 "null" 글자가 없음', !!hb && hb.tour === '따라 하기 다시 보기' && hb.tourSize && hb.close === '닫기' && !hb.text.includes('null'));
    await shot(s.cdp, `${browser.name}-0c-help-box`);
    await s.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await s.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(200);
    check('처음 사용 W2(FU-9) Esc로 도움말 상자가 닫히고 따라 하기도 시작되지 않음', !(await evaluate(s.cdp, "document.getElementById('help-dialog').open")) && (await tourInfo()).mode === 'off');
    await clickTestId(s.cdp, 'tour-open');
    await sleep(200);
    await clickTestId(s.cdp, 'help-close');
    await sleep(150);
    check('처음 사용 W2(FU-9) 상자의 「닫기」로도 닫힘', !(await evaluate(s.cdp, "document.getElementById('help-dialog').open")) && (await tourInfo()).mode === 'off');
    await clickTestId(s.cdp, 'tour-open');
    await sleep(200);
    await clickTestId(s.cdp, 'help-tour');
    await sleep(300);
    ti = await tourInfo();
    check('처음 사용 W2(FU-9) 「따라 하기 다시 보기」 → 상자가 닫히고 따라 하기 카드 1/n(인수인계 1단계)이 보임', ti.mode === 'step' && ti.scenario === 'handover' && ti.index === 0 && !(await evaluate(s.cdp, "document.getElementById('help-dialog').open")) && /^따라 하기 1\/\d+/.test((await text(s.cdp, '[data-testid=tour-card] .tour-count')).trim()), JSON.stringify(ti));
    await evaluate(s.cdp, "document.querySelector('[data-testid=tour-skip]').click()");
    await sleep(200);
    const marks = await tourMarks();
    check('CR-13 A 「건너뛰기」 → 카드가 닫히고 깜빡임 표시도 모두 사라짐', (await tourInfo()).mode === 'off' && (await evaluate(s.cdp, "document.getElementById('tour-slot').hidden")) && marks.dom === 0 && marks.cy === 0, JSON.stringify(marks));
    // 깜빡임 대신 테두리(prefers-reduced-motion): 그래프 노드 표시가 계속 켜져 있고, 화면 요소는 애니메이션이 없다
    await s.cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await reloadReady();
    await openTourViaHelp(s.cdp);
    await sleep(200);
    const reducedSamples = [];
    for (let i = 0; i < 4; i += 1) { reducedSamples.push(await evaluate(s.cdp, "window.__wu.cy.nodes('.tour-target').length")); await sleep(380); }
    await evaluate(s.cdp, "window.__wu.select('U-A1/N-001')");
    await evaluate(s.cdp, "document.querySelector('[data-testid=tour-next]').click()");
    await sleep(200);
    await evaluate(s.cdp, "window.__wu.select(null)");
    await sleep(200);
    const reducedAnim = await evaluate(s.cdp, "(() => { const e = document.querySelector('.tour-target'); return e ? getComputedStyle(e).animationName : 'none-target'; })()");
    check('CR-13 A prefers-reduced-motion: 깜빡이지 않고(노드 표시가 계속 켜져 있음) 화면 요소도 애니메이션 없는 고정 테두리', reducedSamples.every((n) => n === 1) && reducedAnim === 'none', JSON.stringify({ reducedSamples, reducedAnim }));
    await s.cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: '' }] });
    // 보통(깜빡임) 모드의 노드 표시는 켜졌다 꺼졌다 한다
    await reloadReady();
    await openTourViaHelp(s.cdp);
    const blinkSamples = [];
    for (let i = 0; i < 8; i += 1) { blinkSamples.push(await evaluate(s.cdp, "window.__wu.cy.nodes('.tour-target').length")); await sleep(240); }
    check('CR-13 A 보통 모드: 짚은 노드가 깜빡임(켜짐·꺼짐이 모두 관찰됨)', blinkSamples.includes(0) && blinkSamples.includes(1), JSON.stringify(blinkSamples));
    await evaluate(s.cdp, "document.querySelector('[data-testid=tour-skip]').click()");
    // 「도구 더 보기」를 다시 펼친다(이 아래 점검은 펼친 상태를 전제)
    await clickTestId(s.cdp, 'tools-toggle');
    await sleep(200);

    // 「샘플 바로 열기: 월말 정산 점검」은 따라 하기 없이 연다(실행 안내·guide-check가 누르는 단추)
    await evaluate(s.cdp, "history.replaceState(null, '', location.pathname + location.search); location.reload()").catch(() => {});
    await sleep(500);
    await waitFor(s.cdp, 'window.__wu && window.__wu.start === true', 8000);
    await evaluate(s.cdp, "document.querySelector('[data-testid=start-primary]').click()");
    await sleep(500);
    const openedPrimary = await waitFor(s.cdp, "window.__wu && window.__wu.doc && window.__wu.doc.universe.id === 'U-A1' && window.__wu.cy.nodes().length > 0", 8000);
    await sleep(300);
    check('R-08 「샘플 바로 열기: 월말 정산 점검」으로도 한 번에 열리고, 따라 하기는 시작하지 않음(카드·표시 없음)', openedPrimary && (await tourInfo()).mode === 'off' && (await evaluate(s.cdp, "document.getElementById('tour-slot').hidden")) && (await tourMarks()).cy === 0);
    // 제목을 누르면 시작 화면으로 돌아온다
    await evaluate(s.cdp, "document.getElementById('home').click()").catch(() => {});
    await sleep(500);
    check('머리글 제목을 누르면 시작 화면으로 돌아옴', await waitFor(s.cdp, 'window.__wu && window.__wu.start === true', 8000));

    // 갈래 c: 팀 업무 → 가상 운영부(U-D1), team 시나리오 1~5(위험 요약 먼저 — CR-17 K)
    await evaluate(s.cdp, "(() => { const v = JSON.parse(localStorage.getItem('wu:v1:settings') || '{}'); delete v.tourDone; localStorage.setItem('wu:v1:settings', JSON.stringify(v)); })()"); // CR-18 D-2: 위와 같은 이유
    await evaluate(s.cdp, "document.querySelector('[data-testid=start-way-team]').click()");
    await sleep(500);
    const openedTeam = await waitFor(s.cdp, "window.__wu && window.__wu.doc && window.__wu.doc.universe.id === 'U-D1' && window.__wu.cy.nodes().length > 0", 8000);
    await sleep(400);
    ti = await tourInfo();
    check('CR-13 A 갈래 c 「팀 업무를 한눈에 보고 싶어요」 → 가상 운영부가 열리고 따라 하기 1/5(이야기: 75개 중 18개만 보임)', openedTeam && ti.scenario === 'team' && ti.index === 0 && (await text(s.cdp, '[data-testid=tour-story]')).includes('75개 중 18개만 보이고') && (await evaluate(s.cdp, 'window.__wu.cy.nodes().length')) === 18 && (await hashClean()), JSON.stringify(ti));
    const collapsedId = await evaluate(s.cdp, "window.__wu.cy.nodes('[?collapsed]')[0].id()");
    // CR-17 K(위험 요약 먼저 판, TEAM_ORDER = 'risk-first'). 처음 사용 점검 2회차 FU-33: team 따라 하기 순서가 위험 요약의 「자세히」 → 펼치기 → 찾기 → 주변만 보기 → 전체 보기로 바뀜(옛 순서는 펼치기 → 인사이트 보기 → …)
    // 노드 하나를 골라 둔다: 선택이 남아 있으면 위험 요약이 가려지므로 「빈 곳을 누르세요」 표지(N-2)가 보이는지 먼저 확인한다
    await evaluate(s.cdp, "window.__wu.select(window.__wu.cy.nodes('[!collapsed]')[0].id())");
    await sleep(300);
    const hi2 = await hintInfo();
    check('N-2 team 1단계(선택이 남은 상태)에도 그래프 안쪽 표지 「여기 빈 곳을 누르세요」(크기 있음, 안쪽 테두리)', !!hi2 && hi2.text === '여기 빈 곳을 누르세요' && hi2.w > 80 && hi2.inside && hi2.noPointer && hi2.graphInset, JSON.stringify(hi2));
    await shot(s.cdp, `${browser.name}-37c-tour-team-5-hint`);
    await blankClick();
    check('처음 사용 W4(FU-33) team 1단계: 빈 곳을 누르면 표지가 사라지고 깜빡이는 대상은 위험 요약 줄의 「자세히」', (await hintInfo()) === null && (await evaluate(s.cdp, "document.querySelector('[data-testid=btn-team-risk-more]').classList.contains('tour-target')")));
    const tn1 = await stepNamesOk();
    check('처음 사용 W4(FU-33) team 1단계 문구: 「혼자만 아는 일 …」 줄의 「자세히」(줄 이름은 줄임표 앞부분이 요약 줄에 있고, 「자세히」 단추가 화면에 있음)', tn1.names.join('|') === '혼자만 아는 일 …|자세히' && tn1.missing.every((n) => n === '혼자만 아는 일 …') && (await text(s.cdp, '[data-testid=team-risk-summary]')).includes('혼자만 아는 일') && (await text(s.cdp, '[data-testid=tour-task]')).includes('한 사람만 해 봤고 인수인계 기록이 없는 일이 나옵니다'), JSON.stringify(tn1));
    await shot(s.cdp, `${browser.name}-37a-tour-team-1`);
    await evaluate(s.cdp, "document.querySelector('[data-testid=btn-team-risk-more]').click()");
    await sleep(500);
    const insShow = await evaluate(s.cdp, "({ tab: document.querySelector('[data-testid=tab-risk]').classList.contains('active'), len: document.querySelector('#detail').textContent.length })");
    ti = await tourInfo();
    check('CR-13 A team 1단계 → 「자세히」로 인사이트가 「인수인계 위험」 탭으로 열리면(내용이 보임, FU-5) 2/5(접힌 팀 펼치기)', ti.index === 1 && (await text(s.cdp, '[data-testid=tour-count]')) === '따라 하기 2/5' && insShow.tab && insShow.len > 100, JSON.stringify({ ti, insShow }));
    await shot(s.cdp, `${browser.name}-37d-tour-team-insight`);
    check('CR-13 A team 2단계: 깜빡이는 대상은 접힌 팀(이중 테두리) 노드', (await blinkIds()).includes(collapsedId));
    const dbl = await evaluate(s.cdp, `(() => { const n = window.__wu.cy.getElementById(${JSON.stringify(collapsedId)}); const p = n.renderedPosition(); const r = document.getElementById('graph').getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; })()`);
    await s.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: dbl.x, y: dbl.y });
    for (const c of [1, 2]) { await s.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: dbl.x, y: dbl.y, button: 'left', clickCount: c }); await s.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: dbl.x, y: dbl.y, button: 'left', clickCount: c }); }
    await sleep(700);
    ti = await tourInfo();
    check('CR-13 A team 2단계 → 접힌 팀을 두 번 눌러 펼치면 3/5(노드 찾기)', ti.index === 2 && (await text(s.cdp, '[data-testid=tour-count]')) === '따라 하기 3/5' && (await evaluate(s.cdp, 'window.__wu.cy.nodes().length')) > 18, JSON.stringify(ti));
    const tn3 = await stepNamesOk();
    check('CR-13 A team 3단계 문구의 「」 이름(노드 찾기)이 실제 화면에 있고 깜빡이는 대상은 찾기 칸', tn3.missing.length === 0 && (await evaluate(s.cdp, "document.querySelector('[data-testid=find-input]').classList.contains('tour-target')")), JSON.stringify(tn3));
    await evaluate(s.cdp, "(() => { const i = document.querySelector('[data-testid=find-input]'); i.value = ''; i.focus(); })()");
    await s.cdp.send('Input.insertText', { text: '대사' });
    await sleep(250);
    check('CR-13 A team 3단계: 찾기 칸에 글자만 넣어서는 진행하지 않음', (await tourInfo()).index === 2);
    await evaluate(s.cdp, "document.querySelector('[data-testid=find-hit]').click()");
    await sleep(500);
    ti = await tourInfo();
    check('CR-13 A team 3단계 → 찾기 결과를 고르면 4/5(주변만 보기)', ti.index === 3 && (await text(s.cdp, '[data-testid=tour-count]')) === '따라 하기 4/5', JSON.stringify(ti));
    const tn4 = await stepNamesOk();
    check('CR-13 A team 4단계 문구의 「」 이름(주변만 보기)이 실제 화면에 있고 깜빡이는 대상은 그 단추', tn4.missing.length === 0 && (await evaluate(s.cdp, "document.querySelector('[data-testid=btn-nbhd]').classList.contains('tour-target')")), JSON.stringify(tn4));
    await evaluate(s.cdp, "document.querySelector('[data-testid=btn-nbhd]').click()");
    await sleep(600);
    ti = await tourInfo();
    check('CR-13 A team 4단계 → 「주변만 보기」를 누르면 5/5(전체 보기로 돌아오기), 이때 깜빡이는 대상은 「전체 보기」', ti.index === 4 && (await text(s.cdp, '[data-testid=tour-count]')) === '따라 하기 5/5' && !!(await evaluate(s.cdp, 'window.__wu.nbhd')) && (await evaluate(s.cdp, "document.getElementById('fit').classList.contains('tour-target')")), JSON.stringify(ti));
    const tn5 = await stepNamesOk();
    check('CR-13 A team 5단계 문구의 「」 이름(전체 보기)이 실제 화면에 있음', tn5.missing.length === 0 && tn5.names.includes('전체 보기'), JSON.stringify(tn5));
    await shot(s.cdp, `${browser.name}-37b-tour-team-4`);
    await evaluate(s.cdp, "document.getElementById('fit').click()");
    await sleep(600);
    check('CR-13 A team 5단계 → 「전체 보기」로 돌아오면(주변만 보기 해제) 끝 카드', (await tourInfo()).mode === 'end' && (await text(s.cdp, '[data-testid=tour-end]')) === '끝! 이제 내 업무로 해 볼까요?' && (await text(s.cdp, '[data-testid=tour-card] .tour-count')) === '따라 하기 5/5 끝' && !(await evaluate(s.cdp, 'window.__wu.nbhd')));
    check('처음 사용 W-B(CR-18-3) 팀 따라 하기 끝 카드에도 안내 한 줄과 「이제 내 업무로 해 보기」', (await text(s.cdp, '[data-testid=tour-mine]')) === '이제 내 업무로 해 보기' && (await text(s.cdp, '[data-testid=tour-end-guide]')) === '예시를 봤으면, 내 업무 이름 하나로 작은 지도를 만들어 보세요.');
    await shot(s.cdp, `${browser.name}-37d-tour-team-end`);
    await evaluate(s.cdp, "document.querySelector('[data-testid=tour-skip]').click()");
    // 「?」: 다른 유니버스(U-K1)에서는 두 시나리오 고르기 → 팀을 고르면 U-D1이 열리고 team 시작
    await evaluate(s.cdp, "location.hash = 'U-K1'; location.reload()").catch(() => {});
    await sleep(500);
    await waitFor(s.cdp, "window.__wu && window.__wu.doc && window.__wu.doc.universe.id === 'U-K1' && window.__wu.cy.nodes().length > 0", 8000);
    await openTourViaHelp(s.cdp);
    await sleep(250);
    check('CR-13 A 「?」: 월말 정산·가상 운영부가 아닌 화면(U-K1)에서는 두 시나리오를 고르는 카드', (await tourInfo()).mode === 'pick' && (await text(s.cdp, '[data-testid=tour-pick-handover]')).includes('인수인계 초안 만들기') && (await text(s.cdp, '[data-testid=tour-pick-team]')).includes('팀 업무 한눈에 보기'));
    await evaluate(s.cdp, "document.querySelector('[data-testid=tour-pick-team]').click()");
    await sleep(500);
    await waitFor(s.cdp, "window.__wu && window.__wu.doc && window.__wu.doc.universe.id === 'U-D1' && window.__wu.cy.nodes().length > 0", 8000);
    await sleep(300);
    ti = await tourInfo();
    check('CR-13 A 「?」에서 팀을 고르면 가상 운영부가 열리고 team 1/4부터 시작', !!ti && ti.scenario === 'team' && ti.index === 0 && (await hashClean()), JSON.stringify(ti));
    await evaluate(s.cdp, "document.querySelector('[data-testid=tour-skip]').click()");
    await evaluate(s.cdp, "document.getElementById('home').click()").catch(() => {});
    await sleep(500);
    await waitFor(s.cdp, 'window.__wu && window.__wu.start === true', 8000);
    await evaluate(s.cdp, "document.querySelector('[data-testid=open-U-D1]').click()");
    await sleep(500);
    check('카드의 "열기"로 다른 샘플(가상 운영부)을 열 수 있음(따라 하기는 시작하지 않음)', await waitFor(s.cdp, "window.__wu && window.__wu.doc && window.__wu.doc.universe.id === 'U-D1'", 8000) && (await tourInfo()).mode === 'off');
  }
  await evaluate(s.cdp, "location.hash = 'U-A1'; location.reload()").catch(() => {});
  await sleep(500);
  await waitFor(s.cdp, "window.__wu && window.__wu.doc && window.__wu.doc.universe.id === 'U-A1'", 8000);

  // ── T-09 새 업무 지도(R-12)와 하위 유형 ──
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
  check('R-12 ① 새 업무 지도를 만들면 꼭지만 있는 빈 유니버스가 열림', created);
  if (created) {
    const addR = await submitAdd(s.cdp, 'work', '교육 안내');
    check('R-12 ① 새 업무 지도에 노드를 추가할 수 있음(업무는 꼭지에 바로 연결)', addR.code === 'OK' && (await nodeCount(s.cdp)) === 2 && (await edgeCount(s.cdp)) === 1, addR.text);
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
    // 오류(R-05 ②): 인수인계·메모 기록이 없는 새 업무 지도의 반복 비효율 → 결론 없이 "데이터 부족"과 마지막 입력 시점
    await evaluate(s.cdp, "window.__wu.select(null)");
    await clickTestId(s.cdp, 'btn-insight-universe');
    await sleep(200);
    await clickTestId(s.cdp, 'tab-repeat'); // FU-5: 인사이트는 「인수인계 위험」 탭부터 열리므로 반복 비효율은 탭을 눌러 본다
    await sleep(150);
    const insuf = await text(s.cdp, '[data-testid=repeat-insufficient]');
    check('오류(R-05 ②): 기록이 없는 새 업무 지도 → 반복 비효율 "데이터 부족"과 "입력된 업무 이력 없음"(생성 이력은 입력이 아님)', insuf.includes('데이터 부족') && insuf.includes('입력된 업무 이력 없음') && !(await evaluate(s.cdp, "!!document.querySelector('[data-testid=repeat-patterns]')")), insuf);
    await clickTestId(s.cdp, 'tab-density');
    await sleep(150);
    const dinsuf = await text(s.cdp, '[data-testid=density-insufficient]');
    check('오류(R-05 ②): 담당 연결이 없는 새 업무 지도 → 밀집·공백도 "데이터 부족"만(표·목록 없음)', dinsuf.includes('데이터 부족') && !(await evaluate(s.cdp, "!!document.querySelector('[data-testid=density-groups]')")), dinsuf);
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

  // ── 첫 업무(선택, 조력자 의견 2026-10-17 "어떻게 시작할지 막막하다")와 「처음 할 일」 상자 ──
  await evaluate(s.cdp, 'window.confirm = () => true');
  const fillStarter = (name, f) => evaluate(s.cdp, `(() => {
    document.getElementById('create-open').click();
    document.getElementById('create-name').value = ${JSON.stringify(name)};
    document.getElementById('create-level').value = '업무';
    document.getElementById('create-owner').value = '가상 시험팀';
    const f = ${JSON.stringify(f)};
    document.getElementById('create-start-work').value = f.work || '';
    document.getElementById('create-start-person').value = f.person || '';
    document.getElementById('create-start-cycle').value = f.cycle || '';
    document.getElementById('create-start-due').value = f.due || '';
    document.getElementById('create-start-artifact').value = f.artifact || '';
    document.querySelector('#create-form button[type=submit]').click();
  })()`);
  const nBefore = await evaluate(s.cdp, "document.getElementById('universe-picker').options.length");
  await fillStarter('첫 업무 막힘 시험', { person: '김가상' });
  await sleep(200);
  check('첫 업무: 업무 이름 없이 담당자만 채우면 막고 안내, 유니버스는 안 생김', (await text(s.cdp, '#create-message')).includes('첫 업무 이름') && await evaluate(s.cdp, "document.getElementById('create-dialog').open") && (await evaluate(s.cdp, "document.getElementById('universe-picker').options.length")) === nBefore);
  await evaluate(s.cdp, "document.getElementById('create-dialog').close()");
  await fillStarter('첫 업무 시험 유니버스', { work: '월말 점검', person: '김가상', cycle: '매월', due: '매월 5일', artifact: '점검표' });
  await sleep(500);
  const starterOpened = await waitFor(s.cdp, "window.__wu && window.__wu.doc && window.__wu.doc.universe.name === '첫 업무 시험 유니버스' && window.__wu.cy.nodes().length === 4", 8000);
  check('첫 업무: 업무·담당자·산출물을 적고 만들면 그래프에 노드 4개(꼭지 포함)가 바로 생김', starterOpened);
  if (starterOpened) {
    await evaluate(s.cdp, 'window.__wu.select(null)');
    await sleep(150);
    check('첫 업무: 개요에 「처음 할 일」 상자가 보이고 크기가 있음(3단계, 완료 표시 없음)', await evaluate(s.cdp, "(() => { const b = document.querySelector('[data-testid=starter-steps]'); if (!b) return false; const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 && b.textContent.includes('처음 할 일') && b.querySelectorAll('li').length === 3 && b.querySelectorAll('li[data-done=\"1\"]').length === 0; })()"));
    check('첫 업무: 업무 개수 노드가 하나라 「업무 더 넣기」가 남아 있음, 나눠 보세요 안내는 없음', (await text(s.cdp, '[data-testid=starter-steps]')).includes('업무 더 넣기') && !(await evaluate(s.cdp, "!!document.querySelector('[data-testid=split-hint]')")));
    // ── CR-16 ③ 빈 출발 미리 보기(2026-10-23): 「처음 할 일」 아래 접힌 상자 → 펼치면 「샘플」·월말 정산 사전 생성 문장 ──
    // 처음 사용 W5 FU-34: 「처음 할 일」 아래 한 줄 「팀과 함께 쓰려면 → 「가져오기·내보내기」의 「폴더 연결」」(링크를 누르면 그 탭이 열림), 폴더 연결 ③ 문구
    const teamHint = await evaluate(s.cdp, "(() => { const h = document.querySelector('[data-testid=starter-team-hint]'); const st = document.querySelector('[data-testid=starter-steps]'); const pv = document.querySelector('[data-testid=starter-preview]'); if (!h) return null; const r = h.getBoundingClientRect(); return { text: h.textContent, w: r.width, h: r.height, belowSteps: r.top >= st.getBoundingClientRect().bottom - 1, abovePreview: !pv || r.bottom <= pv.getBoundingClientRect().top + 1, link: !!h.querySelector('[data-testid=btn-starter-folder]') }; })()");
    check('W5 FU-34 「처음 할 일」 아래에 「팀과 함께 쓰려면 → 「가져오기·내보내기」의 「폴더 연결」」 한 줄이 크기 있게 보임(폴더를 못 쓰는 브라우저면 한 줄이 없음)', !teamHint ? !(await evaluate(s.cdp, "!!document.querySelector('[data-testid=btn-folder-entry]')")) : teamHint.text === '팀과 함께 쓰려면 → 「가져오기·내보내기」의 「폴더 연결」' && teamHint.w > 100 && teamHint.h > 8 && teamHint.belowSteps && teamHint.abovePreview && teamHint.link, JSON.stringify(teamHint));
    if (teamHint) {
      await clickTestId(s.cdp, 'btn-starter-folder');
      await sleep(300);
      const folderTab = await evaluate(s.cdp, "(() => ({ dialog: document.getElementById('import-dialog').open, tab: !!document.querySelector('[data-testid=folder-tab]'), origin: (document.querySelector('[data-testid=folder-howto-origin]') || { textContent: null }).textContent }))()");
      check('W5 FU-34 「폴더 연결」 링크를 누르면 가져오기·내보내기 창의 폴더 연결 탭이 열리고 ③이 새 문구(브라우저 기록을 지워도 폴더 사본을 가져오면 돌아옴)', folderTab.dialog && folderTab.tab && (folderTab.origin === null || folderTab.origin === '원본은 각자 브라우저에 저장되고, 폴더에는 저장할 때마다 사본이 생깁니다. 브라우저 기록을 지워도 폴더 사본을 「가져오기」하면 돌아옵니다.'), JSON.stringify(folderTab));
      await evaluate(s.cdp, "document.getElementById('import-dialog').close()");
      await sleep(150);
    }
    const pvInfo = () => evaluate(s.cdp, "(() => { const d = document.querySelector('[data-testid=starter-preview]'); if (!d) return null; const r = d.getBoundingClientRect(); const st = document.querySelector('[data-testid=starter-steps]').getBoundingClientRect(); return { open: d.open, w: r.width, h: r.height, below: r.top >= st.bottom - 1, summary: d.querySelector('summary').textContent, items: d.querySelectorAll('[data-testid=starter-preview-item]').length, text: d.textContent }; })()");
    const pv1 = await pvInfo();
    check('CR-16 ③ 「처음 할 일」 아래에 접힌 「기록이 이렇게 쌓이면 →」 미리 보기가 크기 있게 보임', !!pv1 && pv1.open === false && pv1.w > 0 && pv1.h > 0 && pv1.below && pv1.summary === '기록이 이렇게 쌓이면 →', JSON.stringify(pv1 && { ...pv1, text: '' }));
    await evaluate(s.cdp, "document.querySelector('[data-testid=starter-preview] summary').click()");
    await sleep(200);
    const pv2 = await pvInfo();
    check('CR-16 ③ 펼치면 「샘플」 표시와 「월말 정산」 안내, 항목 3개(업무 개요·세부 업무 절차·주의사항·노하우)와 인수인계 위험 한 줄·만드는 방법 안내', !!pv2 && pv2.open === true && pv2.items === 3 && pv2.text.includes('샘플') && pv2.text.includes('월말 정산') && pv2.text.includes('인수인계 위험') && pv2.text.includes('「인수인계 초안 만들기」') && pv2.text.includes('월말 정산 점검은 매월 말 정산 결과를'), JSON.stringify(pv2 && { ...pv2, text: pv2.text.slice(0, 80) }));
    check('CR-16 시작 화면·개요(미리 보기 포함)에 "null" 글자 없음', await evaluate(s.cdp, "(() => { const w = document.createTreeWalker(document.getElementById('detail'), NodeFilter.SHOW_TEXT); while (w.nextNode()) if (w.currentNode.textContent.includes('null')) return false; return true; })()"));
    await shot(s.cdp, `${browser.name}-8b2-starter-preview-open`);
    await evaluate(s.cdp, "document.querySelector('[data-testid=starter-preview] summary').click()");
    await shot(s.cdp, `${browser.name}-8b-starter-universe`);
    await evaluate(s.cdp, "window.__wu.select(window.__wu.doc.universe.id + '/' + window.__wu.doc.nodes.find((n) => n.core_type === 'work').id)");
    await sleep(150);
    const starterForm = await text(s.cdp, '[data-testid=form-missing]');
    check('첫 업무: 업무 상세에 「표준 양식: 권장 항목」 줄(설명·절차·주의사항이 남음, 주기·마감·담당·관련 문서는 채워짐)', starterForm.includes('표준 양식: 권장 항목 3개') && starterForm.includes('설명') && starterForm.includes('절차') && starterForm.includes('주의사항') && !starterForm.includes('담당'), starterForm);
  }
  // 나눠 보세요 안내: 카드승인(U-K1)에는 보이고 월말 정산(U-A1)에는 없다
  await evaluate(s.cdp, "location.hash = 'U-A1'; location.reload()").catch(() => {});
  await sleep(500);
  await waitFor(s.cdp, "window.__wu && window.__wu.doc && window.__wu.doc.universe.id === 'U-A1'", 8000);
  await evaluate(s.cdp, 'window.__wu.select(null)');
  await sleep(150);
  check('나눠 보세요: 월말 정산(노드 9개)에는 안내가 없음', !(await evaluate(s.cdp, "!!document.querySelector('[data-testid=split-hint]')")));
  await evaluate(s.cdp, "location.hash = 'U-K1'; location.reload()").catch(() => {});
  await sleep(500);
  await waitFor(s.cdp, "window.__wu && window.__wu.doc && window.__wu.doc.universe.id === 'U-K1'", 8000);
  await evaluate(s.cdp, 'window.__wu.select(null)');
  await sleep(150);
  const splitText = await text(s.cdp, '[data-testid=split-hint]');
  check('나눠 보세요: 카드승인(꼭지 포함 38개)에는 안내가 보이고 크기가 있으며 「업무 지도 묶기」를 권함', splitText.includes('38개') && splitText.includes('업무 지도 묶기') && await evaluate(s.cdp, "(() => { const r = document.querySelector('[data-testid=split-hint]').getBoundingClientRect(); return r.width > 0 && r.height > 0; })()"));
  await shot(s.cdp, `${browser.name}-8c-split-hint`);
  await evaluate(s.cdp, "location.hash = 'U-A1'; location.reload()").catch(() => {});
  await sleep(500);
  await waitFor(s.cdp, "window.__wu && window.__wu.doc && window.__wu.doc.universe.id === 'U-A1'", 8000);

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
  check('T-17 예시 문서 초벌 변환 → 미리 보기(노드 18개, 세분화 맞음, 원문 근거 18/18, 표시 보존)', (await text(s.cdp, '[data-testid=import-summary]')).includes('항목 18개') && (await text(s.cdp, '[data-testid=import-granularity]')).includes('맞음') && (await text(s.cdp, '[data-testid=import-source]')).includes('18/18') && (await text(s.cdp, '[data-testid=import-marks]')).includes('[미확인] 항목 2개'), pv.slice(0, 120)); // CR-18-2
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
    check('시작 화면의 「문서·파일 가져오기」로도 가져오기 창이 열림(내보내기 탭은 없음), 가져온 유니버스는 「내 업무 지도」에', (await evaluate(s.cdp, "document.getElementById('import-dialog').open && !document.querySelector('[data-testid=import-tab-export]')")) && (await text(s.cdp, '[data-testid=start-mine]')).includes('대형가맹점 A 카드승인'));
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
  const repeatReady = await waitFor(s.cdp, "window.__wu && window.__wu.doc.universe.id === 'U-A1' && window.__wu.cy.nodes().length > 0", 8000);
  if (!repeatReady) console.log('DIAG T-11 U-A1 열기 실패:', JSON.stringify(await evaluate(s.cdp, "({ href: location.href, wu: typeof window.__wu, start: window.__wu && window.__wu.start, doc: window.__wu && window.__wu.doc ? window.__wu.doc.universe.id : null, nodes: window.__wu && window.__wu.cy ? window.__wu.cy.nodes().length : null, dialogs: [...document.querySelectorAll('dialog[open]')].map((d) => d.id || d.className), warn: (document.querySelector('[data-testid=start-warning]') || {}).textContent || '' })").catch((e) => String(e))));
  if (repeatReady) {
    await evaluate(s.cdp, "window.__wu.select(null)");
    await clickTestId(s.cdp, 'btn-insight-universe');
    await sleep(200);
    await clickTestId(s.cdp, 'tab-repeat'); // FU-5: 기본 탭은 「인수인계 위험」
    await sleep(150);
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
    check('검토3 UI-3: 슬라이더를 움직여도 만든 초안(11개 항목)과 받는 사람 선택이 남는다', (await evaluate(s.cdp, "document.querySelectorAll('[data-testid^=draft-item-]').length")) === 11 && (await evaluate(s.cdp, "document.querySelector('[data-testid=draft-to]').value")) === 'U-A1/N-012');
    await evaluate(s.cdp, "window.__wu.select(null)");
    await setMonth('2025-06');
    await sleep(200);
    check('슬라이더를 2025-06으로 → "2025-06-30 기준"', (await text(s.cdp, '[data-testid=time-when]')) === '2025-06-30 기준');
    const offOf = (src) => evaluate(s.cdp, `window.__wu.cy.edges().filter((e) => e.source().id() === '${src}' && e.target().id() === 'U-A1/N-001').every((e) => e.hasClass('time-off') && !e.visible())`);
    check('2025-06: 윤바다·서하늘의 대사 확인 담당 선은 그래프에서 빠짐(D7 — 흐림이 아니라 안 보임), 한가람 선은 보임', (await offOf('U-A1/N-011')) && (await offOf('U-A1/N-012')) && !(await offOf('U-A1/N-010')));
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
    // D7(2026-10-25 "진행"): 오늘 기준에서도 이미 끝난 담당 선은 빠지고(한가람 2025-03-01~2026-05-31), 지금 담당 선은 보인다(서하늘 2026-10-01~)
    const todayEdges = await evaluate(s.cdp, "(() => { const e = (src) => window.__wu.cy.edges().filter((x) => x.source().id() === src && x.target().id() === 'U-A1/N-001'); return { ended: e('U-A1/N-010').map((x) => x.visible()), current: e('U-A1/N-012').map((x) => x.visible()) }; })()");
    check('「오늘로」 → 오늘 기준: 이미 끝난 담당 선(한가람 → 대사 확인)은 빠지고 지금 담당 선(서하늘 → 대사 확인)은 보임(D7)', (await text(s.cdp, '[data-testid=time-when]')).startsWith('오늘(') && todayEdges.ended.length > 0 && todayEdges.ended.every((v) => !v) && todayEdges.current.length > 0 && todayEdges.current.every((v) => v), JSON.stringify(todayEdges));
  }

  // ── T-08 유사 경험자(R-05) ──
  await evaluate(s.cdp, "location.hash = 'U-D1'; location.reload()").catch(() => {});
  await sleep(500);
  const deptReady = await waitFor(s.cdp, "window.__wu && window.__wu.doc.universe.id === 'U-D1' && window.__wu.cy.nodes().length > 0", 8000);
  check('부서 유니버스(부서 → 팀 → 업무 여러 단계)가 열림', deptReady, deptReady ? undefined : JSON.stringify(await evaluate(s.cdp, "({ href: location.href, wu: typeof window.__wu, start: window.__wu && window.__wu.start, doc: window.__wu && window.__wu.doc ? window.__wu.doc.universe.id : null, nodes: window.__wu && window.__wu.cy ? window.__wu.cy.nodes().length : null, dialogs: [...document.querySelectorAll('dialog[open]')].map((d) => d.id || d.className), warn: (document.querySelector('[data-testid=start-warning]') || {}).textContent || '' })").catch((e) => String(e))));
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
    const direct = await text(s.cdp, '[data-testid=insight-direct]');
    const rolesText = await text(s.cdp, '[data-testid=insight-roles]');
    check('CR-17 B ① 「직접 해 본 사람」 묶음 맨 위: 윤바다·한가람이 이전 담당 기간과 「이 업무를 직접 해 봄」 이유로 나옴(윤바다가 먼저)', direct.includes('이 업무를 직접 해 봄(2026-06-01 ~ 2026-09-30)') && direct.includes('이 업무를 직접 해 봄(2025-03-01 ~ 2026-05-31)') && direct.indexOf('윤바다') < direct.indexOf('한가람') && (await evaluate(s.cdp, "document.querySelectorAll('[data-testid=insight-direct] [data-testid=direct-chip]').length")) === 2, direct.slice(0, 160));
    check('R-05 ① ④ 윤바다 카드에 비슷한 일(2025 행사)과 주제 이유도 함께 나옴', direct.includes('2025 행사') && direct.includes('같은 주제 「대사 불일치」(이름이 같은 주제, 연결 확인 전)'), direct.slice(0, 200));
    check('R-05 ① 근거 버튼(공유 주제·업무)이 붙음', (await evaluate(s.cdp, "document.querySelectorAll('[data-testid=insight-direct] .evidence').length")) >= 4);
    check('CR-17 B ② U-18: 역할 이름(운영 담당·정산 담당)은 아래 「사람 미확인(역할 이름)」 묶음에서 「역할 · 담당자 미연결」 표시, 직접 해 본 사람에는 없음', (await evaluate(s.cdp, "document.querySelectorAll('[data-testid=insight-roles] [data-testid=role-chip]').length")) >= 2 && rolesText.includes('운영 담당') && rolesText.includes('정산 담당') && !direct.includes('운영 담당') && !(await evaluate(s.cdp, "!!document.querySelector('[data-testid=insight-direct] [data-testid=role-chip]')")) && (await evaluate(s.cdp, "(() => { const d = document.querySelector('[data-testid=insight-direct-group]'); const r = document.querySelector('[data-testid=insight-roles-group]'); return !!d && !!r && !!(d.compareDocumentPosition(r) & Node.DOCUMENT_POSITION_FOLLOWING); })()")));
    check('현재 담당자(서하늘)는 뺀다고 밝힘', (await text(s.cdp, '[data-testid=insight-excluded]')).includes('서하늘') && !direct.includes('서하늘') && !rolesText.includes('서하늘'));
    check('R-05 ③ 결정은 사람이 한다는 안내', (await text(s.cdp, '#detail')).includes('사람이 정합니다'));
    await shot(s.cdp, `${browser.name}-6-similar`);
    // 근거를 누르면 그래프에서 그 노드를 강조한다
    await evaluate(s.cdp, "[...document.querySelectorAll('[data-testid=insight-direct] .evidence')].find((b) => b.textContent === '2025 행사').click()");
    await sleep(250);
    check('근거 버튼 → 그래프에서 해당 노드 선택(패널은 그대로)', (await evaluate(s.cdp, "window.__wu.cy.$(':selected').map((n) => n.id()).join()")) === 'U-B/N-101' && !!(await evaluate(s.cdp, "!!document.querySelector('[data-testid=insight-direct]')")));
    // CR-17 B ③ 이름 낱말만 같은 업무: 「2026 행사」 → 「2025 행사」를 한 윤바다가 낮은 점수 후보, 「이름만 같음」 표시와 「같은 일인지 확인」 이유
    await evaluate(s.cdp, `(() => { const p = document.querySelector('[data-testid=insight-work]'); p.value = 'U-B/N-102'; p.dispatchEvent(new Event('change')); })()`);
    await sleep(150);
    const nameOnlyText = await text(s.cdp, '[data-testid=insight-people]');
    check('CR-17 B ③ 「2026 행사」: 윤바다가 이름 낱말 후보(1점)로 나오고 「이름만 같음」 표시와 「이름에 같은 낱말 「행사」 — 같은 일인지 확인」', nameOnlyText.includes('윤바다') && nameOnlyText.includes('1점') && nameOnlyText.includes('이름에 같은 낱말 「행사」 — 같은 일인지 확인') && !!(await evaluate(s.cdp, "!!document.querySelector('[data-testid=insight-people] [data-testid=name-only-chip]')")), nameOnlyText.slice(0, 160));
    // 오류: 주제·산출물 연결도, 이름 낱말이 같은 업무도, 이전 담당도 없는 업무 → 데이터 부족
    await evaluate(s.cdp, `(() => { const p = document.querySelector('[data-testid=insight-work]'); p.value = 'U-B/N-104'; p.dispatchEvent(new Event('change')); })()`);
    await sleep(150);
    check('오류(R-05 ②): 연결이 없는 업무 → "데이터 부족"만 표시', (await text(s.cdp, '[data-testid=insight-insufficient]')).includes('데이터 부족') && !(await evaluate(s.cdp, "!!document.querySelector('[data-testid=insight-people], [data-testid=insight-direct]')")));
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
    // CR-17 B: 직접 해 본 사람(이전 담당 한가람)이 먼저, 이름 낱말만 같은 업무는 「같은 일인지 확인」, 역할 이름은 「사람 미확인」. 보내는 사람(윤바다)은 「문의」로 나오므로 빠진다
    check('인수인계 초안의 "유사 경험자" 항목: 한가람(직접 해 봄)이 먼저, 역할 이름(운영 담당)은 뒤에, 보내는 사람(윤바다(V-1002))은 빠지고 근거 링크가 붙음', sim.includes('한가람') && sim.includes('운영 담당') && sim.indexOf('한가람') < sim.indexOf('운영 담당') && !sim.includes('윤바다(V-1002)') && !sim.includes('이력 부족') && (await evaluate(s.cdp, "document.querySelectorAll('[data-testid=draft-item-유사_경험자] .evidence').length")) >= 3, sim.slice(0, 200));
    // CR-17 E: 「받는 범위와 담당 공백」 — 업무 개요 다음 항목, 받는 사람(서하늘)이 지금 맡은 일과 지금 담당이 없는 업무(자료 수집·보고)
    const rangeText = await text(s.cdp, '[data-testid=draft-item-받는_범위]');
    const itemOrder = await evaluate(s.cdp, "[...document.querySelectorAll('[data-testid^=draft-item-]')].slice(0, 3).map((x) => x.dataset.testid.replace('draft-item-', '')).join()");
    check('CR-17 E 초안 「받는 범위와 담당 공백」: 업무 개요 다음, 서하늘이 맡은 대사 확인과 근거 링크(대상이 「대사 확인」 하나라 범위 밖 자료 수집·보고의 공백 문장은 없음 — 지도 전체 대상의 공백 문장은 단위 테스트)', itemOrder === '업무_개요,받는_범위,세부_업무_절차' && rangeText.includes('받는 범위와 담당 공백') && rangeText.includes('서하늘') && rangeText.includes('대사 확인') && !rangeText.includes('이력 부족') && (await evaluate(s.cdp, "document.querySelectorAll('[data-testid=draft-item-받는_범위] .evidence').length")) >= 2, `${itemOrder} / ${rangeText.slice(0, 200)}`);
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
    check('T-10: 부서 개요에 통합 확인 대기 건수(「같은 사람·업무인지 확인할 것 n건」)와 「통합 확인 목록」', /같은 사람·업무인지 확인할 것 \d+건\(사람 \d+, 업무 후보 \d+\)/.test(hint) && !hint.includes('통합 확인 대기') && hint.includes('통합 확인 목록'), hint);
    await clickTestId(s.cdp, 'btn-merge');
    await sleep(200);
    const persons = await text(s.cdp, '[data-testid=merge-persons]');
    const worksTxt = await text(s.cdp, '[data-testid=merge-works]');
    check('R-11 ③: 사번 충돌(윤바다/윤바다라)과 사번 없음(임가온)이 확인 목록에', persons.includes('사번 충돌') && persons.includes('윤바다라') && persons.includes('임가온'), persons.slice(0, 80));
    check('R-11 ②: 업무 후보(장소 섭외 ↔ 강의실·강사 섭외)와 이유(사전 생성), 자동으로 합치지 않음', worksTxt.includes('장소 섭외') && worksTxt.includes('강의실·강사 섭외') && worksTxt.includes('사전 생성') && worksTxt.includes('일정에 맞춰 장소를 알아보고'), worksTxt.slice(0, 80));
    check('U-12: 사번 없음 카드에 고치는 방법(유니버스를 열어 「수정」에서 사번)이 적혀 있음', persons.includes('고치는 방법') && persons.includes('「수정」에서 사번을 넣으세요'));
    // 2026-10-17 D8-2: 부서 샘플에 「다른 업무」 판정 3건이 미리 들어 있어 후보가 4건, 첫 항목은 2025 행사가 아니며, 「같은 업무」는 강조색이 아니다
    const d82 = await evaluate(s.cdp, "(() => { const lis = [...document.querySelectorAll('[data-testid=merge-works] li')]; const same = document.querySelector('[data-testid=merge-works] [data-testid=merge-same]'); const diff = document.querySelector('[data-testid=merge-works] [data-testid=merge-diff]'); return JSON.stringify({ n: lis.length, first: lis[0] ? lis[0].querySelector('strong').textContent : '', samePrimary: same.classList.contains('primary'), sameClass: same.className, diffClass: diff.className, decided: (document.querySelector('[data-testid=merge-decided]') || { children: [] }).children.length }); })()");
    const d82o = JSON.parse(d82);
    check('D8-2: 부서 통합 확인 목록에 업무 후보 4건, 첫 항목은 2025 행사가 아님, 「같은 업무」가 강조색이 아님(「다른 업무」와 같은 모양), 판정 기록에 미리 넣은 3건', d82o.n === 4 && !d82o.first.includes('2025 행사') && !d82o.samePrimary && d82o.sameClass === d82o.diffClass && d82o.decided >= 4 && hint.includes('6건'), d82);
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
    check('R-03 ② 예외 5: 「신규 교육 과정」 초안은 7개 항목이 "이력 부족"(CR-17 E 「받는 범위와 담당 공백」은 담당 기록 없음을 공백으로 알려 채워짐)', shortCount === 7 && !(await text(s.cdp, '[data-testid=draft-item-받는_범위]')).includes('이력 부족'), String(shortCount));
    await shot(s.cdp, `${browser.name}-11-edu-short`);
    // T-12 사전 생성 초안: 신입 교육 운영, 이든빛 → 나래솔(데이터를 고치지 않은 상태)
    await evaluate(s.cdp, "(() => { const f = document.querySelector('[data-testid=draft-form]'); const set = (t, v) => { const e = f.querySelector('[data-testid=' + t + ']'); e.value = v; e.dispatchEvent(new Event('change')); }; set('draft-target', 'U-C/N-101'); set('draft-from', 'U-C/N-202'); set('draft-to', 'U-C/N-201'); f.querySelector('button[type=submit]').click(); })()");
    await sleep(250);
    const pregenChips = await evaluate(s.cdp, "[...document.querySelectorAll('[data-testid=item-method]')].filter((x) => x.textContent === '사전 생성').length");
    check('T-12 사전 생성: 생성 방식 표시와 10개 항목(이력 부족 제외)에 「사전 생성」, 근거 버튼 유지', (await text(s.cdp, '[data-testid=draft-method]')).includes('사전 생성') && pregenChips === 10 && (await text(s.cdp, '[data-testid=draft-item-세부_업무_절차]')).includes('강의실·강사 섭외를 마쳐야 교육을 열 수 있고') && (await evaluate(s.cdp, "document.querySelectorAll('[data-testid=draft-item-세부_업무_절차] .evidence').length")) >= 4, String(pregenChips));
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
    // 처음 사용자 검토 2026-10-17: 1366 너비에서 넓게 보기를 켜면 그래프 위 도구줄이 겹쳤다. 도구줄 요소끼리 교차하지 않아야 한다
    await s.cdp.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
    await sleep(400);
    const overlap = await evaluate(s.cdp, "(() => { const els = [...document.querySelectorAll('.explore-row .explore-bar > *, .explore-row .graph-tools button, .explore-row .tools-more > *')].filter((e) => e.offsetWidth > 0); const rs = els.map((e) => [e, e.getBoundingClientRect()]); const bad = []; for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) { const [a, ra] = rs[i], [b, rb] = rs[j]; if (a.contains(b) || b.contains(a)) continue; if (ra.left < rb.right - 1 && rb.left < ra.right - 1 && ra.top < rb.bottom - 1 && rb.top < ra.bottom - 1) bad.push((a.id || a.className || a.tagName) + '/' + (b.id || b.className || b.tagName)); } return { n: els.length, bad }; })()");
    await s.cdp.send('Emulation.clearDeviceMetricsOverride');
    check('넓게 보기 1366에서 도구줄 요소끼리 겹치지 않음', overlap.n >= 5 && overlap.bad.length === 0, JSON.stringify(overlap));
    await evaluate(s.cdp, "document.getElementById('wide-toggle').click()");
    await sleep(400);
    const w2 = await asideW();
    check('U-5: 「패널 넓게 보기」 → 오른쪽 패널이 넓어지고(그래프는 줄어도 300px 이상), 한 번 더 누르면 원래대로', w1.aside > w0.aside + 150 && w1.graph >= 300 && w1.pressed === 'true' && w1.label.includes('좁게') && w2.aside === w0.aside && w2.pressed === 'false', JSON.stringify([w0, w1, w2]));
    // 패널 폭 끌기 손잡이: 보이고 크기가 있다 → ←로 20px 넓어진다 → 두 번 누르면 기본 폭(380)으로 돌아온다
    const handle0 = await evaluate(s.cdp, "(() => { const r = document.getElementById('panel-resizer').getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), role: document.getElementById('panel-resizer').getAttribute('role') }; })()");
    // 폭을 바꿔도 보던 가운데가 그대로(사용자 지적 2026-10-23: 넓히면 오른쪽이 가려짐): 꼭지 노드의 "그래프 가운데에서의 거리"가 변하지 않아야 한다
    // 배율은 폭 비율대로(노드 크기가 따라옴), 가운데 노드의 "가운데에서의 상대 거리"는 폭 비율로 줄어든다
    const centerOff = () => evaluate(s.cdp, "(() => { const c = window.__wu.cy.container().getBoundingClientRect(); const n = window.__wu.cy.nodes().filter((x) => x.visible())[0]; if (!n) return { dx: 0, dy: 0, w: Math.round(c.width), zoom: window.__wu.cy.zoom(), none: true }; const p = n.renderedPosition(); return { dx: p.x - c.width / 2, dy: p.y - c.height / 2, w: Math.round(c.width), zoom: window.__wu.cy.zoom() }; })()");
    const off0 = await centerOff();
    for (let k = 0; k < 5; k += 1) await evaluate(s.cdp, "document.getElementById('panel-resizer').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }))");
    await sleep(400);
    const off1 = await centerOff();
    const ratio = off1.w / off0.w;
    check('패널 폭을 100px 넓히면 그래프 배율이 폭 비율대로 줄고(노드 크기 따라옴) 가운데는 그대로(가려지지 않음)', off1.w === off0.w - 100 && Math.abs(off1.zoom / off0.zoom - ratio) < 0.02 && Math.abs(off1.dx - off0.dx * ratio) <= 2 && Math.abs(off1.dy - off0.dy * ratio) <= 2, JSON.stringify([off0, off1]));
    for (let k = 0; k < 4; k += 1) await evaluate(s.cdp, "document.getElementById('panel-resizer').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))");
    await sleep(300);
    const wk1 = await asideW();
    await evaluate(s.cdp, "document.getElementById('panel-resizer').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))");
    await sleep(300);
    const wk2 = await asideW();
    check('패널 폭 손잡이: 보이고(폭 4px 이상·높이 100px 이상), ←키로 20px 넓어지고, 두 번 누르면 기본 폭(380)으로 돌아옴', handle0.w >= 4 && handle0.h >= 100 && handle0.role === 'separator' && wk1.aside === w0.aside + 20 && wk2.aside === 380, JSON.stringify([handle0, w0, wk1, wk2]));
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
    // 2026-10-18 CR-13 A: 거르기는 「도구 더 보기」 줄로 옮겼다. 찾기 칸·「다시 정렬」「전체 보기」「도구 더 보기」는 한 줄, 펼친 줄에 거르기가 보임(위 점검에서 펼쳐 둠)
    check('T-18: 그래프 위에 찾기 칸(옆에 「설명·속성까지」)·「다시 정렬」「전체 보기」「도구 더 보기」가 한 줄에, 펼친 도구 줄에 거르기가 보임(크기 있음)', await evaluate(s.cdp, "(() => { const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 ? b : null; }; const f = r('[data-testid=find-input]'), g = r('[data-testid=filter-open]'), t = r('#fit'), u = r('#tools-toggle'), q = r('#relayout'), w = r('[data-testid=find-wide]'); return !!(f && g && t && u && q && w) && Math.abs(w.top - f.top) < 20 && w.left > f.right - 2 && Math.abs(f.top - t.top) < 20 && Math.abs(u.top - t.top) < 20 && Math.abs(q.top - t.top) < 20; })()"));

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
    // 2026-10-18 CR-13 A: 거르기·「설명·속성까지」가 「도구 더 보기」 줄로 옮겨 가 찾음 상태 줄이 줄을 늘리지 않는다(예전엔 줄이 늘며 그래프가 줄어 동그라미가 25px 위로 보였다).
    // 줄이 안 변하니 동그라미는 이름 높이만큼 더 위(-33px)로 남는다. 이름까지 합친 상자가 가운데라는 뜻은 같아서 세로 허용을 30 → 40px로 넓힘
    check('R-17 ① 찾은 노드가 그래프 가운데 근처로(가로 10px, 세로 40px 안)', Math.abs(mid.dx) <= 10 && Math.abs(mid.dy) <= 40, JSON.stringify(mid));
    await shot(s.cdp, `${browser.name}-12-find-picked`);
    await key('Escape', 'Escape', 27);
    check('R-17 ⑧ Esc(상세 제목에 초점) → 노드 선택 해제', (await evaluate(s.cdp, 'window.__wu.selected')) === null);
    await key('Escape', 'Escape', 27);
    check('R-17 ⑧ 선택이 없을 때 Esc → 아무 일 없음(오류 없음, 유니버스 요약 그대로)', (await evaluate(s.cdp, 'window.__wu.selected')) === null && (await text(s.cdp, '#detail')).length > 0);
    // ② 없는 이름, Enter 바로 누르기
    await typeFind('없는이름xyz');
    check('R-17 ② 없는 이름 → 「찾는 항목 없음」', (await text(s.cdp, '[data-testid=find-none]')).includes('찾는 항목 없음')); // CR-18-2
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
    // T-26 「설명·속성까지」(R-22 ①, D-24): 기본 켬 → 설명·속성에만 있는 낱말이 위치 표시와 함께 나옴, 끄면 이름만, 이름 일치가 먼저
    const wideBox = await evaluate(s.cdp, "(() => { const c = document.querySelector('[data-testid=find-wide]'); if (!c) return null; const r = c.getBoundingClientRect(); const t = document.querySelector('[data-testid=find-input]').getBoundingClientRect(); return { checked: c.checked, w: r.width, h: r.height, sameRow: Math.abs(r.top - t.top) < 30 }; })()"); // 재검증 R-1(2026-10-18): 「설명·속성까지」는 찾기 칸 옆(「도구 더 보기」와 상관없이 늘 보임)
    check('R-22 ① 찾기 상자 옆에 「설명·속성까지」 선택이 있고 기본으로 켜져 있음(크기 있음)', !!wideBox && wideBox.checked && wideBox.w > 0 && wideBox.h > 0 && wideBox.sameRow, JSON.stringify(wideBox));
    const hitRows = () => evaluate(s.cdp, "[...document.querySelectorAll('[data-testid=find-hit]')].map((b) => b.dataset.gid + '|' + ((b.querySelector('[data-testid=find-where]') || {}).textContent || ''))");
    await typeFind('가상정산시스템');
    const wideOn = await hitRows();
    await shot(s.cdp, `${browser.name}-26a-find-wide`);
    check('R-22 ① 켬: 설명·속성에만 있는 낱말(가상정산시스템) → 결과에 나오고 어디서 찾았는지(속성 「…」) 표시', wideOn.length === 2 && wideOn.some((h) => h.startsWith('U-A1/N-001|속성 「사용 시스템」')) && wideOn.some((h) => h.startsWith('U-A1/N-002|속성 「절차」')), JSON.stringify(wideOn));
    await typeFind('점검표');
    const nameFirst = await hitRows();
    const wi = nameFirst.findIndex((h) => !h.endsWith('|'));
    check('R-22 ① 이름 일치(위치 표시 없음)가 먼저, 설명·속성 일치(위치 표시 있음)가 그 아래', wi > 0 && nameFirst.slice(0, wi).every((h) => h.endsWith('|')) && nameFirst.slice(wi).every((h) => !h.endsWith('|')), JSON.stringify(nameFirst.slice(0, 6)));
    await evaluate(s.cdp, "document.querySelector('[data-testid=find-wide]').click()");
    await sleep(150);
    const offRows = await hitRows();
    check('R-22 ① 끔: 이름 일치만 남고 위치 표시가 없음', offRows.length > 0 && offRows.length === wi && offRows.every((h) => h.endsWith('|')), JSON.stringify(offRows));
    await typeFind('가상정산시스템');
    check('R-22 ① 끔: 설명·속성에만 있는 낱말은 「찾는 항목 없음」', (await text(s.cdp, '[data-testid=find-none]')).includes('찾는 항목 없음')); // CR-18-2
    await evaluate(s.cdp, "document.querySelector('[data-testid=find-wide]').click()");
    await sleep(150);
    check('R-22 ① 다시 켜면 다시 찾음', (await hitRows()).length === 2);
    // 재검증 R-1(2026-10-18): 결과 목록이 열린 상태에서 실제 마우스로 「설명·속성까지」를 누르면 결과가 눌리지 않고 그 칸이 바뀐다(예전에는 도구 줄 아래라 목록이 덮었음)
    const wideCenter = () => evaluate(s.cdp, "(() => { const c = document.querySelector('[data-testid=find-wide]'); const r = c.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2; const top = document.elementFromPoint(x, y); const list = document.querySelector('[data-testid=find-results]'); const lr = list.getBoundingClientRect(); return { x, y, topIsCheck: top === c || (top && top.closest('label') === c.closest('label')), listOpen: !list.hidden, overlapsList: !list.hidden && x > lr.left && x < lr.right && y > lr.top && y < lr.bottom }; })()");
    const realClick = async (x, y) => { for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) { await s.cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }); await sleep(30); } await sleep(150); };
    const selBefore = await evaluate(s.cdp, 'window.__wu.selected');
    const wc = await wideCenter();
    await realClick(wc.x, wc.y);
    const wideAfter = await evaluate(s.cdp, "({ checked: document.querySelector('[data-testid=find-wide]').checked, selected: window.__wu.selected, open: !document.querySelector('[data-testid=find-results]').hidden })");
    check('R-1 재검증: 결과 목록이 열린 채로 「설명·속성까지」를 실제 마우스로 누르면 그 칸이 꺼지고(결과가 눌리지 않음, 선택 그대로), 목록이 그 칸을 덮지 않음', wc.listOpen && wc.topIsCheck && !wc.overlapsList && wideAfter.checked === false && wideAfter.selected === selBefore, JSON.stringify({ wc, wideAfter, selBefore }));
    await shot(s.cdp, `${browser.name}-26b-find-wide-click`);
    const wc2 = await wideCenter();
    await realClick(wc2.x, wc2.y);
    check('R-1 재검증: 한 번 더 누르면 다시 켜짐(목록은 다시 찾은 결과)', (await evaluate(s.cdp, "document.querySelector('[data-testid=find-wide]').checked")) === true && (await hitRows()).length === 2);
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
    check('R-17 ③ 거르기 중 저장(사람·업무·문서 추가) → 새 주제 노드는 거르기에서 빠지지만(표시 유지), 고른 노드라 또렷하게 보임(R-02 ①)', addR.code === 'OK' && !!lonelyGid && outAfter === outBefore + 1 && (await text(s.cdp, '[data-testid=filter-on]')).includes('거르기 중') && Number(await evaluate(s.cdp, `window.__wu.cy.getElementById(${JSON.stringify(lonelyGid)}).pstyle('opacity').value`)) === 1, `${outBefore} → ${outAfter}`);
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
    check('R-17 ④ 오류: 이웃 없는 노드 → 「이어진 항목 없음」 알림, 화면 그대로', (await text(s.cdp, '[data-testid=explore-note]')).includes('이어진 항목 없음') && (await evaluate(s.cdp, 'window.__wu.nbhd')) === null && (await shownCount()) === countLonely); // CR-18-2
    // 숨긴 노드는 찾기에 나오지 않음
    await evaluate(s.cdp, "window.confirm = () => true");
    await evaluate(s.cdp, "(document.querySelector('[data-testid=btn-hide]') || { click() {} }).click()");
    await sleep(300);
    await typeFind('T18 외톨이');
    check('R-17 ② 숨긴 노드는 찾기에 나오지 않음', !!(await evaluate(s.cdp, "!!document.querySelector('[data-testid=find-none]')")));
    await key('Escape', 'Escape', 27);
    // 검토 A·B 중간-2: 주변만 보기 중 사람·업무·문서 추가(주변 밖) → 전체로 돌아가 새 노드가 그래프에 보이고 선택됨
    await evaluate(s.cdp, "window.__wu.select('U-A1/N-001')");
    await sleep(150);
    await clickTestId(s.cdp, 'btn-nbhd');
    await sleep(400);
    await evaluate(s.cdp, "window.__wu.select(null)");
    await evaluate(s.cdp, "document.querySelector('details.add').open = true");
    const addNb = await submitAdd(s.cdp, 'work', 'T18 주변 밖 새 업무');
    await sleep(400);
    const nbAdd = await evaluate(s.cdp, "(() => { const g = window.__wu.selected; return { nbhd: window.__wu.nbhd, inGraph: !!g && !window.__wu.cy.getElementById(g).empty(), label: (window.__wu.view.getNode(g || '') || {}).label }; })()");
    check('R-17 ④·R-02 ① 주변만 보기 중 사람·업무·문서 추가 → 전체로 돌아가 새 노드가 그래프에 보이고 선택됨', addNb.code === 'OK' && nbAdd.nbhd === null && nbAdd.inGraph && nbAdd.label === 'T18 주변 밖 새 업무', JSON.stringify(nbAdd));
    // 검토 B-3: 주변만 보기 중 하위 유니버스 꼭지 펼치기(더블클릭과 같은 toggle) → 주변만 보기를 끝내고 전체에서 펼침
    await evaluate(s.cdp, "window.__wu.select('U-D1/N-000')");
    await sleep(150);
    check('D8-3: 부서 화면(노드 15개 초과)에서 노드를 고르면 「주변만 보기」가 첫 줄에 보임(크기 있음, 「더 보기」 밖)', await evaluate(s.cdp, "(() => { const b = document.querySelector('#detail .toolbar > [data-testid=btn-nbhd]'); if (!b) return false; const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !b.closest('details'); })()"));
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
  await evaluate(s.cdp, "sessionStorage.setItem('__confirmMsg', ''); window.confirm = (m) => { sessionStorage.setItem('__confirmMsg', m); return true; }; document.getElementById('import-open').click()").catch(() => {});
  await sleep(300);
  const roReset = await evaluate(s.cdp, "(() => { const d = document.getElementById('import-dialog'); const adv = d && d.querySelector('details.danger-zone'); const closedAtFirst = !!(adv && !adv.open); if (adv) adv.open = true; /* 2회차 FU-25: 「고급」 안에 접혀 있어 먼저 펼친다 */ const b = d && d.querySelector('[data-testid=reset-all]'); if (!d || !d.open || !b) return { open: !!(d && d.open), btn: false }; const r = b.getBoundingClientRect(); return { open: true, btn: true, disabled: b.disabled, size: r.width > 0 && r.height > 0, closedAtFirst }; })()");
  check('오류(12.1) 복구 경로: 읽기 전용 문서에서도 「가져오기·내보내기」 창이 열리고 안의 「가상 데이터 초기화」가 눌릴 수 있음', roReset && roReset.open && roReset.btn && !roReset.disabled && roReset.size && roReset.closedAtFirst, JSON.stringify(roReset));
  await evaluate(s.cdp, "document.getElementById('reset').click()").catch(() => {});
  await sleep(600);
  await waitFor(s.cdp, "window.__wu && window.__wu.doc && window.__wu.cy.nodes().length > 0", 8000);
  const resetMsg = (await evaluate(s.cdp, "sessionStorage.getItem('__confirmMsg')").catch(() => '')) || '';
  await waitFor(s.cdp, "window.__wu && window.__wu.doc && window.__wu.doc.universe.id === 'U-A1' && window.__wu.cy.nodes().length > 0", 8000);
  check('U-9: 초기화 확인 문구가 직접 만들거나 가져온 업무 지도도 지워진다고 알림', resetMsg.includes('초기 샘플로 되돌립니다') && resetMsg.includes('직접 만들거나 가져온 업무 지도') && resetMsg.includes('내보내세요'), resetMsg);
  check('NFR 복구: 가상 데이터 초기화 → 샘플이 처음 상태(추가 노드 없음, 수정 되돌림, 쓰기 가능)', (await nodeCount(s.cdp)) === NODES && !(await hasLabel(s.cdp, newLabel)) && !(await evaluate(s.cdp, "window.__wu.readOnly")) && !(await evaluate(s.cdp, "(window.__wu.doc.nodes.find((n) => n.id === 'N-001').description || '').includes('(수정)')")));

  // ── CR-14 B 인수인계 위험(R-26): 초기화 직후 원본 월말 정산에서(앞 단계가 데이터를 고치므로 여기서) ──
  await evaluate(s.cdp, "window.__wu.select(null)");
  await clickTestId(s.cdp, 'btn-insight-universe');
  await sleep(200);
  await clickTestId(s.cdp, 'tab-risk');
  await sleep(250);
  const riskSizes = await evaluate(s.cdp, "['risk-concentration','risk-readiness','risk-ripple'].map((id) => { const e = document.querySelector('[data-testid=' + id + ']'); if (!e) return 0; const r = e.getBoundingClientRect(); return Math.round(r.width * r.height); })");
  check('R-26: 「인수인계 위험」 탭에 세 절(지식 집중·준비도·파급 영향)이 그려짐(크기 있음)', riskSizes.every((x) => x > 2000), JSON.stringify(riskSizes));
  const conc = await text(s.cdp, '[data-testid=risk-concentration-list]');
  check('R-26 ①: 「자료 수집」·「보고」가 윤바다 혼자 해 본 업무(높음)로 나옴, 「대사 확인」은 아님', conc.includes('자료 수집') && conc.includes('보고') && conc.includes('윤바다') && !conc.includes('대사 확인'), conc.slice(0, 160));
  await evaluate(s.cdp, "document.querySelectorAll('[data-testid=risk-readiness-fold]').forEach((d) => { d.open = true; })"); // 업무별 빠진 항목은 기본 접힘(FU-31) — 펼친 뒤 읽는다
  const ready = await text(s.cdp, '[data-testid=risk-readiness-list]');
  check('R-26 ②: 준비도 n/6이 낮은 순(「보고」 2/6이 먼저, 「대사 확인」 5/6)', ready.indexOf('보고') >= 0 && ready.indexOf('보고') < ready.indexOf('대사 확인') && ready.includes('2/6') && ready.includes('5/6'), ready.slice(0, 160));
  const rip = await text(s.cdp, '[data-testid=risk-ripple-works]');
  check('R-26 ③: 길목 업무 「자료 수집」과 경로 자료 수집 → 대사 확인 → 보고', rip.includes('자료 수집') && rip.includes('대사 확인') && rip.includes('보고'), rip.slice(0, 160));
  const riskBody = await text(s.cdp, '[data-testid=risk-body]');
  check('R-26 ④: 설명 문장은 사전 생성(윤바다 한 사람만 맡아 왔고 …)', riskBody.includes('윤바다 한 사람만 맡아 왔고'), riskBody.slice(0, 200));
  await shot(s.cdp, `${browser.name}-7f-risk`);
  await evaluate(s.cdp, "window.__wu.select('U-A1/N-002')");
  await sleep(200);
  const riskNote = await text(s.cdp, '[data-testid=risk-note]');
  check('R-26 ⑤: 업무 상세(자료 수집)에 「지식 집중 위험 높음 — 윤바다만 해 봤고」 한 줄', riskNote.includes('지식 집중 위험 높음') && riskNote.includes('윤바다'), riskNote);
  await clickTestId(s.cdp, 'btn-risk-note');
  await sleep(250);
  check('R-26 ⑤: 「인수인계 위험 보기」 → 인사이트 「인수인계 위험」 탭이 열림', await evaluate(s.cdp, "!!document.querySelector('[data-testid=tab-risk].active') && !!document.querySelector('[data-testid=risk-body]')"));
  await evaluate(s.cdp, "window.__wu.select('U-A1/N-001')");
  await sleep(200);
  check('R-26 ⑤: 둘이 해 본 「대사 확인」에는 지식 집중 위험 줄이 없음', !(await evaluate(s.cdp, "!!document.querySelector('[data-testid=risk-note]')")));
  // ── 일곱 번째 검토 「나」 묶음(R7-2·R7-4·R7-5): 업무 상세 단추 정리, 머리글 정리, 용어 풀이. 데이터를 바꾸지 않는다 ──
  await evaluate(s.cdp, "window.__wu.select(window.__wu.view.nodes.find((n) => n.core_type === 'work' && !n.hidden).gid)");
  await sleep(200);
  const topBtns = await evaluate(s.cdp, "[...document.querySelectorAll('#detail .toolbar > button')].map((b) => b.textContent).join('|')");
  check('R7-2: 업무 상세에는 수정·연결 추가·이력 추가·인수인계 초안 만들기·이력으로만 한 줄에 보임', topBtns === '수정|연결 추가|이력 추가|인수인계 초안 만들기|이력으로', topBtns);
  const moreInfo = await evaluate(s.cdp, "(() => { const d = document.querySelector('details.more-tools'); return d && { open: d.open, btns: [...d.querySelectorAll('button')].map((b) => b.dataset.testid) }; })()");
  check('R7-2: 「더 보기」는 닫혀 있고 숨기기·유사 경험자·인사이트 보기·주변만 보기·주변 2단계가 들어 있음', !!moreInfo && !moreInfo.open && ['btn-hide', 'btn-similar', 'btn-insight', 'btn-nbhd', 'btn-nbhd2'].every((t) => moreInfo.btns.includes(t)), JSON.stringify(moreInfo));
  check('D8-3: 월말 정산(노드 15개 이하)에서는 「주변만 보기」가 첫 줄에 없고 「더 보기」 안에 있음', await evaluate(s.cdp, "!document.querySelector('#detail .toolbar > [data-testid=btn-nbhd]') && !!document.querySelector('#detail details.more-tools [data-testid=btn-nbhd]')"));
  await shot(s.cdp, `${browser.name}-27a-detail-more-closed`);
  await evaluate(s.cdp, "document.querySelector('details.more-tools summary').focus()");
  check('R7-2: 「더 보기」 summary가 포커스를 받음(키보드 접근)', (await evaluate(s.cdp, 'document.activeElement.tagName')) === 'SUMMARY');
  await evaluate(s.cdp, "document.querySelector('details.more-tools summary').click()");
  await sleep(100);
  check('R7-2: 「더 보기」를 열면 단추가 보임(크기 있음)', await evaluate(s.cdp, "document.querySelector('[data-testid=btn-hide]').getBoundingClientRect().height > 0"));
  await shot(s.cdp, `${browser.name}-27b-detail-more-open`);
  await clickTestId(s.cdp, 'btn-history-jump');
  await sleep(200);
  check('R7-2: 「이력으로」를 누르면 「이력」 제목에 포커스가 가고 보이는 영역 안에 옴', await evaluate(s.cdp, "(() => { const h = document.querySelector('[data-testid=history-heading]'); if (!h) return false; const r = h.getBoundingClientRect(); return document.activeElement === h && r.top >= 0 && r.top < innerHeight; })()"));
  await evaluate(s.cdp, "window.__wu.select(window.__wu.view.nodes.find((n) => n.core_type === 'person' && !n.hidden).gid)");
  await sleep(200);
  check('R7-2: 사람 노드도 수정·연결 추가·이력 추가·이력으로 + 접힌 「더 보기」', (await evaluate(s.cdp, "[...document.querySelectorAll('#detail .toolbar > button')].map((b) => b.textContent).join('|')")) === '수정|연결 추가|이력 추가|이력으로' && !!(await evaluate(s.cdp, "document.querySelector('details.more-tools')")));
  check('R7-4: 머리글에 「설정」은 있고 「가상 데이터 초기화」는 없음', (await text(s.cdp, '#settings-open')) === '설정' && !(await evaluate(s.cdp, "[...document.querySelectorAll('header button')].some((b) => b.textContent.includes('가상 데이터 초기화'))")));
  await evaluate(s.cdp, "document.getElementById('import-open').click()");
  await sleep(300);
  check('R7-4(2회차 FU-25): 「가져오기·내보내기」 창 맨 아래 「고급」(기본 접힘) 안 위험 구역에 「가상 데이터 초기화」', await evaluate(s.cdp, "(() => { const d = document.querySelector('#import-dialog'); const z = d.querySelector('.danger-zone'); return !!z && !!z.querySelector('[data-testid=reset-all]') && z === d.lastElementChild && z.tagName === 'DETAILS' && !z.open && z.querySelector('summary').textContent === '고급'; })()"));
  await evaluate(s.cdp, "document.querySelector('#import-dialog .danger-zone').open = true; document.querySelector('#import-dialog .danger-zone').scrollIntoView({ block: 'center' })");
  await sleep(150);
  await shot(s.cdp, `${browser.name}-27c-import-danger-zone`);
  await clickTestId(s.cdp, 'import-close');
  await sleep(150);
  await evaluate(s.cdp, 'window.__wu.select(null)');
  await sleep(150);
  check('R7-5: 개요에 용어 한 줄(업무 지도·노드·꼭지)', (await text(s.cdp, '[data-testid=term-note]')).includes('지도 중심')); // CR-18-2
  // ── 사용자 화면 확인 의견 2026-10-17: 사람·업무·문서 추가 때 함께 이을 노드, 연결 수정에서 관계·상대 바꾸기 ──
  await s.cdp.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
  await evaluate(s.cdp, "window.confirm = () => true; window.__wu.select(null)");
  await sleep(200);
  const fb17Form = (fields) => evaluate(s.cdp, `(() => {
    const slot = document.getElementById('add-slot');
    const set = (id, v) => { const e = slot.querySelector('[data-testid=' + id + ']'); if (!e) return false; if (id === 'node-link-other') e.dispatchEvent(new Event('focus')); e.value = v; e.dispatchEvent(new Event('change')); return true; };
    const f = ${JSON.stringify(fields)};
    for (const [k, v] of Object.entries(f)) if (!set(k, v)) return 'missing ' + k;
    return 'ok';
  })()`);
  const fb17Submit = () => evaluate(s.cdp, "document.getElementById('add-slot').querySelector('button[type=submit]').click()");
  const fb17Msg = () => evaluate(s.cdp, "(() => { const m = document.querySelector('#add-slot [data-testid=form-message]'); return m ? { code: m.dataset.code || '', text: m.textContent } : null; })()");
  const fb17Counts = () => evaluate(s.cdp, "({ nodes: window.__wu.doc.nodes.length, edges: window.__wu.doc.edges.length })");
  check('사람·업무·문서 추가 양식에 「함께 이을 노드(선택)」 칸이 보임(크기 있음), 비워 두면 관계·방향 칸은 숨음', await evaluate(s.cdp, "(() => { const o = document.querySelector('#add-slot [data-testid=node-link-other]'); const d = document.querySelector('#add-slot .link-detail'); const r = o.getBoundingClientRect(); return r.width > 0 && r.height > 0 && d.hidden; })()"));
  const fb17Before = await fb17Counts();
  const fb17Reveal = () => evaluate(s.cdp, "(() => { const slot = document.getElementById('add-slot'); const d = slot.closest('details'); if (d) d.open = true; slot.scrollIntoView({ block: 'end' }); })()");
  await fb17Reveal();
  await sleep(150);
  // 사람이 업무를 고르면 관계가 「수행」, 방향이 새 노드 → 상대로 자동 추천된다
  await fb17Form({ 'node-type': 'person', 'node-label': '시험 담당자', 'node-link-other': 'N-001' });
  const fb17Auto = await evaluate(s.cdp, "(() => { const q = (id) => document.querySelector('#add-slot [data-testid=' + id + ']'); return { rel: q('node-link-type').value, dir: q('node-link-direction').value, shown: !document.querySelector('#add-slot .link-detail').hidden }; })()");
  check('함께 이을 노드로 업무를 고르면 관계 수행·방향 새 노드 → 상대가 추천되고 칸이 보임', fb17Auto.rel === 'performs' && fb17Auto.dir === 'out' && fb17Auto.shown, JSON.stringify(fb17Auto));
  await fb17Reveal();
  await sleep(100);
  await shot(s.cdp, `${browser.name}-fb17-a-node-add-link`);
  // 허용되지 않는 조합(산출물 → 업무 수행). 처음 사용 5회차(FU5-9)로 바뀜: 못 쓰는 「수행」은 고를 수 없어 되돌아가므로 저장 단계의 E-PAIR 대신 「고를 수 없음」을 확인한다(노드·연결 모두 저장하지 않음)
  await fb17Form({ 'node-type': 'artifact', 'node-label': '시험 산출물', 'node-link-other': 'N-001', 'node-link-type': 'performs' });
  await sleep(200);
  const fb17Pair = await evaluate(s.cdp, "(() => { const q = (id) => document.querySelector('#add-slot [data-testid=' + id + ']'); const m = document.querySelector('#add-slot [data-testid=form-message]'); return { rel: q('node-link-type').value, performsDisabled: [...q('node-link-type').querySelectorAll('optgroup option')].some((o) => o.value === 'performs' && o.disabled), err: m ? m.dataset.code || '' : '' }; })()");
  const fb17After1 = await fb17Counts();
  check('FU5-9 함께 이을 노드: 산출물 → 업무에서 「수행」은 못 쓰는 보기(disabled)라 고를 수 없고(스크립트로 넣어도 되돌아가 「산출」 등 쓸 수 있는 값), 오류 없이 노드·연결 모두 저장 안 됨', fb17Pair.rel !== 'performs' && fb17Pair.performsDisabled && fb17Pair.err === '' && fb17After1.nodes === fb17Before.nodes && fb17After1.edges === fb17Before.edges, JSON.stringify([fb17Pair, fb17After1]));
  await fb17Reveal();
  await sleep(100);
  await shot(s.cdp, `${browser.name}-fb17-b-node-add-pair-error`);
  // 정상: 사람 → 업무 수행으로 한 번에 저장
  await fb17Form({ 'node-type': 'person', 'node-label': '시험 담당자', 'node-link-other': 'N-001' });
  await fb17Submit();
  await sleep(300);
  const fb17Saved = await evaluate(s.cdp, "(() => { const d = window.__wu.doc; const n = d.nodes.find((x) => x.label === '시험 담당자'); const e = n && d.edges.find((x) => x.source === n.id && x.target === 'N-001' && x.core_type === 'performs' && !x.hidden); const ev = n ? d.events.filter((x) => x.payload && (x.payload.target_id === n.id || (e && x.payload.target_id === e.id))).length : 0; return { id: n && n.id, edge: !!e, events: ev, drawn: !!n && !window.__wu.cy.getElementById('U-A1/' + n.id).empty() && window.__wu.cy.edges().some((x) => x.data('source') === 'U-A1/' + n.id && x.data('target') === 'U-A1/N-001') }; })()");
  check('함께 이을 노드를 골라 추가 → 노드와 수행 연결이 한 번에 생기고 그래프에 그려짐(이력 둘)', !!fb17Saved.id && fb17Saved.edge && fb17Saved.events === 2 && fb17Saved.drawn, JSON.stringify([fb17Saved, await fb17Msg()]));
  // 연결 수정: 관계를 수행 → 참조로 바꾸면 옛 연결은 목록에서 사라지고 새 관계로 보인다
  await evaluate(s.cdp, `window.__wu.select('U-A1/${fb17Saved.id}')`);
  await sleep(250);
  const fb17Btn = await evaluate(s.cdp, "(() => { const b = document.querySelector('#detail .link-tools button'); return b ? { text: b.textContent, title: b.title } : null; })()");
  check('연결 줄 「수정」 단추의 title이 관계·상대·기간·메모 고치기', !!fb17Btn && fb17Btn.text === '연결 수정' && fb17Btn.title === '관계·상대·기간·메모 고치기', JSON.stringify(fb17Btn));
  await evaluate(s.cdp, "document.querySelector('#detail .link-tools button').click()");
  await sleep(200);
  const fb17Edit = await evaluate(s.cdp, "(() => { const f = document.querySelector('#detail [data-testid=edge-edit-form]'); if (!f) return null; const q = (id) => f.querySelector('[data-testid=' + id + ']'); const r = q('edge-edit-type').getBoundingClientRect(); return { rel: q('edge-edit-type').value, other: q('edge-edit-other').value, dir: q('edge-edit-direction').value, hint: q('edge-edit-hint').textContent, size: r.width > 0 && r.height > 0 }; })()");
  check('연결 수정 양식에 관계·방향·상대 칸이 현재 값으로 채워지고 안내 한 줄이 보임', !!fb17Edit && fb17Edit.rel === 'performs' && fb17Edit.other === 'N-001' && fb17Edit.dir === 'out' && fb17Edit.size && fb17Edit.hint.includes('옛 연결은 숨기고(기록은 남음) 새 연결을 만듭니다'), JSON.stringify(fb17Edit));
  await shot(s.cdp, `${browser.name}-fb17-c-edge-edit`);
  // 허용되지 않는 관계(산출). 처음 사용 5회차(FU5-9)로 바뀜: 못 쓰는 보기는 고를 수 없어 값이 그대로(수행)이고 연결은 그대로, 오류 줄도 없다(예전: 저장 때 E-PAIR)
  const fb17EditErr = await evaluate(s.cdp, `(() => { const f = document.querySelector('#detail [data-testid=edge-edit-form]'); const t = f.querySelector('[data-testid=edge-edit-type]'); const was = t.value; t.value = 'produces'; t.dispatchEvent(new Event('change', { bubbles: true })); const m = f.querySelector('[data-testid=form-message]'); return { was, now: t.value, producesDisabled: [...t.querySelectorAll('option')].some((o) => o.value === 'produces' && o.disabled), err: m ? m.dataset.code || '' : '' }; })()`);
  await sleep(200);
  check('FU5-9 연결 수정: 못 쓰는 관계(산출)는 고를 수 없어 값이 그대로(수행), 오류 없이 옛 연결이 그대로', fb17EditErr.was === 'performs' && fb17EditErr.now === 'performs' && fb17EditErr.producesDisabled && fb17EditErr.err === '' && (await evaluate(s.cdp, `window.__wu.doc.edges.filter((e) => e.source === '${fb17Saved.id}' && !e.hidden).length`)) === 1, JSON.stringify(fb17EditErr));
  const fb17Ev0 = await evaluate(s.cdp, 'window.__wu.doc.events.length');
  await fillPanelForm(s.cdp, { 'edge-edit-type': 'references' });
  await sleep(300);
  const fb17Links = await text(s.cdp, '#detail [data-testid=links]');
  const fb17Edges = await evaluate(s.cdp, `window.__wu.doc.edges.filter((e) => e.source === '${fb17Saved.id}').map((e) => e.core_type + ':' + e.hidden)`);
  check('연결 수정에서 관계를 바꾸면 옛 연결(수행)은 목록에서 사라지고 새 관계(참조)로 보이며 이력 둘(숨김·생성)', fb17Links.includes('참조') && !fb17Links.includes('수행') && fb17Edges.join() === 'performs:true,references:false' && (await evaluate(s.cdp, 'window.__wu.doc.events.length')) === fb17Ev0 + 2, JSON.stringify([fb17Links.slice(0, 80), fb17Edges]));
  await shot(s.cdp, `${browser.name}-fb17-d-edge-replaced`);
  await s.cdp.send('Emulation.clearDeviceMetricsOverride');
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
  check('R-19 ① ② 확정 인수인계서 상세 첫 줄(「더 보기」 밖)에 「내려받기」「인쇄」 버튼이 보임(크기 있음, D8-3)', (await btnBox('doc-download')) && (await btnBox('doc-print')) && (await evaluate(s.cdp, "['doc-download', 'doc-print'].every((t) => { const b = document.querySelector('#detail .toolbar > [data-testid=' + t + ']'); return !!b && !b.closest('details'); }) && !document.querySelector('details.more-tools [data-testid=doc-download]')")));
  await clickTestId(s.cdp, 'doc-download');
  await sleep(200);
  const r19cname = await evaluate(s.cdp, 'window.__dl');
  const r19chtml = await evaluate(s.cdp, 'window.__blob ? window.__blob.text() : null');
  check('R-19 ① 확정본 내려받기 → …-대사_확인-인수인계서(확정).html, 본문·확정자·확정 시각·보내는/받는 사람 포함', typeof r19cname === 'string' && r19cname.endsWith('-대사_확인-인수인계서(확정).html') && !!r19chtml && r19chtml.includes('확정자: 사용자(이 브라우저)') && r19chtml.includes('확정 시각:') && r19chtml.includes('서하늘') && r19chtml.includes('윤바다') && r19chtml.includes('■ 업무 개요'), String(r19cname));
  await clickTestId(s.cdp, 'doc-print');
  await sleep(500);
  const r19cprint = await evaluate(s.cdp, 'window.__prints');
  check('R-19 ② 확정본 인쇄 → iframe print() 호출, 문서에 버튼·그래프 없음', r19cprint.length === 1 && r19cprint[0].interactive === 0 && r19cprint[0].html.includes('확정'), JSON.stringify(r19cprint.map((p) => p.interactive)));
  // R-19 ④: 내려받기가 막히면(createObjectURL 실패 흉내) 안내 문구가 보이고, 다시 성공하면 사라진다
  await evaluate(s.cdp, "window.__origCOU = URL.createObjectURL; URL.createObjectURL = () => { throw new Error('blocked'); }");
  await clickTestId(s.cdp, 'doc-download');
  await sleep(150);
  check('R-19 ④ 내려받기가 막히면 「내려받기가 막혔습니다 … 인쇄에서 PDF로 저장」 안내가 보임', await evaluate(s.cdp, "(() => { const m = document.querySelector('[data-testid=download-blocked]'); if (!m) return false; const r = m.getBoundingClientRect(); return r.width > 0 && r.height > 0 && m.textContent.includes('내려받기가 막혔습니다') && m.textContent.includes('PDF'); })()"));
  await evaluate(s.cdp, "URL.createObjectURL = window.__origCOU");
  await clickTestId(s.cdp, 'doc-download');
  await sleep(150);
  check('R-19 ④ 다시 내려받기에 성공하면 안내가 사라짐', await evaluate(s.cdp, "!document.querySelector('[data-testid=download-blocked]')"));
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
  const issueGroups = await evaluate(s.cdp, "[...document.querySelectorAll('[data-testid=issue-group]')].map((d) => ({ n: Number(d.dataset.count), open: d.open, items: d.querySelectorAll('[data-testid=issue-item]').length }))");
  check('미해결 목록(R7-3): 업무별 묶음 머리에 건수가 있고 항목 수와 같음', issueGroups.length > 0 && issueGroups.every((g) => g.n === g.items), JSON.stringify(issueGroups));
  check('미해결 목록(R7-3): 2건 이하 묶음은 펼침, 2건 넘는 묶음은 접힘(C12-13)', issueGroups.every((g) => g.open === (g.n <= 2)), JSON.stringify(issueGroups));
  check('미해결 목록(R7-3): 묶음 건수 순서가 내림차순', issueGroups.every((g, i) => i === 0 || issueGroups[i - 1].n >= g.n), JSON.stringify(issueGroups));
  await shot(s.cdp, `${browser.name}-13d-issues-grouped`);
  // 접힌 묶음 안의 「해결로 표시」는 크기가 0이므로 모든 묶음을 펼친 뒤 크기를 잰다
  await evaluate(s.cdp, "document.querySelectorAll('[data-testid=issue-group]').forEach((d) => { d.open = true; })");
  check('R-20 ① 누르면 목록(날짜·업무·내용·해결로 표시)이 뜨고 건수가 같음', r20Items0.length === r20c0.n && (await text(s.cdp, '#detail h2')).includes(`미해결 ${r20c0.n}건`) && (await btnBox('btn-resolve')) && r20Items0.every((x) => x.hasBtn), JSON.stringify(r20Items0.map((x) => x.gid)));
  const r20Prog0 = r20Items0.filter((x) => x.chip === '진행 중');
  check('R-20 ③ 목록의 「진행 중」 항목이 같은 업무 인수인계 초안의 「진행 중」과 같은 메모', r20Prog0.length === r20Draft0.length && r20Draft0.length > 0 && r20Draft0.every((d) => r20Prog0.some((x) => d.includes(x.text))), JSON.stringify([r20Prog0.length, r20Draft0.length]));
  check('미해결 화면에 "null" 글자 없음', (await nullTextSpots(s.cdp)).length === 0, (await nullTextSpots(s.cdp)).join(','));
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
  // CR-18 D-11: 해결하면 같은 항목에 「최근 해결: …」 줄이 붙는다 — 미해결 진행 중 문장만 비교하고, 최근 해결 줄은 따로 본다
  const r20All1 = await r20Draft();
  const r20Draft1 = r20All1.filter((t) => !t.startsWith('최근 해결: '));
  const r20Prog1 = r20Items1.filter((x) => x.chip === '진행 중');
  check('CR-18 D-11 해결 표시 뒤 초안 「진행 중」에 방금 해결한 메모의 「최근 해결: …(날짜)」 줄', r20All1.some((t) => t.startsWith('최근 해결: ') && t.includes(r20Target.text.slice(0, 8))), JSON.stringify(r20All1));
  check('R-20 ③ 해결 표시 뒤에도 초안의 「진행 중」과 목록의 「진행 중」이 같은 메모(1건 줄어듦)', r20Draft1.length === r20Draft0.filter((t) => !t.startsWith('최근 해결: ')).length - 1 && r20Draft1.length === r20Prog1.length && r20Draft1.every((d) => r20Prog1.some((x) => d.includes(x.text))), JSON.stringify([r20Draft0.length, r20Draft1.length, r20Prog1.length]));
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
  check('표로 추가 대화상자에 "null" 글자 없음', (await nullTextSpots(s.cdp)).length === 0, (await nullTextSpots(s.cdp)).join(','));
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
  check('R-18 ③: 오류 행 3개(이름 빔·기존과 중복·모르는 유형)를 사유와 함께 표시하고 아무것도 저장하지 않음', (await t19Count()) === t19n1 && (await t19Events()) === t19e1 && t19err[0] === '' && t19err[1].includes('이름') && t19err[2].includes('같은 항목') && t19err[3].includes('알 수 없는 유형') && (await evaluate(s.cdp, "document.getElementById('table-dialog').open")), JSON.stringify(t19err)); // CR-18-2
  check('R-18 ③: 「아무것도 저장하지 않았습니다」 안내', (await text(s.cdp, '[data-testid=table-message]')).includes('아무것도 저장하지 않았습니다'));
  await shot(s.cdp, `${browser.name}-19b-table-error`);
  await evaluate(s.cdp, "(() => { const set = (i, k, v) => { document.querySelector('[data-testid=table-' + k + '-' + i + ']').value = v; }; set(1, 'label', 'T19 오류시험 나'); set(2, 'label', 'T19 오류시험 둘'); set(3, 'type', '주제'); set(3, 'label', 'T19 오류시험 다'); })()");
  await clickTestId(s.cdp, 'table-save');
  await sleep(400);
  check('R-18 ③: 고친 뒤 다시 저장하면 전부 저장됨(4개)', (await t19Count()) === t19n1 + 4 && !(await evaluate(s.cdp, "document.getElementById('table-dialog').open")), `${t19n1} → ${await t19Count()}`);

  // CR-13 C 연결 칸: 기존 사람 이름 + 새 산출물 + 같은 표의 다른 업무를 다음 업무로 → 수행·산출·선후행 연결, 오류는 전체 거부
  const c13n0 = await t19Count();
  const c13e0 = await t19Events();
  await clickTestId(s.cdp, 'btn-table-add');
  await sleep(200);
  check('CR-13 C: 표 맨 위 안내(담당자·산출물·다음 업무 칸)와 연결 칸 머리글이 보임', (await text(s.cdp, '[data-testid=table-link-help]')).includes('담당자·산출물·다음 업무 칸에 이름을 적으면') && (await evaluate(s.cdp, "['담당자', '산출물', '다음 업무'].every((h) => [...document.querySelectorAll('[data-testid=table-grid] thead th')].some((th) => th.textContent === h))")));
  await t19Paste('유형\t이름\t담당자\t산출물\t다음 업무\n업무\tCR13 연결 업무 1\t서하늘\tCR13 새 산출물\tCR13 연결 업무 2\n업무\tCR13 연결 업무 2\t\t\t');
  await shot(s.cdp, `${browser.name}-19c-table-links`);
  const c13wrap = await evaluate(s.cdp, "(() => { const d = document.getElementById('table-dialog').getBoundingClientRect(); const w = document.querySelector('.batch-wrap'); return { dialogRight: Math.round(d.right), vw: window.innerWidth, scroll: w.scrollWidth > w.clientWidth, docScroll: document.documentElement.scrollWidth > window.innerWidth }; })()");
  check('CR-13 C: 칸이 많아도 가로 스크롤은 표 안에서만 생기고 대화상자가 화면 밖으로 나가지 않음', c13wrap.dialogRight <= c13wrap.vw && !c13wrap.docScroll, JSON.stringify(c13wrap));
  await clickTestId(s.cdp, 'table-save');
  await sleep(500);
  const c13 = await evaluate(s.cdp, `(() => {
    const d = window.__wu.doc; const by = (l) => d.nodes.find((n) => n.label === l);
    const w1 = by('CR13 연결 업무 1'); const w2 = by('CR13 연결 업무 2'); const out = by('CR13 새 산출물'); const p = by('서하늘');
    const has = (t, s, g) => d.edges.some((e) => e.core_type === t && e.source === s && e.target === g && !e.hidden);
    return { made: !!(w1 && w2 && out), people: d.nodes.filter((n) => n.label === '서하늘').length, perf: !!(w1 && p) && has('performs', p.id, w1.id), prod: !!(w1 && out) && has('produces', w1.id, out.id), prec: !!(w1 && w2) && has('precedes', w1.id, w2.id), hist: !!w1 && d.events.some((e) => e.type === 'assign_start' && e.payload.work_id === w1.id), cy: !!w1 && window.__wu.cy.edges().filter((e) => e.data('source') === 'U-A1/' + w1.id || e.data('target') === 'U-A1/' + w1.id).length };
  })()`);
  check('CR-13 C: 저장 → 수행·산출·선후행 연결이 문서에 생기고 그래프에 보임(새 사람은 만들지 않음, 담당 이력 남음)', !(await evaluate(s.cdp, "document.getElementById('table-dialog').open")) && c13.made && c13.people === 1 && c13.perf && c13.prod && c13.prec && c13.hist && c13.cy >= 3 && (await t19Count()) === c13n0 + 3, JSON.stringify(c13));
  check('CR-13 C: 이력 = 노드 3 + 꼭지 연결 2 + 산출·선후행 2 + 수행 1 + 담당 시작 1', (await t19Events()) === c13e0 + 9, `${c13e0} → ${await t19Events()}`);
  // 오류: 사람 행에 산출물 값 → 사유, 아무것도 저장되지 않음
  const c13n1 = await t19Count();
  const c13e1 = await t19Events();
  await clickTestId(s.cdp, 'btn-table-add');
  await sleep(150);
  await t19Paste('유형\t이름\t산출물\n업무\tCR13 오류시험 업무\t\n사람\tCR13 오류시험 사람\t보고서');
  await clickTestId(s.cdp, 'table-save');
  await sleep(300);
  const c13err = await evaluate(s.cdp, "[...document.querySelectorAll('[data-testid^=table-msg-]')].map((e) => e.textContent)");
  check('CR-13 C: 사람 행에 산출물 값 → 그 행에 「업무 행에만 씁니다」 사유, 아무것도 저장되지 않고 대화상자는 그대로', (await t19Count()) === c13n1 && (await t19Events()) === c13e1 && c13err[0] === '' && c13err[1].includes('업무 행에만 씁니다') && (await evaluate(s.cdp, "document.getElementById('table-dialog').open")), JSON.stringify(c13err));
  await shot(s.cdp, `${browser.name}-19d-table-links-error`);
  await clickTestId(s.cdp, 'table-close');
  await sleep(100);

  // ② 표로 고치기: 바꾼 행만 수정 이력(변경 전·후), 표에 없는 속성은 남음
  const t19e2 = await t19Events();
  await clickTestId(s.cdp, 'btn-table-edit');
  await sleep(200);
  check('표로 고치기 대화상자에 "null" 글자 없음', (await nullTextSpots(s.cdp)).length === 0, (await nullTextSpots(s.cdp)).join(','));
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

  // ── T-25 숨긴 노드 되살리기(R-21 ①, D-23): 숨김 → 개요 「숨긴 노드 n개」 → 목록 → 「되살리기」 → 연결·이력이 그대로 ──
  await evaluate(s.cdp, "window.__wu.select(null)");
  await sleep(150);
  check('R-21 숨긴 노드가 없으면 개요에 「숨긴 노드」 표시가 없음', !(await evaluate(s.cdp, "!!document.querySelector('[data-testid=hidden-count]')")));
  await evaluate(s.cdp, 'window.confirm = () => true');
  const r21Gid = 'U-A1/N-003';
  const r21Label = await evaluate(s.cdp, `window.__wu.view.getNode(${JSON.stringify(r21Gid)}).label`);
  const r21 = { nodes: await nodeCount(s.cdp), edges: await edgeCount(s.cdp) };
  await evaluate(s.cdp, `window.__wu.select(${JSON.stringify(r21Gid)})`);
  await sleep(150);
  const r21Links0 = await evaluate(s.cdp, "document.querySelectorAll('[data-testid=links] li').length");
  const r21Hist0 = await evaluate(s.cdp, "document.querySelectorAll('[data-testid=history] li').length");
  await clickTestId(s.cdp, 'btn-hide');
  await sleep(300);
  const r21Count = await evaluate(s.cdp, "(() => { const e = document.querySelector('[data-testid=hidden-count]'); if (!e) return null; const r = e.getBoundingClientRect(); return { count: e.dataset.count, text: e.textContent, w: r.width, h: r.height }; })()");
  check('R-21 ① 숨기면 그래프에서 빠지고 개요에 「숨긴 항목 1개」가 크기를 가지고 보임', !!r21Count && r21Count.count === '1' && r21Count.text.includes('숨긴 항목 1개') && r21Count.w > 0 && r21Count.h > 0 && (await nodeCount(s.cdp)) === r21.nodes - 1 && (await edgeCount(s.cdp)) < r21.edges, JSON.stringify([r21Count, r21])); // CR-18-2
  await clickTestId(s.cdp, 'btn-hidden');
  await sleep(200);
  const r21List = await evaluate(s.cdp, "[...document.querySelectorAll('[data-testid=hidden-item]')].map((li) => ({ id: li.dataset.id, text: li.textContent, btn: !!li.querySelector('[data-testid=btn-restore]') }))");
  check('R-21 ① 목록에 이름·유형·숨긴 날짜와 「되살리기」가 보임', r21List.length === 1 && r21List[0].id === 'N-003' && r21List[0].text.includes(r21Label) && r21List[0].text.includes('에 숨김') && r21List[0].btn, JSON.stringify(r21List));
  check('숨긴 노드 화면에 "null" 글자 없음', (await nullTextSpots(s.cdp)).length === 0, (await nullTextSpots(s.cdp)).join(','));
  await shot(s.cdp, `${browser.name}-21a-hidden-list`);
  await clickTestId(s.cdp, 'btn-restore');
  await sleep(400);
  check('R-21 ① 되살리면 그래프에 다시 보이고 노드·연결 수가 숨기기 전과 같음', (await nodeCount(s.cdp)) === r21.nodes && (await edgeCount(s.cdp)) === r21.edges && (await hasLabel(s.cdp, r21Label)), JSON.stringify([await nodeCount(s.cdp), await edgeCount(s.cdp), r21]));
  const r21After = await evaluate(s.cdp, "({ selected: window.__wu.selected, links: document.querySelectorAll('[data-testid=links] li').length, hist: [...document.querySelectorAll('[data-testid=history] li')].map((li) => li.textContent), note: !!document.querySelector('[data-testid=hidden-note]') })");
  check('R-21 ① 되살린 노드가 선택되어 연결 수가 그대로이고 숨김 안내가 없으며 이력에 「되살림」이 정확히 1건', r21After.selected === r21Gid && r21After.links === r21Links0 && !r21After.note && r21After.hist.filter((t) => t.includes('되살림')).length === 1 && r21After.hist.length === r21Hist0 + 2, JSON.stringify([r21After, r21Links0, r21Hist0]));
  check('R-21 문서에 updated(hidden true → false) 이벤트와 hidden false로 남음', await evaluate(s.cdp, "(() => { const d = window.__wu.doc; const e = d.events[d.events.length - 1]; return d.nodes.find((n) => n.id === 'N-003').hidden === false && e.type === 'updated' && e.payload.target_id === 'N-003' && e.payload.before.hidden === true && e.payload.after.hidden === false; })()"));
  await evaluate(s.cdp, "window.__wu.select(null)");
  await sleep(150);
  check('R-21 모두 되살리면 개요의 「숨긴 노드」 표시가 사라짐', !(await evaluate(s.cdp, "!!document.querySelector('[data-testid=hidden-count]')")));

  // ── CR-13 D 삭제: (가) 막 만든 노드는 「삭제」로 바로, (나) 연결·이력이 있는 노드는 숨긴 뒤 「완전히 삭제」(자리표시) ──
  {
    const delRevealSlot = () => evaluate(s.cdp, "(() => { const d = document.getElementById('add-slot').closest('details'); if (d) d.open = true; })()");
    const delSelect = async (gid) => { await evaluate(s.cdp, `window.__wu.select(${JSON.stringify(gid)})`); await sleep(200); };
    const delIdOf = (label) => evaluate(s.cdp, `(window.__wu.doc.nodes.find((n) => n.label === ${JSON.stringify(label)}) || {}).id || null`);
    const delConfirms = [];
    await evaluate(s.cdp, "window.__delMsgs = []; window.confirm = (m) => { window.__delMsgs.push(m); return true; }");
    await evaluate(s.cdp, 'window.__wu.select(null)');
    await sleep(150);
    await delRevealSlot();
    // (가) 바로 삭제
    const addA = await submitAdd(s.cdp, 'work', '삭제 시험 노드');
    check('삭제 시험: 사람·업무·문서 추가 성공', addA.code === 'OK', JSON.stringify(addA));
    const idA = await delIdOf('삭제 시험 노드');
    const delNodes0 = await nodeCount(s.cdp);
    await delSelect(`U-A1/${idA}`);
    check('삭제 (가) 막 만든 노드는 「더 보기」에 「삭제」가 있음(숨기기 옆)', await evaluate(s.cdp, "!!document.querySelector('#detail [data-testid=btn-delete]') && !!document.querySelector('#detail [data-testid=btn-hide]')"));
    await shot(s.cdp, `${browser.name}-cr13d-a-delete-btn`);
    await clickTestId(s.cdp, 'btn-delete');
    await sleep(350);
    const msgA = await evaluate(s.cdp, 'window.__delMsgs.at(-1)');
    check('삭제 (가) 확인 문구: 연결·이력이 없어 바로 지워지고 되돌릴 수 없음', typeof msgA === 'string' && msgA.includes('삭제 시험 노드') && msgA.includes('바로 지워지고 되돌릴 수 없습니다'), String(msgA));
    check('삭제 (가) 그래프에서 사라지고 문서에서도 노드·이력이 빠짐, 선택 해제', (await nodeCount(s.cdp)) === delNodes0 - 1 && !(await hasLabel(s.cdp, '삭제 시험 노드')) && (await evaluate(s.cdp, `!window.__wu.doc.nodes.some((n) => n.id === ${JSON.stringify(idA)}) && !window.__wu.doc.events.some((e) => e.payload && e.payload.target_id === ${JSON.stringify(idA)}) && window.__wu.selected === null && !window.__wu.doc.edges.some((e) => e.source === ${JSON.stringify(idA)} || e.target === ${JSON.stringify(idA)})`)));
    // (나) 연결·이력이 있는 노드
    await delRevealSlot();
    await fb17Form({ 'node-type': 'person', 'node-label': '삭제 시험 담당자', 'node-link-other': 'N-001' });
    await fb17Submit();
    await sleep(300);
    const idB = await delIdOf('삭제 시험 담당자');
    check('삭제 시험: 연결 있는 사람 사람·업무·문서 추가', !!idB);
    await delSelect(`U-A1/${idB}`);
    check('삭제 (나) 연결이 있는 노드에는 「삭제」가 없고 「숨기기」만 있음', await evaluate(s.cdp, "!document.querySelector('#detail [data-testid=btn-delete]') && !!document.querySelector('#detail [data-testid=btn-hide]')"));
    await clickTestId(s.cdp, 'btn-event');
    await sleep(100);
    await fillPanelForm(s.cdp, { 'event-type': 'affiliation_change', 'event-date': '2026-10-05' });
    await sleep(300);
    check('삭제 시험: 사람 노드에 소속 변경 이력이 쌓임', await evaluate(s.cdp, `window.__wu.doc.events.some((e) => e.type === 'affiliation_change' && e.payload.person_id === ${JSON.stringify(idB)})`));
    await delSelect(`U-A1/${idB}`);
    await clickTestId(s.cdp, 'btn-hide');
    await sleep(300);
    check('삭제 (나) 숨기면 그래프에서 빠짐', !(await hasLabel(s.cdp, '삭제 시험 담당자')));
    await evaluate(s.cdp, 'window.__wu.select(null)');
    await sleep(150);
    await clickTestId(s.cdp, 'btn-hidden');
    await sleep(200);
    check('삭제 (나) 숨긴 노드 목록의 각 항목에 「되살리기」 옆 「완전히 삭제」가 있음', await evaluate(s.cdp, `(() => { const li = [...document.querySelectorAll('[data-testid=hidden-item]')].find((x) => x.dataset.id === ${JSON.stringify(idB)}); return !!li && !!li.querySelector('[data-testid=btn-restore]') && !!li.querySelector('[data-testid=btn-purge]'); })()`));
    await shot(s.cdp, `${browser.name}-cr13d-b-hidden-list-purge`);
    await evaluate(s.cdp, `[...document.querySelectorAll('[data-testid=hidden-item]')].find((x) => x.dataset.id === ${JSON.stringify(idB)}).querySelector('[data-testid=btn-purge]').click()`);
    await sleep(400);
    const msgB = await evaluate(s.cdp, 'window.__delMsgs.at(-1)');
    check('삭제 (나) 확인 문구: 연결 n개도 함께 지워지고 이력은 「(삭제된 항목)」로 남음', typeof msgB === 'string' && msgB.includes('완전히 지웁니다') && /연결 \d+개도 함께/.test(msgB) && msgB.includes('(삭제된 항목)'), String(msgB)); // CR-18-2
    check('삭제 (나) 목록에서 사라짐(자리표시는 목록에 안 나옴)', await evaluate(s.cdp, `![...document.querySelectorAll('[data-testid=hidden-item]')].some((x) => x.dataset.id === ${JSON.stringify(idB)})`));
    check('삭제 (나) 문서: 저장 이름 「(삭제된 노드)」(화면은 「(삭제된 항목)」), deleted·hidden true, 내용·연결 제거, 이력(소속 변경)은 유지, 검증용 이벤트 1건', await evaluate(s.cdp, `(() => { const d = window.__wu.doc; const n = d.nodes.find((x) => x.id === ${JSON.stringify(idB)}); return !!n && n.label === '(삭제된 노드)' && n.deleted === true && n.hidden === true && !d.edges.some((e) => e.source === n.id || e.target === n.id) && d.events.some((e) => e.type === 'affiliation_change' && e.payload.person_id === n.id) && d.events.filter((e) => e.payload && e.payload.target_id === n.id && e.payload.after && e.payload.after.deleted === true).length === 1; })()`)); // CR-18-2
    check('삭제 (나) 그래프·찾기에 자리표시가 나오지 않음', !(await hasLabel(s.cdp, '(삭제된 항목)')) && !(await hasLabel(s.cdp, '(삭제된 노드)')) && !(await hasLabel(s.cdp, '삭제 시험 담당자'))); // CR-18-2
    await delSelect(`U-A1/${idB}`);
    const histB = await text(s.cdp, '[data-testid=history]');
    check('삭제 (나) 그 노드를 가리킨 이력이 「(삭제된 항목)」로 보임', histB.includes('(삭제된 항목)') && !histB.includes('삭제 시험 담당자'), histB.slice(0, 160)); // CR-18-2
    await shot(s.cdp, `${browser.name}-cr13d-c-purged-history`);
    check('삭제 화면에 "null" 글자 없음', (await nullTextSpots(s.cdp)).length === 0, (await nullTextSpots(s.cdp)).join(','));
    await evaluate(s.cdp, 'window.__wu.select(null)');
    await sleep(150);
    check('삭제 (나) 숨긴 노드가 더 없으면 개요에 「숨긴 노드」 표시가 사라짐', !(await evaluate(s.cdp, "!!document.querySelector('[data-testid=hidden-count]')")));
    void delConfirms;
  }

  // ── T-25 백업 권유(R-21 ②): 내보낸 지 8일 + 변경 → 한 줄 → 닫기 → 다시 열어도 숨김 → 「지금 내보내기」 → 사라지고 내보내기 시각 저장 ──
  const reloadApp = async () => {
    await s.cdp.send('Page.reload');
    await sleep(300);
    return waitFor(s.cdp, 'window.__wu && window.__wu.cy.nodes().length > 0');
  };
  const setExportAt = (ms) => evaluate(s.cdp, `localStorage.setItem('wu:v1:settings', JSON.stringify({ provider: 'pregen', lastExportAt: new Date(${ms}).toISOString() }))`);
  const nudge = () => evaluate(s.cdp, "(() => { const e = document.getElementById('backup-nudge'); const r = e.getBoundingClientRect(); return { hidden: e.hidden, w: r.width, h: r.height, text: e.textContent }; })()");
  await setExportAt(Date.now());
  await reloadApp();
  const n0 = await nudge();
  check('R-21 ② 방금 내보냈고 바뀐 것이 없으면 권유 줄이 없음', n0.hidden && n0.h === 0, JSON.stringify(n0));
  await evaluate(s.cdp, "window.__wu.select('U-A1/N-001')");
  await sleep(150);
  await clickTestId(s.cdp, 'btn-event');
  await fillPanelForm(s.cdp, { 'event-type': 'memo', 'event-date': '2026-10-05', 'event-note': 'T25 백업 권유 시험' });
  await sleep(300);
  const n1 = await nudge();
  check('R-21 ② 내보낸 지 얼마 안 됐고 변경이 1건이면 권유 줄이 없음(7일 기준 전)', n1.hidden, JSON.stringify(n1));
  await setExportAt(Date.now() - 8 * 86400000);
  await reloadApp();
  const n2 = await nudge();
  check('R-21 ② 내보낸 지 8일, 바뀐 것이 있으면 머리글 아래에 「내보내기를 권합니다」 한 줄(크기 있음)과 두 버튼', !n2.hidden && n2.w > 0 && n2.h > 0 && n2.text.includes('내보내기를 권합니다') && (await evaluate(s.cdp, "!!document.querySelector('[data-testid=backup-export]') && !!document.querySelector('[data-testid=backup-close]')")), JSON.stringify(n2));
  await shot(s.cdp, `${browser.name}-21b-backup-nudge`);
  await clickTestId(s.cdp, 'backup-close');
  await sleep(150);
  check('R-21 ② 「닫기」 → 줄이 사라지고 닫은 시각이 설정에 남음', (await nudge()).hidden && (await evaluate(s.cdp, "!!JSON.parse(localStorage.getItem('wu:v1:settings')).backupDismissedAt")));
  await reloadApp();
  check('R-21 ② 닫은 뒤 다시 열어도 다음 기준까지 숨김', (await nudge()).hidden);
  await setExportAt(Date.now() - 8 * 86400000);
  await reloadApp();
  check('R-21 ② 설정을 8일 전으로 되돌려 다시 열면 권유 줄이 다시 보임', !(await nudge()).hidden);
  await evaluate(s.cdp, "window.__dl = null; HTMLAnchorElement.prototype.click = function () { window.__dl = this.getAttribute('download'); }");
  await clickTestId(s.cdp, 'backup-export');
  await sleep(200);
  const saved = await evaluate(s.cdp, "Date.now() - Date.parse(JSON.parse(localStorage.getItem('wu:v1:settings')).lastExportAt)");
  check('R-21 ② 「지금 내보내기」 → 파일 이름이 정해지고 줄이 사라지며 내보내기 시각(지금)이 설정에 저장됨', (await nudge()).hidden && typeof (await evaluate(s.cdp, 'window.__dl')) === 'string' && saved >= 0 && saved < 60000, String(saved));

  // ── T-26 작성자 이름(R-22 ②③, D-24): 설정에 이름 저장 → 초안 확정 → 확정본 상세·내려받기 파일의 확정자가 그 이름 ──
  // 데이터를 바꾸는 단계라 끝부분에 둔다(앞의 확정·이슈·되살리기 점검의 순서·개수를 건드리지 않는다)
  await reloadApp();
  await evaluate(s.cdp, "window.confirm = () => true; window.__wu.select(null); document.getElementById('settings-open').click()");
  await sleep(200);
  const authorBox = await evaluate(s.cdp, "(() => { const i = document.querySelector('[data-testid=settings-author]'); if (!i) return null; const r = i.getBoundingClientRect(); return { w: r.width, h: r.height, max: i.maxLength, value: i.value, note: document.querySelector('[data-testid=settings]').textContent.includes('로그인이 아니며') }; })()");
  check('R-22 ② ③ 설정에 「작성자 이름」 입력 칸(크기 있음, 최대 100자)과 「로그인이 아님」 안내가 있음', !!authorBox && authorBox.w > 0 && authorBox.h > 0 && authorBox.max === 100 && authorBox.value === '' && authorBox.note, JSON.stringify(authorBox));
  await evaluate(s.cdp, "(() => { const i = document.querySelector('[data-testid=settings-author]'); i.value = '  가상 작성자  '; i.dispatchEvent(new Event('change')); })()");
  await sleep(150);
  await evaluate(s.cdp, "document.querySelector('[data-testid=settings-author]').scrollIntoView({ block: 'center' })");
  await sleep(150);
  await shot(s.cdp, `${browser.name}-26b-settings-author`);
  check('R-22 ② 이름을 넣으면 설정(wu:v1:settings)에 공백을 정리해 저장되고 다른 설정은 유지됨', (await evaluate(s.cdp, "(() => { const v = JSON.parse(localStorage.getItem('wu:v1:settings')); return v.authorName + '|' + v.provider; })()")) === '가상 작성자|pregen');
  await clickTestId(s.cdp, 'settings-close');
  await sleep(150);
  await evaluate(s.cdp, "window.__wu.select(null)");
  await clickTestId(s.cdp, 'btn-draft-universe');
  await sleep(150);
  await makeDraft('U-A1/N-001', 'U-A1/N-011', 'U-A1/N-010');
  await sleep(250);
  const handoversBefore = await evaluate(s.cdp, "window.__wu.doc.events.filter((e) => e.type === 'handover').length");
  await clickTestId(s.cdp, 'draft-confirm');
  await sleep(400);
  const authorDetail = await text(s.cdp, '#detail');
  check('R-22 ② 이름을 넣고 확정 → 확정본 상세의 확정자가 그 이름(기본 문구 아님)', authorDetail.includes('가상 작성자') && !authorDetail.includes('사용자(이 브라우저)'), authorDetail.slice(0, 160));
  check('R-22 ② 확정 이력 메모에도 그 이름, 이력이 1건 늘어남', await evaluate(s.cdp, `(() => { const ev = window.__wu.doc.events.filter((e) => e.type === 'handover'); return ev.length === ${handoversBefore} + 1 && ev[ev.length - 1].note.includes('확정: 가상 작성자'); })()`));
  await evaluate(s.cdp, `(() => {
    window.__dl = null; window.__blob = null;
    const orig = URL.createObjectURL; URL.createObjectURL = (b) => { window.__blob = b; return orig.call(URL, b); };
    HTMLAnchorElement.prototype.click = function () { window.__dl = this.getAttribute('download'); };
  })()`);
  await clickTestId(s.cdp, 'doc-download');
  await sleep(250);
  const authorHtml = await evaluate(s.cdp, 'window.__blob ? window.__blob.text() : null');
  check('R-22 ② 확정본 내려받기 파일의 확정자 줄이 그 이름', typeof (await evaluate(s.cdp, 'window.__dl')) === 'string' && !!authorHtml && authorHtml.includes('확정자: 가상 작성자') && !authorHtml.includes('확정자: 사용자(이 브라우저)'), (authorHtml || '').slice(0, 120));

  // ── R7-6 담당 시작의 끝 날짜(선택), V-1 같은 초 해결. 데이터를 바꾸므로 끝부분. 사람 N-012(서하늘)는 2026-10-01부터 N-001 담당 중이라 2019년 소급 기간은 겹치지 않는다 ──
  await reloadApp();
  await evaluate(s.cdp, "window.confirm = () => true; window.__wu.select('U-A1/N-001')");
  await sleep(200);
  const setSel = (idx, id) => evaluate(s.cdp, `(() => { const e = [...document.querySelectorAll('#detail .event-fields select')][${idx}]; if (!e) return false; e.value = ${JSON.stringify(id)}; e.dispatchEvent(new Event('change')); return e.value === ${JSON.stringify(id)}; })()`);
  const openAssign = async () => {
    await clickTestId(s.cdp, 'btn-event');
    await sleep(100);
    await evaluate(s.cdp, "(() => { const t = document.querySelector('#detail [data-testid=event-type]'); t.value = 'assign_start'; t.dispatchEvent(new Event('change')); })()");
    await setSel(0, 'N-012');
    await setSel(1, 'N-001');
  };
  const counts = () => evaluate(s.cdp, 'JSON.stringify([window.__wu.doc.events.length, window.__wu.doc.edges.length])');
  await clickTestId(s.cdp, 'btn-event');
  await sleep(100);
  await evaluate(s.cdp, "(() => { const t = document.querySelector('#detail [data-testid=event-type]'); t.value = 'assign_start'; t.dispatchEvent(new Event('change')); })()");
  await sleep(100);
  check('R7-6: 담당 시작 양식에 「끝 날짜(선택)」 칸이 있고 비어 있다', (await evaluate(s.cdp, "(() => { const e = document.querySelector('#detail [data-testid=event-end-date]'); return !!e && e.value === ''; })()")) === true);
  await shot(s.cdp, `${browser.name}-28a-assign-end-date`);
  await evaluate(s.cdp, "[...document.querySelectorAll('#detail button')].find((b) => b.textContent === '취소').click()");
  await openAssign();
  const asgBefore = await counts();
  await fillPanelForm(s.cdp, { 'event-date': '2019-06-30', 'event-end-date': '2019-03-01' });
  await sleep(200);
  const endBad = await panelMessage(s.cdp);
  check('R7-6: 끝 날짜가 시작보다 앞 → 「끝 날짜」 안내, 이력·연결이 늘지 않음', !!endBad && endBad.text.includes('끝 날짜') && (await counts()) === asgBefore, endBad && endBad.text);
  await fillPanelForm(s.cdp, { 'event-date': '2019-01-01', 'event-end-date': '2019-06-30' });
  await sleep(300);
  const asgAfter = JSON.parse(await evaluate(s.cdp, "(() => { const d = window.__wu.doc; const e = d.edges.filter((x) => x.core_type === 'performs' && x.source === 'N-012' && x.target === 'N-001' && x.period && x.period.start === '2019-01-01'); return JSON.stringify({ n: e.length, end: e[0] && e[0].period.end, evs: d.events.filter((x) => (x.occurred_at === '2019-01-01' || x.occurred_at === '2019-06-30') && x.payload.person_id === 'N-012').map((x) => x.type).sort() }); })()"));
  check('R7-6: 끝 날짜 있는 담당 시작 → 연결 {start,end} 1개 + 담당 시작·종료 이력 2건', asgAfter.n === 1 && asgAfter.end === '2019-06-30' && asgAfter.evs.join() === 'assign_end,assign_start', JSON.stringify(asgAfter));
  await openAssign();
  const asgBefore2 = await counts();
  await fillPanelForm(s.cdp, { 'event-date': '2019-03-01', 'event-end-date': '2019-04-01' });
  await sleep(200);
  const overlapMsg = await panelMessage(s.cdp);
  check('R7-6: 기간이 겹치면 「담당 기간…겹칩니다」로 거부(저장 안 됨)', !!overlapMsg && overlapMsg.text.includes('담당 기간') && overlapMsg.text.includes('겹칩니다') && (await counts()) === asgBefore2, overlapMsg && overlapMsg.text);
  await evaluate(s.cdp, "[...document.querySelectorAll('#detail button')].find((b) => b.textContent === '취소').click()");
  // V-1: 방금 쓴 메모를 바로 미해결 목록에서 「해결로 표시」해도 닫힌다(not_closed 안내가 뜨지 않음)
  await evaluate(s.cdp, "window.__wu.select('U-A1/N-001')");
  await sleep(150);
  await clickTestId(s.cdp, 'btn-event');
  await fillPanelForm(s.cdp, { 'event-type': 'memo', 'event-date': '2026-10-13', 'event-category': 'issue', 'event-note': '같은 초 해결 점검' });
  await sleep(250);
  await clickTestId(s.cdp, 'btn-issues');
  await sleep(200);
  const v1gid = await evaluate(s.cdp, "(() => { const li = [...document.querySelectorAll('[data-testid=issue-item]')].find((x) => x.textContent.includes('같은 초 해결 점검')); return li ? li.dataset.gid : ''; })()");
  await evaluate(s.cdp, `(() => { const li = document.querySelector('[data-gid="${v1gid}"]'); li.closest('details').open = true; li.querySelector('[data-testid=btn-resolve]').click(); })()`);
  await sleep(250);
  const v1 = await evaluate(s.cdp, `({ err: (() => { const m = document.querySelector('[data-testid=issue-error]'); return m && !m.hidden ? m.textContent : ''; })(), still: !!document.querySelector('[data-gid="${v1gid}"]') })`);
  check('V-1: 방금 쓴 메모를 바로 해결로 표시 → 안내 없이 목록에서 빠짐', !!v1gid && v1.err === '' && v1.still === false, JSON.stringify(v1));
  await clickTestId(s.cdp, 'issue-close');
  await sleep(100);

  // ── 처음 사용 W1(2026-10-24, docs/first-use-2026-10-24.md FU-7·8·17): 받는 사람 후보가 없는 새 지도의 안내와 「＋ 사람 추가」, 이력 부족 항목의 「채우려면」,
  //    초안을 다시 만들 때 같은 두 사람 기억. 새 지도를 하나 만들어 쓰고, 끝나면 월말 정산 점검(U-A1)으로 돌아간다. (따라 하기 끝 초안의 「사전 생성」 칩은 위 handover 3→4단계에서 확인) ──
  {
    const w1Visible = (sel) => evaluate(s.cdp, `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e || e.hidden || !e.checkVisibility()) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; })()`);
    const w1OpenDraft = async () => {
      await evaluate(s.cdp, 'window.__wu.select(null)');
      await clickTestId(s.cdp, 'btn-draft-universe');
      await sleep(250);
    };
    const w1CloseDraft = async () => {
      await evaluate(s.cdp, "[...document.querySelectorAll('[data-testid=draft-form] button')].find((b) => b.textContent === '닫기').click()");
      await sleep(200);
    };
    // 목록의 글자(이름)로 고른다: 새 지도의 gid를 몰라도 되게
    const w1Pick = (testid, label) => evaluate(s.cdp, `(() => { const sel = document.querySelector('[data-testid=${testid}]'); const o = [...sel.options].find((x) => x.textContent === ${JSON.stringify(label)}); sel.value = o ? o.value : ''; sel.dispatchEvent(new Event('change')); return !!o; })()`);
    await evaluate(s.cdp, "window.confirm = () => true; window.__wu.select(null)");
    await evaluate(s.cdp, `(() => {
      document.getElementById('create-open').click();
      document.getElementById('create-name').value = '처음 사용 W1 시험';
      document.getElementById('create-level').value = '업무';
      document.getElementById('create-owner').value = '가상 시험팀';
      document.querySelector('#create-form button[type=submit]').click();
    })()`);
    await sleep(500);
    const w1Made = await waitFor(s.cdp, "window.__wu && window.__wu.doc.universe.name === '처음 사용 W1 시험' && window.__wu.cy.nodes().length === 1", 8000);
    check('처음 사용 W1: 시험용 새 지도(꼭지만)가 열림', w1Made);
    if (w1Made) {
      // FU-7: 사람이 하나도 없으면 오류가 나기 전에, 창을 열 때부터 안내와 단추가 보인다
      await w1OpenDraft();
      const help0 = await evaluate(s.cdp, "(() => { const h = document.querySelector('[data-testid=draft-person-help]'); return h ? h.textContent : null; })()");
      check('처음 사용 W1(FU-7) 받는 사람 후보가 0명인 새 지도: 초안 창을 열면 안내 「후임이 목록에 없으면 사람으로 먼저 넣으세요…」와 「＋ 사람 추가」 단추가 보임(크기 있음)', !!help0 && help0.includes('후임이 목록에 없으면 사람으로 먼저 넣으세요. 연결하지 않아도 받는 사람으로 고를 수 있습니다(「수행」으로 이으면 현재 담당으로 보입니다).') && (await w1Visible('[data-testid=draft-person-help]')) && (await w1Visible('[data-testid=draft-add-person]')) && (await text(s.cdp, '[data-testid=draft-add-person]')) === '＋ 사람 추가', String(help0));
      await shot(s.cdp, `${browser.name}-w1-draft-no-person`);
      // 처음 사용 점검 2회차 FU-36(처음 사용 W4): 「＋ 사람 추가」는 긴 사람·업무·문서 추가 창 대신 초안 창 안의 작은 칸(이름 필수·연락처 선택)을 연다.
      // 「넣기」가 wu:add-node(detail.label, attrs)를 보내면 main이 사람을 바로 만들고(연결 없음) 초안 창을 다시 그린다(계약). 알림 내용은 문서 수준 리스너로 따로 받아 본다
      await evaluate(s.cdp, "window.__w1evt = null; window.__w1evtN = 0; document.addEventListener('wu:add-node', (e) => { window.__w1evt = e.detail; window.__w1evtN += 1; })");
      const w4AddWasOpen = await evaluate(s.cdp, "(document.querySelector('details.add') || {}).open === true"); // 새 지도는 사람·업무·문서 추가가 펼쳐져 있다 — 누른 뒤 달라지지 않았는지를 본다
      await evaluate(s.cdp, "document.querySelector('[data-testid=draft-add-person]').click()");
      await sleep(250);
      const w4Box = { box: await w1Visible('[data-testid=draft-new-person]'), name: await w1Visible('[data-testid=draft-new-person-name]'), contact: await w1Visible('[data-testid=draft-new-person-contact]'), add: await w1Visible('[data-testid=draft-new-person-add]'), events: await evaluate(s.cdp, 'window.__w1evtN'), addNodeOpen: await evaluate(s.cdp, "(document.querySelector('details.add') || {}).open === true") };
      check('처음 사용 W4(FU-36) 「＋ 사람 추가」를 누르면 초안 창 안에 이름·연락처 칸과 「넣기」가 열리고(크기 있음), 알림은 아직 없고 사람·업무·문서 추가 창은 열리지 않음', w4Box.box && w4Box.name && w4Box.contact && w4Box.add && w4Box.events === 0 && w4Box.addNodeOpen === w4AddWasOpen, JSON.stringify({ ...w4Box, w4AddWasOpen }));
      await shot(s.cdp, `${browser.name}-w4-new-person-box`);
      await evaluate(s.cdp, "document.querySelector('[data-testid=draft-new-person-add]').click()");
      await sleep(200);
      check('처음 사용 W4(FU-36) 이름이 비면 「넣기」는 안내(이름을 적으세요.)만 하고 알림을 보내지 않음', (await text(s.cdp, '[data-testid=draft-new-person-msg]')) === '이름을 적으세요.' && (await evaluate(s.cdp, 'window.__w1evtN')) === 0);
      await evaluate(s.cdp, "(() => { document.querySelector('[data-testid=draft-new-person-name]').value = '가상갑'; document.querySelector('[data-testid=draft-new-person-contact]').value = '내선 1234'; document.querySelector('[data-testid=draft-new-person-add]').click(); })()");
      await sleep(400);
      const w4Evt = await evaluate(s.cdp, 'window.__w1evt');
      check('처음 사용 W4(FU-36) 이름·연락처를 넣고 「넣기」: wu:add-node 알림 detail이 {type: person, label: 가상갑, attrs: {연락처: 내선 1234}}', !!w4Evt && w4Evt.type === 'person' && w4Evt.label === '가상갑' && !!w4Evt.attrs && w4Evt.attrs['연락처'] === '내선 1234' && (await evaluate(s.cdp, 'window.__w1evtN')) === 1, JSON.stringify(w4Evt));
      // main(W5 계약): label이 있으면 사람·업무·문서 추가 창을 열지 않고 사람 노드를 바로 만들고(연결 없음) 초안 창을 다시 그린다 → 받는 사람 목록에 그 사람이 있고 자동으로 골라짐
      const w4Made = await waitFor(s.cdp, "window.__wu.doc.nodes.some((n) => n.label === '가상갑' && n.core_type === 'person')", 3000);
      const w4After = await evaluate(s.cdp, "({ draftOpen: !!document.querySelector('[data-testid=draft-form]'), addOpen: (document.querySelector('details.add') || {}).open === true, to: (() => { const s = document.querySelector('[data-testid=draft-to]'); return s && s.selectedOptions[0] ? s.selectedOptions[0].textContent : null; })(), attr: (() => { const n = window.__wu.doc.nodes.find((x) => x.label === '가상갑'); return n && n.attrs ? n.attrs['연락처'] : null; })() })");
      check('처음 사용 W4(FU-36) 사람 노드가 바로 만들어지고(연락처 속성 포함), 초안 창은 열려 있고 사람·업무·문서 추가 창 상태는 그대로이며, 받는 사람으로 그 사람이 골라져 있음', w4Made && w4After.draftOpen && w4After.addOpen === w4AddWasOpen && w4After.to === '가상갑' && w4After.attr === '내선 1234', JSON.stringify(w4After));
      await w1CloseDraft();
      const w1Work = await submitAdd(s.cdp, 'work', '시험 업무');
      const w1P1 = w4Made ? { code: 'OK' } : await submitAdd(s.cdp, 'person', '가상갑'); // 계약이 지켜지지 않았을 때도 뒤 점검은 이어 간다
      check('처음 사용 W1: 시험 지도에 업무 하나·사람 하나를 넣음', w1Work.code === 'OK' && w1P1.code === 'OK', JSON.stringify([w1Work, w1P1]));
      await w1OpenDraft();
      check('처음 사용 W1(FU-7) 사람이 하나뿐이어도 안내가 보임', await w1Visible('[data-testid=draft-person-help]'));
      await w1CloseDraft();
      const w1P2 = await submitAdd(s.cdp, 'person', '가상을');
      check('처음 사용 W1: 사람 둘째를 넣음', w1P2.code === 'OK', JSON.stringify(w1P2));
      await w1OpenDraft();
      check('처음 사용 W1(FU-7) 받는 사람 후보가 있으면 안내는 숨어 있음', !(await w1Visible('[data-testid=draft-person-help]')));
      // 받는 사람을 고르지 않고 만들면 오류와 함께 안내가 나타난다
      check('처음 사용 W1(FU-17) 처음 만들 때는 보내는·받는 사람이 비어 있음', (await evaluate(s.cdp, "document.querySelector('[data-testid=draft-from]').value")) === '' && (await evaluate(s.cdp, "document.querySelector('[data-testid=draft-to]').value")) === '');
      await w1Pick('draft-target', '처음 사용 W1 시험');
      await w1Pick('draft-from', '가상갑');
      await evaluate(s.cdp, "document.querySelector('[data-testid=draft-form] button[type=submit]').click()");
      await sleep(200);
      check('처음 사용 W1(FU-7) 받는 사람 누락 오류(기존 문구 「받는 사람을 고르세요」)와 함께 안내가 나타남', (await text(s.cdp, '[data-testid=draft-message]')).includes('받는 사람') && (await w1Visible('[data-testid=draft-person-help]')));
      // FU-8: 이력 부족 항목마다 「채우려면」
      await w1Pick('draft-to', '가상을');
      await evaluate(s.cdp, "document.querySelector('[data-testid=draft-form] button[type=submit]').click()");
      await sleep(400);
      const w1Fill = await evaluate(s.cdp, "({ insufficient: document.querySelectorAll('[data-testid=insufficient]').length, hints: [...document.querySelectorAll('[data-testid=draft-fill-hint]')].map((h) => h.textContent), rel: (document.querySelector('[data-testid=draft-item-관계자_연락처] [data-testid=draft-fill-hint]') || {}).textContent || '', relShort: !!document.querySelector('[data-testid=draft-item-관계자_연락처] [data-testid=insufficient]') })");
      check('처음 사용 W1(FU-8) 이력 부족 항목마다 「채우려면: …」 한 줄(개수 일치, 관계자가 비었으면 「수행」으로 이으라고 안내 — 앞에서 연락처 있는 사람을 넣었으면 관계자는 채워짐)', w1Fill.insufficient >= 6 && w1Fill.hints.length === w1Fill.insufficient && w1Fill.hints.every((t) => t.startsWith('채우려면: ')) && (!w1Fill.relShort || w1Fill.rel.includes('「수행」(사람 → 업무)')), JSON.stringify(w1Fill));
      await shot(s.cdp, `${browser.name}-w1-fill-hints`);
      // FU-17: 초안을 닫았다가 다시 열면 마지막으로 만든 보내는·받는 사람이 골라져 있음
      await w1CloseDraft();
      await w1OpenDraft();
      const w1Mem = await evaluate(s.cdp, "({ from: document.querySelector('[data-testid=draft-from]').selectedOptions[0].textContent, to: document.querySelector('[data-testid=draft-to]').selectedOptions[0].textContent })");
      check('처음 사용 W1(FU-17) 같은 지도에서 초안을 다시 열면 마지막으로 만든 보내는 사람(가상갑)·받는 사람(가상을)이 미리 골라져 있음', w1Mem.from === '가상갑' && w1Mem.to === '가상을', JSON.stringify(w1Mem));
      await w1CloseDraft();
    }
    // 시험 지도에서 나와 월말 정산 점검(U-A1)으로 돌아간다(이후 점검이 U-A1을 전제로 함)
    await evaluate(s.cdp, "location.hash = 'U-A1'; location.reload()").catch(() => {});
    await sleep(500);
    await waitFor(s.cdp, "window.__wu && window.__wu.doc && window.__wu.doc.universe.id === 'U-A1' && window.__wu.cy.nodes().length > 0", 8000);
    await evaluate(s.cdp, 'window.confirm = () => true');
  }

  // ── CR-15 T-36 실시간 Claude API(가짜 클라이언트, 실제 호출 없음): 키 없으면 평소와 같고, 키를 넣으면 「생성 중…」 → 교체(칩 「Claude API」) → 실패하면 「규칙 기반으로 대체함」 → 키 지우기 → 칩 없음.
  //    데이터를 바꾸지 않는다(설정과 응답 캐시만). 가짜 키는 조각을 이어 붙여 비밀값 패턴에 걸리지 않게 한다 ──
  {
    const fakeKey = ['sk', 'ant', 'x'.repeat(8), 'FAKEKEY', 'y'.repeat(12)].join('-');
    const settingsOpen = async () => { await evaluate(s.cdp, "document.getElementById('settings-open').click()"); await sleep(150); };
    const settingsClose = async () => { await clickTestId(s.cdp, 'settings-close'); await sleep(100); };
    const typeInto = (testid, value) => evaluate(s.cdp, `(() => { const e = document.querySelector('[data-testid=${testid}]'); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event('input')); e.dispatchEvent(new Event('change')); })()`);
    const openDraft = async () => {
      await evaluate(s.cdp, 'window.__wu.select(null)');
      await clickTestId(s.cdp, 'btn-draft-universe');
      await sleep(150);
    };
    const submitDraft = () => evaluate(s.cdp, `(() => { const set = (id, v) => { const e = document.querySelector('[data-testid=' + id + ']'); e.value = v; e.dispatchEvent(new Event('change')); }; set('draft-target', 'U-A1/N-000'); set('draft-from', 'U-A1/N-011'); set('draft-to', 'U-A1/N-012'); document.querySelector('[data-testid=draft-form] button[type=submit]').click(); })()`);
    const liveDone = (extra = '') => waitFor(s.cdp, `(() => { const n = document.querySelector('[data-testid=draft-live]'); return !!n && n.textContent !== '생성 중…'${extra}; })()`, 5000);
    const chipCount = () => evaluate(s.cdp, "[...document.querySelectorAll('[data-testid=draft-result] [data-testid=item-method]')].filter((c) => c.textContent === 'Claude API').length");
    const calls = () => evaluate(s.cdp, 'window.__wu.fakeLlm.calls.length');
    await reloadApp();
    await evaluate(s.cdp, "window.__wu.useFakeLlm('ok')");
    // 1) 「Claude API」를 골랐지만 키가 없다: 키 칸은 보이고, 초안에는 「생성 중…」도 칩도 없고 가짜 클라이언트는 한 번도 불리지 않는다
    await settingsOpen();
    await evaluate(s.cdp, "(() => { const r = document.querySelector('[data-testid=provider-claude_api]'); r.checked = true; r.dispatchEvent(new Event('change')); })()");
    await sleep(100);
    const keyUi = await evaluate(s.cdp, "(() => { const k = document.querySelector('[data-testid=settings-apikey]'); const m = document.querySelector('[data-testid=settings-model]'); const c = document.querySelector('[data-testid=settings-clear-key]'); const box = document.querySelector('[data-testid=settings-key-box]'); const r = k ? k.getBoundingClientRect() : { width: 0, height: 0 }; return { type: k && k.type, model: m && m.placeholder, clear: !!c, size: r.width > 0 && r.height > 0, note: box ? box.textContent : '', status: (document.querySelector('[data-testid=settings-key-status]') || {}).textContent || '' }; })()");
    check('CR-15 설정에서 「Claude API」를 고르면 「API 키」(비밀번호 칸)·「모델」(기본 claude-opus-5-5)·「키 지우기」와 안내가 나타남(크기 있음)', keyUi.type === 'password' && keyUi.model === 'claude-opus-5-5' && keyUi.clear && keyUi.size && keyUi.note.includes('이 브라우저 저장소') && keyUi.note.includes('공용 PC') && keyUi.note.includes('과금') && keyUi.status.includes('키가 없습니다'), JSON.stringify(keyUi));
    await settingsClose();
    await openDraft();
    await submitDraft();
    await sleep(300);
    const noKey = await evaluate(s.cdp, "({ live: !!document.querySelector('[data-testid=draft-live]'), calls: window.__wu.fakeLlm.calls.length, items: document.querySelectorAll('[data-testid^=draft-item-]').length, fb: (document.querySelector('[data-testid=draft-fallback]') || {}).textContent || '' })");
    // 처음 사용 3회차(W6)·CR-17 H: 키 없음 이유는 고장이 아닌 안내 — 「공급자 오류」·「대체함」 없이 실제 방식에 맞는 한 줄. 사전 생성 문장이 있는 예시 지도라 사전 생성으로 보인다
    check('CR-15·CR-17 H 키가 없으면 「생성 중…」 표시도 호출도 없고 사전 생성 문장 + 키 없음 안내 한 줄(「공급자 오류」·「대체함」 없음)', !noKey.live && noKey.calls === 0 && noKey.items === 11 && noKey.fb === '키가 없어 미리 받아 둔 문장(사전 생성)으로 보여 줍니다 — 「설정」에서 키를 넣으면 Claude가 실시간으로 다시 씁니다' && !noKey.fb.includes('공급자 오류') && !noKey.fb.includes('대체함'), JSON.stringify(noKey));
    check('처음 사용 W6 「Claude API」를 골랐지만 키가 없으면 키 없음 안내(draft-fallback, 노란 띠 아님)가 이미 같은 말을 하므로 맨 아래 한 줄(draft-live-hint)은 그리지 않음', await evaluate(s.cdp, "(() => { const f = document.querySelector('[data-testid=draft-fallback]'); return !!f && f.dataset.keyless === 'true' && !f.classList.contains('notice') && !document.querySelector('[data-testid=draft-live-hint]'); })()"));
    // 2) 키를 넣는다: 머리글 설명에 「(실시간)」, 저장은 이 브라우저 설정에만
    await settingsOpen();
    await typeInto('settings-apikey', fakeKey);
    await sleep(100);
    const keyOn = await evaluate(s.cdp, "({ status: (document.querySelector('[data-testid=settings-key-status]') || {}).textContent || '', title: document.getElementById('settings-open').getAttribute('title') || '' })");
    check('CR-15 키를 넣으면 상태 문구가 바뀌고 머리글 「설정」 설명에 Claude API(실시간)', keyOn.status.includes('키가 입력되어 있습니다') && keyOn.title.includes('Claude API(실시간)'), JSON.stringify(keyOn));
    await settingsClose();
    // 3) 초안: 먼저 그리고(11항목) 「생성 중…」 → 응답이 오면 항목 단위로 교체하고 칩 「Claude API」
    await evaluate(s.cdp, 'window.__wu.fakeLlm.delayMs = 700');
    await openDraft();
    await submitDraft();
    await sleep(150);
    const during = await evaluate(s.cdp, "({ note: (document.querySelector('[data-testid=draft-live]') || {}).textContent || '', aria: (document.querySelector('[data-testid=draft-live]') || {}).getAttribute && document.querySelector('[data-testid=draft-live]').getAttribute('aria-live'), items: document.querySelectorAll('[data-testid^=draft-item-]').length, claude: [...document.querySelectorAll('[data-testid=item-method]')].filter((c) => c.textContent === 'Claude API').length })");
    check('CR-15 초안: 먼저 규칙 기반(사전 생성) 11항목이 그려지고 「생성 중…」(aria-live=polite)이 보임, 아직 Claude API 칩은 없음', during.note === '생성 중…' && during.aria === 'polite' && during.items === 11 && during.claude === 0, JSON.stringify(during));
    check('처음 사용 W4(FU-24) 키가 있으면 맨 아래 안내 한 줄(draft-live-hint)을 그리지 않음', await evaluate(s.cdp, "!document.querySelector('[data-testid=draft-live-hint]')"));
    const lockedDuring = await evaluate(s.cdp, "(() => { const b = document.querySelector('[data-testid=draft-confirm]'); return b ? b.disabled : null; })()");
    check('CR-15 초안: 응답이 오면 「생성 중…」이 사라지고 항목이 교체됨(칩 「Claude API」), 생성 방식 표시도 바뀜', (await liveDone()) && (await chipCount()) >= 3 && (await text(s.cdp, '[data-testid=draft-method]')).includes('Claude API') && (await text(s.cdp, '[data-testid=draft-method-note]')).includes('원문 인용'), `칩 ${await chipCount()}`);
    const lockedAfter = await evaluate(s.cdp, "(() => { const b = document.querySelector('[data-testid=draft-confirm]'); return { disabled: b ? b.disabled : null, note: (document.querySelector('[data-testid=draft-live]') || {}).textContent || '' }; })()");
    check('CR-15 초안: 「생성 중…」 동안 「확정」이 잠겨 있고, 응답으로 문장이 바뀌면 「문장이 Claude API 문장으로 바뀌었습니다 — 확인 후 확정하세요」 안내와 함께 다시 켜짐(R10-11)', lockedDuring === true && lockedAfter.disabled === false && lockedAfter.note === '문장이 Claude API 문장으로 바뀌었습니다 — 확인 후 확정하세요', JSON.stringify({ lockedDuring, lockedAfter }));
    await shot(s.cdp, `${browser.name}-41-llm-draft`);
    // 4) 같은 초안을 다시: 검증을 통과해 캐시에 든 항목은 호출 없이 쓰고, 통과 못 한 항목(캐시에 넣지 않음)만 다시 요청한다.
    //    앞 블록들이 데이터를 바꿔 가짜 client가 따온 인용이 글자 8개에 못 미치는 항목이 생길 수 있어, 첫 결과를 기준으로 판정한다(2026-10-24)
    const methodsNow = () => evaluate(s.cdp, "JSON.stringify([...document.querySelectorAll('[data-testid=draft-result] [data-testid^=draft-item-]')].map((sec) => { const c = sec.querySelector('[data-testid=item-method]'); return [sec.dataset.testid.replace('draft-item-', ''), c ? c.textContent : '']; }).filter(([, m]) => m))");
    const callHeads = (n) => evaluate(s.cdp, `JSON.stringify(((window.__wu.fakeLlm.calls[${n}] || {}).messages || [{ content: '' }])[0].content.match(/^### 항목 key=(\\S+)/gm) || [])`);
    const calls1 = await calls();
    const firstMethods = JSON.parse(await methodsNow());
    const firstLlm = firstMethods.filter(([, m]) => m === 'Claude API').map(([k]) => k);
    const firstOther = firstMethods.filter(([, m]) => m !== 'Claude API').map(([k]) => k);
    await openDraft();
    await submitDraft();
    await liveDone();
    const calls2 = await calls();
    const againMethods = JSON.parse(await methodsNow());
    const heads2 = calls2 > calls1 ? JSON.parse(await callHeads(calls1)).map((h) => h.replace('### 항목 key=', '')) : [];
    const cachedKept = firstLlm.every((k) => againMethods.some(([k2, m]) => k2 === k && m === 'Claude API'));
    const onlyFailed = firstOther.length === 0 ? calls2 === calls1 : (calls2 === calls1 + 1 && heads2.length === firstOther.length && heads2.every((k) => firstOther.includes(k)));
    check('CR-15 초안: 같은 근거로 다시 만들면 통과한 항목은 응답 캐시를 써서 다시 보내지 않고(Claude API 칩 그대로), 통과 못 한 항목만 다시 요청', calls1 === 1 && firstLlm.length >= 3 && cachedKept && onlyFailed, JSON.stringify({ calls1, calls2, firstLlm, firstOther, heads2, cachedKept }));
    // 5) 실패: 모델을 바꿔(캐시 키가 달라져) 시간 초과 / 지어낸 quote
    const setModel = async (m) => { await settingsOpen(); await typeInto('settings-model', m); await sleep(100); await settingsClose(); };
    await setModel('claude-test-timeout');
    await evaluate(s.cdp, "window.__wu.fakeLlm.mode = 'timeout'; window.__wu.fakeLlm.delayMs = 100");
    await openDraft();
    await submitDraft();
    const failed = (await liveDone()) && (await evaluate(s.cdp, "({ fb: (document.querySelector('[data-testid=draft-fallback]') || {}).textContent || '', chips: [...document.querySelectorAll('[data-testid=item-method]')].filter((c) => c.textContent === 'Claude API').length, items: document.querySelectorAll('[data-testid^=draft-item-]').length })"));
    check('CR-15 초안: 시간 초과면 「원래 문장을 유지함: …연결 실패·시간 초과」(먼저 그린 사전 생성 문장이 그대로) + 11항목, Claude API 칩 없음', !!failed && (failed.fb.includes('원래 문장을 유지함') || failed.fb.includes('규칙 기반으로 대체함')) && failed.fb.includes('연결 실패·시간 초과') && failed.chips === 0 && failed.items === 11, JSON.stringify(failed));
    await setModel('claude-test-quote');
    await evaluate(s.cdp, "window.__wu.fakeLlm.mode = 'badquote'");
    await openDraft();
    await submitDraft();
    const badQuote = (await liveDone()) && (await evaluate(s.cdp, "({ fb: (document.querySelector('[data-testid=draft-fallback]') || {}).textContent || '', chips: [...document.querySelectorAll('[data-testid=item-method]')].filter((c) => c.textContent === 'Claude API').length })"));
    check('CR-15 초안: 지어낸 인용(quote)은 항목이 규칙 기반으로 남고 사유에 「원문 인용」이 보임', !!badQuote && badQuote.fb.includes('원문 인용') && badQuote.chips === 0, JSON.stringify(badQuote));
    // 6) 화면을 떠나면 응답을 버린다: 응답을 기다리는 중 패널을 닫으면 오류 없이 끝난다
    await setModel('claude-test-leave');
    await evaluate(s.cdp, "window.__wu.fakeLlm.mode = 'ok'; window.__wu.fakeLlm.delayMs = 500; window.__llmErr = []; window.addEventListener('error', (e) => window.__llmErr.push(String(e.message))); window.addEventListener('unhandledrejection', (e) => window.__llmErr.push(String(e.reason)))");
    await openDraft();
    await submitDraft();
    await sleep(100);
    await evaluate(s.cdp, "[...document.querySelectorAll('[data-testid=draft-form] button')].find((b) => b.textContent === '닫기').click()");
    await sleep(900);
    const left = await evaluate(s.cdp, "({ err: window.__llmErr, draftOpen: !!document.querySelector('[data-testid=draft-form]') })");
    check('CR-15 응답을 기다리다 초안을 닫으면 응답은 버려지고 오류가 나지 않음', left.err.length === 0 && !left.draftOpen, JSON.stringify(left));
    // 7) 인사이트 설명도 같은 방식(「인수인계 위험」 탭의 설명 상자)
    await setModel('claude-test-insight');
    await evaluate(s.cdp, "window.__wu.fakeLlm.delayMs = 400");
    await evaluate(s.cdp, 'window.__wu.select(null)');
    await clickTestId(s.cdp, 'btn-insight-universe');
    await sleep(100);
    await clickTestId(s.cdp, 'tab-risk');
    await sleep(100);
    const insightDuring = await evaluate(s.cdp, "({ boxes: document.querySelectorAll('[data-testid=insight-explain]').length, live: document.querySelectorAll('[data-testid=explain-live]').length })");
    const insightReplaced = await waitFor(s.cdp, "[...document.querySelectorAll('[data-testid=insight-explain]')].some((b) => b.dataset.method === 'llm')", 5000);
    const insightChip = await evaluate(s.cdp, "[...document.querySelectorAll('[data-testid=insight-explain] .method-chip')].map((c) => c.textContent).join()");
    check('CR-15 인사이트 설명: 상자가 먼저 그려지고(생성 중… 표시) 응답이 오면 같은 상자가 Claude API 문장으로 교체됨', insightDuring.boxes >= 1 && insightDuring.live >= 1 && insightReplaced && insightChip.includes('Claude API'), JSON.stringify({ insightDuring, insightChip }));
    await clickTestId(s.cdp, 'insight-close');
    await sleep(100);
    // 8) 키는 문서·내보내기에 들어가지 않는다(설정에만)
    const leak = await evaluate(s.cdp, `(() => { const key = ${JSON.stringify(fakeKey)}; const doc = JSON.stringify(window.__wu.doc); const keys = Object.keys(localStorage).filter((k) => localStorage.getItem(k).includes(key)); return { doc: doc.includes(key), keys }; })()`);
    check('CR-15 키 문자열은 문서(내보내기 JSON의 재료)에 없고 저장소에는 설정 한 곳에만 있음', !leak.doc && leak.keys.length === 1 && leak.keys[0] === 'wu:v1:settings', JSON.stringify(leak));
    // 9) 키 지우기 → 설정과 응답 캐시에서 사라지고, 초안은 다시 평소와 같음
    await settingsOpen();
    await typeInto('settings-model', ''); // 모델 칸도 비운다(다음 단계에 남기지 않음)
    await clickTestId(s.cdp, 'settings-clear-key');
    await sleep(100);
    const cleared = await evaluate(s.cdp, "({ settings: JSON.parse(localStorage.getItem('wu:v1:settings') || '{}'), cache: localStorage.getItem('wu:v1:llm-cache'), field: document.querySelector('[data-testid=settings-apikey]').value, status: (document.querySelector('[data-testid=settings-key-status]') || {}).textContent || '', title: document.getElementById('settings-open').getAttribute('title') || '' })");
    check('CR-15 「키 지우기」: 설정에서 키가 사라지고 응답 캐시도 지워지며 머리글에서 (실시간)이 빠짐', !('apiKey' in cleared.settings) && cleared.cache === null && cleared.field === '' && cleared.status.includes('키가 없습니다') && !cleared.title.includes('실시간'), JSON.stringify(cleared));
    await settingsClose();
    const callsBefore = await calls();
    await openDraft();
    await submitDraft();
    await sleep(900);
    const afterClear = await evaluate(s.cdp, "({ live: !!document.querySelector('[data-testid=draft-live]'), chips: [...document.querySelectorAll('[data-testid=item-method]')].filter((c) => c.textContent === 'Claude API').length })");
    check('CR-15 키를 지운 뒤 초안: 「생성 중…」도 칩도 호출도 없음', !afterClear.live && afterClear.chips === 0 && (await calls()) === callsBefore, JSON.stringify({ afterClear, callsBefore }));
    await evaluate(s.cdp, "[...document.querySelectorAll('[data-testid=draft-form] button')].find((b) => b.textContent === '닫기').click()");
    await pickProvider('pregen'); // 이후 단계는 기본 생성 방식으로
    await evaluate(s.cdp, "localStorage.removeItem('wu:v1:llm-cache')");

    // ── 처음 사용 W6(2026-10-24, 3회차): 키 없이 Claude API → 안내 문구·인사이트 띠 한 번, 초안 맨 아래 안내·「다음에 해 볼 것」, 도움말 키·데이터 절, 설정 키 안내 ──
    await pickProvider('claude_api'); // 키는 앞 단계에서 지웠다 = 키 없음
    await settingsOpen();
    const w6Key = await evaluate(s.cdp, "(() => { const n = document.querySelector('[data-testid=settings-key-note]'); const r = n ? n.getBoundingClientRect() : { width: 0, height: 0 }; return { text: n ? n.textContent : '', size: r.width > 0 && r.height > 0, status: (document.querySelector('[data-testid=settings-key-status]') || {}).textContent || '' }; })()");
    check('처음 사용 W6 설정 「Claude API」 칸 안내(크기 있음): 암호화 없이 localStorage·근거 글(이름·설명·속성·사번·이력 메모)이 api.anthropic.com으로·회사의 외부 전송 기준, 상태 문구는 「미리 받아 둔 문장(사전 생성)」·「규칙 기반」', w6Key.size && ['암호화 없이', 'localStorage', 'api.anthropic.com', '사번', '이력 메모', '회사의 외부 전송 기준'].every((w) => w6Key.text.includes(w)) && w6Key.status === '키가 없습니다. 미리 받아 둔 문장(사전 생성)으로, 없으면 기록을 그대로 모은 문장(규칙 기반)으로 보여 줍니다.', JSON.stringify(w6Key));
    await settingsClose();
    // 인사이트: 키 없음 안내는 탭 맨 위에 한 번만, 설명 상자에는 노란 띠가 없다
    await evaluate(s.cdp, 'window.__wu.select(null)');
    await clickTestId(s.cdp, 'btn-insight-universe');
    await sleep(150);
    await clickTestId(s.cdp, 'tab-risk');
    await sleep(100);
    const w6Ins = await evaluate(s.cdp, "(() => { const k = [...document.querySelectorAll('[data-testid=insight-keyless]')]; const r = k[0] ? k[0].getBoundingClientRect() : { width: 0, height: 0 }; return { keyless: k.length, text: k[0] ? k[0].textContent : '', size: r.width > 0 && r.height > 0, boxes: document.querySelectorAll('[data-testid=insight-explain]').length, pregen: [...document.querySelectorAll('[data-testid=insight-explain]')].some((b) => b.dataset.method === 'pregen'), fb: document.querySelectorAll('[data-testid=explain-fallback]').length, old: document.querySelector('.insight').textContent.includes('공급자 오류') }; })()");
    check('처음 사용 W6 키 없이 Claude API: 인사이트 맨 위에 키 없음 안내가 한 번(크기 있음), 설명 상자(1개 이상)마다 되풀이하는 띠는 0개, 「공급자 오류」 글자 없음', w6Ins.keyless === 1 && w6Ins.size && w6Ins.text.startsWith(w6Ins.pregen ? '키가 없어 미리 받아 둔 문장(사전 생성)으로 보여 줍니다' : '키가 없어 기록을 그대로 모은 문장(규칙 기반)으로 보여 줍니다') && w6Ins.boxes >= 1 && w6Ins.fb === 0 && !w6Ins.old, JSON.stringify(w6Ins));
    await clickTestId(s.cdp, 'tab-repeat');
    await sleep(150);
    const w6Rep = await evaluate(s.cdp, "(() => { const has = !!document.querySelector('[data-testid=repeat-patterns]'); const b = document.querySelector('[data-testid=insight-explain]'); return { has, method: b ? b.dataset.method : null, dup: b ? b.dataset.dup : null, note: b && b.querySelector('[data-testid=explain-same-note]') ? b.querySelector('[data-testid=explain-same-note]').textContent : null, li: b ? b.querySelectorAll('li').length : 0 }; })()");
    check('처음 사용 W6 반복 비효율: 규칙 기반 설명이 아래 카드와 같은 글이면 설명 상자에는 문장 없이 「아래 근거를 요약한 문장이 없습니다(규칙 기반)」만(패턴이 없는 지도·사전 생성 문장이 있는 설명 상자면 해당 없음 — CR-17 H)', !w6Rep.has || w6Rep.method === 'pregen' || (w6Rep.dup === 'true' && w6Rep.note === '아래 근거를 요약한 문장이 없습니다(규칙 기반)' && w6Rep.li === 0), JSON.stringify(w6Rep));
    await clickTestId(s.cdp, 'insight-close');
    await sleep(100);
    // 초안: 키 없음 안내, 「다음에 해 볼 것」 두 링크 → 인사이트 「인수인계 위험」·지도 전체 화면
    await openDraft();
    await submitDraft();
    await sleep(300);
    const w6Draft = await evaluate(s.cdp, "(() => { const res = document.querySelector('[data-testid=draft-result]'); const kids = [...res.children].map((c) => c.dataset.testid || ''); const n = document.querySelector('[data-testid=draft-next]'); const r = n ? n.getBoundingClientRect() : { width: 0, height: 0 }; return { last: kids.slice(-2), size: r.width > 0 && r.height > 0, text: n ? n.textContent : '', links: [...document.querySelectorAll('[data-testid=draft-next] button')].map((b) => b.textContent) }; })()");
    check('처음 사용 W6 초안 끝 「다음에 해 볼 것」(크기 있음): 「혼자만 아는 일 보기」·「← 지도 전체 보기」 두 링크, 확정 영역 바로 뒤', w6Draft.size && w6Draft.text.startsWith('다음에 해 볼 것:') && JSON.stringify(w6Draft.links) === JSON.stringify(['혼자만 아는 일 보기', '← 지도 전체 보기']) && w6Draft.last[w6Draft.last.length - 1] === 'draft-next', JSON.stringify(w6Draft));
    await clickTestId(s.cdp, 'draft-next-risk');
    await sleep(250);
    const w6Risk = await evaluate(s.cdp, "({ insight: !!document.querySelector('[data-testid=insight-body]'), risk: !!document.querySelector('[data-testid=tab-risk].active'), draft: !!document.querySelector('[data-testid=draft-form]') })");
    check('처음 사용 W6 「혼자만 아는 일 보기」를 누르면 인사이트가 「인수인계 위험」 탭으로 열림(wu:open-insight {kind:risk})', w6Risk.insight && w6Risk.risk && !w6Risk.draft, JSON.stringify(w6Risk));
    await clickTestId(s.cdp, 'insight-close');
    await sleep(100);
    await openDraft();
    await submitDraft();
    await sleep(300);
    await clickTestId(s.cdp, 'draft-next-overview');
    await sleep(250);
    const w6Over = await evaluate(s.cdp, "({ draft: !!document.querySelector('[data-testid=draft-form]'), overview: !!document.querySelector('[data-testid=btn-draft-universe]') })");
    check('처음 사용 W6 「← 지도 전체 보기」를 누르면 초안 창이 닫히고 지도 전체 화면(wu:overview)', !w6Over.draft && w6Over.overview, JSON.stringify(w6Over));
    // 도움말: 「키와 데이터」 절(접어 두었다가 열면 보임) + 사전 생성 전문(내가 만든 지도는 어떻게 되는지)
    await clickTestId(s.cdp, 'tour-open');
    await sleep(250);
    await evaluate(s.cdp, "document.querySelector('[data-testid=help-security]').open = true");
    await sleep(100);
    const w6Help = await evaluate(s.cdp, "(() => { const d = document.querySelector('[data-testid=help-security]'); const r = d ? d.getBoundingClientRect() : { width: 0, height: 0 }; const box = document.querySelector('[data-testid=help-box]'); const gen = document.querySelector('[data-testid=help-gen]'); return { size: r.width > 0 && r.height > 0, text: d ? d.textContent : '', dt: d ? d.querySelectorAll('dt').length : 0, gen: gen ? gen.textContent : '', overflowX: box ? box.scrollWidth > box.clientWidth + 1 : null }; })()");
    check('처음 사용 W6 도움말 「키와 데이터」 절(열면 크기 있음, 항목 5개): 암호화 없이 localStorage·api.anthropic.com·사번·최대 200건·회사의 외부 전송 기준·사내 LLM은 연결 자리만, 가로 넘침 없음', w6Help.size && w6Help.dt === 5 && ['localStorage', '암호화 없이', 'api.anthropic.com', '사번', '최대 200건', '회사의 외부 전송 기준', '연결할 자리만 있고'].every((w) => w6Help.text.includes(w)) && w6Help.overflowX === false, JSON.stringify({ ...w6Help, text: '', gen: '' }));
    check('처음 사용 W6 도움말 「사전 생성」 설명: 예시 지도 기록을 Claude에 넣어 미리 받아 둔 문장(받은 날짜)·내가 새로 만든 지도에는 미리 받아 둔 문장이 없음', /예시 지도의 기록을 앱을 만들 때 Claude에 넣어 미리 받아 둔 문장입니다\(\d{4}-\d{2}-\d{2}\)/.test(w6Help.gen) && w6Help.gen.includes('내가 새로 만든 지도에는 미리 받아 둔 문장이 없어') && !w6Help.gen.includes('개발 중'), '');
    await shot(s.cdp, `${browser.name}-w6-help-security`);
    await clickTestId(s.cdp, 'help-close');
    await sleep(100);
    await pickProvider('pregen'); // 이후 단계는 기본 생성 방식으로
  }

  // ── CR-15 T-37 A 문서 AI 변환(가짜 클라이언트, 실제 호출 없음): 키 없으면 단추 없음 → 키를 넣으면 「AI로 변환」 → 「AI가 읽는 중」 → 미리 보기(칩 「AI 변환」·노드 표·뺀 항목) →
  //    같은 글 다시 누르면 호출 없음 → 가져오기 → 유니버스 열림·tags 「AI 변환」 → 실패하면 규칙 변환 결과 + 안내 → 글을 바꾸거나 창을 닫으면 응답 버림 → 키 지우기 → 단추 없음.
  //    가져오기가 저장소를 바꾸므로 시작 때 저장소를 통째로 찍어 두었다가 끝에 되돌린다 ──
  {
    const fakeKey = ['sk', 'ant', 'x'.repeat(8), 'FAKEKEY', 'y'.repeat(12)].join('-');
    const settingsOpen = async () => { await evaluate(s.cdp, "document.getElementById('settings-open').click()"); await sleep(150); };
    const settingsClose = async () => { await clickTestId(s.cdp, 'settings-close'); await sleep(100); };
    const typeInto = (testid, value) => evaluate(s.cdp, `(() => { const e = document.querySelector('[data-testid=${testid}]'); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event('input')); e.dispatchEvent(new Event('change')); })()`);
    const importOpen = async () => { await evaluate(s.cdp, "window.confirm = () => true; document.getElementById('import-open').click()"); await sleep(200); };
    const importClose = async () => { await evaluate(s.cdp, "document.getElementById('import-dialog').open && document.querySelector('[data-testid=import-close]').click()"); await sleep(100); };
    const aiUi = () => evaluate(s.cdp, "({ btn: !!document.querySelector('[data-testid=btn-ai-convert]'), convert: !!document.querySelector('[data-testid=import-convert]'), note: (document.querySelector('[data-testid=import-method-note]') || {}).textContent || '' })");
    const pressAi = async () => { await clickTestId(s.cdp, 'import-example'); await sleep(100); await clickTestId(s.cdp, 'btn-ai-convert'); };
    const calls = () => evaluate(s.cdp, 'window.__wu.fakeLlm.calls.length');
    const aiChip = "document.querySelector('[data-testid=import-ai-chip]')";
    await reloadApp();
    const snap = await evaluate(s.cdp, 'JSON.stringify(Object.entries(localStorage))');
    await evaluate(s.cdp, "window.__wu.useFakeLlm('convert')");
    // 1) 키가 없다: 「초벌 변환」만 있고 안내 문구도 지금과 같다
    await importOpen();
    const noKey = await aiUi();
    check('CR-15 T-37 키가 없으면 문서 탭에 「AI로 변환」이 없고(초벌 변환만) 안내 문구가 지금과 같음', !noKey.btn && noKey.convert && noKey.note.includes('문서 변환은 규칙으로 읽습니다'), JSON.stringify(noKey));
    await importClose();
    // 2) 키를 넣는다: 「Claude API」 + 키 → 문서 탭에 「AI로 변환」(초벌 변환 옆)
    await settingsOpen();
    await evaluate(s.cdp, "(() => { const r = document.querySelector('[data-testid=provider-claude_api]'); r.checked = true; r.dispatchEvent(new Event('change')); })()");
    await sleep(100);
    await typeInto('settings-apikey', fakeKey);
    await sleep(100);
    await settingsClose();
    await importOpen();
    const withKey = await evaluate(s.cdp, "(() => { const b = document.querySelector('[data-testid=btn-ai-convert]'); const c = document.querySelector('[data-testid=import-convert]'); const r = b ? b.getBoundingClientRect() : { width: 0, height: 0 }; return { text: b ? b.textContent : '', size: r.width > 0 && r.height > 0, next: !!b && b.previousElementSibling === c, live: !!document.querySelector('[data-testid=ai-convert-live]'), note: (document.querySelector('[data-testid=import-method-note]') || {}).textContent || '' }; })()");
    check('CR-15 T-37 키를 넣으면 「초벌 변환」 옆에 「AI로 변환」이 보이고(크기 있음) 규칙 변환 단추도 그대로', withKey.text === 'AI로 변환' && withKey.size && withKey.next && withKey.live && withKey.note.includes('Claude가 읽습니다'), JSON.stringify(withKey));
    // 3) 누르면 「AI가 읽는 중…」 → 미리 보기
    await evaluate(s.cdp, 'window.__wu.fakeLlm.delayMs = 700');
    await pressAi();
    await sleep(250);
    const during = await evaluate(s.cdp, "(() => { const n = document.querySelector('[data-testid=ai-convert-live]'); const b = document.querySelector('[data-testid=btn-ai-convert]'); return { note: n ? n.textContent : '', aria: n ? n.getAttribute('aria-live') : '', disabled: b ? b.disabled : null, preview: !!document.querySelector('[data-testid=import-confirm]'), calls: window.__wu.fakeLlm.calls.length }; })()");
    check('CR-15 T-37 누르면 「AI가 읽는 중… (최대 90초)」(aria-live=polite)가 보이고 단추가 잠기며 아직 미리 보기는 없음, 호출 1회', during.note === 'AI가 읽는 중… (최대 90초)' && during.aria === 'polite' && during.disabled === true && !during.preview && during.calls === 1, JSON.stringify(during));
    const shown = await waitFor(s.cdp, `!!${aiChip}`, 5000);
    const done = await evaluate(s.cdp, `(() => ({ chip: ${aiChip} ? ${aiChip}.textContent : '', method: (document.querySelector('[data-testid=import-method]') || {}).textContent || '', dropped: (document.querySelector('[data-testid=import-ai-dropped] summary') || {}).textContent || '', droppedList: (document.querySelector('[data-testid=import-ai-dropped]') || {}).textContent || '', summary: (document.querySelector('[data-testid=import-summary]') || {}).textContent || '', gran: !!document.querySelector('[data-testid=import-granularity]'), source: (document.querySelector('[data-testid=import-source]') || {}).textContent || '', rows: document.querySelectorAll('[data-testid=import-sections] tbody tr').length, nodes: (document.querySelector('[data-testid=import-nodes]') || {}).textContent || '', live: (document.querySelector('[data-testid=ai-convert-live]') || {}).textContent, aiTag: !!document.querySelector('.error-text[data-testid=import-errors]') }))()`);
    check('CR-15 T-37 미리 보기 머리에 칩 「AI 변환 · 모델명」과 Claude API(실시간) 방식 안내가 보이고 규칙 방식 문구는 없음', shown && done.chip === 'AI 변환 · claude-opus-5-5' && done.method.includes('Claude API(실시간)') && !done.method.includes('규칙 v1') && done.live === '', JSON.stringify(done));
    check('CR-15 T-37 미리 보기: 노드 표(업무 5·사람 3·산출물 3·주제 3)와 원문 근거 15/15, 세분화 줄(월말 정산 수준)은 없음', shown && done.summary.includes('항목 15개') && done.summary.includes('업무 5') && done.summary.includes('사람 3') && done.summary.includes('산출물 3') && done.summary.includes('주제 3') && done.source === '항목 15/15개' && !done.gran && done.rows === 6 && done.nodes.includes('승인취소') && done.nodes.includes('절차: ①'), JSON.stringify({ summary: done.summary, source: done.source, rows: done.rows, gran: done.gran })); // CR-18-2
    check('CR-15 T-37 「원문 인용이 확인되지 않아 뺀 항목 1개」(펼치면 지어낸 업무 사유)가 보임', done.dropped === '원문 인용이 확인되지 않아 뺀 항목 1개' && done.droppedList.includes('지어낸 업무') && done.droppedList.includes('원문에서 인용을 찾지 못함') && !done.nodes.includes('지어낸 업무'), JSON.stringify({ dropped: done.dropped, list: done.droppedList }));
    await shot(s.cdp, `${browser.name}-42-ai-convert-preview`);
    // 4) 같은 글로 다시 누르면 호출이 늘지 않는다(메모리 캐시)
    const calls1 = await calls();
    await clickTestId(s.cdp, 'btn-ai-convert');
    await waitFor(s.cdp, "(document.querySelector('[data-testid=ai-convert-live]') || {}).textContent === '' && !!document.querySelector('[data-testid=import-ai-chip]')", 3000);
    check('CR-15 T-37 같은 글로 다시 「AI로 변환」을 눌러도 호출이 늘지 않음', calls1 === 1 && (await calls()) === calls1, `호출 ${calls1}→${await calls()}`);
    // 5) 작성 주체를 넣고 가져오기 → 유니버스가 열리고 tags에 「AI 변환」
    await evaluate(s.cdp, "(() => { const i = document.getElementById('import-owner'); i.value = '가상 시스템분석팀'; i.dispatchEvent(new Event('input', { bubbles: true })); })()");
    await sleep(150);
    await clickTestId(s.cdp, 'import-confirm');
    const opened = await waitFor(s.cdp, "window.__wu && window.__wu.doc && (window.__wu.doc.universe.tags || []).includes('AI 변환') && window.__wu.cy.nodes().length === 15", 8000);
    const imp = opened ? await evaluate(s.cdp, "({ tags: window.__wu.doc.universe.tags, works: window.__wu.doc.nodes.filter((n) => n.core_type === 'work').length, conv: window.__wu.doc.nodes.filter((n) => n.attrs && String(n.attrs.변환 || '').startsWith('AI 변환(')).length, key: JSON.stringify(window.__wu.doc).includes(" + JSON.stringify(fakeKey) + ") })") : null;
    check('CR-15 T-37 「가져오기」 → 유니버스가 열리고(노드 15) tags에 「AI 변환」, 업무 5개, 모든 노드에 변환 속성, 키는 문서에 없음', opened && imp.tags.includes('AI 변환') && imp.works === 5 && imp.conv === 15 && imp.key === false, JSON.stringify(imp));
    // 6) 실패(시간 초과): 규칙 변환 결과 + 「AI 변환 실패: … — 규칙 변환 결과를 보여 줍니다」
    // 가져오기가 페이지를 다시 읽으므로 가짜 클라이언트를 다시 넣는다(넣기 전에는 단추를 누르지 않는다: 실제 호출 방지)
    await evaluate(s.cdp, "window.__wu.useFakeLlm('timeout').delayMs = 100");
    await importOpen();
    await pressAi();
    const failedShown = await waitFor(s.cdp, "!!document.querySelector('[data-testid=import-fallback]')", 5000);
    const failed = await evaluate(s.cdp, "({ fb: (document.querySelector('[data-testid=import-fallback]') || {}).textContent || '', chip: !!document.querySelector('[data-testid=import-ai-chip]'), nodes: (document.querySelector('[data-testid=import-summary]') || {}).textContent || '', method: (document.querySelector('[data-testid=import-method]') || {}).textContent || '', live: (document.querySelector('[data-testid=ai-convert-live]') || {}).textContent })");
    check('CR-15 T-37 실패(시간 초과) → 「AI 변환 실패: 연결 실패·시간 초과 — 규칙 변환 결과를 보여 줍니다」 + 규칙 변환 미리 보기(노드 18), AI 칩 없음', failedShown && failed.fb === 'AI 변환 실패: 연결 실패·시간 초과 — 규칙 변환 결과를 보여 줍니다' && !failed.chip && failed.nodes.includes('항목 18개') && failed.method.includes('규칙 v1') && failed.live === '', JSON.stringify(failed)); // CR-18-2
    // 7) 응답을 기다리다 글을 바꾸면 응답은 버려진다
    await evaluate(s.cdp, "window.__wu.fakeLlm.mode = 'convert'; window.__wu.fakeLlm.delayMs = 600; window.__aiErr = []; window.addEventListener('error', (e) => window.__aiErr.push(String(e.message))); window.addEventListener('unhandledrejection', (e) => window.__aiErr.push(String(e.reason)))");
    await clickTestId(s.cdp, 'import-tab-doc');
    await sleep(100);
    await pressAi();
    await sleep(150);
    await evaluate(s.cdp, "(() => { const t = document.getElementById('import-doc'); t.value = t.value + '\\n한 줄 더'; t.dispatchEvent(new Event('input', { bubbles: true })); })()");
    await sleep(1000);
    const edited = await evaluate(s.cdp, "({ chip: !!document.querySelector('[data-testid=import-ai-chip]'), preview: !!document.querySelector('[data-testid=import-confirm]'), live: (document.querySelector('[data-testid=ai-convert-live]') || {}).textContent, disabled: document.querySelector('[data-testid=btn-ai-convert]').disabled, err: window.__aiErr })");
    check('CR-15 T-37 응답을 기다리다 글을 바꾸면 응답이 버려짐(미리 보기·칩 없음, 안내 지워짐, 단추 다시 켜짐, 오류 없음)', !edited.chip && !edited.preview && edited.live === '' && edited.disabled === false && edited.err.length === 0, JSON.stringify(edited));
    // 8) 응답을 기다리다 창을 닫으면 응답이 버려진다
    await pressAi();
    await sleep(150);
    await importClose();
    await sleep(900);
    await importOpen();
    const closed = await evaluate(s.cdp, "({ chip: !!document.querySelector('[data-testid=import-ai-chip]'), preview: !!document.querySelector('[data-testid=import-confirm]'), err: window.__aiErr })");
    check('CR-15 T-37 응답을 기다리다 창을 닫으면 응답이 버려지고 다시 열면 미리 보기가 없음, 오류 없음', !closed.chip && !closed.preview && closed.err.length === 0, JSON.stringify(closed));
    await importClose();
    // 9) 키 지우기 → 「AI로 변환」이 사라진다
    await settingsOpen();
    await clickTestId(s.cdp, 'settings-clear-key');
    await sleep(100);
    await settingsClose();
    await importOpen();
    const cleared = await aiUi();
    check('CR-15 T-37 키를 지우면 「AI로 변환」이 사라지고 안내 문구가 지금과 같음', !cleared.btn && cleared.convert && cleared.note.includes('문서 변환은 규칙으로 읽습니다'), JSON.stringify(cleared));
    await importClose();
    // 저장소를 시작 때로 되돌리고 U-A1로 돌아간다(가져온 유니버스·설정이 뒤 단계에 남지 않게)
    await evaluate(s.cdp, `(() => { const snap = JSON.parse(${JSON.stringify(snap)}); localStorage.clear(); for (const [k, v] of snap) localStorage.setItem(k, v); location.hash = 'U-A1'; location.reload(); })()`).catch(() => {});
    await sleep(500);
    await waitFor(s.cdp, "window.__wu && window.__wu.doc && window.__wu.doc.universe.id === 'U-A1'", 8000);
  }

  // ── W8·W9 업무정의서 한 장 읽기(처음 사용 점검 3회차, CR-17 J 승인안: 스위치 7개 켬 — summaryToWork·periodDeadline은 꺼짐, authorPickOrg는 키 「작성」·「작성 부서」 한정으로 켬): 법인세 중간예납 정의서(가상)를 붙여 「초벌 변환」 →
  //    사람 2·산출물 1·「작성: 가상재무팀 류다온 / 2026-09-01」은 조직 낱말만 작성 주체 「가상재무팀」으로(⑤ 켬, 입력 안내 없음)·표준 양식 줄에 「권장 항목이 비어 있음」(설명·주기·마감은 ⑦⑧ 꺼짐이라 비어 있고, 관련 문서·담당은 채워짐)·담당 추정 알림(주 담당 1건)·노드 수 알림이 겁주지 않는 말 →
  //    이름 칸을 고치면 꼭지 이름과 대표 업무 이름이 함께 바뀌고 「업무 이름도 함께 바뀝니다」 안내(스위치 previewRenameWork 켬, ⑨). 가져오지 않고 닫는다(저장소 불변) ──
  {
    const W8_DOC = ['업무정의서: 법인세 중간예납 준비', '작성: 가상재무팀 류다온 / 2026-09-01', '1. 업무 개요', '매년 8월 법인세 중간예납 세액을 계산하고 신고서를 준비한다.', '2. 처리 절차',
      '① 상반기 손익 자료 수집(회계 시스템에서 내려받기)', '② 전년도 납부세액 기준 계산과 가결산 기준 계산 비교', '③ 신고서 초안 작성 후 팀장 검토', '④ 8월 31일까지 신고·납부', '3. 주의사항',
      '- 가결산 방식을 고르면 반기 결산 자료가 확정돼야 한다', '- 마감일이 주말이면 다음 영업일', '4. 관련 문서', '- 중간예납 계산표(공유 드라이브 > 재무 > 세무)', '5. 담당', '- 주 담당: 류다온 / 검토: 가상재무팀장', ''].join('\n');
    await evaluate(s.cdp, "window.confirm = () => true; document.getElementById('import-open').click()");
    await sleep(200);
    await evaluate(s.cdp, `(() => { const t = document.getElementById('import-doc'); t.value = ${JSON.stringify(W8_DOC)}; t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await clickTestId(s.cdp, 'import-convert');
    await sleep(300);
    const w8 = await evaluate(s.cdp, "({ summary: (document.querySelector('[data-testid=import-summary]') || {}).textContent || '', owner: (document.getElementById('import-owner') || {}).value || '', form: (document.querySelector('[data-testid=import-form] summary') || {}).textContent || '', notes: (document.querySelector('[data-testid=import-notes]') || {}).textContent || '', nodes: (document.querySelector('[data-testid=import-nodes]') || {}).textContent || '', sections: (document.querySelector('[data-testid=import-sections]') || {}).textContent || '' })");
    check('W8 업무정의서 한 장: 미리 보기 규모가 사람 2·산출물 1이고 주제(규칙 밖)가 없음', /사람 2/.test(w8.summary) && /산출물 1/.test(w8.summary) && !/주제/.test(w8.summary) && !w8.notes.includes('규칙에 없는 제목'), w8.summary);
    check('W8 「작성: 가상재무팀 류다온 / 2026-09-01」은 조직 낱말만 작성 주체로 읽어(⑤ 켬) 작성 주체 칸이 「가상재무팀」이고 입력 안내가 없으며, 노드 목록에 업무 이름의 접두어가 없음', w8.owner === '가상재무팀' && !w8.notes.includes('원문에서 작성 주체를 읽지 못했습니다') && w8.nodes.includes('법인세 중간예납 준비') && !/(^|\s)업무정의서: 법인세 중간예납 준비 원문 §2/.test(w8.nodes), JSON.stringify([w8.owner, w8.nodes.slice(0, 160)]));
    check('CR-17 J 표준 양식 줄이 「업무 1개 중 1개에 권장 항목이 비어 있음」(설명·주기·마감은 문장에서 고르지 않아 비어 있음, 담당·관련 문서는 채워짐) · 담당(수행) 추정 알림에 「주 담당·담당·정」 1건', w8.form.includes('업무 1개 중 1개에 권장 항목이 비어 있음') && w8.notes.includes('담당(수행) 연결 1건') && w8.notes.includes('담당 절에 「주 담당·담당·정」으로 적힌 사람'), w8.form + ' / ' + w8.notes.slice(0, 300));
    check('W8 노드 수 알림이 실패처럼 읽히지 않음(「10개 이상 목표」 없음, 「업무 하나짜리 문서라면 정상」 있음)', !w8.notes.includes('이상 목표') && w8.notes.includes('업무 하나짜리 문서라면 정상') && w8.summary.length > 0, w8.notes.slice(0, 200));
    await evaluate(s.cdp, "(() => { const e = document.getElementById('import-name'); e.value = '법인세 중간예납 신고 준비'; e.dispatchEvent(new Event('input', { bubbles: true })); })()");
    await sleep(150);
    const w8n = await text(s.cdp, '[data-testid=import-nodes]');
    check('CR-17 J ⑨ 미리 보기에서 지도 이름을 고치면 꼭지 이름과 대표 업무 이름이 함께 바뀌고(법인세 중간예납 신고 준비 두 곳), 「업무 이름도 함께 바뀝니다」 안내가 보임', (w8n.match(/법인세 중간예납 신고 준비/g) || []).length >= 2 && (await text(s.cdp, '#import-dialog')).includes('업무 이름도 함께 바뀝니다'), w8n.slice(0, 200));
    await evaluate(s.cdp, "document.getElementById('import-dialog').open && document.querySelector('[data-testid=import-close]').click()");
    await sleep(100);
  }

  // ── CR-15 T-38 C AI 연관 후보(가짜 클라이언트, 실제 호출 없음): 가상 운영부(U-D1) 통합 확인 목록 — 키가 없으면 단추 없음 → 키를 넣으면 「AI로 연관 찾기」 →
  //    「비교하는 중」 → 「AI 후보」 칩·이유·인용 두 줄, 「AI 후보 n개(뺀 쌍 m개)」, 기존 후보 그대로(+AI) → 같은 업무 목록으로 다시 눌러도 호출 없음 → 닫았다 열면 처음 →
  //    실패하면 「기존 후보만」 안내 → 응답을 기다리다 닫거나 다른 노드를 고르면 응답 버림 → 키 지우기 → 단추 없음. 확정·거부는 누르지 않는다(데이터 불변). 저장소는 끝에 되돌린다 ──
  {
    const fakeKey = ['sk', 'ant', 'x'.repeat(8), 'FAKEKEY', 'y'.repeat(12)].join('-');
    const settingsOpen = async () => { await evaluate(s.cdp, "document.getElementById('settings-open').click()"); await sleep(150); };
    const settingsClose = async () => { await clickTestId(s.cdp, 'settings-close'); await sleep(100); };
    const typeInto = (testid, value) => evaluate(s.cdp, `(() => { const e = document.querySelector('[data-testid=${testid}]'); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event('input')); e.dispatchEvent(new Event('change')); })()`);
    const openMerge = async () => { await evaluate(s.cdp, 'window.__wu.select(null)'); await sleep(150); await clickTestId(s.cdp, 'btn-merge'); await sleep(200); };
    const closeMerge = async () => { await evaluate(s.cdp, "[...document.querySelectorAll('[data-testid=merge-panel] button')].find((b) => b.textContent === '닫기').click()"); await sleep(150); };
    const calls = () => evaluate(s.cdp, 'window.__wu.fakeLlm.calls.length');
    const aiUi = () => evaluate(s.cdp, "({ btn: !!document.querySelector('[data-testid=btn-ai-candidates]'), live: !!document.querySelector('[data-testid=ai-candidates-live]'), chips: document.querySelectorAll('[data-testid=candidate-ai-chip]').length, summary: !!document.querySelector('[data-testid=ai-candidates-summary]'), fb: !!document.querySelector('[data-testid=ai-candidates-fallback]'), works: document.querySelectorAll('[data-testid=merge-works] li').length })");
    await evaluate(s.cdp, "location.hash = 'U-D1'; location.reload()").catch(() => {});
    await sleep(500);
    await waitFor(s.cdp, "window.__wu && window.__wu.doc && window.__wu.doc.universe.id === 'U-D1' && window.__wu.cy.nodes().length > 0", 8000);
    const snap = await evaluate(s.cdp, 'JSON.stringify(Object.entries(localStorage))');
    await evaluate(s.cdp, "window.__wu.useFakeLlm('candidates')");
    const linksBefore = await evaluate(s.cdp, 'window.__wu.doc.identity_links.length');
    // 1) 키가 없다: 단추도 안내 칸도 없고 업무 후보 4건은 지금과 같다
    await openMerge();
    const noKey = await aiUi();
    const baseTexts = await evaluate(s.cdp, "JSON.stringify([...document.querySelectorAll('[data-testid=merge-works] li')].map((li) => li.textContent))");
    const base = noKey.works; // 이 블록이 돌 때의 후보 수(앞 블록들이 판정 기록을 바꿀 수 있어 고정값을 쓰지 않는다)
    check('CR-15 T-38 키가 없으면 통합 확인 목록에 「AI로 연관 찾기」도 안내 칸도 없고 업무 후보 4건이 지금과 같음', !noKey.btn && !noKey.live && noKey.chips === 0 && noKey.works >= 1, JSON.stringify(noKey));
    await closeMerge();
    // 2) 키를 넣는다: 「Claude API」 + 키 → 목록 머리에 「AI로 연관 찾기」
    await settingsOpen();
    await evaluate(s.cdp, "(() => { const r = document.querySelector('[data-testid=provider-claude_api]'); r.checked = true; r.dispatchEvent(new Event('change')); })()");
    await sleep(100);
    await typeInto('settings-apikey', fakeKey);
    await sleep(100);
    await settingsClose();
    await openMerge();
    const withKey = await evaluate(s.cdp, "(() => { const b = document.querySelector('[data-testid=btn-ai-candidates]'); const h = [...document.querySelectorAll('[data-testid=merge-panel] h3')].find((x) => x.textContent.startsWith('업무 후보')); const r = b ? b.getBoundingClientRect() : { width: 0, height: 0 }; const live = document.querySelector('[data-testid=ai-candidates-live]'); return { text: b ? b.textContent : '', size: r.width > 0 && r.height > 0, enabled: b ? !b.disabled : false, below: !!b && !!h && h.compareDocumentPosition(b) === Node.DOCUMENT_POSITION_FOLLOWING, live: !!live, aria: live ? live.getAttribute('aria-live') : '', liveText: live ? live.textContent : '?', works: document.querySelectorAll('[data-testid=merge-works] li').length }; })()");
    check('CR-15 T-38 키를 넣으면 「업무 후보」 제목 아래에 「AI로 연관 찾기」(크기 있음)와 안내 칸(aria-live=polite, 비어 있음)이 보이고 후보 4건은 그대로', withKey.text === 'AI로 연관 찾기' && withKey.size && withKey.enabled && withKey.below && withKey.live && withKey.aria === 'polite' && withKey.liveText === '' && withKey.works === base, JSON.stringify(withKey));
    // 3) 누르면 「AI가 업무를 비교하는 중… (최대 60초)」 → 「AI 후보」
    await evaluate(s.cdp, 'window.__wu.fakeLlm.delayMs = 700');
    await clickTestId(s.cdp, 'btn-ai-candidates');
    await sleep(250);
    const during = await evaluate(s.cdp, "(() => { const n = document.querySelector('[data-testid=ai-candidates-live]'); const b = document.querySelector('[data-testid=btn-ai-candidates]'); return { note: n ? n.textContent : '', disabled: b ? b.disabled : null, chips: document.querySelectorAll('[data-testid=candidate-ai-chip]').length, calls: window.__wu.fakeLlm.calls.length }; })()");
    check('CR-15 T-38 누르면 「AI가 업무를 비교하는 중… (최대 60초)」가 보이고 단추가 잠기며 아직 AI 후보는 없음, 호출 1회', during.note === 'AI가 업무를 비교하는 중… (최대 60초)' && during.disabled === true && during.chips === 0 && during.calls === 1, JSON.stringify(during));
    const shown = await waitFor(s.cdp, "document.querySelectorAll('[data-testid=candidate-ai-chip]').length > 0", 5000);
    const done = await evaluate(s.cdp, "(() => { const li = document.querySelector('[data-testid=merge-works] li[data-source=ai]'); const h = [...document.querySelectorAll('[data-testid=merge-panel] h3')].find((x) => x.textContent.startsWith('업무 후보')); const drop = document.querySelector('[data-testid=ai-candidates-dropped]'); return { chips: document.querySelectorAll('[data-testid=candidate-ai-chip]').length, works: document.querySelectorAll('[data-testid=merge-works] li').length, head: h ? h.textContent : '', summary: (document.querySelector('[data-testid=ai-candidates-summary]') || {}).textContent || '', live: (document.querySelector('[data-testid=ai-candidates-live]') || {}).textContent, title: li ? li.querySelector('strong').textContent : '', chipText: li ? li.querySelector('[data-testid=candidate-ai-chip]').textContent : '', quotes: li ? [...li.querySelectorAll('[data-testid=candidate-ai-quote]')].map((x) => x.textContent) : [], reason: li && li.querySelector('[data-testid=candidate-ai]') ? li.querySelector('[data-testid=candidate-ai]').textContent : '', score: li ? [...li.querySelectorAll('.who .chip')].map((x) => x.textContent) : [], btns: li ? li.querySelectorAll('[data-testid=merge-same], [data-testid=merge-diff]').length : 0, dropSummary: drop ? drop.querySelector('summary').textContent : '', dropText: drop ? drop.textContent : '', disabled: document.querySelector('[data-testid=btn-ai-candidates]').disabled, texts: JSON.stringify([...document.querySelectorAll('[data-testid=merge-works] li:not([data-source=ai])')].map((x) => x.textContent)) }; })()");
    check('CR-15 T-38 「AI 후보」 칩이 1개 붙은 후보가 목록 끝에 더해짐(제목·칩·이유·인용 두 줄·「같은 업무」/「다른 업무」 단추, 점수 칩 없음)', shown && done.chips === 1 && done.works === base + 1 && done.head === `업무 후보 ${base + 1}건` && done.chipText === 'AI 후보' && done.title.includes('참가자 모집') && done.title.includes('신입 교육 운영') && done.quotes.length === 2 && done.quotes[0].includes('참가자 모집') && done.quotes[1].includes('신입 교육 운영') && done.reason.includes('같은 일을 다른 이름으로') && done.reason.includes('Claude API') && done.score.join() === 'AI 후보' && done.btns === 2, JSON.stringify(done));
    check('CR-15 T-38 머리에 「AI 후보 1개(확인되지 않아 뺀 쌍 3개)」와 뺀 쌍 목록(지어낸 업무·틀린 인용·같은 업무 지도), 안내 문구는 지워지고 단추는 다시 켜짐', shown && done.summary === 'AI 후보 1개(확인되지 않아 뺀 쌍 3개)' && done.dropSummary === '원문 인용·업무가 확인되지 않아 뺀 쌍 3개' && done.dropText.includes('지어낸 업무') && done.dropText.includes('인용을 찾지 못함') && done.dropText.includes('같은 업무 지도 안의 쌍') && done.live === '' && done.disabled === false, JSON.stringify({ summary: done.summary, dropSummary: done.dropSummary, live: done.live, disabled: done.disabled }));
    check('CR-15 T-38 기존 후보 4건은 순서·내용 그대로이고 AI 후보는 그 뒤에만 더해짐(판정 기록 수도 그대로 — 확정·거부를 누르지 않음)', shown && done.texts === baseTexts && (await evaluate(s.cdp, 'window.__wu.doc.identity_links.length')) === linksBefore, JSON.stringify({ base: JSON.parse(baseTexts).length, now: JSON.parse(done.texts).length, diff: JSON.parse(done.texts).map((t, i) => [t.slice(0, 60), (JSON.parse(baseTexts)[i] || "").slice(0, 60)]).filter(([a, b]) => a !== b).slice(0, 2) }));
    const nullSpots = await nullTextSpots(s.cdp);
    check('CR-15 T-38 AI 후보가 보이는 목록에 "null" 글자 없음', nullSpots.length === 0, JSON.stringify(nullSpots));
    await shot(s.cdp, `${browser.name}-43-ai-candidates`);
    // 4) 같은 업무 목록으로 다시 눌러도 호출이 늘지 않는다(메모리 캐시) — 결과는 그대로
    const calls1 = await calls();
    await clickTestId(s.cdp, 'btn-ai-candidates');
    await waitFor(s.cdp, "(document.querySelector('[data-testid=ai-candidates-live]') || {}).textContent === '' && !!document.querySelector('[data-testid=ai-candidates-summary]')", 3000);
    const again = await aiUi();
    check('CR-15 T-38 다시 눌러도 호출이 늘지 않고(캐시) AI 후보는 그대로 1개', calls1 === 1 && (await calls()) === calls1 && again.chips === 1 && again.works === base + 1, `호출 ${calls1}→${await calls()} ${JSON.stringify(again)}`);
    // 5) 닫았다가 다시 열면 처음 상태(결과를 남기지 않는다)
    await closeMerge();
    await openMerge();
    const reopened = await aiUi();
    check('CR-15 T-38 목록을 닫았다 다시 열면 AI 후보·요약이 없고 기존 후보 4건만(단추는 있음)', reopened.btn && reopened.chips === 0 && !reopened.summary && reopened.works === base, JSON.stringify(reopened));
    // 6) 실패(시간 초과): 「AI 연관 찾기 실패: … — 기존 후보만 보여 줍니다」 + 기존 후보 4건 그대로
    await evaluate(s.cdp, "window.__wu.useFakeLlm('timeout').delayMs = 100");
    await closeMerge();
    await openMerge();
    await clickTestId(s.cdp, 'btn-ai-candidates');
    const failedShown = await waitFor(s.cdp, "!!document.querySelector('[data-testid=ai-candidates-fallback]')", 5000);
    const failed = await evaluate(s.cdp, "({ fb: (document.querySelector('[data-testid=ai-candidates-fallback]') || {}).textContent || '', chips: document.querySelectorAll('[data-testid=candidate-ai-chip]').length, summary: !!document.querySelector('[data-testid=ai-candidates-summary]'), works: document.querySelectorAll('[data-testid=merge-works] li').length, live: (document.querySelector('[data-testid=ai-candidates-live]') || {}).textContent, disabled: document.querySelector('[data-testid=btn-ai-candidates]').disabled })");
    check('CR-15 T-38 실패(시간 초과) → 「AI 연관 찾기 실패: 연결 실패·시간 초과 — 기존 후보만 보여 줍니다」 + 후보 4건 그대로, AI 후보·요약 없음, 단추 다시 켜짐', failedShown && failed.fb === 'AI 연관 찾기 실패: 연결 실패·시간 초과 — 기존 후보만 보여 줍니다' && failed.chips === 0 && !failed.summary && failed.works === base && failed.live === '' && failed.disabled === false, JSON.stringify(failed));
    // 7) 응답을 기다리다 닫으면 응답이 버려진다 / 다른 노드를 골라 목록을 벗어나도 버려진다
    await evaluate(s.cdp, "window.__wu.fakeLlm.mode = 'candidates'; window.__wu.fakeLlm.delayMs = 600; window.__aiErr = []; window.addEventListener('error', (e) => window.__aiErr.push(String(e.message))); window.addEventListener('unhandledrejection', (e) => window.__aiErr.push(String(e.reason)))");
    await clickTestId(s.cdp, 'btn-ai-candidates');
    await sleep(150);
    await closeMerge();
    await sleep(900);
    await openMerge();
    const closedWhile = await aiUi();
    const liveAfter = await evaluate(s.cdp, "({ live: (document.querySelector('[data-testid=ai-candidates-live]') || {}).textContent, disabled: document.querySelector('[data-testid=btn-ai-candidates]').disabled, err: window.__aiErr })");
    check('CR-15 T-38 응답을 기다리다 닫으면 응답이 버려짐(다시 열면 AI 후보·요약 없음, 안내 지워짐, 단추 켜짐, 오류 없음)', closedWhile.chips === 0 && !closedWhile.summary && closedWhile.works === base && liveAfter.live === '' && liveAfter.disabled === false && liveAfter.err.length === 0, JSON.stringify({ closedWhile, liveAfter }));
    await clickTestId(s.cdp, 'btn-ai-candidates');
    await sleep(150);
    await evaluate(s.cdp, "window.__wu.select('U-A1/N-001')");
    await sleep(900);
    await openMerge();
    const leftWhile = await aiUi();
    check('CR-15 T-38 응답을 기다리다 다른 노드를 골라 목록을 벗어나도 응답이 버려짐(다시 열면 처음 상태, 오류 없음)', leftWhile.chips === 0 && !leftWhile.summary && !leftWhile.fb && leftWhile.works === base && (await evaluate(s.cdp, 'window.__aiErr.length')) === 0, JSON.stringify(leftWhile));
    await closeMerge();
    // 8) 키 지우기 → 「AI로 연관 찾기」가 사라진다
    await settingsOpen();
    await clickTestId(s.cdp, 'settings-clear-key');
    await sleep(100);
    await settingsClose();
    await openMerge();
    const cleared = await aiUi();
    check('CR-15 T-38 키를 지우면 「AI로 연관 찾기」와 안내 칸이 사라지고 업무 후보 4건이 지금과 같음', !cleared.btn && !cleared.live && cleared.chips === 0 && cleared.works === base, JSON.stringify(cleared));
    await closeMerge();
    // 저장소를 시작 때로 되돌리고 U-A1로 돌아간다(설정이 뒤 단계에 남지 않게)
    await evaluate(s.cdp, `(() => { const snap = JSON.parse(${JSON.stringify(snap)}); localStorage.clear(); for (const [k, v] of snap) localStorage.setItem(k, v); location.hash = 'U-A1'; location.reload(); })()`).catch(() => {});
    await sleep(500);
    await waitFor(s.cdp, "window.__wu && window.__wu.doc && window.__wu.doc.universe.id === 'U-A1'", 8000);
  }

  // ── 처음 사용 W3(2026-10-24, 처음 사용 점검 FU-5·6·7·10·11·12·13·15·16·23): 인사이트 기본 탭 risk·맨 위 스크롤, 노드 상세 「← 지도 전체 보기」,
  //    묶은 지도 위험 요약 = 탭 숫자, 사람 「이 사람만 아는 일」, 사번 충돌 접힘, 이력 속성 수정 글, 권장 항목 단추, wu:add-node, 폴더 연결 세 줄, 묶기 안내, 「지도 이름」.
  //    데이터는 저장하지 않는다(예외: 초안 창에서 사람을 추가해 보고 바로 「삭제」로 되돌림 — 노드 수가 같아야 통과) ──
  {
    const gotoU = async (id) => {
      await evaluate(s.cdp, `location.hash = ${JSON.stringify(id)}; location.reload()`).catch(() => {});
      await sleep(500);
      const ok = await waitFor(s.cdp, `window.__wu && window.__wu.doc && window.__wu.doc.universe.id === ${JSON.stringify(id)} && window.__wu.cy.nodes().length > 0`, 8000);
      await evaluate(s.cdp, 'window.confirm = () => true');
      return ok;
    };
    const box = (testid) => evaluate(s.cdp, `(() => { const e = document.querySelector('[data-testid=${testid}]'); if (!e) return null; const r = e.getBoundingClientRect(); return { w: r.width, h: r.height, text: e.textContent }; })()`);
    const activeTab = () => evaluate(s.cdp, "(document.querySelector('.insight .tab.active') || { dataset: {} }).dataset.testid || ''");
    const num = (re, str) => { const m = re.exec(str); return m ? Number(m[1]) : 0; };

    // ── 가상 운영부(U-D1): 묶은 지도 ──
    if (await gotoU('U-D1')) {
      await evaluate(s.cdp, 'window.__wu.select(null)');
      await sleep(200);
      // FU-10 위험 요약 한 줄
      const sum = await box('team-risk-summary');
      check('W3 FU-10 묶은 지도(가상 운영부) 개요에 위험 요약 한 줄(크기 있음): 혼자만 아는 일·일 몰린 사람·담당자 빈 일 + 「자세히」',
        !!sum && sum.w > 100 && sum.h > 10 && /혼자만 아는 일 (\d+개|없음)/.test(sum.text) && /일 몰린 사람 (\d+명|없음)/.test(sum.text) && /담당자 빈 일 (\d+개|없음)/.test(sum.text) && sum.text.includes('자세히'), sum && sum.text);
      const sumSolo = num(/혼자만 아는 일 (\d+)개/, sum ? sum.text : '');
      const sumDense = num(/일 몰린 사람 (\d+)명/, sum ? sum.text : '');
      const sumGaps = num(/담당자 빈 일 (\d+)개/, sum ? sum.text : '');
      // FU-13 사번 충돌 접힘 (개요를 연 이 자리에서)
      const conflicts = await evaluate(s.cdp, 'window.__wu.view.empno_conflicts.length');
      const fold = await evaluate(s.cdp, "(() => { const d = document.querySelector('[data-testid=empno-conflicts]'); if (!d) return null; const p = d.querySelector('[data-testid=empno-conflict]'); return { open: d.open, summary: d.querySelector('summary').textContent, inner: p ? p.textContent : '', innerVisible: p ? p.checkVisibility() : null }; })()");
      check('W3 FU-13 사번 충돌은 접힌 한 줄 「사번 확인 필요 n건」(펼치기 전에는 내용이 안 보임)', conflicts > 0 && !!fold && !fold.open && fold.summary === `사번 확인 필요 ${conflicts}건` && fold.inner.includes('V-1002') && fold.innerVisible === false, JSON.stringify({ conflicts, fold }));
      await evaluate(s.cdp, "document.querySelector('[data-testid=empno-conflicts] summary').click()");
      await sleep(150);
      const foldOpen = await evaluate(s.cdp, "(() => { const d = document.querySelector('[data-testid=empno-conflicts]'); const p = d.querySelector('[data-testid=empno-conflict]'); return { open: d.open, visible: p.checkVisibility(), text: p.textContent }; })()");
      check('W3 FU-13 펼치면 예전 내용 그대로(V-1002 윤바다·윤바다라, 자동으로 합치지 않았다는 안내)', foldOpen.open && foldOpen.visible && foldOpen.text.includes('윤바다라') && foldOpen.text.includes('자동으로 합치지 않았으니'), JSON.stringify(foldOpen));
      await shot(s.cdp, `${browser.name}-w3-1-team-summary`);
      // FU-5 「인사이트 보기」 기본 탭 risk + 맨 위. 먼저 패널을 아래로 내려 둔다
      await evaluate(s.cdp, "document.getElementById('detail').parentElement.scrollTop = 600");
      await clickTestId(s.cdp, 'btn-insight-universe');
      await sleep(300);
      const top1 = await evaluate(s.cdp, "document.getElementById('detail').parentElement.scrollTop");
      check('W3 FU-5 「인사이트 보기」(개요) → 기본 탭이 「인수인계 위험」이고 패널이 맨 위부터 보임', (await activeTab()) === 'tab-risk' && top1 === 0 && !!(await box('risk-concentration')), JSON.stringify({ tab: await activeTab(), top1 }));
      // 탭 숫자와 요약 숫자가 같다
      const conc = await text(s.cdp, '[data-testid=risk-concentration-counts]');
      const tabSolo = num(/혼자 해 본 업무 (\d+)개/, conc);
      await clickTestId(s.cdp, 'tab-density');
      await sleep(200);
      const heads = await evaluate(s.cdp, "[...document.querySelectorAll('[data-testid=density-result] h3')].map((h) => h.textContent)");
      const tabGaps = num(/^공백 (\d+)건/, heads.find((h) => /^공백 /.test(h)) || '');
      const tabDense = num(/^밀집 (\d+)명/, heads.find((h) => /^밀집 /.test(h)) || '');
      check('W3 FU-10 위험 요약 숫자 = 인사이트 탭 숫자(혼자 해 본 업무·밀집·공백)', sumSolo === tabSolo && sumDense === tabDense && sumGaps === tabGaps && tabSolo > 0, JSON.stringify({ sumSolo, tabSolo, sumDense, tabDense, sumGaps, tabGaps }));
      // 「자세히」 → 인수인계 위험 탭
      await clickTestId(s.cdp, 'insight-close');
      await sleep(150);
      await evaluate(s.cdp, 'window.__wu.select(null)');
      await sleep(150);
      const hint = await text(s.cdp, '[data-testid=insight-hint]');
      check('W3 FU-5 개요의 인사이트 안내 글이 「인수인계 위험 탭부터 열림」으로 맞춰짐', hint.includes('인수인계 위험 탭부터 열림') && !hint.includes('반복 비효율 탭부터'), hint);
      await clickTestId(s.cdp, 'btn-team-risk-more');
      await sleep(300);
      check('W3 FU-10 「자세히」 → 인사이트 「인수인계 위험」 탭이 열림', (await activeTab()) === 'tab-risk' && !!(await box('risk-concentration-list')));
      // FU-12 사람 상세: 이 사람만 아는 일
      const owners = await evaluate(s.cdp, "(() => { const m = {}; for (const li of document.querySelectorAll('[data-testid=risk-concentration-list] li')) { const name = li.children[1].textContent.split('만 해 봤')[0]; m[name] = (m[name] || 0) + 1; } return m; })()");
      await clickTestId(s.cdp, 'insight-close');
      await sleep(150);
      const ownerName = Object.keys(owners)[0];
      const ownerGid = await evaluate(s.cdp, `(() => { const p = window.__wu.view.nodes.find((n) => n.core_type === 'person' && !n.hidden && n.label === ${JSON.stringify(ownerName)}); return p ? p.gid : null; })()`);
      await evaluate(s.cdp, `window.__wu.select(${JSON.stringify(ownerGid)})`);
      await sleep(200);
      const soloLine = await box('person-solo-works');
      const soloN = owners[ownerName];
      check('W3 FU-12 사람 상세에 「이 사람만 아는 일 n개: 「…」」(n = 인수인계 위험 탭 목록의 그 사람 수)', !!soloLine && soloLine.text.startsWith(`이 사람만 아는 일 ${soloN}개: 「`), JSON.stringify({ ownerName, soloN, soloLine }));
      const noneGid = await evaluate(s.cdp, `(() => { const names = ${JSON.stringify(Object.keys(owners))}; const p = window.__wu.view.nodes.find((n) => n.core_type === 'person' && !n.hidden && !names.includes(n.label)); return p ? p.gid : null; })()`);
      if (noneGid) {
        await evaluate(s.cdp, `window.__wu.select(${JSON.stringify(noneGid)})`);
        await sleep(200);
        check('W3 FU-12 혼자 아는 일이 없는 사람은 줄을 그리지 않음', !(await box('person-solo-works')));
      }
      // FU-6 노드 상세 「← 지도 전체 보기」
      const workGid = await evaluate(s.cdp, "window.__wu.view.nodes.find((n) => n.core_type === 'work' && !n.hidden).gid");
      await evaluate(s.cdp, `window.__wu.select(${JSON.stringify(workGid)})`);
      await sleep(200);
      const back = await evaluate(s.cdp, "(() => { const b = document.querySelector('[data-testid=detail-back-universe]'); if (!b) return null; const r = b.getBoundingClientRect(); return { first: document.getElementById('detail').firstElementChild.contains(b), w: r.width, text: b.textContent, draftUniverse: !!document.querySelector('[data-testid=btn-draft-universe]') }; })()");
      check('W3 FU-6 노드 상세 맨 위에 「← 지도 전체 보기」(크기 있음), 이 화면에는 지도 전체용 단추가 없음', !!back && back.first && back.w > 20 && back.text === '← 지도 전체 보기' && !back.draftUniverse, JSON.stringify(back));
      await clickTestId(s.cdp, 'detail-back-universe');
      await sleep(250);
      const afterBack = await evaluate(s.cdp, "({ sel: window.__wu.selected, draft: !!document.querySelector('[data-testid=btn-draft-universe]'), insight: !!document.querySelector('[data-testid=btn-insight-universe]'), summary: !!document.querySelector('[data-testid=team-risk-summary]') })");
      check('W3 FU-6 「← 지도 전체 보기」 → 선택이 풀리고 꼭지 상세(「인수인계 초안 만들기」「인사이트 보기」·위험 요약)로', afterBack.sel === null && afterBack.draft && afterBack.insight && afterBack.summary, JSON.stringify(afterBack));
    } else {
      check('W3 가상 운영부(U-D1) 열기', false, 'U-D1이 열리지 않음');
    }

    // ── 월말 정산(U-A1): 한 업무 지도 ──
    if (await gotoU('U-A1')) {
      await evaluate(s.cdp, 'window.__wu.select(null)');
      await sleep(200);
      check('W3 FU-10 업무 하나짜리 지도(월말 정산)의 개요에는 위험 요약이 없음', !(await box('team-risk-summary')));
      // 노드 「인사이트 보기」(더 보기 안)도 기본 탭 risk
      await evaluate(s.cdp, "window.__wu.select('U-A1/N-001')");
      await sleep(200);
      await clickTestId(s.cdp, 'btn-insight');
      await sleep(250);
      check('W3 FU-5 노드 상세의 「인사이트 보기」도 기본 탭이 「인수인계 위험」', (await activeTab()) === 'tab-risk');
      await clickTestId(s.cdp, 'insight-close');
      await sleep(150);
      // FU-15 이력의 속성 수정 글
      await evaluate(s.cdp, "window.__wu.select('U-A1/N-001')");
      await sleep(200);
      await evaluate(s.cdp, "(() => { const t = document.querySelector('[data-testid=history-toggle]'); if (t && !/최근 것만/.test(t.textContent)) t.click(); })()");
      await sleep(100);
      const hist = await text(s.cdp, '[data-testid=history]');
      check('W3 FU-15 이력의 「수정 — 속성」이 원문 JSON 없이 바뀐 값만(마감: 월 마감 후 5영업일 이내 → 월 마감 후 3영업일 이내)', hist.includes('수정 — 속성: 마감: 월 마감 후 5영업일 이내 → 월 마감 후 3영업일 이내') && !hist.includes('{'), hist.slice(-300));
      // FU-6 + 따라 하기: 노드를 기다리는 단계에서 「← 지도 전체 보기」를 눌러도 따라 하기 상태가 깨지지 않는다
      await openTourViaHelp(s.cdp);
      await sleep(300);
      await evaluate(s.cdp, "window.__wu.select('U-A1/N-001')");
      await sleep(300);
      const tiBefore = await evaluate(s.cdp, 'window.__wu.tour');
      await clickTestId(s.cdp, 'detail-back-universe');
      await sleep(300);
      const tiAfter = await evaluate(s.cdp, 'window.__wu.tour');
      check('W3 FU-6 따라 하기 중 「← 지도 전체 보기」: 선택만 풀리고 따라 하기 단계는 그대로(카드 유지)', tiBefore.mode === 'step' && tiAfter.mode === 'step' && tiAfter.scenario === 'handover' && tiAfter.index === tiBefore.index && (await evaluate(s.cdp, 'window.__wu.selected')) === null, JSON.stringify({ tiBefore, tiAfter }));
      await evaluate(s.cdp, "document.querySelector('[data-testid=tour-skip]').click()");
      await sleep(200);

      // FU-7 받는 쪽: wu:add-node 이벤트 → 「사람·업무·문서 추가」가 펼쳐지고 유형이 「사람」으로 골라짐 (저장하지 않음)
      await evaluate(s.cdp, 'window.__wu.select(null)');
      await sleep(150);
      await evaluate(s.cdp, "document.dispatchEvent(new CustomEvent('wu:add-node', { detail: { type: 'person' } }))");
      await sleep(200);
      const addEv = await evaluate(s.cdp, "({ open: document.querySelector('details.add').open, type: document.querySelector('#add-slot [data-testid=node-type]').value, focus: document.activeElement && document.activeElement.dataset.testid, emp: !document.querySelector('#add-slot [data-testid=node-empno]').closest('label').hidden })");
      check('W3 FU-7 wu:add-node {type:person} → 「사람·업무·문서 추가」가 열리고 유형 「사람」(사번 칸 보임), 이름 칸에 초점', addEv.open && addEv.type === 'person' && addEv.focus === 'node-label' && addEv.emp, JSON.stringify(addEv));
      await evaluate(s.cdp, "document.dispatchEvent(new CustomEvent('wu:add-node', { detail: { type: 'zzz' } }))");
      await sleep(100);
      check('W3 FU-7 모르는 유형이나 detail이 없는 요청은 무시(유형이 그대로)', (await evaluate(s.cdp, "document.querySelector('#add-slot [data-testid=node-type]').value")) === 'person');
      // 초안 창이 열린 채 사람을 추가: 초안 창이 유지되고 새 사람이 받는 사람 목록에 보인다. 끝에 바로 지워 되돌린다
      const nodesBefore = await evaluate(s.cdp, 'window.__wu.doc.nodes.length');
      const newPerson = '처음사용 시험 후임';
      await clickTestId(s.cdp, 'btn-draft-universe');
      await sleep(250);
      await evaluate(s.cdp, "document.dispatchEvent(new CustomEvent('wu:add-node', { detail: { type: 'person' } }))");
      await sleep(150);
      const addR = await submitAdd(s.cdp, 'person', newPerson);
      await sleep(250);
      const draftAfter = await evaluate(s.cdp, `(() => ({ draft: !!document.querySelector('[data-testid=draft-form]'), inTo: [...document.querySelectorAll('[data-testid=draft-to] option')].some((o) => o.textContent.includes(${JSON.stringify(newPerson)})), top: document.getElementById('detail').parentElement.scrollTop }))()`);
      check('W3 FU-7 초안 창에서 사람을 추가하면 초안 창이 그대로 열려 있고 새 사람이 받는 사람 목록에 있음', addR.code === 'OK' && draftAfter.draft && draftAfter.inTo && draftAfter.top === 0, JSON.stringify({ addR, draftAfter }));
      const newGid = await evaluate(s.cdp, `(() => { const p = window.__wu.view.nodes.find((n) => n.label === ${JSON.stringify(newPerson)}); return p ? p.gid : null; })()`);
      if (newGid) {
        await evaluate(s.cdp, `window.__wu.select(${JSON.stringify(newGid)})`);
        await sleep(200);
        await evaluate(s.cdp, "(document.querySelector('[data-testid=btn-delete]') || { click() {} }).click()");
        await sleep(300);
      }
      const nodesAfter = await evaluate(s.cdp, 'window.__wu.doc.nodes.length');
      check('W3 FU-7 시험으로 추가한 사람을 바로 지워 노드 수가 처음과 같음(데이터 되돌림)', nodesAfter === nodesBefore, `${nodesBefore} → ${nodesAfter}`);

      // FU-11 폴더 연결 탭 세 줄 / 업무 지도 묶기 안내 / FU-23 「지도 이름」
      await evaluate(s.cdp, 'window.__wu.select(null)');
      await evaluate(s.cdp, "document.getElementById('import-open').click()");
      await sleep(250);
      await evaluate(s.cdp, "(document.querySelector('[data-testid=import-tab-folder]') || { click() {} }).click()");
      await sleep(250);
      const howto = await evaluate(s.cdp, "(() => { const h = document.querySelector('[data-testid=folder-howto]'); if (!h) return { unsupported: !!document.querySelector('[data-testid=folder-unsupported]') }; return { items: [...h.children].map((li) => li.textContent), before: !!(h.compareDocumentPosition(document.querySelector('[data-testid=folder-intro]')) & Node.DOCUMENT_POSITION_FOLLOWING) }; })()");
      check('W3 FU-11 「폴더 연결」 탭 위에 세 줄(팀원 각자 / 팀장 / 원본은 각자 브라우저·폴더는 사본)', howto.unsupported === true || (howto.items && howto.items.length === 3 && howto.items[0].startsWith('팀원 각자') && howto.items[0].includes('공유 폴더') && howto.items[1].startsWith('팀장') && howto.items[1].includes('팀 지도로 묶기') && howto.items[2].includes('각자 브라우저') && howto.items[2].includes('사본') && howto.before), JSON.stringify(howto));
      await evaluate(s.cdp, "document.getElementById('import-dialog').close()");
      await sleep(100);
      await evaluate(s.cdp, "document.getElementById('group-open').click()");
      await sleep(200);
      const groupNote = await text(s.cdp, '[data-testid=group-note]');
      check('W3 FU-11 「업무 지도 묶기」 창 위에 안내(이미 이 브라우저에 있는 지도끼리, 동료 지도는 「폴더 연결」·「가져오기」로 먼저)', groupNote.includes('이미 이 브라우저에 있는 지도끼리 묶습니다') && groupNote.includes('「폴더 연결」이나 「가져오기」로 먼저 들여오세요'), groupNote);
      await evaluate(s.cdp, "document.getElementById('group-cancel').click()");
      await sleep(100);
      await evaluate(s.cdp, "document.getElementById('create-open').click()");
      await sleep(200);
      const nameLabel = await evaluate(s.cdp, "document.getElementById('create-name').parentElement.firstChild.textContent.trim()");
      check('W3 FU-23 새 업무 지도 창의 칸 제목이 「지도 이름」(첫 업무의 「업무 이름」과 구분, 칸 id 그대로)', nameLabel === '지도 이름' && (await evaluate(s.cdp, "document.getElementById('create-start-work').parentElement.firstChild.textContent.trim()")) === '업무 이름', nameLabel);
      await evaluate(s.cdp, "document.getElementById('create-cancel').click()");
      await sleep(100);
    } else {
      check('W3 월말 정산(U-A1) 열기', false, 'U-A1이 열리지 않음');
    }

    // ── 대형가맹점 A 카드승인 전문 송수신(U-K1): 권장 항목이 비어 있는 업무가 있는 지도 ──
    if (await gotoU('U-K1')) {
      // FU-16 권장 항목 이름을 누르면 그 속성 칸이 생기고 초점 (저장하지 않고 취소)
      const target = await evaluate(s.cdp, "(() => { for (const n of window.__wu.view.nodes) { if (n.core_type !== 'work' || n.hidden) continue; window.__wu.select(n.gid); const b = [...document.querySelectorAll('[data-testid=form-missing-item]')].find((x) => ['절차', '주기', '마감', '주의사항'].includes(x.dataset.field)); if (b) return { gid: n.gid, field: b.dataset.field, text: document.querySelector('[data-testid=form-missing]').textContent }; } return null; })()");
      check('W3 FU-16 표준 양식의 빈 항목 이름이 단추(글은 「표준 양식: 권장 항목 n개 비어 있음 — …」 그대로)', !!target && target.text.startsWith('표준 양식: 권장 항목') && target.text.includes('비어 있음 — '), JSON.stringify(target));
      if (target) {
        await evaluate(s.cdp, `window.__wu.select(${JSON.stringify(target.gid)})`);
        await sleep(150);
        await evaluate(s.cdp, `[...document.querySelectorAll('[data-testid=form-missing-item]')].find((x) => x.dataset.field === ${JSON.stringify(target.field)}).click()`);
        await sleep(250);
        const ed = await evaluate(s.cdp, "(() => { const a = document.activeElement; const row = a && a.closest ? a.closest('.attr-row') : null; return { form: !!document.querySelector('[data-testid=node-form-edit]'), onVal: !!a && a.classList.contains('attr-val'), key: row ? row.querySelector('.attr-key').value : null }; })()");
        check('W3 FU-16 항목 이름을 누르면 수정 화면이 열려 그 속성 칸(이름 채워짐)에 초점', ed.form && ed.onVal && ed.key === target.field, JSON.stringify({ target, ed }));
        await evaluate(s.cdp, "[...document.querySelectorAll('[data-testid=node-form-edit] button')].find((b) => b.textContent === '취소').click()");
        await sleep(150);
      }
      const descTarget = await evaluate(s.cdp, "(() => { for (const n of window.__wu.view.nodes) { if (n.core_type !== 'work' || n.hidden) continue; window.__wu.select(n.gid); const b = [...document.querySelectorAll('[data-testid=form-missing-item]')].find((x) => x.dataset.field === '설명'); if (b) return n.gid; } return null; })()");
      if (descTarget) {
        await evaluate(s.cdp, `window.__wu.select(${JSON.stringify(descTarget)})`);
        await sleep(150);
        await evaluate(s.cdp, "[...document.querySelectorAll('[data-testid=form-missing-item]')].find((x) => x.dataset.field === '설명').click()");
        await sleep(250);
        check('W3 FU-16 「설명」 항목을 누르면 설명 칸에 초점', (await evaluate(s.cdp, "document.activeElement && document.activeElement.dataset.testid")) === 'node-description');
        await evaluate(s.cdp, "[...document.querySelectorAll('[data-testid=node-form-edit] button')].find((b) => b.textContent === '취소').click()");
        await sleep(150);
      }

    } else {
      check('W3 대형가맹점 A 카드승인 전문 송수신(U-K1) 열기', false, 'U-K1이 열리지 않음');
    }
    // ── 처음 사용 W5(2026-10-24, 2회차 FU-29·30·31·32·35·36·37): 근거 칩 글 한 줄(인사이트), 사람 상세 「이 사람 일 인수인계 초안」, 준비도 접힘, 「지금 담당 없음」 표시,
    //    wu:add-node + label 바로 추가, 관계 고르기 칸 흐리게·오류 위치, 이력 분류 안내. 데이터는 저장하지 않는다(예외: 초안 창에서 사람을 추가해 보고 바로 「삭제」로 되돌림 — 노드 수가 같아야 통과) ──
    if (await gotoU('U-D1')) {
      // FU-31 준비도: 업무별 빠진 항목은 기본 접힘
      await evaluate(s.cdp, 'window.__wu.select(null)');
      await sleep(150);
      await clickTestId(s.cdp, 'btn-insight-universe');
      await sleep(250);
      await clickTestId(s.cdp, 'tab-risk');
      await sleep(250);
      const folds = await evaluate(s.cdp, "(() => { const fs = [...document.querySelectorAll('[data-testid=risk-readiness-fold]')]; return { n: fs.length, open: fs.filter((d) => d.open).length, hiddenInner: fs.every((d) => d.querySelector('ul').checkVisibility() === false), sumOk: fs.every((d) => /^「.+」 \\d\\/6 — 빠진 것 \\d+개/.test(d.querySelector('summary').textContent)), sumVisible: fs.every((d) => d.querySelector('summary').checkVisibility()) }; })()");
      check('W5 FU-31 인사이트 「인수인계 준비도」: 업무별 빠진 항목이 기본 접힘(요약만 보임, 「업무 n/6 — 빠진 것 k개」)', folds.n > 0 && folds.open === 0 && folds.hiddenInner && folds.sumOk && folds.sumVisible, JSON.stringify(folds));
      await evaluate(s.cdp, "document.querySelector('[data-testid=risk-readiness-fold] summary').click()");
      await sleep(150);
      const foldOpened = await evaluate(s.cdp, "(() => { const d = document.querySelector('[data-testid=risk-readiness-fold]'); return { open: d.open, visible: d.querySelector('ul').checkVisibility() }; })()");
      check('W5 FU-31 요약을 누르면 빠진 항목이 펼쳐져 보임', foldOpened.open && foldOpened.visible, JSON.stringify(foldOpened));
      await shot(s.cdp, `${browser.name}-w5-risk-fold`);
      // FU-32 지금 담당 없음 표시 (2025 행사 등)
      const noCur = await evaluate(s.cdp, "(() => { const lis = [...document.querySelectorAll('[data-testid=risk-concentration-list] li')]; const marked = lis.filter((li) => li.querySelector('[data-testid=risk-no-current]')); const ev = lis.find((li) => li.textContent.includes('2025 행사')); return { total: lis.length, marked: marked.length, event: ev ? (ev.querySelector('[data-testid=risk-no-current]') || { textContent: null }).textContent : 'none', sample: marked[0] ? marked[0].querySelector('[data-testid=risk-no-current]').textContent : null, vis: marked[0] ? marked[0].querySelector('[data-testid=risk-no-current]').checkVisibility() : null }; })()");
      check('W5 FU-32 「한 사람에게 몰린 지식」 목록의 「2025 행사」에 「지금 담당 없음 — 끝난 업무인지 확인」, 지금 담당이 있는 업무에는 없음', noCur.event === '지금 담당 없음 — 끝난 업무인지 확인' && noCur.marked >= 1 && noCur.marked < noCur.total && noCur.vis === true, JSON.stringify(noCur));
      // FU-29 인사이트 근거 칩: 누르면 근거 글 한 줄, 패널은 그대로
      const chipShown = await evaluate(s.cdp, "(() => { const b = document.querySelector('[data-testid=risk-concentration-list] button.evidence'); if (!b) return null; b.click(); const t = document.querySelector('[data-testid=risk-concentration-list] [data-testid=evidence-text]'); return { text: t ? t.textContent : '', pressed: b.getAttribute('aria-pressed'), insight: !!document.querySelector('[data-testid=risk-body]') }; })()");
      check('W5 FU-29 인사이트의 근거 칩을 누르면 그 아래에 근거 글 한 줄이 보이고 인사이트 화면은 그대로', !!chipShown && chipShown.text.length > 3 && chipShown.pressed === 'true' && chipShown.insight, JSON.stringify(chipShown));
      await clickTestId(s.cdp, 'insight-close');
      await sleep(150);

      // FU-36 wu:add-node + label: 사람·업무·문서 추가 창을 열지 않고 사람을 바로 만들고 초안 창이 유지된다. 끝에 「삭제」로 되돌림
      const nBefore = await evaluate(s.cdp, 'window.__wu.doc.nodes.length');
      const w5Person = '처음사용W5 시험 후임';
      await evaluate(s.cdp, 'window.__wu.select(null)');
      await sleep(150);
      await clickTestId(s.cdp, 'btn-draft-universe');
      await sleep(250);
      const picked = await evaluate(s.cdp, "(() => { const f = document.querySelector('[data-testid=draft-from]'); const o = [...f.options].find((x) => x.value); f.value = o.value; f.dispatchEvent(new Event('change')); return { target: document.querySelector('[data-testid=draft-target]').value, from: f.value }; })()");
      await evaluate(s.cdp, `document.dispatchEvent(new CustomEvent('wu:add-node', { detail: { type: 'person', label: ${JSON.stringify(w5Person)}, attrs: { 연락처: '내선 0000' } } }))`);
      await sleep(300);
      const direct = await evaluate(s.cdp, `(() => ({ nodes: window.__wu.doc.nodes.length, draft: !!document.querySelector('[data-testid=draft-form]'), inTo: [...document.querySelectorAll('[data-testid=draft-to] option')].some((o) => o.textContent.includes(${JSON.stringify(w5Person)})), addOpen: document.querySelector('details.add').open, target: (document.querySelector('[data-testid=draft-target]') || {}).value, from: (document.querySelector('[data-testid=draft-from]') || {}).value }))()`);
      check('W5 FU-36 wu:add-node {label}: 사람·업무·문서 추가 창은 안 열리고 노드 +1, 초안 창 유지·받는 사람 목록에 그 이름, 고른 대상·보내는 사람 유지', direct.nodes === nBefore + 1 && direct.draft && direct.inTo && direct.addOpen === false && direct.target === picked.target && direct.from === picked.from, JSON.stringify({ nBefore, picked, direct }));
      const newNode = await evaluate(s.cdp, `(() => { const p = window.__wu.view.nodes.find((n) => n.label === ${JSON.stringify(w5Person)}); return p ? { gid: p.gid, links: window.__wu.view.edges.filter((e) => !e.hidden && (e.source === p.gid || e.target === p.gid)).length } : null; })()`);
      check('W5 FU-36 새 사람은 연결 없이 만들어짐', !!newNode && newNode.links === 0, JSON.stringify(newNode));
      // 오류: 이름이 공백뿐이면 → 초안 창의 메시지 자리에 오류 문구, 노드 수는 그대로
      await evaluate(s.cdp, `document.dispatchEvent(new CustomEvent('wu:add-node', { detail: { type: 'person', label: '   ' } }))`);
      await sleep(250);
      const dup = await evaluate(s.cdp, "(() => { const m = document.querySelector('[data-testid=draft-message]'); return { nodes: window.__wu.doc.nodes.length, error: !!m && m.classList.contains('error'), text: m ? m.textContent : '', alert: false }; })()");
      check('W5 FU-36 이름이 공백뿐이면 초안 창의 메시지 자리에 오류 문구, 노드 수 그대로', dup.nodes === nBefore + 1 && dup.error && dup.text.length > 3, JSON.stringify(dup));
      if (newNode) {
        await evaluate(s.cdp, `window.__wu.select(${JSON.stringify(newNode.gid)})`);
        await sleep(200);
        // FU-30 사람 상세: 「이 사람 일 인수인계 초안」 (이 새 사람으로 시험 — 보내는 사람이 그 사람이어야 함)
        const pbtn = await evaluate(s.cdp, "(() => { const b = document.querySelector('[data-testid=btn-person-draft]'); return b ? { text: b.textContent, visible: b.checkVisibility() } : null; })()");
        check('W5 FU-30 사람 상세에 「이 사람 일 인수인계 초안」 단추', !!pbtn && pbtn.text === '이 사람 일 인수인계 초안' && pbtn.visible, JSON.stringify(pbtn));
        await clickTestId(s.cdp, 'btn-person-draft');
        await sleep(250);
        const pd = await evaluate(s.cdp, `(() => { const t = document.querySelector('[data-testid=draft-target]'); const f = document.querySelector('[data-testid=draft-from]'); const to = document.querySelector('[data-testid=draft-to]'); const root = window.__wu.view.nodes.find((n) => n.core_type === 'root'); return t ? { targetText: t.selectedOptions[0] ? t.selectedOptions[0].textContent : '', rootLabel: root ? root.label : null, fromText: f.selectedOptions[0] ? f.selectedOptions[0].textContent : '', to: to.value } : null; })()`);
        check('W5 FU-30 단추를 누르면 초안 창이 대상 = 이 지도 전체(꼭지), 보내는 사람 = 그 사람으로 미리 골라져 열림(받는 사람은 비어 있음)', !!pd && pd.targetText.includes(pd.rootLabel) && pd.fromText.includes(w5Person) && pd.to === '', JSON.stringify(pd));
        await shot(s.cdp, `${browser.name}-w5-person-draft`);
        await evaluate(s.cdp, `window.__wu.select(${JSON.stringify(newNode.gid)})`);
        await sleep(200);
        await evaluate(s.cdp, "(document.querySelector('[data-testid=btn-delete]') || { click() {} }).click()");
        await sleep(300);
      }
      const nAfter = await evaluate(s.cdp, 'window.__wu.doc.nodes.length');
      check('W5 FU-36 시험으로 추가한 사람을 바로 지워 노드 수가 처음과 같음(데이터 되돌림)', nAfter === nBefore, `${nBefore} → ${nAfter}`);
    } else {
      check('W5 가상 운영부(U-D1) 열기', false, 'U-D1이 열리지 않음');
    }

    if (await gotoU('U-A1')) {
      // FU-35 연결 추가: 상대를 고르면 그 조합에 못 쓰는 관계가 흐려짐(disabled + 보기 글). 상대 고르기 전에는 전부 켜짐
      await evaluate(s.cdp, "window.__wu.select('U-A1/N-002')");
      await sleep(200);
      await clickTestId(s.cdp, 'btn-edge');
      await sleep(200);
      const before = await evaluate(s.cdp, "[...document.querySelector('[data-testid=edge-type]').options].filter((o) => o.disabled).length");
      const personOpt = await evaluate(s.cdp, "(() => { const o = [...document.querySelector('[data-testid=edge-other]').options].find((x) => x.textContent.includes('(사람)')); return o ? o.value : null; })()");
      await evaluate(s.cdp, `(() => { const o = document.querySelector('[data-testid=edge-other]'); o.value = ${JSON.stringify(personOpt)}; o.dispatchEvent(new Event('change')); })()`);
      await sleep(150);
      const rel = await evaluate(s.cdp, "(() => Object.fromEntries([...document.querySelector('[data-testid=edge-type]').options].map((o) => [o.value, { disabled: o.disabled, text: o.textContent, group: o.parentElement.tagName === 'OPTGROUP' ? o.parentElement.label : '' }])))()");
      check('W5 FU-35 연결 추가: 상대를 고르기 전에는 관계가 전부 켜져 있음', before === 0, String(before));
      check('W5 FU-35 연결 추가: 업무↔사람을 고르면 「수행」은 켜짐, 「관련」은 disabled이고 「이 조합에는 못 씀」 묶음 안(CR-18-4로 보기 글 꼬리표 대신 묶음)', !!personOpt && rel.performs && rel.performs.disabled === false && rel.performs.text === '수행' && rel.relates_to.disabled === true && rel.relates_to.text === '관련' && rel.relates_to.group === '이 조합에는 못 씀' && rel.performs.group === '', JSON.stringify(rel));
      // FU-35 오류 위치: 쓸 수 없는 방향(업무 → 사람의 「수행」)으로 실제로 저장해 보면 E-PAIR가 「연결」 단추 바로 위에, 화면 안에 보임.
      // 처음 사용 5회차(FU5-9)로 바뀜: 예전에는 못 쓰는 「관련」을 골라 오류를 만들었지만, 못 쓰는 보기는 이제 고를 수 없다. 관계는 쓸 수 있고 방향만 틀린 경우는 여전히 저장 때 E-PAIR다
      await evaluate(s.cdp, "(() => { const t = document.querySelector('[data-testid=edge-type]'); t.value = 'performs'; t.dispatchEvent(new Event('change')); const d = document.querySelector('[data-testid=edge-direction]'); d.value = 'out'; d.dispatchEvent(new Event('change')); document.querySelector('[data-testid=edge-form] button[type=submit]').click(); })()");
      await sleep(250);
      const errPos = await evaluate(s.cdp, "(() => { const f = document.querySelector('[data-testid=edge-form]'); const m = f.querySelector('[data-testid=form-message]'); const btn = f.querySelector('button[type=submit]'); const r = m.getBoundingClientRect(); const br = btn.getBoundingClientRect(); return { code: m.dataset.code, text: m.textContent, above: r.bottom <= br.top + 1, inView: r.top >= 0 && r.bottom <= window.innerHeight }; })()");
      check('W5 FU-35 연결 추가 실패(E-PAIR, 방향이 틀린 「수행」): 오류가 「연결」 단추 바로 위에 있고 화면 안에 보임', errPos.code === 'E-PAIR' && errPos.text.includes('사람 → 업무') && errPos.above && errPos.inView, JSON.stringify(errPos));
      await evaluate(s.cdp, "[...document.querySelectorAll('[data-testid=edge-form] button')].find((b) => b.textContent === '취소').click()");
      await sleep(150);
      // FU-37 이력 추가: 분류 안내 한 줄
      await clickTestId(s.cdp, 'btn-event');
      await sleep(200);
      const hint = await evaluate(s.cdp, "(() => { const h = document.querySelector('[data-testid=category-hint]'); const c = document.querySelector('[data-testid=event-category]'); return h ? { text: h.textContent, options: [...c.options].map((o) => o.textContent), visible: h.checkVisibility() } : null; })()");
      check('W5 FU-37 이력 추가의 분류 아래에 초안 칸 안내(이슈 → 「최근 이슈」, 진행 중 → 「진행 중인 일」, 주의사항 → 「주의사항·노하우」), 분류 보기 이름과 같음',
        !!hint && hint.visible && hint.text === '분류에 따라 인수인계 초안의 칸이 정해집니다: 이슈 → 「최근 이슈」, 진행 중 → 「진행 중인 일」, 주의사항 → 「주의사항·노하우」' && ['이슈', '진행 중', '주의사항'].every((x) => hint.options.includes(x)), JSON.stringify(hint));
      await evaluate(s.cdp, "[...document.querySelectorAll('[data-testid=event-form] button')].find((b) => b.textContent === '취소').click()");
      await sleep(150);
      // FU-35 사람·업무·문서 추가: 새 노드 유형과 함께 이을 노드로 못 쓰는 관계가 흐려지고, 실패 오류가 「추가」 단추 바로 위
      await evaluate(s.cdp, "window.__wu.select(null)");
      await sleep(150);
      const nBefore2 = await evaluate(s.cdp, 'window.__wu.doc.nodes.length');
      await evaluate(s.cdp, "document.querySelector('details.add').open = true");
      const addRel = await evaluate(s.cdp, "(() => { const slot = document.getElementById('add-slot'); const t = slot.querySelector('[data-testid=node-type]'); t.value = 'person'; t.dispatchEvent(new Event('change')); const o = slot.querySelector('[data-testid=node-link-other]'); const w = [...o.options].find((x) => x.textContent.includes('(업무)')); o.value = w.value; o.dispatchEvent(new Event('change')); const r = slot.querySelector('[data-testid=node-link-type]'); return Object.fromEntries([...r.options].map((x) => [x.value, { disabled: x.disabled, text: x.textContent, group: x.parentElement.tagName === 'OPTGROUP' ? x.parentElement.label : '' }])); })()");
      check('W5 FU-35 사람·업무·문서 추가: 사람 + 업무를 고르면 「관련」은 disabled이고 「이 조합에는 못 씀」 묶음 안, 추천된 「수행」은 켜짐(CR-18-4)', addRel.relates_to.disabled === true && addRel.relates_to.text === '관련' && addRel.relates_to.group === '이 조합에는 못 씀' && addRel.performs.disabled === false, JSON.stringify(addRel));
      await evaluate(s.cdp, "(() => { const slot = document.getElementById('add-slot'); slot.querySelector('[data-testid=node-label]').value = 'W5 시험'; const r = slot.querySelector('[data-testid=node-link-type]'); r.value = 'performs'; r.dispatchEvent(new Event('change')); const d = slot.querySelector('[data-testid=node-link-direction]'); d.value = 'in'; d.dispatchEvent(new Event('change')); slot.querySelector('button[type=submit]').click(); })()");
      await sleep(250);
      const addErr = await evaluate(s.cdp, "(() => { const slot = document.getElementById('add-slot'); const m = slot.querySelector('[data-testid=form-message]'); const btn = slot.querySelector('button[type=submit]'); const r = m.getBoundingClientRect(); const br = btn.getBoundingClientRect(); return { code: m.dataset.code, above: r.bottom <= br.top + 1, inView: r.top >= 0 && r.bottom <= window.innerHeight, nodes: window.__wu.doc.nodes.length }; })()");
      check('W5 FU-35 사람·업무·문서 추가 실패(E-PAIR, 방향이 틀린 「수행」): 오류가 「추가」 단추 바로 위에 있고 화면 안에 보이며 아무것도 저장되지 않음', addErr.code === 'E-PAIR' && addErr.above && addErr.inView && addErr.nodes === nBefore2, JSON.stringify(addErr));
      await shot(s.cdp, `${browser.name}-w5-add-error`);
      // ── 처음 사용 W-B(CR-18-4): 관계 고르기 — 쓸 수 있는 관계가 위, 못 쓰는 관계는 아래 묶음, 하나뿐이면 자동 선택 + 한 줄 ──
      const wbOpts = (testid) => evaluate(s.cdp, `(() => { const r = document.querySelector('[data-testid=${testid}]'); return { value: r.value, top: [...r.children].filter((c) => c.tagName === 'OPTION').map((o) => o.value), group: (r.querySelector('optgroup') || { label: '' }).label, grouped: [...r.querySelectorAll('optgroup option')].map((o) => o.value + (o.disabled ? ':d' : '')), lastIsGroup: r.lastElementChild.tagName === 'OPTGROUP' }; })()`);
      // 사람·업무·문서 추가: 조직 + 업무 → 「참조」 하나
      await evaluate(s.cdp, "(() => { const slot = document.getElementById('add-slot'); const t = slot.querySelector('[data-testid=node-type]'); t.value = 'org'; t.dispatchEvent(new Event('change')); const o = slot.querySelector('[data-testid=node-link-other]'); const w = [...o.options].find((x) => x.textContent.includes('(업무)')); o.value = w.value; o.dispatchEvent(new Event('change')); })()");
      await sleep(150);
      const wbAddOrg = await wbOpts('node-link-type');
      const wbAddNote = await evaluate(s.cdp, "(() => { const n = document.querySelector('[data-testid=node-link-only]'); return { text: n.textContent, visible: n.checkVisibility() }; })()");
      check('처음 사용 W-B(CR-18-4) 사람·업무·문서 추가: 조직 + 업무를 고르면 관계가 「참조」로 자동 선택, 쓸 수 있는 것은 그 하나뿐(목록 맨 위), 나머지는 아래 「이 조합에는 못 씀」 묶음(disabled), 칸 옆에 「(이 조합은 「참조」만 됩니다)」', wbAddOrg.value === 'references' && JSON.stringify(wbAddOrg.top) === '["references"]' && wbAddOrg.group === '이 조합에는 못 씀' && wbAddOrg.lastIsGroup && wbAddOrg.grouped.length === 6 && wbAddOrg.grouped.every((x) => x.endsWith(':d')) && wbAddNote.visible && wbAddNote.text === '(이 조합은 「참조」만 됩니다)', JSON.stringify([wbAddOrg, wbAddNote]));
      await shot(s.cdp, `${browser.name}-wb-relation-auto`);
      // 사람 + 업무: 「수행」·「참조」가 위, 「관련」 등은 아래, 안내 없음
      await evaluate(s.cdp, "(() => { const slot = document.getElementById('add-slot'); const t = slot.querySelector('[data-testid=node-type]'); t.value = 'person'; t.dispatchEvent(new Event('change')); })()");
      await sleep(150);
      const wbAddPerson = await wbOpts('node-link-type');
      const wbAddPersonNote = await evaluate(s.cdp, "document.querySelector('[data-testid=node-link-only]').hidden");
      check('처음 사용 W-B(CR-18-4) 사람·업무·문서 추가: 사람 + 업무면 「수행」·「참조」가 위, 「관련」은 아래 묶음(disabled), 「수행」이 선택돼 있고 한 줄 안내는 숨김', wbAddPerson.value === 'performs' && JSON.stringify(wbAddPerson.top) === '["performs","references"]' && wbAddPerson.group === '이 조합에는 못 씀' && wbAddPerson.grouped.includes('relates_to:d') && wbAddPerson.lastIsGroup && wbAddPersonNote === true, JSON.stringify([wbAddPerson, wbAddPersonNote]));
      // 연결 추가: 사용자가 먼저 고른 「참조」는 같은 쓸 수 있는 값이면 상대를 고른 뒤에도 그대로
      await evaluate(s.cdp, "document.querySelector('details.add').open = false; window.__wu.select('U-A1/N-012')");
      await sleep(200);
      await clickTestId(s.cdp, 'btn-edge');
      await sleep(200);
      await evaluate(s.cdp, "(() => { const r = document.querySelector('[data-testid=edge-type]'); r.value = 'references'; r.dispatchEvent(new Event('change')); const o = document.querySelector('[data-testid=edge-other]'); const w = [...o.options].find((x) => x.textContent.includes('(업무)')); o.value = w.value; o.dispatchEvent(new Event('change')); })()");
      await sleep(150);
      const wbEdgeKeep = await wbOpts('edge-type');
      check('처음 사용 W-B(CR-18-4) 연결 추가: 사람 → 업무에서 먼저 고른 「참조」가 상대를 고른 뒤에도 그대로, 목록은 「수행」·「참조」 위 + 못 쓰는 묶음 아래', wbEdgeKeep.value === 'references' && JSON.stringify(wbEdgeKeep.top) === '["performs","references"]' && wbEdgeKeep.lastIsGroup, JSON.stringify(wbEdgeKeep));
      // 사람 → 사람은 「참조」뿐 → 자동 + 안내 한 줄
      await evaluate(s.cdp, "(() => { const r = document.querySelector('[data-testid=edge-type]'); r.value = 'relates_to'; r.dispatchEvent(new Event('change')); const o = document.querySelector('[data-testid=edge-other]'); const w = [...o.options].find((x) => x.textContent.includes('(사람)')); o.value = w.value; o.dispatchEvent(new Event('change')); })()");
      await sleep(150);
      const wbEdgePp = await wbOpts('edge-type');
      const wbEdgeNote = await evaluate(s.cdp, "(() => { const n = document.querySelector('[data-testid=edge-only]'); return { text: n.textContent, visible: n.checkVisibility() }; })()");
      check('처음 사용 W-B(CR-18-4) 연결 추가: 사람 → 사람은 「참조」 하나뿐이라 자동 선택(「관련」을 넣어도 업무 상대에서는 못 쓰는 보기라 FU5-9로 고를 수 없고 「참조」 그대로), 칸 옆 「(이 조합은 「참조」만 됩니다)」', wbEdgePp.value === 'references' && JSON.stringify(wbEdgePp.top) === '["references"]' && wbEdgeNote.visible && wbEdgeNote.text === '(이 조합은 「참조」만 됩니다)', JSON.stringify([wbEdgePp, wbEdgeNote]));
      await shot(s.cdp, `${browser.name}-wb-edge-only`);
      await evaluate(s.cdp, "[...document.querySelectorAll('[data-testid=edge-form] button')].find((b) => b.textContent === '취소').click()");
      await sleep(150);
    } else {
      check('W5 월말 정산(U-A1) 열기', false, 'U-A1이 열리지 않음');
    }

    // ── 처음 사용 W7(2026-10-24, 3회차): wu:open-insight·wu:overview 처리, 초안을 만든 뒤 노드를 더해도 고른 대상·보내는·받는 사람 유지(+ draft-rerun-note가 있으면 보임),
    //    권장 항목 「담당」 → 이름 넣기 → 사람 + 수행 연결, 이름 수정 뒤 「함께 이을 노드」 목록의 새 이름, 새 지도 창 작성 주체 안내·오류 문구, 팀 지도 범례·통합 확인 문구.
    //    데이터를 바꾸므로 시작 때 저장소를 찍어 두었다가 끝에서 되돌린다 ──
    {
      const w7Snap = await evaluate(s.cdp, 'JSON.stringify(Object.entries(localStorage))');
      const w7Restore = async () => {
        await evaluate(s.cdp, `(() => { const snap = JSON.parse(${JSON.stringify(w7Snap)}); localStorage.clear(); for (const [k, v] of snap) localStorage.setItem(k, v); location.hash = 'U-A1'; location.reload(); })()`).catch(() => {});
        await sleep(500);
        await waitFor(s.cdp, "window.__wu && window.__wu.doc && window.__wu.doc.universe.id === 'U-A1'", 8000);
      };
      const addViaForm = (type, label) => evaluate(s.cdp, `(() => { const slot = document.getElementById('add-slot'); const t = slot.querySelector('[data-testid=node-type]'); t.value = ${JSON.stringify(type)}; t.dispatchEvent(new Event('change')); slot.querySelector('[data-testid=node-label]').value = ${JSON.stringify(label)}; slot.querySelector('button[type=submit]').click(); })()`);

      // ── 가상 운영부(U-D1): 범례·통합 확인 문구, 이벤트, 초안 선택 유지 ──
      if (await gotoU('U-D1')) {
        await evaluate(s.cdp, 'window.__wu.select(null)');
        await sleep(200);
        const legend = await text(s.cdp, '#legend');
        check('W7 팀 지도 범례: 「◎ 숫자 = 접힌 팀(두 번 누르면 펼침) · 점선 = 팀 사이 요약 연결」(예전 「이중 테두리 + 숫자…더블클릭」 글 없음)', legend.includes('숫자 = 접힌 팀(두 번 누르면 펼침) · 점선 = 팀 사이 요약 연결') && !legend.includes('◎ ◎') && !legend.includes('이중 테두리 + 숫자') && !legend.includes('더블클릭'), legend);
        const mh = await text(s.cdp, '[data-testid=merge-hint]');
        check('W7 통합 확인 줄: 「같은 사람·업무인지 확인할 것 n건」', /같은 사람·업무인지 확인할 것 \d+건/.test(mh), mh);

        // wu:open-insight: 지도 전체 대상, 종류 없으면 인수인계 위험 탭 / 종류가 있으면 그 탭
        await evaluate(s.cdp, "document.dispatchEvent(new CustomEvent('wu:open-insight', { detail: { kind: 'density' } }))");
        await sleep(250);
        const insDensity = await evaluate(s.cdp, "({ open: !!document.querySelector('[data-testid=insight-close]'), tab: (document.querySelector('.insight .tab.active') || { dataset: {} }).dataset.testid || '', selected: window.__wu.selected })");
        check('W7 wu:open-insight {kind:density} → 인사이트가 밀집·공백 탭으로 열림(지도 전체 대상)', insDensity.open && insDensity.tab === 'tab-density' && insDensity.selected === null, JSON.stringify(insDensity));
        await clickTestId(s.cdp, 'insight-close');
        await sleep(150);
        await evaluate(s.cdp, "document.dispatchEvent(new CustomEvent('wu:open-insight'))");
        await sleep(250);
        check('W7 wu:open-insight (종류 없음) → 인수인계 위험 탭', (await evaluate(s.cdp, "(document.querySelector('.insight .tab.active') || { dataset: {} }).dataset.testid || ''")) === 'tab-risk');
        await clickTestId(s.cdp, 'insight-close');
        await sleep(150);

        // wu:overview: 노드를 고른 상태에서 보내면 선택이 풀리고 지도 전체 화면(「인수인계 초안 만들기」)이 보임
        const someNode = await evaluate(s.cdp, "(window.__wu.view.nodes.find((n) => n.core_type === 'work' && !n.hidden) || {}).gid || null");
        await evaluate(s.cdp, `window.__wu.select(${JSON.stringify(someNode)})`);
        await sleep(200);
        await evaluate(s.cdp, "document.dispatchEvent(new CustomEvent('wu:overview'))");
        await sleep(200);
        const ov = await evaluate(s.cdp, "({ selected: window.__wu.selected, draftBtn: !!document.querySelector('[data-testid=btn-draft-universe]'), back: !!document.querySelector('[data-testid=detail-back-universe]') })");
        check('W7 wu:overview → 노드 선택이 풀리고 지도 전체 화면(「인수인계 초안 만들기」)으로, 「← 지도 전체 보기」는 없음', !!someNode && ov.selected === null && ov.draftBtn && !ov.back, JSON.stringify(ov));
        // 초안 창이 열려 있어도 같은 동작(초안 창이 닫히고 지도 전체)
        await clickTestId(s.cdp, 'btn-draft-universe');
        await sleep(250);
        await evaluate(s.cdp, "document.dispatchEvent(new CustomEvent('wu:overview'))");
        await sleep(200);
        check('W7 초안 창에서 wu:overview → 초안 창이 닫히고 지도 전체 화면', await evaluate(s.cdp, "!document.querySelector('[data-testid=draft-form]') && !!document.querySelector('[data-testid=btn-draft-universe]')"));

        // 초안을 한 번 만든 뒤 노드 추가 → 다시 그려져도 대상·보내는·받는 사람 유지
        await clickTestId(s.cdp, 'btn-draft-universe');
        await sleep(250);
        const w7Pick = await evaluate(s.cdp, "(() => { const f = document.querySelector('[data-testid=draft-from]'); const t = document.querySelector('[data-testid=draft-to]'); const opts = (sel) => [...sel.options].filter((o) => o.value); const a = opts(f)[0]; const b = opts(t).find((o) => o.value !== a.value); f.value = a.value; f.dispatchEvent(new Event('change')); t.value = b.value; t.dispatchEvent(new Event('change')); return { target: document.querySelector('[data-testid=draft-target]').value, from: f.value, to: t.value, fromText: a.textContent, toText: b.textContent }; })()");
        await evaluate(s.cdp, "document.querySelector('[data-testid=draft-form] button[type=submit]').click()");
        await sleep(600);
        const made = await evaluate(s.cdp, "({ result: document.querySelector('[data-testid=draft-result]').children.length > 0 })");
        const nW7 = await evaluate(s.cdp, 'window.__wu.doc.nodes.length');
        await addViaForm('person', 'W7 시험 사람');
        await sleep(700);
        const kept = await evaluate(s.cdp, "(() => { const g = (id) => document.querySelector('[data-testid=' + id + ']'); const note = g('draft-rerun-note'); const to = g('draft-to'); return { nodes: window.__wu.doc.nodes.length, form: !!g('draft-form'), target: g('draft-target') && g('draft-target').value, from: g('draft-from') && g('draft-from').value, to: to && to.value, inTo: !!to && [...to.options].some((o) => o.textContent.includes('W7 시험 사람')), note: note ? { hidden: note.hidden, text: note.textContent } : null, resultFilled: !!g('draft-result') && g('draft-result').children.length > 0 }; })()");
        check('W7 초안을 만든 뒤 노드 추가 → 초안 창 유지, 고른 대상·보내는·받는 사람이 그대로, 새 이름이 받는 사람 목록에 있음',
          made.result && kept.nodes === nW7 + 1 && kept.form && kept.target === w7Pick.target && kept.from === w7Pick.from && kept.to === w7Pick.to && kept.inTo, JSON.stringify({ w7Pick, made, kept }));
        check('W7 (W6 연동) draft-rerun-note가 있으면 보이고 초안이 다시 만들어져 있음 — 없으면 건너뜀(선택 유지만 확인)', kept.note === null || (kept.note.hidden === false && kept.resultFilled), JSON.stringify(kept.note));
        await shot(s.cdp, `${browser.name}-w7-draft-rerun`);
      } else {
        check('W7 가상 운영부(U-D1) 열기', false, 'U-D1이 열리지 않음');
      }

      // ── 월말 정산(U-A1): 「담당」 단추, 이름 수정 뒤 목록 ──
      if (await gotoU('U-A1')) {
        await evaluate(s.cdp, 'window.__wu.select(null)');
        await sleep(200);
        // 새 업무(담당 없음)를 만들면 권장 항목에 「담당」이 있다
        await addViaForm('work', 'W7 시험 업무');
        await sleep(400);
        const w7Work = await evaluate(s.cdp, 'window.__wu.selected');
        const missing0 = await evaluate(s.cdp, "(() => { const b = [...document.querySelectorAll('[data-testid=form-missing-item]')].find((x) => x.dataset.field === '담당'); const box = document.querySelector('[data-testid=form-assign]'); return b ? { title: b.title, box: !!box, boxVisible: !!box && box.checkVisibility() } : null; })()");
        check('W7 새 업무의 권장 항목에 「담당」 단추가 있고, 이름 넣는 칸은 처음엔 숨김', !!missing0 && missing0.box && !missing0.boxVisible, JSON.stringify(missing0));
        await evaluate(s.cdp, "[...document.querySelectorAll('[data-testid=form-missing-item]')].find((x) => x.dataset.field === '담당').click()");
        await sleep(200);
        const opened = await evaluate(s.cdp, "(() => { const n = document.querySelector('[data-testid=form-assign-name]'); const r = n.getBoundingClientRect(); return { visible: n.checkVisibility() && r.width > 0, focus: document.activeElement === n, add: !!document.querySelector('[data-testid=form-assign-add]'), editForm: !!document.querySelector('[data-testid=edge-form]') || !!document.querySelector('[data-testid=node-form-edit]') }; })()");
        check('W7 「담당」을 누르면 이 업무 상세 안에 「담당자 이름 [ ] 넣기」 칸이 열리고 이름 칸에 초점(연결 추가 화면은 안 열림)', opened.visible && opened.focus && opened.add && !opened.editForm, JSON.stringify(opened));
        await shot(s.cdp, `${browser.name}-w7-assign-box`);
        // 오류: 이름이 비면 안내, 아무것도 만들지 않음
        const nA = await evaluate(s.cdp, 'window.__wu.doc.nodes.length');
        const eA = await evaluate(s.cdp, 'window.__wu.doc.edges.length');
        await clickTestId(s.cdp, 'form-assign-add');
        await sleep(150);
        const emptyErr = await evaluate(s.cdp, "({ text: (document.querySelector('[data-testid=form-assign-msg]') || {}).textContent || '', nodes: window.__wu.doc.nodes.length, edges: window.__wu.doc.edges.length })");
        check('W7 「담당」 칸: 이름이 비면 안내 문구만 나오고 노드·연결은 그대로', emptyErr.text.includes('담당자 이름') && emptyErr.nodes === nA && emptyErr.edges === eA, JSON.stringify(emptyErr));
        // 정상: 새 이름 → 새 사람 + 수행 연결(시작일 오늘)
        const w7Person = 'W7 시험 담당';
        await evaluate(s.cdp, `(() => { const n = document.querySelector('[data-testid=form-assign-name]'); n.value = ${JSON.stringify(w7Person)}; document.querySelector('[data-testid=form-assign-add]').click(); })()`);
        await sleep(400);
        const assigned = await evaluate(s.cdp, `(() => { const d = window.__wu.doc; const p = d.nodes.find((n) => n.label === ${JSON.stringify(w7Person)}); const wid = ${JSON.stringify(w7Work)}.split('/')[1]; const e = p ? d.edges.find((x) => x.core_type === 'performs' && x.source === p.id && x.target === wid && !x.hidden) : null; const t = new Date(); const today = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0'); return { person: !!p, type: p && p.core_type, nodes: d.nodes.length, edge: !!e, start: e && e.period && e.period.start, today, event: d.events.some((ev) => ev.type === 'assign_start' && ev.payload && ev.payload.work_id === wid), done: !!document.querySelector('[data-testid=assign-done]'), stillMissing: [...document.querySelectorAll('[data-testid=form-missing-item]')].some((x) => x.dataset.field === '담당'), selected: window.__wu.selected }; })()`);
        check('W7 「담당」 칸에 새 이름을 넣으면 새 사람이 만들어지고 이 업무에 「수행」 연결(시작일 오늘, 담당 시작 이력), 안내가 보이고 권장 항목에서 「담당」이 빠짐',
          assigned.person && assigned.type === 'person' && assigned.nodes === nA + 1 && assigned.edge && assigned.start === assigned.today && assigned.event && assigned.done && !assigned.stillMissing && assigned.selected === w7Work, JSON.stringify(assigned));
        // 같은 이름의 사람이 이미 있으면 새로 만들지 않고 그 사람을 잇는다(다른 새 업무로)
        await evaluate(s.cdp, 'window.__wu.select(null)');
        await sleep(150);
        await addViaForm('work', 'W7 시험 업무 둘');
        await sleep(400);
        const nB = await evaluate(s.cdp, 'window.__wu.doc.nodes.length');
        await evaluate(s.cdp, "[...document.querySelectorAll('[data-testid=form-missing-item]')].find((x) => x.dataset.field === '담당').click()");
        await sleep(150);
        await evaluate(s.cdp, `(() => { document.querySelector('[data-testid=form-assign-name]').value = ${JSON.stringify(w7Person)}; document.querySelector('[data-testid=form-assign-add]').click(); })()`);
        await sleep(400);
        const reuse = await evaluate(s.cdp, `(() => ({ nodes: window.__wu.doc.nodes.length, same: window.__wu.doc.nodes.filter((n) => n.label === ${JSON.stringify(w7Person)}).length, links: window.__wu.doc.edges.filter((e) => e.core_type === 'performs' && !e.hidden && window.__wu.doc.nodes.find((n) => n.id === e.source).label === ${JSON.stringify(w7Person)}).length }))()`);
        check('W7 「담당」 칸: 같은 이름의 사람이 이미 있으면 새 사람 없이 그 사람을 이어줌(같은 이름 한 명, 수행 연결 2개)', reuse.nodes === nB && reuse.same === 1 && reuse.links === 2, JSON.stringify(reuse));

        // 이름 수정 뒤 「노드 추가」의 「함께 이을 노드」 목록이 바로 새 이름 (칸에 초점을 주기 전에 읽는다)
        const renameOld = await evaluate(s.cdp, "window.__wu.doc.nodes.find((n) => n.id === 'N-002').label");
        const renameNew = 'W7 바꾼 이름';
        await evaluate(s.cdp, "window.__wu.select('U-A1/N-002')");
        await sleep(150);
        await clickTestId(s.cdp, 'btn-edit');
        await fillPanelForm(s.cdp, { 'node-label': renameNew });
        await sleep(300);
        const listNames = await evaluate(s.cdp, "[...document.querySelectorAll('#add-slot [data-testid=node-link-other] option')].map((o) => o.textContent)");
        check('W7 노드 이름을 고친 직후 「노드 추가」의 「함께 이을 노드」 목록이 새 이름이고 옛 이름이 없음', listNames.some((t) => t.includes(renameNew)) && !listNames.some((t) => t.includes(renameOld)), JSON.stringify({ renameOld, listNames: listNames.slice(0, 6) }));
        await evaluate(s.cdp, "window.__wu.select('U-A1/N-001')");
        await sleep(150);
        await clickTestId(s.cdp, 'btn-edge');
        await sleep(150);
        const edgeNames = await evaluate(s.cdp, "[...document.querySelectorAll('[data-testid=edge-other] option')].map((o) => o.textContent)");
        check('W7 「연결 추가」의 상대 목록도 새 이름', edgeNames.some((t) => t.includes(renameNew)) && !edgeNames.some((t) => t.includes(renameOld)), JSON.stringify(edgeNames.slice(0, 6)));
        await evaluate(s.cdp, "[...document.querySelectorAll('#detail button')].find((b) => b.textContent === '취소').click()");
        await sleep(100);
      } else {
        check('W7 월말 정산(U-A1) 열기', false, 'U-A1이 열리지 않음');
      }

      // ── W10(재검증 R11 반영): R11-5 기록이 그대로인 다시 그리기는 초안 결과·근거 글·스크롤을 유지, 기록이 바뀌면 다시 만들고 안내, R11-14 「관련 문서」 단추 ──
      await w7Restore();
      await evaluate(s.cdp, 'window.confirm = () => true; window.__wu.select(null)');
      await sleep(200);
      await evaluate(s.cdp, "window.__wu.select('U-A1/N-003')"); // 「보고」
      await sleep(250);
      await clickTestId(s.cdp, 'btn-nbhd');
      await sleep(600);
      const w10Nb = await evaluate(s.cdp, "({ nbhd: !!window.__wu.nbhd, outside: window.__wu.cy.getElementById('U-A1/N-021').empty() })");
      check('W10 R11-5 준비: 「보고」 주변만 보기 중이고 「점검표 양식」은 그래프 밖', w10Nb.nbhd && w10Nb.outside, JSON.stringify(w10Nb));
      await clickTestId(s.cdp, 'btn-draft');
      await sleep(250);
      await evaluate(s.cdp, "(() => { const g = (id) => document.querySelector('[data-testid=' + id + ']'); g('draft-target').value = 'U-A1/N-000'; g('draft-target').dispatchEvent(new Event('change')); g('draft-from').value = 'U-A1/N-011'; g('draft-to').value = 'U-A1/N-012'; g('draft-form').querySelector('button[type=submit]').click(); })()");
      await sleep(600);
      const w10Made = await evaluate(s.cdp, "(() => { const item = document.querySelector('[data-testid=draft-item-산출물_문서]'); const chips = item ? [...item.querySelectorAll('.evidence')] : []; return { items: document.querySelectorAll('[data-testid^=draft-item-]').length, chips: chips.length, target: chips.some((c) => c.textContent.includes('점검표 양식')), note: document.querySelector('[data-testid=draft-rerun-note]').hidden }; })()");
      check('W10 R11-5 준비: 대상 지도 전체·윤바다→서하늘 초안이 만들어졌고(11개 항목), 산출물·문서 항목에 「점검표 양식」 근거 칩이 있음', w10Made.items === 11 && w10Made.target && w10Made.note, JSON.stringify(w10Made));
      await evaluate(s.cdp, "(() => { document.querySelector('[data-testid=draft-result]').__w10 = 'same'; const sc = document.getElementById('detail').parentElement; sc.scrollTop = 200; window.__w10Scroll = sc.scrollTop; })()");
      await evaluate(s.cdp, "[...document.querySelectorAll('[data-testid=draft-item-산출물_문서] .evidence')].find((c) => c.textContent.includes('점검표 양식')).click()");
      await sleep(700);
      const w10Same = await evaluate(s.cdp, "(() => { const sc = document.getElementById('detail').parentElement; const res = document.querySelector('[data-testid=draft-result]'); const note = document.querySelector('[data-testid=draft-rerun-note]'); return { nbhd: !!window.__wu.nbhd, kept: !!res && res.__w10 === 'same', noteHidden: !note || note.hidden, ev: document.querySelectorAll('[data-testid=evidence-text]').length, scroll: sc.scrollTop, before: window.__w10Scroll, items: document.querySelectorAll('[data-testid^=draft-item-]').length, cyHas: !window.__wu.cy.getElementById('U-A1/N-021').empty() }; })()");
      check('W10 R11-5 주변만 보기 밖 노드의 근거 칩 → 전체 보기로 돌아와도 기록이 그대로면 「기록이 바뀌어…」 안내 없음, 초안 결과(같은 DOM)·근거 글 한 줄·패널 스크롤이 그대로',
        !w10Same.nbhd && w10Same.cyHas && w10Same.kept && w10Same.noteHidden && w10Same.ev === 1 && w10Same.scroll === w10Same.before && w10Same.items === 11, JSON.stringify(w10Same));
      await shot(s.cdp, `${browser.name}-w10-draft-kept`);
      // 기록이 실제로 바뀌면(사람 추가) 같은 선택으로 다시 만들고 안내가 보인다
      await addViaForm('person', 'W10 시험 사람');
      await sleep(700);
      const w10Changed = await evaluate(s.cdp, "(() => { const res = document.querySelector('[data-testid=draft-result]'); const note = document.querySelector('[data-testid=draft-rerun-note]'); return { replaced: !res || res.__w10 !== 'same', noteShown: !!note && !note.hidden, items: document.querySelectorAll('[data-testid^=draft-item-]').length, to: document.querySelector('[data-testid=draft-to]').value }; })()");
      check('W10 R11-5 기록이 실제로 바뀌면(사람 추가) 초안을 같은 선택으로 다시 만들고 「기록이 바뀌어 초안을 다시 만들었습니다」가 보임', w10Changed.replaced && w10Changed.noteShown && w10Changed.items === 11 && w10Changed.to === 'U-A1/N-012', JSON.stringify(w10Changed));

      // R11-14 「관련 문서」 단추: 속성 칸이 아니라 노드 추가(유형 산출물·이 업무와 「산출」)로
      await evaluate(s.cdp, 'window.__wu.select(null)');
      await sleep(200);
      await addViaForm('work', 'W10 시험 업무');
      await sleep(400);
      const w10Work = await evaluate(s.cdp, 'window.__wu.selected');
      const w10N0 = await evaluate(s.cdp, 'window.__wu.doc.nodes.length');
      await evaluate(s.cdp, "[...document.querySelectorAll('[data-testid=form-missing-item]')].find((x) => x.dataset.field === '관련 문서').click()");
      await sleep(300);
      const w10Rd = await evaluate(s.cdp, "(() => { const g = (id) => document.querySelector('[data-testid=' + id + ']'); const a = document.activeElement; return { open: document.querySelector('details.add').open, type: g('node-type').value, other: g('node-link-other').value, rel: g('node-link-type').value, dir: g('node-link-direction').value, detailVisible: g('node-link-type').checkVisibility(), focus: a && a.dataset ? a.dataset.testid : '', edit: !!g('node-form-edit'), nodes: window.__wu.doc.nodes.length }; })()");
      check('W10 R11-14 「관련 문서」 단추 → 노드 추가가 유형 「산출물」, 함께 이을 노드 = 이 업무, 관계 「산출」(업무 → 새 산출물)으로 미리 골라져 열리고 이름 칸에 초점(수정 화면은 열리지 않음, 아직 저장 안 함)',
        w10Rd.open && w10Rd.type === 'artifact' && w10Rd.other === String(w10Work).split('/')[1] && w10Rd.rel === 'produces' && w10Rd.dir === 'in' && w10Rd.detailVisible && w10Rd.focus === 'node-label' && !w10Rd.edit && w10Rd.nodes === w10N0, JSON.stringify({ w10Work, w10Rd }));
      await shot(s.cdp, `${browser.name}-w10-related-doc`);
      await evaluate(s.cdp, "(() => { const slot = document.getElementById('add-slot'); slot.querySelector('[data-testid=node-label]').value = 'W10 시험 문서'; slot.querySelector('button[type=submit]').click(); })()");
      await sleep(500);
      const w10Saved = await evaluate(s.cdp, `(() => { const d = window.__wu.doc; const art = d.nodes.find((n) => n.label === 'W10 시험 문서'); const wid = ${JSON.stringify(String(w10Work).split('/')[1])}; const e = art ? d.edges.find((x) => !x.hidden && x.core_type === 'produces' && x.source === wid && x.target === art.id) : null; return { art: art ? art.core_type : null, edge: !!e, nodes: d.nodes.length }; })()`);
      check('W10 R11-14 저장하면 새 산출물 + 이 업무에서 산출물로 「산출」 연결이 만들어짐(초안 「산출물·문서 위치」가 읽는 연결)', w10Saved.art === 'artifact' && w10Saved.edge && w10Saved.nodes === w10N0 + 1, JSON.stringify(w10Saved));
      await evaluate(s.cdp, `window.__wu.select(${JSON.stringify(w10Work)})`);
      await sleep(300);
      check('W10 R11-14 산출물을 이으면 권장 항목에서 「관련 문서」가 빠짐', !(await evaluate(s.cdp, "[...document.querySelectorAll('[data-testid=form-missing-item]')].some((x) => x.dataset.field === '관련 문서')")));


      // ── 새 지도 창: 작성 주체·단위 안내, 작성 주체 누락 오류 문구 ──
      await w7Restore();
      await evaluate(s.cdp, 'window.confirm = () => true; window.__wu.select(null)');
      const nUni = await evaluate(s.cdp, 'document.getElementById("universe-picker").options.length');
      await evaluate(s.cdp, "document.getElementById('create-open').click()");
      await sleep(250);
      const cd = await evaluate(s.cdp, "(() => { const t = (id) => (document.querySelector('[data-testid=' + id + ']') || { textContent: '' }).textContent; const o = document.getElementById('create-owner'); return { owner: t('create-owner-hint'), level: t('create-level-hint'), ph: o.placeholder, ownerVisible: o.checkVisibility(), titleText: o.parentElement.firstChild.textContent.trim().startsWith('작성 주체') }; })()");
      check('W7 새 지도 창: 「작성 주체」 옆에 「(이 지도를 책임질 팀·부서 이름, 예: 가상영업팀)」, placeholder, 「단위」 옆에 「(업무 하나면 「업무」 그대로)」',
        cd.owner === '(이 지도를 책임질 팀·부서 이름, 예: 가상영업팀)' && cd.level === '(업무 하나면 「업무」 그대로)' && cd.ph.includes('가상영업팀') && cd.ownerVisible && cd.titleText, JSON.stringify(cd));
      await shot(s.cdp, `${browser.name}-w7-create-dialog`);
      await evaluate(s.cdp, "(() => { document.getElementById('create-name').value = 'W7 시험 지도'; document.getElementById('create-level').value = '업무'; document.getElementById('create-owner').value = ''; document.querySelector('#create-form button[type=submit]').click(); })()");
      await sleep(250);
      const ownerErr = await evaluate(s.cdp, "({ code: document.getElementById('create-message').dataset.code, msg: document.getElementById('create-message').textContent, focus: document.activeElement && document.activeElement.id, open: document.getElementById('create-dialog').open, n: document.getElementById('universe-picker').options.length })");
      check('W7 작성 주체가 비면 만들지 않고(E-REQUIRED 그대로) 「작성 주체(팀·부서 이름, 예: 가상영업팀)를 적으세요. 모르면 창을 닫고 시작 화면의 「내 업무를 정리해 두고 싶어요」로 시작하면 자동으로 채웁니다.」, 작성 주체 칸에 초점',
        ownerErr.code === 'E-REQUIRED' && ownerErr.msg === '작성 주체(팀·부서 이름, 예: 가상영업팀)를 적으세요. 모르면 창을 닫고 시작 화면의 「내 업무를 정리해 두고 싶어요」로 시작하면 자동으로 채웁니다.' && ownerErr.focus === 'create-owner' && ownerErr.open && ownerErr.n === nUni, JSON.stringify(ownerErr));
      await evaluate(s.cdp, "document.getElementById('create-cancel').click()");
      await sleep(150);
      await w7Restore();
    }
    await gotoU('U-A1'); // 뒤 단계(편집 되감기)는 월말 정산에서 시작한다
  }

  // ── 처음 사용 W-A(2026-10-24, CR-18-1·5·6): 묶은 지도 첫 배율(이름 11px 이상)·펼침 안내(expand-note), 양식으로 추가 뒤 접힘·「하나 더」, 확정 때 「담당도 넘기기」(draft-transfer).
  //    데이터를 바꾸므로 시작 때 저장소를 찍어 두었다가 끝에서 되돌린다 ──
  {
    const waSnap = await evaluate(s.cdp, 'JSON.stringify(Object.entries(localStorage))');
    const waRestore = async (id = 'U-A1') => {
      await evaluate(s.cdp, `(() => { const snap = JSON.parse(${JSON.stringify(waSnap)}); localStorage.clear(); for (const [k, v] of snap) localStorage.setItem(k, v); location.hash = ${JSON.stringify(id)}; location.reload(); })()`).catch(() => {});
      await sleep(500);
      return waitFor(s.cdp, `window.__wu && window.__wu.doc && window.__wu.doc.universe.id === ${JSON.stringify(id)} && window.__wu.cy.nodes().length > 0`, 8000);
    };
    const waBox = (sel) => evaluate(s.cdp, `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { w: r.width, h: r.height, text: e.textContent, hidden: e.hidden }; })()`);
    const waToday = () => evaluate(s.cdp, "(() => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; })()");

    // ── CR-18-1 부서(가상 운영부): 첫 화면에서 이름이 읽히는 크기, 지도 중심이 가운데, 「전체 보기」는 전체 ──
    if (await waRestore('U-D1')) {
      await evaluate(s.cdp, 'window.confirm = () => true');
      const waFirst = await evaluate(s.cdp, `(() => { const cy = window.__wu.cy; const root = cy.getElementById(window.__wu.display.rootGid); const c = document.getElementById('graph').getBoundingClientRect(); const p = root.renderedPosition(); const name = cy.nodes().filter((n) => n.data('core_type') !== 'root' && n.visible()).first(); return { zoom: cy.zoom(), namePx: name.empty() ? 0 : name.pstyle('font-size').pfValue * cy.zoom(), tiny: cy.nodes('.tiny-label').length, dx: Math.abs(p.x - c.width / 2), dy: Math.abs(p.y - c.height / 2), nodes: cy.nodes().length }; })()`);
      check('W-A CR-18-1 부서 지도(가상 운영부)를 처음 열면 노드 이름이 화면에서 11px 이상으로 읽히고(작은 이름 숨김 0개) 지도 중심이 그래프 가운데', waFirst.nodes > 12 && waFirst.namePx >= 10.9 && waFirst.tiny === 0 && waFirst.dx < 60 && waFirst.dy < 60, JSON.stringify(waFirst));
      await shot(s.cdp, `${browser.name}-wa-first-scale`);
      await evaluate(s.cdp, "document.getElementById('fit').click()");
      await sleep(250);
      const waFit = await evaluate(s.cdp, '({ zoom: window.__wu.cy.zoom() })');
      check('W-A CR-18-1 「전체 보기」를 누르면 전체가 보이는 배율로 돌아감(첫 배율보다 작음)', waFit.zoom < waFirst.zoom - 0.02, JSON.stringify([waFirst.zoom, waFit.zoom]));
      // 접힌 팀(가상정산팀)을 펼치면 안쪽에 접힌 묶음 2개가 더 있다는 한 줄
      await evaluate(s.cdp, "window.__wu.toggle('U-T1')");
      await sleep(400);
      const waNote = await waBox('[data-testid=expand-note]');
      check('W-A CR-18-1 접힌 팀을 펼치면 그래프 위 상태 줄에 「가상정산팀을 펼쳤습니다. 안에 접힌 묶음 2개가 더 있습니다(＋숫자 — 두 번 누르면 한 겹씩 펼침)」(크기 있음)', !!waNote && waNote.w > 0 && waNote.h > 0 && waNote.text === '「가상정산팀」을 펼쳤습니다. 안에 접힌 묶음 2개가 더 있습니다(＋숫자 — 두 번 누르면 한 겹씩 펼침)', JSON.stringify(waNote));
      await shot(s.cdp, `${browser.name}-wa-expand-note`);
      await evaluate(s.cdp, "window.__wu.select(window.__wu.display.rootGid)");
      await sleep(250);
      check('W-A CR-18-1 다음 조작(노드 고르기)에서 펼침 안내가 사라짐', (await waBox('[data-testid=expand-note]')) === null);
      // 안쪽까지 펼친 뒤에는 안내가 없다
      await evaluate(s.cdp, "window.__wu.toggle('U-A1'); window.__wu.toggle('U-K1'); window.__wu.toggle('U-T1'); window.__wu.toggle('U-T1')");
      await sleep(400);
      check('W-A CR-18-1 안에 접힌 묶음이 없으면(안쪽까지 펼친 팀을 다시 펼침) 펼침 안내가 없음', (await waBox('[data-testid=expand-note]')) === null);
    }

    // ── 업무 하나짜리(월말 정산 점검)는 지금 그대로: 처음 배율 = 전체 보기 배율 ──
    if (await waRestore('U-A1')) {
      await evaluate(s.cdp, 'window.confirm = () => true');
      const waZ0 = await evaluate(s.cdp, 'window.__wu.cy.zoom()');
      const waInfo = await evaluate(s.cdp, 'window.__wu.firstViewInfo ? window.__wu.firstViewInfo() : null');
      await evaluate(s.cdp, "document.getElementById('fit').click()");
      await sleep(250);
      const waZ1 = await evaluate(s.cdp, 'window.__wu.cy.zoom()');
      // 처음 배치(여백 30)와 「전체 보기」(여백 40)는 원래 여백이 달라 배율이 몇 % 다르다: 올리지 않았는지는 첫 배율 판정으로 본다
      check('W-A CR-18-1 업무 하나짜리 지도는 첫 배율을 올리지 않음(처음 맞춤 그대로, 「전체 보기」와 여백 차이만)', !!waInfo && waInfo.raised === false && Math.abs(waInfo.zoom - waZ0) < 0.001 && waZ1 <= waZ0 + 0.001 && waZ0 / waZ1 < 1.15, JSON.stringify([waInfo, waZ0, waZ1]));

      // ── CR-18-5 추가 양식: 저장하면 접히고 「하나 더」로 유형·이을 항목을 유지한 채 다시 펼침 ──
      await evaluate(s.cdp, "window.__wu.select(null); document.querySelector('details.add').open = true");
      await sleep(200);
      const waAdd = (type, label, link) => evaluate(s.cdp, `(() => { const slot = document.getElementById('add-slot'); const t = slot.querySelector('[data-testid=node-type]'); t.value = ${JSON.stringify(type)}; t.dispatchEvent(new Event('change')); slot.querySelector('[data-testid=node-label]').value = ${JSON.stringify(label)}; ${link ? "const o = slot.querySelector('[data-testid=node-link-other]'); const w = [...o.options].find((x) => x.textContent.includes('(업무)')); o.value = w.value; o.dispatchEvent(new Event('change')); const r = slot.querySelector('[data-testid=node-link-type]'); if ([...r.options].some((x) => x.value === 'performs' && !x.disabled)) { r.value = 'performs'; r.dispatchEvent(new Event('change')); } window.__waOther = o.value;" : ''} slot.querySelector('button[type=submit]').click(); })()`);
      const waN0 = await evaluate(s.cdp, 'window.__wu.doc.nodes.length');
      await waAdd('person', 'W-A 시험 사람', true);
      await sleep(500);
      const waFold = await evaluate(s.cdp, `(() => { const n = document.querySelector('[data-testid=add-folded]'); const r = n ? n.getBoundingClientRect() : { width: 0, height: 0 }; const d = document.querySelector('details.add'); return { open: d.open, text: n ? n.textContent : '', w: r.width, h: r.height, nodes: window.__wu.doc.nodes.length, btn: !!document.querySelector('[data-testid=add-another]') }; })()`);
      check('W-A CR-18-5 양식으로 저장하면 「사람·업무·문서 추가」가 접히고 「「W-A 시험 사람」을 넣었습니다 · 하나 더」 한 줄(크기 있음)', waFold.nodes === waN0 + 1 && !waFold.open && waFold.w > 0 && waFold.h > 0 && waFold.text === '「W-A 시험 사람」을 넣었습니다 · 하나 더' && waFold.btn, JSON.stringify(waFold));
      await shot(s.cdp, `${browser.name}-wa-add-folded`);
      await clickTestId(s.cdp, 'add-another');
      await sleep(250);
      const waAnother = await evaluate(s.cdp, `(() => { const slot = document.getElementById('add-slot'); const g = (id) => slot.querySelector('[data-testid=' + id + ']'); const a = document.activeElement; const n = document.querySelector('[data-testid=add-folded]'); return { open: document.querySelector('details.add').open, type: g('node-type').value, other: g('node-link-other').value, expectOther: window.__waOther, rel: g('node-link-type').value, label: g('node-label').value, focus: a && a.dataset ? a.dataset.testid : '', noteHidden: !n || n.hidden }; })()`);
      check('W-A CR-18-5 「하나 더」: 양식이 다시 펼쳐지고 유형(사람)·이을 항목·관계는 방금 값 그대로, 이름 칸은 비어 있고 초점, 접힘 안내는 사라짐', waAnother.open && waAnother.type === 'person' && waAnother.other === waAnother.expectOther && waAnother.other !== '' && waAnother.rel === 'performs' && waAnother.label === '' && waAnother.focus === 'node-label' && waAnother.noteHidden, JSON.stringify(waAnother));
      // 실패(이름 비움)는 접지 않고 오류를 그대로 보인다
      await evaluate(s.cdp, "document.getElementById('add-slot').querySelector('button[type=submit]').click()");
      await sleep(250);
      const waFail = await evaluate(s.cdp, `({ open: document.querySelector('details.add').open, code: ((document.querySelector('#add-slot [data-testid=form-message]') || {}).dataset || {}).code || '', nodes: window.__wu.doc.nodes.length })`);
      check('W-A CR-18-5 저장에 실패하면(이름 없음) 접지 않고 오류 문구가 그대로 보임', waFail.open && waFail.code !== '' && waFail.nodes === waN0 + 1, JSON.stringify(waFail));
      // 초안 창이 열려 있으면 추가 뒤에도 초안이 맨 위에 그대로 보임
      await evaluate(s.cdp, "window.__wu.select(null)");
      await clickTestId(s.cdp, 'btn-draft-universe');
      await sleep(200);
      await evaluate(s.cdp, "document.querySelector('details.add').open = true");
      await waAdd('topic', 'W-A 시험 주제', false);
      await sleep(500);
      const waDraft = await evaluate(s.cdp, `(() => { const a = document.querySelector('aside'); const f = document.querySelector('[data-testid=draft-form]'); const r = f ? f.getBoundingClientRect() : null; const ar = a.getBoundingClientRect(); return { draft: !!f, scroll: a.scrollTop, inView: !!r && r.top >= ar.top - 1 && r.top < ar.bottom, open: document.querySelector('details.add').open }; })()`);
      check('W-A CR-18-5 초안 창이 열린 채 추가해도 초안 창이 닫히지 않고 패널 맨 위에 그대로 보이며 양식은 접힘', waDraft.draft && waDraft.scroll === 0 && waDraft.inView && !waDraft.open, JSON.stringify(waDraft));
    }

    // ── CR-18-6 확정 때 「담당도 넘기기」: 기본 꺼짐 → 켜고 확정 → 수행 연결 기간·새 연결·안내 문구 ──
    if (await waRestore('U-A1')) {
      await evaluate(s.cdp, 'window.confirm = (m) => { window.__cm = m; return true; }; window.__wu.select(null)');
      await clickTestId(s.cdp, 'btn-draft-universe');
      await sleep(200);
      await makeDraft('U-A1/N-001', 'U-A1/N-012', 'U-A1/N-010');
      await sleep(300);
      const waTr = await evaluate(s.cdp, `(() => { const c = document.querySelector('[data-testid=draft-transfer]'); const l = document.querySelector('[data-testid=draft-transfer-list]'); const b = document.querySelector('[data-testid=draft-transfer-box]'); const r = b ? b.getBoundingClientRect() : { width: 0, height: 0 }; const conf = document.querySelector('[data-testid=draft-confirm]').getBoundingClientRect(); return { has: !!c, checked: c && c.checked, disabled: c && c.disabled, w: r.width, h: r.height, above: r.bottom <= conf.top + 1, text: b ? b.textContent : '', list: l ? l.textContent : '' }; })()`);
      check('W-A CR-18-6 확정 단추 위에 「담당도 넘기기 — 보내는 사람의 수행을 오늘로 끝내고 받는 사람이 오늘부터 맡습니다」 칸(크기 있음, 기본 꺼짐)과 넘길 업무 「대사 확인」 목록', waTr.has && waTr.checked === false && waTr.disabled === false && waTr.w > 0 && waTr.h > 0 && waTr.above && waTr.text.includes('담당도 넘기기 — 보내는 사람의 수행을 오늘로 끝내고 받는 사람이 오늘부터 맡습니다') && waTr.list.includes('「대사 확인」'), JSON.stringify(waTr));
      await shot(s.cdp, `${browser.name}-wa-transfer-box`);
      const waToday0 = await waToday();
      const waEdges0 = await evaluate(s.cdp, "JSON.stringify(window.__wu.doc.edges.filter((e) => e.core_type === 'performs').map((e) => [e.source, e.target, e.period, e.hidden]))");
      await evaluate(s.cdp, "document.querySelector('[data-testid=draft-transfer]').click()"); // 켬
      await clickTestId(s.cdp, 'draft-confirm');
      await sleep(500);
      const waDone = await evaluate(s.cdp, `(() => { const d = window.__wu.doc; const old = d.edges.find((e) => e.core_type === 'performs' && e.source === 'N-012' && e.target === 'N-001' && !e.hidden); const nu = d.edges.filter((e) => e.core_type === 'performs' && e.source === 'N-010' && e.target === 'N-001' && !e.hidden && e.period && e.period.start && !e.period.end); const evs = d.events.slice(-14).map((e) => e.type); const n = document.querySelector('[data-testid=confirm-done]'); return { oldEnd: old && old.period && old.period.end, nu: nu.map((e) => e.period.start), evs, note: n ? n.textContent : '', confirmText: window.__cm }; })()`);
      check('W-A CR-18-6 켜고 확정하면 서하늘의 수행 연결 끝 = 오늘, 한가람의 새 수행 연결 시작 = 오늘, 이력에 담당 종료·시작이 함께 남음', waDone.oldEnd === waToday0 && JSON.stringify(waDone.nu) === JSON.stringify([waToday0]) && waDone.evs.includes('assign_end') && waDone.evs.includes('assign_start') && waDone.evs.includes('handover'), JSON.stringify({ waToday0, ...waDone, note: '' }));
      check('W-A CR-18-6 결과 안내에 「담당도 넘겼습니다: 「대사 확인」 서하늘 → 한가람(오늘부터)」, 확인 창에도 넘김 문구', waDone.note.includes('인수인계서로 저장했습니다') && waDone.note.includes('담당도 넘겼습니다: 「대사 확인」 서하늘 → 한가람(오늘부터)') && !waDone.note.includes('현재 담당은 그대로입니다') && String(waDone.confirmText).includes('담당도 넘깁니다'), waDone.note + ' / ' + waDone.confirmText);
      void waEdges0;
      await shot(s.cdp, `${browser.name}-wa-transfer-done`);
      // 꺼진 채 확정(다른 날 같은 사람 사이는 막히므로 다른 사람 쌍)하면 수행 연결은 그대로, 안내는 예전 문구
      await evaluate(s.cdp, 'window.__wu.select(null)');
      await clickTestId(s.cdp, 'btn-draft-universe');
      await sleep(200);
      await makeDraft('U-A1/N-001', 'U-A1/N-010', 'U-A1/N-011');
      await sleep(300);
      const waEdgesBefore = await evaluate(s.cdp, "JSON.stringify(window.__wu.doc.edges.filter((e) => e.core_type === 'performs').map((e) => [e.id, e.period, e.hidden]))");
      await clickTestId(s.cdp, 'draft-confirm');
      await sleep(500);
      const waOff = await evaluate(s.cdp, "({ edges: JSON.stringify(window.__wu.doc.edges.filter((e) => e.core_type === 'performs').map((e) => [e.id, e.period, e.hidden])), note: (document.querySelector('[data-testid=confirm-done]') || {}).textContent || '' })");
      check('W-A CR-18-6 끄고 확정하면 수행 연결은 그대로이고 안내는 「현재 담당은 그대로입니다 — …」(직접 넘기는 방법)', waOff.edges === waEdgesBefore && waOff.note.includes('현재 담당은 그대로입니다') && !waOff.note.includes('담당도 넘겼습니다'), waOff.note.slice(0, 160));
      await waRestore('U-A1');
    }
  }

  // ── 일상 사용 G1(CR-18-8, 2026-10-24): D-9 초안 협업 줄의 소속·연락처, D-11 「해결 메모(선택)」 칸·초안의 「최근 해결」, D-13 다시 뽑은 초안의 「새로」 표시.
  //    데이터를 바꾸므로 시작 때 저장소를 찍어 두었다가 끝에서 되돌린다 ──
  {
    const g1Snap = await evaluate(s.cdp, 'JSON.stringify(Object.entries(localStorage))');
    const g1Restore = async (id = 'U-A1') => {
      await evaluate(s.cdp, `(() => { const snap = JSON.parse(${JSON.stringify(g1Snap)}); localStorage.clear(); for (const [k, v] of snap) localStorage.setItem(k, v); location.hash = ${JSON.stringify(id)}; location.reload(); })()`).catch(() => {});
      await sleep(500);
      return waitFor(s.cdp, `window.__wu && window.__wu.doc && window.__wu.doc.universe.id === ${JSON.stringify(id)} && window.__wu.cy.nodes().length > 0`, 8000);
    };
    const g1Today = () => evaluate(s.cdp, "(() => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; })()");
    const g1Draft = async () => {
      await evaluate(s.cdp, 'window.confirm = () => true; window.__wu.select(null)');
      await clickTestId(s.cdp, 'btn-draft-universe');
      await sleep(200);
      await makeDraft('U-A1/N-001', 'U-A1/N-011', 'U-A1/N-010');
      await sleep(300);
    };
    const g1Item = (key) => evaluate(s.cdp, `[...document.querySelectorAll('[data-testid=draft-item-${key}] li')].map((li) => ({ text: li.querySelector('span:not(.chip):not(.evidence-row)') ? li.querySelector('span:not(.chip):not(.evidence-row)').textContent : '', marks: li.querySelectorAll('[data-testid=draft-new-mark]').length }))`);
    const g1Marks = () => evaluate(s.cdp, "(() => { const m = [...document.querySelectorAll('[data-testid=draft-new-mark]')]; return { n: m.length, text: m.map((x) => x.textContent), sized: m.every((x) => { const r = x.getBoundingClientRect(); return r.width > 0 && r.height > 0; }), li: document.querySelectorAll('[data-testid=draft-result] li').length }; })()");

    if (await g1Restore('U-A1')) {
      // 협업자(가상 사람, 소속·내선 속성)를 대사 확인에 「참조」로 이어 저장소에 넣고 다시 연다
      await evaluate(s.cdp, `(() => { const k = 'wu:v1:u:U-A1'; const d = JSON.parse(localStorage.getItem(k)); const base = d.nodes.find((n) => n.id === 'N-010'); const nu = JSON.parse(JSON.stringify(base)); nu.id = 'N-901'; nu.label = 'G1 시험 협업자'; delete nu.emp_no; nu.attrs = { 소속: '가상감사실', 내선: '0000' }; d.nodes.push(nu); const e = d.edges.find((x) => x.core_type === 'references') || d.edges[0]; d.edges.push({ ...JSON.parse(JSON.stringify(e)), id: 'L-901', source: 'N-001', target: 'N-901', core_type: 'references', hidden: false }); localStorage.setItem(k, JSON.stringify(d)); localStorage.removeItem('wu:v1:draft-seen'); location.reload(); })()`).catch(() => {});
      await sleep(500);
      await waitFor(s.cdp, "window.__wu && window.__wu.doc && window.__wu.doc.nodes.some((n) => n.id === 'N-901') && window.__wu.cy.nodes().length > 0", 8000);

      // D-9 + D-13(처음 만들 때는 표시 없음, 이 브라우저 설정에만 남음)
      await g1Draft();
      const g1Collab = (await g1Item('관계자_연락처')).map((x) => x.text).find((t) => t.startsWith('협업: G1 시험 협업자')) || '';
      check('G1 D-9 초안 「관계자·연락처」 협업 줄에 소속(속성)과 연락처(내선 속성)가 붙음', g1Collab === '협업: G1 시험 협업자 — 참조 대사 확인. 소속: 가상감사실. 연락: 0000', g1Collab);
      const g1First = await g1Marks();
      const g1Seen = await evaluate(s.cdp, "(() => { const raw = localStorage.getItem('wu:v1:draft-seen'); const v = raw ? JSON.parse(raw) : null; return { has: !!(v && v.at && v.at['U-A1/N-001']), inDoc: JSON.stringify(window.__wu.doc).includes('draft-seen'), inUniverse: Object.keys(localStorage).filter((k) => k.startsWith('wu:v1:u:')).some((k) => localStorage.getItem(k).includes('draft-seen')) }; })()");
      check('G1 D-13 처음 만든 초안에는 「새로」 표시가 없고, 이번 시각이 이 브라우저 설정(wu:v1:draft-seen)에만 남음(문서·유니버스 저장에는 없음)', g1First.n === 0 && g1Seen.has && !g1Seen.inDoc && !g1Seen.inUniverse, JSON.stringify({ g1First, g1Seen }));

      // D-11 (a) 해결 메모 칸: 적고 해결 / 비우고 해결
      await sleep(1100); // 해결 메모의 기록 시각이 방금 남긴 초안 시각보다 뒤(초 단위)가 되게
      await evaluate(s.cdp, "window.__wu.select('U-A1/N-001')");
      await sleep(200);
      await clickTestId(s.cdp, 'btn-issues');
      await sleep(250);
      await evaluate(s.cdp, "document.querySelectorAll('[data-testid=issue-group]').forEach((d) => { d.open = true; })");
      const g1Rows = await evaluate(s.cdp, "[...document.querySelectorAll('[data-testid=issue-item]')].map((li) => { const i = li.querySelector('[data-testid=resolve-note]'); const r = i ? i.getBoundingClientRect() : { width: 0, height: 0 }; return { gid: li.dataset.gid, chip: li.querySelector('.chip').textContent, has: !!i, w: r.width, h: r.height, ph: i ? i.getAttribute('placeholder') : '', max: i ? i.getAttribute('maxlength') : '' }; })");
      check('G1 D-11 미해결 목록 항목마다 「해결 메모(선택)」 한 줄 칸(크기 있음, 글자 수 상한 있음)', g1Rows.length > 1 && g1Rows.every((x) => x.has && x.w > 0 && x.h > 0 && x.ph === '해결 메모(선택)' && Number(x.max) > 0), JSON.stringify(g1Rows));
      await shot(s.cdp, `${browser.name}-g1-resolve-note`);
      const g1Typed = '원천 시스템 회신으로 종결(G1 시험)';
      const g1Target = g1Rows.find((x) => x.chip === '진행 중') || g1Rows[0];
      const g1Other = g1Rows.find((x) => x.gid !== g1Target.gid);
      const g1e0 = await evaluate(s.cdp, 'window.__wu.doc.events.length');
      await evaluate(s.cdp, `(() => { const li = document.querySelector('[data-gid="${g1Target.gid}"]'); const i = li.querySelector('[data-testid=resolve-note]'); i.value = '  ${g1Typed}  '; li.querySelector('[data-testid=btn-resolve]').click(); })()`);
      await sleep(300);
      const g1Added = JSON.parse(await evaluate(s.cdp, 'JSON.stringify(window.__wu.doc.events.at(-1))'));
      check('G1 D-11 해결 메모를 적고 「해결로 표시」 → 그 글(앞뒤 공백 없이)이 해결됨 메모의 내용, 범주 resolved·resolves_id 그대로, 메모 한 건만 늘어남', g1Added.note === g1Typed && g1Added.payload.category === 'resolved' && g1Added.payload.resolves_id === g1Target.gid.split('/')[1] && (await evaluate(s.cdp, 'window.__wu.doc.events.length')) === g1e0 + 1, JSON.stringify(g1Added));
      await evaluate(s.cdp, `document.querySelector('[data-gid="${g1Other.gid}"] [data-testid=btn-resolve]').click()`);
      await sleep(300);
      const g1Added2 = JSON.parse(await evaluate(s.cdp, 'JSON.stringify(window.__wu.doc.events.at(-1))'));
      check('G1 D-11 칸을 비우고 「해결로 표시」 → 지금처럼 「해결: 원래 메모 앞부분」', /^해결: /.test(g1Added2.note) && g1Added2.payload.resolves_id === g1Other.gid.split('/')[1], JSON.stringify(g1Added2));
      await clickTestId(s.cdp, 'issue-close');
      await sleep(100);

      // D-11 (b) 최근 해결 + D-13 (다시 뽑은 초안: 그 사이 기록된 근거가 붙은 문장만 「새로」)
      const g1Day = await g1Today();
      await g1Draft();
      const g1Prog = await g1Item('진행_중');
      const g1Recent = g1Prog.filter((x) => x.text.startsWith('최근 해결: '));
      check('G1 D-11 초안 「진행 중인 일」에 「최근 해결: 적은 글(오늘 날짜)」 한 줄', g1Recent.some((x) => x.text === `최근 해결: ${g1Typed}(${g1Day})`) && g1Recent.length >= 2, JSON.stringify(g1Prog.map((x) => x.text)));
      const g1Again = await g1Marks();
      const g1RecentMarked = g1Recent.filter((x) => x.marks === 1).length;
      // 일상 사용 2회차 ①: 방금 해결한 이슈의 「최근 이슈」 줄에는 해결 날짜가 붙고, 그 해결 기록이 근거라 「새로」도 붙는다
      const g1IssueLines = await g1Item('최근_이슈');
      const g1IssueMarked = g1IssueLines.filter((x) => x.marks === 1).length;
      check('G1 D-13 지난번 초안 이후 기록된 근거가 붙은 문장(최근 해결 두 줄, 방금 해결해 해결 날짜가 붙은 최근 이슈 줄)에만 작은 「새로」 표시(크기 있음), 나머지 문장에는 없음', g1Again.n === g1RecentMarked + g1IssueMarked && g1RecentMarked === 2 && g1IssueMarked <= 2 && g1IssueLines.filter((x) => x.marks === 1).every((x) => x.text.includes('해결')) && g1Again.n < g1Again.li && g1Again.sized && g1Again.text.every((t) => t === '새로'), JSON.stringify({ g1Again, g1Recent, g1IssueLines }));
      await shot(s.cdp, `${browser.name}-g1-draft-new-mark`);
      const g1Chip = await evaluate(s.cdp, "(() => { const m = document.querySelector('[data-testid=draft-new-mark]'); if (!m) return null; return { w: m.getBoundingClientRect().width, li: m.closest('li').getBoundingClientRect().width }; })()");
      check('G1 D-13 「새로」는 작은 칩(문장 줄 폭의 절반보다 좁음 — 한 줄을 꽉 채운 띠가 아님, 2026-10-25 사용자 "어디에 붙는지 못 찾겠음")', !!g1Chip && g1Chip.w > 0 && g1Chip.w < g1Chip.li / 2, JSON.stringify(g1Chip));
      // 그 뒤 새 기록이 없으면 다시 만든 초안에는 표시가 없다
      await makeDraft('U-A1/N-001', 'U-A1/N-011', 'U-A1/N-010');
      await sleep(300);
      check('G1 D-13 그 뒤 새 기록 없이 다시 만들면 「새로」 표시가 사라짐', (await g1Marks()).n === 0, JSON.stringify(await g1Marks()));
      await g1Restore('U-A1');
    }
  }

  // ── 일상 사용 G2(CR-18-8, 2026-10-24): D-5 사람 인수인계 초안의 대상 지도, D-6 「이 사람 일, 누가 대신할 수 있나」, D-8 「협업자 추가」·「참조」 설명, D-10 「이번 주 기록」,
  //    D-12 「이미 끝난 일(해결됨으로 기록)」, D-14 이력 목록의 [이슈] 꼬리표, D-15 사번 없음 안내.
  //    데이터를 바꾸므로 시작 때 localStorage를 찍어 두었다가 끝에서 되돌린다 ──
  {
    const g2Snap = await evaluate(s.cdp, 'JSON.stringify(Object.entries(localStorage))');
    const g2Restore = async (id = 'U-A1') => {
      await evaluate(s.cdp, `(() => { const snap = JSON.parse(${JSON.stringify(g2Snap)}); localStorage.clear(); for (const [k, v] of snap) localStorage.setItem(k, v); location.hash = ${JSON.stringify(id)}; location.reload(); })()`).catch(() => {});
      await sleep(500);
      return waitFor(s.cdp, `window.__wu && window.__wu.doc && window.__wu.doc.universe.id === ${JSON.stringify(id)} && window.__wu.cy.nodes().length > 0`, 8000);
    };
    const g2Box = (sel) => evaluate(s.cdp, `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { w: r.width, h: r.height, text: e.textContent, open: e.open, hidden: e.hidden }; })()`);
    const g2Set = (testid, val) => evaluate(s.cdp, `(() => { const e = document.querySelector('[data-testid=${testid}]'); if (!e) return false; e.value = ${JSON.stringify(val)}; e.dispatchEvent(new Event('input')); e.dispatchEvent(new Event('change')); return true; })()`);
    const g2Select = async (gid) => { await evaluate(s.cdp, `window.__wu.select(${JSON.stringify(gid)})`); await sleep(250); };
    const g2Last = (n = 1) => evaluate(s.cdp, `JSON.stringify(window.__wu.doc.events.slice(-${n}))`).then((x) => JSON.parse(x));

    // ── D-5·D-6: 부서(가상 운영부)에서 사람 상세 ──
    if (await g2Restore('U-D1')) {
      await evaluate(s.cdp, 'window.confirm = () => true');
      await g2Select('U-A1/N-012'); // 서하늘: 월말 정산 점검(U-A1)에서 대사 확인을 맡음
      const g2Btn = await evaluate(s.cdp, "(() => { const b = document.querySelector('[data-testid=btn-person-draft]'); return b ? { target: b.dataset.target, title: b.title } : null; })()");
      check('G2 D-5 부서 지도에서 사람 상세의 「이 사람 일 인수인계 초안」 대상은 부서 전체가 아니라 그가 맡은 업무가 있는 지도(월말 정산 점검) 지도 중심', !!g2Btn && g2Btn.target === 'U-A1/N-000' && g2Btn.title.includes('월말 정산 점검'), JSON.stringify(g2Btn));
      const g2Bk = await g2Box('[data-testid=person-backup]');
      check('G2 D-6 사람 상세에 접힌 상자 「이 사람 일, 누가 대신할 수 있나」(처음엔 접힘, 크기 있음)', !!g2Bk && g2Bk.w > 0 && g2Bk.h > 0 && g2Bk.open === false && g2Bk.text.includes('이 사람 일, 누가 대신할 수 있나'), JSON.stringify(g2Bk));
      await evaluate(s.cdp, "document.querySelector('[data-testid=person-backup]').open = true");
      await sleep(150);
      const g2Rows = await evaluate(s.cdp, "[...document.querySelectorAll('[data-testid=person-backup-row]')].map((tr) => ({ work: tr.querySelector('td').textContent, cands: [...tr.querySelectorAll('[data-testid=person-backup-cand]')].map((li) => ({ name: li.querySelector('button').textContent, state: li.dataset.state, text: li.textContent })) }))");
      // 앞 점검(CR-13)이 서하늘에게 업무를 하나 더 맡겨 둔 상태일 수 있다: 대사 확인 줄을 찾아 본다. 같은 말이 두 번 나오지 않는다
      const g2Rec = g2Rows.find((r) => r.work === '대사 확인');
      check('G2 D-6 표: 대사 확인 줄의 후보는 직접 해 본 윤바다·한가람(최대 3명), 「직접 해 봄(기간)」이 한 번만', g2Rows.length >= 1 && !!g2Rec && g2Rec.cands.length >= 1 && g2Rec.cands.length <= 3 && g2Rec.cands.every((c) => c.state === 'direct' && c.text.split('직접 해 봄').length === 2) && g2Rec.cands.map((c) => c.name).join() === '윤바다,한가람', JSON.stringify(g2Rows));
      await shot(s.cdp, `${browser.name}-g2-person-backup`);
      await evaluate(s.cdp, "document.querySelector('[data-testid=person-backup-name]').click()");
      await sleep(250);
      const g2Picked = await evaluate(s.cdp, "(() => { const n = window.__wu.view.getNode(window.__wu.selected); return n ? n.label : null; })()");
      check('G2 D-6 후보 이름을 누르면 그 사람이 선택됨', g2Picked === '윤바다', String(g2Picked));
      // 후보 없음, 맡은 업무 없음
      await g2Select('U-K1/N-501'); // 업무 하나(승인요청 수신)뿐이고 비슷한 일을 해 본 사람이 없음
      await evaluate(s.cdp, "(document.querySelector('[data-testid=person-backup]') || {}).open = true");
      const g2None = await g2Box('[data-testid=person-backup-none]');
      check('G2 D-6 후보가 없으면 「후보 없음 — 비슷한 일을 해 본 기록이 없습니다」', !!g2None && g2None.text === '후보 없음 — 비슷한 일을 해 본 기록이 없습니다' && g2None.w > 0, JSON.stringify(g2None));
      await g2Select('U-A1/N-010'); // 한가람: 맡은 업무 없음
      const g2NoBox = await g2Box('[data-testid=person-backup]');
      const g2Fall = await evaluate(s.cdp, "(() => { const b = document.querySelector('[data-testid=btn-person-draft]'); return b ? b.dataset.target : null; })()");
      check('G2 D-5·D-6 맡은 업무가 없는 사람: 대사 상자는 없고, 초안 대상은 지금처럼 지도 전체(부서 지도 중심)', g2NoBox === null && g2Fall === 'U-D1/N-000', JSON.stringify([g2NoBox, g2Fall]));
      await clickTestId(s.cdp, 'btn-person-draft');
      await sleep(250);
      const g2Draft = await evaluate(s.cdp, "(() => { const t = document.querySelector('[data-testid=draft-target]'); return t ? t.value : null; })()");
      check('G2 D-5 그 단추로 열린 초안 창의 대상이 지도 전체(부서 지도 중심)', g2Draft === 'U-D1/N-000', String(g2Draft));
      await g2Select('U-A1/N-012');
      await clickTestId(s.cdp, 'btn-person-draft');
      await sleep(250);
      const g2Draft2 = await evaluate(s.cdp, "(() => { const t = document.querySelector('[data-testid=draft-target]'); const f = document.querySelector('[data-testid=draft-from]'); return t ? { target: t.value, from: f.selectedOptions[0] ? f.selectedOptions[0].textContent : '' } : null; })()");
      check('G2 D-5 서하늘의 단추로 열린 초안 창은 대상 = 월말 정산 점검 지도 중심, 보내는 사람 = 서하늘', !!g2Draft2 && g2Draft2.target === 'U-A1/N-000' && g2Draft2.from.includes('서하늘'), JSON.stringify(g2Draft2));
    } else {
      check('G2 가상 운영부(U-D1) 열기', false, 'U-D1이 열리지 않음');
    }

    // ── D-8·D-10·D-12·D-14·D-15: 월말 정산 점검 ──
    if (await g2Restore('U-A1')) {
      await evaluate(s.cdp, 'window.confirm = () => true');
      // D-8 관계 목록의 「참조」 설명
      await g2Select('U-A1/N-001');
      await clickTestId(s.cdp, 'btn-edge');
      await sleep(200);
      const g2Rel = await evaluate(s.cdp, "(() => { const o = [...document.querySelectorAll('[data-testid=edge-type] option')].find((x) => x.value === 'references'); const p = [...document.querySelectorAll('[data-testid=edge-type] option')].find((x) => x.value === 'performs'); return { ref: o ? o.textContent : null, perf: p ? p.textContent : null }; })()");
      check('G2 D-8 연결 추가의 관계 목록에서 「참조」에 「(협업·공유·참고)」 설명(값은 그대로), 「수행」은 그대로', g2Rel.ref === '참조 (협업·공유·참고)' && g2Rel.perf === '수행', JSON.stringify(g2Rel));
      // 같은 노드를 다시 고르면 열린 연결 추가 창이 그대로다(기존 동작): 다른 노드를 거쳐 상세로 돌아온다
      await g2Select('U-A1/N-000');
      await g2Select('U-A1/N-001');
      // D-8 협업자 추가
      const g2n0 = await evaluate(s.cdp, 'window.__wu.doc.nodes.length');
      const g2e0 = await evaluate(s.cdp, 'window.__wu.doc.events.length');
      const g2Cq = await g2Box('[data-testid=collab-quick]');
      check('G2 D-8 업무 상세에 접힌 「협업자 추가」(처음엔 접힘, 크기 있음)', !!g2Cq && g2Cq.w > 0 && g2Cq.h > 0 && g2Cq.open === false, JSON.stringify(g2Cq));
      await evaluate(s.cdp, "document.querySelector('[data-testid=collab-quick]').open = true");
      await sleep(100);
      await clickTestId(s.cdp, 'collab-add');
      await sleep(150);
      const g2Empty = await g2Box('[data-testid=collab-msg]');
      check('G2 D-8 이름이 비면 「협업자 이름을 넣으세요.」, 저장 안 함', !!g2Empty && g2Empty.text === '협업자 이름을 넣으세요.' && (await evaluate(s.cdp, 'window.__wu.doc.nodes.length')) === g2n0, JSON.stringify(g2Empty));
      await g2Set('collab-name', 'G2 시험 협업자');
      await g2Set('collab-affiliation', '가상감사실');
      await g2Set('collab-contact', '내선 0000');
      await shot(s.cdp, `${browser.name}-g2-collab-quick`);
      await clickTestId(s.cdp, 'collab-add');
      await sleep(350);
      const g2Added = await evaluate(s.cdp, "(() => { const d = window.__wu.doc; const n = d.nodes.find((x) => x.label === 'G2 시험 협업자'); const e = n ? d.edges.find((x) => x.core_type === 'references' && x.target === n.id) : null; return { n: n ? { type: n.core_type, attrs: n.attrs, emp: n.emp_no || null } : null, e: e ? { source: e.source, hidden: !!e.hidden } : null, nodes: d.nodes.length }; })()");
      const g2Done = await g2Box('[data-testid=collab-done]');
      check('G2 D-8 「추가」 → 사람 노드(속성 소속·연락처)와 업무(대사 확인) → 사람 「참조」 연결 한 번에, 노드 +1', !!g2Added.n && g2Added.n.type === 'person' && g2Added.n.attrs && g2Added.n.attrs['소속'] === '가상감사실' && g2Added.n.attrs['연락처'] === '내선 0000' && !!g2Added.e && g2Added.e.source === 'N-001' && g2Added.nodes === g2n0 + 1, JSON.stringify(g2Added));
      check('G2 D-8·D-15 완료 안내(크기 있음)에 새 사람임과 「다른 팀 사람이면 사번 없이 두어도 됩니다」', !!g2Done && g2Done.w > 0 && g2Done.text.includes('새 사람으로 만들었습니다') && g2Done.text.includes('다른 팀 사람이면 사번 없이 두어도 됩니다'), JSON.stringify(g2Done));
      const g2Link = await evaluate(s.cdp, "[...document.querySelectorAll('[data-testid=links] li')].some((li) => li.textContent.includes('G2 시험 협업자') && li.textContent.includes('참조'))");
      check('G2 D-8 업무 상세의 「연결된 노드」에 협업자가 「참조」로 보임', g2Link === true);
      // 같은 이름 → 연결만(다른 업무), 같은 업무에 또 → 중복 안내
      await g2Select('U-A1/N-002');
      await evaluate(s.cdp, "document.querySelector('[data-testid=collab-quick]').open = true");
      await g2Set('collab-name', 'G2 시험 협업자');
      await g2Set('collab-contact', '무시될 값');
      await clickTestId(s.cdp, 'collab-add');
      await sleep(350);
      const g2Again = await g2Box('[data-testid=collab-done]');
      check('G2 D-8 같은 이름의 사람이 있으면 새로 만들지 않고 연결만(노드 수 그대로, 안내 한 줄)', !!g2Again && g2Again.text.includes('새로 만들지 않고 연결만') && (await evaluate(s.cdp, 'window.__wu.doc.nodes.length')) === g2n0 + 1, JSON.stringify(g2Again));
      await evaluate(s.cdp, "document.querySelector('[data-testid=collab-quick]').open = true");
      await g2Set('collab-name', 'G2 시험 협업자');
      await clickTestId(s.cdp, 'collab-add');
      await sleep(250);
      const g2Dup = await g2Box('[data-testid=collab-msg]');
      check('G2 D-8 이미 이어진 업무에 또 넣으면 「이미 이 업무에 참조로 이어진 사람입니다.」', !!g2Dup && g2Dup.text === '이미 이 업무에 참조로 이어진 사람입니다.', JSON.stringify(g2Dup));

      // D-10 이번 주 기록 (지도 중심 상세)
      await g2Select('U-A1/N-000');
      const g2Wq = await g2Box('[data-testid=weekly-quick]');
      check('G2 D-10 지도 중심 상세에 「이번 주 기록」 한 줄(업무·분류·내용·기록, 크기 있음)', !!g2Wq && g2Wq.w > 0 && g2Wq.h > 0 && !!(await g2Box('[data-testid=weekly-work]')) && !!(await g2Box('[data-testid=weekly-category]')) && !!(await g2Box('[data-testid=weekly-note]')) && !!(await g2Box('[data-testid=weekly-add]')), JSON.stringify(g2Wq));
      const g2Cat = await evaluate(s.cdp, "(() => { const c = document.querySelector('[data-testid=weekly-category]'); return { value: c.value, options: [...c.options].map((o) => o.textContent).join() }; })()");
      check('G2 D-10 분류 목록은 이력 추가와 같은 네 가지, 처음 값은 「진행 중」', g2Cat.options === '이슈,주의사항,진행 중,해결됨' && g2Cat.value === 'in_progress', JSON.stringify(g2Cat));
      const g2eW0 = await evaluate(s.cdp, 'window.__wu.doc.events.length');
      await clickTestId(s.cdp, 'weekly-add');
      await sleep(150);
      const g2Wm1 = await g2Box('[data-testid=weekly-msg]');
      await g2Set('weekly-work', 'N-001');
      await clickTestId(s.cdp, 'weekly-add');
      await sleep(150);
      const g2Wm2 = await g2Box('[data-testid=weekly-msg]');
      check('G2 D-10 업무를 안 고르면 「기록할 업무를 고르세요.」, 내용이 비면 「메모 내용을 입력하세요.」, 저장 안 함', !!g2Wm1 && g2Wm1.text === '기록할 업무를 고르세요.' && !!g2Wm2 && g2Wm2.text === '메모 내용을 입력하세요.' && (await evaluate(s.cdp, 'window.__wu.doc.events.length')) === g2eW0, JSON.stringify([g2Wm1, g2Wm2]));
      const g2eBefore = await evaluate(s.cdp, 'window.__wu.doc.events.length');
      await g2Set('weekly-work', 'N-001');
      await g2Set('weekly-note', '  G2 시험 이번 주 기록  ');
      await shot(s.cdp, `${browser.name}-g2-weekly-quick`);
      await clickTestId(s.cdp, 'weekly-add');
      await sleep(350);
      const g2Memo = (await g2Last(1))[0];
      const g2Wd = await g2Box('[data-testid=weekly-done]');
      check('G2 D-10 「기록」 → 이력 메모 한 건(업무 대사 확인, 분류 진행 중, 오늘 날짜, 앞뒤 공백 없는 내용)', (await evaluate(s.cdp, 'window.__wu.doc.events.length')) === g2eBefore + 1 && g2Memo.type === 'memo' && g2Memo.payload.target_id === 'N-001' && g2Memo.payload.category === 'in_progress' && g2Memo.note === 'G2 시험 이번 주 기록' && g2Memo.occurred_at === (await evaluate(s.cdp, "(() => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; })()")) && !!g2Wd && g2Wd.text.includes('대사 확인'), JSON.stringify([g2Memo, g2Wd]));
      // 개요(아무것도 고르지 않은 화면)에도 같은 입력
      await evaluate(s.cdp, 'window.__wu.select(null)');
      await sleep(250);
      check('G2 D-10 개요(아무것도 고르지 않은 화면)에도 「이번 주 기록」', !!(await g2Box('[data-testid=weekly-quick]')));

      // D-14 이력 목록의 [이슈] 꼬리표 + D-12 이미 끝난 일
      await g2Select('U-A1/N-001');
      const g2Cnt0 = await evaluate(s.cdp, "(() => { const c = document.querySelector('[data-testid=issue-count]'); return c ? c.dataset.count : null; })()");
      const g2Hist = await evaluate(s.cdp, "[...document.querySelectorAll('[data-testid=history] li')].filter((li) => li.querySelector('.chip').textContent === '메모').map((li) => li.querySelector('.text').textContent)");
      check('G2 D-14 업무 이력 목록의 모든 메모 줄이 분류 꼬리표([이슈]·[주의사항]·[진행 중]·[해결됨])로 시작', g2Hist.length > 0 && g2Hist.every((t) => /^\[(이슈|주의사항|진행 중|해결됨)\] /.test(t)) && g2Hist.some((t) => t.startsWith('[이슈] ')), JSON.stringify(g2Hist));
      await clickTestId(s.cdp, 'btn-event');
      await sleep(200);
      const g2Past = await g2Box('[data-testid=event-past-box]');
      check('G2 D-12 이력 추가(메모·분류 이슈)에 「이미 끝난 일(해결됨으로 기록)」 선택 칸(크기 있음)', !!g2Past && g2Past.w > 0 && g2Past.h > 0 && g2Past.text.includes('이미 끝난 일(해결됨으로 기록)'), JSON.stringify(g2Past));
      await g2Set('event-category', 'caution');
      await sleep(100);
      const g2PastHidden = await g2Box('[data-testid=event-past-box]');
      check('G2 D-12 분류를 이슈가 아닌 것으로 바꾸면 그 칸이 숨음', !!g2PastHidden && g2PastHidden.hidden === true && g2PastHidden.w === 0, JSON.stringify(g2PastHidden));
      await g2Set('event-category', 'issue');
      await g2Set('event-date', '2026-09-15');
      await g2Set('event-note', 'G2 시험 지난달 끝난 이슈');
      await evaluate(s.cdp, "document.querySelector('[data-testid=event-past-resolved]').click()");
      await shot(s.cdp, `${browser.name}-g2-past-resolved`);
      const g2e1 = await evaluate(s.cdp, 'window.__wu.doc.events.length');
      await evaluate(s.cdp, "document.querySelector('[data-testid=event-form] button[type=submit]').click()");
      await sleep(350);
      const g2Pair = await g2Last(2);
      const g2Notice = await g2Box('[data-testid=past-resolved-done]');
      check('G2 D-12 켜고 기록 → 이슈 메모와 해결됨 메모(resolves_id = 방금 이슈)가 같은 날짜·같은 기록 시각으로 두 건 늘어남', (await evaluate(s.cdp, 'window.__wu.doc.events.length')) === g2e1 + 2 && g2Pair[0].payload.category === 'issue' && g2Pair[1].payload.category === 'resolved' && g2Pair[1].payload.resolves_id === g2Pair[0].id && g2Pair[0].occurred_at === '2026-09-15' && g2Pair[1].occurred_at === '2026-09-15' && g2Pair[0].recorded_at === g2Pair[1].recorded_at && !!g2Notice, JSON.stringify([g2Pair, g2Notice]));
      const g2Cnt1 = await evaluate(s.cdp, "(() => { const c = document.querySelector('[data-testid=issue-count]'); return c ? c.dataset.count : null; })()");
      // 이력 목록은 최근 것만 보인다: 지난달 날짜 줄은 「모두 보기」를 펼쳐야 보인다
      await evaluate(s.cdp, "(() => { const b = document.querySelector('[data-testid=history-toggle]'); if (b && b.textContent.startsWith('모두 보기')) b.click(); })()");
      await sleep(150);
      const g2Texts = await evaluate(s.cdp, "[...document.querySelectorAll('[data-testid=history] li .text')].map((t) => t.textContent).filter((t) => t.includes('G2 시험 지난달') || t.startsWith('[해결됨] 해결: G2 시험'))");
      check('G2 D-12 이력 목록에 [이슈] 줄과 [해결됨] 줄이 보이고, 업무의 미해결 건수는 그대로', g2Texts.length === 2 && g2Texts[0].startsWith('[이슈] ') && g2Texts[1].startsWith('[해결됨] ') && g2Cnt0 !== null && g2Cnt0 === g2Cnt1, JSON.stringify([g2Cnt0, g2Cnt1, g2Texts]));
      await g2Restore('U-A1');
    } else {
      check('G2 월말 정산 점검(U-A1) 열기', false, 'U-A1이 열리지 않음');
    }
  }

  // ── 일상 사용 G3(CR-18-8, 2026-10-24): D-1 시작 화면 「지난번 지도 이어서 보기」·고친 샘플과 마지막 수정일, D-2 따라 하기는 한 번만, D-3 지난 점검 대비, D-4 점검 요약(복사·내려받기·인쇄),
  //    D-6 유사 경험자 미리 고름, D-7 새로 맡음 표시. 데이터·설정을 바꾸므로 시작 때 저장소를 찍어 두었다가 끝에서 되돌린다("처음 사용 W-A" 블록과 같은 방식). 인쇄 단추는 누르지 않는다(인쇄 창이 점검을 멈춘다) ──
  {
    const g3Snap = await evaluate(s.cdp, 'JSON.stringify(Object.entries(localStorage))');
    // 앞 점검들이 월말 정산 점검(U-A1)을 이미 고쳐 두었다(사람이 한 변경·담당 넘기기 등): 저장소에서 지우고 다시 열면 앱이 깨끗한 샘플을 다시 채운다. 그 상태를 이 블록의 기준으로 쓰고, 끝에서는 g3Snap(원래 상태)으로 되돌린다
    await evaluate(s.cdp, "(() => { localStorage.removeItem('wu:v1:u:U-A1'); location.reload(); })()").catch(() => {});
    await sleep(500);
    await waitFor(s.cdp, 'window.__wu && (window.__wu.start === true || !!window.__wu.doc)', 8000);
    const g3Base = await evaluate(s.cdp, 'JSON.stringify(Object.entries(localStorage))');
    // 설정에서 이 블록이 보는 세 기록(따라 하기 끝낸 것·마지막 연 지도·점검 기준)을 지우고 patch를 얹는다. extra는 같은 자리에서 더 실행할 글
    const g3Mut = (patch = {}, extra = '') => `{ const v = JSON.parse(localStorage.getItem('wu:v1:settings') || '{}'); delete v.tourDone; delete v.lastOpenedId; delete v.riskBaseline; Object.assign(v, ${JSON.stringify(patch)}); localStorage.setItem('wu:v1:settings', JSON.stringify(v)); } ${extra}`;
    // 월말 정산 점검(U-A1)을 「고친 샘플」로 만들고(사람이 한 변경 1건, 기록 시각 2026-10-20), 담당 연결의 시작일을 5일 전으로 바꿔 「새로 맡음」이 되게 한다
    const G3_EDIT = "{ const k = 'wu:v1:u:U-A1'; const d = JSON.parse(localStorage.getItem(k)); const t = new Date(); t.setDate(t.getDate() - 5); const p = (n) => String(n).padStart(2, '0'); const day = t.getFullYear() + '-' + p(t.getMonth() + 1) + '-' + p(t.getDate()); for (const e of d.edges) if (e.core_type === 'performs') e.period = { start: day }; const u = d.events.find((e) => e.type === 'updated'); d.events.push({ ...u, id: 'E-g3-1', source: 'user', recorded_at: '2026-10-20T09:00:00+09:00' }); localStorage.setItem(k, JSON.stringify(d)); }";
    const g3Go = async (hash, mutate = g3Mut(), base = g3Base) => {
      const nav = hash ? `location.hash = ${JSON.stringify(hash)}` : "history.replaceState(null, '', location.pathname + location.search)";
      await evaluate(s.cdp, `(() => { const snap = JSON.parse(${JSON.stringify(base)}); localStorage.clear(); for (const [k, v] of snap) localStorage.setItem(k, v); ${mutate}; ${nav}; location.reload(); })()`).catch(() => {});
      await sleep(500);
      return hash
        ? waitFor(s.cdp, `window.__wu && window.__wu.doc && window.__wu.doc.universe.id === ${JSON.stringify(hash)} && window.__wu.cy.nodes().length > 0`, 8000)
        : waitFor(s.cdp, 'window.__wu && window.__wu.start === true', 8000);
    };
    const g3Settings = () => evaluate(s.cdp, "JSON.parse(localStorage.getItem('wu:v1:settings') || '{}')");
    const g3Q = (sel) => evaluate(s.cdp, `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { text: e.textContent, w: r.width, h: r.height, top: r.top, bottom: r.bottom, value: e.value }; })()`);
    const g3Tour = () => evaluate(s.cdp, 'window.__wu.tour');
    const MINUS = '−';

    // ── D-1: 이어서 보기 ──
    if (await g3Go('', g3Mut({ lastOpenedId: 'U-GONE' }))) {
      check('G3 D-1 마지막으로 연 지도가 없어졌으면(저장된 id가 지도 목록에 없음) 「지난번 지도 이어서 보기」 단추가 없음', (await g3Q('[data-testid=start-resume]')) === null);
    } else check('G3 D-1 시작 화면', false, '시작 화면이 열리지 않음');
    if (await g3Go('', g3Mut())) {
      check('G3 D-1 처음(마지막으로 연 지도 기록 없음)에는 이어서 보기 단추가 없고 안 고친 샘플은 내 업무 지도 목록에 없음', (await g3Q('[data-testid=start-resume]')) === null && (await g3Q('[data-testid=mine-card-U-A1]')) === null);
      // ── D-2: 갈래 a로 따라 하기를 시작해 「건너뛰기」 → 설정에 한 번 했음이 남는다 ──
      await evaluate(s.cdp, "document.querySelector('[data-testid=start-way-handover]').click()");
      await sleep(500);
      const g3Opened = await waitFor(s.cdp, "window.__wu && window.__wu.doc && window.__wu.doc.universe.id === 'U-A1' && window.__wu.cy.nodes().length > 0", 8000);
      const t1 = g3Opened ? await g3Tour() : null;
      check('G3 D-2 처음에는 시작 화면 카드(인수인계)로 들어가면 따라 하기 1/5가 자동으로 뜸', !!t1 && t1.mode === 'step' && t1.scenario === 'handover', JSON.stringify(t1));
      check('G3 D-1 지도를 열면 마지막으로 연 지도 id(U-A1)가 이 브라우저 설정에 남음(지도 문서에는 없음)', (await g3Settings()).lastOpenedId === 'U-A1' && !(await evaluate(s.cdp, "localStorage.getItem('wu:v1:u:U-A1').includes('lastOpenedId')")));
      await clickTestId(s.cdp, 'tour-skip');
      await sleep(200);
      const g3Done = await g3Settings();
      check('G3 D-2 따라 하기를 건너뛰면 설정에 「했음」(tourDone.handover)이 남고, team은 없음(시나리오별)', typeof (g3Done.tourDone || {}).handover === 'string' && !(g3Done.tourDone || {}).team, JSON.stringify(g3Done.tourDone));
      // 시작 화면으로
      await evaluate(s.cdp, "document.getElementById('home').click()").catch(() => {});
      await sleep(500);
      await waitFor(s.cdp, 'window.__wu && window.__wu.start === true', 8000);
      const rs = await g3Q('[data-testid=start-resume]');
      const h2 = await evaluate(s.cdp, "document.querySelector('.start-hero h2').getBoundingClientRect().top");
      check('G3 D-1 다시 오면 맨 위(「무엇을 하고 싶어요?」 위)에 「지난번 지도 이어서 보기: 월말 정산 점검」 단추(크기 있음)', !!rs && rs.text === '지난번 지도 이어서 보기: 월말 정산 점검' && rs.w > 0 && rs.h > 0 && rs.bottom <= h2, JSON.stringify([rs, h2]));
      const mineTxt = await text(s.cdp, '[data-testid=start-mine]');
      check('G3 D-1 내 업무 지도 목록에 마지막으로 연 샘플이 「최근 연 샘플」·「수정한 적 없음」으로 보임(샘플 목록의 카드와 testid가 겹치지 않음)', mineTxt.includes('월말 정산 점검') && mineTxt.includes('최근 연 샘플') && mineTxt.includes('수정한 적 없음') && !!(await g3Q('[data-testid=mine-open-U-A1]')) && (await evaluate(s.cdp, "document.querySelectorAll('[data-testid=open-U-A1]').length")) === 1, mineTxt);
      // 1366×768: 이어서 보기 줄이 있어도 세 갈래 카드 세 장의 아래가 768px 안(CR-16 whyFold와 같은 측정)
      await s.cdp.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
      await sleep(300);
      await evaluate(s.cdp, 'window.scrollTo(0, 0)');
      const g3Fold = await evaluate(s.cdp, "(() => ['start-way-handover', 'start-way-mine', 'start-way-team'].map((id) => { const r = document.querySelector('[data-testid=' + id + ']').getBoundingClientRect(); return { id, bottom: Math.round(r.bottom), w: Math.round(r.width) }; }))()");
      check('G3 D-1 1366×768에서 이어서 보기 줄이 있어도 세 갈래 카드 세 장의 아래가 모두 768px 안(스크롤 없이 첫 화면)', g3Fold.every((c) => c.w > 0 && c.bottom <= 768), JSON.stringify(g3Fold));
      await shot(s.cdp, `${browser.name}-g3-start-resume`);
      await s.cdp.send('Emulation.clearDeviceMetricsOverride');
      await sleep(200);
      // ── D-2: 같은 카드로 다시 들어가면 따라 하기가 자동으로 뜨지 않고 상태 줄에 안내 ──
      await evaluate(s.cdp, "document.querySelector('[data-testid=start-way-handover]').click()");
      await sleep(500);
      await waitFor(s.cdp, "window.__wu && window.__wu.doc && window.__wu.doc.universe.id === 'U-A1' && window.__wu.cy.nodes().length > 0", 8000);
      await sleep(300);
      const t2 = await g3Tour();
      const onceNote = await g3Q('[data-testid=tour-once-note]');
      check('G3 D-2 한 번 건너뛴 시나리오는 같은 카드로 다시 들어가도 따라 하기가 자동으로 뜨지 않고(tour off, 카드 숨김), 주소의 ~tour 표시도 지워짐', !!t2 && t2.mode === 'off' && (await evaluate(s.cdp, "document.querySelector('[data-testid=tour-slot]').hidden")) && !(await evaluate(s.cdp, "location.hash.includes('tour')")), JSON.stringify(t2));
      check('G3 D-2 상태 줄에 「따라 하기는 머리글 「?」 → 「따라 하기 다시 보기」에서 다시 볼 수 있습니다」(크기 있음)', !!onceNote && onceNote.w > 0 && onceNote.h > 0 && onceNote.text === '따라 하기는 머리글 「?」 → 「따라 하기 다시 보기」에서 다시 볼 수 있습니다', JSON.stringify(onceNote));
      await shot(s.cdp, `${browser.name}-g3-tour-once-note`);
      await openTourViaHelp(s.cdp);
      await sleep(300);
      const t3 = await g3Tour();
      check('G3 D-2 머리글 「?」 → 「따라 하기 다시 보기」는 언제든 다시 시작함', !!t3 && t3.mode === 'step' && t3.scenario === 'handover' && t3.index === 0, JSON.stringify(t3));
      // 「?」의 시나리오 고르기(다른 지도에서)로 연 것은 한 번만에 걸리지 않는다: 주소에 ~again이 붙어 열림
      await evaluate(s.cdp, "location.hash = 'U-D1~tour=team~again'; location.reload()").catch(() => {});
      await sleep(600);
      await waitFor(s.cdp, "window.__wu && window.__wu.doc && window.__wu.doc.universe.id === 'U-D1' && window.__wu.cy.nodes().length > 0", 8000);
      await sleep(300);
      const t4 = await g3Tour();
      check('G3 D-2 「?」에서 고른 시나리오(주소 ~again)는 이미 끝낸 기록과 상관없이 시작함 · 주소의 표시는 지워짐', !!t4 && t4.mode === 'step' && t4.scenario === 'team' && !(await evaluate(s.cdp, "location.hash.includes('tour')")), JSON.stringify(t4));
    } else check('G3 D-1·D-2 시작 화면', false, '시작 화면이 열리지 않음');

    // ── D-1: 고친 샘플과 마지막 수정일, 이어서 보기 단추로 열기 ──
    if (await g3Go('', g3Mut({ lastOpenedId: 'U-A1' }, G3_EDIT))) {
      const mineTxt2 = await text(s.cdp, '[data-testid=start-mine]');
      check('G3 D-1 사람이 고친 샘플(월말 정산 점검)이 내 업무 지도 목록에 「고친 샘플」·「마지막 수정 2026-10-20」으로 보임', mineTxt2.includes('고친 샘플') && mineTxt2.includes('마지막 수정 2026-10-20') && !!(await g3Q('[data-testid=mine-card-U-A1]')), mineTxt2);
      await shot(s.cdp, `${browser.name}-g3-start-edited`);
      await clickTestId(s.cdp, 'start-resume');
      await sleep(500);
      check('G3 D-1 「지난번 지도 이어서 보기」를 누르면 그 지도(월말 정산 점검)가 열리고 따라 하기는 시작하지 않음', await waitFor(s.cdp, "window.__wu && window.__wu.doc && window.__wu.doc.universe.id === 'U-A1' && window.__wu.tour && window.__wu.tour.mode === 'off'", 8000));
    } else check('G3 D-1 고친 샘플', false, '시작 화면이 열리지 않음');

    // ── D-3·D-4: 묶은 지도(가상 운영부) 위험 요약의 지난 점검 대비, 인사이트 점검 요약 ──
    if (await g3Go('U-D1', g3Mut())) {
      await sleep(300);
      const c0 = await g3Q('[data-testid=team-risk-compare]');
      check('G3 D-3 저장한 점검이 없으면 위험 요약 아래에 「아직 저장한 점검 없음 — 「이번 점검 저장」을 누르면 다음에 비교합니다」와 저장 단추', !!c0 && c0.text.startsWith('아직 저장한 점검 없음 — 「이번 점검 저장」을 누르면 다음에 비교합니다') && !!(await g3Q('[data-testid=btn-risk-baseline-save]')), JSON.stringify(c0));
      const g3Rw = await g3Q('[data-testid=rewind-grouped-note]');
      check('묶은 지도 개요에는 「편집 되감기」 단추 대신 「편집 되감기: 묶은 지도에서는 쓸 수 없습니다 — 팀·업무 지도를 열어 되감으세요」(크기 있음)', !!g3Rw && g3Rw.w > 0 && g3Rw.text === '편집 되감기: 묶은 지도에서는 쓸 수 없습니다 — 팀·업무 지도를 열어 되감으세요' && (await g3Q('[data-testid=btn-rewind]')) === null, JSON.stringify(g3Rw));
      await clickTestId(s.cdp, 'btn-risk-baseline-save');
      await sleep(300);
      const c1 = await g3Q('[data-testid=team-risk-compare]');
      const st1 = await g3Settings();
      const base1 = (st1.riskBaseline || {})['U-D1'];
      check('G3 D-3 「이번 점검 저장」 → 같은 날은 비교하지 않고 「오늘 저장한 점검 — 다음 점검 날부터 비교합니다」(M1), 기준(숫자·저장 시각)은 설정 riskBaseline[U-D1]에만', !!c1 && c1.text.startsWith('오늘 저장한 점검 — 다음 점검 날부터 비교합니다') && !!base1 && typeof base1.at === 'string' && Number.isInteger(base1.solo), JSON.stringify([c1, base1]));
      check('G3 D-3 점검 기준은 지도 문서·내보내기에 들어가지 않음(문서 저장소 값·내보내기 JSON에 riskBaseline 없음)', !(await evaluate(s.cdp, "Object.entries(localStorage).filter(([k]) => k.startsWith('wu:v1:u:')).some(([, v]) => v.includes('riskBaseline'))")) && !(await evaluate(s.cdp, "JSON.stringify(window.__wu.doc).includes('riskBaseline')")));
      await shot(s.cdp, `${browser.name}-g3-risk-compare`);
      // 기준을 이틀 전에 저장한 「혼자만 아는 일 한 개 적게, 담당 공백 한 개 많게」로 바꿔 다시 열면 +1 / −1(M1: 오늘보다 앞선 날 기준과만 비교)
      await evaluate(s.cdp, "(() => { const v = JSON.parse(localStorage.getItem('wu:v1:settings')); const b = v.riskBaseline['U-D1']; const d = new Date(Date.now() - 2 * 864e5); const day = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); v.riskBaseline['U-D1'] = { ...b, at: day + 'T09:00:00+09:00', asOf: day, solo: b.solo - 1, gaps: b.gaps + 1 }; localStorage.setItem('wu:v1:settings', JSON.stringify(v)); location.reload(); })()").catch(() => {});
      await sleep(600);
      await waitFor(s.cdp, "window.__wu && window.__wu.doc && window.__wu.doc.universe.id === 'U-D1' && window.__wu.cy.nodes().length > 0", 8000);
      await sleep(300);
      const c2 = await g3Q('[data-testid=team-risk-compare]');
      check(`G3 D-3 기준과 다르면 「혼자만 아는 일 +1」·「담당자 빈 일 ${MINUS}1」·「일 몰린 사람 변화 없음」`, !!c2 && c2.text.includes('혼자만 아는 일 +1') && c2.text.includes(`담당자 빈 일 ${MINUS}1`) && c2.text.includes('일 몰린 사람 변화 없음'), JSON.stringify(c2));
      // D-4
      await clickTestId(s.cdp, 'btn-team-risk-more');
      await sleep(400);
      const bar = await g3Q('[data-testid=summary-bar]');
      const order = await evaluate(s.cdp, "(() => { const bar = document.querySelector('[data-testid=summary-bar]'); const tabs = document.querySelector('.insight .tabs'); return bar && tabs ? bar.getBoundingClientRect().top < tabs.getBoundingClientRect().top : null; })()");
      check('G3 D-4 인사이트 창 위쪽(탭보다 위)에 「점검 요약」 줄: 복사·내려받기(.txt)·인쇄 단추와 가상 데이터 안내(크기 있음)', !!bar && bar.w > 0 && bar.h > 0 && order === true && bar.text.includes('점검 요약') && bar.text.includes('복사') && bar.text.includes('내려받기(.txt)') && bar.text.includes('인쇄') && bar.text.includes('모두 가상'), JSON.stringify([bar, order]));
      await shot(s.cdp, `${browser.name}-g3-summary-bar`);
      // 복사: 클립보드를 가짜로 바꿔 보낸 글을 읽는다
      await evaluate(s.cdp, "Object.defineProperty(navigator, 'clipboard', { value: { writeText: (t) => { window.__g3Copied = t; return Promise.resolve(); } }, configurable: true })");
      await clickTestId(s.cdp, 'summary-copy');
      await sleep(250);
      const copied = await evaluate(s.cdp, 'window.__g3Copied || ""');
      const mapName = await evaluate(s.cdp, 'window.__wu.doc.universe.name');
      check('G3 D-4 「복사」: 지도 이름·기준일·세 숫자·지난 점검 대비(+1)·가상 안내가 한 장 글로 복사되고 단추가 「복사했습니다」로 바뀜', copied.startsWith(`점검 요약 — ${mapName}`) && /기준일: \d{4}-\d{2}-\d{2}/.test(copied) && copied.includes('혼자만 아는 일:') && copied.includes('일 몰린 사람:') && copied.includes('담당자 빈 일:') && copied.includes('혼자만 아는 일 +1') && copied.includes('모두 가상') && (await text(s.cdp, '[data-testid=summary-copy]')) === '복사했습니다', copied.slice(0, 200));
      // 클립보드가 거절되면 고른 글 상자
      await evaluate(s.cdp, "Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('blocked')) }, configurable: true })");
      await clickTestId(s.cdp, 'summary-copy');
      await sleep(250);
      const box = await g3Q('[data-testid=summary-copy-box]');
      check('G3 D-4 클립보드가 거절되면 고른 글 상자(summary-copy-box)에 같은 글이 보임', !!box && box.w > 0 && box.h > 0 && box.value === copied, JSON.stringify(box && { w: box.w, h: box.h }));
      await clickTestId(s.cdp, 'summary-download');
      await sleep(300);
      check('G3 D-4 「내려받기(.txt)」: 막힘 안내(summary-download-blocked) 없이 동작', (await g3Q('[data-testid=summary-download-blocked]')) === null);
    } else check('G3 D-3·D-4 가상 운영부', false, '지도가 열리지 않음');

    // ── D-6: 업무를 고른 채 인사이트 → 유사 경험자 탭 ──
    if (await g3Go('U-A1', g3Mut())) {
      await evaluate(s.cdp, "window.__wu.select('U-A1/N-001')");
      await sleep(300);
      await clickTestId(s.cdp, 'btn-insight');
      await sleep(400);
      await clickTestId(s.cdp, 'tab-similar');
      await sleep(300);
      const pickBox = await g3Q('[data-testid=insight-work]');
      check('G3 D-6 업무(대사 확인)를 고른 채 「인사이트 보기」 → 「유사 경험자」 탭에 그 업무가 미리 골라져 있음', !!pickBox && pickBox.value === 'U-A1/N-001', JSON.stringify(pickBox));
      // 아무것도 고르지 않고 열면 예전처럼 「업무를 고르세요」
      await evaluate(s.cdp, "window.__wu.select(null)");
      await sleep(200);
      await clickTestId(s.cdp, 'btn-insight-universe');
      await sleep(400);
      await clickTestId(s.cdp, 'tab-similar');
      await sleep(300);
      check('G3 D-6 업무를 고르지 않고 열면 「유사 경험자」 탭은 비어 있음(업무를 고르세요)', (await g3Q('[data-testid=insight-work]')).value === '');
    } else check('G3 D-6', false, '지도가 열리지 않음');

    // ── D-7: 새로 맡은 「혼자만 아는 일」 표시(담당 연결 시작일을 5일 전으로 바꾼 월말 정산 점검) ──
    if (await g3Go('U-A1', g3Mut({}, G3_EDIT))) {
      await clickTestId(s.cdp, 'btn-insight-universe');
      await sleep(400);
      const marks = await evaluate(s.cdp, "[...document.querySelectorAll('[data-testid=risk-new-owner]')].map((e) => e.textContent)");
      const counts = await text(s.cdp, '[data-testid=risk-concentration-counts]');
      check('G3 D-7 담당 시작이 5일 전인 「혼자만 아는 일」에 「새로 맡음(시작 YYYY-MM-DD) — 인수인계 기록을 남기면 줄어듭니다」가 붙고, 위 숫자(혼자 해 본 업무 2개)는 그대로', marks.length >= 1 && marks.every((m) => /^새로 맡음\(시작 \d{4}-\d{2}-\d{2}\) — 인수인계 기록을 남기면 줄어듭니다$/.test(m)) && counts.includes('혼자 해 본 업무 2개'), JSON.stringify([marks, counts]));
      await shot(s.cdp, `${browser.name}-g3-new-owner`);
    } else check('G3 D-7', false, '지도가 열리지 않음');

    await g3Go('U-A1', '', g3Snap); // 저장소를 블록 시작 때 찍어 둔 상태로 되돌린다
  }

  // ── CR-19 글로 추가(2026-10-24): 월말 정산 점검(U-A1)에서 예시 글 → 「규칙으로 읽기」 → 미리 보기(항목 5·연결 4, 「있는 항목에 연결」·「이미 있음」) → 항목 하나 체크 풀기 → 이름 비운 행은 저장 막힘 → 저장 →
  //    문서가 정확히 그만큼(항목 1·연결 1·이력 2) 늘고 이력의 기록 시각이 하나. 이어서 가짜 Claude 응답(걸러질 행 포함)·실패(시간 초과) 경로와 키 없음 안내. 데이터·설정을 바꾸므로 시작 때 저장소를 찍어 두었다가 끝에서 되돌린다("처음 사용 W-A" 블록과 같은 방식) ──
  {
    const crSnap = await evaluate(s.cdp, 'JSON.stringify(Object.entries(localStorage))');
    const fakeKey = ['sk', 'ant', 'x'.repeat(8), 'FAKEKEY', 'y'.repeat(12)].join('-');
    const CR_TEXT = '서하늘(V-1003)이 대사 확인을 맡는다. 대사 확인이 끝나면 보고를 한다. 보고에서 월말 정산 보고서를 만든다. 감사팀 도하람에게 결과를 공유한다.';
    // 저장소를 시작 때 상태로 되돌리고(clean이면 월말 정산 점검 문서만 깨끗한 샘플로 다시 채움) U-A1을 연다
    const crOpenMap = async (clean) => {
      await evaluate(s.cdp, `(() => { const snap = JSON.parse(${JSON.stringify(crSnap)}); localStorage.clear(); for (const [k, v] of snap) localStorage.setItem(k, v); ${clean ? "localStorage.removeItem('wu:v1:u:U-A1');" : ''} location.hash = 'U-A1'; location.reload(); })()`).catch(() => {});
      await sleep(500);
      return waitFor(s.cdp, "window.__wu && window.__wu.doc && window.__wu.doc.universe.id === 'U-A1' && window.__wu.cy.nodes().length > 0", 8000);
    };
    const crBox = (sel) => evaluate(s.cdp, `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { text: e.textContent, w: r.width, h: r.height, value: e.value, checked: e.checked, disabled: e.disabled, hidden: e.hidden }; })()`);
    const crSet = (testid, value) => evaluate(s.cdp, `(() => { const e = document.querySelector('[data-testid=${testid}]'); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    const crCounts = () => evaluate(s.cdp, '({ nodes: window.__wu.doc.nodes.length, edges: window.__wu.doc.edges.length, events: window.__wu.doc.events.length })');
    const crPreview = () => evaluate(s.cdp, "({ nodes: document.querySelectorAll('[data-testid=text-add-nodes] tbody tr:not(.row-msg-line)').length, edges: document.querySelectorAll('[data-testid=text-add-edges] tbody tr:not(.row-msg-line)').length, nodeStatus: [...document.querySelectorAll('[data-testid^=text-add-node-status-]')].map((e) => e.textContent), edgeStatus: [...document.querySelectorAll('[data-testid^=text-add-edge-status-]')].map((e) => e.textContent) })");
    const crOpenDialog = async () => {
      await evaluate(s.cdp, "window.__wu.select(null); document.querySelector('details.add').open = true");
      await sleep(150);
      await clickTestId(s.cdp, 'btn-text-add');
      await sleep(150);
      return evaluate(s.cdp, "document.getElementById('text-add-dialog').open === true");
    };
    const crCloseDialog = async () => { await evaluate(s.cdp, "document.getElementById('text-add-dialog').open && document.querySelector('[data-testid=text-add-close]').click()"); await sleep(100); };
    const crSettingsOpen = async () => { await evaluate(s.cdp, "document.getElementById('settings-open').click()"); await sleep(150); };
    const crSettingsClose = async () => { await clickTestId(s.cdp, 'settings-close'); await sleep(100); };

    if (await crOpenMap(true)) {
      const c0 = await crCounts();
      // 1) 단추와 대화상자: 「표로 추가」 옆, 크기 있음. 키가 없으니 「Claude로 읽기」 대신 안내 한 줄
      await evaluate(s.cdp, "window.__wu.select(null); document.querySelector('details.add').open = true");
      await sleep(150);
      const crBtn = await crBox('[data-testid=btn-text-add]');
      const crSibling = await evaluate(s.cdp, "(() => { const b = document.querySelector('[data-testid=btn-text-add]'); return !!b && !!b.parentElement.querySelector('[data-testid=btn-table-add]'); })()");
      check('CR-19 「표로 추가」 옆에 「글로 추가」 단추(크기 있음)', !!crBtn && crBtn.text === '글로 추가' && crBtn.w > 20 && crBtn.h > 10 && crSibling, JSON.stringify(crBtn));
      check('CR-19 「글로 추가」를 누르면 대화상자가 열리고 글 상자·「규칙으로 읽기」가 있으며 키가 없으면 「Claude로 읽기」 대신 「「설정」에서 키를 넣으면 Claude가 읽습니다」(R21-5)', (await crOpenDialog()) && !!(await crBox('[data-testid=text-add-input]')) && !!(await crBox('[data-testid=text-add-read]')) && (await crBox('[data-testid=text-add-ai]')) === null && ((await crBox('[data-testid=text-add-ai-note]')) || {}).text === '「설정」에서 키를 넣으면 Claude가 읽습니다');
      // 2) 예시 글을 규칙으로 읽는다
      await crSet('text-add-input', CR_TEXT);
      await clickTestId(s.cdp, 'text-add-read');
      await sleep(200);
      // R19: 기본 처음 체크는 'none' — 아무것도 체크하지 않는다. 지도에 있는 항목에는 「지도에 있음」 표시, 새 항목은 「이름이 맞으면 체크」, 개수는 0개·연결 0개, 저장하면 「넣을 항목이 없습니다」
      const crD0 = await crPreview();
      const crD0Count = await crBox('[data-testid=text-add-count]');
      const crD0Checks = await evaluate(s.cdp, "[...document.querySelectorAll('[data-testid^=text-add-node-check-]')].map((e) => e.checked)");
      // R21-1: 지도에 이미 있는 항목(서하늘·대사 확인·보고)은 체크 칸 없이 「지도에 있는 항목 — 새로 만들지 않고 이어 씁니다」, 체크 칸은 새 항목(3·4번)에만. R21-2: 상태 칸이 「끝 항목」 대신 이름을 말하고 체크할 수 있다
      const crD0Boxes = await evaluate(s.cdp, "({ fixed: document.querySelectorAll('[data-testid^=text-add-node-fixed-]').length, edge2Disabled: document.querySelector('[data-testid=text-add-edge-check-2]').disabled, edge3Disabled: document.querySelector('[data-testid=text-add-edge-check-3]').disabled })");
      check('CR-19 R21 처음 선택(기본 none): 체크 칸은 새 항목 2개에만(전부 해제)이고 지도에 있는 항목 3개는 「지도에 있는 항목 — 새로 만들지 않고 이어 씁니다」, 연결은 「「월말 정산 보고서」를 체크하면 넣을 수 있습니다」·「「도하람」을 체크하면 넣을 수 있습니다」(체크 가능), 요약 「넣을 항목 0개(새로 만듦)·연결 0개」', crD0.nodes === 5 && crD0.edges === 4 && crD0Checks.length === 2 && crD0Checks.every((c) => !c) && crD0Boxes.fixed === 3
        && crD0.nodeStatus.slice(0, 3).every((t) => t === '지도에 있는 항목 — 새로 만들지 않고 이어 씁니다')
        && crD0.nodeStatus[3] === '새로 만듦 — 이름이 맞으면 체크' && crD0.nodeStatus[4] === '새 사람 — 이름이 맞으면 체크'
        && crD0.edgeStatus.join('|') === '이미 있음|이미 있음|「월말 정산 보고서」를 체크하면 넣을 수 있습니다|「도하람」을 체크하면 넣을 수 있습니다' && !crD0Boxes.edge2Disabled && !crD0Boxes.edge3Disabled
        && !!crD0Count && crD0Count.text === '넣을 항목 0개(새로 만듦)·연결 0개', JSON.stringify([crD0, crD0Checks, crD0Boxes, crD0Count]));
      await clickTestId(s.cdp, 'text-add-save');
      await sleep(150);
      const crD0Save = await evaluate(s.cdp, "({ msg: document.querySelector('[data-testid=text-add-message]').textContent, nodes: window.__wu.doc.nodes.length })");
      check('CR-19 R19 아무것도 체크하지 않고 저장하면 「넣을 항목이 없습니다. 항목을 체크하세요.」이고 문서는 그대로', crD0Save.msg === '넣을 항목이 없습니다. 항목을 체크하세요.' && crD0Save.nodes === c0.nodes, JSON.stringify([crD0Save, c0]));
      const crAllBtns = await evaluate(s.cdp, "({ all: !!document.querySelector('[data-testid=text-add-check-all]'), none: !!document.querySelector('[data-testid=text-add-uncheck-all]'), ex: !!document.querySelector('[data-testid=text-add-check-existing]') })");
      check('CR-19 R19·R21 미리 보기 위에 「지도에 있는 항목끼리 연결 체크」·「모두 체크」·「모두 해제」 단추', crAllBtns.all && crAllBtns.none && crAllBtns.ex && ((await crBox('[data-testid=text-add-check-all]')) || {}).text === '모두 체크' && ((await crBox('[data-testid=text-add-uncheck-all]')) || {}).text === '모두 해제' && ((await crBox('[data-testid=text-add-check-existing]')) || {}).text === '지도에 있는 항목끼리 연결 체크', JSON.stringify(crAllBtns));
      await clickTestId(s.cdp, 'text-add-check-existing');
      await sleep(150);
      const crEx = await crPreview();
      const crExCount = await crBox('[data-testid=text-add-count]');
      const crExNote = await crBox('[data-testid=text-add-check-note]');
      check('CR-19 R21-3 「지도에 있는 항목끼리 연결 체크」: 새로 넣을 연결(두 끝이 지도에 있음)이 없으니 새 항목은 체크하지 않고 요약 「넣을 항목 0개(새로 만듦)·연결 0개」, 이유 한 줄 「지도에 있는 두 항목 사이에 새로 넣을 연결이 없습니다」(크기 있음)', !!crExCount && crExCount.text === '넣을 항목 0개(새로 만듦)·연결 0개' && crEx.nodeStatus[3] === '새로 만듦 — 이름이 맞으면 체크' && !!crExNote && crExNote.text === '지도에 있는 두 항목 사이에 새로 넣을 연결이 없습니다' && crExNote.w > 20 && crExNote.h > 10, JSON.stringify([crEx, crExCount, crExNote]));
      await clickTestId(s.cdp, 'text-add-check-all'); // 예전 흐름: 모두 체크 뒤에 아래 검사를 이어 간다
      await sleep(150);
      const crP = await crPreview();
      check('CR-19 규칙으로 읽기 → 모두 체크 → 미리 보기: 항목 5개·연결 4개, 기존 이름·사번은 「지도에 있는 항목」(서하늘·대사 확인·보고, 체크 칸 없음), 새 항목 2개(도하람은 확인 필요), 이미 있는 연결 2개는 「이미 있음」', crP.nodes === 5 && crP.edges === 4
        && crP.nodeStatus.slice(0, 3).every((t) => t === '지도에 있는 항목 — 새로 만들지 않고 이어 씁니다') && crP.nodeStatus[3] === '새로 만듦' && crP.nodeStatus[4].startsWith('새로 만듦 · 확인 필요')
        && crP.edgeStatus.join('|') === '이미 있음|이미 있음|새 연결|새 연결', JSON.stringify(crP));
      const crCount = await crBox('[data-testid=text-add-count]');
      check('CR-19 미리 보기 아래 요약 한 줄 「넣을 항목 2개(새로 만듦)·연결 2개 · 지도 항목 1개 이어 씀」(R21-1: 지도에 있는 항목은 넣을 항목에 세지 않고 연결이 닿는 것만 「이어 씀」), 읽은 방식 「규칙으로 읽었습니다.」, 읽지 못한 문장 없음', !!crCount && crCount.text === '넣을 항목 2개(새로 만듦)·연결 2개 · 지도 항목 1개 이어 씀' && ((await crBox('[data-testid=text-add-method]')) || {}).text === '규칙으로 읽었습니다.' && (await crBox('[data-testid=text-add-unread]')) === null, JSON.stringify(crCount));
      await shot(s.cdp, `${browser.name}-cr19-text-preview`);
      // 3) 관계 고르기는 두 항목 유형에 쓸 수 있는 것만
      const crRel = await evaluate(s.cdp, "[...document.querySelector('[data-testid=text-add-edge-type-2]').options].map((o) => o.value)");
      check('CR-19 연결 「보고 → 월말 정산 보고서」의 관계 고르기에는 업무 → 산출물에 쓸 수 있는 관계만(산출 포함, 수행·선후행 없음)', crRel.includes('produces') && !crRel.includes('performs') && !crRel.includes('precedes') && (await crBox('[data-testid=text-add-edge-type-2]')).value === 'produces', JSON.stringify(crRel));
      // 4) 항목 하나(도하람)의 체크를 풀면 그 항목을 쓰는 연결도 넣을 수 없게 된다
      await clickTestId(s.cdp, 'text-add-node-check-4');
      await sleep(150);
      const crOff = await evaluate(s.cdp, "({ status: document.querySelector('[data-testid=text-add-node-status-4]').textContent, edge: document.querySelector('[data-testid=text-add-edge-status-3]').textContent, edgeDisabled: document.querySelector('[data-testid=text-add-edge-check-3]').disabled, edgeChecked: document.querySelector('[data-testid=text-add-edge-check-3]').checked, count: document.querySelector('[data-testid=text-add-count]').textContent })");
      check('CR-19 R21-2 도하람 체크를 풀면 「새 사람 — 이름이 맞으면 체크」, 그 항목의 연결은 체크가 풀리고 「「도하람」을 체크하면 넣을 수 있습니다」(체크 가능), 요약이 항목 1·연결 1로', crOff.status === '새 사람 — 이름이 맞으면 체크' && crOff.edge === '「도하람」을 체크하면 넣을 수 있습니다' && !crOff.edgeDisabled && !crOff.edgeChecked && crOff.count === '넣을 항목 1개(새로 만듦)·연결 1개 · 지도 항목 1개 이어 씀', JSON.stringify(crOff));
      // R21-2: 풀린 연결을 체크하면 새 끝 항목(도하람)도 함께 체크된다. 이어지는 확인을 위해 다시 도하람을 푼다
      await clickTestId(s.cdp, 'text-add-edge-check-3');
      await sleep(150);
      const crAuto = await evaluate(s.cdp, "({ node: document.querySelector('[data-testid=text-add-node-check-4]').checked, edge: document.querySelector('[data-testid=text-add-edge-check-3]').checked, status: document.querySelector('[data-testid=text-add-edge-status-3]').textContent, count: document.querySelector('[data-testid=text-add-count]').textContent })");
      check('CR-19 R21-2 연결을 체크하면 그 연결의 새 끝 항목(도하람)도 함께 체크되고 상태 칸이 「새 연결」, 요약 「넣을 항목 2개(새로 만듦)·연결 2개 · 지도 항목 1개 이어 씀」', crAuto.node && crAuto.edge && crAuto.status === '새 연결' && crAuto.count === '넣을 항목 2개(새로 만듦)·연결 2개 · 지도 항목 1개 이어 씀', JSON.stringify(crAuto));
      await clickTestId(s.cdp, 'text-add-node-check-4');
      await sleep(150);
      // 5) 이름을 비운 행은 저장이 막힌다(아무것도 저장하지 않고 그 행에 이유)
      await crSet('text-add-node-label-3', '');
      await clickTestId(s.cdp, 'text-add-save');
      await sleep(200);
      const crErr = await evaluate(s.cdp, "({ msg: document.querySelector('[data-testid=text-add-message]').textContent, row: document.querySelector('[data-testid=text-add-node-msg-3]').textContent, rowHidden: document.querySelector('[data-testid=text-add-node-msg-3]').closest('tr').hidden, done: document.querySelector('[data-testid=text-add-done]').hidden })");
      const crC1 = await crCounts();
      check('CR-19 이름을 비운 행이 있으면 저장이 막힘: 문서가 그대로(항목·연결·이력 수 같음)이고 「아무것도 저장하지 않았습니다」와 그 행의 이유가 보임', JSON.stringify(crC1) === JSON.stringify(c0) && crErr.msg.includes('아무것도 저장하지 않았습니다') && crErr.row.includes('이름') && !crErr.rowHidden && crErr.done, JSON.stringify([crC1, crErr]));
      // 6) 이름을 되돌리고 저장 → 정확히 항목 1·연결 1(이력 2)만 늘고 기록 시각이 하나
      await crSet('text-add-node-label-3', '월말 정산 보고서');
      await clickTestId(s.cdp, 'text-add-save');
      await sleep(300);
      const crC2 = await crCounts();
      const crSaved = await evaluate(s.cdp, `(() => { const d = window.__wu.doc; const news = d.events.slice(${c0.events}); const art = d.nodes.find((n) => n.label === '월말 정산 보고서'); const bogo = d.nodes.find((n) => n.label === '보고'); return { done: document.querySelector('[data-testid=text-add-done]').textContent, doneHidden: document.querySelector('[data-testid=text-add-done]').hidden, art: art ? art.core_type : null, produces: !!art && d.edges.some((e) => e.core_type === 'produces' && e.source === bogo.id && e.target === art.id), doha: d.nodes.some((n) => n.label === '도하람'), stamps: [...new Set(news.map((e) => e.recorded_at))].length, types: news.map((e) => e.type).join(), save: document.querySelector('[data-testid=text-add-save]').disabled, add: (document.querySelector('[data-testid=add-done]') || {}).textContent || '' }; })()`);
      check('CR-19 저장 → 문서가 정확히 그만큼만 늘고(항목 +1·연결 +1·이력 +2, 도하람은 없음) 이력 기록 시각이 하나이며 「항목 1개·연결 1개를 넣었습니다」', crC2.nodes === c0.nodes + 1 && crC2.edges === c0.edges + 1 && crC2.events === c0.events + 2 && crSaved.art === 'artifact' && crSaved.produces && !crSaved.doha && crSaved.stamps === 1 && crSaved.types === 'created,created'
        && crSaved.done === '항목 1개·연결 1개를 넣었습니다' && !crSaved.doneHidden && crSaved.save && crSaved.add === '항목 1개·연결 1개를 넣었습니다', JSON.stringify([c0, crC2, crSaved]));
      await shot(s.cdp, `${browser.name}-cr19-text-done`);
      // R21-3·4: 읽지 못한 문장이 있는 글 — 목록은 맥락 안내 바로 아래·표 위, 문장마다 이유. 「지도에 있는 항목끼리 연결 체크」는 맥락 규칙으로 뺀 연결 수와 이유를 단추 아래에 보인다. 사람이 만든 산출물 문장은 쓰는 법을 알려 준다
      await crSet('text-add-input', '변경 전:\n서하늘이 자료 수집을 맡는다. 한가람이 정산 요약표를 만든다.');
      await clickTestId(s.cdp, 'text-add-read');
      await sleep(200);
      const crCtx = await evaluate(s.cdp, "(() => { const q = (t) => document.querySelector('[data-testid=' + t + ']'); const note = q('text-add-context-note'); const un = q('text-add-unread'); const nodes = q('text-add-nodes'); const kids = [...q('text-add-preview').children]; return { hasNote: !!note, hasUnread: !!un, rightBelow: !!note && !!un && kids.indexOf(un) === kids.indexOf(note) + 1, aboveTable: !!un && !!nodes && !!(un.compareDocumentPosition(nodes) & Node.DOCUMENT_POSITION_FOLLOWING), whys: [...document.querySelectorAll('[data-testid^=text-add-unread-why-]')].map((e) => e.textContent) }; })()");
      check('CR-19 R21-4 읽지 못한 문장 목록이 맥락 안내 바로 아래·항목 표 위에 있고, 문장마다 이유가 붙는다(「변경 전:」은 모양 밖, 사람이 만든 산출물은 「사람이 만든 산출물은 이을 수 없습니다 — 「업무 이름에서 정산 요약표를 만든다」처럼 업무를 넣어 쓰세요」)', crCtx.hasNote && crCtx.hasUnread && crCtx.rightBelow && crCtx.aboveTable && crCtx.whys.length === 2
        && crCtx.whys.some((t) => t.includes('사람이 만든 산출물은 이을 수 없습니다 — 「업무 이름에서 정산 요약표를 만든다」처럼 업무를 넣어 쓰세요')), JSON.stringify(crCtx));
      await clickTestId(s.cdp, 'text-add-check-existing');
      await sleep(150);
      const crHeld = await crBox('[data-testid=text-add-check-note]');
      const crHeldCount = await crBox('[data-testid=text-add-count]');
      check('CR-19 R21-3 읽지 못한 문장이 있으면 「지도에 있는 항목끼리 연결 체크」가 연결 1개를 체크하지 않고 단추 아래에 「읽지 못한 문장이 있어 연결 1개는 체크하지 않았습니다 — 위의 읽지 못한 문장을 확인한 뒤 직접 체크하세요」(크기 있음), 요약은 연결 0개', !!crHeld && crHeld.text === '읽지 못한 문장이 있어 연결 1개는 체크하지 않았습니다 — 위의 읽지 못한 문장을 확인한 뒤 직접 체크하세요' && crHeld.w > 20 && crHeld.h > 10 && !!crHeldCount && crHeldCount.text === '넣을 항목 0개(새로 만듦)·연결 0개', JSON.stringify([crHeld, crHeldCount]));
      await shot(s.cdp, `${browser.name}-cr19-text-unread`);
      await crCloseDialog();
      check('CR-19 저장한 새 산출물이 그래프에 바로 나타남', await hasLabel(s.cdp, '월말 정산 보고서'));
      // R16-17 편집 되감기 중(읽기 전용)에는 「글로 추가」 단추가 없고 읽기 전용 안내만 보인다. 지금으로 돌아오면 다시 생긴다
      await evaluate(s.cdp, 'window.__wu.select(null)');
      await sleep(150);
      const crRwOn = await evaluate(s.cdp, "(() => { const b = document.querySelector('[data-testid=btn-rewind]'); return !!b && !b.disabled; })()");
      let crRw = null;
      if (crRwOn) {
        await clickTestId(s.cdp, 'btn-rewind');
        await sleep(500);
        crRw = await evaluate(s.cdp, "({ rw: !!window.__wu.rewind, btn: !!document.querySelector('[data-testid=btn-text-add]'), add: document.getElementById('add-slot').textContent })");
        await clickTestId(s.cdp, 'btn-rewind-back');
        await sleep(400);
      }
      check('CR-19 R16-17 편집 되감기 중에는 「글로 추가」 단추가 없고(읽기 전용 안내), 지금으로 돌아오면 다시 생김', crRwOn && !!crRw && crRw.rw && !crRw.btn && crRw.add.includes('읽기 전용') && !!(await crBox('[data-testid=btn-text-add]')), JSON.stringify([crRwOn, crRw]));

      // 7) 키를 넣고 가짜 Claude 응답: 단추가 생기고, 걸러질 행(지어낸 업무·인용이 틀린 항목·유형 조합이 틀린 연결·끝 항목이 없는 연결)은 뺀다
      await crSettingsOpen();
      await evaluate(s.cdp, "(() => { const r = document.querySelector('[data-testid=provider-claude_api]'); r.checked = true; r.dispatchEvent(new Event('change')); })()");
      await sleep(100);
      await evaluate(s.cdp, `(() => { const e = document.querySelector('[data-testid=settings-apikey]'); e.value = ${JSON.stringify(fakeKey)}; e.dispatchEvent(new Event('input')); e.dispatchEvent(new Event('change')); })()`);
      await sleep(100);
      await crSettingsClose();
      await evaluate(s.cdp, "window.__wu.useFakeLlm('extract')");
      await crOpenDialog();
      const crAi = await crBox('[data-testid=text-add-ai]');
      check('CR-19 키가 있으면 「Claude로 읽기」 단추가 보이고(크기 있음) 안내 한 줄은 없음', !!crAi && crAi.text === 'Claude로 읽기' && crAi.w > 20 && crAi.h > 10 && (await crBox('[data-testid=text-add-ai-note]')) === null, JSON.stringify(crAi));
      await evaluate(s.cdp, 'window.__wu.fakeLlm.delayMs = 500');
      await crSet('text-add-input', CR_TEXT);
      await clickTestId(s.cdp, 'text-add-ai');
      await sleep(150);
      const crBusy = await evaluate(s.cdp, "({ text: document.querySelector('[data-testid=text-add-busy]').textContent, disabled: document.querySelector('[data-testid=text-add-ai]').disabled })");
      check('CR-19 Claude로 읽는 동안 「Claude가 읽는 중… (최대 60초)」가 보이고 단추가 잠김', crBusy.text === 'Claude가 읽는 중… (최대 60초)' && crBusy.disabled, JSON.stringify(crBusy));
      await waitFor(s.cdp, "!!document.querySelector('[data-testid=text-add-method]')", 5000);
      const crAiP = await crPreview();
      const crAiInfo = await evaluate(s.cdp, "({ method: document.querySelector('[data-testid=text-add-method]').textContent, note: (document.querySelector('[data-testid=text-add-note]') || {}).textContent || '', fallback: !!document.querySelector('[data-testid=text-add-fallback]'), calls: window.__wu.fakeLlm.calls.length, sent: window.__wu.fakeLlm.calls[0].messages[0].content })");
      check('CR-19 Claude 읽기: 방식 「Claude가 읽었습니다(모델)」, 항목 5·연결 4(이미 저장한 월말 정산 보고서는 「있는 항목」), 걸러진 4개 행 안내, 실패 안내 없음', crAiP.nodes === 5 && crAiP.edges === 4 && crAiInfo.method.startsWith('Claude가 읽었습니다(claude-opus-5-5)') && crAiP.nodeStatus[3] === '지도에 있는 항목 — 새로 만들지 않고 이어 씁니다' && crAiInfo.note.includes('4개 행은 원문 인용이 확인되지 않거나 규칙에 맞지 않아 뺐습니다') && !crAiInfo.fallback && crAiInfo.calls === 1, JSON.stringify([crAiP, crAiInfo.method, crAiInfo.note]));
      check('CR-19 Claude에 보내는 것은 붙여 넣은 글과 지금 지도의 항목 이름·유형뿐(설명·사번 없음)', crAiInfo.sent.includes(CR_TEXT) && crAiInfo.sent.includes('- 사람: 한가람') && !crAiInfo.sent.includes('원천 자료와 대조해') && !crAiInfo.sent.includes('V-1001') && !crAiInfo.sent.includes('내선'), crAiInfo.sent.slice(0, 200));
      // 8) 실패(시간 초과): 규칙으로 읽은 결과 + 「AI 읽기 실패: … — 규칙으로 읽은 결과를 보여 줍니다」
      await evaluate(s.cdp, "window.__wu.fakeLlm.mode = 'timeout'; window.__wu.fakeLlm.delayMs = 100");
      await crSet('text-add-input', `${CR_TEXT}
`); // 글을 조금 달리해 같은 글의 메모리 캐시(성공 응답)를 피한다
      await clickTestId(s.cdp, 'text-add-ai');
      await waitFor(s.cdp, "!!document.querySelector('[data-testid=text-add-fallback]')", 5000);
      const crFail = await evaluate(s.cdp, "({ fb: document.querySelector('[data-testid=text-add-fallback]').textContent, method: document.querySelector('[data-testid=text-add-method]').textContent, nodes: document.querySelectorAll('[data-testid=text-add-nodes] tbody tr:not(.row-msg-line)').length })");
      check('CR-19 Claude 읽기가 실패(시간 초과)하면 「AI 읽기 실패: 연결 실패·시간 초과 — 규칙으로 읽은 결과를 보여 줍니다」 + 규칙으로 읽은 미리 보기(항목 5)', crFail.fb === 'AI 읽기 실패: 연결 실패·시간 초과 — 규칙으로 읽은 결과를 보여 줍니다' && crFail.method === '규칙으로 읽었습니다.' && crFail.nodes === 5, JSON.stringify(crFail));
      await shot(s.cdp, `${browser.name}-cr19-text-ai-fallback`);
      // 9) 기다리는 동안 창을 닫으면 응답은 버려진다(오류 없음)
      await evaluate(s.cdp, "window.__wu.fakeLlm.mode = 'extract'; window.__wu.fakeLlm.delayMs = 500; window.__crErr = []; window.addEventListener('error', (e) => window.__crErr.push(String(e.message))); window.addEventListener('unhandledrejection', (e) => window.__crErr.push(String(e.reason)))");
      await clickTestId(s.cdp, 'text-add-ai');
      await sleep(100);
      await crCloseDialog();
      await sleep(700);
      await crOpenDialog();
      check('CR-19 응답을 기다리다 창을 닫으면 응답이 버려지고 다시 열면 미리 보기가 비어 있음(오류 없음)', (await crBox('[data-testid=text-add-nodes]')) === null && (await crBox('[data-testid=text-add-fallback]')) === null && (await evaluate(s.cdp, 'window.__crErr.length')) === 0);
      await crCloseDialog();
      // 10) 키 지우기 → 단추가 사라지고 안내 한 줄
      await crSettingsOpen();
      await clickTestId(s.cdp, 'settings-clear-key');
      await sleep(100);
      await crSettingsClose();
      await crOpenDialog();
      check('CR-19 키를 지우면 「Claude로 읽기」가 사라지고 「「설정」에서 키를 넣으면 Claude가 읽습니다」 한 줄(R21-5)', (await crBox('[data-testid=text-add-ai]')) === null && ((await crBox('[data-testid=text-add-ai-note]')) || {}).text === '「설정」에서 키를 넣으면 Claude가 읽습니다');
      await crCloseDialog();
      // 도움말 「키와 데이터」 한 줄
      await evaluate(s.cdp, "document.querySelector('[data-testid=tour-open]').click()");
      await sleep(150);
      await evaluate(s.cdp, "document.querySelector('[data-testid=help-security]').open = true");
      const crHelp = await text(s.cdp, '[data-testid=help-security]');
      check('CR-19 도움말 「키와 데이터」에 「「Claude로 읽기」는 붙여 넣은 글과 지금 지도의 항목 이름·유형 목록만 보냅니다」', crHelp.includes('「Claude로 읽기」는 붙여 넣은 글과 지금 지도의 항목 이름·유형 목록만 보냅니다'));
      await evaluate(s.cdp, "document.querySelector('[data-testid=help-close]').click()");
      await sleep(100);
      // 11) R16-11·R16-17 묶은 지도(가상 운영부 U-D1)에서는 「글로 추가」 단추 대신 「팀·업무 지도를 열어 넣으세요」 안내 한 줄
      await evaluate(s.cdp, "location.hash = 'U-D1'; location.reload()").catch(() => {});
      await sleep(500);
      const crDept = await waitFor(s.cdp, "window.__wu && window.__wu.doc && window.__wu.doc.universe.id === 'U-D1' && window.__wu.cy.nodes().length > 0", 8000);
      await evaluate(s.cdp, "window.__wu.select(null); document.querySelector('details.add').open = true");
      await sleep(150);
      const crGroupNote = await crBox('[data-testid=text-add-grouped-note]');
      check('CR-19 R16-11 묶은 지도(가상 운영부 U-D1)에서는 「글로 추가」 단추가 없고 「팀·업무 지도를 열어 넣으세요」 안내 한 줄(크기 있음)', crDept && (await crBox('[data-testid=btn-text-add]')) === null && !!crGroupNote && crGroupNote.text.includes('팀·업무 지도를 열어 넣으세요') && crGroupNote.w > 20 && crGroupNote.h > 10, JSON.stringify(crGroupNote));
    } else check('CR-19 월말 정산 점검(U-A1)이 열림', false);
    await crOpenMap(false); // 저장소를 블록 시작 때 찍어 둔 상태로 되돌린다
  }

  // ── 처음 사용 5회차(FU5, 2026-10-25, CR-18 범위 안 보완): A 매주 점검(바뀐 것 보기·저장 알림·점검 요약 미리 보기/내려받기 알림·점검 저장한 지도·유사 경험자 안내) + B 화면(전체 보기가 흐림을 풂·담당 넘긴 날 표시·
  //    오류 줄 지우기·「연두색 큰 동그라미」·실패 흉내는 ?check에서만). 못 쓰는 관계는 고를 수 없음(FU5-9)은 연결 추가/수정·함께 잇기 점검 곳곳에서 고쳐 확인하고, 되감기 배치 되돌림(FU5-7)은 바로 아래 CR-14 A 블록 안에 있다.
  //    데이터·설정을 바꾸므로 시작 때 저장소를 찍어 두었다가 끝에서 되돌린다("일상 사용 G3" 블록과 같은 방식) ──
  {
    const fu5Snap = await evaluate(s.cdp, 'JSON.stringify(Object.entries(localStorage))');
    // 앞 점검들이 월말 정산 점검(U-A1)을 고쳐 두었을 수 있다: 저장소에서 지우고 다시 열면 앱이 깨끗한 샘플을 다시 채운다. 그 상태를 이 블록의 기준으로 쓴다
    await evaluate(s.cdp, "(() => { localStorage.removeItem('wu:v1:u:U-A1'); location.reload(); })()").catch(() => {});
    await sleep(500);
    await waitFor(s.cdp, 'window.__wu && (window.__wu.start === true || !!window.__wu.doc)', 8000);
    const fu5Base = await evaluate(s.cdp, 'JSON.stringify(Object.entries(localStorage))');
    const fu5Mut = (patch = {}, extra = '') => `{ const v = JSON.parse(localStorage.getItem('wu:v1:settings') || '{}'); delete v.tourDone; delete v.lastOpenedId; delete v.riskBaseline; Object.assign(v, ${JSON.stringify(patch)}); localStorage.setItem('wu:v1:settings', JSON.stringify(v)); } ${extra}`;
    const fu5Go = async (hash, mutate = fu5Mut(), base = fu5Base) => {
      const nav = hash ? `location.hash = ${JSON.stringify(hash)}` : "history.replaceState(null, '', location.pathname + location.search)";
      await evaluate(s.cdp, `(() => { const snap = JSON.parse(${JSON.stringify(base)}); localStorage.clear(); for (const [k, v] of snap) localStorage.setItem(k, v); ${mutate}; ${nav}; location.reload(); })()`).catch(() => {});
      await sleep(500);
      return hash
        ? waitFor(s.cdp, `window.__wu && window.__wu.doc && window.__wu.doc.universe.id === ${JSON.stringify(hash)} && window.__wu.cy.nodes().length > 0`, 8000)
        : waitFor(s.cdp, 'window.__wu && window.__wu.start === true', 8000);
    };
    const fu5Q = (sel) => evaluate(s.cdp, `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { text: e.textContent, w: r.width, h: r.height, open: e.open }; })()`);
    const fu5Settings = () => evaluate(s.cdp, "JSON.parse(localStorage.getItem('wu:v1:settings') || '{}')");
    const fu5Reload = async (id) => {
      await evaluate(s.cdp, 'location.reload()').catch(() => {});
      await sleep(600);
      await waitFor(s.cdp, `window.__wu && window.__wu.doc && window.__wu.doc.universe.id === ${JSON.stringify(id)} && window.__wu.cy.nodes().length > 0`, 8000);
      await sleep(300);
    };

    // ── A1·A2: 묶은 지도(가상 운영부)에서 「이번 점검 저장」 → 알림 한 줄, 기준에 이름 목록이 남고, 이름이 바뀌면 「바뀐 것 보기」 ──
    if (await fu5Go('U-D1')) {
      await sleep(300);
      await clickTestId(s.cdp, 'btn-risk-baseline-save');
      await sleep(300);
      const note = await fu5Q('[data-testid=risk-baseline-saved]');
      check('FU5-2 「이번 점검 저장」을 누르면 「이번 점검을 저장했습니다(날짜) — 다음 점검 날부터 이 숫자와 비교합니다」 알림 한 줄이 보임(크기 있음, M1)', !!note && /^이번 점검을 저장했습니다\(\d{4}-\d{2}-\d{2}\) — 다음 점검 날부터 이 숫자와 비교합니다$/.test(note.text) && note.w > 0 && note.h > 0, JSON.stringify(note));
      const st = await fu5Settings();
      const b = (st.riskBaseline || {})['U-D1'];
      check('FU5-1 점검 기준에 세 목록(혼자만 아는 일·일 몰린 사람·담당자 빈 일)의 이름이 함께 저장되고(이 브라우저 설정에만), 목록당 30개 이하', !!b && !!b.names && ['solo', 'dense', 'gaps'].every((k) => Array.isArray(b.names[k]) && b.names[k].length <= 30) && !(await evaluate(s.cdp, "Object.entries(localStorage).filter(([k]) => k.startsWith('wu:v1:u:')).some(([, v]) => v.includes('riskBaseline'))")), JSON.stringify(b));
      check('FU5-1 방금 저장했으면 바뀐 것이 없어 「바뀐 것 보기」 상자가 없음', (await fu5Q('[data-testid=team-risk-changes]')) === null);
      await shot(s.cdp, `${browser.name}-fu5-risk-saved`);
      // 다른 항목을 고른 뒤 개요로 돌아오면 알림은 사라진다
      await evaluate(s.cdp, "(() => { const w = window.__wu.cy.nodes().filter((n) => n.data('core_type') === 'work')[0]; window.__wu.select(w.id()); window.__wu.select(null); })()");
      await sleep(250);
      check('FU5-2 다른 항목을 고른 뒤 개요로 돌아오면 저장 알림은 사라지고 비교 줄만 남음', (await fu5Q('[data-testid=risk-baseline-saved]')) === null && !!(await fu5Q('[data-testid=team-risk-compare]')));
      // 저장해 둔 이름을 바꿔(첫 번째 비어 있지 않은 목록에서 하나 빼고, 담당자 빈 일에 없는 이름을 더해) 이틀 전 기준으로 옮겨 다시 열면 늘어남·줄어듦(M1: 같은 날 기준과는 비교하지 않음)
      const removed = await evaluate(s.cdp, "(() => { const v = JSON.parse(localStorage.getItem('wu:v1:settings')); const b = v.riskBaseline['U-D1']; const d = new Date(Date.now() - 2 * 864e5); const day = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); b.at = day + 'T09:00:00+09:00'; b.asOf = day; const k = ['solo', 'dense', 'gaps'].find((x) => b.names[x].length > 0); const gone = k ? b.names[k].shift() : null; b.names.gaps.push('시험용 사라진 업무'); localStorage.setItem('wu:v1:settings', JSON.stringify(v)); return { key: k, gone }; })()");
      await fu5Reload('U-D1');
      const box = await fu5Q('[data-testid=team-risk-changes]');
      check('FU5-1 이름이 바뀌었으면 비교 줄 아래에 접힌 「바뀐 것 보기」 상자(크기 있음, 기본 접힘)', !!box && box.w > 0 && box.h > 0 && box.open === false && box.text.startsWith('바뀐 것 보기'), JSON.stringify([box, removed]));
      await evaluate(s.cdp, "document.querySelector('[data-testid=team-risk-changes]').open = true");
      await sleep(150);
      const chg = await evaluate(s.cdp, "({ added: [...document.querySelectorAll('[data-testid=risk-change-added]')].map((e) => e.textContent), removed: [...document.querySelectorAll('[data-testid=risk-change-removed]')].map((e) => e.textContent), vis: document.querySelector('[data-testid=risk-change]').getBoundingClientRect().height > 0 })");
      check('FU5-1 펼치면 「늘어남: …」(저장 뒤 새로 생긴 것)과 「줄어듦: 「시험용 사라진 업무」」(저장 뒤 사라진 것)가 이름으로 보임', chg.vis && chg.added.some((x) => x.startsWith('늘어남: ') && x.includes(`「${removed.gone}」`)) && chg.removed.some((x) => x === '줄어듦: 「시험용 사라진 업무」'), JSON.stringify([chg, removed]));
      await shot(s.cdp, `${browser.name}-fu5-risk-changes`);
      // 예전 기준(이름 목록 없음)은 숫자만, 깨지지 않음
      await evaluate(s.cdp, "(() => { const v = JSON.parse(localStorage.getItem('wu:v1:settings')); delete v.riskBaseline['U-D1'].names; localStorage.setItem('wu:v1:settings', JSON.stringify(v)); })()");
      await fu5Reload('U-D1');
      const oldCmp = await fu5Q('[data-testid=team-risk-compare]');
      check('FU5-1 예전 기준(이름 목록 없음)이면 숫자 비교만 보이고 「바뀐 것 보기」 상자는 없음', !!oldCmp && /^지난 점검\(\d{4}-\d{2}-\d{2}\) 대비: /.test(oldCmp.text) && (await fu5Q('[data-testid=team-risk-changes]')) === null);
      // 깨진 이름 목록은 걸러 내고 숫자는 남는다
      await evaluate(s.cdp, "(() => { const v = JSON.parse(localStorage.getItem('wu:v1:settings')); v.riskBaseline['U-D1'].names = { solo: 'x', dense: [1, null], gaps: { a: 1 } }; localStorage.setItem('wu:v1:settings', JSON.stringify(v)); })()");
      await fu5Reload('U-D1');
      check('FU5-1 깨진 이름 목록은 걸러 내고(화면이 깨지지 않음) 비교 줄은 그대로 보임', !!(await fu5Q('[data-testid=team-risk-compare]')) && (await fu5Q('[data-testid=team-risk-changes]')) === null);

      // ── A3·A5: 점검 요약 미리 보기·내려받기 알림, 유사 경험자 안내 ──
      await clickTestId(s.cdp, 'btn-team-risk-more');
      await sleep(400);
      const pv0 = await fu5Q('[data-testid=summary-preview]');
      check('FU5-3 점검 요약 줄에 접힌 「미리 보기」(크기 있음, 기본 접힘)', !!pv0 && pv0.w > 0 && pv0.h > 0 && pv0.open === false && pv0.text.startsWith('미리 보기'), JSON.stringify(pv0));
      await evaluate(s.cdp, "document.querySelector('[data-testid=summary-preview]').open = true");
      await sleep(250);
      const pv1 = await fu5Q('[data-testid=summary-preview-text]');
      check('FU5-3 펼치면 복사·내려받기될 글 그대로(「점검 요약 — 지도 이름」으로 시작, 기준일·세 숫자·가상 데이터 안내)가 보임', !!pv1 && pv1.h > 0 && /^점검 요약 — /.test(pv1.text) && pv1.text.includes('혼자만 아는 일') && pv1.text.includes('기준일:') && pv1.text.includes('모두 가상'), JSON.stringify(pv1 && pv1.text.slice(0, 120)));
      await clickTestId(s.cdp, 'summary-download');
      await sleep(300);
      const dl = await fu5Q('[data-testid=summary-downloaded]');
      check('FU5-3 내려받기를 누르면 「「점검요약-…-날짜.txt」를 내려받았습니다」 알림(막힘 안내 없음)', !!dl && /^「점검요약-.+-\d{4}-\d{2}-\d{2}\.txt」를 내려받았습니다$/.test(dl.text) && (await fu5Q('[data-testid=summary-download-blocked]')) === null, JSON.stringify(dl));
      await shot(s.cdp, `${browser.name}-fu5-summary-preview`);
      await clickTestId(s.cdp, 'tab-similar');
      await sleep(250);
      const hint = await fu5Q('[data-testid=similar-person-hint]');
      check('FU5-5 「유사 경험자」 탭에 「사람이 빠질 때 누가 대신하는지는 그래프에서 그 사람을 고르면 「이 사람 일, 누가 대신할 수 있나」에 나옵니다」 안내(크기 있음)', !!hint && hint.w > 0 && hint.h > 0 && hint.text.includes('사람이 빠질 때 누가 대신하는지는 그래프에서 그 사람을 고르면 「이 사람 일, 누가 대신할 수 있나」에 나옵니다'), JSON.stringify(hint));
    } else check('FU5 가상 운영부(U-D1) 열기', false, 'U-D1이 열리지 않음');

    // ── A4: 점검을 저장한 지도는 마지막으로 연 지도가 바뀌어도 시작 화면 「내 업무 지도」에 남는다 ──
    if (await fu5Go('', fu5Mut({ lastOpenedId: 'U-A1', riskBaseline: { 'U-D1': { solo: 1, dense: 0, gaps: 0, at: '2026-10-22T09:00:00+09:00' } } }))) {
      const card = await fu5Q('[data-testid=mine-card-U-D1]');
      const chk = await fu5Q('[data-testid=mine-card-U-D1] [data-testid=map-checked]');
      check('FU5-4 시작 화면: 마지막으로 연 지도가 다른 지도(월말 정산 점검)여도, 점검을 저장한 가상 운영부가 「내 업무 지도」에 남고 「점검 저장한 지도 · 마지막 점검 2026-10-22」', !!card && !!chk && chk.text === '점검 저장한 지도 · 마지막 점검 2026-10-22' && chk.w > 0 && chk.h > 0, JSON.stringify([card && card.text, chk]));
      check('FU5-4 점검을 저장하지 않은 다른 안 고친 샘플(비교 자료)은 목록에 없음', (await fu5Q('[data-testid=mine-card-U-K1]')) === null);
      await shot(s.cdp, `${browser.name}-fu5-start-checked`);
      const t = await text(s.cdp, '[data-testid=start-terms]');
      check('FU5-11 시작 화면의 용어 줄은 「연두색 큰 동그라미」(「가운데 큰 동그라미」 아님)', t.includes('연두색 큰 동그라미') && !t.includes('가운데 큰 동그라미'), t);
      await evaluate(s.cdp, "document.querySelector('[data-testid=mine-open-U-D1]').click()");
      await sleep(500);
      check('FU5-4 그 카드의 「열기」로 가상 운영부가 열림', await waitFor(s.cdp, "window.__wu && window.__wu.doc && window.__wu.doc.universe.id === 'U-D1' && window.__wu.cy.nodes().length > 0", 8000));
      const termsDept = await text(s.cdp, '[data-testid=term-note]');
      check('FU5-11 개요의 용어 줄은 「연두색 큰 동그라미」(「가운데 큰 동그라미」 아님)', termsDept.includes('연두색 큰 동그라미') && !termsDept.includes('가운데 큰 동그라미'), termsDept);
    } else check('FU5-4 시작 화면 열기', false, '시작 화면이 열리지 않음');

    // ── B6: 「전체 보기」가 선택 강조(흐림)도 푼다. 편집 양식이 열려 있으면 양식은 지키고 배율만 맞춘다 ──
    if (await fu5Go('U-D1')) {
      await evaluate(s.cdp, "(() => { const w = window.__wu.cy.nodes().filter((n) => n.data('core_type') === 'work')[0]; window.__wu.select(w.id()); })()");
      await sleep(300);
      const faded0 = await evaluate(s.cdp, "({ faded: window.__wu.cy.nodes('.faded').length, sel: window.__wu.selected })");
      await evaluate(s.cdp, "document.getElementById('fit').click()");
      await sleep(400);
      const faded1 = await evaluate(s.cdp, "({ faded: window.__wu.cy.nodes('.faded').length, sel: window.__wu.selected, back: !!document.querySelector('[data-testid=detail-back-universe]') })");
      check('FU5-6 항목을 골라 다른 곳이 흐려진 상태에서 「전체 보기」를 누르면 흐림이 풀리고 선택도 풀려 지도 전체 화면으로 돌아감(「← 지도 전체 보기」를 안 눌러도)', faded0.faded > 0 && !!faded0.sel && faded1.faded === 0 && faded1.sel === null && faded1.back === false, JSON.stringify([faded0, faded1]));
      // 부서 지도(U-D1)의 업무는 모두 하위 지도 것이라 「수정」이 없다: 업무 하나짜리 월말 정산 점검에서 확인한다
      await fu5Go('U-A1');
      await evaluate(s.cdp, "window.__wu.select('U-A1/N-001')");
      await sleep(250);
      const hasEdit = await evaluate(s.cdp, "!!document.querySelector('[data-testid=btn-edit]')");
      if (hasEdit) {
        await clickTestId(s.cdp, 'btn-edit');
        await sleep(250);
        await evaluate(s.cdp, "document.getElementById('fit').click()");
        await sleep(300);
        check('FU5-6 편집 양식이 열려 있을 때 「전체 보기」는 양식을 닫지 않고(선택 유지) 배율만 맞춤', (await evaluate(s.cdp, "!!document.querySelector('#detail form')")) && (await evaluate(s.cdp, 'window.__wu.selected')) !== null);
      } else check('FU5-6 편집 단추가 있는 항목 선택', false, '수정 단추 없음');
    } else check('FU5-6 가상 운영부(U-D1) 열기', false, 'U-D1이 열리지 않음');

    // ── B8·B12: 월말 정산 점검(U-A1) 깨끗한 샘플에서 담당을 넘긴 날, 연결 추가 오류 줄 지우기 ──
    // 담당을 넘긴 날: 대사 확인(N-001)의 서하늘(N-012) 담당을 오늘로 끝내고 한가람(N-010)이 오늘 시작
    const FU5_HANDOVER = "{ const k = 'wu:v1:u:U-A1'; const d = JSON.parse(localStorage.getItem(k)); const t = new Date(); const p = (n) => String(n).padStart(2, '0'); const day = t.getFullYear() + '-' + p(t.getMonth() + 1) + '-' + p(t.getDate()); const e = d.edges.find((x) => x.id === 'L-007'); e.period = { start: '2026-10-01', end: day }; d.edges.push({ id: 'L-fu5-1', source: 'N-010', target: 'N-001', core_type: 'performs', period: { start: day }, hidden: false, created_at: '2026-10-12T20:00:00+09:00' }); localStorage.setItem(k, JSON.stringify(d)); }";
    if (await fu5Go('U-A1', fu5Mut({}, FU5_HANDOVER))) {
      await evaluate(s.cdp, "window.__wu.select('U-A1/N-001')");
      await sleep(300);
      const ho = await evaluate(s.cdp, "({ load: (document.querySelector('[data-testid=work-load]') || {}).textContent || '', chips: [...document.querySelectorAll('[data-testid=link-status]')].map((e) => e.parentElement.textContent) })");
      check('FU5-8 담당을 넘긴 날: 「현재 담당」 줄에는 받는 사람(한가람)이 먼저, 넘기는 서하늘은 「(서하늘은 오늘까지)」', ho.load.includes('현재 담당: 한가람 (서하늘은 오늘까지)'), JSON.stringify(ho));
      check('FU5-8 연결 목록: 서하늘의 수행은 「오늘까지(넘김)」, 한가람은 「현재」(둘 다 「현재」로 보이지 않음)', ho.chips.some((c) => c.includes('서하늘') && c.includes('오늘까지(넘김)')) && ho.chips.some((c) => c.includes('한가람') && c.includes('현재') && !c.includes('넘김')) && !ho.chips.some((c) => c.includes('서하늘') && /현재/.test(c)), JSON.stringify(ho));
      await shot(s.cdp, `${browser.name}-fu5-handover`);
      // 12: 연결 추가에서 방향이 틀려 오류(E-PAIR)를 본 뒤 양식 값을 바꾸면 오류 줄이 지워짐
      await evaluate(s.cdp, "window.__wu.select('U-A1/N-010')");
      await sleep(200);
      await clickTestId(s.cdp, 'btn-edge');
      await sleep(200);
      await evaluate(s.cdp, "(() => { const f = document.querySelector('[data-testid=edge-form]'); const q = (id) => f.querySelector('[data-testid=' + id + ']'); const set = (id, v) => { q(id).value = v; q(id).dispatchEvent(new Event('change', { bubbles: true })); }; set('edge-other', 'N-003'); set('edge-type', 'performs'); set('edge-direction', 'in'); f.querySelector('button[type=submit]').click(); })()");
      await sleep(250);
      const err1 = await evaluate(s.cdp, "(() => { const m = document.querySelector('[data-testid=edge-form] [data-testid=form-message]'); return m ? { code: m.dataset.code || '', text: m.textContent } : null; })()");
      await evaluate(s.cdp, "(() => { const q = document.querySelector('[data-testid=edge-form] [data-testid=edge-direction]'); q.value = 'out'; q.dispatchEvent(new Event('change', { bubbles: true })); })()");
      await sleep(150);
      const err2 = await evaluate(s.cdp, "(() => { const m = document.querySelector('[data-testid=edge-form] [data-testid=form-message]'); return m ? { code: m.dataset.code || '', text: m.textContent } : null; })()");
      check('FU5-12 연결 추가: 방향이 틀려 E-PAIR 오류가 뜬 뒤 방향(양식 값)을 바꾸면 오류 줄이 지워짐', !!err1 && err1.code === 'E-PAIR' && !!err2 && err2.code === '' && err2.text === '', JSON.stringify([err1, err2]));
      await evaluate(s.cdp, "[...document.querySelectorAll('[data-testid=edge-form] button')].find((b) => b.textContent === '취소').click()");
      await sleep(150);
    } else check('FU5 월말 정산 점검(U-A1) 열기', false, 'U-A1이 열리지 않음');

    // ── B10: 「실패 흉내(점검용)」는 점검 주소(?check)에서만 보임: 지금(?check)은 있고(점검 도구가 씀), ?check 없이 열면 없음 ──
    await evaluate(s.cdp, "document.getElementById('settings-open').click()");
    await sleep(200);
    const failOn = await evaluate(s.cdp, "!!document.querySelector('[data-testid=provider-fail]')");
    await s.cdp.send('Page.navigate', { url: `${pageUrl.replace(/\?check$/, '')}#U-A1` });
    await sleep(1200);
    await evaluate(s.cdp, "document.getElementById('settings-open').click()");
    await sleep(250);
    const failOff = await evaluate(s.cdp, "({ fail: !!document.querySelector('[data-testid=provider-fail]'), pregen: !!document.querySelector('[data-testid=provider-pregen]'), text: (document.querySelector('[data-testid=settings-providers]') || {}).textContent || '' })");
    check('FU5-10 설정의 공급자 고르기: ?check 주소에서는 「실패 흉내(점검용)」가 있고, ?check 없이 열면 보이지 않으며 다른 보기는 그대로', failOn === true && failOff.fail === false && failOff.pregen && !failOff.text.includes('실패 흉내'), JSON.stringify([failOn, failOff]));

    await s.cdp.send('Page.navigate', { url: `${pageUrl}#U-A1` });
    await sleep(500);
    await waitFor(s.cdp, "window.__wu && window.__wu.doc && window.__wu.doc.universe.id === 'U-A1'", 8000);
    await fu5Go('U-A1', '', fu5Snap); // 저장소를 블록 시작 때 찍어 둔 상태로 되돌린다
  }

  // ── 일상 사용 2회차 S(2026-10-25, CR-18 범위 안 보완): T4 「이번 주 기록」 날짜, T5 협업자 메모(연결 note), T6 사람 목록 순서·추가 단추 설명,
  //    M1 점검 기준 최근 둘, M2 「점검 요약 보기」, M3 담당 바꾸기, M4 묶은 지도 마지막 수정일, M6 바뀐 것에 담당 변경. 데이터·설정을 바꾸므로 시작 때 저장소를 찍어 두었다가 끝에서 되돌린다("처음 사용 5회차(FU5)" 블록과 같은 방식) ──
  {
    const s2Snap = await evaluate(s.cdp, 'JSON.stringify(Object.entries(localStorage))');
    // 앞 점검들이 월말 정산 점검(U-A1)을 고쳐 두었을 수 있다: 저장소에서 지우고 다시 열면 앱이 깨끗한 샘플을 다시 채운다. 그 상태를 이 블록의 기준으로 쓴다
    await evaluate(s.cdp, "(() => { localStorage.removeItem('wu:v1:u:U-A1'); location.reload(); })()").catch(() => {});
    await sleep(500);
    await waitFor(s.cdp, 'window.__wu && (window.__wu.start === true || !!window.__wu.doc)', 8000);
    const s2Base = await evaluate(s.cdp, 'JSON.stringify(Object.entries(localStorage))');
    const s2Mut = (patch = {}, extra = '') => `{ const v = JSON.parse(localStorage.getItem('wu:v1:settings') || '{}'); delete v.tourDone; delete v.lastOpenedId; delete v.riskBaseline; Object.assign(v, ${JSON.stringify(patch)}); localStorage.setItem('wu:v1:settings', JSON.stringify(v)); } ${extra}`;
    const s2Go = async (hash, mutate = s2Mut(), base = s2Base) => {
      const nav = hash ? `location.hash = ${JSON.stringify(hash)}` : "history.replaceState(null, '', location.pathname + location.search)";
      await evaluate(s.cdp, `(() => { const snap = JSON.parse(${JSON.stringify(base)}); localStorage.clear(); for (const [k, v] of snap) localStorage.setItem(k, v); ${mutate}; ${nav}; location.reload(); })()`).catch(() => {});
      await sleep(500);
      return hash
        ? waitFor(s.cdp, `window.__wu && window.__wu.doc && window.__wu.doc.universe.id === ${JSON.stringify(hash)} && window.__wu.cy.nodes().length > 0`, 8000)
        : waitFor(s.cdp, 'window.__wu && window.__wu.start === true', 8000);
    };
    const s2Q = (sel) => evaluate(s.cdp, `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { text: e.textContent, w: r.width, h: r.height, open: e.open, value: e.value, max: e.max, code: e.dataset ? e.dataset.code : undefined }; })()`);
    const s2Set = (testid, val) => evaluate(s.cdp, `(() => { const e = document.querySelector('[data-testid=${testid}]'); if (!e) return false; e.value = ${JSON.stringify(val)}; e.dispatchEvent(new Event('input')); e.dispatchEvent(new Event('change')); return true; })()`);
    const s2Select = async (gid) => { await evaluate(s.cdp, `window.__wu.select(${JSON.stringify(gid)})`); await sleep(250); };
    const s2Settings = () => evaluate(s.cdp, "JSON.parse(localStorage.getItem('wu:v1:settings') || '{}')");
    const s2Day = (n) => evaluate(s.cdp, `(() => { const t = new Date(); t.setDate(t.getDate() + (${n})); const p = (x) => String(x).padStart(2, '0'); return t.getFullYear() + '-' + p(t.getMonth() + 1) + '-' + p(t.getDate()); })()`);
    const s2Counts = () => evaluate(s.cdp, '({ events: window.__wu.doc.events.length, edges: window.__wu.doc.edges.length, nodes: window.__wu.doc.nodes.length })');
    const s2Reload = async (id) => {
      await evaluate(s.cdp, 'location.reload()').catch(() => {});
      await sleep(600);
      await waitFor(s.cdp, `window.__wu && window.__wu.doc && window.__wu.doc.universe.id === ${JSON.stringify(id)} && window.__wu.cy.nodes().length > 0`, 8000);
      await sleep(300);
    };

    // ── T4·T5·M3: 월말 정산 점검(U-A1) ──
    if (await s2Go('U-A1')) {
      await evaluate(s.cdp, 'window.confirm = () => true');
      const today = await s2Day(0);
      const tomorrow = await s2Day(1);
      const past = await s2Day(-3);
      // T4: 지도 중심 상세의 「이번 주 기록」 날짜 칸
      await s2Select('U-A1/N-000');
      const wd = await s2Q('[data-testid=weekly-date]');
      check('S T4 「이번 주 기록」에 날짜 칸(크기 있음): 기본 오늘, 고를 수 있는 가장 늦은 날 = 오늘', !!wd && wd.w > 0 && wd.h > 0 && wd.value === today && wd.max === today, JSON.stringify([wd, today]));
      const c0 = await s2Counts();
      await s2Set('weekly-work', 'N-001');
      await s2Set('weekly-note', 'S 시험 주간 기록');
      await s2Set('weekly-date', tomorrow);
      await clickTestId(s.cdp, 'weekly-add');
      await sleep(200);
      const wFuture = await s2Q('[data-testid=weekly-msg]');
      check('S T4 오늘보다 뒤 날짜는 「오늘보다 뒤 날짜는 기록할 수 없습니다…」로 거부하고 저장하지 않음', !!wFuture && wFuture.text.startsWith('오늘보다 뒤 날짜는 기록할 수 없습니다') && wFuture.code === 'date-future' && (await s2Counts()).events === c0.events, JSON.stringify(wFuture));
      await s2Set('weekly-date', '');
      await clickTestId(s.cdp, 'weekly-add');
      await sleep(200);
      const wEmpty = await s2Q('[data-testid=weekly-msg]');
      check('S T4 날짜가 비면 「날짜를 넣으세요.」, 저장하지 않음', !!wEmpty && wEmpty.text === '날짜를 넣으세요.' && (await s2Counts()).events === c0.events, JSON.stringify(wEmpty));
      await s2Set('weekly-date', past);
      await shot(s.cdp, `${browser.name}-s2-weekly-date`);
      await clickTestId(s.cdp, 'weekly-add');
      await sleep(350);
      const wMemo = await evaluate(s.cdp, 'window.__wu.doc.events[window.__wu.doc.events.length - 1]');
      const wDone = await s2Q('[data-testid=weekly-done]');
      check('S T4 지난 날짜로 기록 → 이력 메모의 날짜가 그 날짜, 완료 알림에 날짜가 보임', (await s2Counts()).events === c0.events + 1 && wMemo.type === 'memo' && wMemo.occurred_at === past && wMemo.note === 'S 시험 주간 기록' && !!wDone && wDone.text.includes(`(${past})`), JSON.stringify([wMemo, wDone]));
      const wd2 = await s2Q('[data-testid=weekly-date]');
      check('S T4 몰아 넣기: 방금 쓴 날짜가 같은 날 안에서는 칸에 남아 있음(오늘로 되돌아가지 않음)', !!wd2 && wd2.value === past, JSON.stringify(wd2));

      // T5: 협업자 추가의 「주고받는 것」 → 「참조」 연결의 메모
      await s2Select('U-A1/N-000');
      await s2Select('U-A1/N-001');
      const cn = await s2Q('[data-testid=collab-note]');
      await evaluate(s.cdp, "document.querySelector('[data-testid=collab-quick]').open = true");
      await sleep(100);
      const cnBox = await evaluate(s.cdp, "(() => { const e = document.querySelector('[data-testid=collab-note]'); const r = e.getBoundingClientRect(); return { w: r.width, h: r.height, label: e.closest('label').textContent }; })()");
      check('S T5 「협업자 추가」에 선택 칸 「주고받는 것」(크기 있음)', !!cn && cnBox.w > 0 && cnBox.h > 0 && cnBox.label.includes('주고받는 것'), JSON.stringify([cn, cnBox]));
      await s2Set('collab-name', 'S 협업자');
      await s2Set('collab-note', '대사 결과 공유');
      await clickTestId(s.cdp, 'collab-add');
      await sleep(350);
      const refEdge = await evaluate(s.cdp, "(() => { const d = window.__wu.doc; const p = d.nodes.find((n) => n.label === 'S 협업자'); const e = p && d.edges.find((x) => x.core_type === 'references' && x.target === p.id); return e ? { note: e.note, source: e.source } : null; })()");
      const linkText = await evaluate(s.cdp, "(document.querySelector('[data-testid=links]') || { textContent: '' }).textContent");
      const cd = await s2Q('[data-testid=collab-done]');
      check('S T5 추가 → 「참조」 연결의 메모에 「대사 결과 공유」가 저장되고(N-001 → 협업자), 「연결된 항목」과 완료 알림에 보임', !!refEdge && refEdge.note === '대사 결과 공유' && refEdge.source === 'N-001' && linkText.includes('대사 결과 공유') && !!cd && cd.text.includes('대사 결과 공유'), JSON.stringify([refEdge, cd]));

      // M3: 담당 바꾸기(대사 확인: 지금 담당 서하늘)
      await s2Select('U-A1/N-000');
      await s2Select('U-A1/N-001');
      const ab = await s2Q('[data-testid=assignee-change]');
      check('S M3 업무 상세에 접힌 상자 「담당 바꾸기」(처음엔 접힘, 크기 있음)', !!ab && ab.w > 0 && ab.h > 0 && ab.open === false && ab.text.includes('담당 바꾸기'), JSON.stringify(ab));
      await evaluate(s.cdp, "document.querySelector('[data-testid=assignee-change]').open = true");
      await sleep(100);
      const fromOpts = await evaluate(s.cdp, "[...document.querySelectorAll('[data-testid=assignee-from] option')].map((o) => o.textContent)");
      check('S M3 「지금 담당」 목록은 진행 중으로 담당하는 사람(서하늘)', fromOpts.includes('서하늘') && !fromOpts.includes('윤바다'), JSON.stringify(fromOpts));
      const a0 = await s2Counts();
      // 오류: 받는 사람 없음 / 둘 다 입력 / 오늘 뒤 날짜 — 아무것도 저장하지 않음
      await clickTestId(s.cdp, 'assignee-apply');
      await sleep(150);
      const aEmpty = await s2Q('[data-testid=assignee-msg]');
      await s2Set('assignee-to', 'N-011');
      await s2Set('assignee-to-name', '가상신입');
      await clickTestId(s.cdp, 'assignee-apply');
      await sleep(150);
      const aBoth = await s2Q('[data-testid=assignee-msg]');
      await s2Set('assignee-to-name', '');
      await s2Set('assignee-date', tomorrow);
      await clickTestId(s.cdp, 'assignee-apply');
      await sleep(150);
      const aFuture = await s2Q('[data-testid=assignee-msg]');
      check('S M3 오류: 받는 사람이 없으면·목록과 이름을 둘 다 넣으면·오늘 뒤 날짜면 각각 안내하고 저장하지 않음', !!aEmpty && aEmpty.code === 'to-empty' && !!aBoth && aBoth.code === 'both' && !!aFuture && aFuture.code === 'date-future' && JSON.stringify(await s2Counts()) === JSON.stringify(a0), JSON.stringify([aEmpty, aBoth, aFuture]));
      // 정상: 서하늘 → 윤바다, 인수인계 기록도
      await s2Set('assignee-date', today);
      await evaluate(s.cdp, "(() => { const c = document.querySelector('[data-testid=assignee-handover]'); c.checked = true; c.dispatchEvent(new Event('change')); })()");
      await shot(s.cdp, `${browser.name}-s2-assignee`);
      await clickTestId(s.cdp, 'assignee-apply');
      await sleep(400);
      const a1 = await s2Counts();
      const aState = await evaluate(s.cdp, `(() => { const d = window.__wu.doc; const ev = d.events.slice(${a0.events}); const out = d.edges.find((e) => e.source === 'N-012' && e.target === 'N-001' && e.core_type === 'performs'); const inn = d.edges.find((e) => e.source === 'N-011' && e.target === 'N-001' && e.period && e.period.start === ${JSON.stringify(today)}); return { types: ev.filter((e) => e.type === 'assign_end' || e.type === 'assign_start' || e.type === 'handover').map((e) => e.type), stamps: [...new Set(ev.map((e) => e.recorded_at))].length, end: out && out.period && out.period.end, started: !!inn && !inn.period.end, ho: ev.find((e) => e.type === 'handover') }; })()`);
      const aDone = await s2Q('[data-testid=assignee-done]');
      const wl = await s2Q('[data-testid=work-load]');
      check('S M3 「담당 바꾸기」 → 한 번의 기록으로 서하늘의 수행이 오늘 끝나고 윤바다의 수행이 오늘 시작, 인수인계 이력도 같이(담당 종료·시작·인수인계)', JSON.stringify(aState.types) === JSON.stringify(['assign_end', 'assign_start', 'handover']) && aState.stamps === 1 && aState.end === today && aState.started && aState.ho.payload.from_person_id === 'N-012' && aState.ho.payload.to_person_id === 'N-011' && a1.events > a0.events, JSON.stringify([aState, a0, a1]));
      check('S M3 완료 알림(서하늘 → 윤바다, 날짜)과 「현재 담당: 윤바다 (서하늘은 오늘까지)」(넘긴 날이라 끝나는 사람은 현재 담당에서 빠지고 표시만 — R2-M5와 같은 모양)', !!aDone && aDone.text.includes('서하늘 → 윤바다') && aDone.text.includes(today) && !!wl && wl.text.includes('현재 담당: 윤바다 (서하늘은 오늘까지)'), JSON.stringify([aDone, wl]));
      // 새 사람 이름 경로
      await evaluate(s.cdp, "document.querySelector('[data-testid=assignee-change]').open = true");
      await s2Set('assignee-to-name', 'S 새 담당');
      await clickTestId(s.cdp, 'assignee-apply');
      await sleep(400);
      const aNew = await evaluate(s.cdp, "(() => { const d = window.__wu.doc; const p = d.nodes.find((n) => n.label === 'S 새 담당'); return { person: !!p && p.core_type === 'person', edge: !!p && d.edges.some((e) => e.source === p.id && e.target === 'N-001' && e.core_type === 'performs' && !(e.period && e.period.end)) }; })()");
      check('S M3 이름을 넣으면 새 사람을 만들어 새 담당으로(윤바다 → S 새 담당)', aNew.person && aNew.edge, JSON.stringify(aNew));
      await shot(s.cdp, `${browser.name}-s2-assignee-done`);

      // T6: 사람·업무·문서 추가 안의 설명이 눈에 보이는 글로
      await evaluate(s.cdp, "window.__wu.select(null); document.querySelector('details.add').open = true");
      await sleep(200);
      const tn = await s2Q('[data-testid=add-tools-note]');
      check('S T6 「사람·업무·문서 추가」 단추 아래에 설명 글(말풍선 아님, 크기 있음): 표로 추가·글로 추가·표로 고치기', !!tn && tn.w > 0 && tn.h > 0 && tn.text.includes('글로 추가: 몇 문장짜리 글을 붙여 넣으면') && tn.text.includes('표로 추가') && tn.text.includes('표로 고치기'), JSON.stringify(tn));
    } else check('S 월말 정산 점검(U-A1) 열기', false, '지도가 열리지 않음');

    // ── M3 안내: 묶은 지도의 하위 지도 항목은 「…」 열기 ──
    if (await s2Go('U-D1')) {
      await s2Select('U-A1/N-001');
      await evaluate(s.cdp, "(() => { const d = document.querySelector('[data-testid=assignee-change]'); if (d) d.open = true; })()");
      const other = await s2Q('[data-testid=assignee-other-map]');
      const openBtn = await s2Q('[data-testid=assignee-open-map]');
      check('S M3 부서 지도에서 하위 지도(월말 정산 점검)의 업무는 「담당 바꾸기」 대신 「「월말 정산 점검」 열기」 안내', !!other && other.text.includes('다른 업무 지도의 업무') && !!openBtn && openBtn.text.includes('열기') && (await s2Q('[data-testid=assignee-apply]')) === null, JSON.stringify([other, openBtn]));

      // ── T6: 초안 사람 목록 순서(대상 업무를 수행한 사람이 먼저) ──
      await evaluate(s.cdp, 'window.__wu.select(null)');
      await sleep(250);
      await clickTestId(s.cdp, 'btn-draft-universe');
      await sleep(300);
      await s2Set('draft-target', 'U-A1/N-001');
      const ppl = await evaluate(s.cdp, "(() => { const f = document.querySelector('[data-testid=draft-from]'); const gs = [...f.querySelectorAll('optgroup')]; return { labels: gs.map((g) => g.label), first: gs[0] ? [...gs[0].querySelectorAll('option')].map((o) => o.textContent) : [], second: gs[1] ? [...gs[1].querySelectorAll('option')].map((o) => o.textContent) : [] }; })()");
      check('S T6 초안 창: 대상 업무(대사 확인)를 바꾸면 보내는 사람 목록이 「이 범위를 수행한 사람」(서하늘 등) → 「그 밖의 사람」 순', ppl.labels.join('|') === '이 범위를 수행한 사람|그 밖의 사람' && ppl.first.some((t) => t.includes('서하늘')) && ppl.second.length > 0 && !ppl.second.some((t) => t.includes('서하늘')), JSON.stringify(ppl));
      await shot(s.cdp, `${browser.name}-s2-draft-people`);
    } else check('S 부서 지도(U-D1) 열기', false, '지도가 열리지 않음');

    // ── M1·M2·M6: 묶은 지도(가상 운영부) 위험 요약의 점검 기준 ──
    if (await s2Go('U-D1')) {
      const c0 = await s2Q('[data-testid=team-risk-compare]');
      check('S M1 저장한 점검이 없으면 「아직 저장한 점검 없음」', !!c0 && c0.text.startsWith('아직 저장한 점검 없음'), JSON.stringify(c0));
      await clickTestId(s.cdp, 'btn-risk-baseline-save');
      await sleep(300);
      const c1 = await s2Q('[data-testid=team-risk-compare]');
      const n1 = await s2Q('[data-testid=risk-baseline-saved]');
      const st1 = await s2Settings();
      const b1 = (st1.riskBaseline || {})['U-D1'];
      check('S M1 오늘 처음 저장 → 비교 줄이 「오늘 저장한 점검 — 다음 점검 날부터 비교합니다」(비교 아님), 알림에 「다음 점검 날부터」, 기준은 한 건(객체)이고 업무별 담당 이름(owners)이 함께 저장됨', !!c1 && c1.text.startsWith('오늘 저장한 점검 — 다음 점검 날부터 비교합니다') && !!n1 && /^이번 점검을 저장했습니다\(\d{4}-\d{2}-\d{2}\) — 다음 점검 날부터 이 숫자와 비교합니다$/.test(n1.text) && !!b1 && !Array.isArray(b1) && !!b1.owners && Object.keys(b1.owners).length > 0 && Object.keys(b1.owners).length <= 100, JSON.stringify([c1, n1, b1 && Object.keys(b1)]));
      await clickTestId(s.cdp, 'btn-risk-baseline-save');
      await sleep(300);
      const n2 = await s2Q('[data-testid=risk-baseline-saved]');
      const b2 = ((await s2Settings()).riskBaseline || {})['U-D1'];
      check('S M1 같은 날 다시 저장 → 「오늘 저장한 점검을 이번 점검으로 바꿨습니다」, 기준은 그대로 한 건', !!n2 && n2.text.startsWith('오늘 저장한 점검을 이번 점검으로 바꿨습니다') && !Array.isArray(b2), JSON.stringify([n2, Array.isArray(b2)]));
      // 이전 점검(7일 전, 혼자만 아는 일 하나 적게·한 업무의 담당 이름이 다름)과 오늘 것을 둘 다 가진 상태, 셋째로 14일 전 것도 끼워 넣어 최근 둘만 남는지
      const d7 = await s2Day(-7);
      const d14 = await s2Day(-14);
      await evaluate(s.cdp, `(() => { const v = JSON.parse(localStorage.getItem('wu:v1:settings')); const b = v.riskBaseline['U-D1']; const w = Object.keys(b.owners)[0]; const old = (day, extra) => ({ ...b, at: day + 'T09:00:00+09:00', asOf: day, ...extra, owners: { ...b.owners, [w]: '시험용 이전 담당' } }); v.riskBaseline['U-D1'] = [old(${JSON.stringify(d14)}, { solo: 0 }), old(${JSON.stringify(d7)}, { solo: Math.max(0, b.solo - 1) }), b]; v.__ownerWork = w; localStorage.setItem('wu:v1:settings', JSON.stringify(v)); location.reload(); })()`).catch(() => {});
      await sleep(600);
      await waitFor(s.cdp, "window.__wu && window.__wu.doc && window.__wu.doc.universe.id === 'U-D1' && window.__wu.cy.nodes().length > 0", 8000);
      await sleep(300);
      const ownerWork = (await s2Settings()).__ownerWork;
      const c3 = await s2Q('[data-testid=team-risk-compare]');
      check('S M1 비교는 오늘보다 앞선 날의 가장 최근 기준(7일 전)과 한다: 「지난 점검(7일 전 날짜) 대비」', !!c3 && c3.text.startsWith(`지난 점검(${d7}) 대비`), JSON.stringify([c3, d7]));
      await evaluate(s.cdp, "document.querySelector('[data-testid=team-risk-changes]').open = true");
      await sleep(150);
      const ow = await s2Q('[data-testid=risk-change-owner]');
      check('S M6 「바뀐 것 보기」에 「담당이 바뀐 업무: 「…」 시험용 이전 담당 → 지금 담당」 줄(크기 있음)', !!ow && ow.w > 0 && ow.h > 0 && ow.text.startsWith('담당이 바뀐 업무: ') && ow.text.includes(`「${ownerWork}」 시험용 이전 담당 → `), JSON.stringify([ow, ownerWork]));
      await shot(s.cdp, `${browser.name}-s2-risk-owners`);
      // 저장하면(오늘 것을 바꿈) 최근 둘만 남는다: 14일 전 것은 버려지고 7일 전 것은 그대로
      await clickTestId(s.cdp, 'btn-risk-baseline-save');
      await sleep(300);
      const b3 = ((await s2Settings()).riskBaseline || {})['U-D1'];
      check('S M1 설정에는 최근 둘(7일 전·오늘)만: 14일 전 기준은 버려지고, 오늘 것은 바뀐 것', Array.isArray(b3) && b3.length === 2 && b3[0].asOf === d7 && b3[1].at.slice(0, 10) === (await s2Day(0)), JSON.stringify(b3 && b3.map((x) => x.at)));
      const c4 = await s2Q('[data-testid=team-risk-compare]');
      check('S M1 저장한 뒤에도 비교 줄은 7일 전 기준과의 비교 그대로', !!c4 && c4.text.startsWith(`지난 점검(${d7}) 대비`), JSON.stringify(c4));
      // M2: 점검 요약 보기
      const sb = await s2Q('[data-testid=btn-risk-summary-open]');
      check('S M2 위험 요약 줄 「이번 점검 저장」 옆에 「점검 요약 보기」(크기 있음)', !!sb && sb.w > 0 && sb.h > 0 && sb.text === '점검 요약 보기', JSON.stringify(sb));
      await clickTestId(s.cdp, 'btn-risk-summary-open');
      await sleep(450);
      const bar = await s2Q('[data-testid=summary-bar]');
      const focused = await evaluate(s.cdp, 'document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.testid : null');
      await evaluate(s.cdp, "(() => { const d = document.querySelector('[data-testid=summary-preview]'); d.open = true; d.dispatchEvent(new Event('toggle')); })()");
      await sleep(150);
      const prev = await s2Q('[data-testid=summary-preview-text]');
      check('S M2 누르면 인사이트가 열리고 위쪽 「점검 요약」 줄(복사·내려받기·인쇄)이 보이며 첫 단추에 초점', !!bar && bar.w > 0 && bar.h > 0 && focused === 'summary-copy' && bar.text.includes('점검 요약'), JSON.stringify([bar && bar.text.slice(0, 40), focused]));
      check('S M6 점검 요약 글에도 「바뀐 것:」 아래 「담당이 바뀐 업무: 「…」 시험용 이전 담당 → …」', !!prev && prev.text.includes('바뀐 것:') && prev.text.includes(`담당이 바뀐 업무: 「${ownerWork}」 시험용 이전 담당 → `), JSON.stringify(prev && prev.text.slice(0, 600)));
      await shot(s.cdp, `${browser.name}-s2-summary-open`);
      // 예전 기준(owners 없음)은 그 줄 없음
      await evaluate(s.cdp, "(() => { const v = JSON.parse(localStorage.getItem('wu:v1:settings')); const e = v.riskBaseline['U-D1']; for (const b of (Array.isArray(e) ? e : [e])) delete b.owners; localStorage.setItem('wu:v1:settings', JSON.stringify(v)); })()");
      await s2Reload('U-D1');
      const c5 = await s2Q('[data-testid=team-risk-compare]');
      check('S M6 예전 기준(업무별 담당 이름 없음)은 숫자·이름 비교만, 「담당이 바뀐 업무」 줄 없음', !!c5 && c5.text.startsWith('지난 점검(') && (await s2Q('[data-testid=risk-change-owner]')) === null);
    } else check('S 가상 운영부(U-D1) 점검 기준', false, '지도가 열리지 않음');

    // ── M4: 시작 화면의 묶은 지도 「마지막 수정」이 하위 지도의 수정까지 ──
    const S2_EDIT_CHILD = "{ const k = 'wu:v1:u:U-A1'; const d = JSON.parse(localStorage.getItem(k)); d.events.push({ id: 'E-S2', type: 'memo', occurred_at: '2026-10-20', recorded_at: '2026-10-20T10:00:00+09:00', source: 'user', payload: { target_id: 'N-001', category: 'in_progress', topic_ids: [] }, note: 'S 시험' }); localStorage.setItem(k, JSON.stringify(d)); }";
    if (await s2Go('', s2Mut({ lastOpenedId: 'U-D1' }, S2_EDIT_CHILD))) {
      const card = await s2Q('[data-testid=mine-card-U-D1] [data-testid=map-modified]');
      check('S M4 시작 화면: 마지막으로 연 묶은 지도(가상 운영부) 카드의 「마지막 수정」이 하위 지도(월말 정산 점검)의 수정일(2026-10-20)', !!card && card.text === '마지막 수정 2026-10-20', JSON.stringify(card));
    } else check('S M4 시작 화면', false, '시작 화면이 열리지 않음');
    if (await s2Go('', s2Mut({ lastOpenedId: 'U-D1' }))) {
      const card = await s2Q('[data-testid=mine-card-U-D1] [data-testid=map-modified]');
      check('S M4 아무도 고치지 않았으면 예전처럼 「수정한 적 없음」', !!card && card.text === '수정한 적 없음', JSON.stringify(card));
    } else check('S M4 시작 화면(수정 없음)', false, '시작 화면이 열리지 않음');

    await s2Go('U-A1', '', s2Snap); // 저장소를 블록 시작 때 찍어 둔 상태로 되돌린다
  }

  // ── 일상 사용 2회차 R(2026-10-25, CR-18·CR-19 범위 안 보완): T1 글로 추가 공유 문장(지도 업무 이름 + 결과)·못 정할 때의 이유, T6 사번 칸에 지도의 사번(읽기 전용),
  //    T3 최근 이슈의 해결됨 날짜, T2 다시 뽑은 초안의 「새로」(속성 고치기 — 노드 근거)·칩 설명에 지난번 초안 시각, M5·M7 담당을 넘긴 날 끝나는 사람은 현재 담당이 아님(사람 상세·업무 상세·초안 보내는 사람 미리 고름).
  //    데이터·설정을 바꾸므로 시작 때 저장소를 찍어 두었다가 끝에서 되돌린다("일상 사용 G1" 블록과 같은 방식) ──
  {
    const r2Snap = await evaluate(s.cdp, 'JSON.stringify(Object.entries(localStorage))');
    // 저장소를 시작 때 상태로 되돌리고 월말 정산 점검(U-A1)은 깨끗한 샘플로 다시 채운 뒤(mutate로 고칠 수 있다) 연다
    const r2Go = async (mutate = '', clean = true) => {
      await evaluate(s.cdp, `(() => { const snap = JSON.parse(${JSON.stringify(r2Snap)}); localStorage.clear(); for (const [k, v] of snap) localStorage.setItem(k, v); ${clean ? "localStorage.removeItem('wu:v1:u:U-A1');" : ''} localStorage.removeItem('wu:v1:draft-seen'); ${mutate}; location.hash = 'U-A1'; location.reload(); })()`).catch(() => {});
      await sleep(500);
      return waitFor(s.cdp, "window.__wu && window.__wu.doc && window.__wu.doc.universe.id === 'U-A1' && window.__wu.cy.nodes().length > 0", 8000);
    };
    const r2Box = (sel) => evaluate(s.cdp, `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { text: e.textContent, w: r.width, h: r.height, value: e.value, ro: e.hasAttribute('readonly'), ph: e.getAttribute('placeholder') }; })()`);
    const r2Read = async (text) => {
      await evaluate(s.cdp, `(() => { const e = document.querySelector('[data-testid=text-add-input]'); e.value = ${JSON.stringify(text)}; e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await clickTestId(s.cdp, 'text-add-read');
      await sleep(250);
    };
    const r2Draft = async (target, from, to) => {
      await evaluate(s.cdp, 'window.confirm = () => true; window.__wu.select(null)');
      await clickTestId(s.cdp, 'btn-draft-universe');
      await sleep(200);
      await makeDraft(target, from, to);
      await sleep(300);
    };
    const r2Item = (key) => evaluate(s.cdp, `[...document.querySelectorAll('[data-testid=draft-item-${key}] li')].map((li) => { const m = li.querySelector('[data-testid=draft-new-mark]'); return { text: li.querySelector('span:not(.chip):not(.evidence-row)') ? li.querySelector('span:not(.chip):not(.evidence-row)').textContent : '', marks: li.querySelectorAll('[data-testid=draft-new-mark]').length, title: m ? m.getAttribute('title') : '' }; })`);
    // 담당을 넘긴 날: 대사 확인(N-001)의 서하늘(N-012) 담당을 오늘로 끝내고 한가람(N-010)이 오늘 시작(FU5-8과 같은 가상 상태)
    const R2_HANDOVER = "{ const k = 'wu:v1:u:U-A1'; const d = JSON.parse(localStorage.getItem(k)); const t = new Date(); const p = (n) => String(n).padStart(2, '0'); const day = t.getFullYear() + '-' + p(t.getMonth() + 1) + '-' + p(t.getDate()); const e = d.edges.find((x) => x.id === 'L-007'); e.period = { start: '2026-10-01', end: day }; d.edges.push({ id: 'L-r2-1', source: 'N-010', target: 'N-001', core_type: 'performs', period: { start: day }, hidden: false, created_at: '2026-10-12T20:00:00+09:00' }); localStorage.setItem(k, JSON.stringify(d)); }";

    // ── T1·T6 글로 추가: 지도 업무 이름 + 결과 공유, 사번 칸에 지도의 사번 ──
    if (await r2Go()) {
      await evaluate(s.cdp, "window.__wu.select(null); document.querySelector('details.add').open = true");
      await sleep(150);
      await clickTestId(s.cdp, 'btn-text-add');
      await sleep(150);
      await r2Read('서하늘이 대사 확인을 맡는다.\n백서진에게 대사 확인 결과를 공유한다.');
      const r2P = await evaluate(s.cdp, "({ unread: !!document.querySelector('[data-testid=text-add-unread]'), nodes: document.querySelectorAll('[data-testid=text-add-nodes] tbody tr:not(.row-msg-line)').length, edges: document.querySelectorAll('[data-testid=text-add-edges] tbody tr:not(.row-msg-line)').length, labels: [0, 1, 2].map((i) => (document.querySelector('[data-testid=text-add-node-label-' + i + ']') || {}).value), from1: (document.querySelector('[data-testid=text-add-edge-from-1]') || {}).textContent, to1: (document.querySelector('[data-testid=text-add-edge-to-1]') || {}).textContent })");
      check('R2-T1 「백서진에게 대사 확인 결과를 공유한다」(대사 확인은 지도에 있는 업무)가 읽혀 항목 3개·연결 2개, 읽지 못한 문장 없음, 두 번째 연결은 대사 확인 → 백서진', r2P.nodes === 3 && r2P.edges === 2 && !r2P.unread && r2P.from1.startsWith('대사 확인') && r2P.to1.startsWith('백서진'), JSON.stringify(r2P));
      const r2Known = await r2Box(`[data-testid=text-add-node-empno-${r2P.labels.indexOf('서하늘')}]`);
      const r2Fresh = await r2Box(`[data-testid=text-add-node-empno-${r2P.labels.indexOf('백서진')}]`);
      check('R2-T6 지도에 있는 사람(서하늘)의 사번 칸에는 지도의 사번 「V-1003」이 읽기 전용으로 보이고(크기 있음), 새 사람(백서진)의 칸은 「V-0000」 자리표시의 입력 칸 그대로', !!r2Known && r2Known.value === 'V-1003' && r2Known.ro && r2Known.w > 20 && r2Known.h > 10 && !!r2Fresh && r2Fresh.value === '' && !r2Fresh.ro && r2Fresh.ph === 'V-0000', JSON.stringify([r2Known, r2Fresh]));
      await shot(s.cdp, `${browser.name}-r2-text-share`);
      await r2Read('서하늘이 대사 확인을 맡는다. 대사 확인이 끝나면 보고를 한다. 감사팀 백서진에게 결과를 공유한다.');
      const r2Why = await r2Box('[data-testid=text-add-unread-why-0]');
      check('R2-T1 앞 문장 업무가 둘이라 정할 수 없는 「감사팀 백서진에게 결과를 공유한다」는 읽지 못한 문장 목록에 이유 「어느 업무의 결과인지 정할 수 없습니다 — 「대사 확인 결과를 백서진에게 공유한다」처럼 업무 이름을 넣으세요」(크기 있음)', !!r2Why && r2Why.text.includes('어느 업무의 결과인지 정할 수 없습니다 — 「대사 확인 결과를 백서진에게 공유한다」처럼 업무 이름을 넣으세요') && r2Why.w > 20 && r2Why.h > 10, JSON.stringify(r2Why));
      await evaluate(s.cdp, "document.getElementById('text-add-dialog').open && document.querySelector('[data-testid=text-add-close]').click()");
      await sleep(100);
    } else check('R2 월말 정산 점검(U-A1) 열기', false, 'U-A1이 열리지 않음');

    // ── T3 최근 이슈의 해결됨 날짜, T2 다시 뽑은 초안의 「새로」(속성 고치기) ──
    if (await r2Go()) {
      await r2Draft('U-A1/N-000', 'U-A1/N-011', 'U-A1/N-012');
      const r2Issues = await r2Item('최근_이슈');
      const r2Resolved = r2Issues.find((x) => x.text.includes('2026-07-10') || x.text.includes('점검표 양식'));
      check('R2-T3 초안 「최근 이슈」: 이미 해결된 이슈(점검표 양식 건)에는 해결 날짜(2026-07-12)가 보이고, 해결 안 된 이슈(2026-09-15 대사 불일치)에는 「해결」이 없음', !!r2Resolved && r2Resolved.text.includes('2026-07-12') && r2Resolved.text.includes('해결') && r2Issues.some((x) => x.text.includes('2026-09-15') && !x.text.includes('해결')), JSON.stringify(r2Issues));
      await shot(s.cdp, `${browser.name}-r2-issue-resolved`);
      // 지난번 초안(위) 뒤에 대사 확인의 마감을 고친다(속성 고치기 = updated 이벤트). 기록 시각은 초 단위라 1초 이상 떨어뜨린다
      await sleep(1200);
      await evaluate(s.cdp, `(() => { const k = 'wu:v1:u:U-A1'; const d = JSON.parse(localStorage.getItem(k)); const n = d.nodes.find((x) => x.id === 'N-001'); const before = JSON.parse(JSON.stringify(n.attrs)); n.attrs = { ...n.attrs, 마감: '월 마감 후 2영업일 이내(R2 시험)' }; const t = new Date(); const p = (x) => String(x).padStart(2, '0'); const off = -t.getTimezoneOffset(); const iso = t.getFullYear() + '-' + p(t.getMonth() + 1) + '-' + p(t.getDate()) + 'T' + p(t.getHours()) + ':' + p(t.getMinutes()) + ':' + p(t.getSeconds()) + (off >= 0 ? '+' : '-') + p(Math.floor(Math.abs(off) / 60)) + ':' + p(Math.abs(off) % 60); n.updated_at = iso; d.events.push({ id: 'E-r2-1', type: 'updated', occurred_at: iso.slice(0, 10), recorded_at: iso, source: 'user', payload: { target_kind: 'node', target_id: 'N-001', before: { attrs: before }, after: { attrs: n.attrs } } }); localStorage.setItem(k, JSON.stringify(d)); location.reload(); })()`).catch(() => {});
      await sleep(500);
      await waitFor(s.cdp, "window.__wu && window.__wu.doc && window.__wu.doc.events.some((e) => e.id === 'E-r2-1') && window.__wu.cy.nodes().length > 0", 8000);
      await r2Draft('U-A1/N-000', 'U-A1/N-011', 'U-A1/N-012');
      const r2Due = await r2Item('일정_마감');
      const r2Art = await r2Item('산출물_문서');
      const r2Mark = r2Due.find((x) => x.text.startsWith('대사 확인'));
      check('R2-T2 지난번 초안 뒤에 대사 확인의 마감을 고치면 「일정·마감」의 대사 확인 줄에 「새로」, 손대지 않은 「산출물·문서 위치」 줄에는 없음', !!r2Mark && r2Mark.text.includes('R2 시험') && r2Mark.marks === 1 && r2Art.length > 0 && r2Art.every((x) => x.marks === 0), JSON.stringify([r2Due, r2Art]));
      check('R2-T2 「새로」 칩 설명(title)에 지난번 초안의 날짜·시각: 「지난번 초안(YYYY-MM-DD hh:mm) 뒤에 생긴 기록이 근거」', !!r2Mark && /^지난번 초안\(\d{4}-\d{2}-\d{2} \d{2}:\d{2}\) 뒤에 생긴 기록이 근거$/.test(r2Mark.title), JSON.stringify(r2Mark));
      await shot(s.cdp, `${browser.name}-r2-draft-new-attr`);
    }

    // ── M5·M7 담당을 넘긴 날: 끝나는 서하늘은 현재 담당이 아니다 ──
    // r2Go는 U-A1 키를 지워 앱이 깨끗한 샘플을 다시 채우게 하므로, 채운 뒤에 고치고 다시 연다
    if ((await r2Go()) && (await (async () => { await evaluate(s.cdp, `(() => { ${R2_HANDOVER}; location.reload(); })()`).catch(() => {}); await sleep(500); return waitFor(s.cdp, "window.__wu && window.__wu.doc && window.__wu.doc.edges.some((e) => e.id === 'L-r2-1') && window.__wu.cy.nodes().length > 0", 8000); })())) {
      await evaluate(s.cdp, "window.__wu.select('U-A1/N-012')");
      await sleep(250);
      const r2Out = await evaluate(s.cdp, "(document.querySelector('[data-testid=person-load]') || {}).textContent || ''");
      await evaluate(s.cdp, "window.__wu.select('U-A1/N-010')");
      await sleep(250);
      const r2In = await evaluate(s.cdp, "(document.querySelector('[data-testid=person-load]') || {}).textContent || ''");
      check('R2-M5 사람 상세: 오늘 담당을 넘기는 서하늘은 「지금 맡은 업무 없음」, 오늘 받는 한가람은 「지금 맡은 업무 1개」', r2Out.includes('지금 맡은 업무 없음') && r2In.includes('지금 맡은 업무 1개'), JSON.stringify([r2Out, r2In]));
      await evaluate(s.cdp, "window.__wu.select('U-A1/N-001')");
      await sleep(250);
      const r2Work = await evaluate(s.cdp, "(document.querySelector('[data-testid=work-load]') || {}).textContent || ''");
      check('R2-M5 업무 상세 「현재 담당」은 받는 한가람만, 넘기는 서하늘은 「(서하늘은 오늘까지)」로만(둘 다 현재로 세지 않음)', r2Work.includes('현재 담당: 한가람 (서하늘은 오늘까지)'), r2Work);
      await evaluate(s.cdp, 'window.__wu.select(null)');
      await clickTestId(s.cdp, 'btn-draft-universe');
      await sleep(200);
      await evaluate(s.cdp, "(() => { const e = document.querySelector('[data-testid=draft-target]'); e.value = 'U-A1/N-001'; e.dispatchEvent(new Event('change')); })()");
      await sleep(250);
      const r2Hold = await evaluate(s.cdp, "({ holder: (document.querySelector('[data-testid=draft-holder]') || {}).textContent || '', from: (document.querySelector('[data-testid=draft-from]') || {}).value })");
      check('R2-M5 초안 화면: 대상을 대사 확인으로 고르면 현재 담당 한 명(한가람)을 보내는 사람으로 미리 고름(넘기는 서하늘은 현재 아님)', r2Hold.holder.includes('현재 담당: 한가람') && r2Hold.from === 'U-A1/N-010', JSON.stringify(r2Hold));
    }
    // 저장소를 블록 시작 때 찍어 둔 상태로 되돌린다(샘플 문서 포함)
    await evaluate(s.cdp, `(() => { const snap = JSON.parse(${JSON.stringify(r2Snap)}); localStorage.clear(); for (const [k, v] of snap) localStorage.setItem(k, v); location.hash = 'U-A1'; location.reload(); })()`).catch(() => {});
    await sleep(500);
    await waitFor(s.cdp, "window.__wu && window.__wu.doc && window.__wu.doc.universe.id === 'U-A1' && window.__wu.cy.nodes().length > 0", 8000);
  }

  // ── 열 번째 검토 결함 수정 화면 점검(RV10, 2026-10-25): S-1 다른 탭 경고, S-6 키 칸, C-10 되감기 한계 안내, C-3 사번 바뀐 연결, S-7 초기화, C-9 미래 날짜 확정 거부.
  //    데이터·설정을 바꾸므로 시작 때 저장소를 찍어 두었다가 끝에서 되돌린다("일상 사용 2회차 R" 블록과 같은 방식) ──
  {
    const rvSnap = await evaluate(s.cdp, 'JSON.stringify(Object.entries(localStorage))');
    const rvFake = ['sk', 'ant', 'x'.repeat(8), 'FAKEKEY', 'y'.repeat(12)].join('-');
    const rvWait = (id) => waitFor(s.cdp, `window.__wu && window.__wu.doc && window.__wu.doc.universe.id === ${JSON.stringify(id)} && window.__wu.cy.nodes().length > 0`, 8000);
    // 저장소를 시작 때 상태로 되돌리고 clean이 가리키는 지도 문서는 지워 깨끗한 샘플로 다시 채운 뒤 mutate를 실행하고 hash 지도를 연다
    const rvGo = async (hash, { mutate = '', clean = [] } = {}) => {
      const rm = clean.map((id) => `localStorage.removeItem('wu:v1:u:${id}');`).join(' ');
      await evaluate(s.cdp, `(() => { const snap = JSON.parse(${JSON.stringify(rvSnap)}); localStorage.clear(); for (const [k, v] of snap) localStorage.setItem(k, v); ${rm} ${mutate}; location.hash = ${JSON.stringify(hash)}; location.reload(); })()`).catch(() => {});
      await sleep(500);
      return rvWait(hash);
    };
    const rvReload = async (id) => {
      await evaluate(s.cdp, 'location.reload()').catch(() => {});
      await sleep(500);
      return rvWait(id);
    };
    const rvBox = (sel) => evaluate(s.cdp, `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { text: e.textContent, w: r.width, h: r.height, hidden: e.hidden }; })()`);
    // 설정에 patch를 얹는다(keepTour가 아니면 따라 하기 기록은 지워 처음 사용 안내가 끼어들지 않게 한다)
    const rvSettings = (patch, keepTour = false) => `{ const v = JSON.parse(localStorage.getItem('wu:v1:settings') || '{}'); ${keepTour ? '' : 'delete v.tourDone;'} Object.assign(v, ${JSON.stringify(patch)}); localStorage.setItem('wu:v1:settings', JSON.stringify(v)); }`;
    const rvOtherTabNote = '다른 탭에서 이 지도가 바뀌었습니다 — 이 탭에서 저장하면 그 내용을 덮어씁니다. 새로 고침하면 최신 내용을 봅니다.';

    // ── S-1 다른 탭 경고 ──
    if (await rvGo('U-A1', { clean: ['U-A1'] })) {
      const w0 = await rvBox('[data-testid=other-tab-warning]');
      check('RV10S-1 지도를 연 화면에서 다른 탭 경고는 처음엔 숨김(hidden, 크기 0)', !!w0 && w0.hidden === true && w0.w === 0 && w0.h === 0, JSON.stringify(w0));
      await evaluate(s.cdp, "window.dispatchEvent(new StorageEvent('storage', { key: 'wu:v1:u:U-K1', storageArea: localStorage }))");
      await sleep(150);
      const wOther = await rvBox('[data-testid=other-tab-warning]');
      check('RV10S-1 다른 지도(U-K1) 문서가 바뀐 이벤트로는 경고가 나타나지 않음', !!wOther && wOther.hidden === true && wOther.w === 0, JSON.stringify(wOther));
      await evaluate(s.cdp, "window.dispatchEvent(new StorageEvent('storage', { key: 'wu:v1:u:U-A1', storageArea: localStorage }))");
      await sleep(150);
      const w1 = await rvBox('[data-testid=other-tab-warning]');
      check('RV10S-1 같은 지도(U-A1) 문서가 다른 탭에서 바뀐 이벤트 → 경고가 나타나고(크기 있음) 글이 OTHER_TAB_NOTE와 같음', !!w1 && w1.hidden === false && w1.w > 100 && w1.h > 10 && w1.text === rvOtherTabNote, JSON.stringify(w1));
      await shot(s.cdp, `${browser.name}-rv10-1-other-tab`);
    } else check('RV10S-1 다른 탭 경고', false, '월말 정산 점검이 열리지 않음');

    // ── S-6 키 칸: 속성 value에 키가 남지 않음 ──
    if (await rvGo('U-A1', { clean: ['U-A1'], mutate: rvSettings({ provider: 'claude_api', apiKey: rvFake }) })) {
      await evaluate(s.cdp, "document.getElementById('settings-open').click()");
      await sleep(200);
      const k = await evaluate(s.cdp, "(() => { const e = document.querySelector('[data-testid=settings-apikey]'); if (!e) return null; const r = e.getBoundingClientRect(); const n = document.querySelector('[data-testid=settings-key-note]'); return { value: e.value, attr: e.getAttribute('value'), ac: e.autocomplete, type: e.type, w: r.width, h: r.height, note: n ? n.textContent : '', inHtml: e.value !== '' && document.documentElement.outerHTML.includes(e.value) }; })()");
      check('RV10S-6 키 칸: .value는 설정에 넣어 둔 키, 속성 value는 없음(null), autocomplete는 new-password', !!k && k.value === rvFake && k.attr === null && k.ac === 'new-password' && k.type === 'password' && k.w > 20 && k.h > 10, JSON.stringify({ ...k, value: k && k.value === rvFake ? '(가짜 키 그대로)' : k && k.value, note: '' }));
      check('RV10S-6 화면 HTML(outerHTML) 어디에도 키 글자가 없음', !!k && k.inHtml === false, JSON.stringify({ inHtml: k && k.inHtml }));
      check('RV10S-6 키 안내(settings-key-note)에 「file://」 문장이 들어감', !!k && k.note.includes('file://') && k.note.includes('다른 로컬 HTML'), k && k.note.slice(0, 160));
      await shot(s.cdp, `${browser.name}-rv10-2-key-box`);
      await clickTestId(s.cdp, 'settings-clear-key');
      await sleep(150);
      const cleared = await evaluate(s.cdp, "({ field: document.querySelector('[data-testid=settings-apikey]').value, stored: 'apiKey' in JSON.parse(localStorage.getItem('wu:v1:settings') || '{}') })");
      check('RV10S-6 뒷정리: 「키 지우기」 뒤 칸이 비고 설정에서 apiKey가 사라짐', cleared.field === '' && cleared.stored === false, JSON.stringify(cleared));
      await clickTestId(s.cdp, 'settings-close');
    } else check('RV10S-6 키 칸', false, '월말 정산 점검이 열리지 않음');

    // ── C-10 되감기 한계 안내: 사용자 이력이 시점 뒤에 있는 시점 ──
    if (await rvGo('U-A1', { clean: ['U-A1'] })) {
      await evaluate(s.cdp, "window.confirm = () => true; window.__wu.select('U-A1/N-002')");
      await sleep(150);
      await clickTestId(s.cdp, 'btn-edit');
      await fillPanelForm(s.cdp, { 'node-label': 'RV10 되감기 시험 이름' });
      await sleep(300);
      await sleep(1100); // 기록 시각은 초 단위: 메모가 이름 수정과 다른 시점에 남게
      await evaluate(s.cdp, "window.__wu.select('U-A1/N-001')");
      await sleep(150);
      await clickTestId(s.cdp, 'btn-event');
      await fillPanelForm(s.cdp, { 'event-type': 'memo', 'event-date': '2026-10-20', 'event-note': 'RV10 되감기 한계 시험 메모' });
      await sleep(300);
      await evaluate(s.cdp, 'window.__wu.select(null)');
      await sleep(150);
      await clickTestId(s.cdp, 'btn-rewind');
      await sleep(400);
      // 가장 오래된 시점(목록 맨 아래)을 고른다
      await evaluate(s.cdp, "(() => { const b = [...document.querySelectorAll('[data-testid=rewind-point]')]; b[b.length - 1].click(); })()");
      await sleep(400);
      const rl = await evaluate(s.cdp, `(() => {
        const at = window.__wu.rewind && window.__wu.rewind.at;
        const user = ['assign_start', 'assign_end', 'handover', 'affiliation_change', 'memo'];
        const expected = at ? window.__wu.doc.events.filter((e) => user.includes(e.type) && Date.parse(e.recorded_at) > Date.parse(at)).length : null;
        const els = [...document.querySelectorAll('[data-testid=rewind-limit]')];
        const hit = els.find((e) => /사용자 이력 \\d+건은 되감아도 그대로 남습니다/.test(e.textContent));
        const m = hit ? /사용자 이력 (\\d+)건은 되감아도 그대로 남습니다/.exec(hit.textContent) : null;
        const r = hit ? hit.getBoundingClientRect() : { width: 0, height: 0 };
        return { at, expected, n: m ? Number(m[1]) : null, w: r.width, h: r.height, count: els.length, text: hit ? hit.textContent : els.map((e) => e.textContent).join(' / ') };
      })()`);
      check('RV10C-10 시점 뒤에 사용자 이력(메모)이 있는 시점을 고르면 rewind-limit 줄에 「사용자 이력 N건은 되감아도 그대로 남습니다」(N>0, 실제 시점 뒤 사용자 이력 수와 같음, 크기 있음)', !!rl && rl.n > 0 && rl.n === rl.expected && rl.w > 100 && rl.h > 10, JSON.stringify(rl));
      await shot(s.cdp, `${browser.name}-rv10-3-rewind-limit`);
      await clickTestId(s.cdp, 'btn-rewind-back');
      await sleep(300);
    } else check('RV10C-10 되감기 한계 안내', false, '월말 정산 점검이 열리지 않음');

    // ── C-3 사번이 바뀐 사번 자동 연결(가상 운영부 U-D1의 I-001: U-A1/N-011 ↔ U-B/N-202, 사번 V-1002) ──
    {
      const ready = await rvGo('U-D1', { clean: ['U-A1', 'U-B', 'U-C', 'U-D1'] }); // 깨끗한 샘플로 다시 채운다
      const changed = ready && await evaluate(s.cdp, "(() => { const k = 'wu:v1:u:U-B'; const raw = localStorage.getItem(k); if (!raw) return 'U-B 문서 없음'; const d = JSON.parse(raw); const n = d.nodes.find((x) => x.id === 'N-202'); if (!n) return 'U-B N-202 없음'; const before = n.emp_no; n.emp_no = 'V-9999'; localStorage.setItem(k, JSON.stringify(d)); const dept = JSON.parse(localStorage.getItem('wu:v1:u:U-D1')); const l = (dept.identity_links || []).find((x) => x.id === 'I-001'); return { before, method: l && l.method, status: l && l.status }; })()");
      check('RV10C-3 준비: 가상 운영부에 사번 자동 연결(emp_no_auto·confirmed)이 있고 한쪽 사번을 바꿔 저장소에 넣음', !!changed && typeof changed === 'object' && changed.method === 'emp_no_auto' && changed.status === 'confirmed' && changed.before === 'V-1002', JSON.stringify(changed));
      if (changed && typeof changed === 'object' && await rvReload('U-D1')) {
        await evaluate(s.cdp, 'window.__wu.select(null)');
        await sleep(250);
        const sl = await rvBox('[data-testid=stale-links]');
        check('RV10C-3 부서 개요의 stale-links 글(크기 있음)에 「통합 확인 목록」이 들어감', !!sl && sl.w > 100 && sl.h > 10 && sl.text.includes('통합 확인 목록') && sl.text.includes('사번이 바뀌어'), JSON.stringify(sl));
        await clickTestId(s.cdp, 'btn-merge');
        await sleep(300);
        const st = await evaluate(s.cdp, "(() => { const li = document.querySelector('[data-testid=merge-persons] li[data-type=stale]'); if (!li) return null; const r = li.getBoundingClientRect(); const chip = li.querySelector('.chip'); const strong = li.querySelector('strong'); return { chip: chip && chip.textContent, title: strong && strong.textContent, text: li.textContent.slice(0, 300), w: r.width, h: r.height, n: document.querySelectorAll('[data-testid=merge-persons] li[data-type=stale]').length }; })()");
        check('RV10C-3 통합 확인 목록 사람 목록에 칩 「사번 바뀜」·제목 「사번이 바뀐 연결: …」 항목이 하나 보임(크기 있음)', !!st && st.chip === '사번 바뀜' && st.title.startsWith('사번이 바뀐 연결: ') && st.w > 100 && st.h > 20 && st.n === 1, JSON.stringify(st));
        await shot(s.cdp, `${browser.name}-rv10-4-stale-link`);
      } else check('RV10C-3 통합 확인 목록', false, '준비 실패 또는 부서 지도가 다시 열리지 않음');
    }

    // ── S-7 가상 데이터 초기화: 점검 기준·마지막 연 지도·초안 본 시각은 지우고 따라 하기 기록은 남김 ──
    {
      const seed = rvSettings({ lastOpenedId: 'U-D1', riskBaseline: { 'U-D1': { at: '2026-10-20T09:00:00+09:00', asOf: '2026-10-20', solo: 1, dense: 1, gaps: 1 } }, tourDone: { first: '2026-10-20T09:00:00+09:00' } }, true)
        + " localStorage.setItem('wu:v1:draft-seen', JSON.stringify({ v: 1, at: { 'U-A1/N-001': '2026-10-20T09:00:00+09:00' } }));";
      if (await rvGo('U-D1', { mutate: seed })) {
        const pre = await evaluate(s.cdp, "(() => { const v = JSON.parse(localStorage.getItem('wu:v1:settings') || '{}'); return { base: !!(v.riskBaseline && v.riskBaseline['U-D1']), last: v.lastOpenedId, tour: !!(v.tourDone && v.tourDone.first), seen: localStorage.getItem('wu:v1:draft-seen') !== null }; })()");
        check('RV10S-7 준비: 초기화 전 설정에 점검 기준·마지막 연 지도(U-D1)·따라 하기 기록, draft-seen 값이 있음', pre.base && pre.last === 'U-D1' && pre.tour && pre.seen, JSON.stringify(pre));
        await evaluate(s.cdp, "window.confirm = () => true; document.getElementById('import-open').click()").catch(() => {});
        await sleep(300);
        await evaluate(s.cdp, "document.getElementById('reset').click()").catch(() => {});
        await sleep(600);
        await rvWait('U-A1');
        const post = await evaluate(s.cdp, "(() => { const v = JSON.parse(localStorage.getItem('wu:v1:settings') || '{}'); return { base: 'riskBaseline' in v, last: v.lastOpenedId || null, tour: !!(v.tourDone && v.tourDone.first), seen: localStorage.getItem('wu:v1:draft-seen') !== null, id: window.__wu.doc.universe.id }; })()");
        check('RV10S-7 초기화 뒤: riskBaseline·draft-seen 없음, 마지막 연 지도는 옛 값(U-D1)이 아님(초기화 뒤 연 지도로 새로 기록됨), tourDone은 남음', !post.base && !post.seen && post.last !== 'U-D1' && post.tour, JSON.stringify(post));
      } else check('RV10S-7 초기화', false, '가상 운영부가 열리지 않음');
    }

    // ── C-9 확정 날짜가 오늘보다 뒤면 거부: 화면은 오늘만 넘기므로, 초안을 그린 뒤 페이지 시계를 이틀 되돌려 "날짜가 오늘보다 뒤"인 상태를 만든다 ──
    if (await rvGo('U-A1', { clean: ['U-A1'] })) {
      await evaluate(s.cdp, 'window.confirm = () => true; window.__wu.select(null)');
      await clickTestId(s.cdp, 'btn-draft-universe');
      await sleep(200);
      await evaluate(s.cdp, `(() => { const set = (id, v) => { const e = document.querySelector('[data-testid=' + id + ']'); e.value = v; e.dispatchEvent(new Event('change')); }; set('draft-target', 'U-A1/N-001'); set('draft-from', 'U-A1/N-012'); set('draft-to', 'U-A1/N-011'); document.querySelector('[data-testid=draft-form] button[type=submit]').click(); })()`);
      await sleep(300);
      const ev0 = await evaluate(s.cdp, 'window.__wu.doc.events.length');
      await evaluate(s.cdp, "(() => { const R = Date; const off = 2 * 864e5; window.__RealDate = R; window.Date = class extends R { constructor(...a) { if (a.length) super(...a); else super(R.now() - off); } static now() { return R.now() - off; } }; })()");
      await clickTestId(s.cdp, 'draft-confirm');
      await sleep(300);
      await evaluate(s.cdp, 'window.Date = window.__RealDate');
      const fm = await evaluate(s.cdp, "(() => { const m = document.querySelector('[data-testid=confirm-message]'); const r = m ? m.getBoundingClientRect() : { width: 0, height: 0 }; return { text: m ? m.textContent : null, code: m ? m.dataset.code : null, w: r.width, h: r.height, events: window.__wu.doc.events.length }; })()");
      check('RV10C-9 확정 날짜가 오늘보다 뒤이면(초안을 그린 뒤 시계를 이틀 되돌림) 「날짜는 오늘보다 뒤일 수 없습니다」로 거부하고 이력이 늘지 않음', !!fm && !!fm.text && fm.text.includes('날짜는 오늘보다 뒤일 수 없습니다') && fm.w > 50 && fm.h > 10 && fm.events === ev0, JSON.stringify({ ...fm, before: ev0 }));
      await shot(s.cdp, `${browser.name}-rv10-5-confirm-future`);
    } else check('RV10C-9 미래 날짜 확정 거부', false, '월말 정산 점검이 열리지 않음');

    // 저장소를 블록 시작 때 찍어 둔 상태로 되돌린다(샘플 문서 포함)
    await evaluate(s.cdp, `(() => { const snap = JSON.parse(${JSON.stringify(rvSnap)}); localStorage.clear(); for (const [k, v] of snap) localStorage.setItem(k, v); location.hash = 'U-A1'; location.reload(); })()`).catch(() => {});
    await sleep(500);
    await rvWait('U-A1');
  }

  // ── CR-21 길 찾기(2026-10-25): C 개요 목적별 묶음·「무엇을 할까요?」 단추, B 쓴 것 바로 보이기(이력에서 보기·최근 기록), A 기능 찾기(머리글 「무엇을 할까요?」).
  //    데이터·설정을 바꾸므로 시작 때 저장소를 찍어 두었다가 끝에서 되돌린다(RV10 블록과 같은 방식) ──
  {
    const c21Snap = await evaluate(s.cdp, 'JSON.stringify(Object.entries(localStorage))');
    const c21Wait = (id, nodes = true) => waitFor(s.cdp, `window.__wu && window.__wu.doc && window.__wu.doc.universe.id === ${JSON.stringify(id)}${nodes ? ' && window.__wu.cy.nodes().length > 0' : ''}`, 8000); // 읽기 전용(문서 버전이 새로움)은 그래프가 비어 열릴 수 있어 nodes=false
    // 저장소를 시작 때 상태로 되돌리고 clean이 가리키는 지도는 지워 깨끗한 샘플로 다시 채운 뒤 mutate를 실행하고 hash 지도를 연다. 따라 하기 안내가 끼어들지 않게 tourDone을 채운다
    const c21Go = async (hash, { mutate = '', clean = [], nodes = true } = {}) => {
      const rm = clean.map((id) => `localStorage.removeItem('wu:v1:u:${id}');`).join(' ');
      await evaluate(s.cdp, `(() => { const snap = JSON.parse(${JSON.stringify(c21Snap)}); localStorage.clear(); for (const [k, v] of snap) localStorage.setItem(k, v); ${rm} ${mutate}; location.hash = ${JSON.stringify(hash)}; location.reload(); })()`).catch(() => {});
      await sleep(500);
      return c21Wait(hash, nodes);
    };
    // 읽기 전용 지도: 샘플은 고치기 전까지 저장소에 없으므로, 깨끗한 U-A1을 연 뒤 지금 문서를 문서 버전 2.0으로 저장하고 다시 연다(문서 버전이 새로워 읽기 전용, 그래프는 비어 열림)
    const c21GoReadOnly = async () => {
      if (!(await c21Go('U-A1', { clean: ['U-A1'] }))) return false;
      await evaluate(s.cdp, "(() => { const d = JSON.parse(JSON.stringify(window.__wu.doc)); d.schema_version = '2.0'; localStorage.setItem('wu:v1:u:U-A1', JSON.stringify(d)); location.reload(); })()").catch(() => {});
      await sleep(500);
      return c21Wait('U-A1', false);
    };
    // 요소 정보: 있음·크기·숨김·글자
    const c21Box = (sel) => evaluate(s.cdp, `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { w: r.width, h: r.height, top: r.top, left: r.left, bottom: r.bottom, right: r.right, text: e.textContent, flash: e.classList.contains('goal-flash') }; })()`);
    // a가 b보다 문서에서 앞인가
    const c21Before = (a, b) => evaluate(s.cdp, `(() => { const x = document.querySelector(${JSON.stringify(a)}); const y = document.querySelector(${JSON.stringify(b)}); return !!x && !!y && !!(x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING); })()`);
    // 위 요소 안에 아래 요소가 있는가
    const c21In = (outer, inner) => evaluate(s.cdp, `!!document.querySelector(${JSON.stringify(outer)} + ' ' + ${JSON.stringify(inner)})`);
    const c21InView = (sel) => evaluate(s.cdp, `(() => { const e = document.querySelector(${JSON.stringify(sel)}); const a = document.querySelector('aside').getBoundingClientRect(); if (!e) return false; const r = e.getBoundingClientRect(); return r.height > 0 && r.top >= a.top - 1 && r.bottom <= a.bottom + 1; })()`);
    const c21Type = async (q) => {
      await evaluate(s.cdp, `(() => { const i = document.querySelector('[data-testid=feature-find]'); i.focus(); i.value = ${JSON.stringify(q)}; i.dispatchEvent(new Event('input')); })()`);
      await sleep(120);
    };
    const c21Hits = () => evaluate(s.cdp, "[...document.querySelectorAll('[data-testid=feature-find-result]')].map((b) => ({ id: b.dataset.id, off: b.getAttribute('aria-disabled') === 'true', text: b.textContent }))");
    const c21Click = (id) => evaluate(s.cdp, `document.querySelector('[data-testid=feature-find-result][data-id=${id}]').click()`);
    const c21Flash = (sel) => evaluate(s.cdp, `(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !!e && e.classList.contains('goal-flash'); })()`);
    const c21Doc = () => evaluate(s.cdp, 'window.__wu.doc.events.length');
    // 「이번 주 기록」으로 기록 하나 남기고 {알림 글, 알림 안 「이력에서 보기」 단추 유무}를 돌려준다(첫 업무 선택)
    const c21Weekly = async (note, category = 'in_progress') => {
      await evaluate(s.cdp, `(() => { const q = (id) => document.querySelector('[data-testid=' + id + ']'); const w = q('weekly-work'); w.value = w.options[1].value; w.dispatchEvent(new Event('change')); const c = q('weekly-category'); c.value = ${JSON.stringify(category)}; c.dispatchEvent(new Event('change')); q('weekly-note').value = ${JSON.stringify(note)}; q('weekly-add').click(); })()`);
      await sleep(250);
      return evaluate(s.cdp, "(() => { const d = document.querySelector('[data-testid=weekly-done]'); return d ? { text: d.textContent, btn: !!d.querySelector('[data-testid=goto-history]') } : null; })()");
    };

    // ── C 개요 목적별 묶음 ──
    if (await c21Go('U-A1', { clean: ['U-A1'] })) {
      await evaluate(s.cdp, 'window.__wu.select(null)');
      await sleep(200);
      const labels = await evaluate(s.cdp, "['goal-record', 'goal-handover', 'goal-check', 'goal-edit'].map((id) => { const b = document.querySelector('[data-testid=' + id + ']'); const r = b ? b.getBoundingClientRect() : { width: 0, height: 0 }; return { id, text: b ? b.textContent : null, w: r.width, h: r.height }; })");
      check('CR-21 C 「무엇을 할까요?」 단추 4개(기록하기·인수인계·점검·지도 고치기)가 크기가 있게 보임, 글자가 꺾이지 않음(높이 < 44)', labels.map((l) => l.text).join('|') === '기록하기|인수인계|점검|지도 고치기' && labels.every((l) => l.w > 40 && l.h > 10 && l.h < 44), JSON.stringify(labels));
      const barRow = await evaluate(s.cdp, "(() => { const bs = [...document.querySelectorAll('[data-testid=goal-bar] button')]; return { tops: bs.map((b) => Math.round(b.getBoundingClientRect().top)), over: bs.some((b) => b.scrollWidth > b.clientWidth + 1) }; })()");
      check('CR-21 C 기본 패널 폭(380px)에서 단추 4개가 한 줄이고 글자가 잘리지 않음', barRow.tops.length === 4 && new Set(barRow.tops).size === 1 && !barRow.over, JSON.stringify(barRow));
      check('CR-21 C 단추 줄이 지도 요약(규모) 바로 아래, 그 뒤로 묶음 4개가 기록하기 → 인수인계 → 점검 → 지도 고치기 순',
        (await c21Before('[data-testid=summary]', '[data-testid=goal-bar]')) && (await c21Before('[data-testid=goal-bar]', '[data-testid=goal-sec-record]')) && (await c21Before('[data-testid=goal-sec-record]', '[data-testid=goal-sec-handover]')) && (await c21Before('[data-testid=goal-sec-handover]', '[data-testid=goal-sec-check]')) && (await c21Before('[data-testid=goal-sec-check]', '[data-testid=goal-sec-edit]')) && (await c21Before('[data-testid=goal-sec-edit]', '[data-testid=overview-help]')));
      const heads = await evaluate(s.cdp, "['record', 'handover', 'check', 'edit'].map((k) => { const s = document.querySelector('[data-testid=goal-sec-' + k + ']'); return s ? { h3: s.querySelector('h3').tagName === 'H3' ? s.querySelector('h3').textContent : null, desc: s.querySelector('.goal-desc') ? s.querySelector('.goal-desc').textContent : null } : null; })");
      check('CR-21 C 묶음마다 머리글(h3)과 한 줄 설명', heads.every((h) => h && h.h3 && h.desc && h.desc.length > 10) && heads.map((h) => h.h3).join('|') === '기록하기|인수인계|점검|지도 고치기', JSON.stringify(heads));
      check('CR-21 C 기존 요소가 묶음 안에: 기록하기(미해결 입구·이번 주 기록·최근 기록)', (await c21In('[data-testid=goal-sec-record]', '[data-testid=issue-count]')) && (await c21In('[data-testid=goal-sec-record]', '[data-testid=weekly-quick]')) && (await c21In('[data-testid=goal-sec-record]', '[data-testid=recent-records]')));
      check('CR-21 C 기존 요소가 묶음 안에: 인수인계(초안 만들기 단추·담당 바꾸기 안내 한 줄)', (await c21In('[data-testid=goal-sec-handover]', '[data-testid=btn-draft-universe]')) && (await c21In('[data-testid=goal-sec-handover]', '[data-testid=handover-assignee-hint]')) && (await text(s.cdp, '[data-testid=handover-assignee-hint]')).includes('「담당 바꾸기」'));
      check('CR-21 C 기존 요소가 묶음 안에: 점검(인사이트 보기·설명 줄, 묶지 않은 지도는 매주 점검 안내 한 줄)', (await c21In('[data-testid=goal-sec-check]', '[data-testid=btn-insight-universe]')) && (await c21In('[data-testid=goal-sec-check]', '[data-testid=insight-hint]')) && (await c21In('[data-testid=goal-sec-check]', '[data-testid=check-ungrouped-note]')) && (await text(s.cdp, '[data-testid=check-ungrouped-note]')).includes('묶은 지도에서 합니다') && !(await c21Box('[data-testid=team-risk-summary]')));
      check('CR-21 C 기존 요소가 묶음 안에: 지도 고치기(추가 열기·편집 되감기 입구·폴더 연결 입구)', (await c21In('[data-testid=goal-sec-edit]', '[data-testid=goal-add-open]')) && ((await c21In('[data-testid=goal-sec-edit]', '[data-testid=rewind-entry]')) || (await c21In('[data-testid=goal-sec-edit]', '[data-testid=rewind-grouped-note]'))) && ((await c21In('[data-testid=goal-sec-edit]', '[data-testid=folder-entry]')) || !(await c21Box('[data-testid=folder-entry]'))));
      const help = await evaluate(s.cdp, "(() => { const d = document.querySelector('[data-testid=overview-help]'); return d ? { tag: d.tagName, open: d.open, summary: d.querySelector('summary').textContent, hint: !!d.querySelector('[data-testid=hint]'), term: !!d.querySelector('[data-testid=term-note]') } : null; })()");
      check('CR-21 C 일반 안내(hint·term-note)는 맨 아래 접힌 「처음이면 읽어 보세요」(overview-help)', !!help && help.tag === 'DETAILS' && help.open === false && help.summary === '처음이면 읽어 보세요' && help.hint && help.term, JSON.stringify(help));
      await shot(s.cdp, `${browser.name}-cr21-1-overview`);
      // 단추 → 스크롤·머리 강조
      await clickTestId(s.cdp, 'goal-edit');
      await sleep(150);
      const f1 = await c21Box('[data-testid=goal-sec-edit] h3');
      check('CR-21 C 「지도 고치기」 단추 → 그 묶음 머리가 패널 안에 보이고 강조(goal-flash)', !!f1 && f1.flash && (await c21InView('[data-testid=goal-sec-edit] h3')), JSON.stringify(f1));
      await shot(s.cdp, `${browser.name}-cr21-2-goal-edit`);
      check('CR-21 C 강조는 잠깐 뒤(약 1.5초) 사라짐', await waitFor(s.cdp, "!document.querySelector('[data-testid=goal-sec-edit] h3').classList.contains('goal-flash')", 3500));
      await clickTestId(s.cdp, 'goal-record');
      await sleep(150);
      const f2 = await c21Box('[data-testid=goal-sec-record] h3');
      check('CR-21 C 「기록하기」 단추 → 묶음 머리가 보이고 강조', !!f2 && f2.flash && (await c21InView('[data-testid=goal-sec-record] h3')), JSON.stringify(f2));
      await clickTestId(s.cdp, 'goal-check');
      await sleep(150);
      check('CR-21 C 「점검」 단추 → 묶음 머리 강조·보임', (await c21Flash('[data-testid=goal-sec-check] h3')) && (await c21InView('[data-testid=goal-sec-check] h3')));
      await clickTestId(s.cdp, 'goal-handover');
      await sleep(150);
      check('CR-21 C 「인수인계」 단추 → 묶음 머리 강조·보임', (await c21Flash('[data-testid=goal-sec-handover] h3')) && (await c21InView('[data-testid=goal-sec-handover] h3')));
      // 「사람·업무·문서 추가」 열기
      await evaluate(s.cdp, "document.querySelector('details.add').open = false");
      await clickTestId(s.cdp, 'goal-add-open');
      await sleep(150);
      check('CR-21 C 「지도 고치기」의 「사람·업무·문서 추가」 단추 → 아래 추가 칸이 펼쳐지고 보임', (await evaluate(s.cdp, "document.querySelector('details.add').open")) && (await c21InView('details.add summary')));
      // 좁은 패널(330px 이하 안쪽 폭)에서는 2×2
      await evaluate(s.cdp, "(() => { const a = document.querySelector('aside'); a.style.width = '300px'; a.scrollTop = 0; })()");
      await sleep(150);
      const narrow = await evaluate(s.cdp, "(() => { const bs = [...document.querySelectorAll('[data-testid=goal-bar] button')]; return { cols: getComputedStyle(document.querySelector('[data-testid=goal-bar]')).gridTemplateColumns.split(' ').length, tops: new Set(bs.map((b) => Math.round(b.getBoundingClientRect().top))).size, over: bs.some((b) => b.scrollWidth > b.clientWidth + 1) }; })()");
      check('CR-21 C 패널을 좁히면(300px) 단추가 2×2로 내려가고 글자가 잘리지 않음', narrow.cols === 2 && narrow.tops === 2 && !narrow.over, JSON.stringify(narrow));
      await shot(s.cdp, `${browser.name}-cr21-3-goal-narrow`);
      await evaluate(s.cdp, "document.querySelector('aside').style.width = ''");
    } else check('CR-21 C 개요', false, '월말 정산 점검이 열리지 않음');

    // 묶은 지도: 점검 묶음에 위험 요약·지난 점검 대비, 지도 고치기 묶음에 통합 확인
    if (await c21Go('U-D1', { clean: ['U-D1'] })) {
      await evaluate(s.cdp, 'window.__wu.select(null)');
      await sleep(200);
      check('CR-21 C 묶은 지도: 위험 요약·지난 점검 대비·이번 점검 저장이 「점검」 묶음 안, 매주 점검 안내 한 줄은 없음',
        (await c21In('[data-testid=goal-sec-check]', '[data-testid=team-risk-summary]')) && (await c21In('[data-testid=goal-sec-check]', '[data-testid=team-risk-compare]')) && (await c21In('[data-testid=goal-sec-check]', '[data-testid=btn-risk-baseline-save]')) && (await c21In('[data-testid=goal-sec-check]', '[data-testid=btn-insight-universe]')) && !(await c21Box('[data-testid=check-ungrouped-note]')));
      check('CR-21 C 묶은 지도: 통합 확인 목록 입구가 「지도 고치기」 묶음 안, 위험 요약이 「점검」 묶음 맨 앞', (await c21In('[data-testid=goal-sec-edit]', '[data-testid=merge-hint]')) && (await evaluate(s.cdp, "document.querySelector('[data-testid=goal-sec-check]').children[2].getAttribute('data-testid') === 'team-risk-summary'")));
      await shot(s.cdp, `${browser.name}-cr21-4-overview-grouped`);
    } else check('CR-21 C 묶은 지도 개요', false, '가상 운영부가 열리지 않음');

    // 읽기 전용(문서 버전이 새로워 열림): 편집 기능이 원래 안 보이는 규칙 그대로 — 기록·추가 입구가 없고, 비면 묶음도 숨김
    if (await c21GoReadOnly()) {
      await evaluate(s.cdp, 'window.__wu.select(null)');
      await sleep(200);
      const ro = await evaluate(s.cdp, "({ ro: window.__wu.readOnly, weekly: !!document.querySelector('[data-testid=weekly-quick]'), add: !!document.querySelector('[data-testid=goal-add-open]'), hint: !!document.querySelector('[data-testid=handover-assignee-hint]'), bar: [...document.querySelectorAll('[data-testid=goal-bar] button')].map((b) => b.textContent), secs: ['record', 'handover', 'check', 'edit'].filter((k) => document.querySelector('[data-testid=goal-sec-' + k + ']')) })");
      check('CR-21 C 읽기 전용: 이번 주 기록·추가 열기·담당 바꾸기 안내는 없고, 보이는 묶음과 단추가 짝(빈 묶음 단추 숨김)', ro.ro === true && !ro.weekly && !ro.add && !ro.hint && ro.bar.length === ro.secs.length && ro.secs.includes('record') && ro.secs.includes('check'), JSON.stringify(ro));
    } else check('CR-21 C 읽기 전용 개요', false, '월말 정산 점검이 열리지 않음');

    // ── B 쓴 것 바로 보이기 ──
    if (await c21Go('U-A1', { clean: ['U-A1'] })) {
      await evaluate(s.cdp, 'window.__wu.select(null)');
      await sleep(200);
      const emptyText = await text(s.cdp, '[data-testid=recent-empty]');
      check('CR-21 B-2 처음(샘플 기록뿐)에는 개요 「최근 기록」이 「아직 남긴 기록이 없습니다 — 「이번 주 기록」에 첫 기록을 남겨 보세요」', emptyText === '아직 남긴 기록이 없습니다 — 「이번 주 기록」에 첫 기록을 남겨 보세요' && !(await c21Box('[data-testid=recent-item]')), emptyText);
      const ev0 = await c21Doc();
      const w1 = await c21Weekly('길찾기 첫 기록');
      check('CR-21 B-1 「이번 주 기록」 알림 줄 끝에 「이력에서 보기」 단추(goto-history)가 있고 기록이 한 건 늘었다', !!w1 && w1.btn && w1.text.includes('길찾기 첫 기록') && w1.text.endsWith('이력에서 보기') && (await c21Doc()) === ev0 + 1, JSON.stringify(w1));
      const r1 = await evaluate(s.cdp, "[...document.querySelectorAll('[data-testid=recent-item]')].map((li) => li.textContent)");
      check('CR-21 B-2 방금 기록이 「최근 기록」 맨 위에 날짜·업무·종류·내용과 함께 보임(1건)', r1.length === 1 && r1[0].includes('길찾기 첫 기록') && r1[0].includes('진행 중') && /\d{4}-\d{2}-\d{2}/.test(r1[0]) && r1[0].includes('보기'), JSON.stringify(r1));
      await shot(s.cdp, `${browser.name}-cr21-5-recent`);
      // 알림의 「이력에서 보기」
      await clickTestId(s.cdp, 'goto-history');
      await sleep(300);
      const h1 = await evaluate(s.cdp, "(() => { const li = document.querySelector('#detail [data-just-added=\"1\"]'); const sel = window.__wu.selected; return { sel, text: li ? li.textContent : null, n: document.querySelectorAll('#detail [data-just-added]').length }; })()");
      check('CR-21 B-1 「이력에서 보기」 → 그 업무가 선택되고 상세 이력의 방금 기록한 줄 하나가 강조(data-just-added)', !!h1.sel && h1.n === 1 && !!h1.text && h1.text.includes('길찾기 첫 기록'), JSON.stringify(h1));
      check('CR-21 B-1 강조된 줄이 패널 안에 보이도록 스크롤됨', await c21InView('#detail [data-just-added="1"]'));
      await shot(s.cdp, `${browser.name}-cr21-6-history-highlight`);
      check('CR-21 B-1 강조는 몇 초 뒤 사라지고(줄은 그대로) 이력에 남음', (await waitFor(s.cdp, "document.querySelectorAll('[data-just-added]').length === 0", 9000)) && (await text(s.cdp, '[data-testid=history]')).includes('길찾기 첫 기록'));
      // 개요 「최근 기록」의 「보기」
      await clickTestId(s.cdp, 'detail-back-universe');
      await sleep(250);
      await clickTestId(s.cdp, 'recent-go');
      await sleep(300);
      const h2 = await evaluate(s.cdp, "(() => { const li = document.querySelector('#detail [data-just-added=\"1\"]'); return { sel: window.__wu.selected, text: li ? li.textContent : null }; })()");
      check('CR-21 B-2 「최근 기록」의 「보기」 → 그 업무를 고르고 이력의 그 줄을 강조', !!h2.sel && !!h2.text && h2.text.includes('길찾기 첫 기록'), JSON.stringify(h2));
      // 6건 넘게 쌓으면 최근 5건만, 기록 시각 늦은 순
      await clickTestId(s.cdp, 'detail-back-universe');
      await sleep(250);
      for (let i = 2; i <= 6; i += 1) await c21Weekly(`길찾기 기록 ${i}`);
      const r6 = await evaluate(s.cdp, "[...document.querySelectorAll('[data-testid=recent-item]')].map((li) => li.textContent)");
      check('CR-21 B-2 기록이 6건이면 최근 5건만, 늦게 기록한 것이 위(6→5→4→3→2)', r6.length === 5 && r6.every((t, i) => t.includes(`길찾기 기록 ${6 - i}`)), JSON.stringify(r6));
      // 업무 상세 「이력 추가」 → 바로 그 줄 강조(알림 단추 없이)
      await evaluate(s.cdp, "window.__wu.select('U-A1/N-001')");
      await sleep(200);
      await clickTestId(s.cdp, 'btn-event');
      await fillPanelForm(s.cdp, { 'event-type': 'memo', 'event-date': '2026-10-03', 'event-note': '이력 추가 강조 시험' });
      await sleep(350);
      const h3 = await evaluate(s.cdp, "(() => { const li = document.querySelector('#detail [data-just-added=\"1\"]'); return { text: li ? li.textContent : null, n: document.querySelectorAll('#detail [data-just-added]').length, btn: !!document.querySelector('#detail [data-testid=goto-history]') }; })()");
      check('CR-21 B-1 업무 상세 「이력 추가」 저장 직후 방금 기록한 줄이 바로 강조(단추 없이)되고 패널 안에 보임', h3.n === 1 && !!h3.text && h3.text.includes('이력 추가 강조 시험') && !h3.btn && (await c21InView('#detail [data-just-added="1"]')), JSON.stringify(h3));
      // 「해결로 표시」 → 알림 + 「이력에서 보기」
      await evaluate(s.cdp, 'window.__wu.select(null)');
      await sleep(200);
      await clickTestId(s.cdp, 'btn-issues');
      await sleep(250);
      await evaluate(s.cdp, "document.querySelector('[data-testid=btn-resolve]').click()");
      await sleep(300);
      const rd = await evaluate(s.cdp, "(() => { const d = document.querySelector('[data-testid=resolve-done]'); return d ? { text: d.textContent, btn: !!d.querySelector('[data-testid=goto-history]') } : null; })()");
      check('CR-21 B-1 「해결로 표시」 뒤 알림 줄(해결로 표시했습니다)에 「이력에서 보기」 단추', !!rd && rd.text.includes('해결로 표시했습니다') && rd.btn, JSON.stringify(rd));
      if (rd && rd.btn) {
        await clickTestId(s.cdp, 'goto-history');
        await sleep(300);
        const h4 = await evaluate(s.cdp, "(() => { const li = document.querySelector('#detail [data-just-added=\"1\"]'); return { sel: window.__wu.selected, text: li ? li.textContent : null }; })()");
        check('CR-21 B-1 해결 알림의 「이력에서 보기」 → 그 업무의 이력에서 방금 남긴 「해결됨」 줄이 강조', !!h4.sel && !!h4.text && h4.text.includes('해결됨'), JSON.stringify(h4));
      }
    } else check('CR-21 B 쓴 것 바로 보이기', false, '월말 정산 점검이 열리지 않음');

    // ── A 기능 찾기 ──
    if (await c21Go('U-A1', { clean: ['U-A1'] })) {
      await evaluate(s.cdp, 'window.__wu.select(null)');
      await sleep(200);
      const geo = await evaluate(s.cdp, "(() => { const i = document.querySelector('[data-testid=feature-find]'); const p = document.getElementById('universe-picker'); const h = document.querySelector('body > header'); const ir = i ? i.getBoundingClientRect() : null; const pr = p.getBoundingClientRect(); return { has: !!i, ph: i && i.placeholder, left: ir && ir.left, pright: pr.right, w: ir && ir.width, h: ir && ir.height, headerH: h.getBoundingClientRect().height, aria: i && i.getAttribute('aria-label'), top: ir && ir.top, ptop: pr.top }; })()");
      check('CR-21 A 머리글 업무 지도 선택 오른쪽에 「무엇을 할까요?」 검색 칸(placeholder 「무엇을 할까요? 예: 담당, 미해결, 점검」), 같은 줄·크기 있음, 머리글은 한 줄', geo.has && geo.ph === '무엇을 할까요? 예: 담당, 미해결, 점검' && geo.left >= geo.pright - 1 && geo.w >= 120 && geo.h > 10 && Math.abs(geo.top - geo.ptop) < 20 && geo.headerH < 70, JSON.stringify(geo));
      // 담당 → 담당 바꾸기 (업무를 고르지 않은 상태)
      await c21Type('담당');
      const hits = await c21Hits();
      check('CR-21 A 「담당」을 치면 결과 목록(최대 6개)에 「담당 바꾸기」가 있고 이름·위치 설명·「바로 가기」가 보임', hits.length >= 1 && hits.length <= 6 && hits.some((h) => h.id === 'assignee' && h.text.includes('담당 바꾸기') && h.text.includes('업무를 고른 뒤') && h.text.includes('바로 가기')), JSON.stringify(hits));
      await shot(s.cdp, `${browser.name}-cr21-7-feature-find`);
      await c21Click('assignee');
      await sleep(250);
      const pick = await evaluate(s.cdp, "({ head: (document.querySelector('[data-testid=feature-find-pick]') || {}).textContent || null, works: [...document.querySelectorAll('[data-testid=feature-find-work]')].map((b) => b.textContent) })");
      check('CR-21 A 업무를 안 고르고 「담당 바꾸기」 → 「그래프에서 업무를 먼저 고르세요」와 업무 이름 목록(최대 8개)', !!pick.head && pick.head.includes('그래프에서 업무를 먼저 고르세요') && pick.works.length >= 1 && pick.works.length <= 8, JSON.stringify(pick));
      await shot(s.cdp, `${browser.name}-cr21-8-feature-pick`);
      await evaluate(s.cdp, "document.querySelector('[data-testid=feature-find-work]').click()");
      await sleep(350);
      const asg = await evaluate(s.cdp, "(() => { const d = document.querySelector('#detail [data-testid=assignee-change]'); return { sel: window.__wu.selected, open: d ? d.open : null, flash: d ? d.classList.contains('goal-flash') : null }; })()");
      check('CR-21 A 업무 이름을 누르면 그 업무가 골라지고 상세의 「담당 바꾸기」 상자가 펼쳐져 강조', !!asg.sel && asg.open === true && asg.flash === true, JSON.stringify(asg));
      await shot(s.cdp, `${browser.name}-cr21-9-feature-assignee`);
      // 업무를 이미 고른 상태에서는 목록 없이 바로
      await evaluate(s.cdp, "window.__wu.select('U-A1/N-002')");
      await sleep(200);
      await c21Type('담당 바꾸기');
      await c21Click('assignee');
      await sleep(300);
      const asg2 = await evaluate(s.cdp, "(() => { const d = document.querySelector('#detail [data-testid=assignee-change]'); return { sel: window.__wu.selected, open: d ? d.open : null, pick: !!document.querySelector('[data-testid=feature-find-pick]') }; })()");
      check('CR-21 A 업무를 이미 고른 상태에서 「담당 바꾸기」 → 업무 목록 없이 그 업무의 상자가 바로 펼쳐짐(선택 유지)', asg2.sel === 'U-A1/N-002' && asg2.open === true && !asg2.pick, JSON.stringify(asg2));
      // 점검 → 점검 묶음
      await c21Type('점검');
      const hp = await c21Hits();
      check('CR-21 A 「점검」 → 첫 결과가 매주 점검(점검 묶음)', hp.length >= 1 && hp[0].id === 'weekly-check', JSON.stringify(hp.map((h) => h.id)));
      await c21Click('weekly-check');
      await sleep(300);
      const chk = await evaluate(s.cdp, "({ sel: window.__wu.selected, head: !!document.querySelector('[data-testid=goal-sec-check] h3.goal-flash') })");
      check('CR-21 A 「점검」 결과를 고르면 선택이 풀리고 개요의 「점검」 묶음 머리가 보이며 강조', chk.sel === null && chk.head && (await c21InView('[data-testid=goal-sec-check] h3')), JSON.stringify(chk));
      // 미해결 → 개요 요소
      await c21Type('미해결');
      await c21Click('issues');
      await sleep(250);
      check('CR-21 A 「미해결」 → 개요의 「미해결 n건」 줄로 가서 강조', (await c21Flash('[data-testid=issue-count]')) && (await c21InView('[data-testid=issue-count]')));
      // 글로 → 창
      await c21Type('글로');
      const hg = await c21Hits();
      check('CR-21 A 「글로」 → 첫 결과가 「글로 추가」', hg.length >= 1 && hg[0].id === 'text-add' && !hg[0].off, JSON.stringify(hg));
      await c21Click('text-add');
      await sleep(300);
      check('CR-21 A 「글로 추가」 결과 → 글로 추가 창이 열림', await evaluate(s.cdp, "document.getElementById('text-add-dialog').open"));
      await shot(s.cdp, `${browser.name}-cr21-10-feature-textadd`);
      await evaluate(s.cdp, "document.getElementById('text-add-dialog').close()");
      // 설정·폴더·가져오기 탭
      await c21Type('설정');
      await c21Click('settings');
      await sleep(250);
      check('CR-21 A 「설정」 결과 → 설정 패널이 열림', !!(await c21Box('#detail [data-testid=settings-close]')));
      await evaluate(s.cdp, "document.querySelector('[data-testid=settings-close]').click()");
      await c21Type('백업');
      await c21Click('json-export');
      await sleep(300);
      check('CR-21 A 「백업」 → JSON 내보내기 → 가져오기·내보내기 창의 「내보내기」 탭이 열림', await evaluate(s.cdp, "document.getElementById('import-dialog').open && document.querySelector('[data-testid=import-tab-export]').classList.contains('active')"));
      await evaluate(s.cdp, "document.getElementById('import-dialog').close()");
      // 키보드: ↓ → Enter, Esc
      await c21Type('기록');
      await evaluate(s.cdp, "(() => { const i = document.querySelector('[data-testid=feature-find]'); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); })()");
      await sleep(100);
      check('CR-21 A Esc로 결과 목록이 닫히고 글자는 남음', (await evaluate(s.cdp, "document.querySelector('[data-testid=feature-find-list]').hidden")) && (await evaluate(s.cdp, "document.querySelector('[data-testid=feature-find]').value")) === '기록');
      await evaluate(s.cdp, "(() => { const i = document.querySelector('[data-testid=feature-find]'); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()");
      await sleep(300);
      check('CR-21 A Enter는 첫 결과(이번 주 기록)로 간다: 개요의 이번 주 기록 상자가 강조', (await c21Flash('[data-testid=weekly-quick]')) && (await evaluate(s.cdp, "document.querySelector('[data-testid=feature-find]').value")) === '');
      await c21Type('zzqqxx');
      check('CR-21 A 맞는 기능이 없으면 「찾는 기능 없음」 안내', (await text(s.cdp, '[data-testid=feature-find-none]')).includes('찾는 기능 없음'));
      await c21Type('');
    } else check('CR-21 A 기능 찾기', false, '월말 정산 점검이 열리지 않음');

    // 읽기 전용에서는 쓸 수 없는 기능이 흐리게 + 이유, 눌러도 가지 않음 / 묶은 지도에서 못 쓰는 기능
    if (await c21GoReadOnly()) {
      await c21Type('글로');
      const hr = await c21Hits();
      check('CR-21 A 읽기 전용: 「글로 추가」 결과가 흐리게(aria-disabled)이고 「이 화면에서는 쓸 수 없음(읽기 전용)」', hr.length >= 1 && hr[0].id === 'text-add' && hr[0].off && hr[0].text.includes('이 화면에서는 쓸 수 없음(읽기 전용)'), JSON.stringify(hr));
      await shot(s.cdp, `${browser.name}-cr21-11-feature-readonly`);
      await c21Click('text-add');
      await sleep(250);
      check('CR-21 A 읽기 전용에서 흐린 결과를 눌러도 창이 열리지 않음', !(await evaluate(s.cdp, "document.getElementById('text-add-dialog').open")));
      await c21Type('인사이트');
      const hi = await c21Hits();
      check('CR-21 A 읽기 전용에서도 보기만 하는 기능(인사이트)은 흐리지 않음', hi.length >= 1 && hi[0].id === 'insight' && !hi[0].off, JSON.stringify(hi));
    } else check('CR-21 A 읽기 전용', false, '월말 정산 점검이 열리지 않음');
    if (await c21Go('U-D1', { clean: ['U-D1'] })) {
      await c21Type('되감기');
      const hw = await c21Hits();
      check('CR-21 A 묶은 지도: 「편집 되감기」 결과가 흐리게 + 「묶은 지도」 이유', hw.length >= 1 && hw[0].id === 'rewind' && hw[0].off && hw[0].text.includes('묶은 지도'), JSON.stringify(hw));
      await c21Type('글로');
      const hw2 = await c21Hits();
      check('CR-21 A 묶은 지도: 「글로 추가」도 흐리게', hw2.length >= 1 && hw2[0].id === 'text-add' && hw2[0].off, JSON.stringify(hw2));
      await c21Type('매주 점검');
      await c21Click('weekly-check');
      await sleep(300);
      check('CR-21 A 묶은 지도: 매주 점검 → 지난 점검 대비 줄(team-risk-compare)로 가서 강조', (await c21Flash('[data-testid=team-risk-compare]')) && (await c21InView('[data-testid=team-risk-compare]')));
      await c21Type('');
    } else check('CR-21 A 묶은 지도', false, '가상 운영부가 열리지 않음');

    // 저장소를 블록 시작 때 찍어 둔 상태로 되돌린다(샘플 문서 포함)
    await evaluate(s.cdp, `(() => { const snap = JSON.parse(${JSON.stringify(c21Snap)}); localStorage.clear(); for (const [k, v] of snap) localStorage.setItem(k, v); location.hash = 'U-A1'; location.reload(); })()`).catch(() => {});
    await sleep(500);
    await c21Wait('U-A1');
  }

  // ── CR-14 A 편집 되감기(R-25, D-30): 이름 수정 → 개요 「편집 되감기」 → 이전 시점 → 읽기 전용 확인 → 지금으로 → 다시 → 되돌리기. 데이터를 바꾸므로 끝부분 ──
  await reloadApp();
  const rwOld = await evaluate(s.cdp, "window.__wu.doc.nodes.find((n) => n.id === 'N-002').label");
  const rwNew = '되감기 시험 새 이름';
  await sleep(1100); // 기록 시각은 초 단위: 앞의 수정과 다른 판이 되게
  await evaluate(s.cdp, "window.__wu.select('U-A1/N-002')");
  await sleep(150);
  await clickTestId(s.cdp, 'btn-edit');
  await fillPanelForm(s.cdp, { 'node-label': rwNew });
  await sleep(300);
  await evaluate(s.cdp, "window.__cm = ''; window.confirm = (m) => { window.__cm = m; return true; }; window.__wu.select(null)");
  await sleep(200);
  // FU5-7: 되감기에 들어가기 전 그래프 배치·배율을 찍어 둔다(돌아온 뒤 같아야 함)
  const fu5Lay = () => evaluate(s.cdp, "(() => { const cy = window.__wu.cy; const pos = {}; cy.nodes().forEach((n) => { pos[n.id()] = [Math.round(n.position('x') * 100) / 100, Math.round(n.position('y') * 100) / 100]; }); return { pos, zoom: cy.zoom(), pan: cy.pan() }; })()");
  const fu5Lay0 = await fu5Lay();
  const rwEntry = await evaluate(s.cdp, "(() => { const b = document.querySelector('[data-testid=btn-rewind]'); if (!b) return null; const r = b.getBoundingClientRect(); return { disabled: b.disabled, size: r.width > 0 && r.height > 0 }; })()");
  check('CR-14 A 개요에 「편집 되감기」 단추(크기 있음, 고친 기록이 있어 켜짐)', !!rwEntry && !rwEntry.disabled && rwEntry.size, JSON.stringify(rwEntry));
  await clickTestId(s.cdp, 'btn-rewind');
  await sleep(500);
  const rwBand = await evaluate(s.cdp, "(() => { const b = document.querySelector('[data-testid=rewind-band]'); const r = b.getBoundingClientRect(); const bar = document.querySelector('[data-testid=rewind-bar]'); const br = bar ? bar.getBoundingClientRect() : { width: 0, height: 0 }; return { hidden: b.hidden, w: r.width, h: r.height, text: b.textContent, barW: br.width, barH: br.height, points: document.querySelectorAll('[data-testid=rewind-point]').length, rev: !!document.querySelector('[data-testid=btn-rewind-revert]'), back: !!document.querySelector('[data-testid=btn-rewind-back]') }; })()");
  check('CR-14 A 되감기 띠(크기 있음): 「편집 되감기 중 — 시점 (읽기 전용)」·생김/바뀜/숨김 숫자·두 단추', !rwBand.hidden && rwBand.w > 0 && rwBand.h > 0 && rwBand.text.includes('편집 되감기 중') && rwBand.text.includes('읽기 전용') && rwBand.text.includes('바뀜') && rwBand.rev && rwBand.back, JSON.stringify(rwBand));
  check('CR-14 A 시점 막대와 시점 목록(2개 이상)이 그려짐(크기 있음)', rwBand.barW > 0 && rwBand.barH > 0 && rwBand.points >= 2, JSON.stringify(rwBand));
  const rwNull = await nullTextSpots(s.cdp);
  check('CR-14 A 되감기 화면(띠·패널)에 "null" 글자 없음(빈 값을 replaceChildren에 넘긴 실수)', rwNull.length === 0, JSON.stringify(rwNull));
  const rwPast = await evaluate(s.cdp, "({ cy: window.__wu.cy.getElementById('U-A1/N-002').data('label'), ro: window.__wu.readOnly, rw: !!window.__wu.rewind, add: document.getElementById('add-slot').textContent, create: document.getElementById('create-open').disabled, group: document.getElementById('group-open').disabled })");
  check('CR-14 A 이전 시점의 지도: 그 노드 이름이 옛 이름, 읽기 전용, 사람·업무·문서 추가·새 업무 지도·묶기 막힘', rwPast.cy === rwOld && rwPast.ro === true && rwPast.rw && rwPast.add.includes('읽기 전용') && rwPast.create && rwPast.group, JSON.stringify(rwPast));
  // R11-13 ②: 편집 되감기 중(읽기 전용)에도 wu:add-node(label 포함)는 무시된다 — 지금 문서의 노드 수 불변
  const rwNodes0 = await evaluate(s.cdp, 'window.__wu.doc.nodes.length');
  await evaluate(s.cdp, "document.dispatchEvent(new CustomEvent('wu:add-node', { detail: { type: 'person', label: 'W10 읽기전용 시험', attrs: { 연락처: 'x' } } }))");
  await sleep(300);
  check('W10 R11-13 ② 편집 되감기 중 wu:add-node(사람, 이름 포함)를 보내도 노드 수가 그대로이고 새 노드가 없음(되감기 상태 유지)', (await evaluate(s.cdp, 'window.__wu.doc.nodes.length')) === rwNodes0 && !(await evaluate(s.cdp, "window.__wu.doc.nodes.some((n) => n.label === 'W10 읽기전용 시험')")) && !!(await evaluate(s.cdp, 'window.__wu.rewind')));
  await evaluate(s.cdp, "window.__wu.select('U-A1/N-002')");
  await sleep(250);
  const rwNode = await evaluate(s.cdp, "({ title: document.querySelector('#detail h2') ? document.querySelector('#detail h2').textContent : '', note: (document.querySelector('[data-testid=rewind-node-note]') || {}).textContent || '', edit: !!document.querySelector('[data-testid=btn-edit]'), edge: !!document.querySelector('[data-testid=btn-edge]'), hide: !!document.querySelector('[data-testid=btn-hide]'), mark: window.__wu.cy.getElementById('U-A1/N-002').hasClass('rw-changed') })");
  check('CR-14 A 노드를 누르면 그때 값이 상세에, 바뀐 칸(이름: 그때/지금)이 표시되고 그래프에서 주황 표시', rwNode.title.includes(rwOld) && rwNode.note.includes('이름') && rwNode.note.includes(rwOld) && rwNode.note.includes(rwNew) && rwNode.mark, JSON.stringify(rwNode));
  check('CR-14 A 되감기 중에는 수정·연결 추가·숨기기 단추가 없음', !rwNode.edit && !rwNode.edge && !rwNode.hide, JSON.stringify(rwNode));
  await shot(s.cdp, `${browser.name}-40-rewind`);
  await clickTestId(s.cdp, 'btn-rewind-back');
  await sleep(400);
  const rwBack = await evaluate(s.cdp, "({ hidden: document.querySelector('[data-testid=rewind-band]').hidden, label: window.__wu.doc.nodes.find((n) => n.id === 'N-002').label, cy: window.__wu.cy.getElementById('U-A1/N-002').data('label'), ro: window.__wu.readOnly, create: document.getElementById('create-open').disabled })");
  check('CR-14 A 「지금으로 돌아가기」 → 띠가 사라지고 새 이름 그대로, 편집 가능 상태로 복귀', rwBack.hidden && rwBack.label === rwNew && rwBack.cy === rwNew && rwBack.ro === false && rwBack.create === false, JSON.stringify(rwBack));
  // FU5-7: 되감기에 들어갔다 나오면 들어가기 전 항목 자리·배율로 돌아온다(원인: 들어갈 때 배치를 새로 계산하고 나올 때는 그 배치·배율이 그대로 남았음)
  const fu5Lay1 = await fu5Lay();
  const fu5Moved = Object.keys(fu5Lay0.pos).filter((id) => !fu5Lay1.pos[id] || Math.abs(fu5Lay1.pos[id][0] - fu5Lay0.pos[id][0]) > 0.5 || Math.abs(fu5Lay1.pos[id][1] - fu5Lay0.pos[id][1]) > 0.5);
  check('FU5-7 편집 되감기에서 「지금으로 돌아가기」 뒤 그래프 배치(모든 항목 자리)와 배율·이동이 들어가기 전과 같음', fu5Moved.length === 0 && Math.abs(fu5Lay1.zoom - fu5Lay0.zoom) < 0.001 && Math.abs(fu5Lay1.pan.x - fu5Lay0.pan.x) < 2 && Math.abs(fu5Lay1.pan.y - fu5Lay0.pan.y) < 2, JSON.stringify({ moved: fu5Moved.slice(0, 5), z: [fu5Lay0.zoom, fu5Lay1.zoom], pan: [fu5Lay0.pan, fu5Lay1.pan] }));
  const evBefore = await evaluate(s.cdp, 'window.__wu.doc.events.length');
  await evaluate(s.cdp, 'window.__wu.select(null)');
  await sleep(150);
  await clickTestId(s.cdp, 'btn-rewind');
  await sleep(400);
  const pointsBefore = await evaluate(s.cdp, "document.querySelectorAll('[data-testid=rewind-point]').length");
  await sleep(1100); // 되돌림이 새 판(다른 초)으로 남게
  await clickTestId(s.cdp, 'btn-rewind-revert');
  await sleep(500);
  const rwDone = await evaluate(s.cdp, "(() => { const d = window.__wu.doc; const n = d.nodes.find((x) => x.id === 'N-002'); const last = d.events.slice(-3); const done = document.querySelector('[data-testid=rewind-done]'); const dr = done ? done.getBoundingClientRect() : { width: 0, height: 0 }; return { label: n.label, bandHidden: document.querySelector('[data-testid=rewind-band]').hidden, confirm: window.__cm, noted: last.some((e) => (e.note || '').startsWith('편집 되감기:')), grew: d.events.length, doneW: dr.width, doneH: dr.height, ro: window.__wu.readOnly }; })()");
  check('CR-14 A 「이 시점으로 되돌리기」 → 확인 창(개수·사용자 기록 보존 안내) → 이름이 옛 이름으로, 되감기 끝, 완료 알림(크기 있음)', rwDone.label === rwOld && rwDone.bandHidden && rwDone.confirm.includes('시점으로 되돌립니다') && rwDone.confirm.includes('사용자 기록') && rwDone.doneW > 0 && rwDone.doneH > 0 && rwDone.ro === false && rwDone.grew > evBefore, JSON.stringify(rwDone));
  check('CR-14 A 되돌림이 이력에 「편집 되감기」 메모로 남음', rwDone.noted, JSON.stringify(rwDone));
  await evaluate(s.cdp, 'window.__wu.select(null)');
  await sleep(150);
  await clickTestId(s.cdp, 'btn-rewind');
  await sleep(400);
  const pointsAfter = await evaluate(s.cdp, "document.querySelectorAll('[data-testid=rewind-point]').length");
  check('CR-14 A 되돌림도 되감기 시점 목록에 한 판으로 남아 다시 되감을 수 있음', pointsAfter === pointsBefore + 1, `${pointsBefore} → ${pointsAfter}`);
  await clickTestId(s.cdp, 'btn-rewind-back');
  await sleep(200);

  // ── CR-14 C 폴더 연결(R-27, D-32): 가짜 폴더(메모리)를 주입 → 탭 → 수정 저장 → 내 파일 생김 → 동료 파일 2개 → 새로 고침 → 묶기. 데이터를 바꾸므로 맨 끝 ──
  await reloadApp();
  // 페이지 안 가짜 폴더 손잡이: getFileHandle·values·getFile·createWritable만 있다(실제 고르기 창은 사람 확인)
  const makeFakeDir = () => {
    const files = new Map();
    return {
      kind: 'directory',
      name: '가상 공유 폴더',
      files,
      async getFileHandle(name, opt = {}) {
        if (!files.has(name) && !opt.create) throw Object.assign(new Error('없음'), { name: 'NotFoundError' });
        return { kind: 'file', name, async createWritable() { let buf = ''; return { write: async (t) => { buf += t; }, close: async () => { files.set(name, { text: buf, lastModified: Date.now() }); } }; } };
      },
      async *values() {
        for (const [name, f] of files) yield { kind: 'file', name, async getFile() { return { size: f.text.length, lastModified: f.lastModified, text: async () => f.text }; } };
      },
    };
  };
  await evaluate(s.cdp, `window.__fk = (${makeFakeDir})(); window.confirm = () => true; window.__wu.useFolderHandle(window.__fk).then(() => true)`);
  const fkTab = async () => {
    await evaluate(s.cdp, "document.getElementById('import-open').click()");
    await sleep(200);
    await clickTestId(s.cdp, 'import-tab-folder');
    await sleep(250);
  };
  await fkTab();
  const fkBox = (id) => evaluate(s.cdp, `(() => { const e = document.querySelector('[data-testid=${id}]'); if (!e) return null; const r = e.getBoundingClientRect(); return { w: r.width, h: r.height, text: e.textContent }; })()`);
  const fkIntro = await fkBox('folder-intro');
  const fkName = await fkBox('folder-name');
  const fkBtns = [await fkBox('folder-save'), await fkBox('folder-refresh'), await fkBox('folder-disconnect'), await fkBox('folder-bundle')];
  check('CR-14 C 「폴더 연결」 탭: 설명 한 줄·폴더 이름·「지금 저장」「새로 고침」「연결 끊기」「팀 지도로 묶기」(크기 있음)', !!fkIntro && fkIntro.text.includes('남의 파일은 고치지 않습니다') && !!fkName && fkName.text.includes('가상 공유 폴더') && fkBtns.every((b) => b && b.w > 0 && b.h > 0), JSON.stringify([fkIntro, fkName, fkBtns]));
  check('CR-14 C 동료 파일이 없으면 「팀 지도로 묶기」가 꺼져 있고 「폴더에 .json 파일이 없습니다」', await evaluate(s.cdp, "document.querySelector('[data-testid=folder-bundle]').disabled") && (await text(s.cdp, '[data-testid=folder-empty]')).includes('.json 파일이 없습니다'));
  await shot(s.cdp, `${browser.name}-31-folder-tab-empty`);
  await evaluate(s.cdp, "document.getElementById('import-dialog').close()");

  // 노드 이름 수정(저장) → 1초 디바운스 뒤 폴더에 내 파일
  await sleep(1100);
  await evaluate(s.cdp, "window.__wu.select('U-A1/N-002')");
  await sleep(150);
  await clickTestId(s.cdp, 'btn-edit');
  await fillPanelForm(s.cdp, { 'node-label': '폴더 거울 시험 이름' });
  await sleep(1500);
  const fkMine = await evaluate(s.cdp, "(() => { const names = [...window.__fk.files.keys()]; const mine = names.filter((n) => n.startsWith('월말_정산_점검') && n.endsWith('.json')); const d = mine.length ? JSON.parse(window.__fk.files.get(mine[0]).text) : null; return { names, id: d && d.universe.id, label: d && d.nodes.find((n) => n.id === 'N-002').label }; })()");
  check('CR-14 C 저장 1.2초 뒤 폴더에 내 파일(월말_정산_점검(작성자).json 꼴)이 생기고 내용이 방금 고친 지도', fkMine.names.length === 1 && fkMine.id === 'U-A1' && fkMine.label === '폴더 거울 시험 이름', JSON.stringify(fkMine));

  // 동료 파일 2개(다른 샘플 유니버스)를 폴더에 넣고 새로 고침
  const peers = SAMPLES.filter((d) => d.universe.id !== 'U-A1' && !(d.refs || []).length).slice(0, 2);
  await evaluate(s.cdp, `(() => { for (const d of ${JSON.stringify(peers)}) window.__fk.files.set('동료-' + d.universe.id + '.json', { text: JSON.stringify(d), lastModified: Date.now() }); window.__fk.files.set('깨진파일.json', { text: '{"universe":', lastModified: Date.now() }); })()`);
  await fkTab();
  await clickTestId(s.cdp, 'folder-refresh');
  await sleep(400);
  const fkList = await evaluate(s.cdp, "(() => { const rows = [...document.querySelectorAll('[data-testid=folder-file]')]; const r = document.querySelector('[data-testid=folder-files]').getBoundingClientRect(); return { n: rows.length, mine: rows.filter((x) => x.querySelector('[data-testid=folder-mine]')).length, checks: rows.filter((x) => x.querySelector('[data-testid=folder-check]') && x.querySelector('[data-testid=folder-check]').checked).length, bad: rows.filter((x) => x.querySelector('[data-testid=folder-bad]')).length, w: r.width, h: r.height, bundleOff: document.querySelector('[data-testid=folder-bundle]').disabled }; })()");
  check('CR-14 C 새로 고침 → 파일 4개(내 파일 1·동료 2 체크됨·깨진 파일 1은 건너뜀 표시), 묶기 단추 켜짐(목록 크기 있음)', fkList.n === 4 && fkList.mine === 1 && fkList.checks === 2 && fkList.bad === 1 && fkList.w > 0 && fkList.h > 0 && !fkList.bundleOff, JSON.stringify(fkList));
  const fkNull = await nullTextSpots(s.cdp);
  check('CR-14 C 폴더 연결 탭에 "null" 글자 없음', fkNull.length === 0, JSON.stringify(fkNull));
  await shot(s.cdp, `${browser.name}-32-folder-tab-list`);
  await clickTestId(s.cdp, 'folder-bundle');
  await sleep(500);
  await waitFor(s.cdp, "window.__wu && window.__wu.cy && window.__wu.doc.universe.name === '폴더 팀 지도'"); // 묶음을 열면 페이지가 다시 불러와진다
  const fkGroup = await evaluate(s.cdp, "(() => { const d = window.__wu.doc; return { name: d.universe.name, level: d.universe.level, children: d.refs.filter((r) => !r.hidden).length, hash: location.hash, dialogOpen: document.getElementById('import-dialog').open, peerIds: d.refs.map((r) => r.child_universe_id) }; })()");
  check('CR-14 C 「팀 지도로 묶기」 → 확인 뒤 묶음 「폴더 팀 지도」가 열리고 하위 3개(지금 유니버스+동료 2), 창은 닫힘', fkGroup.name === '폴더 팀 지도' && fkGroup.level === '팀' && fkGroup.children === 3 && !fkGroup.dialogOpen && fkGroup.peerIds.includes('U-A1') && peers.every((d) => fkGroup.peerIds.includes(d.universe.id)), JSON.stringify(fkGroup));
  const fkNull2 = await nullTextSpots(s.cdp);
  check('CR-14 C 묶음이 열린 화면에 "null" 글자 없음', fkNull2.length === 0, JSON.stringify(fkNull2));

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
  check('R-21 저장소 차단(읽기 전용)에서는 백업 권유 줄이 없음', await evaluate(s.cdp, "document.getElementById('backup-nudge').hidden"));
  check(`저장소 차단 시 샘플 읽기 전용 표시(노드 ${NODES}, 추가 비활성)`, s.ready && (await nodeCount(s.cdp)) === NODES && (await text(s.cdp, '#add-slot')).includes('읽기 전용'));
  if (await goBare(s.cdp)) {
    check('오류: 저장소 차단 시 시작 화면에도 경고가 보이고 새 업무 지도는 막힘', (await text(s.cdp, '[data-testid=start-warning]')).includes('저장소를 쓸 수 없습니다') && (await evaluate(s.cdp, "document.querySelector('[data-testid=start-create]').disabled")));
  } else {
    check('오류: 저장소 차단 시 시작 화면에도 경고가 보이고 새 업무 지도는 막힘', false, '시작 화면이 열리지 않음');
  }
  s.cdp.close();
  await close(s);

  // 4) 내용 포함 HTML(CR-13 B): 내려받기 → 새 프로필로 열기(읽기 전용) → 다시 내려받기(왕복) → 내 업무 지도로 가져오기
  {
    const grabHtml = async (cdp) => {
      await evaluate(cdp, "(() => { window.__dl = null; window.__blob = null; if (!window.__patched) { window.__patched = true; const orig = URL.createObjectURL; URL.createObjectURL = (b) => { window.__blob = b; return orig.call(URL, b); }; HTMLAnchorElement.prototype.click = function () { window.__dl = this.getAttribute('download'); }; } document.getElementById('import-open').click(); document.querySelector('[data-testid=import-tab-export]').click(); window.__btnBox = (() => { const r = document.querySelector('[data-testid=export-html]').getBoundingClientRect(); return [r.width, r.height]; })(); document.querySelector('[data-testid=export-html]').click(); })()");
      await sleep(300);
      const name = await evaluate(cdp, 'window.__dl');
      const html = await evaluate(cdp, 'window.__blob ? window.__blob.text() : null');
      const box = await evaluate(cdp, 'window.__btnBox');
      const note = await text(cdp, '[data-testid=export-html-note]');
      await shot(cdp, `${browser.name}-30-embed-export-tab`);
      await evaluate(cdp, "document.getElementById('import-dialog').close()");
      return { name, html, box, note };
    };
    const distHtml = await readFile(join(root, 'dist/index.html'), 'utf8');
    // 파서가 줄바꿈(CRLF→LF)·태그 사이 공백을 다듬으므로 글자 단위 완전 일치 대신 앱 스크립트·스타일 본문과 라이선스 주석이 같은지 본다
    const between = (h, a, b) => { const i = h.indexOf(a); return i < 0 ? null : h.slice(i + a.length, h.lastIndexOf(b)); };
    const sameApp = (h) => { const x = stripEmbed(h); const lf = distHtml.replace(/\r\n/g, '\n'); return between(x, '<script>', '</script>') === between(lf, '<script>', '</script>') && x.includes('Cytoscape.js') && x.startsWith('<!doctype html>\n<!--') && x.includes('connect-src https://api.anthropic.com;'); };
    const embedProfile = `${profile}-embed`;
    await rm(embedProfile, { recursive: true, force: true });
    s = await openSession(exe, embedProfile, port);
    const marker = `내용 포함 점검 ${Date.now() % 10000}`;
    await submitAdd(s.cdp, 'work', marker);
    const a1 = await grabHtml(s.cdp);
    check('CR-13 B 내보내기 탭에 「HTML 파일로 내려받기(내용 포함)」 단추(크기 있음)와 설명 줄', a1.box && a1.box[0] > 0 && a1.box[1] > 0 && a1.note.includes('더블클릭') && a1.note.includes('보낼 사람에게만'), JSON.stringify([a1.box, a1.note]));
    check('CR-13 B 파일 이름은 이름-ID.html', /-U-A1\.html$/.test(a1.name || ''), a1.name);
    const embedCount = (a1.html.match(/id="wu-embed"/g) || []).length;
    check('CR-13 B 내려받은 HTML에 내장 데이터가 하나, 앱 스크립트 앞에 있음', embedCount === 1 && a1.html.indexOf('id="wu-embed"') < a1.html.indexOf('<script>'));
    check('CR-13 B 내장 데이터를 빼면 원래 dist/index.html과 앱 스크립트 본문이 같음(라이선스 주석·CSP 보존)', sameApp(a1.html), `${stripEmbed(a1.html).length} vs ${distHtml.length}`);
    await evaluate(s.cdp, "location.hash = 'U-D1'; location.reload()").catch(() => {});
    await waitFor(s.cdp, "window.__wu && window.__wu.doc && window.__wu.doc.universe.id === 'U-D1' && window.__wu.cy.nodes().length > 0", 8000);
    const d1 = await grabHtml(s.cdp);
    const d1Embed = readEmbedFromHtml(d1.html);
    check('CR-13 B 부서 묶음(U-D1): 하위 유니버스 문서까지 한 파일에 들어 감', !!d1Embed && d1Embed.root === 'U-D1' && d1Embed.docs.length >= 3, d1Embed ? d1Embed.docs.map((d) => d.universe.id).join() : 'null');
    s.cdp.close();
    await close(s);
    const fA1 = join(tmp, 'embed-A1.html');
    const fD1 = join(tmp, 'embed-D1.html');
    const fBad = join(tmp, 'embed-bad.html');
    await writeFile(fA1, a1.html);
    if (process.env.SHOT_DIR) await writeFile(join(process.env.SHOT_DIR, `${browser.name}-embed-A1.html`), a1.html); // 사람이 열어 볼 수 있게 남긴다
    await writeFile(fD1, d1.html);
    await writeFile(fBad, a1.html.replace('{"format"', '{깨짐"format"'));

    // 새 프로필로 열기: 시작 화면 없이 바로 그 유니버스, 읽기 전용, 안내 줄, 저장소 안 건드림
    const viewProfile = `${profile}-embedview`;
    await rm(viewProfile, { recursive: true, force: true });
    s = await openSession(exe, viewProfile, port);
    const openFile = async (file, hash = '') => {
      await evaluate(s.cdp, `location.href = ${JSON.stringify(pathToFileURL(file).href + '?check' + hash)}`).catch(() => {});
      await sleep(600);
      return waitFor(s.cdp, 'window.__wu && window.__wu.doc && window.__wu.cy.nodes().length > 0', 8000);
    };
    const bannerInfo = () => evaluate(s.cdp, "(() => { const b = document.getElementById('embed-banner'); const r = b.getBoundingClientRect(); const btn = document.querySelector('[data-testid=embed-import]'); return { hidden: b.hidden, w: r.width, h: r.height, text: b.textContent, btnOff: btn ? btn.disabled : null, hash: location.hash, ro: window.__wu.readOnly, id: window.__wu.doc.universe.id }; })()");
    check('CR-13 B 내용 포함 파일 열기: 시작 화면 없이 그 유니버스가 보임', await openFile(fA1) && (await evaluate(s.cdp, "window.__wu.doc.universe.id")) === 'U-A1' && !(await evaluate(s.cdp, "document.body.classList.contains('start-mode')")));
    check('CR-13 A 읽기 전용(내용 포함 파일)에서는 머리글 「?」와 따라 하기 카드를 쓰지 않음(다른 유니버스를 열 수 없으므로)', (await evaluate(s.cdp, "document.getElementById('tour-open').hidden")) === true && (await evaluate(s.cdp, 'window.__wu.tour')) === null);
    check('CR-13 B 보낸 쪽에서 추가한 노드가 보임(내용이 들어 있음)', await hasLabel(s.cdp, marker));
    const b1 = await bannerInfo();
    check('CR-13 B 읽기 전용 안내 줄(크기 있음)과 「내 업무 지도로 가져오기」 단추, 읽기 전용', !b1.hidden && b1.w > 0 && b1.h > 0 && b1.text.includes('이 파일에 담긴 「') && b1.text.includes('읽기 전용') && b1.text.includes('내 업무 지도로 가져오기') && b1.btnOff === false && b1.ro === true && b1.hash.startsWith('#embed/'), JSON.stringify(b1));
    check('CR-13 B 읽기 전용이라 사람·업무·문서 추가가 막힘', (await text(s.cdp, '#add-slot')).includes('읽기 전용'));
    // R11-13 ②: 읽기 전용(보기 모드)에서 wu:add-node(label 포함)를 보내도 노드가 만들어지지 않는다(데이터 불변)
    const roNodes0 = await evaluate(s.cdp, 'window.__wu.doc.nodes.length');
    await evaluate(s.cdp, "document.dispatchEvent(new CustomEvent('wu:add-node', { detail: { type: 'person', label: 'W10 읽기전용 시험', attrs: { 연락처: 'x' } } }))");
    await sleep(300);
    check('W10 R11-13 ② 읽기 전용(내용 포함 파일)에서 wu:add-node(사람, 이름 포함)를 보내도 노드 수가 그대로이고 새 노드가 없음', (await evaluate(s.cdp, 'window.__wu.doc.nodes.length')) === roNodes0 && !(await hasLabel(s.cdp, 'W10 읽기전용 시험')) && (await evaluate(s.cdp, 'window.__wu.readOnly')) === true);
    check('CR-13 B 보기만 했으면 이 브라우저 저장소의 같은 유니버스는 그대로(보낸 노드 없음)', !(await evaluate(s.cdp, `(localStorage.getItem('wu:v1:u:U-A1') || '').includes(${JSON.stringify(marker)})`)));
    await shot(s.cdp, `${browser.name}-31-embed-view-A1`);
    // 다시 내려받기(두 번 내보내기 왕복)
    const a2 = await grabHtml(s.cdp);
    check('CR-13 B 내용 포함 파일에서 다시 내려받아도 내장 데이터 하나, 빼면 dist와 같음(왕복)', (a2.html.match(/id="wu-embed"/g) || []).length === 1 && sameApp(a2.html) && readEmbedFromHtml(a2.html).docs[0].nodes.some((n) => n.label === marker), `${a2.html ? stripEmbed(a2.html).length : 'null'}`);
    // 가져오기 → 일반 모드
    await evaluate(s.cdp, "window.confirm = () => true");
    await clickTestId(s.cdp, 'embed-import');
    await sleep(600);
    const imported1 = await waitFor(s.cdp, `window.__wu && window.__wu.readOnly === false && window.__wu.doc.universe.id === 'U-A1' && window.__wu.cy.nodes().some(n => n.data('label') === ${JSON.stringify(marker)})`, 8000);
    const b1b = await evaluate(s.cdp, "({ hash: location.hash, banner: document.getElementById('embed-banner').hidden })");
    check('CR-13 B 「내 업무 지도로 가져오기」 → 일반 모드(읽기 전용 아님, 안내 줄 없음)로 열리고 보낸 노드가 있음', imported1 && b1b.banner === true && b1b.hash === '#U-A1', JSON.stringify(b1b));
    check('CR-13 B 가져온 뒤 저장소에 보낸 노드가 저장됨', await evaluate(s.cdp, `(localStorage.getItem('wu:v1:u:U-A1') || '').includes(${JSON.stringify(marker)})`));
    check('CR-13 B 일반 모드에서는 사람·업무·문서 추가가 다시 가능', !(await text(s.cdp, '#add-slot')).includes('읽기 전용'));
    // 묶음
    check('CR-13 B 부서 묶음 파일 열기: 하위 유니버스까지 보임(고르기 목록에 하위 모두)', await openFile(fD1) && await evaluate(s.cdp, "(() => { const ids = [...document.getElementById('universe-picker').options].map((o) => o.value); return window.__wu.doc.universe.id === 'U-D1' && window.__wu.doc.refs.filter((r) => !r.hidden).every((r) => ids.includes(r.child_universe_id)); })()"));
    await shot(s.cdp, `${browser.name}-32-embed-view-D1`);
    await evaluate(s.cdp, "(() => { const p = document.getElementById('universe-picker'); const ids = [...p.options].map((o) => o.value).filter((v) => v !== 'U-D1'); window.__child = window.__wu.doc.refs.find((r) => !r.hidden).child_universe_id; p.value = window.__child; p.dispatchEvent(new Event('change')); })()");
    await sleep(600);
    const childOk = await waitFor(s.cdp, 'window.__wu && window.__wu.doc && window.__wu.doc.universe.id !== \'U-D1\' && window.__wu.cy.nodes().length > 0', 8000);
    const bc = childOk ? await bannerInfo() : null;
    check('CR-13 B 보기 모드에서 하위 유니버스로 옮겨도 읽기 전용 유지(#embed/ 주소)', !!bc && bc.ro === true && bc.hash.startsWith('#embed/') && !bc.hidden, JSON.stringify(bc));
    await openFile(fD1);
    await evaluate(s.cdp, "window.confirm = () => true");
    await clickTestId(s.cdp, 'embed-import');
    await sleep(600);
    check('CR-13 B 묶음 가져오기 → 일반 모드로 열림', await waitFor(s.cdp, "window.__wu && window.__wu.readOnly === false && window.__wu.doc.universe.id === 'U-D1' && location.hash === '#U-D1'", 8000));
    // 가져오기 취소(덮어쓰기 거절)
    await openFile(fA1);
    await evaluate(s.cdp, "window.confirm = () => false");
    await clickTestId(s.cdp, 'embed-import');
    await sleep(400);
    check('CR-13 B 덮어쓰기를 거절하면 그대로 보기 모드에 머물고 취소 안내', (await evaluate(s.cdp, "location.hash.startsWith('#embed/') && window.__wu.readOnly")) && (await text(s.cdp, '[data-testid=embed-message]')).includes('취소'));
    // 깨진 내장 데이터: 경고만 띄우고 평소처럼(시작 화면)
    await evaluate(s.cdp, `location.href = ${JSON.stringify(pathToFileURL(fBad).href + '?check')}`).catch(() => {});
    await sleep(600);
    const badOk = await waitFor(s.cdp, 'window.__wu && window.__wu.start === true', 8000);
    check('CR-13 B 내장 데이터가 깨진 파일: 경고만 띄우고 평소처럼 시작 화면이 열림', badOk && (await text(s.cdp, '[data-testid=start-warning]')).includes('깨져 있어'));
    await shot(s.cdp, `${browser.name}-33-embed-broken`);
    const errorsE = [...s.log.errors];
    const externalE = [...s.log.external];
    check('CR-13 B 내용 포함 파일 점검 중 스크립트 오류·외부 요청 0건', errorsE.length + externalE.length === 0, [...errorsE, ...externalE].join(' | '));
    s.cdp.close();
    await close(s);
    // 저장소를 쓸 수 없으면 가져오기 단추를 막고 이유를 보인다
    const blockProfile = `${profile}-embedblocked`;
    await rm(blockProfile, { recursive: true, force: true });
    s = await openSession(exe, blockProfile, port, { blockStorage: true });
    check('CR-13 B 저장소 차단: 내용 포함 파일은 보이고 가져오기 단추는 막히고 이유가 보임', await openFile(fA1) && await (async () => { const bi = await bannerInfo(); return bi.btnOff === true && bi.text.includes('저장소를 쓸 수 없어') && bi.ro === true; })());
    await shot(s.cdp, `${browser.name}-34-embed-blocked`);
    s.cdp.close();
    await close(s);
  }

  return { browser: browser.name, version, exe, checks };
}

await mkdir(tmp, { recursive: true });
if (!existsSync(join(root, 'dist/index.html'))) {
  console.error('dist/index.html이 없습니다. 먼저 npm run build를 실행하세요.');
  process.exit(1);
}
// O-1(검토9): 소스가 dist보다 새로우면 옛 판을 점검하게 된다. 알리기만 하고 멈추지 않는다(PAGE로 다른 파일을 점검할 때는 해당 없음)
function newestMtime(p) {
  const st = statSync(p);
  if (!st.isDirectory()) return st.mtimeMs;
  return readdirSync(p).reduce((m, name) => Math.max(m, newestMtime(join(p, name))), 0);
}
try {
  if (!process.env.PAGE && Math.max(newestMtime(join(root, 'app/src')), newestMtime(join(root, 'app/index.html'))) > statSync(join(root, 'dist/index.html')).mtimeMs) {
    console.warn('경고: dist가 옛 판입니다 — npm run build 먼저');
  }
} catch { /* 시각을 읽지 못하면 경고만 생략 */ }
console.log(`대상: ${pageUrl}\n점검일: ${new Date().toISOString()}\n`);
let failed = 0;
let port = Number(process.env.CHECK_PORT) || 9333;
for (const b of pickBrowsers(BROWSERS)) { // --only=chrome 이면 Chrome만(평소 수정). 제출 점검은 둘 다
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
