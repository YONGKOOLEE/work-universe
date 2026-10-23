// AI(Claude) 관련 화면 문구 한 곳(처음 사용 점검 3회차): 사전 생성의 정체, 실시간 안내 한 줄, 키·데이터 보안 설명.
// 초안·인사이트·도움말·설정이 같은 뜻의 글을 같은 곳에서 가져간다. DOM·저장소를 쓰지 않는다.
// 사실 근거: 사전 생성 = app/data/pregen.js(generated_at), 보내는 글 = llm/evidence-text.js·prompts.js·ai-candidates.js, 키 저장 = store/local.js.

import { PREGEN } from '../../data/pregen.js';

/** 사전 생성 결과를 받아 둔 날짜(YYYY-MM-DD). pregen.js의 generated_at을 읽고, 읽을 수 없으면 빈 글자 */
export function pregenDate(file = PREGEN) {
  const d = file && typeof file.generated_at === 'string' ? file.generated_at.slice(0, 10) : '';
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : '';
}

const DATE = pregenDate();
/** 사전 생성이 무엇인지(언제·무엇으로) */
export const PREGEN_WHAT = `예시 지도의 기록을 앱을 만들 때 Claude에 넣어 미리 받아 둔 문장입니다${DATE ? `(${DATE})` : ''}.`;
/** 앱이 하는 검사 */
export const PREGEN_CHECK = '열 때마다 앱이 근거를 검사하고, 맞지 않으면 기록을 그대로 모은 문장으로 바꿉니다.';
/** 내가 만든 지도는 어떻게 되는가 */
export const PREGEN_MINE = '내가 새로 만든 지도에는 미리 받아 둔 문장이 없어, 키가 없으면 기록을 그대로 모은 문장(규칙 기반)으로, 키가 있으면 Claude가 그 자리에서 씁니다.';

/** 초안 위 안내·칩 설명(짧게) */
export const PREGEN_NOTE = `${PREGEN_WHAT} ${PREGEN_CHECK}`;
export const PREGEN_CHIP_TITLE = PREGEN_NOTE;
/** 도움말 전문 */
export const PREGEN_NOTE_FULL = `${PREGEN_NOTE} ${PREGEN_MINE}`;

/** 키가 없고 사전 생성·규칙 기반 문장일 때 초안 맨 아래 한 줄. 결과를 다 읽은 뒤에 보이므로 "덜 된 것"으로 읽히지 않게 지금 상태부터 말한다 */
export const LIVE_HINT_PREGEN = '지금 문장은 미리 받아 둔 것입니다. 「설정」에 Claude API 키를 넣으면 이 초안을 Claude가 새로 씁니다(선택).';
export const LIVE_HINT_RULE = '지금 문장은 기록을 모은 것입니다. 「설정」에 Claude API 키를 넣으면 이 초안을 Claude가 새로 씁니다(선택).';
export const liveHintFor = (method) => (method === 'pregen' ? LIVE_HINT_PREGEN : LIVE_HINT_RULE);

/** 반복 비효율 탭: 설명 상자의 규칙 기반 문장이 아래 카드 문장과 같을 때 문장을 다시 쓰지 않고 이 안내만 보인다 */
export const EXPLAIN_SAME_AS_BELOW = '아래 근거를 요약한 문장이 없습니다(규칙 기반)';

// ── 키·데이터 보안(도움말 절 + 설정 한 줄) ──
export const SECURITY_TITLE = '키와 데이터';
export const SECURITY_ITEMS = [
  { term: '키는 어디에 저장되나요', desc: '이 브라우저의 저장소(localStorage)에 암호화 없이 저장됩니다. 내보내기 파일·내용 포함 HTML·폴더에 저장하는 파일·되감기 이력에는 들어가지 않습니다. 「키 지우기」를 누르면 키와 받아 둔 응답 캐시가 함께 지워집니다. 공용 PC에서는 쓰지 마세요.' },
  { term: '밖으로 무엇이 나가나요', desc: '키를 넣고 Claude API를 쓸 때만, 문장을 쓰는 데 필요한 근거 글이 이 브라우저에서 곧바로 api.anthropic.com으로 보내집니다. 근거 글은 노드의 이름·설명·속성(연락처 같은 칸 포함)·사번(있으면)과 이력 한 줄(담당 시작·종료, 인수인계, 메모 등), 규칙 기반 문장, 초안 제목입니다. 「AI로 변환」은 붙여 넣은 문서 원문 전체를, 「AI로 연관 찾기」는 묶은 지도 아래 업무의 글(이름·설명·속성·산출물·주제 이름)을 보냅니다. 키가 없거나 다른 방식이면 이 앱은 기록을 어디로도 보내지 않습니다.' },
  { term: '받은 문장은요', desc: '근거 ID와 원문 인용이 확인된 초안·인사이트 문장은 같은 근거로 다시 부르지 않으려고 이 브라우저에 최대 200건까지 저장합니다. 「AI로 변환」·「AI로 연관 찾기」의 응답은 이 화면의 메모리에만 두고 새로고침하면 사라집니다.' },
  { term: '실제 업무 기록을 넣기 전에', desc: '이 앱의 예시는 모두 가상 데이터입니다. 실제 업무 기록은 회사의 외부 전송 기준을 확인한 뒤에 쓰세요. 과금은 키 소유자에게 갑니다.' },
  { term: '사내 LLM', desc: '연결할 자리만 있고 아직 연결되어 있지 않습니다. 고르면 규칙 기반으로 동작합니다.' },
];

/** 설정 화면 「Claude API」 칸 위 안내(위 내용의 요약, 같은 사실) */
export const KEY_NOTE = '키는 이 브라우저 저장소(localStorage)에 암호화 없이 저장되고, 내보내기·내용 포함 HTML·폴더 파일에는 들어가지 않습니다. 키를 넣고 쓰면 문장을 쓰는 데 필요한 근거 글(노드 이름·설명·속성·사번·이력 메모)이 api.anthropic.com으로 보내집니다. 실제 업무 기록은 회사의 외부 전송 기준을 확인한 뒤에 쓰세요. 공용 PC에서는 쓰지 마세요. 과금은 키 소유자에게 갑니다.';
