// ─────────────────────────────────────────────────────────────
// 시연용 가상 조직 데이터 (T-55) — 모두 가상. 실제 사람·기관·업무가 아니다.
//  · 한 부서 안 두 팀(디지털신원팀·출금이체팀), 사용자 7명, 업무 8건
//  · demo-linked.json(W-001 등)을 그대로 두고 그 위에 더한다.
// ─────────────────────────────────────────────────────────────
import type { Action, AppState, Cite, Decision, Doc, DocType, EventType, Handover, HistoryEntry, Prov, Snapshot, SourceStatus, Stmt, TEvent, User, Work } from '../lib/types';
import { clone } from '../lib/util';

export const TEAM_ID = '디지털신원팀 (시연용 가상 부서)';
export const TEAM_PAY = '출금이체팀 (시연용 가상 부서)';
const AG = '한빛결제원(가상)';

export const ORG_USERS: User[] = [
  { id: 'U1', name: '김도윤', dept: TEAM_ID, title: '주무관 · 현 담당', empNo: 'V-1001', role: 'member' },
  { id: 'U2', name: '이서연', dept: TEAM_ID, title: '주무관 · 신규 전입', empNo: 'V-1002', role: 'member' },
  { id: 'U3', name: '박지훈', dept: TEAM_ID, title: '팀장', empNo: 'V-1003', role: 'lead' },
  { id: 'U4', name: '최민서', dept: TEAM_ID, title: '주무관', empNo: 'V-1004', role: 'member' },
  { id: 'U5', name: '정하준', dept: TEAM_PAY, title: '주무관', empNo: 'V-1005', role: 'member' },
  { id: 'U6', name: '강예린', dept: TEAM_PAY, title: '주무관', empNo: 'V-1006', role: 'member' },
  { id: 'U7', name: '윤재민', dept: TEAM_PAY, title: '주무관 · 신규 전입', empNo: 'V-1007', role: 'member' },
];

const T = (d: string) => `${d}T09:00:00.000Z`;
const st = (id: string, text: string, prov: Prov = 'owner', cite?: Cite[]): Stmt => ({ id, text, prov, ...(cite ? { cite } : {}) });
const c = (docId: string, anchor: string, label: string): Cite => ({ docId, anchor, label });

const blankWork = (p: Partial<Work> & Pick<Work, 'id' | 'name' | 'dept' | 'owners' | 'ownerHistory'>): Work => ({
  parentId: null, relatedIds: [], nextIds: [], topics: [], type: '운영·관리', agency: '별도 확인 필요', status: '진행 중',
  createdAt: T('2026-09-01'), updatedAt: T('2026-10-20'), version: 2, summary: '', keywords: [],
  purpose: [], background: [], current: [], cautions: [], rejected: [], partners: [], ...p,
});

function mkDoc(id: string, title: string, type: DocType, writtenAt: string, workIds: string[], by: string, paras: string[], summary: string[], keywords: string[]): Doc {
  return {
    id, title, type, writtenAt, registeredAt: T(writtenAt), source: '사용자 등록', availability: 'original', workIds,
    summary, keywords, relations: [],
    paragraphs: paras.map((text, i) => ({ id: `p-${i + 1}`, text, page: 1 })),
    analyzed: true, registeredBy: by, fileName: `${title}.pdf`, analyzedBy: 'mock',
  };
}

function mkEvent(id: string, workIds: string[], date: string, type: EventType, title: string, docId: string | null, anchor: string | null, phase: string, source: SourceStatus = 'original'): TEvent {
  const auto = type === '문서' && docId ? { autoDocId: docId } : {};
  return {
    id, workIds, date, type, title, summary: title, decisions: [], agency: '등록 문서 기준 · 별도 확인 필요',
    docIds: docId ? [docId] : [],
    cite: docId ? [{ docId, ...(anchor ? { anchor } : {}), label: `${docId} ${anchor ?? ''}`.trim() }] : [],
    source,
    meaning: type === '문서' ? '문서 등록으로 자동 추가된 이벤트. 필요 없으면 타임라인에서 삭제할 수 있음' : '문서에서 추출해 담당자가 승인한 이벤트. 다른 사건과의 인과관계는 아직 분석되지 않음',
    causes: [], phase, ...auto,
  };
}

function mkDecision(id: string, workId: string, date: string, title: string, cite: Cite): Decision {
  return {
    id, workId, date, title, details: [`원문: "${title}"`], prov: 'fact', source: 'original', cite: [cite],
    rationale: { id: 'x', text: '결정 이유는 등록 문서에서 별도 확인 필요', prov: 'unverified' },
  };
}

function mkAction(id: string, workId: string, title: string, due: string | null, ownerId: string, cite?: Cite): Action {
  return { id, workId, title, due, status: '예정', ownerId, createdAt: T('2026-10-10'), ...(cite ? { cite: [cite] } : {}) };
}

const hist = (id: string, workId: string, at: string, actorId: string, kind: string, summary: string): HistoryEntry => ({ id, workId, at: T(at), actorId, kind, summary });

/** demo-linked(W-001 포함, 스키마 7로 변환된 것)에 가상 조직 데이터를 더한다. */
export function extendLinked(base: AppState): AppState {
  const s = clone(base);
  s.users = clone(ORG_USERS);

  // W-001: 내용은 그대로 두고 지도용 연결·주제·협의처만 더한다
  const w1 = s.works.find((w) => w.id === 'W-001')!;
  w1.nextIds = ['W-003'];
  w1.relatedIds = ['W-005'];
  w1.topics = ['본인확인', '참가기관', '약관'];
  w1.partners = [{ name: AG, role: '참가기관 업무협의 상대', prov: 'owner' }];

  const works: Work[] = [
    blankWork({
      id: 'W-002', name: '출금동의 본인확인 방식 법무 검토', parentId: 'W-001', type: '정책·제도', dept: TEAM_ID, owners: ['U2', 'U4'],
      ownerHistory: [{ userId: 'U2', from: '2026-10-01', to: null, note: '업무 등록 시 지정' }, { userId: 'U4', from: '2026-09-15', to: null }],
      status: '검토 중', topics: ['본인확인', '약관'], summary: '전자서명·ARS 녹취 방식의 본인확인 수준에 대한 법무 검토 의견 확보',
      purpose: [st('p1', '방식별 본인확인 수준이 관련 규정에 맞는지 법무 검토 의견을 받는다.')],
      background: [st('b1', '법무 검토 결과에 따라 방식별 본인확인 수준이 정해진다.', 'fact', [c('D-102', 'p-3', '본인확인 방식 법무 검토 의견서 p-3')])],
      current: [st('c1', '전자서명 방식은 추가 보완 없이 가능하다는 1차 의견을 받았다.', 'fact', [c('D-102', 'p-3', '본인확인 방식 법무 검토 의견서 p-3')])],
      cautions: [st('x1', 'ARS 녹취 방식은 녹취 보관 기준이 정해진 뒤에 최종 판단한다.', 'fact', [c('D-102', 'p-4', '본인확인 방식 법무 검토 의견서 p-4')])],
      partners: [{ name: '법무자문실(가상)', role: '검토 의견 제공', prov: 'owner' }],
    }),
    blankWork({
      id: 'W-003', name: '약관·시행세칙 개정안 마련', type: '정책·제도', dept: TEAM_ID, owners: ['U3', 'U2'],
      ownerHistory: [{ userId: 'U3', from: '2026-10-05', to: null, note: '업무 등록 시 지정' }, { userId: 'U2', from: '2026-10-05', to: null }],
      status: '진행 중', topics: ['약관', '본인확인'], summary: '비대면 출금동의 도입에 맞춘 약관·시행세칙 개정안 작성',
      purpose: [st('p1', '비대면 출금동의 방식을 약관과 시행세칙에 반영한다.')],
      background: [st('b1', '2026. 12. 31.까지 약관 및 시행세칙 개정안을 마련할 계획이다.', 'fact', [c('D-101', 'p-3', '약관 개정 추진계획 p-3')])],
      current: [st('c1', '개정 조문 초안 구성을 정하는 중이다.', 'fact', [c('D-101', 'p-4', '약관 개정 추진계획 p-4')])],
      cautions: [st('x1', '본인확인 수준 문구는 법무 검토 결과가 나온 뒤 확정한다.', 'owner')],
      partners: [{ name: AG, role: '약관 공동 검토', prov: 'owner' }],
    }),
    blankWork({
      id: 'W-004', name: '출금이체 월 정산', dept: TEAM_PAY, owners: ['U5'],
      ownerHistory: [{ userId: 'U5', from: '2025-03-04', to: null, note: '업무 등록 시 지정' }],
      status: '운영 중', createdAt: T('2025-03-04'), version: 4, topics: ['정산'], summary: '매월 출금이체 결과를 집계해 참가기관과 정산',
      purpose: [st('p1', '매월 출금이체 결과를 집계해 참가기관별로 정산한다.')],
      background: [st('b1', '출금이체 건수가 늘어 월 정산을 별도 업무로 관리한다.')],
      current: [st('c1', '매월 첫 영업일에 전월 집계를 시작해 다섯째 영업일에 마감한다.')],
      cautions: [st('x1', '집계 기준 파일의 컬럼 순서가 바뀌면 정산 합계가 어긋난다. 처리 순서는 담당자 개인 메모에만 있다.')],
      partners: [{ name: AG, role: '정산 자료 제공', prov: 'owner' }],
    }),
    blankWork({
      id: 'W-005', name: '참가기관 전산 영향도 취합', dept: TEAM_PAY, owners: ['U6'],
      ownerHistory: [{ userId: 'U6', from: '2026-10-21', to: null, note: '업무 등록 시 지정' }],
      relatedIds: ['W-001'], topics: ['참가기관'], summary: '참가기관이 제출하는 전산 영향도 검토 결과를 취합',
      purpose: [st('p1', '참가기관의 전산 영향도 검토 결과를 모아 일정 위험을 확인한다.')],
      background: [st('b1', '참가기관은 2026. 11. 30.까지 전산 영향도 검토 결과를 제출할 예정이다.', 'fact', [c('D-6XBF8', 'p1-9', '업무협의회 회의록 p1-9')])],
      current: [st('c1', '취합 양식을 참가기관에 배포하기 전이다.')],
      cautions: [st('x1', '기관별 제출 형식이 달라 취합 전에 양식 통일이 필요하다.')],
      partners: [{ name: AG, role: '취합 창구', prov: 'owner' }, { name: '미래페이(가상)', role: '참가기관', prov: 'owner' }],
    }),
    blankWork({
      id: 'W-006', name: 'ARS 녹취 보관 기준 마련', parentId: 'W-001', type: '정책·제도', dept: TEAM_ID, owners: ['U4'],
      ownerHistory: [{ userId: 'U4', from: '2026-10-12', to: null, note: '업무 등록 시 지정' }],
      status: '검토 중', topics: ['본인확인', '약관'], summary: 'ARS 녹취 방식의 보관 기간·접근 권한 기준 정리',
      purpose: [st('p1', '녹취 파일의 보관 기간과 접근 권한 기준을 정한다.')],
      background: [st('b1', 'ARS 녹취 방식을 우선 도입하기로 합의했다.', 'fact', [c('D-6XBF8', 'p1-6', '업무협의회 회의록 p1-6')])],
      current: [st('c1', '현재 보관 현황을 파악하는 중이다.', 'fact', [c('D-103', 'p-3', 'ARS 녹취 보관 현황 p-3')])],
      cautions: [st('x1', '보관 기간은 법무 검토 의견과 함께 확정한다.', 'owner')],
    }),
    blankWork({
      id: 'W-007', name: '자동이체 오류 대응 매뉴얼 정비', dept: TEAM_PAY, owners: ['U7'],
      ownerHistory: [
        { userId: 'U6', from: '2025-06-02', to: T('2026-09-30'), note: '업무 등록 시 지정 · HO-002 인계로 담당 종료' },
        { userId: 'U7', from: T('2026-09-30'), to: null, note: 'HO-002 인계로 지정' },
      ],
      status: '진행 중', createdAt: T('2025-06-02'), updatedAt: T('2026-10-22'), version: 4, topics: ['정산', '참가기관'],
      summary: '자동이체 오류 유형별 대응 절차를 매뉴얼로 정비',
      purpose: [st('p1', '자동이체 오류 유형별 대응 절차를 한 문서로 정리한다.')],
      background: [st('b1', '오류 대응이 담당자 경험에 의존해 인계 때마다 누락이 생긴다.')],
      current: [st('c1', '오류 유형 분류표 초안을 작성했고 대응 절차를 채우는 중이다.', 'fact', [c('D-105', 'p-3', '오류 대응 매뉴얼 초안 p-3')])],
      cautions: [st('x1', '잔액 부족 오류는 재시도 횟수 기준을 참가기관과 맞춰야 한다.', 'fact', [c('D-105', 'p-4', '오류 대응 매뉴얼 초안 p-4')])],
      partners: [{ name: AG, role: '오류 코드 기준 제공', prov: 'owner' }],
    }),
    blankWork({
      id: 'W-008', name: '출금이체 수수료 정산 대사', dept: TEAM_PAY, owners: ['U5', 'U7'],
      ownerHistory: [{ userId: 'U5', from: '2026-04-01', to: null, note: '업무 등록 시 지정' }, { userId: 'U7', from: '2026-10-01', to: null }],
      status: '운영 중', createdAt: T('2026-04-01'), version: 3, topics: ['정산'], relatedIds: ['W-004'],
      summary: '월 정산 결과와 수수료 청구 내역을 대사',
      purpose: [st('p1', '월 정산 결과와 수수료 청구 내역이 일치하는지 대사한다.')],
      background: [st('b1', '정산 후 수수료 청구 금액에서 차이가 반복되어 대사 절차를 두었다.')],
      current: [st('c1', '대사 확인 절차를 두 사람이 나눠 수행한다.', 'fact', [c('D-104', 'p-3', '월 정산 처리 절차 협의 p-3')])],
      cautions: [st('x1', '차이가 발견되면 정산 마감 전에 참가기관에 먼저 알린다.', 'fact', [c('D-104', 'p-4', '월 정산 처리 절차 협의 p-4')])],
      partners: [{ name: AG, role: '청구 내역 제공', prov: 'owner' }],
    }),
  ];

  // W-007 인계 확정 직전 상태 = 스냅샷 (업무정보 v3), 확정 후 현재 = v4
  const w7Before = clone(works.find((w) => w.id === 'W-007')!);
  w7Before.version = 3;
  w7Before.owners = ['U6'];
  w7Before.ownerHistory = [{ userId: 'U6', from: '2025-06-02', to: null, note: '업무 등록 시 지정' }];
  w7Before.updatedAt = T('2026-09-29');

  s.works.push(...works);
  // 인계 위험 인사이트용 연결·업무(2026-10-29): 길목 업무(선후행), 일 몰린 사람(정하준 3개), 담당자 빈 업무(재배치로 담당 종료)
  s.works.find((w) => w.id === 'W-004')!.nextIds = ['W-008'];
  s.works.find((w) => w.id === 'W-005')!.nextIds = ['W-003'];
  s.works.push(
    blankWork({
      id: 'W-009', name: '정산 시스템 개선 요구사항 정리', dept: TEAM_PAY, owners: ['U5'],
      ownerHistory: [{ userId: 'U5', from: '2026-09-01', to: null, note: '업무 등록 시 지정' }],
      status: '검토 중', createdAt: T('2026-09-01'), updatedAt: T('2026-10-15'), version: 2, topics: ['정산'], relatedIds: ['W-004'],
      summary: '월 정산·수수료 대사에서 반복되는 수작업을 시스템 개선 요구사항으로 정리',
      purpose: [st('p1', '정산 수작업을 줄일 시스템 개선 요구사항을 정리한다.')],
    }),
    blankWork({
      id: 'W-010', name: '참가기관 협의체 회의 운영', dept: TEAM_PAY, owners: [],
      ownerHistory: [{ userId: 'U6', from: '2025-09-01', to: T('2026-10-20'), note: '업무 재배치로 담당 종료' }],
      status: '운영 중', createdAt: T('2025-09-01'), updatedAt: T('2026-10-20'), version: 5, topics: ['참가기관'], relatedIds: ['W-005'],
      summary: '분기별 참가기관 협의체 회의 일정·안건·회의록 관리',
      purpose: [st('p1', '참가기관 협의체 회의를 분기마다 열고 안건과 회의록을 관리한다.')],
    }),
  );

  s.docs.push(
    mkDoc('D-101', '약관 개정 추진계획', '추진계획', '2026-10-06', ['W-003', 'W-001'], 'U3',
      ['약관 개정 추진계획 작성일: 2026. 10. 6. · 디지털신원팀', '□ 개정 목적', '○ 2026. 12. 31.까지 약관 및 시행세칙 개정안을 마련할 계획임.', '○ 개정 조문 초안 구성은 10월 중 확정할 예정임.', '※ 시연용 가상 자료'],
      ['약관 개정 추진계획', '2026. 12. 31.까지 약관 및 시행세칙 개정안을 마련할 계획임.', '개정 조문 초안 구성은 10월 중 확정할 예정임.'], ['약관', '개정']),
    mkDoc('D-102', '본인확인 방식 법무 검토 의견서', '검토보고서', '2026-10-14', ['W-002'], 'U2',
      ['본인확인 방식 법무 검토 의견서 작성일: 2026. 10. 14.', '□ 검토 요청 사항', '○ 전자서명 방식은 추가 보완 없이 본인확인 수준을 충족하는 것으로 검토됨.', '○ ARS 녹취 방식은 녹취 보관 기준을 마련한 뒤 최종 판단할 예정임.', '○ 최종 의견은 2026. 11. 13.까지 회신할 예정임.', '※ 시연용 가상 자료'],
      ['본인확인 방식 법무 검토 의견서', '전자서명 방식은 추가 보완 없이 본인확인 수준을 충족하는 것으로 검토됨.', 'ARS 녹취 방식은 녹취 보관 기준 마련 후 최종 판단할 예정임.'], ['본인확인', '법무']),
    mkDoc('D-103', 'ARS 녹취 보관 현황', '보고자료', '2026-10-22', ['W-006'], 'U4',
      ['ARS 녹취 보관 현황 작성일: 2026. 10. 22.', '□ 현황', '○ 현재 녹취 파일은 참가기관별 저장소에 따로 보관 중임.', '○ 보관 기간 기준이 없어 2026. 11. 6.까지 현황 조사를 마칠 예정임.', '※ 시연용 가상 자료'],
      ['ARS 녹취 보관 현황', '녹취 파일은 참가기관별 저장소에 따로 보관 중임.', '보관 기간 기준이 없어 현황 조사를 마칠 예정임.'], ['녹취', '보관']),
    mkDoc('D-104', '월 정산 처리 절차 협의', '회의록', '2026-10-08', ['W-004', 'W-008'], 'U5',
      ['월 정산 처리 절차 협의 일시: 2026. 10. 8.(목) 15:00', '□ 논의 결과', '○ 수수료 정산 대사는 정산 마감 전에 두 사람이 나눠 확인하기로 합의함.', '○ 차이가 발견되면 마감 전에 참가기관에 먼저 알리기로 결정함.', '※ 시연용 가상 자료'],
      ['월 정산 처리 절차 협의', '수수료 정산 대사는 정산 마감 전에 두 사람이 나눠 확인하기로 합의함.', '차이가 발견되면 마감 전에 참가기관에 먼저 알리기로 결정함.'], ['정산', '대사']),
    mkDoc('D-105', '오류 대응 매뉴얼 초안', '기타', '2026-10-22', ['W-007'], 'U7',
      ['오류 대응 매뉴얼 초안 작성일: 2026. 10. 22.', '□ 현재 상황', '○ 현재 오류 유형 분류표 초안을 작성했고 대응 절차를 채우는 중임.', '○ 잔액 부족 오류의 재시도 횟수 기준은 2026. 11. 20.까지 참가기관과 협의할 계획임.', '※ 시연용 가상 자료'],
      ['오류 대응 매뉴얼 초안', '오류 유형 분류표 초안을 작성했고 대응 절차를 채우는 중임.', '재시도 횟수 기준은 참가기관과 협의할 계획임.'], ['오류', '매뉴얼']),
  );

  s.decisions.push(
    mkDecision('DEC-101', 'W-002', '2026-10-14', '전자서명 방식은 추가 보완 없이 진행하기로 확인함.', c('D-102', 'p-3', '본인확인 방식 법무 검토 의견서 p-3')),
    mkDecision('DEC-102', 'W-008', '2026-10-08', '수수료 정산 대사는 정산 마감 전에 두 사람이 나눠 확인하기로 합의함.', c('D-104', 'p-3', '월 정산 처리 절차 협의 p-3')),
    mkDecision('DEC-103', 'W-008', '2026-10-08', '차이가 발견되면 마감 전에 참가기관에 먼저 알리기로 결정함.', c('D-104', 'p-4', '월 정산 처리 절차 협의 p-4')),
  );

  // 기준일 2026-10-29: 기한 경과(A-102·A-103·A-107·A-113)와 기한 없음(A-105·A-110·A-112)을 섞는다
  s.actions.push(
    mkAction('A-101', 'W-002', '법무 검토 의견 최종 회신 받기', '2026-11-13', 'U2', c('D-102', 'p-5', '본인확인 방식 법무 검토 의견서 p-5')),
    mkAction('A-102', 'W-002', 'ARS 녹취 방식 검토 보완 요청서 보내기', '2026-10-20', 'U4'),
    mkAction('A-103', 'W-003', '개정 조문 초안 구성 확정', '2026-10-25', 'U3', c('D-101', 'p-4', '약관 개정 추진계획 p-4')),
    mkAction('A-104', 'W-003', '약관 개정안 초안 작성', '2026-12-31', 'U2', c('D-101', 'p-3', '약관 개정 추진계획 p-3')),
    mkAction('A-105', 'W-004', '정산 집계 순서 문서로 정리', null, 'U5'),
    mkAction('A-106', 'W-004', '10월분 월 정산 마감', '2026-11-06', 'U5'),
    mkAction('A-107', 'W-005', '취합 양식 참가기관에 배포', '2026-10-27', 'U6'),
    mkAction('A-108', 'W-005', '전산 영향도 제출 현황 점검', '2026-11-30', 'U6', c('D-6XBF8', 'p1-9', '업무협의회 회의록 p1-9')),
    mkAction('A-109', 'W-006', '녹취 보관 현황 조사 마무리', '2026-11-06', 'U4', c('D-103', 'p-4', 'ARS 녹취 보관 현황 p-4')),
    mkAction('A-110', 'W-006', '보관 기간 기준안 작성', null, 'U4'),
    mkAction('A-111', 'W-007', '재시도 횟수 기준 참가기관과 협의', '2026-11-20', 'U7', c('D-105', 'p-4', '오류 대응 매뉴얼 초안 p-4')),
    mkAction('A-112', 'W-007', '오류 유형별 대응 절차 채우기', null, 'U7'),
    mkAction('A-113', 'W-008', '9월분 대사 차이 건 확인', '2026-10-22', 'U5'),
  );

  s.events.push(
    mkEvent('E-101', ['W-003', 'W-001'], '2026-10-06', '문서', '약관 개정 추진계획', 'D-101', null, '문서 등록 반영'),
    mkEvent('E-102', ['W-002'], '2026-10-14', '문서', '본인확인 방식 법무 검토 의견서', 'D-102', null, '문서 등록 반영'),
    mkEvent('E-103', ['W-006'], '2026-10-22', '문서', 'ARS 녹취 보관 현황', 'D-103', null, '문서 등록 반영'),
    mkEvent('E-104', ['W-004', 'W-008'], '2026-10-08', '문서', '월 정산 처리 절차 협의', 'D-104', null, '문서 등록 반영'),
    mkEvent('E-105', ['W-007'], '2026-10-22', '문서', '오류 대응 매뉴얼 초안', 'D-105', null, '문서 등록 반영'),
    mkEvent('E-106', ['W-002'], '2026-11-13', '법령', '법무 검토 최종 의견 회신 예정', 'D-102', 'p-5', '입법'),
    mkEvent('E-107', ['W-008', 'W-004'], '2026-10-08', '의사결정', '수수료 정산 대사를 두 사람이 나눠 확인하기로 합의', 'D-104', 'p-3', '문서 등록 반영'),
    mkEvent('E-108', ['W-003'], '2026-12-31', '시행', '약관 및 시행세칙 개정안 마련 목표일', 'D-101', 'p-3', '시행·확대'),
    {
      ...mkEvent('E-109', ['W-007'], '2026-09-30', '담당자 변경', '업무 담당자 변경: 강예린 → 윤재민', null, null, '플랫폼 기록', 'record'),
      summary: 'HO-002 인계 확정 (플랫폼 기록)', agency: TEAM_PAY, meaning: '인계 시점의 업무정보는 스냅샷으로 보존됨',
    },
  );

  const snap: Snapshot = {
    id: 'S-101', handoverId: 'HO-002', workId: 'W-007', takenAt: T('2026-09-30'), version: 3, work: w7Before,
    decisions: [], actions: [], events: [], docs: [],
  };
  const ho: Handover = {
    id: 'HO-002', workId: 'W-007', fromId: 'U6', toId: 'U7', baseDate: '2026-09-30', status: 'confirmed', step: 8, precheckDone: true,
    checklist: { overview: true, progress: true, decisions: true, partners: true },
    supplement: '잔액 부족 오류 재시도 기준은 참가기관과 협의가 필요함', fromLeaves: true,
    submittedAt: T('2026-09-28'), acceptedAt: T('2026-09-29'), confirmedAt: T('2026-09-30'),
    requests: [],
    log: [
      { at: T('2026-09-28'), byId: 'U6', text: '인계 제출' },
      { at: T('2026-09-29'), byId: 'U7', text: '인수 확인' },
      { at: T('2026-09-30'), byId: 'U7', text: '인계 확정 · 업무정보 v3 스냅샷 보존' },
    ],
    snapshotId: 'S-101', createdAt: T('2026-09-27'),
  };
  s.handovers.push(ho);
  s.snapshots.push(snap);

  s.history.push(
    hist('H-101', 'W-002', '2026-09-15', 'U2', '업무 생성', '하위 업무로 등록 (상위: 비대면 출금동의 추진)'),
    hist('H-102', 'W-002', '2026-10-14', 'U2', '문서 등록', "'본인확인 방식 법무 검토 의견서' 등록 · Mock 분석"),
    hist('H-103', 'W-003', '2026-10-05', 'U3', '업무 생성', '별도 업무로 등록'),
    hist('H-104', 'W-003', '2026-10-06', 'U3', '문서 등록', "'약관 개정 추진계획' 등록 · Mock 분석"),
    hist('H-105', 'W-004', '2025-03-04', 'U5', '업무 생성', '별도 업무로 등록'),
    hist('H-106', 'W-005', '2026-10-21', 'U6', '업무 생성', '관련 업무로 연결해 등록 (관련: 비대면 출금동의 추진)'),
    hist('H-107', 'W-006', '2026-10-22', 'U4', '문서 등록', "'ARS 녹취 보관 현황' 등록 · Mock 분석"),
    hist('H-108', 'W-007', '2025-06-02', 'U6', '업무 생성', '별도 업무로 등록'),
    hist('H-109', 'W-007', '2026-09-30', 'U7', '인계 확정', '담당자 강예린 → 윤재민 (HO-002, 강예린 담당 종료)'),
    hist('H-110', 'W-007', '2026-10-22', 'U7', '문서 등록', "'오류 대응 매뉴얼 초안' 등록 · Mock 분석"),
    hist('H-111', 'W-008', '2026-10-08', 'U5', '문서 등록', "'월 정산 처리 절차 협의' 등록 · Mock 분석"),
  );

  s.currentUserId = 'U1';
  s.mapHidden = [];
  s.focus = {};
  return s;
}
