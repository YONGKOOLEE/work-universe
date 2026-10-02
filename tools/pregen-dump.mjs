// 사전 생성 작성용 근거 덤프(T-12). Claude Code가 이 출력만 보고 문장을 쓴다(데이터 밖 내용을 쓰지 않도록 근거 내용을 함께 보인다).
// 사용: node tools/pregen-dump.mjs > .tmp/pregen-dump.txt
import { EXPLAIN_SCENARIOS, HANDOVER_SCENARIOS, explainRequestOf, handoverDraftOf } from './pregen-scenarios.mjs';
import { eventText } from '../app/src/view/describe.js';
import { itemEvidence } from '../app/src/llm/providers.js';

function describe(view, gid) {
  const hit = view.lookup(gid);
  if (hit.found) {
    const n = hit.node;
    const attrs = Object.entries(n.attrs || {}).map(([k, v]) => `${k}=${v}`).join('; ');
    return `${gid} [${n.type_label}] ${n.label}${n.emp_no ? ` (${n.emp_no})` : ''}${n.description ? ` — ${n.description}` : ''}${attrs ? ` {${attrs}}` : ''}`;
  }
  const ev = view.events.find((e) => e.gid === gid);
  return ev ? `${gid} [이력 ${ev.occurred_at}] ${eventText(view, ev)}` : `${gid} (없음)`;
}

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
