// 점검용 헤드리스 Chrome 도우미(CR-24 T-50). 자기 임시 프로필로 띄운 Chrome만 정리한다(다른 프로그램 보호, CLAUDE.md).
import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

function connect(url) {
  const ws = new WebSocket(url);
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
    } else if (msg.method) listeners.forEach((f) => f(msg));
  };
  const opened = new Promise((r) => { ws.onopen = r; });
  return {
    opened,
    on: (f) => listeners.push(f),
    send(method, params = {}) {
      const id = ++seq;
      ws.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    close: () => ws.close(),
  };
}

/** Chrome을 띄우고 페이지 하나에 연결한다. 반환: { cdp, ev, close, logs } */
export async function launch({ port, profile, width = 1440, height = 900 }) {
  await rm(profile, { recursive: true, force: true });
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--proxy-server=http://127.0.0.1:9', `--window-size=${width},${height}`, 'about:blank'], { stdio: 'ignore' });
  let url;
  for (let i = 0; i < 150 && !url; i += 1) {
    try { url = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl; } catch {}
    await sleep(100);
  }
  if (!url) { proc.kill(); throw new Error('DevTools 연결 실패'); }
  const cdp = connect(url);
  await cdp.opened;
  const logs = [];
  cdp.on((m) => {
    if (m.method === 'Runtime.consoleAPICalled') logs.push({ kind: m.params.type, text: m.params.args.map((a) => a.value ?? a.description ?? '').join(' ') });
    if (m.method === 'Runtime.exceptionThrown') logs.push({ kind: 'exception', text: m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text });
  });
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  const ev = async (expression) => {
    const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const close = async () => { cdp.close(); proc.kill(); await sleep(300); await rm(profile, { recursive: true, force: true }).catch(() => {}); };
  return { cdp, ev, close, logs };
}

export async function waitFor(ev, expr, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if (await ev(expr)) return true; } catch {}
    await sleep(100);
  }
  return false;
}
