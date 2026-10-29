// 넓은 화면 촬영(2026-10-29 사용자 "전체화면으로 하면 너무 빈공간이 많아보이지 않아?"): node tools/wide-shots.mjs [width] [tag] [port]
// dist-single/index.html을 file://로 열어 주요 화면을 찍는다. 앱 소스는 고치지 않는다. 자기 임시 프로필로 띄운 Chrome만 정리한다.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch, sleep, waitFor } from './cdp.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const width = Number(process.argv[2] || 2560);
const tag = process.argv[3] || 'now';
const port = Number(process.argv[4] || 9871);
const OUT = resolve(ROOT, '../.tmp/itda-wide');
await mkdir(OUT, { recursive: true });

const PAGES = [
  ['대시보드', '#/dashboard'],
  ['업무관리', '#/works'],
  ['업무상세', '#/works/W-001'],
  ['문서함', '#/docs'],
  ['문서상세', '#/docs/D-101'],
  ['타임라인', '#/timeline'],
  ['회의록', '#/meetings'],
  ['AI검색', '#/search'],
  ['인계', '#/handover'],
  ['사람', '#/people'],
  ['유니버스', '#/universe'],
];

const b = await launch({ port, profile: `C:/AI/work-universe/.tmp/itda-wide-${port}`, width, height: 1300 });
const { cdp, ev } = b;
try {
  await cdp.send('Page.navigate', { url: pathToFileURL(resolve(ROOT, 'dist-single/index.html')).href });
  await waitFor(ev, 'document.readyState === "complete" && !!document.getElementById("user-switch")', 15000);
  await ev(`localStorage.clear(); localStorage.setItem('itda-theme', 'dark'); true`);
  await cdp.send('Page.reload');
  await sleep(500);
  await waitFor(ev, 'document.readyState === "complete" && !!document.getElementById("user-switch")', 15000);
  for (const [name, hash] of PAGES) {
    await ev(`location.hash = ${JSON.stringify(hash)}; true`);
    await sleep(name === '유니버스' ? 2500 : 900);
    await ev(`document.getElementById('main-scroll')?.scrollTo(0, 0); true`);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(resolve(OUT, `${tag}-w${width}-${name}.png`), Buffer.from(data, 'base64'));
    console.log(`찍음 ${name}`);
  }
} finally {
  await b.close();
}
console.log(`폴더: ${OUT}`);
