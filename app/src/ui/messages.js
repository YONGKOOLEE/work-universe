// 오류·경고 코드(12.5) → 한국어 화면 메시지
import { EDGE_TYPES, NODE_TYPES } from '../model/schema.js';

const FIELD_NAMES = {
  label: '이름',
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
  note: '내용',
  id: '노드',
};

// 유형·관계의 표시 이름은 스키마 한 곳에서 가져온다(검토5 C-7)
const TYPE_NAMES = NODE_TYPES;
const EDGE_NAMES = EDGE_TYPES;

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
 * 받침에 맞는 조사만 돌려준다: josa('작성 주체', '을/를') → '를'. 쓰는 곳: `${w}${josa(w, '을/를')}`
 * 끝의 따옴표·괄호는 건너뛰고, 한글이 아니면 알 수 없으므로 「을(를)」처럼 둘 다 적는다(여섯 번째 검토 U-14)
 */
export function josa(word, pair) {
  const [withFinal, without] = pair.split('/');
  const w = String(word == null ? '' : word).replace(/[」』"')\]\s]+$/u, '');
  const code = w.charCodeAt(w.length - 1);
  if (!(code >= 0xac00 && code <= 0xd7a3)) return `${withFinal}(${without})`;
  return (code - 0xac00) % 28 === 0 ? without : withFinal;
}

/**
 * @param {{code:string, field?:string, existing_id?:string}} err
 * @param {{kind?:'node'|'edge'|'event', relation?:string}} [ctx] 어떤 입력에서 난 오류인지(문구를 고른다)
 */
export function messageFor(err, ctx = {}) {
  switch (err.code) {
    case 'E-REQUIRED':
      if (err.field === 'label' || err.field === 'name') return `${name(err.field)}${josa(name(err.field), '을/를')} 입력하세요(1~100자).`;
      if (err.field === 'note') return '메모 내용을 입력하세요.';
      return `${name(err.field)}${josa(name(err.field), '을/를')} 입력하거나 고르세요.`;
    case 'E-DUP':
      if (ctx.kind === 'edge') return '같은 연결이 이미 있습니다(같은 관계, 기간이 겹침). 기존 연결을 확인하세요.';
      if (err.field === 'name') return '같은 이름의 하위 유형이 이미 있습니다.';
      if (err.field === 'child_universe_id') return '이미 묶여 있는 유니버스입니다.';
      return '같은 노드가 이미 있습니다(같은 유형·이름, 또는 같은 사번). 기존 노드를 확인하세요.';
    case 'E-PAIR': {
      const base = ctx.relation && PAIR_TEXT[ctx.relation]
        ? `이 조합으로는 연결할 수 없습니다. 「${EDGE_NAMES[ctx.relation] || ctx.relation}」${josa(EDGE_NAMES[ctx.relation] || ctx.relation, '은/는')} ${PAIR_TEXT[ctx.relation]}만 가능합니다.`
        : '이 조합으로는 연결할 수 없습니다.';
      if (!ctx.source || !ctx.target) return base;
      // 고른 두 노드의 유형과, 이 두 노드에 쓸 수 있는 관계(N-4)
      const s = ctx.source;
      const t = ctx.target;
      const what = ` 고른 노드: 「${s.label}」${josa(s.label, '은/는')} ${TYPE_NAMES[s.core_type] || s.core_type}, 「${t.label}」${josa(t.label, '은/는')} ${TYPE_NAMES[t.core_type] || t.core_type}입니다.`;
      const lastRelation = (ctx.suggestions || []).length ? (EDGE_NAMES[ctx.suggestions[ctx.suggestions.length - 1].relation] || ctx.suggestions[ctx.suggestions.length - 1].relation) : '';
      const ok = (ctx.suggestions || []).map((x) => {
        const name = EDGE_NAMES[x.relation] || x.relation;
        if (x.forward && x.backward) return `「${name}」(어느 방향이든)`;
        return x.forward ? `「${name}」(${s.label} → ${t.label})` : `「${name}」(${t.label} → ${s.label})`;
      });
      return base + what + (ok.length ? ` 이 두 노드에는 ${ok.join(', ')}${josa(lastRelation, '을/를')} 쓸 수 있습니다.` : ' 이 두 노드는 직접 연결할 수 있는 관계가 없습니다.');
    }
    case 'E-SUBTYPE':
      return '등록되지 않은 하위 유형입니다.';
    case 'E-CYCLE':
      return '서로를 포함하게 되어(순환) 묶을 수 없습니다.';
    case 'W-SAMPLE-RESET':
      return `내장 샘플「${err.name}」${josa(err.name, '이/가')} 새 판으로 바뀌어, 이 샘플에 직접 고친 내용은 처음 상태로 돌아갔습니다.`;
    case 'E-SCHEMA':
      if (err.reason === 'version') return `이 유니버스는 다른 버전(${err.found ?? '알 수 없음'})의 형식이라 읽기 전용으로 엽니다. 고칠 수 없습니다.`;
      if (err.reason === 'invalid') return `이 유니버스에 형식 오류 ${err.count}건이 있습니다. 보이는 내용이 일부 맞지 않을 수 있습니다.`;
      if (err.field === 'period') return '기간을 확인하세요. 날짜는 YYYY-MM-DD(1900~2200년)이고, 끝은 시작보다 앞일 수 없습니다.';
      if (err.field === 'occurred_at') return '날짜를 확인하세요(YYYY-MM-DD, 1900~2200년의 실제 있는 날짜).';
      if (err.field === 'label') return '꼭지 이름은 유니버스 이름과 같아서 여기서 바꿀 수 없습니다.';
      if (err.field === 'core_type') return ctx.kind === 'edge' ? '알 수 없는 관계입니다.' : '추가하거나 바꿀 수 없는 유형입니다.';
      if (err.field === 'emp_no') return '사번은 사람 노드에만 넣을 수 있습니다.';
      if (err.field === 'attrs') return '속성 값은 글자나 숫자만 넣을 수 있습니다.';
      if (err.too_long) return `${name(err.field)}${josa(name(err.field), '이/가')} 너무 깁니다(최대 ${err.too_long}자).`;
      if (err.same_person) return '보내는 사람과 받는 사람이 같습니다.';
      if (err.hidden && err.field === 'id') return '숨긴 노드는 고칠 수 없습니다. 근거로서 내용을 그대로 지킵니다.';
      if (err.hidden) return ctx.kind === 'edge' ? '숨긴 노드에는 연결할 수 없습니다.' : `숨긴 노드는 ${name(err.field)}(으)로 고를 수 없습니다.`;
      if (err.expected) return `${name(err.field)} 칸에는 ${TYPE_NAMES[err.expected] || err.expected} 노드만 고를 수 있습니다.`;
      return `${name(err.field)} 값을 확인하세요.`;
    case 'W-NO-EMPNO':
      return '사번 없이 저장했습니다. 통합할 때 확인 목록에 오릅니다.';
    case 'W-STORAGE':
      if (err.reason === 'install') return `브라우저 저장소${err.quota ? ' 공간이 부족해' : '에 쓰지 못해'} 샘플을 저장하지 못했습니다. 샘플을 읽기 전용으로 엽니다. 「가상 데이터 초기화」로 공간을 비우면 다시 쓸 수 있습니다.`;
      if (err.reason === 'quota') return '브라우저 저장 공간이 가득 차서 저장하지 못했습니다. 바뀐 내용은 반영되지 않았습니다. 「가상 데이터 초기화」로 공간을 비울 수 있습니다.';
      if (err.reason === 'write') return '브라우저 저장소에 쓰지 못해 저장하지 못했습니다. 바뀐 내용은 반영되지 않았습니다.';
      return '브라우저 저장소를 쓸 수 없습니다. 샘플을 읽기 전용으로 엽니다. 편집한 내용은 저장되지 않습니다.';
    default:
      return `알 수 없는 오류(${err.code})`;
  }
}
