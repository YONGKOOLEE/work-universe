import { describe, expect, it } from 'vitest';
import { createSeed } from '../src/data/seed';
import { addPerson, editPerson, removePerson, setPersonStatus, selectableUsers, displayName } from '../src/lib/people';
import { checkIntegrity } from '../src/lib/mergeImport';
import type { AppState } from '../src/lib/types';

const linked = () => createSeed('linked', new Date('2026-10-29T00:00:00Z'));
const fresh = () => createSeed('fresh', new Date('2026-10-29T00:00:00Z'));
const base = { name: '새 사람', dept: '가상팀', title: '주무관' };

describe('addPerson', () => {
  it('새 id는 기존과 겹치지 않고 사번이 저장된다', () => {
    const d = linked();
    const ids = new Set(d.users.map((u) => u.id));
    const r = addPerson(d, { ...base, empNo: 'V-2001', role: 'lead' });
    expect('id' in r).toBe(true);
    if (!('id' in r)) return;
    expect(ids.has(r.id)).toBe(false);
    expect(/^U\d+$/.test(r.id)).toBe(true);
    const u = d.users.find((x) => x.id === r.id)!;
    expect(u.empNo).toBe('V-2001');
    expect(u.role).toBe('lead');
    expect(addPerson(d, base)).toHaveProperty('id');
    expect(new Set(d.users.map((x) => x.id)).size).toBe(d.users.length);
  });
  it('이름은 공백을 정리하고 2자 이상', () => {
    const d = fresh();
    const r = addPerson(d, { ...base, name: '  홍   길동 ' });
    expect(d.users.at(-1)!.name).toBe('홍 길동');
    expect(r).toHaveProperty('summary');
    const n = d.users.length;
    expect(addPerson(d, { ...base, name: ' 가 ' })).toHaveProperty('error');
    expect(d.users.length).toBe(n);
  });
  it('사번 형식 오류와 중복을 거절', () => {
    const d = fresh();
    const dupe = d.users[0].empNo!;
    for (const bad of ['1234', 'V-123', 'V-12345', 'v-1234', 'X-1234']) expect(addPerson(d, { ...base, empNo: bad })).toHaveProperty('error');
    expect(addPerson(d, { ...base, empNo: dupe })).toHaveProperty('error');
    expect(addPerson(d, { ...base, empNo: '' })).toHaveProperty('id');
  });
});

describe('editPerson', () => {
  it('바뀐 것이 없으면 null, 바꾸면 요약, 오류면 error', () => {
    const d = fresh();
    const u = d.users[0];
    expect(editPerson(d, u.id, { name: u.name, title: u.title })).toBeNull();
    const r = editPerson(d, u.id, { title: '선임' });
    expect(r).toHaveProperty('summary');
    expect(d.users[0].title).toBe('선임');
    expect(editPerson(d, u.id, { empNo: d.users[1].empNo })).toHaveProperty('error');
    expect(editPerson(d, u.id, { empNo: u.empNo })).toBeNull(); // 자기 사번은 중복 아님
    expect(editPerson(d, 'U999', { title: 'x' })).toHaveProperty('error');
  });
});

describe('removePerson', () => {
  it('쓰이지 않은 사람은 지운다', () => {
    const d = linked();
    const a = addPerson(d, base);
    if (!('id' in a)) throw new Error('추가 실패');
    const r = removePerson(d, a.id);
    expect(r).toHaveProperty('summary');
    expect(d.users.some((u) => u.id === a.id)).toBe(false);
  });
  it('담당·조치·문서·인계에 쓰인 사람은 막고 이유를 돌려준다', () => {
    const d = linked();
    const owner = d.works[0].owners[0];
    const other = d.users.find((u) => u.id !== d.currentUserId && u.id !== owner)!;
    const r = removePerson(d, owner === d.currentUserId ? other.id : owner);
    // 시연 데이터에서 담당이 아닌 사람도 다른 곳에 쓰였을 수 있으므로, 쓰인 사람을 직접 만들어 확인
    const p = addPerson(d, base);
    if (!('id' in p)) throw new Error('추가 실패');
    d.works[0].owners.push(p.id);
    const b1 = removePerson(d, p.id);
    expect(b1).toHaveProperty('blocked');
    expect((b1 as { blocked: string[] }).blocked.join(' ')).toContain('업무 담당');
    d.works[0].owners = d.works[0].owners.filter((x) => x !== p.id);
    d.actions.push({ ...d.actions[0], id: 'A-T1', ownerId: p.id });
    expect((removePerson(d, p.id) as { blocked: string[] }).blocked.join(' ')).toContain('조치 담당');
    d.actions.pop();
    d.docs[0].registeredBy = p.id;
    expect((removePerson(d, p.id) as { blocked: string[] }).blocked.join(' ')).toContain('문서 등록자');
    expect(d.users.some((u) => u.id === p.id)).toBe(true);
    expect(r).toBeDefined();
  });
  it('인계의 인계자·인수자와 스냅샷에 쓰인 사람도 막는다', () => {
    const d = linked();
    const p = addPerson(d, base);
    if (!('id' in p)) throw new Error('추가 실패');
    d.handovers.push({
      id: 'HO-T', workId: d.works[0].id, fromId: d.users[0].id, toId: p.id, baseDate: '2026-10-01', status: 'draft', step: 1, precheckDone: false,
      checklist: {}, supplement: '', fromLeaves: null, requests: [], log: [], createdAt: '2026-10-01T00:00:00Z',
    });
    expect((removePerson(d, p.id) as { blocked: string[] }).blocked.join(' ')).toContain('인수자');
  });
  it('현재 사용자는 지울 수 없다', () => {
    const d = fresh();
    d.users = d.users.concat();
    expect(removePerson(d, d.currentUserId)).toHaveProperty('blocked');
    expect(d.users.some((u) => u.id === d.currentUserId)).toBe(true);
  });
  it('시연 데이터에서 지우기 성공 뒤에도 참조 무결성이 유지된다', () => {
    const d = fresh();
    const p = addPerson(d, base);
    if (!('id' in p)) throw new Error('추가 실패');
    removePerson(d, p.id);
    expect(checkIntegrity(d as AppState)).toEqual([]);
  });
});

describe('setPersonStatus', () => {
  it('left로 바꾸면 담당 업무 목록을 돌려주고 담당은 그대로', () => {
    const d = linked();
    const w = d.works[0];
    const id = w.owners.find((o) => o !== d.currentUserId) ?? (d.users.find((u) => u.id !== d.currentUserId)!.id);
    if (!w.owners.includes(id)) w.owners.push(id);
    const r = setPersonStatus(d, id, 'left');
    expect(r).toHaveProperty('ownedWorks');
    expect((r as { ownedWorks: { id: string }[] }).ownedWorks.map((x) => x.id)).toContain(w.id);
    expect(w.owners).toContain(id);
    expect(d.users.find((u) => u.id === id)!.status).toBe('left');
  });
  it('같은 상태면 null, 복귀하면 status가 없어진다', () => {
    const d = fresh();
    const id = d.users.find((u) => u.id !== d.currentUserId)!.id;
    expect(setPersonStatus(d, id, 'active')).toBeNull();
    setPersonStatus(d, id, 'left');
    expect(setPersonStatus(d, id, 'left')).toBeNull();
    const r = setPersonStatus(d, id, 'active');
    expect((r as { ownedWorks: unknown[] }).ownedWorks).toEqual([]);
    expect(d.users.find((u) => u.id === id)!.status).toBeUndefined();
  });
  it('현재 사용자는 left로 바꿀 수 없다', () => {
    const d = fresh();
    expect(setPersonStatus(d, d.currentUserId, 'left')).toHaveProperty('error');
    expect(d.users.find((u) => u.id === d.currentUserId)!.status).toBeUndefined();
  });
});

describe('선택 목록·표시 이름', () => {
  it('left는 목록에서 빠지되 keep에 있으면 남고, 이름에 표시가 붙는다', () => {
    const d = fresh();
    const id = d.users.find((u) => u.id !== d.currentUserId)!.id;
    setPersonStatus(d, id, 'left');
    expect(selectableUsers(d.users).some((u) => u.id === id)).toBe(false);
    expect(selectableUsers(d.users, [id]).some((u) => u.id === id)).toBe(true);
    expect(displayName(d.users.find((u) => u.id === id))).toContain('(전출·퇴직)');
    expect(displayName(d.users[0])).toBe(d.users[0].name);
  });
});
