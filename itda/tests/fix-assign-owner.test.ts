// A-M7: 확정 전 인계가 있는 업무는 「담당만 바로 바꾸기」(hand)를 막는다
import { describe, expect, it } from 'vitest';
import { assignOwner, pendingHandoverOf } from '../src/universe/commands';
import { createSeed } from '../src/data/seed';
import type { AppState, Handover, HandoverStatus } from '../src/lib/types';

const TODAY = '2026-10-29';
function withHandover(status: HandoverStatus): { s: AppState; workId: string } {
  const s = createSeed('linked', new Date('2026-10-29T00:00:00Z'));
  s.handovers = [];
  const w = s.works[0];
  const h: Handover = { id: 'HO-T1', workId: w.id, fromId: w.owners[0], toId: 'U2', baseDate: TODAY, status, step: 3, precheckDone: true, checklist: {}, supplement: '', fromLeaves: true, requests: [], log: [], createdAt: TODAY };
  s.handovers.push(h);
  return { s, workId: w.id };
}

describe('담당만 바로 바꾸기와 진행 중 인계(A-M7)', () => {
  it.each(['draft', 'submitted', 'revision', 'accepted'] as HandoverStatus[])('인계가 %s이면 넘기기를 막는다', (st) => {
    const { s, workId } = withHandover(st);
    const before = JSON.stringify(s.works[0]);
    expect(pendingHandoverOf(s, workId)?.id).toBe('HO-T1');
    expect(assignOwner(s, workId, 'U3', 'hand', TODAY)).toBeNull();
    expect(JSON.stringify(s.works[0])).toBe(before); // 아무것도 바뀌지 않음
  });
  it('확정된 인계는 막지 않는다', () => {
    const { s, workId } = withHandover('confirmed');
    expect(pendingHandoverOf(s, workId)).toBeNull();
    expect(assignOwner(s, workId, 'U3', 'hand', TODAY)).not.toBeNull();
  });
  it('다른 업무의 인계는 막지 않는다', () => {
    const { s } = withHandover('submitted');
    expect(assignOwner(s, s.works[1].id, 'U3', 'hand', TODAY)).not.toBeNull();
  });
  it('공동 담당 추가는 막지 않는다', () => {
    const { s, workId } = withHandover('submitted');
    expect(assignOwner(s, workId, 'U3', 'add', TODAY)).not.toBeNull();
  });
});
