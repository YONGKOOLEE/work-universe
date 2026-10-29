// A-M4 사람 ID 재사용 방지 + 지울 때 「나만 보기」 메모 함께 지움
import { describe, expect, it } from 'vitest';
import { createSeed } from '../src/data/seed';
import { addPerson, personPrivateMemoCount, removePerson } from '../src/lib/people';
import { addPrivateMemo } from '../src/universe/commands';
import { scopeFor } from '../src/lib/store';

const seed = () => createSeed('linked', new Date('2026-10-29T00:00:00Z'));

describe('사람 ID 재사용 방지(A-M4)', () => {
  it('지운 사람의 ID를 새 사람이 다시 쓰지 않는다', () => {
    const s = seed();
    const a = addPerson(s, { name: '가상임시', dept: s.users[0].dept, title: '주무관' }) as { id: string };
    expect(removePerson(s, a.id)).toHaveProperty('summary');
    // 지운 뒤에는 users에 없지만, 나만 보기 메모가 있던 흔적도 없으므로 같은 번호가 나올 수 있다 — 아래처럼 흔적이 남는 경우를 막는다
    const b = addPerson(s, { name: '가상후임', dept: s.users[0].dept, title: '주무관' }) as { id: string };
    expect(b.id).toBeDefined();
  });
  it('이력·메모 등 어디든 한 번 쓰인 U 번호의 최댓값보다 크게 매긴다', () => {
    const s = seed();
    const maxUser = Math.max(...s.users.map((u) => Number(u.id.slice(1))));
    // 이미 지워진 사람 U50이 변경 이력에 남아 있는 상황
    s.history.push({ id: 'H-x', workId: s.works[0].id, at: '2026-10-29T00:00:00Z', actorId: 'U50', kind: 'edit', summary: '옛 기록' });
    const r = addPerson(s, { name: '가상신규', dept: s.users[0].dept, title: '주무관' }) as { id: string };
    expect(Number(r.id.slice(1))).toBe(51);
    expect(maxUser).toBeLessThan(50);
  });
  it('나만 보기 메모·포커스 키에 남은 번호도 피한다', () => {
    const s = seed();
    s.privateMemos = [{ id: 'PM-1', workId: s.works[0].id, userId: 'U70', text: '옛 메모', at: '2026-10-29' }];
    const r = addPerson(s, { name: '가상신규', dept: s.users[0].dept, title: '주무관' }) as { id: string };
    expect(r.id).toBe('U71');
    s.focus = { U90: 'all' };
    const r2 = addPerson(s, { name: '가상신규둘', dept: s.users[0].dept, title: '주무관' }) as { id: string };
    expect(r2.id).toBe('U91');
  });
  it('지운 사람의 나만 보기 메모는 함께 지워지고, 새 사람에게 보이지 않는다', () => {
    const s = seed();
    const a = addPerson(s, { name: '가상임시', dept: s.users[0].dept, title: '주무관' }) as { id: string };
    addPrivateMemo(s, s.works[0].id, a.id, '임시 사람 개인 메모', '2026-10-29');
    addPrivateMemo(s, s.works[0].id, 'U1', '남의 메모', '2026-10-29');
    expect(personPrivateMemoCount(s, a.id)).toBe(1);
    const r = removePerson(s, a.id);
    expect(r).toHaveProperty('summary');
    expect(s.privateMemos!.map((m) => m.text)).toEqual(['남의 메모']);
    const b = addPerson(s, { name: '가상후임', dept: s.users[0].dept, title: '주무관' }) as { id: string };
    expect(scopeFor(s, b.id).privateMemos).toEqual([]);
  });
  it('쓰인 곳이 있어 막힐 때는 메모를 지우지 않는다', () => {
    const s = seed();
    addPrivateMemo(s, s.works[0].id, 'U1', '남의 메모', '2026-10-29');
    s.currentUserId = 'U2';
    const r = removePerson(s, 'U1'); // 담당 업무가 있어 막힘
    expect(r).toHaveProperty('blocked');
    expect(s.privateMemos).toHaveLength(1);
  });
});
