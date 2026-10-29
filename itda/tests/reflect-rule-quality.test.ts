import { describe, expect, it } from 'vitest';
import { mockExtract } from '../src/ai/reflect';
import { createSeed } from '../src/data/seed';
import { readDocDate } from '../src/lib/paragraphs';

// 처음 사용 점검 1 M-1: 규칙 모드 문서 분석 품질(담당 읽기·중복 제안·이벤트 유형·날짜 기본값). 가상 이름만 쓴다.
const run = (lines: string[]) => {
  const s = createSeed('linked');
  const paras = lines.map((t, i) => ({ id: `p-${i + 1}`, text: t }));
  return { s, r: mockExtract(s, '실무 회의록', paras, 'W-003') };
};
const uid = (s: ReturnType<typeof createSeed>, n: string) => s.users.find((u) => u.name === n)!.id;

describe('문장 속 담당자', () => {
  it('「박지훈은 11.20.까지 … 점검하기로 했다」 → 담당 박지훈인 조치, 이벤트는 기본 선택 안 함', () => {
    const { s, r } = run(['2026. 10. 28.', '박지훈은 11.20.까지 참가기관 전산 영향도를 점검하기로 했다.']);
    const acts = r.proposals.filter((p) => p.kind === 'action');
    expect(acts).toHaveLength(1);
    expect(acts[0]).toMatchObject({ ownerName: '박지훈', ownerId: uid(s, '박지훈'), date: '2026-11-20' });
    expect(r.proposals.filter((p) => p.kind === 'event' && !p.altOf && p.approved)).toHaveLength(0);
  });
  it('「김도윤은 11.10.까지 … 제출할 예정」 → 조치 1건, 같은 문장 이벤트는 기본 선택 제외', () => {
    const { s, r } = run(['2026. 10. 28.', '김도윤은 2026. 11. 10.까지 법무 검토 의견서를 보완해 제출할 예정이다.']);
    const acts = r.proposals.filter((p) => p.kind === 'action');
    expect(acts).toHaveLength(1);
    expect(acts[0]).toMatchObject({ ownerName: '김도윤', ownerId: uid(s, '김도윤'), date: '2026-11-10' });
    expect(acts[0].altOf).toBeUndefined();
    const ev = r.proposals.filter((p) => p.kind === 'event');
    expect(ev.every((p) => !!p.altOf && !p.approved)).toBe(true);
  });
  it('사용자 목록에 없는 이름은 이름만 기록하고 사용자 아님(ownerId null)', () => {
    const { r } = run(['2026. 10. 28.', '서하늘은 2026. 11. 6.까지 원인 코드표를 정리하기로 했다.']);
    const a = r.proposals.find((p) => p.kind === 'action')!;
    expect(a).toMatchObject({ ownerName: '서하늘', ownerId: null });
  });
  it('이름이 아닌 낱말(이용자는 …)은 담당으로 읽지 않는다', () => {
    const { r } = run(['2026. 10. 28.', '이용자는 2026. 11. 6.까지 동의 절차를 거치기로 했다.']);
    const a = r.proposals.find((p) => p.kind === 'action');
    expect(a?.ownerName).toBeUndefined();
  });
});

describe('이벤트와 조치 중복', () => {
  it('이미 있었던 일이면 이벤트가 기본 선택, 조치는 제외', () => {
    const { r } = run(['2026. 10. 28.', '2026. 9. 30. 참가기관 설명회를 개최했고 추진 계획을 공유함.']);
    const ev = r.proposals.find((p) => p.kind === 'event')!;
    const ac = r.proposals.find((p) => p.kind === 'action')!;
    expect(ev.altOf).toBeUndefined();
    expect(ac.altOf).toBe(ev.id);
  });
});

describe('이벤트 유형 기본값', () => {
  it('분명한 단서가 없으면 「업무 변경」(일반 유형), 입법 단서가 있을 때만 「법령」', () => {
    const { r } = run(['2026. 10. 28.', '2026. 9. 2. 법무 검토 의견서를 제출함.', '2026. 9. 5. 전자금융거래법 시행령 개정안이 공포됨.']);
    const ev = r.proposals.filter((p) => p.kind === 'event');
    expect(ev.find((p) => p.date === '2026-09-02')?.eventType).toBe('업무 변경');
    expect(ev.find((p) => p.date === '2026-09-05')?.eventType).toBe('법령');
  });
});

describe('결정사항 날짜 기본값', () => {
  it('날짜가 없는 결정은 본문 첫 줄 날짜(작성일)를 쓴다', () => {
    const { r } = run(['2026. 10. 28.', '본인확인 수준은 법무 검토 후 확정하기로 결정함.']);
    expect(r.proposals.find((p) => p.kind === 'decision')?.date).toBe('2026-10-28');
  });
  it('readDocDate: 첫 줄 날짜·「일시:」 줄을 읽고, 본문 중간 날짜는 읽지 않는다', () => {
    expect(readDocDate(['2026. 10. 28.', '내용'])?.iso).toBe('2026-10-28');
    expect(readDocDate(['회의록', '○ 일시: 2026. 10. 28.(수) 10:00'])?.iso).toBe('2026-10-28');
    expect(readDocDate(['회의록', '개요 설명', '2026. 11. 1. 시행함.'])).toBeNull();
  });
});

// 지도 접힌 조직 라벨: 엔진의 「＋숨긴 노드 수」 대신 「업무 n」(조직과 하위 조직의 업무 수)
import { deriveMap, worksInScope } from '../src/universe/derive';
import { collapsedWorkCounts } from '../src/universe/MapView';
// @ts-expect-error 유니버스 순수 모듈(JS)
import { buildView } from '../../app/src/view/view.js';
// @ts-expect-error 유니버스 순수 모듈(JS)
import { projectView } from '../../app/src/view/collapse.js';
describe('접힌 조직 꼭지의 업무 수', () => {
  it('회사 지도의 접힌 본부: 하위 조직 업무 수와 같다(칩의 「업무 n」과 일치)', () => {
    const NOW = '2026-10-29T09:00:00.000Z';
    const s = createSeed('linked', new Date(NOW));
    const d = deriveMap(s, { kind: 'all' }, NOW);
    const v = buildView(d.doc, d.resolve);
    const p = projectView(v, { expanded: new Set(), deepSummary: true });
    const counts = collapsedWorkCounts(d, p);
    const labelOf = (gid: string) => p.nodes.find((n: any) => n.gid === gid)?.label;
    const byLabel = Object.fromEntries([...counts].map(([gid, n]) => [labelOf(gid), n]));
    const org = (name: string) => s.orgs!.find((o) => o.name.replace(/\s*\(.*\)$/, '') === name)?.id;
    const expect13 = org('결제서비스본부') ? worksInScope(s, { kind: 'org', orgId: org('결제서비스본부')! }).length : -1;
    expect(byLabel['결제서비스본부']).toBe(expect13);
    expect(Object.values(byLabel).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(s.works.length);
  });
});
