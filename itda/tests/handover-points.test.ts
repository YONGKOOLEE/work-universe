import { describe, expect, it } from 'vitest';
import { deriveMap } from '../src/universe/derive';
import { createSeed } from '../src/data/seed';
// @ts-expect-error 유니버스 순수 모듈(JS)
import { buildView } from '../../app/src/view/view.js';
// @ts-expect-error 유니버스 순수 모듈(JS)
import { buildHandoverDraft } from '../../app/src/rules/handover.js';

describe('지도로 본 인계 포인트(업무 유니버스 인수인계 규칙)', () => {
  it('아직 담당이 아닌 인수자도 지도에 있어 초안이 만들어지고, 문장마다 근거 ID가 실제로 있다', () => {
    const s = createSeed('linked');
    const d = deriveMap(s, { kind: 'work', workId: 'W-001' }, '2026-10-29T00:00:00Z', { people: ['U1', 'U2'] });
    const view = buildView(d.doc, d.resolve);
    const uid = d.doc.universe.id;
    const r = buildHandoverDraft(view, { target: `${uid}/N-000`, from: `${uid}/N-user-U1`, to: `${uid}/N-user-U2`, asOf: '2026-10-29' });
    expect(r.ok).toBe(true);
    const sentences = r.draft.items.flatMap((it: any) => it.sentences);
    expect(sentences.length).toBeGreaterThan(3);
    for (const st of sentences) for (const g of st.evidence_ids) expect(view.exists(g)).toBe(true);
    // 진행 중인 일·주의사항에 업무잇다 메모(현재·유의)가 들어간다
    const keys = r.draft.items.filter((it: any) => !it.insufficient).map((it: any) => it.key);
    expect(keys).toEqual(expect.arrayContaining(['진행_중']));
  });
});
