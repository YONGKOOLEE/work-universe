// 오류·경고 코드(12.5) → 한국어 화면 메시지
import { EDGE_TYPES, NODE_TYPES, hasKey } from '../model/schema.js';

const FIELD_NAMES = {
  label: '이름',
  core_type: '유형',
  subtype: '하위 유형',
  description: '설명',
  emp_no: '사번',
  period: '기간',
  attrs: '속성',
  source: '출발 항목',
  target: '상대 항목',
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
  child_universe_id: '하위 업무 지도',
  category: '분류',
  note: '내용',
  id: '항목',
  starter_work: '첫 업무 이름',
  starter_person: '담당자 이름',
  starter_artifact: '산출물 이름',
};

// 유형·관계의 표시 이름은 스키마 한 곳에서 가져온다(검토5 C-7)
const TYPE_NAMES = NODE_TYPES;
const EDGE_NAMES = EDGE_TYPES;

// 관계별로 연결할 수 있는 조합(12.2). E-PAIR 안내에 쓴다
export const PAIR_TEXT = {
  contains: '지도 중심 → 지도 중심 외 모든 항목, 업무 → 업무',
  performs: '사람 → 업무',
  produces: '업무 → 산출물',
  precedes: '업무 → 업무',
  belongs_to: '사람 → 조직, 조직 → 조직',
  relates_to: '지도 중심 외 모든 항목 → 주제',
  references: '지도 중심 외 항목 → 지도 중심 외 항목',
};

// 「관련」 연결이 주제가 아닌 노드에 걸려 거절될 때 덧붙이는 안내(FU-20). 사람 → 업무는 「수행」, 업무 → 산출물은 「산출」, 그 밖의 가리킴은 「참조」(꼭지 제외)
const RELATES_TO_HELP = ' 무엇을 고르면 되나: 사람을 업무에 이으려면 「수행」(사람 → 업무), 업무가 만든 문서·산출물이면 「산출」(업무 → 산출물), 그냥 가리키기만 하면 「참조」입니다. 「관련」은 대상이 주제 항목일 때만 씁니다.';

// 사번 없는 사람을 저장했을 때의 안내(CR-18 D-15): 다른 팀 협업자는 사번을 모를 수 있으므로 겁먹지 않게 먼저 말한다
export const NO_EMPNO_TEXT = '사번 없이 저장했습니다. 다른 팀 사람이면 사번 없이 두어도 됩니다(같은 사람인지는 나중에 여러 지도를 묶을 때 통합 확인 목록에서 확인합니다).';

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
      if (err.field === 'rows') return '저장할 행이 없습니다. 이름을 입력한 행이 하나 이상 있어야 합니다.';
      if (err.field === 'core_type') return '유형을 고르세요.';
      return `${name(err.field)}${josa(name(err.field), '을/를')} 입력하거나 고르세요.`;
    case 'E-DUP':
      if (err.period_overlap) return '이 사람의 담당 기간이 이미 있는 기간과 겹칩니다. 기간이 겹치지 않게 시작·끝 날짜를 확인하세요.';
      if (ctx.kind === 'edge') return '같은 연결이 이미 있습니다(같은 관계, 기간이 겹침). 기존 연결을 확인하세요.';
      if (err.field === 'name') return '같은 이름의 하위 유형이 이미 있습니다.';
      if (err.field === 'child_universe_id') return '이미 묶여 있는 업무 지도입니다.';
      if (err.already_active) return '이 사람은 이미 이 업무를 담당 중입니다(수행 연결이 있고 끝나지 않음). 담당이 바뀌었다면 먼저 「담당 종료」를 기록하세요.';
      if (err.with_row) return `${err.with_row}행과 같은 유형·이름입니다. 둘 중 하나를 고치세요.`;
      return '같은 항목이 이미 있습니다(같은 유형·이름, 또는 같은 사번). 기존 항목을 확인하세요.';
    case 'E-PAIR': {
      const base = ctx.relation && PAIR_TEXT[ctx.relation]
        ? `이 조합으로는 연결할 수 없습니다. 「${EDGE_NAMES[ctx.relation] || ctx.relation}」${josa(EDGE_NAMES[ctx.relation] || ctx.relation, '은/는')} ${PAIR_TEXT[ctx.relation]}만 가능합니다.`
        : '이 조합으로는 연결할 수 없습니다.';
      // 「관련」은 주제에만 잇는다. 처음 쓰는 사람이 무엇을 골라야 하는지 알도록 흔한 경우를 덧붙인다(FU-20, schema.js PAIR_RULES와 같은 조합)
      const tail = ctx.relation === 'relates_to' ? RELATES_TO_HELP : '';
      if (!ctx.source || !ctx.target) return base + tail;
      // 고른 두 노드의 유형과, 이 두 노드에 쓸 수 있는 관계(N-4)
      const s = ctx.source;
      const t = ctx.target;
      const what = ` 고른 항목: 「${s.label}」${josa(s.label, '은/는')} ${(hasKey(TYPE_NAMES, s.core_type) ? TYPE_NAMES[s.core_type] : s.core_type)}, 「${t.label}」${josa(t.label, '은/는')} ${(hasKey(TYPE_NAMES, t.core_type) ? TYPE_NAMES[t.core_type] : t.core_type)}입니다.`;
      const lastRelation = (ctx.suggestions || []).length ? (EDGE_NAMES[ctx.suggestions[ctx.suggestions.length - 1].relation] || ctx.suggestions[ctx.suggestions.length - 1].relation) : '';
      const ok = (ctx.suggestions || []).map((x) => {
        const name = EDGE_NAMES[x.relation] || x.relation;
        if (x.forward && x.backward) return `「${name}」(어느 방향이든)`;
        return x.forward ? `「${name}」(${s.label} → ${t.label})` : `「${name}」(${t.label} → ${s.label})`;
      });
      return base + what + (ok.length ? ` 이 두 항목에는 ${ok.join(', ')}${josa(lastRelation, '을/를')} 쓸 수 있습니다.` : ' 이 두 항목은 직접 연결할 수 있는 관계가 없습니다.') + tail;
    }
    case 'E-SUBTYPE':
      return '등록되지 않은 하위 유형입니다.';
    case 'E-CYCLE':
      return '서로를 포함하게 되어(순환) 묶을 수 없습니다.';
    case 'W-SAMPLE-RESET':
      return `내장 샘플「${err.name}」${josa(err.name, '이/가')} 새 판으로 바뀌어, 이 샘플에 직접 고친 내용은 처음 상태로 돌아갔습니다.`;
    case 'E-SCHEMA':
      if (err.reason === 'version') return `이 업무 지도는 다른 버전(${err.found ?? '알 수 없음'})의 형식이라 읽기 전용으로 엽니다. 고칠 수 없습니다.`;
      if (err.reason === 'in_use' && (err.reasons || []).includes('external')) return '다른 업무 지도(상위 묶음)에서 같은 사람·업무로 이어 둔 항목이라 바로 지울 수 없습니다. 먼저 숨긴 뒤 「숨긴 항목」 목록에서 「완전히 삭제」하세요(자리표시로 남습니다).';
      if (err.reason === 'in_use') return '연결이나 다른 이력이 있는 항목은 바로 지울 수 없습니다. 먼저 숨긴 뒤 「숨긴 항목」 목록에서 「완전히 삭제」하세요.';
      if (err.reason === 'not_hidden') return '숨기지 않은 항목은 완전히 삭제할 수 없습니다. 먼저 숨기세요.';
      if (err.deleted) return '완전히 삭제한 항목은 되살릴 수 없습니다.';
      if (err.reason === 'invalid') return `이 업무 지도에 형식 오류 ${err.count}건이 있습니다. 보이는 내용이 일부 맞지 않을 수 있습니다.`;
      // 내용 포함 HTML에 든 지도 중 형식이 깨진 것은 빼고 연다(검토10 C-2)
      if (err.reason === 'embed_skipped') return `이 파일에 담긴 업무 지도 ${err.count}개(${(err.names || []).map((x) => `「${x}」`).join(', ')})는 형식이 맞지 않아 빼고 열었습니다. 나머지 지도는 그대로 볼 수 있습니다.`;
      if (err.too_deep) return `파일 안의 내용이 너무 깊게 겹쳐 있어(${err.too_deep}겹 넘음) 업무 지도로 읽지 않았습니다.`;
      if (err.field === 'period') return '기간을 확인하세요. 날짜는 YYYY-MM-DD(1900~2200년)이고, 끝은 시작보다 앞일 수 없습니다.';
      if (err.field === 'end_date' && err.future) return '끝 날짜는 오늘보다 뒤일 수 없습니다. 지금 담당 중이면 끝 날짜를 비우고, 끝날 때 「담당 종료」를 기록하세요.';
      if (err.field === 'end_date') return '끝 날짜를 확인하세요(YYYY-MM-DD). 끝 날짜는 담당 시작 날짜보다 앞일 수 없습니다.';
      if (err.mismatch) return '해결 표시의 대상·주제가 닫으려는 메모와 다릅니다. 아무것도 저장하지 않았습니다.';
      if (err.field === 'occurred_at' && err.future) return '날짜는 오늘보다 뒤일 수 없습니다. 아무것도 저장하지 않았습니다.';
      if (err.field === 'occurred_at') return '날짜를 확인하세요(YYYY-MM-DD, 1900~2200년의 실제 있는 날짜).';
      if (err.field === 'label') return '지도 중심 이름은 업무 지도 이름과 같아서 여기서 바꿀 수 없습니다.';
      if (err.unknown_type) return `알 수 없는 유형 「${err.unknown_type}」입니다. 업무·사람·문서(산출물)·조직·주제 중 하나를 쓰세요.`;
      if (err.cannot_change) return '유형은 바꿀 수 없습니다. 유형을 바꾸려면 새 항목으로 추가하세요.';
      if (err.extra_cells) return '머리글보다 칸이 많습니다. 탭이 더 들어갔는지 확인하세요.';
      if (err.no_active) return '이 사람이 이 업무를 담당 중인 연결이 없어 종료할 수 없습니다. 담당자와 업무를 확인하세요.';
      if (err.locked) return '이 항목의 속성 값에 「;」나 줄바꿈이 있어 표로 고칠 수 없습니다. 상세 패널의 「수정」에서 고치세요.';
      if (err.not_closed) return '이 메모를 닫지 못했습니다. 메모와 해결 표시의 기록 순서를 맞추지 못했습니다(다른 PC에서 만든 문서의 기록 시각이 어긋났거나, 이 메모가 다른 이력에 가려졌을 수 있습니다). 아무것도 저장하지 않았습니다.';
      if (err.format) return '속성은 「키=값; 키=값」 형식으로 쓰세요.';
      if (err.too_many) return `한 번에 ${err.too_many}행까지 저장할 수 있습니다. 나누어 저장하세요.`;
      if (err.field === 'core_type') return ctx.kind === 'edge' ? '알 수 없는 관계입니다.' : '추가하거나 바꿀 수 없는 유형입니다.';
      if (err.field === 'emp_no' && !err.too_long) return '사번은 사람 항목에만 넣을 수 있습니다.'; // 길이 초과는 아래 too_long 문구(검토8 재검증 상한)
      if (err.field === 'attrs') return '속성 값은 글자나 숫자만 넣을 수 있습니다.';
      if (err.too_long) return `${name(err.field)}${josa(name(err.field), '이/가')} 너무 깁니다(최대 ${err.too_long}자).`;
      if (err.same_person) return '보내는 사람과 받는 사람이 같습니다.';
      if (err.self_loop) return '항목을 자기 자신과 이을 수 없습니다. 다른 항목을 고르세요(표의 「다음 업무」에 같은 업무 이름을 적었는지 확인).';
      if (err.hidden && err.field === 'id') return '숨긴 항목은 고칠 수 없습니다. 근거로서 내용을 그대로 지킵니다.';
      if (err.hidden) return ctx.kind === 'edge' ? '숨긴 항목에는 연결할 수 없습니다.' : `숨긴 항목은 ${name(err.field)}(으)로 고를 수 없습니다.`;
      if (err.expected) return `${name(err.field)} 칸에는 ${TYPE_NAMES[err.expected] || err.expected} 항목만 고를 수 있습니다.`;
      return `${name(err.field)} 값을 확인하세요.`;
    case 'W-NO-EMPNO':
      return NO_EMPNO_TEXT;
    case 'W-STORAGE':
      if (err.reason === 'install') return `브라우저 저장소${err.quota ? ' 공간이 부족해' : '에 쓰지 못해'} 샘플을 저장하지 못했습니다. 샘플을 읽기 전용으로 엽니다. 「가상 데이터 초기화」로 공간을 비우면 다시 쓸 수 있습니다.`;
      if (err.reason === 'quota') return '브라우저 저장 공간이 가득 차서 저장하지 못했습니다. 바뀐 내용은 반영되지 않았습니다. 「가상 데이터 초기화」로 공간을 비울 수 있습니다.';
      if (err.reason === 'write') return '브라우저 저장소에 쓰지 못해 저장하지 못했습니다. 바뀐 내용은 반영되지 않았습니다.';
      return '브라우저 저장소를 쓸 수 없습니다. 샘플을 읽기 전용으로 엽니다. 편집한 내용은 저장되지 않습니다.';
    default:
      return `알 수 없는 오류(${err.code})`;
  }
}
