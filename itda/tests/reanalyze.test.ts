import { describe, expect, it } from 'vitest';
import { mockExtract } from '../src/ai/reflect';
import { applyReanalysis, normText, proposalKey, splitDuplicates } from '../src/ai/reanalyze';
import { createSeed } from '../src/data/seed';
import type { Proposal } from '../src/ai/reflect';
import type { AppState } from '../src/lib/types';

const NOW = new Date('2026-10-29T09:00:00Z');
const TEXT = `약관·시행세칙 개정 실무 회의록
□ 논의 결과
○ 개정안은 전자서명과 ARS 녹취 방식을 함께 반영하기로 결정함.
○ 본인확인 수준은 법무 검토 의견을 받은 뒤 확정하기로 함.
□ 향후 조치
과제 담당 기한
개정 조문 대비표 작성 이서연 2026. 11. 12.
법무 검토 의견 요청 박지훈 2026. 11. 5.
□ 유의사항
○ 다만, 참가기관 의견 반영안은 업무협의회 결과와 맞춰야 함.`;
const paras = TEXT.split('\n').map((t, i) => ({ id: `p-${i + 1}`, text: t }));

const mk = (p: Partial<Proposal>): Proposal => ({ id: 'x', kind: 'decision', workId: 'W-003', text: '', date: null, quote: '', basis: 'source', verified: true, dateVerified: true, approved: true, ...p });

function run(s: AppState) {
  const doc = s.docs[0];
  const props = mockExtract(s, '회의록', paras, 'W-003').proposals.map((p) => ({ ...p, approved: true }));
  const out = applyReanalysis(s, doc, props, s.currentUserId, { engine: 'mock', summary: ['요약'], keywords: ['키'] });
  return { out, props, doc };
}

describe('다시 분석 — 중복 걸러내기', () => {
  it('정규화: 공백·따옴표·끝 마침표를 무시한다', () => {
    expect(normText(' 개정안은 “전자서명” 반영함. ')).toBe(normText('개정안은 "전자서명" 반영함'));
  });
  it('이미 있는 결정·조치·개요는 건너뛰고, 다른 업무의 같은 글은 새 것이다', () => {
    const s = createSeed('linked', NOW);
    const w = s.works.find((x) => x.id === 'W-003')!;
    s.decisions.push({ id: 'DEC-t', workId: 'W-003', date: '2026-10-01', title: '개정안은 전자서명 반영', details: [], prov: 'fact', source: 'original', cite: [], rationale: { id: 'x', text: '-', prov: 'unverified' } });
    s.actions.push({ id: 'A-t', workId: 'W-003', title: '대비표 작성', due: null, status: '예정', ownerId: w.owners[0], createdAt: NOW.toISOString(), cite: [] });
    w.cautions.push({ id: 's-t', text: '조심할 것', prov: 'fact' });
    const { fresh, skipped } = splitDuplicates(s, [
      mk({ kind: 'decision', text: '개정안은  전자서명 반영.' }),
      mk({ kind: 'decision', text: '새 결정' }),
      mk({ kind: 'decision', text: '새 결정' }), // 같은 묶음 안 중복
      mk({ kind: 'action', text: '대비표 작성' }),
      mk({ kind: 'overview', field: 'cautions', text: '조심할 것' }),
      mk({ kind: 'overview', field: 'purpose', text: '조심할 것' }), // 다른 칸
      mk({ kind: 'decision', workId: 'W-001', text: '개정안은 전자서명 반영' }), // 다른 업무
    ]);
    expect(skipped).toHaveLength(4);
    expect(fresh.map((p) => proposalKey(p))).toHaveLength(3);
  });
  it('이벤트는 제목과 날짜가 모두 같을 때만 중복', () => {
    const s = createSeed('linked', NOW);
    const e = s.events[0];
    const w = e.workIds[0];
    const { skipped, fresh } = splitDuplicates(s, [mk({ kind: 'event', workId: w, text: e.title, date: e.date }), mk({ kind: 'event', workId: w, text: e.title, date: '2031-01-01' })]);
    expect(skipped).toHaveLength(1);
    expect(fresh).toHaveLength(1);
  });
});

describe('다시 분석 — 반영', () => {
  it('두 번 반영해도 두 번째는 아무것도 더하지 않는다', () => {
    const s = createSeed('linked', NOW);
    s.docs[0].workIds = [...new Set([...s.docs[0].workIds, 'W-003'])];
    const first = run(s);
    expect(first.out.added).toBeGreaterThan(0);
    const counts = [s.decisions.length, s.actions.length, s.events.length, s.works.reduce((n, w) => n + w.purpose.length + w.background.length + w.current.length + w.cautions.length, 0)];
    const second = run(s);
    expect(second.out.added).toBe(0);
    expect(second.out.skipped).toBe(first.out.added + first.out.skipped);
    expect([s.decisions.length, s.actions.length, s.events.length, s.works.reduce((n, w) => n + w.purpose.length + w.background.length + w.current.length + w.cautions.length, 0)]).toEqual(counts);
  });
  it('업무마다 이력 한 줄, 문서 분석 표시 갱신', () => {
    const s = createSeed('linked', NOW);
    const h0 = s.history.length;
    const { out, doc } = run(s);
    const added = s.history.slice(h0);
    expect(added.every((h) => h.kind === '문서 다시 분석')).toBe(true);
    expect(added).toHaveLength(Object.keys(out.perWork).length);
    expect(added[0].summary).toContain('규칙 기반');
    expect(doc.analyzedBy).toBe('mock');
    expect(doc.analyzedAt).toBeTruthy();
  });
  it('Claude 분석 문서를 규칙으로 다시 돌려도 분석 표시·요약을 낮추지 않는다', () => {
    const s = createSeed('linked', NOW);
    s.docs[0].analyzedBy = 'claude';
    s.docs[0].summary = ['원래 요약'];
    run(s);
    expect(s.docs[0].analyzedBy).toBe('claude');
    expect(s.docs[0].summary).toEqual(['원래 요약']);
  });
  it('승인하지 않은 제안은 반영하지 않는다', () => {
    const s = createSeed('linked', NOW);
    const n = s.decisions.length + s.actions.length;
    const props = mockExtract(s, '회의록', paras, 'W-003').proposals.map((p) => ({ ...p, approved: false }));
    const out = applyReanalysis(s, s.docs[0], props, s.currentUserId, { engine: 'mock', summary: [], keywords: [] });
    expect(out.added).toBe(0);
    expect(s.decisions.length + s.actions.length).toBe(n);
  });
});
