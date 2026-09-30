// 오류·경고 코드(12.5) → 한국어 화면 메시지

const FIELD_NAMES = { label: '라벨', core_type: '유형', subtype: '하위 유형' };

export function messageFor(err) {
  switch (err.code) {
    case 'E-REQUIRED':
      return `${FIELD_NAMES[err.field] || err.field}을(를) 입력하세요(1~100자).`;
    case 'E-DUP':
      return '같은 노드가 이미 있습니다. 기존 노드를 확인하세요.';
    case 'E-SUBTYPE':
      return '등록되지 않은 하위 유형입니다.';
    case 'E-SCHEMA':
      return '추가할 수 없는 유형입니다.';
    case 'W-NO-EMPNO':
      return '사번 없이 저장했습니다. 통합할 때 확인 목록에 오릅니다.';
    case 'W-STORAGE':
      return '브라우저 저장소를 쓸 수 없습니다. 샘플을 읽기 전용으로 엽니다. 편집한 내용은 저장되지 않습니다.';
    default:
      return `알 수 없는 오류(${err.code})`;
  }
}
