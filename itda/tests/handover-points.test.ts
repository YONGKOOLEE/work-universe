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
    const d = deriveMap(s, { kind: 'work', workId: 'W-001' }, '2026-10-29T00:00:00Z', { people: ['U1', 'U2'], centerAsWork: true, actions: false });
    const view = buildView(d.doc, d.resolve);
    const uid = d.doc.universe.id;
    const r = buildHandoverDraft(view, { target: `${uid}/N-work-W-001`, from: `${uid}/N-user-U1`, to: `${uid}/N-user-U2`, asOf: '2026-10-29' });
    expect(r.ok).toBe(true);
    const sentences = r.draft.items.flatMap((it: any) => it.sentences);
    expect(sentences.length).toBeGreaterThan(3);
    for (const st of sentences) for (const g of st.evidence_ids) expect(view.exists(g)).toBe(true);
    // 진행 중인 일·주의사항에 업무잇다 메모(현재·유의)가 들어간다
    const keys = r.draft.items.filter((it: any) => !it.insufficient).map((it: any) => it.key);
    expect(keys).toEqual(expect.arrayContaining(['진행_중']));
  });
  it('확정된 인계가 있는 업무는 「이전 인수인계」가 나오고, 문서에서 온 할 일은 받는 범위의 업무로 세지 않는다', () => {
    const s = createSeed('linked');
    const w = s.works.find((x) => x.id === 'W-007')!;
    const owner = w.owners[0];
    const other = s.users.find((u) => u.id !== owner && !w.owners.includes(u.id))!.id;
    const d = deriveMap(s, { kind: 'work', workId: 'W-007' }, '2026-10-29T00:00:00Z', { people: [owner, other], centerAsWork: true, actions: false });
    const view = buildView(d.doc, d.resolve);
    const uid = d.doc.universe.id;
    const r = buildHandoverDraft(view, { target: `${uid}/N-work-W-007`, from: `${uid}/N-user-${owner}`, to: `${uid}/N-user-${other}`, asOf: '2026-10-29' });
    const prev = r.draft.items.find((it: any) => it.key === '이전_인수인계');
    expect(prev.sentences.length).toBeGreaterThan(0);
    const range = r.draft.items.find((it: any) => it.key === '받는_범위');
    const actionTitles = s.actions.filter((a) => a.workId === 'W-007').map((a) => a.title);
    expect(range.sentences.every((st: any) => !actionTitles.some((t) => st.text.includes(t)))).toBe(true);
  });
});
