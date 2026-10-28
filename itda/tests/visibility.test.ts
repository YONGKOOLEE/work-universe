// 열람 범위(사용자 결정 2026-10-29): 팀 업무는 모두가 보고, 고치기는 담당자·팀장, 개인 것만 거른다
import { describe, expect, it } from 'vitest';
import { createSeed } from '../src/data/seed';
import { canEdit, scopeFor } from '../src/lib/store';
import { addPrivateMemo, removePrivateMemo } from '../src/universe/commands';

describe('열람 범위', () => {
  it('팀원도 모든 업무를 본다', () => {
    const s = createSeed('linked');
    expect(scopeFor(s, 'U1').works.length).toBe(s.works.length);
    expect(scopeFor(s, 'U1').actions.length).toBe(s.actions.length);
  });
  it('고치기는 담당자와 팀장만', () => {
    const s = createSeed('linked');
    expect(canEdit(s, 'W-004', 'U5')).toBe(true); // 정하준 담당
    expect(canEdit(s, 'W-004', 'U1')).toBe(false); // 김도윤은 보기만
    expect(canEdit(s, 'W-004', 'U3')).toBe(true); // 박지훈 팀장
    expect(canEdit(s, 'W-없음', 'U3')).toBe(false);
  });
  it('확정 전 인계는 보내는 사람·받는 사람만, 확정된 인계는 당사자와 팀장', () => {
    const s = createSeed('linked');
    s.handovers.push({ ...s.handovers[0], id: 'HO-T', status: 'draft', fromId: 'U5', toId: 'U6', snapshotId: undefined } as any);
    const ids = (u: string) => scopeFor(s, u).handovers.map((h) => h.id);
    expect(ids('U5')).toContain('HO-T');
    expect(ids('U6')).toContain('HO-T');
    expect(ids('U1')).not.toContain('HO-T');
    expect(ids('U3')).not.toContain('HO-T'); // 팀장도 확정 전 인계는 못 봄
    const confirmed = s.handovers.find((h) => h.status === 'confirmed')!;
    expect(ids('U3')).toContain(confirmed.id);
    const outsider = s.users.find((u) => u.id !== confirmed.fromId && u.id !== confirmed.toId && u.role !== 'lead')!;
    expect(ids(outsider.id)).not.toContain(confirmed.id);
  });
  it('「나만 보기」 메모는 쓴 사람에게만', () => {
    const s = createSeed('linked');
    expect(addPrivateMemo(s, 'W-004', 'U1', '  물어볼 것  ', '2026-10-29T00:00:00Z')).toBe(true);
    expect(addPrivateMemo(s, 'W-004', 'U1', '   ', '2026-10-29T00:00:00Z')).toBe(false);
    expect(scopeFor(s, 'U1').privateMemos?.map((m) => m.text)).toEqual(['물어볼 것']);
    expect(scopeFor(s, 'U5').privateMemos).toEqual([]);
    expect(scopeFor(s, 'U3').privateMemos).toEqual([]);
    const id = s.privateMemos![0].id;
    expect(removePrivateMemo(s, id, 'U5')).toBe(false); // 남의 메모는 못 지움
    expect(removePrivateMemo(s, id, 'U1')).toBe(true);
  });
  it('업무 기록·변경 이력에는 메모가 들어가지 않는다', () => {
    const s = createSeed('linked');
    const w = s.works.find((x) => x.id === 'W-004')!;
    const before = JSON.stringify([w, s.history.length]);
    addPrivateMemo(s, 'W-004', 'U1', '메모', '2026-10-29T00:00:00Z');
    expect(JSON.stringify([s.works.find((x) => x.id === 'W-004'), s.history.length])).toBe(before);
  });
});
