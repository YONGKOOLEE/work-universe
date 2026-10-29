// 열람 범위(사용자 결정 2026-10-29): 팀 업무는 모두가 보고, 고치기는 담당자·조직장(소속 조직 범위), 개인 것만 거른다
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
  it('고치기는 담당자와 소속 조직 범위의 조직장만', () => {
    const s = createSeed('linked');
    expect(canEdit(s, 'W-004', 'U5')).toBe(true); // 정하준 담당
    expect(canEdit(s, 'W-004', 'U1')).toBe(false); // 김도윤은 보기만
    expect(canEdit(s, 'W-004', 'U3')).toBe(false); // 박지훈은 디지털신원팀 팀장 — 출금이체팀 업무는 보기만(조직 기준, 2026-10-29)
    expect(canEdit(s, 'W-004', 'U8')).toBe(true); // 서지안 부장: 전자금융부 아래 출금이체팀
    expect(canEdit(s, 'W-없음', 'U3')).toBe(false);
  });
  it('인계는 당사자와, 그 업무가 자기 조직 범위 안인 조직장만(상태와 상관없이)', () => {
    const s = createSeed('linked');
    s.handovers.push({ ...s.handovers[0], id: 'HO-T', status: 'draft', fromId: 'U5', toId: 'U6', snapshotId: undefined } as any);
    const ids = (u: string) => scopeFor(s, u).handovers.map((h) => h.id);
    expect(ids('U5')).toContain('HO-T');
    expect(ids('U6')).toContain('HO-T');
    expect(ids('U1')).not.toContain('HO-T');
    expect(ids('U3')).not.toContain('HO-T'); // 박지훈은 출금이체팀 범위 밖
    expect(ids('U8')).toContain('HO-T'); // 서지안 부장은 전자금융부 범위 안 — 확정 전에도 읽는다
    const confirmed = s.handovers.find((h) => h.status === 'confirmed')!; // HO-002(W-007, 출금이체팀)
    expect(ids('U8')).toContain(confirmed.id);
    expect(ids('U3')).not.toContain(confirmed.id); // 범위 밖 조직장에게 확정된 인계를 모두 열어 주던 규칙은 없앴다
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
