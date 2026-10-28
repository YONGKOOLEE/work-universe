// 독립 검토(2026-10-29) 중간·낮음 결함의 회귀 시험
import { describe, expect, it } from 'vitest';
import { createSeed } from '../src/data/seed';
import { guessOwnerNames, matchUser, toProposal, verify, type Proposal } from '../src/ai/reflect';
import { linkWorks } from '../src/universe/commands';
import { mapRiskIssues } from '../src/universe/risk';

const paras = (lines: string[]) => lines.map((t, i) => ({ id: `p-${i + 1}`, text: t }));

describe('검토 반영 — AI 제안 검사', () => {
  it('담당 이름은 근거 문단 안에 있을 때만(문서 다른 곳의 이름·한 글자는 버림)', () => {
    const s = createSeed('linked');
    const ps = paras(['작성자: 김도윤', '○ 참가기관 의견을 모아 정리할 예정임.']);
    const a = toProposal(s, { kind: 'action', text: '의견 정리', quote: '참가기관 의견을 모아 정리할 예정임', paraId: 'p-2', owner: '김도윤', basis: 'source' }, ps, 'W-001', 'claude')!;
    expect(a.ownerName).toBeUndefined();
    expect(a.ownerId).toBeNull();
    const b = toProposal(s, { kind: 'action', text: '의견 정리', quote: '참가기관 의견을 모아 정리할 예정임', paraId: 'p-2', owner: '김', basis: 'source' }, ps, 'W-001', 'claude')!;
    expect(b.ownerName).toBeUndefined();
  });
  it('조치의 기한이 근거 문단 밖의 날짜면 확인 필요', () => {
    const ps = paras(['○ 의견 정리 2026. 11. 20.까지', '○ 개정안은 2026. 12. 31.까지 마련']);
    const p = verify({ id: 'x', kind: 'action', workId: 'W-001', text: '의견 정리', date: '2026-12-31', quote: '의견 정리 2026. 11. 20.까지', paraId: 'p-1', basis: 'source', verified: false, dateVerified: true, approved: false } as Proposal, ps);
    expect(p.dateVerified).toBe(false);
    expect(p.issue).toContain('근거 문단 밖');
    const ok = verify({ ...p, date: '2026-11-20', issue: undefined }, ps);
    expect(ok.dateVerified).toBe(true);
  });
  it('사용자 이름은 같거나 뒤가 직함일 때만 맞춘다', () => {
    const s = createSeed('linked');
    s.users.push({ id: 'UX', name: '김민', dept: '가상팀', title: '주무관' });
    expect(matchUser(s, '김민수')).toBeNull();
    expect(matchUser(s, '김민 주무관')).toBe('UX');
    expect(matchUser(s, '이서연')).toBe('U2');
  });
  it('성씨 추정은 「최종안」「공고문」 같은 문서 꼬리 낱말을 이름으로 보지 않는다', () => {
    const names = guessOwnerNames(['과제 담당 기한', '약관 개정 최종안 2026. 11. 30.', '참가기관 안내 공고문 2026. 12. 5.', '의견 정리 이서진 2026. 11. 6.'].join('\n'));
    expect(names).toEqual(['이서진']);
  });
});

describe('검토 반영 — 지도', () => {
  it('완료한 업무는 혼자만 아는 업무 위험에서 빠진다', () => {
    const s = createSeed('linked');
    const before = mapRiskIssues(s, '2026-10-29').map((x) => x.workId);
    expect(before.length).toBeGreaterThan(0);
    for (const w of s.works) {
      w.status = '완료';
      w.updatedAt = '2026-10-01T00:00:00Z';
    }
    expect(mapRiskIssues(s, '2026-10-29')).toEqual([]);
  });
  it('선후행 고리는 셋 이상이어도 막고, 관련 업무 잇기는 상대 업무에도 이력을 남긴다', () => {
    const s = createSeed('linked');
    for (const w of s.works) w.nextIds = [];
    expect(linkWorks(s, 'W-001', 'W-003', 'next')).not.toBeNull();
    expect(linkWorks(s, 'W-003', 'W-002', 'next')).not.toBeNull();
    expect(linkWorks(s, 'W-002', 'W-001', 'next')).toBeNull();
    s.works.find((w) => w.id === 'W-004')!.relatedIds = [];
    s.works.find((w) => w.id === 'W-006')!.relatedIds = [];
    const c = linkWorks(s, 'W-004', 'W-006', 'related');
    expect(c?.also?.[0].workId).toBe('W-006');
  });
});
