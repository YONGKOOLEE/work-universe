import { describe, expect, it } from 'vitest';
import { mockExtract } from '../src/ai/reflect';
import { createSeed } from '../src/data/seed';

// 지도 시연용 문서(tools/make-demo-pdfs.mjs 「약관 개정 실무 회의록」)를 PDF에서 읽은 글 모양 그대로 — 키 없이(규칙) 표의 담당이 사용자로 이어지는지
const TEXT = `약관·시행세칙 개정 실무 회의록
□ 회의 개요
○ 일시: 2026. 10. 28.(수) 10:00~11:00
○ 참석: 디지털신원팀 박지훈, 이서연, 최민서
□ 논의 결과
○ 개정안은 전자서명과 ARS 녹취 방식을 함께 반영하기로 결정함.
○ 본인확인 수준은 법무 검토 의견을 받은 뒤 확정하기로 함.
□ 향후 조치
과제 담당 기한
개정 조문 대비표 작성 이서연 2026. 11. 12.
참가기관 의견 반영안 정리 최민서 2026. 11. 19.
법무 검토 의견 요청 박지훈 2026. 11. 5.
□ 유의사항
○ 다만, 참가기관 의견 반영안은 업무협의회 결과와 맞춰야 함.`;

describe('키 없는 문서 분석 — 업무 유니버스 표 규칙으로 담당·기한', () => {
  it('표의 세 할 일이 담당 사용자·기한과 함께 조치 제안이 된다', () => {
    const s = createSeed('linked');
    const paras = TEXT.split('\n').map((t, i) => ({ id: `p-${i + 1}`, text: t }));
    const r = mockExtract(s, '약관·시행세칙 개정 실무 회의록', paras, 'W-003');
    const acts = r.proposals.filter((p) => p.kind === 'action');
    const byName = (n: string) => s.users.find((u) => u.name === n)!.id;
    const find = (t: string) => acts.find((p) => p.text.includes(t));
    expect(find('개정 조문 대비표')).toMatchObject({ ownerId: byName('이서연'), date: '2026-11-12' });
    expect(find('참가기관 의견 반영안 정리')).toMatchObject({ ownerId: byName('최민서'), date: '2026-11-19' });
    expect(find('법무 검토 의견 요청')).toMatchObject({ ownerId: byName('박지훈'), date: '2026-11-05' });
    expect(r.proposals.filter((p) => p.kind === 'decision').length).toBeGreaterThanOrEqual(1);
  });
});

import { dedupeKinds, type Proposal } from '../src/ai/reflect';
describe('제안 중복 덜기', () => {
  const P = (x: Partial<Proposal>): Proposal => ({ id: Math.random().toString(36), kind: 'action', workId: 'W-001', text: '', date: null, quote: '', basis: 'source', verified: true, dateVerified: true, approved: false, ...x }) as Proposal;
  it('결정 문장의 조치(담당·기한 없음)와 표 행의 이벤트를 뺀다', () => {
    const list = [
      P({ kind: 'decision', text: '두 방식 함께 반영 결정', quote: '○ 개정안은 전자서명과 ARS 녹취 방식을 함께 반영하기로 결정함.' }),
      P({ kind: 'action', text: '두 방식 함께 반영', quote: '○ 개정안은 전자서명과 ARS 녹취 방식을 함께 반영하기로 결정함.' }),
      P({ kind: 'action', text: '개정 조문 대비표 작성', quote: '개정 조문 대비표 작성 이서연 2026. 11. 12.', date: '2026-11-12', ownerName: '이서연' }),
      P({ kind: 'event', text: '개정 조문 대비표 작성 이서연 2026. 11. 12.', quote: '개정 조문 대비표 작성 이서연 2026. 11. 12.', date: '2026-11-12' }),
      P({ kind: 'event', text: '내부 검토회의 개최', quote: '2026. 8. 20. 내부 검토회의를 개최함.', date: '2026-08-20' }),
    ];
    dedupeKinds(list);
    expect(list.map((p) => `${p.kind}:${p.text}`)).toEqual(['decision:두 방식 함께 반영 결정', 'action:개정 조문 대비표 작성', 'event:내부 검토회의 개최']);
  });
});

describe('사용자가 아닌 담당 이름(키 없음)', () => {
  it('「과제 담당 기한」 표의 사람 이름은 문서상 담당으로 읽는다', () => {
    const s = createSeed('linked');
    const text = ['3. 후속 조치', '과제 담당 기한', '불일치 원인 코드표 정리 서하늘 2026. 11. 6.', '대사 결과 이중 확인 절차 마련 윤바다 2026. 11. 13.'];
    const r = mockExtract(s, '대사 확인 개선 회의록', text.map((t, i) => ({ id: `p-${i + 1}`, text: t })), 'W-004');
    const acts = r.proposals.filter((p) => p.kind === 'action');
    expect(acts.find((p) => p.text.includes('원인 코드표'))).toMatchObject({ ownerName: '서하늘', ownerId: null, date: '2026-11-06' });
    expect(acts.find((p) => p.text.includes('이중 확인'))).toMatchObject({ ownerName: '윤바다', ownerId: null, date: '2026-11-13' });
  });
});
