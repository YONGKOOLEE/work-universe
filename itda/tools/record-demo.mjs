// 시연 영상 자동 녹화(docs/시연-대본-업무잇다.md). 설치 없이 헤드리스 Chrome만 쓴다:
//   앱 탭을 Page.startScreencast로 받아 → 녹화 탭의 캔버스에 그리고 → MediaRecorder(video/mp4;codecs=avc1)로 저장.
//   자막·클릭 표시(빨간 원)·제목 카드는 앱 화면 위에 그린다. Claude를 기다리는 동안은 녹화를 잠시 멈춘다(영상에서는 「약 20초 소요」 자막).
// 사용: node tools/record-demo.mjs <출력.mp4> [포트] [--key]
//   --key: 저장소 밖 키 파일을 이 임시 브라우저 저장소에만 넣고 실제 Claude로 분석·검색. 키는 화면·로그에 나오지 않는다.
// 먼저 npx vite build --mode single, node tools/make-demo-pdfs.mjs ../.tmp/demo-docs
import { readFileSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { connect, launch, sleep, waitFor } from './cdp.mjs';

const args = process.argv.slice(2);
const OUT = resolve(args[0] || '../.tmp/video/업무잇다_시연영상.mp4');
const PORT = Number(args.find((a, i) => i > 0 && /^\d+$/.test(a)) || 9891);
const USE_KEY = args.includes('--key');
const APP = pathToFileURL(resolve('dist-single/index.html')).href;
const PDF = resolve('../.tmp/demo-docs/약관 개정 실무 회의록(시연용).pdf');
const W = 1440;
const H = 900;

await mkdir(dirname(OUT), { recursive: true });
const recHtml = resolve('../.tmp/video/recorder.html');
await writeFile(
  recHtml,
  `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#000"><canvas id="c" width="${W}" height="${H}"></canvas><script>
const c = document.getElementById('c'), g = c.getContext('2d'); let last = null; let rec = null; const chunks = [];
setInterval(() => { if (last) g.drawImage(last, 0, 0, ${W}, ${H}); }, 1000 / 30);
window.__draw = (b64) => new Promise((ok) => { const im = new Image(); im.onload = () => { last = im; g.drawImage(im, 0, 0, ${W}, ${H}); ok(true); }; im.src = 'data:image/jpeg;base64,' + b64; });
window.__start = () => { const st = c.captureStream(30); rec = new MediaRecorder(st, { mimeType: 'video/mp4;codecs=avc1', videoBitsPerSecond: 6000000 }); rec.ondataavailable = (e) => e.data.size && chunks.push(e.data); rec.start(1000); return rec.state; };
window.__pause = () => { rec.pause(); return rec.state; };
window.__resume = () => { rec.resume(); return rec.state; };
window.__stop = () => new Promise((ok) => { rec.onstop = async () => { const b = new Blob(chunks, { type: 'video/mp4' }); window.__buf = new Uint8Array(await b.arrayBuffer()); ok(window.__buf.length); }; rec.stop(); });
window.__part = (i, n) => { let s = ''; const a = window.__buf.subarray(i, i + n); for (let k = 0; k < a.length; k += 0x8000) s += String.fromCharCode.apply(null, a.subarray(k, k + 0x8000)); return btoa(s); };
</script>`,
);

const b = await launch({ port: PORT, profile: `C:/AI/work-universe/.tmp/itda-rec-${PORT}`, width: W, height: H, network: USE_KEY, extraArgs: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const { cdp, ev } = b;
// 녹화 탭
const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(pathToFileURL(recHtml).href)}`, { method: 'PUT' })).json();
const rc = connect(t.webSocketDebuggerUrl);
await rc.opened;
await rc.send('Runtime.enable');
const rev = async (expression) => {
  const r = await rc.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
await sleep(800);
// 화면 전송(screencast)은 앞에 있는 탭에서만 온다 — 녹화 탭을 연 뒤 앱 탭을 다시 앞으로
await cdp.send('Page.bringToFront');

// 화면 → 녹화 탭
let frames = 0;
cdp.on((m) => {
  if (m.method !== 'Page.screencastFrame') return;
  cdp.send('Page.screencastFrameAck', { sessionId: m.params.sessionId }).catch(() => {});
  frames += 1;
  rc.send('Runtime.evaluate', { expression: `window.__draw(${JSON.stringify(m.params.data)})`, awaitPromise: false }).catch(() => {});
});

// 앱 위에 그리는 것: 자막·클릭 원·제목 카드
const OVERLAY = `(() => {
  if (window.__ov) return;
  const st = document.createElement('style');
  st.textContent = '#__cap{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:2147483646;background:rgba(17,27,45,.86);color:#fff;border-radius:12px;padding:12px 26px 13px;text-align:center;font-family:"Malgun Gothic",sans-serif;max-width:1100px;box-shadow:0 8px 30px rgba(0,0,0,.25);transition:opacity .25s}#__cap b{display:block;font-size:23px;line-height:1.35;letter-spacing:-.3px}#__cap span{display:block;font-size:16px;opacity:.82;margin-top:4px}#__cap:empty{opacity:0}.__ring{position:fixed;width:46px;height:46px;margin:-23px 0 0 -23px;border:4px solid #e5383b;border-radius:50%;z-index:2147483647;pointer-events:none;animation:__r .9s ease-out forwards}@keyframes __r{0%{transform:scale(.4);opacity:1}100%{transform:scale(1.25);opacity:0}}#__card{position:fixed;inset:0;z-index:2147483647;background:linear-gradient(135deg,#14295c,#1d3f99);color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:"Malgun Gothic",sans-serif;text-align:center}#__card h1{font-size:64px;margin:0 0 18px;letter-spacing:-2px}#__card p{font-size:26px;margin:4px 0;opacity:.95}#__card small{font-size:17px;opacity:.7;margin-top:26px}';
  document.head.appendChild(st);
  const cap = document.createElement('div'); cap.id = '__cap'; document.body.appendChild(cap);
  window.__ov = {
    cap(big, small) { cap.innerHTML = big ? '<b>' + big + '</b>' + (small ? '<span>' + small + '</span>' : '') : ''; },
    ring(x, y) { const r = document.createElement('div'); r.className = '__ring'; r.style.left = x + 'px'; r.style.top = y + 'px'; document.body.appendChild(r); setTimeout(() => r.remove(), 950); },
    card(h, lines, small) { let c = document.getElementById('__card'); if (!h) { c && c.remove(); return; } if (!c) { c = document.createElement('div'); c.id = '__card'; document.body.appendChild(c); } c.innerHTML = '<h1>' + h + '</h1>' + lines.map((l) => '<p>' + l + '</p>').join('') + (small ? '<small>' + small + '</small>' : ''); },
  };
})()`;
const HELP = `(() => {
  const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const vis = (e) => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
  window.__d = {
    find(sel, text, exact) { return [...document.querySelectorAll(sel)].filter(vis).find((e) => { const t = norm(e.textContent); return exact ? t === text : t.includes(text); }) || null; },
    setVal(el, v) { const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v); el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); },
    cy() { return window.__itdaMap && window.__itdaMap.graph && window.__itdaMap.graph.cy; },
  };
})()`;
const prep = async () => {
  await ev(OVERLAY);
  await ev(HELP);
};
let capNo = 0;
const FRAMES = resolve(dirname(OUT), 'frames');
await mkdir(FRAMES, { recursive: true });
/** 자막을 바꾸고, 1.5초 뒤 그 장면을 검토용 그림으로 남긴다(영상에는 영향 없음) */
const cap = async (big, small = '') => {
  await ev(`window.__ov.cap(${JSON.stringify(big)}, ${JSON.stringify(small)})`);
  if (!big) return;
  const no = String(++capNo).padStart(2, '0');
  setTimeout(() => cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 70 }).then(({ data }) => writeFile(resolve(FRAMES, `${no}.jpg`), Buffer.from(data, 'base64'))).catch(() => {}), 1500);
};
/** 요소를 화면 안으로 → 빨간 원 → 클릭 */
async function click(sel, text, { exact = false, block = 'center', pause = 650 } = {}) {
  const pos = await ev(`(() => { const e = window.__d.find(${JSON.stringify(sel)}, ${JSON.stringify(text)}, ${exact}); if (!e) return null; e.scrollIntoView({ block: ${JSON.stringify(block)}, behavior: 'instant' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  if (!pos) throw new Error(`못 찾음: ${sel} 「${text}」`);
  await ev(`window.__ov.ring(${pos.x}, ${pos.y})`);
  await sleep(pause);
  await ev(`window.__d.find(${JSON.stringify(sel)}, ${JSON.stringify(text)}, ${exact}).click()`);
  return pos;
}
async function clickSel(selector, { pause = 650 } = {}) {
  const pos = await ev(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; e.scrollIntoView({ block: 'center', behavior: 'instant' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  if (!pos) throw new Error(`못 찾음: ${selector}`);
  await ev(`window.__ov.ring(${pos.x}, ${pos.y})`);
  await sleep(pause);
  await ev(`document.querySelector(${JSON.stringify(selector)}).click()`);
}
/** 그래프 항목: 이름으로 찾아 화면 위치에 원 → tap/dbltap */
async function tapNode(label, kind = 'tap', { pause = 700 } = {}) {
  const pos = await ev(`(() => { const cy = window.__d.cy(); if (!cy) return null; let n = cy.nodes().filter((x) => String(x.data('label')).split('\\n')[0] === ${JSON.stringify(label)}); if (!n.length) n = cy.nodes().filter((x) => String(x.data('label')).startsWith(${JSON.stringify(label)})); if (!n.length) return null; const p = n.first().renderedPosition(); const r = cy.container().getBoundingClientRect(); return { x: r.x + p.x, y: r.y + p.y }; })()`);
  if (!pos) throw new Error(`지도 항목 못 찾음: ${label}`);
  await ev(`window.__ov.ring(${pos.x}, ${pos.y})`);
  await sleep(pause);
  await ev(`(() => { const cy = window.__d.cy(); let n = cy.nodes().filter((x) => String(x.data('label')).split('\\n')[0] === ${JSON.stringify(label)}); if (!n.length) n = cy.nodes().filter((x) => String(x.data('label')).startsWith(${JSON.stringify(label)})); n.first().emit(${JSON.stringify(kind)}); return true; })()`);
}
async function user(name) {
  await clickSel('#user-switch', { pause: 500 });
  await ev(`(() => { const s = document.getElementById('user-switch'); const o = [...s.options].find((x) => x.textContent.includes(${JSON.stringify(name)})); window.__d.setVal(s, o.value); return true; })()`);
  await sleep(900);
}
async function go(hash, ms = 1300) {
  await ev(`(() => { window.__itdaMap = null; location.hash = ${JSON.stringify(hash)}; return true; })()`);
  await sleep(ms);
}
async function typeInto(selector, text, perChar = 45) {
  for (let i = 1; i <= text.length; i += 2) {
    await ev(`window.__d.setVal(document.querySelector(${JSON.stringify(selector)}), ${JSON.stringify(text.slice(0, i))})`);
    await sleep(perChar);
  }
  await ev(`window.__d.setVal(document.querySelector(${JSON.stringify(selector)}), ${JSON.stringify(text)})`);
}
const scrollTo = (selector, block = 'start', dy = 0) => ev(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return false; e.scrollIntoView({ block: ${JSON.stringify(block)}, behavior: 'smooth' }); setTimeout(() => document.getElementById('main-scroll')?.scrollBy({ top: ${dy}, behavior: 'smooth' }), 450); return true; })()`);
const scrollMain = (y) => ev(`(() => { const m = document.getElementById('main-scroll') || document.scrollingElement; m.scrollTo({ top: ${y}, behavior: 'smooth' }); return true; })()`);
async function waitPaused(expr, ms, note) {
  await cap(note[0], note[1]);
  await sleep(1200);
  await rev('window.__pause()');
  const ok = await waitFor(ev, expr, ms);
  await sleep(600);
  await rev('window.__resume()');
  return ok;
}

// 가상 고객·가상 대화(AI 비서 장면). 전화번호·이메일 없음
const CONVERSATION = '김도현: 지난번 제안서는 잘 받았습니다. 다음 달 3일까지 수정 견적을 보내 주시면 좋겠어요.\n가상 영업: 네, 3일까지 보내 드리겠습니다. 다음 미팅 때 식사도 같이 하시죠.\n김도현: 좋습니다. 저는 해산물을 잘 못 먹어서 한식이면 좋겠고요, 요즘은 주말마다 등산을 다닙니다.\n가상 영업: 알겠습니다. 한식으로 예약하겠습니다.';

const log = [];
try {
  await cdp.send('Page.navigate', { url: APP });
  await sleep(1500);
  await ev('localStorage.clear()');
  if (USE_KEY) {
    const key = readFileSync(`${process.env.USERPROFILE}/.wu-anthropic-key.txt`, 'utf8').trim();
    await ev(`localStorage.setItem('itda-anthropic-key', ${JSON.stringify(key)}); localStorage.setItem('worklink-ai-engine', 'claude'); true`);
  }
  await cdp.send('Page.reload');
  await sleep(2200);
  await prep();
  await cdp.send('Page.bringToFront');
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  await sleep(500);
  await sleep(800);
  log.push(['첫 화면까지 frames', frames]);
  // 1 제목 — 영상 첫 장면이 제목 카드가 되도록 녹화 전에 띄운다
  await ev(`window.__ov.card('업무잇다', ['평소의 업무 기록이 곧 인수인계', '모이면 조직의 업무 지도'], '시연 영상 · 등장 인물·부서·기관·문서는 모두 시연용 가상 자료입니다')`);
  await sleep(900);
  log.push(['rec', await rev('window.__start()')]);
  await sleep(4200);
  await ev(`window.__ov.card(null)`);

  // 2 대시보드(박지훈 — 약관 개정 업무 담당)
  await user('박지훈');
  await cap('업무 단위로 일하는 화면', '내 업무·남은 조치·AI가 발견한 누락 항목을 한눈에');
  await sleep(3500);
  await scrollMain(420);
  await sleep(2500);
  await scrollMain(0);

  // 3 문서 등록(PDF) → AI 분석
  await cap('문서함에서 회의록 PDF를 등록', 'PDF를 올리면 쪽·문단 번호를 유지해 본문과 작성일을 자동으로 읽음');
  await click('nav a', '문서함');
  await sleep(1000);
  await click('button', '문서 등록');
  await sleep(900);
  const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#dr-file' });
  await cdp.send('DOM.setFileInputFiles', { nodeId, files: [PDF] });
  log.push(['pdf', await waitFor(ev, `document.querySelector('#dr-text') && document.querySelector('#dr-text').value.includes('개정 조문 대비표')`, 20000)]);
  await sleep(2600);
  await cap('AI가 결정·일정·조치(담당·기한)·주제를 뽑음', USE_KEY ? '꼼꼼히 읽기(두 번째 대조)까지 — 원문 구절과 문단 번호를 함께 냄' : '키가 없으면 규칙 기반으로 같은 흐름');
  await click('button', 'AI 분석');
  log.push(['분석', await waitPaused(`[...document.querySelectorAll('h3')].some((h) => h.textContent.includes('업무 반영 미리보기'))`, 200000, ['AI가 문서를 읽는 중…', '실제 약 20~40초 — 영상에서는 줄임'])]);
  await sleep(500);

  // 4 미리보기·승인
  await ev(`(() => { const h = [...document.querySelectorAll('h3')].find((h) => h.textContent.includes('업무 반영 미리보기')); h.scrollIntoView({ block: 'start', behavior: 'smooth' }); return true; })()`);
  await cap('앱이 AI의 근거 구절을 원문과 대조', '원문에 있으면 「원문 확인」, 없으면 「추가 확인 필요」로 낮춤');
  await sleep(3800);
  await ev(`(() => { const s = document.querySelector('[data-testid=proposal-owner]'); s && s.scrollIntoView({ block: 'center', behavior: 'smooth' }); return true; })()`);
  await sleep(900);
  await ev(`(() => { const s = document.querySelector('[data-testid=proposal-owner]'); if (!s) return false; const r = s.getBoundingClientRect(); window.__ov.ring(r.x + r.width / 2, r.y + r.height / 2); return true; })()`);
  await cap('표의 과제·담당·기한 → 담당 사용자와 기한까지', '담당은 원문에 있는 이름만 — 지어내지 않음');
  await sleep(3600);
  await cap('담당자가 승인한 항목만 업무에 반영');
  await click('button', '원문 확인 항목 모두 승인');
  await sleep(1400);
  await click('button', '문서 등록 ·');
  await sleep(2200);

  // 5 업무 상세 + 근거 칩
  await go('#/works/W-003', 1500);
  await cap('업무 화면이 곧 인계 자료', '「업무 한눈에 보기」 — 무엇·왜·결정·현재·앞으로');
  await sleep(3000);
  await scrollMain(380);
  await sleep(1600);
  await cap('문장마다 근거 — 누르면 원문 문단으로');
  const cited = await ev(`(() => { const a = [...document.querySelectorAll('a,button')].filter((e) => e.offsetParent && /실무 회의록 · 1쪽/.test(e.textContent))[0]; if (!a) return false; a.scrollIntoView({ block: 'center', behavior: 'instant' }); const r = a.getBoundingClientRect(); window.__ov.ring(r.x + r.width / 2, r.y + r.height / 2); return true; })()`);
  await sleep(800);
  if (cited) await ev(`[...document.querySelectorAll('a,button')].filter((e) => e.offsetParent && /실무 회의록 · 1쪽/.test(e.textContent))[0].click()`);
  await sleep(3200);

  // 6 업무 지도 탭
  await cap('');
  await go('#/works/W-003', 1200);
  await click('button', '업무 지도', { exact: true });
  await sleep(2200);
  await scrollTo('[data-testid=itda-workmap]', 'center');
  await cap('승인한 할 일이 업무 지도에', '누가 무엇을 언제까지 — 담당자와 할 일이 선으로 이어짐');
  await sleep(2600);
  try {
    await tapNode('개정 조문 대비표 작성');
  } catch (e) {
    log.push(['tap 할 일', String(e.message)]);
  }
  await sleep(3000);

  // 7 부장: 팀·부서 지도
  await user('서지안');
  await click('nav a', '업무 유니버스');
  await sleep(2200);
  await click('button', '전자금융부 · 업무');
  await sleep(2200);
  await ev(`window.__itdaMap.graph.cy.container().scrollIntoView({ block: 'start', behavior: 'smooth' }); setTimeout(() => document.getElementById('main-scroll')?.scrollBy({ top: -24, behavior: 'smooth' }), 450); true`);
  await sleep(900);
  await cap('업무가 모이면 팀·부서 지도로', '부장 화면 — 팀을 접고 펼쳐 봄');
  await sleep(3000);
  await tapNode('출금이체팀', 'dbltap');
  await sleep(2600);
  await cap('한 사람만 해 본 업무를 미리 찾음', '오른쪽 인사이트 — 혼자만 아는 일·빠지면 막히는 사람');
  await sleep(3000);
  await tapNode('출금이체 월 정산');
  await sleep(1500);
  await cap('지도에서 바로 고침', '메모 남기기 → 업무 화면의 유의사항에 그대로 반영');
  await clickSel('[data-testid=map-edit-memo]');
  await sleep(500);
  await typeInto('[data-testid=map-memo-text]', '정산 집계는 매월 3영업일까지 끝내야 함 — 늦으면 참가기관 정산이 밀림');
  await sleep(500);
  await clickSel('[data-testid=map-memo-save]');
  await sleep(2600);

  // 8 인계
  await user('김도윤');
  await click('nav a', '업무 인계 관리');
  await sleep(1300);
  await cap('인사이동 때는 업무 화면을 그대로 넘김', '인수인계서를 따로 쓰지 않음 — 인수자 지정 후 인계 시작');
  await ev(`(() => { const s = document.getElementById('ho-work'); s && window.__d.setVal(s, 'W-001'); const t = document.getElementById('ho-to'); const o = [...t.options].find((x) => x.textContent.includes('이서연')); window.__d.setVal(t, o.value); return true; })()`);
  await sleep(1200);
  await click('button', '인계 시작', { exact: true });
  await sleep(1500);
  await click('button', '점검 실행');
  log.push(['점검', await waitPaused(`document.querySelectorAll('input[id^=chk-]').length > 0 && !document.querySelector('input[id^=chk-]').disabled && !document.body.innerText.includes('점검 중')`, 120000, ['AI가 인계 자료를 점검하는 중…', '영상에서는 줄임'])]);
  await sleep(600);
  await scrollTo('[data-testid=handover-points]', 'start', -70);
  await cap('지도로 본 인계 포인트', '받는 범위·주의·진행 중·관계자 — 근거 칩을 누르면 근거 기록이 펼쳐짐');
  await sleep(1400);
  await clickSel('[data-testid=handover-point-chip]');
  await sleep(3200);
  await ev(`(() => { [...document.querySelectorAll('input[id^=chk-]')].forEach((e) => e.click()); return true; })()`);
  await sleep(500);
  await click('label', '담당에서 빠짐');
  await sleep(600);
  await cap('사전 점검 → 확인 → 제출 → 인수자 확인 → 확정');
  await click('button', '인계 제출', { exact: true });
  await sleep(1500);
  await click('button', '이서연(으)로 전환');
  await sleep(1300);
  await click('button', '인수 확인', { exact: true });
  await sleep(1300);
  await click('button', '인계 확정 및 업무정보 스냅샷 보존');
  await sleep(1800);
  await cap('확정 시점의 업무 지도를 스냅샷으로', '인계 당시 ↔ 지금 — 끝난 담당은 점선 「전 담당」');
  await click('button', '인계 당시 스냅샷 조회');
  await sleep(2200);
  await scrollTo('[data-testid=snapshot-maps]', 'start', -80);
  await sleep(4200);

  // 9 AI 업무 검색
  await click('nav a', 'AI 업무 검색');
  await sleep(1000);
  await cap('AI 업무 검색 — 묻는 업무의 등록 자료로만 답함');
  await typeInto('main input', '비대면 출금동의 현재 추진 경과는?', 60);
  await click('button', '질문', { exact: true });
  log.push(['검색', await waitPaused(`(document.querySelector('main') || document.body).innerText.includes('AI 종합 답변') && !(document.querySelector('main') || document.body).innerText.includes('근거를 찾는 중')`, 120000, ['AI가 등록 자료에서 근거를 찾는 중…', '실제 약 15~20초 — 영상에서는 줄임'])]);
  await cap('문장마다 원문 확인·AI 추론·추가 확인 필요', '인용은 앱이 원문과 대조 — 맞지 않으면 확정하지 않음');
  await sleep(2000);
  await scrollMain(260);
  await sleep(3200);

  // 9-2 AI 비서 — 약 20초. 고객 담당 김도윤, 가상 고객 김도현(CU-001), 가상 대화
  await user('김도윤');
  await click('nav a', 'AI 비서');
  await sleep(900);
  await cap('고객 맥락도 끊기지 않게 — AI 비서', '오늘 챙길 연락·요청·기념일을 한 화면에');
  await sleep(2800);
  await go('#/assistant/analyze', 900);
  await ev(`window.__d.setVal(document.querySelector('[data-testid=asst-an-customer]'), 'CU-001'); true`);
  await sleep(200);
  await ev(`window.__d.setVal(document.querySelector('[data-testid=asst-an-text]'), ${JSON.stringify(CONVERSATION)}); true`);
  await cap('고객과 나눈 대화를 붙여 넣으면', '보내는 내용을 먼저 보여 주고, 동의해야 전송');
  await sleep(1500);
  await clickSel('[data-testid=asst-an-preview-btn]');
  await sleep(1400);
  await clickSel('[data-testid=asst-an-consent]', { pause: 400 });
  await sleep(500);
  await clickSel('[data-testid=asst-an-send]', { pause: 400 });
  log.push(['대화 분석', await waitPaused(`!!document.querySelector('[data-testid=asst-an-review]')`, 120000, ['AI가 대화를 정리하는 중…', '영상에서는 줄임'])]);
  await ev(`document.querySelector('[data-testid=asst-an-items]')?.scrollIntoView({ block: 'start', behavior: 'smooth' }); true`);
  await cap('요청·선호·기념일을 근거 문장과 함께 제안', '앱이 원문과 대조 — 담당자가 고른 것만 고객 기록에');
  await sleep(3400);
  await clickSel('[data-testid=asst-an-apply]');
  await sleep(1800);
  log.push(['대화 저장', await ev(`!!document.querySelector('[data-testid=asst-an-done]')`)]);
  await go('#/assistant/customers/CU-001?tab=history', 1000);
  await cap('담당이 바뀌어도 고객 이력이 그대로', '방금 대화가 히스토리에 — 미팅 전 브리핑으로도 이어짐');
  await sleep(2600);

  // 10 마무리
  await cap('');
  await ev(`window.__ov.card('업무잇다', ['파일 하나로 시작 → 합쳐 불러오기로 팀 지도 → 사내 연계로 조직까지', '업무 등록 · 문서 반영 · 업무 지도 · 인계 · AI 검색 · AI 비서'], '평소의 업무 기록이 곧 인수인계')`);
  await sleep(4500);
  log.push(['frames', frames]);
  const size = await rev('window.__stop()');
  const parts = [];
  for (let i = 0; i < size; i += 4 * 1024 * 1024) parts.push(Buffer.from(await rev(`window.__part(${i}, ${4 * 1024 * 1024})`), 'base64'));
  await writeFile(OUT, Buffer.concat(parts));
  log.push(['mp4', OUT, size]);
} catch (e) {
  log.push(['error', String((e && e.stack) || e).slice(0, 600)]);
} finally {
  console.log(JSON.stringify(log, null, 1));
  console.log(JSON.stringify(b.logs.filter((l) => l.kind !== 'log').slice(0, 6)));
  rc.close();
  await b.close();
}
