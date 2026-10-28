// 업무 유니버스 화면 시안 촬영(2026-10-29): node tools/map-style-shots.mjs [port] [width]
// 시안(basic·space·clean)마다 ① 팀장 박지훈 팀·부서 지도 + 인사이트 하나 강조 ② 김도윤 내 지도 + 업무 카드 ③ 업무 상세 「업무 지도」 탭.
// dist-single/index.html을 file://로 연다(외부 통신 막음). 자기 임시 프로필 Chrome만 정리한다.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch, sleep, waitFor } from './cdp.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, '../.tmp/map-style');
const HTML = resolve(ROOT, 'dist-single/index.html');
const port = Number(process.argv[2] || 9871);
const width = Number(process.argv[3] || 1440);
const only = process.env.STYLES ? process.env.STYLES.split(',') : ['basic', 'space', 'clean'];
await mkdir(OUT, { recursive: true });

const b = await launch({ port, profile: `C:/AI/work-universe/.tmp/itda-mapstyle-${port}`, width, height: Number(process.env.SHOT_H || 1300) });
const { cdp, ev } = b;
const dark = process.env.DARK === '1';
if (dark) await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
const tag = dark ? '-dark' : '';
const wait = (expr, ms = 8000) => waitFor(ev, expr, ms);
const setUser = (name) => ev(`(() => { const s = document.getElementById('user-switch'); const o = [...s.options].find((x) => x.textContent.includes(${JSON.stringify(name)})); if (!o) return false; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, o.value); s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
const mapReady = `!!(window.__itdaMap && window.__itdaMap.graph && window.__itdaMap.graph.cy.nodes().length > 3)`;
async function shot(name) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(resolve(OUT, `${name}${tag}${width !== 1440 ? `-w${width}` : ''}.png`), Buffer.from(data, 'base64'));
  console.log('shot', name);
}
async function go(hash) {
  await ev(`(() => { window.__itdaMap = null; location.hash = ${JSON.stringify(hash)}; return true; })()`);
}

try {
  for (const style of only) {
    await cdp.send('Page.navigate', { url: pathToFileURL(HTML).href });
    await wait('document.readyState === "complete" && !!document.getElementById("user-switch")', 15000);
    await ev(`localStorage.clear(); ${style === 'basic' ? '' : `localStorage.setItem('itda-map-style', '${style}');`} true`);
    await cdp.send('Page.reload');
    await sleep(400);
    await wait('document.readyState === "complete" && !!document.getElementById("user-switch")', 15000);

    // ① 팀장 팀·부서 지도 + 인사이트 하나 강조
    await setUser('박지훈');
    await sleep(300);
    await go('#/universe');
    await wait(mapReady, 8000);
    await sleep(1200);
    await ev(`document.querySelector('[data-testid="insight-kind-bottleneck"]')?.click(); true`);
    await sleep(200);
    await ev(`document.querySelector('[data-testid="insight-item"]')?.click(); true`);
    await sleep(1500);
    await ev('window.scrollTo(0, 0); true');
    await shot(`${style}-team-insight`);

    // ② 김도윤 내 지도 + 업무 카드
    await setUser('김도윤');
    await sleep(300);
    await go('#/dashboard');
    await sleep(300);
    await go('#/universe');
    await wait(mapReady, 8000);
    await sleep(1200);
    await ev(`(() => { const cy = window.__itdaMap.graph.cy; const n = cy.nodes().filter((x) => x.data('core_type') === 'work' && String(x.data('label')).includes('비대면 출금동의 추진')); (n.length ? n : cy.nodes().filter((x) => x.data('core_type') === 'work')).first().emit('tap'); return true; })()`);
    await sleep(1200);
    await shot(`${style}-mine-card`);

    // ③ 업무 상세 「업무 지도」 탭
    await go('#/works/W-001?tab=map');
    await wait(mapReady, 8000);
    await sleep(1200);
    await ev(`(() => { const el = document.querySelector('[data-testid="itda-workmap"]'); el && el.scrollIntoView({ block: 'center' }); return true; })()`);
    await sleep(500);
    await shot(`${style}-work-tab`);
  }
} finally {
  await b.close();
}
