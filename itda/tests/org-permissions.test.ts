// 조직 기준 권한(사용자 결정 2026-10-29): 조직장은 자기 소속 조직과 아래 조직의 업무를 고치고, 범위 안 인계를 읽으며,
// 담당자 대신 인계를 시작한다. 사람·조직 편집은 조직장만 한다. 가상 데이터만 쓴다.
import { describe, expect, it } from 'vitest';
import { createSeed } from '../src/data/seed';
import { buildHandover, canActAsSender, canEdit, canEditPeople, canStartHandoverFor, inLeadScope, scopeFor } from '../src/lib/store';
import { roleLabel } from '../src/lib/people';
import { orgScopeNames } from '../src/lib/orgs';
import type { AppState } from '../src/lib/types';

const NOW = new Date('2026-10-29T00:00:00Z');
const seed = () => createSeed('linked', NOW);
const idsOf = (s: AppState, u: string) => scopeFor(s, u).handovers.map((h) => h.id);

describe('canEdit — 조직 기준', () => {
  it('팀장 박지훈(디지털신원팀)은 다른 팀(출금이체팀) 업무 W-004를 고칠 수 없다', () => {
    const s = seed();
    expect(canEdit(s, 'W-004', 'U3')).toBe(false);
    expect(inLeadScope(s, 'W-004', 'U3')).toBe(false);
  });
  it('팀장은 자기 팀 업무는 담당이 아니어도 고친다', () => {
    const s = seed();
    expect(canEdit(s, 'W-002', 'U3')).toBe(true); // 담당 U2·U4
    expect(canEdit(s, 'W-006', 'U3')).toBe(true);
  });
  it('부장 서지안은 부 안의 모든 팀 업무를 고치되 다른 부 업무는 못 고친다', () => {
    const s = seed();
    expect(s.users.find((u) => u.id === 'U8')!.role).toBe('lead');
    for (const id of ['W-001', 'W-004', 'W-007', 'W-011']) expect(canEdit(s, id, 'U8')).toBe(true);
    for (const id of ['W-012', 'W-014']) expect(canEdit(s, id, 'U8')).toBe(false); // 정산운영부·정보보호부
  });
  it('팀원은 담당 업무만 고친다', () => {
    const s = seed();
    expect(canEdit(s, 'W-004', 'U5')).toBe(true);
    expect(canEdit(s, 'W-004', 'U1')).toBe(false);
    expect(canEdit(s, 'W-002', 'U1')).toBe(false);
  });
  it('없는 업무·없는 사람은 false', () => {
    const s = seed();
    expect(canEdit(s, 'W-없음', 'U3')).toBe(false);
    expect(canEdit(s, 'W-002', 'U-없음')).toBe(false);
  });
  it('전출·퇴직한 조직장은 조직장 권한이 없다(담당 업무는 그대로)', () => {
    const s = seed();
    s.users.find((u) => u.id === 'U3')!.status = 'left';
    expect(canEdit(s, 'W-002', 'U3')).toBe(false);
    expect(canEdit(s, 'W-003', 'U3')).toBe(true); // 담당자
    expect(canEditPeople(s, 'U3')).toBe(false);
  });
  it('소속 조직이 없는 조직장은 담당 업무만 고친다', () => {
    const s = seed();
    s.users.find((u) => u.id === 'U3')!.dept = '';
    expect(orgScopeNames(s, 'U3').size).toBe(0);
    expect(canEdit(s, 'W-002', 'U3')).toBe(false);
  });
});

describe('인계 열람 범위', () => {
  const draft = (s: AppState) => {
    s.handovers.push({ ...s.handovers[0], id: 'HO-T', workId: 'W-004', fromId: 'U5', toId: 'U6', status: 'draft', step: 2, snapshotId: undefined } as any);
  };
  it('당사자는 상태와 상관없이 본다', () => {
    const s = seed();
    draft(s);
    expect(idsOf(s, 'U5')).toContain('HO-T');
    expect(idsOf(s, 'U6')).toContain('HO-T');
  });
  it('조직장은 범위 안 인계를 확정 전에도 본다(부장 서지안: 출금이체팀 인계)', () => {
    const s = seed();
    draft(s);
    expect(idsOf(s, 'U8')).toContain('HO-T');
    expect(idsOf(s, 'U8')).toContain('HO-002'); // 확정된 W-007 인계
  });
  it('조직장이라도 범위 밖 인계는 확정 전·후 모두 못 본다(팀장 박지훈 → 출금이체팀)', () => {
    const s = seed();
    draft(s);
    expect(idsOf(s, 'U3')).not.toContain('HO-T');
    expect(idsOf(s, 'U3')).not.toContain('HO-002');
  });
  it('팀원 제3자는 못 본다', () => {
    const s = seed();
    draft(s);
    expect(idsOf(s, 'U1')).toEqual([]);
  });
  it('조직장이 범위 안 업무 인계를 열면 스냅샷도 함께 보인다', () => {
    const s = seed();
    expect(scopeFor(s, 'U8').snapshots.map((x) => x.handoverId)).toContain('HO-002');
    expect(scopeFor(s, 'U3').snapshots.map((x) => x.handoverId)).not.toContain('HO-002');
  });
});

describe('사람·조직 편집 가능', () => {
  it('조직장만 편집한다', () => {
    const s = seed();
    expect(canEditPeople(s, 'U3')).toBe(true);
    expect(canEditPeople(s, 'U8')).toBe(true);
    expect(canEditPeople(s, 'U1')).toBe(false);
    expect(canEditPeople(s, 'U-없음')).toBe(false);
  });
});

describe('대신 시작', () => {
  it('조직장은 범위 안 업무에서, 담당자는 자기 업무에서 시작할 수 있다', () => {
    const s = seed();
    expect(canStartHandoverFor(s, 'W-004', 'U8')).toBe(true);
    expect(canStartHandoverFor(s, 'W-004', 'U5')).toBe(true);
    expect(canStartHandoverFor(s, 'W-004', 'U3')).toBe(false); // 범위 밖 팀장
    expect(canStartHandoverFor(s, 'W-004', 'U1')).toBe(false); // 남의 팀원
  });
  it('buildHandover: 보내는 사람과 받는 사람이 같으면 거절', () => {
    const s = seed();
    const r = buildHandover(s, { workId: 'W-004', fromId: 'U5', toId: 'U5', baseDate: '2026-10-29', actorId: 'U8', now: NOW.toISOString() });
    expect('error' in r).toBe(true);
  });
  it('buildHandover: 권한 없는 사람은 거절(범위 밖 팀장)', () => {
    const s = seed();
    const r = buildHandover(s, { workId: 'W-004', fromId: 'U5', toId: 'U6', baseDate: '2026-10-29', actorId: 'U3', now: NOW.toISOString() });
    expect('error' in r && r.error).toMatch(/권한|시작/);
  });
  it('buildHandover: 보내는 사람은 그 업무의 담당자여야 한다', () => {
    const s = seed();
    const r = buildHandover(s, { workId: 'W-004', fromId: 'U6', toId: 'U7', baseDate: '2026-10-29', actorId: 'U8', now: NOW.toISOString() });
    expect('error' in r).toBe(true);
  });
  it('buildHandover: 조직장 대신 시작은 startedById와 「대신 시작: 서지안」 이력을 남긴다', () => {
    const s = seed();
    const r = buildHandover(s, { workId: 'W-004', fromId: 'U5', toId: 'U6', baseDate: '2026-10-29', actorId: 'U8', now: NOW.toISOString() });
    if ('error' in r) throw new Error(r.error);
    expect(r.handover.fromId).toBe('U5');
    expect(r.handover.startedById).toBe('U8');
    expect(r.handover.step).toBe(2);
    expect(r.handover.log.map((l) => l.text)).toContain('대신 시작: 서지안');
    expect(r.handover.id).toMatch(/^HO-\d+$/);
  });
  it('buildHandover: 담당자가 직접 시작하면 startedById가 없다', () => {
    const s = seed();
    const r = buildHandover(s, { workId: 'W-004', fromId: 'U5', toId: 'U6', baseDate: '2026-10-29', actorId: 'U5', now: NOW.toISOString() });
    if ('error' in r) throw new Error(r.error);
    expect(r.handover.startedById).toBeUndefined();
    expect(r.handover.log.some((l) => l.text.startsWith('대신 시작'))).toBe(false);
  });
  it('buildHandover: 조직장이 자기 담당 업무를 직접 시작하면 대신 시작이 아니다', () => {
    const s = seed();
    const r = buildHandover(s, { workId: 'W-003', fromId: 'U3', toId: 'U4', baseDate: '2026-10-29', actorId: 'U3', now: NOW.toISOString() });
    if ('error' in r) throw new Error(r.error);
    expect(r.handover.startedById).toBeUndefined();
  });
  it('이후 단계(사전 점검·제출): 보내는 사람, 또는 대신 시작한 인계의 범위 안 조직장', () => {
    const s = seed();
    const r = buildHandover(s, { workId: 'W-004', fromId: 'U5', toId: 'U6', baseDate: '2026-10-29', actorId: 'U8', now: NOW.toISOString() });
    if ('error' in r) throw new Error(r.error);
    const h = r.handover;
    expect(canActAsSender(s, h, 'U5')).toBe(true);
    expect(canActAsSender(s, h, 'U8')).toBe(true);
    expect(canActAsSender(s, h, 'U3')).toBe(false); // 범위 밖 팀장
    expect(canActAsSender(s, h, 'U6')).toBe(false); // 받는 사람
    expect(canActAsSender(s, h, 'U1')).toBe(false);
  });
  it('담당자가 직접 시작한 인계는 조직장이 읽기만 한다(진행 단추 불가)', () => {
    const s = seed();
    const r = buildHandover(s, { workId: 'W-004', fromId: 'U5', toId: 'U6', baseDate: '2026-10-29', actorId: 'U5', now: NOW.toISOString() });
    if ('error' in r) throw new Error(r.error);
    expect(canActAsSender(s, r.handover, 'U8')).toBe(false);
    expect(canActAsSender(s, r.handover, 'U5')).toBe(true);
  });
});

describe('역할 표시', () => {
  it('조직장은 소속 단계에 따라 팀장·부장·본부장, 그 밖은 팀원', () => {
    const s = seed();
    const u = (id: string) => s.users.find((x) => x.id === id)!;
    expect(roleLabel(s, u('U3'))).toBe('팀장');
    expect(roleLabel(s, u('U8'))).toBe('부장');
    expect(roleLabel(s, u('U1'))).toBe('팀원');
    u('U3').dept = '결제서비스본부 (시연용 가상 부서)';
    expect(roleLabel(s, u('U3'))).toBe('본부장');
    u('U3').dept = '우리 기관 (시연용 가상 부서)';
    expect(roleLabel(s, u('U3'))).toBe('대표');
    u('U3').dept = '';
    expect(roleLabel(s, u('U3'))).toBe('조직장');
  });
});
