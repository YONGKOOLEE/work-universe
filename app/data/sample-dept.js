// 가상 부서 유니버스 U-D1: 정산팀(U-T1, 업무 유니버스 둘을 묶음), 행사팀(U-B), 교육팀(U-C, T-13)을 묶었다.
// 교육팀의 윤바다라(V-1002)는 윤바다와 사번이 같고 이름이 달라 자동으로 잇지 않는다(사번 충돌, R-11 ③). 임가온은 사번이 없다. 부서 → 팀 → 업무의 여러 단계 묶기 시연.
// 두 팀에 있는 윤바다(V-1002)는 사번 자동으로 같은 사람으로 이었다(D-03). 이 연결이 있어야 유사 경험자 계산이 팀을 넘어 동작한다(T-08).
// 고치면 STAMP를 바꾼다.

const STAMP = '2026-10-17T00:10:00+09:00'; // D8-2 다른 업무 판정 3건

export const SAMPLE_DEPT = {
  schema_version: '1.0',
  universe: {
    id: 'U-D1',
    name: '가상 운영부',
    level: '부서',
    owner: '가상 운영부',
    description: '정산팀·행사팀·교육팀을 묶은 부서 유니버스. 여러 단계로 묶은 사례.',
    root_node_id: 'N-000',
    subtypes: [],
    is_sample: true,
    created_at: STAMP,
  },
  nodes: [{ id: 'N-000', core_type: 'root', label: '가상 운영부', hidden: false, created_at: STAMP, updated_at: STAMP }],
  edges: [],
  events: [
    { id: 'E-001', type: 'created', occurred_at: '2026-10-01', recorded_at: STAMP, source: 'sample', payload: { target_kind: 'ref', target_id: 'U-T1' } },
    { id: 'E-002', type: 'created', occurred_at: '2026-10-01', recorded_at: STAMP, source: 'sample', payload: { target_kind: 'ref', target_id: 'U-B' } },
    { id: 'E-003', type: 'created', occurred_at: '2026-10-01', recorded_at: STAMP, source: 'sample', payload: { target_kind: 'ref', target_id: 'U-C' } },
  ],
  refs: [
    { child_universe_id: 'U-T1', added_at: STAMP },
    { child_universe_id: 'U-B', added_at: STAMP },
    { child_universe_id: 'U-C', added_at: STAMP },
  ],
  identity_links: [
    { id: 'I-001', a: 'U-A1/N-011', b: 'U-B/N-202', kind: 'person', method: 'emp_no_auto', status: 'confirmed', reason: '사번 V-1002, 이름 윤바다가 같음' },
    // D8-2: 이름만 같은 주제 「대사 불일치」로 후보에 오른 엉뚱한 3쌍을 사람이 "다른 업무"로 판정한 기록(앱의 「다른 업무」와 같은 모양)
    { id: 'I-002', a: 'U-K1/N-104', b: 'U-B/N-101', kind: 'work', method: 'human', status: 'rejected', reason: '이름만 같은 주제 「대사 불일치」로 묶임 — 행사 정산과 카드승인·월말 정산은 다른 업무(샘플에 미리 넣은 판정)', decided_by: '가상 운영부 담당(샘플)', decided_at: STAMP },
    { id: 'I-003', a: 'U-A1/N-001', b: 'U-B/N-101', kind: 'work', method: 'human', status: 'rejected', reason: '이름만 같은 주제 「대사 불일치」로 묶임 — 행사 정산과 카드승인·월말 정산은 다른 업무(샘플에 미리 넣은 판정)', decided_by: '가상 운영부 담당(샘플)', decided_at: STAMP },
    { id: 'I-004', a: 'U-K1/N-105', b: 'U-B/N-101', kind: 'work', method: 'human', status: 'rejected', reason: '이름만 같은 주제 「대사 불일치」로 묶임 — 행사 정산과 카드승인·월말 정산은 다른 업무(샘플에 미리 넣은 판정)', decided_by: '가상 운영부 담당(샘플)', decided_at: STAMP },
  ],
};
