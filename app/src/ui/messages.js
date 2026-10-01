// 오류·경고 코드(12.5) → 한국어 화면 메시지

const FIELD_NAMES = {
  label: '라벨',
  core_type: '유형',
  subtype: '하위 유형',
  description: '설명',
  emp_no: '사번',
  period: '기간',
  attrs: '속성',
  source: '출발 노드',
  target: '상대 노드',
  type: '이력 종류',
  occurred_at: '날짜',
  person_id: '사람',
  work_id: '업무',
  from_person_id: '보내는 사람',
  to_person_id: '받는 사람',
  previous_handover_id: '이전 인수인계',
  name: '이름',
  level: '단위',
  owner: '작성 주체',
  child_universe_id: '하위 유니버스',
  category: '분류',
};

const TYPE_NAMES = { person: '사람', work: '업무', artifact: '산출물', org: '조직', topic: '주제' };

// 관계별로 연결할 수 있는 조합(12.2). E-PAIR 안내에 쓴다
export const PAIR_TEXT = {
  contains: '꼭지 → 꼭지 외 모든 노드, 업무 → 업무',
  performs: '사람 → 업무',
  produces: '업무 → 산출물',
  precedes: '업무 → 업무',
  belongs_to: '사람 → 조직, 조직 → 조직',
  relates_to: '꼭지 외 모든 노드 → 주제',
  references: '꼭지 외 노드 → 꼭지 외 노드',
};

const name = (field) => FIELD_NAMES[field] || field;

/**
 * @param {{code:string, field?:string, existing_id?:string}} err
 * @param {{kind?:'node'|'edge'|'event', relation?:string}} [ctx] 어떤 입력에서 난 오류인지(문구를 고른다)
 */
export function messageFor(err, ctx = {}) {
  switch (err.code) {
    case 'E-REQUIRED':
      if (err.field === 'label' || err.field === 'name') return `${name(err.field)}을(를) 입력하세요(1~100자).`;
      return `${name(err.field)}을(를) 입력하거나 고르세요.`;
    case 'E-DUP':
      if (ctx.kind === 'edge') return '같은 연결이 이미 있습니다(같은 관계, 기간이 겹침). 기존 연결을 확인하세요.';
      if (err.field === 'name') return '같은 이름의 하위 유형이 이미 있습니다.';
      if (err.field === 'child_universe_id') return '이미 묶여 있는 유니버스입니다.';
      return '같은 노드가 이미 있습니다(같은 유형·라벨, 또는 같은 사번). 기존 노드를 확인하세요.';
    case 'E-PAIR':
      return ctx.relation && PAIR_TEXT[ctx.relation]
        ? `이 조합으로는 연결할 수 없습니다. 이 관계는 ${PAIR_TEXT[ctx.relation]}만 가능합니다.`
        : '이 조합으로는 연결할 수 없습니다.';
    case 'E-SUBTYPE':
      return '등록되지 않은 하위 유형입니다.';
    case 'E-CYCLE':
      return '서로를 포함하게 되어(순환) 묶을 수 없습니다.';
    case 'E-SCHEMA':
      if (err.field === 'period') return '기간을 확인하세요. 날짜는 YYYY-MM-DD이고, 끝은 시작보다 앞일 수 없습니다.';
      if (err.field === 'occurred_at') return '날짜를 확인하세요(YYYY-MM-DD, 실제 있는 날짜).';
      if (err.field === 'label') return '꼭지 이름은 유니버스 이름과 같아서 여기서 바꿀 수 없습니다.';
      if (err.field === 'core_type') return ctx.kind === 'edge' ? '알 수 없는 관계입니다.' : '추가하거나 바꿀 수 없는 유형입니다.';
      if (err.field === 'emp_no') return '사번은 사람 노드에만 넣을 수 있습니다.';
      if (err.field === 'attrs') return '속성 값은 글자나 숫자만 넣을 수 있습니다.';
      if (err.hidden) return '숨긴 노드에는 연결할 수 없습니다.';
      if (err.expected) return `${name(err.field)} 칸에는 ${TYPE_NAMES[err.expected] || err.expected} 노드만 고를 수 있습니다.`;
      return `${name(err.field)} 값을 확인하세요.`;
    case 'W-NO-EMPNO':
      return '사번 없이 저장했습니다. 통합할 때 확인 목록에 오릅니다.';
    case 'W-STORAGE':
      return '브라우저 저장소를 쓸 수 없습니다. 샘플을 읽기 전용으로 엽니다. 편집한 내용은 저장되지 않습니다.';
    default:
      return `알 수 없는 오류(${err.code})`;
  }
}
