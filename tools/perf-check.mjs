// 규모 점검(NFR 처리량·지연, DA-1 "유니버스당 노드 수십~200"): 가상 노드 N개짜리 유니버스를 만들어
// 규칙 계산 시간을 재고(Node), --browser를 주면 Chrome에서 그래프 배치까지 잰다. 가상 데이터만 쓴다.
// 사용: node tools/perf-check.mjs 300 [--browser]
import { spawn } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createUniverse, addNode, addEdge, addEvent, addRef } from '../app/src/model/commands.js';
import { validateDocument } from '../app/src/model/validate.js';
import { buildView } from '../app/src/view/view.js';
import { projectView } from '../app/src/view/collapse.js';
import { buildHandoverDraft, scopeWorks } from '../app/src/rules/handover.js';
import { similarExperts, repeatInefficiency, densityGaps, personLoad, workLoad } from '../app/src/rules/insight.js';
import { flowChange, timeMonths } from '../app/src/rules/flow.js';
import { handoverReadiness } from '../app/src/rules/insight-risk.js';
import { formReport } from '../app/src/rules/form.js';
import { mergePlan } from '../app/src/merge/merge.js';
import { createProvider } from '../app/src/llm/providers.js';
import { refineDraft } from '../app/src/llm/connector.js';
import { PREGEN } from '../app/data/pregen.js';
import { filterDisplay, neighborhoodDisplay, searchNodes } from '../app/src/view/explore.js';

export function makeUniverse(n) {
  const ctx = { now: '2026-10-01T09:00:00+09:00' };
  let doc = createUniverse({ name: `규모 점검 ${n}`, level: '업무', owner: '가상 점검팀' }, ctx).doc;
  const root = doc.universe.root_node_id;
  const works = [];
  const people = [];
  const topics = [];
  const add = (input) => {
    const r = addNode(doc, input, ctx);
    doc = r.doc;
    return r.node.id;
  };
  const link = (source, target, core_type, extra = {}) => {
    const r = addEdge(doc, { source, target, core_type, ...extra }, ctx);
    if (r.ok) doc = r.doc;
  };
  const nTopics = Math.max(5, Math.round(n * 0.05));
  const nPeople = Math.max(5, Math.round(n * 0.25));
  const nWorks = Math.max(5, n - nTopics - nPeople - 1);
  for (let i = 0; i < nTopics; i += 1) topics.push(add({ core_type: 'topic', label: `가상 주제 ${i}` }));
  for (let i = 0; i < nPeople; i += 1) people.push(add({ core_type: 'person', label: `가상인물${i}`, emp_no: `V-${String(5000 + i).padStart(4, '0')}`, attrs: { 연락처: `내선 ${5000 + i}(가상)` } }));
  for (let i = 0; i < nWorks; i += 1) {
    const w = add({ core_type: 'work', label: `가상 업무 ${i}`, description: '규모 점검용 가상 업무', attrs: { 주기: '매월', 절차: '① 확인 ② 정리', 주의사항: '가상 주의사항' } });
    works.push(w);
    link(root, w, 'contains');
    link(w, topics[i % nTopics], 'relates_to');
    link(people[i % nPeople], w, 'performs', { period: { start: '2025-01-01', end: '2025-12-31' } });
    link(people[(i + 1) % nPeople], w, 'performs', { period: { start: '2026-01-01' } });
    if (i > 0 && i % 3) link(works[i - 1], w, 'precedes');
  }
  for (let i = 0; i < Math.min(nWorks, 60); i += 1) {
    doc = addEvent(doc, { type: 'memo', occurred_at: '2026-09-01', payload: { target_id: works[i], topic_ids: [topics[i % nTopics]] }, note: `가상 메모 ${i}` }, ctx).doc;
    doc = addEvent(doc, { type: 'handover', occurred_at: '2026-01-01', payload: { work_id: works[i], from_person_id: people[i % nPeople], to_person_id: people[(i + 1) % nPeople] } }, ctx).doc;
  }
  doc.universe.is_sample = false;
  return { doc, works, people };
}

function time(label, fn) {
  const t0 = performance.now();
  const out = fn();
  const ms = performance.now() - t0;
  console.log(`${label.padEnd(26)} ${ms.toFixed(1).padStart(8)} ms`);
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const n = Number(process.argv[2] || 300);
  const { doc, works, people } = makeUniverse(n);
  console.log(`노드 ${doc.nodes.length}개, 연결 ${doc.edges.length}개, 이벤트 ${doc.events.length}개, 문서 크기 ${(JSON.stringify(doc).length / 1024).toFixed(0)}KB\n`);
  time('문서 검증', () => validateDocument(doc));
  const view = time('합성 뷰(buildView)', () => buildView(doc));
  time('층별 보기(projectView)', () => projectView(view));
  time('유사 경험자(업무 1개)', () => similarExperts(view, { works: [`${doc.universe.id}/${works[0]}`], asOf: '2026-10-02' }));
  time('반복 비효율(전체)', () => repeatInefficiency(view));
  time('밀집·공백(전체)', () => densityGaps(view, { asOf: '2026-10-02' }));
  time('인수인계 초안(유니버스 전체)', () => buildHandoverDraft(view, { target: `${doc.universe.id}/${doc.universe.root_node_id}`, from: `${doc.universe.id}/${people[0]}`, to: `${doc.universe.id}/${people[1]}`, similar: [] }));
  time('초안 범위(scopeWorks)', () => scopeWorks(view, `${doc.universe.id}/${doc.universe.root_node_id}`));
  // 연속 진행으로 생긴 기능(T-11 흐름 변화·시간 보기, T-12 사전 생성, 상세 한 줄)
  time('흐름 변화(월)', () => flowChange(view, { unit: 'month', asOf: '2026-10-02' }));
  time('흐름 변화(과거 기준일 50회)', () => { for (let i = 0; i < 50; i += 1) flowChange(view, { unit: 'month', asOf: '2026-03-31' }); });
  time('시간 범위(timeMonths)', () => timeMonths(view, '2026-10-02'));
  // RV10C-4: 업무 3000개에서 느렸던 세 계산(연결·메모 색인으로 줄임). 통합 확인은 하위 업무 지도 셋을 묶은 뷰로 잰다
  time('인수인계 준비도(전체)', () => handoverReadiness(view, { asOf: '2026-10-02' }));
  time('표준 양식 점검(전체)', () => formReport(view));
  {
    const ctx = { now: '2026-10-01T09:00:00+09:00' };
    const kids = [0, 1, 2].map(() => makeUniverse(Math.max(10, Math.round(n / 3))).doc);
    const byId = new Map(kids.map((k) => [k.universe.id, k]));
    let parent = createUniverse({ name: '규모 점검 통합', level: '부서', owner: '가상 점검팀' }, ctx).doc;
    for (const k of kids) parent = addRef(parent, k.universe.id, ctx, (id) => byId.get(id) || null).doc;
    const merged = buildView(parent, (id) => byId.get(id) || null);
    time('통합 확인 목록(mergePlan)', () => mergePlan(merged, parent.identity_links));
  }
  const draft = buildHandoverDraft(view, { target: `${doc.universe.id}/${doc.universe.root_node_id}`, from: `${doc.universe.id}/${people[0]}`, to: `${doc.universe.id}/${people[1]}`, similar: [] }).draft;
  const exists = (g) => view.lookup(g).found || view.events.some((e) => e.gid === g);
  time('사전 생성 조회(초안, 결과 없음)', () => refineDraft(draft, { provider: createProvider('pregen', { pregen: PREGEN }), exists }));
  time('상세 한 줄(사람·업무 전부)', () => {
    for (const p of people) personLoad(view, `${doc.universe.id}/${p}`, { asOf: '2026-10-02' });
    for (const w of works) workLoad(view, `${doc.universe.id}/${w}`, { asOf: '2026-10-02' });
  });

  // T-18 큰 화면 탐색(R-17, limits L-25 재실측)
  const shownD = projectView(view);
  time('찾기(「가상」 일치 전부)', () => searchNodes(view, '가상'));
  time('거르기(유형: 업무)', () => filterDisplay(shownD, { types: ['work'] }));
  time('거르기(사람 하나)', () => filterDisplay(shownD, { person: `${doc.universe.id}/${people[0]}` }));
  time('주변만 보기(2단계)', () => neighborhoodDisplay(view, `${doc.universe.id}/${works[0]}`, 2));

  if (process.argv.includes('--browser')) {
    // Chrome에서 이 문서를 저장소에 넣고 열어, 첫 그래프가 그려질 때까지 시간을 잰다
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    const profile = join(root, '.tmp', `perf-${Date.now()}`);
    await mkdir(profile, { recursive: true });
    const port = 9911;
    const proc = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' });
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    let page;
    for (let i = 0; i < 80 && !page; i += 1) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page'); } catch { /* 시작 전 */ } await sleep(100); }
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r) => (ws.onopen = r));
    let id = 0;
    const pend = new Map();
    ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id) pend.get(d.id)(d.result); };
    const send = (method, params = {}) => new Promise((r) => { pend.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
    const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.value;
    const url = pathToFileURL(join(root, 'dist/index.html')).href;
    await send('Page.navigate', { url: `${url}?check#U-A1` });
    await sleep(1500);
    await ev(`(() => { const d = ${JSON.stringify(JSON.stringify(doc))}; const o = JSON.parse(d); localStorage.setItem('wu:v1:u:' + o.universe.id, d);
      const idx = JSON.parse(localStorage.getItem('wu:v1:index') || '[]'); idx.push({ id: o.universe.id, name: o.universe.name }); localStorage.setItem('wu:v1:index', JSON.stringify(idx)); })()`);
    const t0 = Date.now();
    // 주소의 # 부분만 바꾸면 다시 읽지 않으므로 직접 다시 읽게 한다
    await ev(`location.hash = '${doc.universe.id}'; location.reload()`).catch(() => {});
    let shown = 0;
    for (let i = 0; i < 600; i += 1) {
      shown = await ev(`window.__wu && window.__wu.doc && window.__wu.doc.universe.id === '${doc.universe.id}' ? window.__wu.cy.nodes().length : 0`).catch(() => 0);
      if (shown > 0) break;
      await sleep(100);
    }
    const openMs = Date.now() - t0;
    const relayout = await ev("(() => { const t = performance.now(); document.getElementById('relayout').click(); return performance.now() - t; })()");
    const select = await ev(`(() => { const t = performance.now(); window.__wu.select('${doc.universe.id}/${works[0]}'); return performance.now() - t; })()`);
    // 시간 보기: 슬라이더를 6칸 옮겨 흐림·상세 다시 계산까지, 흐름 변화 탭 열기
    const slide = await ev("(() => { const r = document.querySelector('[data-testid=time-range]'); const t = performance.now(); r.value = String(Math.max(0, Number(r.max) - 6)); r.dispatchEvent(new Event('input')); return performance.now() - t; })()");
    const flowTab = await ev("(() => { window.__wu.select(null); document.querySelector('[data-testid=btn-insight-universe]').click(); const t = performance.now(); document.querySelector('[data-testid=tab-flow]').click(); return performance.now() - t; })()");
    // T-18: 찾기 → 고르기(이동·확대), 유형 거르기, 주변만 보기 → 전체 보기
    await ev('window.__wu.select(null)');
    const find = await ev("(() => { const i = document.querySelector('[data-testid=find-input]'); i.value = '가상'; const t = performance.now(); i.dispatchEvent(new Event('input')); const n = document.querySelectorAll('[data-testid=find-hit]').length; document.querySelector('[data-testid=find-hit]').click(); return [performance.now() - t, n]; })()");
    await ev("document.querySelector('[data-testid=filter-open]').click()"); // 거르기 창의 확인란은 창이 열린 뒤(toggle 이벤트) 그려진다
    await sleep(150);
    const filt = await ev("(() => { const t = performance.now(); const c = document.querySelector('[data-testid=filter-type-work]'); c.checked = true; c.dispatchEvent(new Event('change')); const ms = performance.now() - t; document.querySelector('[data-testid=filter-clear]').click(); return ms; })()");
    const nb = await ev(`(() => { window.__wu.select('${doc.universe.id}/${works[0]}'); const t = performance.now(); document.querySelector('[data-testid=btn-nbhd2]').click(); const ms = performance.now() - t; const n = window.__wu.cy.nodes().length; const t2 = performance.now(); document.getElementById('fit').click(); return [ms, n, performance.now() - t2]; })()`);
    console.log(`[Chrome T-18] 찾기 입력~목록·고르기 ${Math.round(find[0])} ms(결과 ${find[1]}개 표시), 유형 거르기 ${Math.round(filt)} ms, 주변 2단계 ${Math.round(nb[0])} ms(노드 ${nb[1]}개), 전체 보기로 ${Math.round(nb[2])} ms`);
    console.log(`\n[Chrome] 열기~그래프 표시 ${openMs} ms (노드 ${shown}개), 다시 정렬 ${Math.round(relayout)} ms, 노드 선택·상세 ${Math.round(select)} ms, 시간 보기 이동 ${Math.round(slide)} ms, 흐름 변화 탭 ${Math.round(flowTab)} ms`);
    proc.kill();
    await sleep(500);
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }
  process.exit(0);
}
