// 소개자료·대본용 화면 캡처(CR-24 T-56). 시연 데이터로 화면을 차례로 열어 찍는다.
// 사용: node tools/intro-shots.mjs <출력 폴더> [포트] [--key]
//   --key: 저장소 밖 키 파일(%USERPROFILE%\.wu-anthropic-key.txt)을 점검용 임시 브라우저 저장소에만 넣고 Claude로 분석·검색한 화면을 찍는다.
//          키는 출력하지 않고, 임시 프로필은 끝나면 지운다. 키 입력 칸은 화면에 나오지 않는다.
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launch, sleep, waitFor } from './cdp.mjs';

const args = process.argv.slice(2);
const OUT = resolve(args[0] || '../.tmp/intro-shots');
const PORT = Number(args.find((a, i) => i > 0 && /^\d+$/.test(a)) || 9871);
const USE_KEY = args.includes('--key');
const PAGE = pathToFileURL(resolve('dist-single/index.html')).href;
const PDF = resolve('../.tmp/demo-docs/약관 개정 실무 회의록(시연용).pdf');

await mkdir(OUT, { recursive: true });
const b = await launch({ port: PORT, profile: `C:/AI/work-universe/.tmp/itda-shots-${PORT}`, width: 1440, height: 900 });
const { cdp, ev } = b;
const shot = async (name, clip) => {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
  await writeFile(join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
  console.log('shot', name);
};
const go = async (hash, ms = 1500) => {
  await ev(`location.hash = ${JSON.stringify(hash)}`);
  await sleep(ms);
};
const asUser = async (name) => {
  await ev(`(() => { const sel = [...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.textContent.includes(${JSON.stringify(name)}))); const o = [...sel.options].find((o) => o.textContent.includes(${JSON.stringify(name)})); sel.value = o.value; sel.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await sleep(900);
};
const tapNode = (label) => ev(`(() => { const n = window.__itdaMap.graph.cy.nodes().filter((x) => x.data('label').startsWith(${JSON.stringify(label)}))[0]; if (!n) return false; n.emit('tap'); return true; })()`);
const clickText = (sel, text) => ev(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.offsetParent && x.textContent.includes(${JSON.stringify(text)})); if (!e) return false; e.click(); return true; })()`);
const rect = (sel) => ev(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.x, y: r.y + window.scrollY, width: r.width, height: r.height }; })()`);
const log = [];
try {
  await cdp.send('Page.navigate', { url: PAGE });
  await sleep(1500);
  await ev('localStorage.clear()');
  if (USE_KEY) {
    const key = readFileSync(`${process.env.USERPROFILE}/.wu-anthropic-key.txt`, 'utf8').trim();
    await ev(`localStorage.setItem('itda-anthropic-key', ${JSON.stringify(key)}); localStorage.setItem('worklink-ai-engine', 'claude'); true`);
  }
  await cdp.send('Page.reload');
  await sleep(2000);

  // 1) 업무 상세(인계 자료) — 김도윤
  await go('#/works/W-001');
  await shot('01-work-detail');
  // 2) 업무 지도 탭
  await go('#/works/W-001?tab=map', 300);
  await clickText('button', '업무 지도');
  await sleep(2500);
  await ev(`document.querySelector('[data-testid=itda-workmap]')?.scrollIntoView({ block: 'center' })`);
  await sleep(600);
  await shot('02-work-map');

  // 3) 팀장: 팀·부서 지도 + 업무 카드(혼자만 아는 업무)
  await asUser('박지훈');
  await go('#/universe', 3000);
  await shot('03-team-map');
  await ev(`(() => { const r = window.__itdaMap.graph.cy.nodes('[core_type = "root"]').filter((n) => n.data('label').startsWith('출금이체팀'))[0]; r && r.emit('dbltap'); return !!r; })()`);
  await sleep(2500);
  log.push(['tap 출금이체 월 정산', await tapNode('출금이체 월 정산')]);
  await sleep(1200);
  await shot('04-team-map-open');

  // 4) 대시보드(팀장) — 점검 목록에 혼자만 아는 업무
  await go('#/dashboard', 1500);
  await shot('05-dashboard-lead');

  // 5) 인계: 지도로 본 인계 포인트 + 스냅샷 비교
  await go('#/handover/HO-002', 1800);
  await ev(`(() => { const c = document.querySelector('[data-testid=handover-points]'); c.scrollIntoView({ block: 'start' }); c.querySelector('[data-testid=handover-point-chip]')?.click(); window.scrollBy(0, -70); return true; })()`);
  await sleep(800);
  await shot('06-handover-points');
  await go('#/snapshots/S-101', 2500);
  await ev(`(() => { document.querySelector('[data-testid=snapshot-maps]').scrollIntoView({ block: 'start' }); window.scrollBy(0, -90); return true; })()`);
  await sleep(800);
  await shot('07-snapshot-maps');

  // 6) 문서 등록(PDF) → 분석 → 반영 미리보기 — 김도윤이 아니라 팀장(약관 개정 업무 담당)
  await go('#/docs', 1200);
  await clickText('button', '문서 등록');
  await sleep(800);
  const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#dr-file' });
  await cdp.send('DOM.setFileInputFiles', { nodeId, files: [PDF] });
  log.push(['pdf 읽음', await waitFor(ev, `document.querySelector('#dr-text') && document.querySelector('#dr-text').value.includes('개정 조문 대비표')`, 20000)]);
  await sleep(600);
  await shot('08-doc-pdf');
  await clickText('button', 'AI 분석');
  log.push(['분석 끝', await waitFor(ev, `[...document.querySelectorAll('h3')].some((h) => h.textContent.includes('업무 반영 미리보기'))`, USE_KEY ? 180000 : 15000)]);
  await sleep(1000);
  await ev(`(() => { const h = [...document.querySelectorAll('h3')].find((h) => h.textContent.includes('업무 반영 미리보기')); h.scrollIntoView({ block: 'start' }); return true; })()`);
  await sleep(600);
  await shot('09-doc-preview');
  await clickText('button', '원문 확인 항목 모두 승인');
  await sleep(300);
  await clickText('button', '문서 등록 ·');
  await sleep(2000);
  // 등록 뒤 지도: 약관 개정 업무에 담당 할 일이 붙음
  await go('#/works/W-003', 800);
  await clickText('button', '업무 지도');
  await sleep(2500);
  await ev(`document.querySelector('[data-testid=itda-workmap]')?.scrollIntoView({ block: 'center' })`);
  await sleep(600);
  await shot('10-after-doc-map');

  // 7) AI 업무 검색
  await go('#/search', 800);
  await ev(`(() => { const i = document.querySelector('main input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, '비대면 출금동의 현재 추진 경과는?'); i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await clickText('button', '질문');
  log.push(['검색 끝', await waitFor(ev, `document.body.innerText.includes('AI 종합 답변')`, USE_KEY ? 120000 : 8000)]);
  await sleep(1500);
  await shot('11-search');
} catch (e) {
  log.push(['error', String(e && e.stack || e)]);
} finally {
  console.log(JSON.stringify(log), JSON.stringify(b.logs.filter((l) => l.kind !== 'log').slice(0, 5)));
  await b.close();
}
