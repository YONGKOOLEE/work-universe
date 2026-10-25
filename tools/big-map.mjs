// 큰 지도(150개 항목: 업무 63·사람 28·산출물 42·주제 11·조직 5, 연결 335개) 가상 문서. CR-22 G 점검(browser-check.mjs)이 저장소에 넣어 쓴다.
// 사번 V-2xxx, 모든 이름은 가상. 샘플 월말 정산 점검(A1)에 항목을 더해 만든다
import { SAMPLE_A1 } from '../app/data/sample-a1.js';
export function bigDoc() {
  const d = JSON.parse(JSON.stringify(SAMPLE_A1));
  const T = '2026-10-20T09:00:00+09:00';
  d.universe.name = '가상정산팀 업무 전체';
  d.nodes.find((n) => n.id === 'N-000').label = '가상정산팀 업무 전체';
  const node = (id, core_type, label, extra = {}) => d.nodes.push({ id, core_type, label, hidden: false, created_at: T, updated_at: T, ...extra });
  let le = 0; const edge = (source, target, core_type, extra = {}) => d.edges.push({ id: `L-8${String(le++).padStart(3, '0')}`, source, target, core_type, hidden: false, created_at: T, ...extra });
  const streams = {
    정산: ['일 정산 마감', '가맹점 수수료 계산', '정산 지급 확정', '지급 보류 관리', '정산 차액 조정', '환불 정산 반영', '부가세 정산 자료 작성', '해외 결제 환율 정산', '정산 결과 통지', '미지급 잔액 관리'],
    대사: ['카드사 승인 대사', 'VAN 수수료 대사', '은행 입금 대사', '가상계좌 입금 확인', '원천 데이터 수신 점검', '불일치 건 원인 분석', '재처리 요청 접수', '대사 결과 승인', '월 경계 건 분류', '대사 예외 목록 관리'],
    보고: ['일일 정산 현황 보고', '주간 이슈 보고', '월간 손익 보고', '경영진 요약 보고', '감사 대응 자료 작성', '규제 기관 제출 보고', 'KPI 대시보드 갱신', '분기 결산 지원', '예산 대비 실적 분석', '연간 정산 백서 작성'],
    시스템: ['정산 배치 모니터링', '배치 오류 재기동', '정산 규칙 변경 반영', '테스트 데이터 준비', '시스템 권한 점검', '로그 보관 점검', 'DB 백업 확인', '장애 보고서 작성', '개선 요청 접수', '릴리스 검증'],
    고객: ['가맹점 문의 응대', '정산 지연 민원 처리', '지급 계좌 변경 처리', '수수료 이의 제기 검토', '가맹점 해지 정산', '신규 가맹점 등록 확인', '세금계산서 재발행', '정산 내역 재발송', 'VOC 분류·집계', '민원 회신 품질 점검'],
    통제: ['내부 통제 자가 점검', '접근 권한 분기 검토', '개인정보 마스킹 점검', '감사 지적 사항 조치', '증빙 자료 보관', '업무 매뉴얼 개정', '교육 이수 관리', '위험 평가 갱신', '외부 감사 자료 제출', '통제 테스트 기록'],
  };
  const W = {}; let wi = 0;
  const sk = Object.keys(streams);
  sk.forEach((s, si) => streams[s].forEach((name, k) => { const id = `N-5${String(wi++).padStart(2, '0')}`; W[name] = id; node(id, 'work', name, { description: `${s} 흐름의 업무(가상)` }); edge('N-000', id, 'contains'); }));
  // 선후: 흐름 안 앞 6개 사슬 + 흐름 사이
  sk.forEach((s) => { const L = streams[s]; for (let k = 0; k < 6; k++) edge(W[L[k]], W[L[k + 1]], 'precedes'); });
  [['일 정산 마감', '카드사 승인 대사'], ['대사 결과 승인', '일일 정산 현황 보고'], ['배치 오류 재기동', '재처리 요청 접수'], ['정산 지급 확정', '정산 결과 통지'], ['불일치 건 원인 분석', '정산 차액 조정'], ['가맹점 해지 정산', '미지급 잔액 관리'], ['감사 지적 사항 조치', '감사 대응 자료 작성'], ['정산 규칙 변경 반영', '릴리스 검증'], ['장애 보고서 작성', '주간 이슈 보고'], ['수수료 이의 제기 검토', '정산 차액 조정']].forEach(([a, b]) => edge(W[a], W[b], 'precedes'));
  // 기존 A1 업무와도 잇기
  edge('N-001', W['불일치 건 원인 분석'], 'precedes');
  // 조직
  node('N-700', 'org', '가상정산팀'); const parts = ['정산1파트', '정산2파트', '운영파트', '통제파트']; parts.forEach((p, i) => { node(`N-70${i + 1}`, 'org', p); edge(`N-70${i + 1}`, 'N-700', 'belongs_to'); });
  // 사람 25
  const ppl = ['강물결', '고운비', '구슬아', '권새롬', '김다솜', '나비연', '노을이', '단비결', '라온빛', '마음결', '미리내', '바람솔', '별하나', '보라빛', '새벽별', '소나기', '슬기로', '아라뫼', '여울빛', '온새미', '이슬비', '잔디결', '초롱이', '하늬바', '한울림'];
  const all = Object.values(W);
  ppl.forEach((p, i) => {
    const id = `N-6${String(i).padStart(2, '0')}`; node(id, 'person', p, { emp_no: `V-2${String(i + 1).padStart(3, '0')}` });
    const gone = i >= 22; // 3명은 지난 담당만(이동·퇴사)
    edge(id, `N-70${(i % 4) + 1}`, 'belongs_to', gone ? { period: { start: '2024-01-01', end: '2025-12-31' } } : { period: { start: '2024-01-01' } });
    const n = 3 + (i % 3); // 3~5개
    for (let k = 0; k < n; k++) {
      const w = all[(i * 7 + k * 11) % all.length];
      edge(id, w, 'performs', gone || k === n - 1 ? { period: { start: '2024-03-01', end: '2025-08-31' } } : { period: { start: '2025-09-01' } });
    }
  });
  // 산출물 40
  const arts = all.slice(0, 60).filter((_, i) => i % 3 !== 2); // 40개
  arts.forEach((w, i) => { const name = d.nodes.find((n) => n.id === w).label; const id = `N-8${String(i).padStart(2, '0')}`; node(id, 'artifact', `${name} ${['결과표', '보고서', '점검표', '양식'][i % 4]}`); edge(w, id, 'produces'); });
  for (let i = 0; i < 10; i++) edge(`N-8${String(i * 3).padStart(2, '0')}`, `N-8${String(i * 3 + 2).padStart(2, '0')}`, 'references');
  // 주제 10
  const topics = ['환불 반영', '월 경계', '원천 지연', '수수료 차이', '재처리', '가맹점 해지', '개인정보', '배치 장애', '환율', '세금계산서'];
  topics.forEach((t, i) => node(`N-9${String(i).padStart(2, '0')}`, 'topic', t));
  for (let k = 0; k < 36; k++) edge(all[(k * 13 + 5) % 60], `N-9${String(k % 10).padStart(2, '0')}`, 'relates_to');
  return d;
}
