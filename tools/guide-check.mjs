// 실행 안내(docs/submission/실행안내.html) "5분 둘러보기"를 그대로 따라가는 점검(T-15 보조, R-08 대리 관찰을 대신하지는 않음).
// 테스트 ID 대신 화면에 보이는 글자로 버튼을 찾고, 실제 마우스·키보드 입력으로 누른다. 안내 문구와 화면이 어긋나면 실패한다.
// 사용: npm run build && node tools/guide-check.mjs      (PAGE=다른 index.html 경로, SHOT_DIR=스크린샷 폴더)
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pageUrl = pathToFileURL(process.env.PAGE || join(root, 'dist/index.html')).href;
const BROWSERS = [
  { name: 'Chrome', exe: 'C:/Program Files/Google/Chrome/Application/chrome.exe' },
  { name: 'Edge', exe: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' },
].filter((b) => existsSync(b.exe));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`);
};

// 실행 안내의 단계에서 「…」로 묶은 화면 이름을 뽑는다(안내 문구가 바뀌면 점검도 따라간다)
const guide = await readFile(join(root, 'docs/submission/실행안내.html'), 'utf8');
const stepsHtml = guide.slice(guide.indexOf('5분 둘러보기'), guide.indexOf('</ol>', guide.indexOf('5분 둘러보기')));
const labels = [...stepsHtml.matchAll(/「([^」]+)」/g)].map((m) => m[1]);

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
    }
  };
  const opened = new Promise((r) => { ws.onopen = r; });
  return { opened, send(method, params = {}) { const id = ++seq; ws.send(JSON.stringify({ id, method, params })); return new Promise((resolve, reject) => pending.set(id, { resolve, reject })); }, close: () => ws.close() };
}
async function ev(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function waitFor(cdp, expr, t = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < t) { try { if (await ev(cdp, expr)) return true; } catch { /* 로딩 중 */ } await sleep(100); }
  return false;
}
async function mouseAt(cdp, x, y) {
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
    await sleep(30);
  }
  await sleep(250);
}
// 화면에 보이는 글자로 버튼을 찾아 그 위치를 실제 마우스로 누른다
async function clickText(cdp, text, selector = 'button') {
  const pos = await ev(cdp, `(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((b) => b.offsetParent && b.textContent.replace(/\\s+/g, ' ').includes(${JSON.stringify(text)})); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  if (!pos) return false;
  await mouseAt(cdp, pos.x, pos.y);
  return true;
}
// 그래프 노드를 이름으로 찾아 실제 마우스로 누른다
async function clickNode(cdp, label) {
  const pos = await ev(cdp, `(() => { const n = window.__wu.cy.nodes().filter((x) => x.data('label') === ${JSON.stringify(label)}); if (n.empty()) return null; const p = n[0].renderedPosition(); const r = document.getElementById('graph').getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; })()`);
  if (!pos) return false;
  await mouseAt(cdp, pos.x, pos.y);
  return true;
}
// 셀렉트에서 화면 글자로 고른다
const pickOption = (cdp, selector, text) => ev(cdp, `(() => { const s = document.querySelector(${JSON.stringify(selector)}); const o = [...s.options].find((x) => x.textContent.includes(${JSON.stringify(text)})); if (!o) return false; s.value = o.value; s.dispatchEvent(new Event('change')); return true; })()`);
const panel = (cdp) => ev(cdp, "document.getElementById('detail').textContent");

async function shot(cdp, name) {
  if (!process.env.SHOT_DIR) return;
  await mkdir(process.env.SHOT_DIR, { recursive: true });
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(process.env.SHOT_DIR, `${name}.png`), Buffer.from(data, 'base64'));
}

async function walk(browser, port) {
  console.log(`\n== ${browser.name}: 실행 안내 따라가기`);
  const profile = join(root, '.tmp', `guide-check-${browser.name}`);
  await rm(profile, { recursive: true, force: true });
  const proc = spawn(browser.exe, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--proxy-server=http://127.0.0.1:9', '--window-size=1280,860', 'about:blank'], { stdio: 'ignore' });
  let wsUrl;
  for (let i = 0; i < 100 && !wsUrl; i += 1) { try { wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl; } catch { /* 시작 전 */ } await sleep(100); }
  const cdp = connect(wsUrl);
  await cdp.opened;
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
  try {
    // 더블클릭으로 연 것처럼 주소에 #이 없이 연다
    await cdp.send('Page.navigate', { url: pageUrl });
    check('처음 화면(시작 화면)이 열림', await waitFor(cdp, 'window.__wu && window.__wu.start === true'));
    // 1단계
    check(`1단계: 「${labels[0]}」 버튼이 있고 누르면 월말 정산이 열림`, await clickText(cdp, labels[0]) && await waitFor(cdp, "window.__wu && window.__wu.doc && window.__wu.doc.universe.id === 'U-A1' && window.__wu.cy.nodes().length > 0"));
    await sleep(1200);
    await shot(cdp, `${browser.name}-g1-open`);
    // 2단계
    const clicked = await clickNode(cdp, '대사 확인');
    const p2 = await panel(cdp);
    check('2단계: 「대사 확인」 동그라미를 마우스로 누르면 속성·연결·이력, 현재 담당, 반복 비효율 표시', clicked && p2.includes('연결된 노드') && p2.includes('이력') && p2.includes('현재 담당') && p2.includes('반복 비효율'), p2.slice(0, 80));
    await shot(cdp, `${browser.name}-g2-node`);
    // 3단계: 빈 곳 → 인수인계 초안 만들기 → 윤바다 → 서하늘 → 초안 만들기
    const box = await ev(cdp, "(() => { const r = document.getElementById('graph').getBoundingClientRect(); return { x: r.left + 12, y: r.top + 12 }; })()");
    await mouseAt(cdp, box.x, box.y);
    const ok3a = await clickText(cdp, labels.find((l) => l.includes('인수인계 초안')));
    const ok3b = (await pickOption(cdp, '[data-testid=draft-from]', '윤바다')) && (await pickOption(cdp, '[data-testid=draft-to]', '서하늘'));
    const ok3c = await clickText(cdp, '초안 만들기', '#detail button');
    await sleep(300);
    const p3 = await panel(cdp);
    const chips = await ev(cdp, "document.querySelectorAll('.draft .evidence').length");
    check('3단계: 빈 곳 → 「인수인계 초안 만들기」 → 윤바다·서하늘 → 「초안 만들기」: 근거 버튼과 "이력 부족"', ok3a && ok3b && ok3c && chips > 5 && p3.includes('이력 부족'), `근거 ${chips}개`);
    check('3단계: 생성 방식이 보임(기본 사전 생성)', p3.includes('생성 방식: 사전 생성'));
    await shot(cdp, `${browser.name}-g3-draft`);
    // 4단계
    await mouseAt(cdp, box.x, box.y);
    const ok4 = await clickText(cdp, labels.find((l) => l.includes('인사이트')));
    const tabs = await ev(cdp, "[...document.querySelectorAll('.tabs .tab')].map((t) => t.textContent).join('|')");
    check('4단계: 「인사이트 보기」에 유사 경험자·반복 비효율·밀집·공백·흐름 변화 탭과 "사람이 정합니다"', ok4 && ['유사 경험자', '반복 비효율', '밀집·공백', '흐름 변화'].every((t) => tabs.includes(t)) && (await panel(cdp)).includes('사람이 정합니다'), tabs);
    await shot(cdp, `${browser.name}-g4-insight`);
    // 5단계: 시간 보기 막대를 왼쪽으로(실제 끌기)
    const bar = await ev(cdp, "(() => { const r = document.querySelector('#timebar input[type=range]').getBoundingClientRect(); return { x1: r.right - 4, x2: r.left + r.width * 0.2, y: r.top + r.height / 2 }; })()");
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: bar.x1, y: bar.y });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: bar.x1, y: bar.y, button: 'left', clickCount: 1 });
    for (let i = 1; i <= 8; i += 1) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: bar.x1 + ((bar.x2 - bar.x1) * i) / 8, y: bar.y, button: 'left', buttons: 1 });
      await sleep(40);
    }
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: bar.x2, y: bar.y, button: 'left', clickCount: 1 });
    await sleep(300);
    const when = await ev(cdp, "document.getElementById('timebar').textContent");
    const faded = await ev(cdp, "window.__wu.cy.elements('.time-off').length");
    check(`5단계: 「${labels.find((l) => l.includes('시간'))}」 막대를 마우스로 끌면 과거 기준일과 흐린 담당`, /\d{4}-\d{2}-\d{2} 기준/.test(when) && faded > 0, when.slice(0, 60));
    await shot(cdp, `${browser.name}-g5-time`);
    // 6단계
    for (const name of labels.slice(-2)) {
      const short = name.replace(/\(.*\)/, '').trim();
      const ok = await pickOption(cdp, '#universe-picker', short);
      await sleep(800);
      check(`6단계: 위쪽 목록에서 「${name}」을 고를 수 있고 열림`, ok && await waitFor(cdp, `window.__wu && window.__wu.doc && window.__wu.doc.universe.name === ${JSON.stringify(short)}`));
    }
    await shot(cdp, `${browser.name}-g6-org`);
    // 안내 4절: 초기화 버튼
    check('안내 4절: 「가상 데이터 초기화」 버튼이 있음', await ev(cdp, "[...document.querySelectorAll('header button')].some((b) => b.textContent.includes('가상 데이터 초기화'))"));
  } finally {
    cdp.close();
    proc.kill();
    await sleep(500);
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }
}

console.log(`대상: ${pageUrl}\n안내에서 뽑은 화면 이름: ${labels.join(' / ')}`);
let port = 9600;
for (const b of BROWSERS) await walk(b, port++);
console.log(failures ? `\n실패 ${failures}건` : '\n모두 통과');
process.exit(failures ? 1 : 0);
