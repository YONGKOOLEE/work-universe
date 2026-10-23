// CR-4 시제품: 업무 유니버스 둘(월말 정산 점검 U-A1, 카드승인 전문 송수신 U-K1)을 묶은 가상 팀 유니버스.
// 팀 유니버스는 자기 노드 없이 꼭지 참조(refs)와 동일성 연결(identity_links)만 가진다(D-02 A 사용법, D-03).
// 두 업무의 "대사" 주제를 사람 확인으로 같은 주제로 이었다(주제 동일성 연결은 CR-4 제안).
// 고치면 STAMP를 바꾼다.

const STAMP = '2026-10-22T20:10:00+09:00'; // 검토9 D-1(b): 꼭지 노드에 설명(유니버스 설명과 같은 글). 앞서 검토6 U-13: 설명의 내부 번호 제거(앞서 검토5 V-5: 팀 이름을 조직관리(U-O)에 맞춤)

export const SAMPLE_TEAM = {
  schema_version: '1.0',
  universe: {
    id: 'U-T1',
    name: '가상정산팀',
    level: '팀',
    owner: '가상정산팀',
    description: '월말 정산 점검과 카드승인 전문 송수신 업무를 묶은 팀 유니버스. 하위 유니버스를 더블클릭하거나 상세 패널에서 펼치고 접을 수 있다.',
    root_node_id: 'N-000',
    subtypes: [],
    is_sample: true,
    created_at: STAMP,
  },
  nodes: [{ id: 'N-000', core_type: 'root', label: '가상정산팀', description: '월말 정산 점검과 카드승인 전문 송수신 업무를 묶은 팀 유니버스. 하위 유니버스를 더블클릭하거나 상세 패널에서 펼치고 접을 수 있다.', hidden: false, created_at: STAMP, updated_at: STAMP }],
  edges: [],
  events: [
    { id: 'E-001', type: 'created', occurred_at: '2026-10-01', recorded_at: STAMP, source: 'sample', payload: { target_kind: 'ref', target_id: 'U-A1' } },
    { id: 'E-002', type: 'created', occurred_at: '2026-10-01', recorded_at: STAMP, source: 'sample', payload: { target_kind: 'ref', target_id: 'U-K1' } },
  ],
  refs: [
    { child_universe_id: 'U-A1', added_at: STAMP },
    { child_universe_id: 'U-K1', added_at: STAMP },
  ],
  identity_links: [
    {
      id: 'I-001',
      a: 'U-A1/N-030',
      b: 'U-K1/N-314',
      kind: 'topic',
      method: 'human',
      status: 'confirmed',
      reason: '둘 다 승인·정산 내역을 대조해 불일치를 찾는 대사(對査)를 다룬다',
      decided_by: '샘플 작성자(가상)',
      decided_at: STAMP,
    },
  ],
};
