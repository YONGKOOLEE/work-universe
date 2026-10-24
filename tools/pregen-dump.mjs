// 사전 생성 작성용 근거 덤프(T-12). Claude Code가 이 출력만 보고 문장을 쓴다(데이터 밖 내용을 쓰지 않도록 근거 내용을 함께 보인다).
// 사용: node tools/pregen-dump.mjs > .tmp/pregen-dump.txt
// 지문 모드(문장은 건드리지 않고 app/data/pregen.js의 FP 표만 다룬다):
//   --fp        현재 규칙 기반 문장의 지문 표를 출력
//   --check-fp  pregen.js의 FP가 지금 규칙 기반 문장과 같은지 검사(다르면 종료 코드 1)
//   --write-fp  pregen.js의 FP 표를 다시 만든다(샘플을 고치고 사전 생성 문장을 새로 쓴 뒤)
import { EXPLAIN_SCENARIOS, HANDOVER_SCENARIOS, explainRequestOf, handoverDraftOf } from './pregen-scenarios.mjs';
import { describeEvidence } from '../app/src/llm/evidence-text.js';
import { itemEvidence, fingerprint } from '../app/src/llm/providers.js';
import { PREGEN } from '../app/data/pregen.js';
import { CANDIDATE_VIEWS, candidateRequestsOf } from './pregen-scenarios.mjs';
import fs from 'node:fs';

// pregen.js의 fpKey와 같은 키: task|target|item|보내는>받는|정렬한 근거 ID(같은 항목이 화면에 따라 근거가 다를 수 있다, CR-17 B)
const fpKey = (it) => [it.task, it.target, it.item || '', it.from && it.to ? `${it.from}>${it.to}` : '', [...(it.evidence_ids || [])].sort().join(',')].join('|');

/** 시나리오에서 만든 규칙 기반 문장의 지문 표(키 → 지문). 같은 키가 다른 지문이면 오류 */
function currentFingerprints() {
  const map = new Map();
  const put = (key, fp) => {
    if (map.has(key) && map.get(key) !== fp) throw new Error(`같은 키에 다른 지문: ${key}`);
    map.set(key, fp);
  };
  for (const s of HANDOVER_SCENARIOS) {
    const { draft } = handoverDraftOf(s);
    for (const item of draft.items) if (!item.insufficient) put(fpKey({ task: 'handover', target: draft.target, item: item.key, from: draft.from, to: draft.to, evidence_ids: itemEvidence(item) }), fingerprint(item.sentences));
  }
  for (const s of EXPLAIN_SCENARIOS) {
    const { req } = explainRequestOf(s);
    if (req) put(fpKey({ task: 'insight_explain', target: req.target, evidence_ids: req.evidence_ids }), fingerprint(req.rule));
  }
  for (const id of CANDIDATE_VIEWS) for (const req of candidateRequestsOf(id).reqs) put(fpKey({ task: req.task, target: req.target, evidence_ids: req.evidence_ids }), fingerprint(req.rule));
  return map;
}

const mode = process.argv.slice(2).find((a) => ['--fp', '--check-fp', '--write-fp'].includes(a));
if (mode) {
  const cur = currentFingerprints();
  const keys = PREGEN.items.map(fpKey);
  const missing = keys.filter((k) => !cur.has(k));
  if (missing.length) console.error(`시나리오에 없는 사전 생성 줄 ${missing.length}개:\n  ${missing.join('\n  ')}`);
  const rows = [...new Set(keys)].filter((k) => cur.has(k)).map((k) => `  ${JSON.stringify(k)}: '${cur.get(k)}',`);
  const table = `const FP = {\n${rows.join('\n')}\n};`;
  if (mode === '--fp') console.log(table);
  else if (mode === '--check-fp') {
    const stale = PREGEN.items.filter((it) => cur.get(fpKey(it)) !== it.fp).map((it) => fpKey(it));
    console.log(stale.length ? `불일치 ${stale.length}개:\n  ${stale.join('\n  ')}` : `지문 일치: ${PREGEN.items.length}줄`);
    process.exit(stale.length || missing.length ? 1 : 0);
  } else {
    const file = new URL('../app/data/pregen.js', import.meta.url);
    const src = fs.readFileSync(file, 'utf8');
    const re = /\/\/ FP-BEGIN\r?\n[\s\S]*?\/\/ FP-END/;
    if (!re.test(src)) throw new Error('pregen.js에 FP-BEGIN/FP-END 표식이 없습니다');
    fs.writeFileSync(file, src.replace(re, () => `// FP-BEGIN\n${table}\n// FP-END`));
    console.log(`FP 표 ${rows.length}개 키를 다시 만들었습니다`);
  }
  process.exit(missing.length ? 1 : 0);
}

// 근거 글 만들기는 llm/evidence-text.js 한 곳(실시간 프롬프트·quote 검증과 같은 글)
const describe = describeEvidence;

for (const s of HANDOVER_SCENARIOS) {
  const { view, draft } = handoverDraftOf(s);
  console.log(`\n=== ${s.id} handover target=${draft.target} (${s.note})`);
  for (const item of draft.items) {
    if (item.insufficient) { console.log(`\n-- ${item.key}: 이력 부족(사전 생성 안 함)`); continue; }
    console.log(`\n-- ${item.key} evidence=${JSON.stringify(itemEvidence(item))}`);
    for (const st of item.sentences) console.log(`   rule: ${st.text}  ${JSON.stringify(st.evidence_ids)}`);
    for (const g of itemEvidence(item)) console.log(`   · ${describe(view, g)}`);
  }
}
for (const s of EXPLAIN_SCENARIOS) {
  const { view, req } = explainRequestOf(s);
  console.log(`\n=== ${s.id} insight_explain ${s.kind} view=${s.view}`);
  if (!req) { console.log('   (설명 없음)'); continue; }
  console.log(`   target=${req.target}\n   evidence=${JSON.stringify(req.evidence_ids)}`);
  for (const st of req.rule) console.log(`   rule: ${st.text}  ${JSON.stringify(st.evidence_ids)}`);
  for (const g of req.evidence_ids) console.log(`   · ${describe(view, g)}`);
}
for (const id of CANDIDATE_VIEWS) {
  const { view, reqs } = candidateRequestsOf(id);
  for (const req of reqs) {
    console.log(`\n=== work_candidate_reason view=${id} ${req.title}\n   target=${req.target}\n   evidence=${JSON.stringify(req.evidence_ids)}`);
    for (const st of req.rule) console.log(`   rule: ${st.text}`);
    for (const g of req.evidence_ids) console.log(`   · ${describe(view, g)}`);
  }
}
