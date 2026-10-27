// 가져오기 화면(T-17): 문서 붙여넣기 → 규칙 기반 초벌 변환(CR-5 ②) 또는 JSON 파일 → 미리 보기 → 사람이 「가져오기」(CR-3 AC ③).
// 미리 보기에서 검증 오류가 있으면 가져올 수 없다(AC ①). 원문 근거와 [가정]·[미확인] 표시를 보여 준다(AC ②④).

import { el } from './dom.js';
import { josa, messageFor } from './messages.js';
import { MEMO_CATEGORIES, SCHEMA_VERSION, memoCategoryOf, nodeTypeLabel } from '../model/schema.js';
import { IMPORT_MAX_CHARS, parseImportText } from '../model/import.js';
import { METHOD_LABELS } from '../llm/connector.js';
import { folderTab } from './folder-tab.js';
import { CONVERT_RULES, docWorkLabel } from '../rules/doc-convert.js';

const KIND_TEXT = {
  overview: () => '개요 → 지도 중심(연두색 큰 원)의 이름·목적·배경, 그리고 범위·이해관계자',
  scope: (n) => `범위 → 업무 ${n}개`,
  scope_out: () => '범위 제외 → 업무 지도 설명',
  steps: (n) => `업무 흐름 → 대표 업무의 절차 속성 ${n}단계(항목으로 만들지 않음)`,
  topic: () => '주제 1개(문서의 항목은 설명에)',
  people: (n) => `사람·역할 ${n}개`,
  cautions: (n) => `주의사항 → 대표 업무의 주의사항 속성 ${n}줄`,
  artifacts: (n) => `산출물 ${n}개`,
  memos: (n) => `메모 ${n}건`,
  toc: () => '목차 → 건너뜀(항목으로 만들지 않음)',
  ai_work: (n) => `업무 ${n}개(절차는 업무의 절차 속성에)`,
  ai_person: (n) => `사람·역할 ${n}개`,
  ai_artifact: (n) => `산출물 ${n}개`,
  ai_topic: (n) => `주제 ${n}개`,
  ai_memo: (n) => `메모 ${n}건`,
  ai_edge: (n) => `원문이 말한 연결 ${n}개`,
  outline: () => '아래 절 제목의 목록 → 건너뜀(아래 절에서 만듦)',
};

// 파일을 읽기 전에 크기만 본다(검토9 S-3): 글자 수 상한(IMPORT_MAX_CHARS)은 읽은 뒤에만 알 수 있어, 수백 MB 파일은 읽다가 탭이 멈춘다.
// 한글은 UTF-8에서 글자당 3바이트라 상한 × 3바이트를 넘으면 글자 수 상한도 반드시 넘는다
export const IMPORT_FILE_MAX_BYTES = IMPORT_MAX_CHARS * 3;
export const fileTooBig = (size) => Number.isFinite(size) && size > IMPORT_FILE_MAX_BYTES;
/** 글자로 읽을 수 없는 문서 파일(문서 붙여넣기 탭에서 고르면 읽지 않고 안내) */
export const BINARY_DOC = /\.(pdf|hwp|hwpx|doc|docx|ppt|pptx|xls|xlsx)$/i;

// 변환 결과가 「제목도 범위도 못 찾음」이면 업무정의서가 아닌 글을 붙였을 가능성이 크다(검토9 C-1·C-2)
const AI_KIND_LABEL = { work: '업무', person: '사람', artifact: '산출물', topic: '주제', memo: '메모', edge: '연결' };
// 문서 AI 변환(T-37): 화면 문구. 응답을 기다리는 최대 시간은 llm/providers.js의 LLM_CONVERT_TIMEOUT_MS(90초, 재시도 없음)와 같은 값이다
export const AI_CONVERT_WAIT = 'AI가 읽는 중… (최대 90초)';
export const NOT_A_DEFINITION_NOTICE = '제목·범위를 찾지 못했습니다. 업무정의서가 아니거나 모양이 다른 글입니다 — 「예시 문서 넣기」로 모양을 먼저 보세요.';
export function looksNotDefinition(report) {
  const codes = new Set(((report && report.notes) || []).map((n) => n.code));
  return codes.has('C-NO-STRUCTURE') && codes.has('C-NO-SCOPE');
}

export function noteText(n) {
  switch (n.code) {
    case 'C-NO-OWNER': return '원문에서 작성 주체를 읽지 못했습니다(「작성:」·「작성 부서:」 줄은 …팀·…부 같은 조직 이름이 있을 때만, 날짜뿐인 값은 읽지 않습니다). 위 「작성 주체」 칸에 팀·부서 이름을 입력해야 새 업무 지도를 만들 수 있습니다.';
    case 'C-DATE-ASSUMED': return `원문에 작성일이 없어 메모(질문·리스크) 날짜를 변환한 날(${n.date})로 적었습니다.`;
    case 'C-TOPIC-GUESS': return `규칙에 없는 제목의 절 ${n.count}개를 주제로 만들었습니다(표에 「규칙 밖」 표시). 맞는지 확인하세요.`;
    case 'C-TOO-MANY': return `그래프 항목이 ${n.count}개로, 정한 세분화(월말 정산 수준, ${n.max}개 이하)보다 많습니다. 문서의 범위 항목을 묶을 수 있는지 확인하세요.`;
    case 'C-TOO-FEW': return `그래프 항목이 ${n.count}개로 적습니다. 업무 하나짜리 문서라면 정상입니다. 업무가 여러 개인 문서라면 「AI로 변환」(설정에서 키를 넣었을 때)을 쓰거나 업무별로 나눠 변환하세요. 제목(#)·표·번호 목록이 있는지도 확인하세요.`;
    // 아래 두 알림 중 담당 절(「주 담당·담당·정」) 관련은 변환 스위치 CONVERT_RULES.cr17j.assignPerforms가 켜졌을 때만 나온다(CR-17 J 승인안은 켬)
    case 'C-ASSIGN-SKIPPED': return `담당 절에 「주 담당·담당·정」으로 적힌 사람 ${n.count}명은 업무가 여러 개라 어느 업무의 담당인지 알 수 없어 업무에 잇지 않았습니다. 필요하면 연결을 직접 추가하세요.`;
    case 'C-PERFORMS-GUESS': return `담당(수행) 연결 ${n.count}건을 추정했습니다 — ${n.assigned ? `${n.count - n.assigned > 0 ? `${n.count - n.assigned}건은 원문의 역할 「하는 일」 항목이 업무 이름과 같은 경우이고, ` : ''}${n.assigned}건은 담당 절에 「주 담당·담당·정」으로 적힌 사람을 업무가 하나뿐인 문서의 그 업무에 이은 것입니다` : '원문의 역할 「하는 일」 항목이 업무 이름과 같은 경우만이고(결재·검토처럼 이름이 일부만 들어간 항목은 잇지 않음)'}. 기간이 없어 '지금 담당'으로 계산됩니다. 맞는지 확인하세요.`;
    case 'C-ROW-NO-NAME': return `${n.ref} 표의 ${n.row}번째 행은 이름 칸이 비어 있어 건너뛰었습니다. 원문을 확인하세요.`;
    case 'C-NO-NAME': return `${n.ref}의 「${n.text}」는 이름이 없어(표시·번호·괄호뿐) 항목으로 만들지 않았습니다. 원문을 확인하세요.`;
    case 'C-TABLE-NAME-COL': return `${n.ref} 표에서 ${n.col}번째 칸을 업무 이름으로 썼습니다(첫 칸은 구분·순서로 보임). 이름이 엉뚱하면 표 머리글을 「업무」로 바꿔 다시 변환하세요.`;
    case 'C-NO-SCOPE': return '원문에서 범위(업무 목록)를 찾지 못해 문서 이름으로 업무 하나를 만들었습니다.';
    case 'C-NO-STRUCTURE': return '제목(#)이 없어 구조를 거의 읽지 못했습니다. 마크다운 제목·표·번호 목록이 있으면 더 잘 바뀝니다.';
    case 'C-TRUNCATED': return `「${n.where}」 글이 너무 길어 ${n.max}자에서 잘랐습니다.`;
    case 'C-UNUSED': return `개요 표에서 쓰지 못한 칸이 있습니다(${n.refs.join(', ')}). 원문을 함께 보세요.`;
    case 'C-PEOPLE-PROSE': return `${n.ref}의 문장 ${n.count}줄은 사람 이름이 아니라서 역할로 만들지 않고 그 절의 주제 설명에 넣었습니다.`;
    case 'C-SCOPE-PROSE': return `${n.ref}의 문장 ${n.count}줄은 업무 목록이 아니라 설명이라서 업무로 나누지 않고 그 절의 주제 설명에 넣었습니다.`;
    case 'C-ARTIFACT-PROSE': return `${n.ref}의 문장 ${n.count}줄은 문서 이름이 아니라서 산출물로 만들지 않고 그 절의 주제 설명에 넣었습니다.`;
    default: return n.code;
  }
}

function warningText(w, from) {
  if (w.code === 'W-SAMPLE-OVERWRITE') return `내장 샘플「${w.name}」${josa(w.name, '을/를')} 덮어씁니다. 이 창 맨 아래 「고급」을 펼쳐 「가상 데이터 초기화」를 누르면 원래 샘플로 돌아갑니다.`;
  if (w.code === 'W-SAMPLE-FLAG') return '파일에 샘플 표시가 있지만 내장 샘플이 아니므로 「내 업무 지도」로 가져옵니다.';
  if (w.code === 'W-REAL-NAME-LIKE') return `실명처럼 보이는 사람 이름 ${w.count}개가 있습니다(${w.labels.join(', ')}). 이 도구는 가상 데이터용입니다. 실제 이름이면 가져오기 전에 역할 이름(예: 정산 담당)으로 바꾸세요.`;
  if (w.code === 'W-EMPNO-LIKE') return `사번·주민번호처럼 보이는 숫자(6자리 이상)가 ${w.count}곳에 있습니다. 실제 번호면 지우거나 V-0000 형식의 가상 사번으로 바꾸세요.`;
  if (w.code === 'W-SAME-NAME' && from === 'json') return `이름·단위가 같은 「${w.name}」(${w.level}) 업무 지도가 이미 있습니다. 가져오면 따로 하나 더 생깁니다.`;
  if (w.code === 'W-NO-SOURCE') return `원문 근거가 없는 항목 ${w.count}개가 있습니다(${w.ids.slice(0, 5).join(', ')}${w.ids.length > 5 ? ' …' : ''}).`;
  if (w.code === 'W-SAME-NAME') return `이름·단위가 같은 「${w.name}」(${w.level}) 업무 지도가 이미 있습니다. 같은 문서를 다시 가져오는 것이면 위에서 이름을 바꾸거나 취소하세요. 가져오면 따로 하나 더 생깁니다.`;
  if (w.code === 'W-MISSING-CHILD') return `이 업무 지도가 묶는 하위 업무 지도가 이 브라우저에 없습니다(${w.ids.join(', ')}). 가져와도 그 부분은 비어 보입니다.`;
  return messageFor(w);
}

function errorText(e) {
  if (e.path === 'universe.owner') return '작성 주체를 입력하세요.';
  if (e.path === 'universe.name') return '이름을 입력하세요(1~100자).';
  if (e.bad_id) return `${e.path} — ID에 '/'나 공백을 쓸 수 없습니다.`;
  if (e.code === 'E-CYCLE') return `${e.path} — 묶은 업무 지도를 따라가면 이 업무 지도로 다시 돌아옵니다(순환). 가져올 수 없습니다.`;
  return `${e.path} — ${messageFor({ ...e, field: e.path.split('.').pop().replace(/\[\d+\]$/, '') })}`;
}

function parseErrorText(err) {
  if (err.reason === 'empty') return '가져올 내용이 비어 있습니다.';
  if (err.reason === 'too_big') return `파일이 너무 큽니다(${err.max.toLocaleString()}자 이하).`;
  if (err.reason === 'json') return 'JSON 형식이 아닙니다. 파일이 깨졌거나 다른 형식입니다. 가져오지 않았습니다.';
  if (err.reason === 'shape') return '업무 지도 문서 형식이 아닙니다. 가져오지 않았습니다.';
  if (err.field === 'document' && err.too_long) return `문서가 너무 깁니다(${err.too_long.toLocaleString()}자 이하).`;
  if (err.field === 'document') return '변환할 문서를 붙여 넣거나 파일을 여세요.';
  return messageFor(err);
}

/**
 * @param {{dialog:HTMLDialogElement, app:object, convert:(text:string)=>object, methodLabel:()=>string, example:{title:string, text:string}, onImported:(id:string)=>void, onExport?:(()=>void)|null}} o
 *   onExport: 지금 연 유니버스를 내려받는 함수. 시작 화면처럼 연 유니버스가 없으면 null(내보내기 탭을 숨긴다)
 * @returns {() => void} 여는 함수
 */
export function importDialog(o) {
  // aiRun: 「AI로 변환」 요청 번호. 창을 닫거나 글을 바꾸거나 탭을 옮기면 올려서, 늦게 온 응답을 버린다
  const st = { tab: 'doc', docText: '', jsonText: '', jsonFile: '', result: null, message: '', aiRun: 0, aiBusy: false };
  let aiLive = null; // 지금 그려진 「AI가 읽는 중」 안내 칸
  const cancelAi = () => { st.aiRun += 1; st.aiBusy = false; };

  const followWork = () => !!CONVERT_RULES.cr17j.previewRenameWork; // 지도 이름을 고치면 업무가 하나뿐인 문서의 대표 업무 이름도 따라 바꿀지(CR-17 J ⑨, 승인안은 켬)
  const setUniverse = (field, value) => {
    const d = st.result.doc;
    // 이름을 처음 고칠 때, 문서 제목으로 만든 대표 업무의 이름(제목에서 접두어를 뗀 것)을 기억해 둔다. 이름을 비웠다가 다시 써도 따라가게
    // CR-17 J 스위치 previewRenameWork(승인안은 켬): 12.9.1 미리 보기에서 확인하는 것은 지도 이름·작성 주체뿐이므로, 꺼져 있으면 업무 이름은 건드리지 않는다(R12-7)
    if (field === 'name' && followWork() && st.result.titleWork === undefined) st.result.titleWork = docWorkLabel(d.universe.name);
    d.universe[field] = value;
    if (field === 'name') {
      const root = d.nodes.find((n) => n.id === d.universe.root_node_id);
      if (root) root.label = value;
      // 문서 제목으로 만든 대표 업무(이름이 제목에서 「업무정의서:」 같은 접두어를 뗀 것과 같은 업무)도 같이 바꾼다. 업무가 하나뿐일 때만(스위치가 켜졌을 때만)
      const works = d.nodes.filter((n) => n.core_type === 'work');
      const newWork = followWork() && value.trim() ? docWorkLabel(value) : '';
      if (newWork) {
        if (works.length === 1 && works[0].label === st.result.titleWork) works[0].label = newWork;
        st.result.titleWork = newWork;
      }
    }
    renderPreview();
  };

  async function readFile(input, key) {
    const f = input.files && input.files[0];
    if (!f) return;
    cancelAi();
    // PDF·한글·워드는 글자로 읽을 수 없다(읽으면 깨진 글이 들어간다): 읽지 않고 붙여 넣기를 안내
    if (key === 'docText' && BINARY_DOC.test(f.name)) {
      st.result = null;
      st.message = `「${f.name}」은 PDF·한글·워드 같은 파일이라 바로 읽을 수 없습니다. 파일을 열어 글을 복사한 뒤 위 칸에 붙여 넣어 주세요.`;
      input.value = '';
      render();
      return;
    }
    if (fileTooBig(f.size)) {
      st.result = null;
      st.message = `파일이 너무 큽니다(${Math.round(f.size / 1048576).toLocaleString()}MB). 읽지 않았습니다 — 글 ${IMPORT_MAX_CHARS.toLocaleString()}자 이하의 파일만 가져올 수 있습니다.`;
      render();
      return;
    }
    try {
      st[key] = await f.text();
      st.result = null; // 새 파일을 고르면 이전 미리 보기를 지운다(다른 파일이 가져와지지 않게)
      st.message = '';
    } catch {
      st.message = '파일을 읽지 못했습니다.';
      render();
      return;
    }
    if (key === 'jsonText') {
      // FU9-7: JSON 파일은 고르는 즉시 미리 본다(「확인」을 또 누르지 않게). 파일 고르기 칸은 다시 그리지 않아 고른 파일 이름이 그대로 보인다
      st.jsonFile = f.name;
      const ta = o.dialog.querySelector('#import-json');
      if (ta) ta.value = st.jsonText;
      const nameEl = o.dialog.querySelector('[data-testid=import-json-name]');
      if (nameEl) nameEl.textContent = `고른 파일: ${f.name}`;
      runJson(true);
      return;
    }
    render();
  }

  // 「AI로 변환」을 쓸 수 있는가: 키가 있어 실시간 공급자가 만들어졌을 때만 변환 결과에 ai 손잡이({model, run})가 붙는다(llm/connector.convertDocumentWith).
  // 빈 글로 한 번 물어 손잡이만 얻는다(규칙 변환이 바로 끝나는 빈 입력이라 비용이 없고, 화면 상태를 바꾸지 않는다). 키가 없으면 null → 단추가 없다
  function aiOf() {
    try {
      const r = o.convert('');
      return r && r.ai && typeof r.ai.run === 'function' ? r.ai : null;
    } catch {
      return null;
    }
  }

  const setAiLive = (text) => { if (aiLive) aiLive.textContent = text; };

  async function runAiConvert() {
    const ai = aiOf();
    if (!ai || st.aiBusy) return;
    st.docText = o.dialog.querySelector('#import-doc').value;
    const text = st.docText;
    const run = (st.aiRun += 1);
    st.aiBusy = true;
    st.message = '';
    const btn = o.dialog.querySelector('[data-testid=btn-ai-convert]');
    if (btn) btn.disabled = true;
    setAiLive(AI_CONVERT_WAIT);
    let r;
    try {
      r = await ai.run(text);
    } catch {
      r = null;
    }
    if (run !== st.aiRun || !o.dialog.open) return; // 그 사이 창을 닫았거나 글·탭을 바꿨다: 응답을 버린다
    st.aiBusy = false;
    if (r && r.ok) {
      st.result = { from: 'doc', doc: r.doc, report: r.report, method: r.method, model: r.model, fallback: null, note: null, ai: { model: r.model, dropped: r.dropped || [], cached: !!r.cached } };
      st.message = '';
    } else {
      // 실패하면 규칙 변환 결과를 대신 보여 준다(R-04 ③). 규칙 변환도 못 하는 글(비었음·너무 김)이면 그 안내만
      const reason = r && r.fallback ? r.fallback.reason : '알 수 없는 오류';
      const rule = o.convert(text);
      if (!rule.ok) {
        st.result = null;
        st.message = `AI 변환 실패: ${reason}. ${parseErrorText(rule.error)}`;
      } else {
        st.result = { from: 'doc', doc: rule.doc, report: rule.report, method: rule.method, fallback: { code: 'W-LLM-FALLBACK', reason: `AI 변환 실패: ${reason} — 규칙 변환 결과를 보여 줍니다` }, note: rule.note };
        st.message = '';
      }
    }
    render();
    if (st.result && typeof head.scrollIntoView === 'function') head.scrollIntoView({ block: 'start' });
  }

  function runConvert() {
    cancelAi();
    st.docText = o.dialog.querySelector('#import-doc').value;
    const r = o.convert(st.docText);
    if (!r.ok) {
      st.result = null;
      st.message = parseErrorText(r.error);
    } else {
      st.result = { from: 'doc', doc: r.doc, report: r.report, method: r.method, fallback: r.fallback, note: r.note };
      st.message = '';
    }
    render();
    // 작은 화면에서는 미리 보기가 창 아래에 생겨 아무 일도 없는 것처럼 보인다(화면 점검 S-8)
    if (st.result && typeof head.scrollIntoView === 'function') head.scrollIntoView({ block: 'start' }); // 작성 주체(필수) 칸이 보이도록 head부터(재검증)
  }

  function runJson(keepDom = false) {
    cancelAi();
    st.jsonText = o.dialog.querySelector('#import-json').value;
    const r = parseImportText(st.jsonText);
    if (!r.ok) {
      st.result = null;
      st.message = parseErrorText(r.error);
    } else {
      st.result = { from: 'json', doc: r.doc };
      st.message = '';
    }
    if (keepDom === true) {
      const msg = o.dialog.querySelector('[data-testid=import-message]');
      if (msg) msg.textContent = st.message;
      renderHead();
      renderPreview();
      return;
    }
    render();
  }

  function doImport(preview) {
    if (preview.same_name && !window.confirm(`이름·단위가 같은 「${preview.same_name.name}」 업무 지도가 이미 있습니다. 그래도 하나 더 가져올까요?`)) return;
    if (preview.conflict && !window.confirm(`같은 ID(${preview.conflict.id})의 「${preview.conflict.name}」 업무 지도가 이미 있습니다. 덮어쓸까요? 덮어쓰면 그 업무 지도에 고친 내용은 사라집니다.`)) return;
    const r = o.app.importUniverse(st.result.doc, { overwrite: !!preview.conflict });
    if (!r.ok) {
      st.message = r.error.code === 'E-DUP' ? '같은 ID의 업무 지도가 있어 가져오지 않았습니다.' : messageFor(r.error);
      return render();
    }
    o.dialog.close();
    o.onImported(r.doc.universe.id);
  }

  // 미리 보기의 머리(제목·방식·이름 칸)는 결과가 바뀔 때만 그린다. 이름 칸에 입력할 때마다 다시 그리면 입력 중인 칸을 잃는다
  const head = el('div', {});
  const slot = el('div', { 'data-testid': 'import-preview' });

  function renderHead() {
    if (!st.result) return head.replaceChildren();
    const { doc, report, from } = st.result;
    const u = doc.universe || {};
    const blocks = [el('h3', {}, '미리 보기')];
    if (from === 'doc' && looksNotDefinition(report)) blocks.push(el('p', { class: 'notice', 'data-testid': 'import-not-definition' }, NOT_A_DEFINITION_NOTICE));
    if (from === 'doc') {
      const ai = st.result.ai;
      if (ai) {
        blocks.push(el('p', { class: 'muted small', 'data-testid': 'import-method' },
          el('span', { class: 'chip', 'data-testid': 'import-ai-chip', title: 'Claude API가 문서를 읽어 만든 밑그림입니다. 앱이 항목마다 원문 인용이 원문에 있는지 확인했습니다' }, `AI 변환 · ${ai.model}`),
          ' 만든 방식: Claude API(실시간) 밑그림. 원문 인용이 확인된 항목만 담았지만 AI가 읽은 것이라 사람이 확인해야 합니다.'));
        blocks.push(ai.dropped.length
          ? el('details', { class: 'ai-dropped', 'data-testid': 'import-ai-dropped' },
            el('summary', {}, `원문 인용이 확인되지 않아 뺀 항목 ${ai.dropped.length}개`),
            el('ul', {}, ...ai.dropped.slice(0, 30).map((d) => el('li', { class: 'small' }, `${AI_KIND_LABEL[d.kind] || d.kind} 「${d.label}」 — ${d.reason}`)), ai.dropped.length > 30 ? el('li', { class: 'small' }, `외 ${ai.dropped.length - 30}개`) : null))
          : el('p', { class: 'muted small', 'data-testid': 'import-ai-dropped' }, '원문 인용이 확인되지 않아 뺀 항목 0개'));
      } else {
        blocks.push(el('p', { class: 'muted small', 'data-testid': 'import-method' }, `만든 방식: ${METHOD_LABELS[st.result.method] || st.result.method} 밑그림(규칙 ${report ? report.rules_version : '-'}). 원문 구조를 규칙으로 옮긴 것이라 사람이 확인해야 합니다.`));
      }
      // 키가 없어 규칙 변환을 쓴 것은 고장이 아니므로 노란 띠가 아니라 조용한 한 줄(초안·인사이트와 같은 처리, 처음 사용 점검 FU-41)
      if (st.result.fallback) blocks.push(el('p', { class: st.result.fallback.keyless ? 'muted small' : 'notice', 'data-testid': 'import-fallback', ...(st.result.fallback.keyless ? { 'data-keyless': 'true' } : {}) }, st.result.fallback.reason));
      if (st.result.note) blocks.push(el('p', { class: 'muted small', 'data-testid': 'import-note' }, st.result.note));
      blocks.push(el('div', { class: 'import-fields' },
        el('label', { class: 'field' }, el('span', {}, '이름'), el('input', { id: 'import-name', value: u.name || '', maxlength: '100', oninput: (e) => setUniverse('name', e.target.value) })),
        el('label', { class: 'field' }, el('span', {}, '작성 주체(필수)'), el('input', { id: 'import-owner', value: u.owner || '', placeholder: '예: 가상 시스템분석팀', oninput: (e) => setUniverse('owner', e.target.value) })),
      ));
      // 스위치가 켜졌고 따라갈 업무(문서 제목으로 만든 업무 하나)가 있을 때만 한 줄 안내
      const onlyWork = doc.nodes.filter((n) => n.core_type === 'work');
      if (followWork() && onlyWork.length === 1 && onlyWork[0].label === (st.result.titleWork !== undefined ? st.result.titleWork : docWorkLabel(u.name || ''))) {
        blocks.push(el('p', { class: 'muted small', 'data-testid': 'import-rename-work' }, '업무 이름도 함께 바뀝니다.'));
      }
    } else {
      const dl = el('dl', {});
      for (const [k, v] of [['이름', u.name], ['단위', u.level], ['작성 주체', u.owner], ['ID', u.id]]) dl.append(el('dt', {}, k), el('dd', {}, v || '—'));
      blocks.push(dl);
    }
    head.replaceChildren(...blocks);
  }

  function renderPreview() {
    if (!st.result) return slot.replaceChildren();
    const { doc, report } = st.result;
    const p = o.app.previewImport(doc);
    const blocks = [];

    if (p.version_mismatch) {
      blocks.push(el('p', { class: 'error-text', 'data-testid': 'import-errors' }, `형식 버전이 다릅니다(파일: ${doc.schema_version ?? '없음'}, 이 앱: ${SCHEMA_VERSION}). 가져오지 않았습니다.`));
    } else {
      const summary = el('dl', { 'data-testid': 'import-summary' },
        el('dt', {}, '규모'), el('dd', {}, `항목 ${p.node_total}개(${p.counts.map((c) => `${c.label} ${c.count}`).join(', ')}), 연결 ${p.edge_total}개, 메모 ${p.memo_total}건`));
      if (report && report.target) {
        const { min, max } = report.target;
        // 노드가 적어도 업무 하나를 적은 문서면 정상이다: 실패처럼 읽히지 않게 한마디 붙인다
        const oneWork = (doc.nodes || []).filter((n) => n && n.core_type === 'work' && !n.hidden).length <= 1;
        const fit = report.node_count > max ? '많음' : report.node_count < min ? (oneWork ? '적음 — 업무 하나짜리 문서라면 정상' : '적음') : '맞음';
        summary.append(el('dt', {}, '항목 수 기준'), el('dd', { 'data-testid': 'import-granularity' }, `월말 정산 수준(항목 ${min}~${max}개) — ${fit}`));
      }
      if (p.source) summary.append(el('dt', {}, '원문 위치가 적힌 항목'), el('dd', { 'data-testid': 'import-source' }, `항목 ${p.source.with}/${p.source.total}개`));
      if (st.result.from === 'doc') summary.append(el('dt', {}, '[미확인]·[가정] 표시'), el('dd', { 'data-testid': 'import-marks' }, `[미확인] 항목 ${p.marks.미확인}개, [가정] 항목 ${p.marks.가정}개`)); // JSON 파일은 문서 변환용 표시가 없다(FU9-11)
      blocks.push(summary);

      // 작성 주체만 비어 있는 것은 실패가 아니라 "입력할 차례"다: 빨간 오류 대신 안내로 둔다(여섯 번째 검토 U-6). 가져오기 버튼은 그대로 막힌다
      if (st.result.from === 'doc' && p.errors.length && p.errors.every((e) => e.path === 'universe.owner')) {
        blocks.push(el('p', { class: 'notice', 'data-testid': 'import-errors' }, '변환은 끝났습니다. 위의 「작성 주체」 칸에 이 업무 지도를 책임질 팀·부서 이름을 넣으면 「새 업무 지도 만들기」를 누를 수 있습니다.'));
      } else if (p.errors.length) {
        blocks.push(el('div', { class: 'error-text', 'data-testid': 'import-errors' },
          el('strong', {}, `가져올 수 없습니다 — 고칠 것 ${p.errors.length}건`),
          el('ul', {}, ...p.errors.slice(0, 8).map((e) => el('li', {}, errorText(e)))),
          p.errors.length > 8 ? el('p', {}, `외 ${p.errors.length - 8}건`) : null));
      }
      if (p.conflict) blocks.push(el('p', { class: 'notice', 'data-testid': 'import-conflict' }, `같은 ID의 「${p.conflict.name}」 업무 지도가 이미 있습니다. 가져오면 덮어쓸지 묻습니다.`));

      const noEmp = p.warnings.filter((w) => w.code === 'W-NO-EMPNO').length;
      const notes = [
        ...(report ? report.notes.filter((n) => n.code !== 'C-AI-MODEL' && n.code !== 'C-AI-DROPPED').map(noteText) : []),
        ...(noEmp && st.result.from === 'doc' ? [`사번 없는 사람 ${noEmp}명 — 원문에 사번이 없어 비워 두었습니다. 통합할 때 확인 목록에 오르고, 가져온 뒤 입력할 수 있습니다.`] : []),
        ...p.warnings.filter((w) => w.code !== 'W-NO-EMPNO').map((w) => warningText(w, st.result.from)),
      ];
      if (notes.length) blocks.push(el('ul', { class: 'import-notes', 'data-testid': 'import-notes' }, ...notes.map((t) => el('li', {}, t))));
      // 표준 양식 점검(R-16): 권장 항목이 빈 업무 수. 가져오기를 막지 않는다
      const fr = o.app.formReport(doc);
      if (fr.total) {
        blocks.push(el('details', { class: 'form-check', 'data-testid': 'import-form', open: false },
          el('summary', {}, fr.incomplete ? `표준 양식: 업무 ${fr.total}개 중 ${fr.incomplete}개에 권장 항목이 비어 있음(가져오기는 됩니다)` : `표준 양식: 업무 ${fr.total}개 모두 권장 항목을 채웠습니다`),
          fr.incomplete ? el('ul', {}, ...fr.works.slice(0, 15).map((w) => el('li', { class: 'small' }, `${w.label}: ${w.missing.join(', ')}`)), fr.works.length > 15 ? el('li', { class: 'small' }, `외 ${fr.works.length - 15}개`) : null) : null));
      }

      if (report && report.sections.length) {
        blocks.push(el('h4', {}, '원문의 절 → 업무 지도'));
        blocks.push(el('table', { class: 'dg-table import-sections', 'data-testid': 'import-sections' },
          el('thead', {}, el('tr', {}, el('th', {}, '원문'), el('th', {}, '제목'), el('th', {}, '바뀐 것'))),
          el('tbody', {}, ...report.sections.map((s) => el('tr', {},
            el('td', {}, s.ref), el('td', {}, s.title), el('td', {}, s.merged ? `같은 이름의 주제 「${s.merged}」에 합침` : (KIND_TEXT[s.kind] || (() => s.kind))(s.made) + (s.unknown ? ' · 규칙 밖' : '')))))));
      }

      blocks.push(el('h4', {}, '항목'));
      const nodes = (doc.nodes || []).filter((n) => n && !n.hidden);
      const groups = new Map();
      for (const n of nodes) {
        if (!groups.has(n.core_type)) groups.set(n.core_type, []);
        groups.get(n.core_type).push(n);
      }
      const list = el('div', { class: 'import-nodes', 'data-testid': 'import-nodes' });
      for (const [type, ns] of groups) {
        list.append(el('details', { open: ns.length <= 8 },
          el('summary', {}, `${nodeTypeLabel(type)} ${ns.length}`),
          el('ul', {}, ...ns.map((n) => {
            const a = n.attrs || {};
            return el('li', {},
              el('strong', {}, n.label),
              a.상태 ? el('span', { class: 'chip mark' }, a.상태) : null,
              a.원문 ? el('span', { class: 'muted small' }, ` 원문 ${a.원문}`) : null,
              n.description ? el('div', { class: 'muted small clamp' }, n.description) : null,
              a.절차 ? el('div', { class: 'small' }, `절차: ${a.절차}`) : null);
          }))));
      }
      blocks.push(list);
      const memos = (doc.events || []).filter((e) => e && e.type === 'memo');
      if (memos.length) {
        // 문서 변환은 질문·리스크 메모만 만든다. JSON 파일은 실제 분류 이름으로 센다(FU9-11)
        const cats = new Map();
        for (const m of memos) cats.set(memoCategoryOf(m.payload), (cats.get(memoCategoryOf(m.payload)) || 0) + 1);
        const catText = [...cats].map(([c, n]) => `${MEMO_CATEGORIES[c] || c} ${n}`).join('·');
        blocks.push(el('details', {}, el('summary', {}, st.result.from === 'json' ? `메모 ${memos.length}건(${catText})` : `메모 ${memos.length}건(질문·리스크)`),
          el('ul', { class: 'import-memos' }, ...memos.map((m) => el('li', { class: 'small' }, m.note || '')))));
      }
    }

    const can = p.ok && !o.app.readOnly;
    // 문서는 새 업무 지도를 만든다(지금 지도에 더하지 않는다) — 단추 이름이 그 결과를 말한다(조력자 의견 2026-10-28: "업로드 버튼 같은게 안보여융").
    // 단추 줄은 창 아래에 붙어 있어 긴 미리 보기를 내리지 않아도 보이고, 막혔으면 이유를 단추 옆에 적는다
    const fromDoc = st.result.from === 'doc';
    const ownerOnly = fromDoc && p.errors.length && p.errors.every((e) => e.path === 'universe.owner');
    blocks.push(el('div', { class: 'row import-actions decide-row', 'data-testid': 'import-actions' },
      can ? el('span', { class: 'decide-q', 'data-testid': 'import-confirm-q' }, fromDoc ? '이 내용으로 새 업무 지도를 만들까요?' : '이 내용으로 업무 지도를 가져올까요?') : null,
      el('button', { type: 'button', class: 'primary', 'data-testid': 'import-confirm', disabled: !can, onclick: () => doImport(p) }, fromDoc ? '새 업무 지도 만들기' : '가져오기'),
      !can && ownerOnly && !o.app.readOnly ? el('button', { type: 'button', class: 'link', 'data-testid': 'import-why', onclick: () => { const f = o.dialog.querySelector('#import-owner'); if (f) { f.scrollIntoView({ block: 'center' }); f.focus(); } } }, '위의 「작성 주체」 칸을 채우면 누를 수 있습니다') : null,
      !can && !ownerOnly && !o.app.readOnly && !p.version_mismatch && p.errors.length ? el('span', { class: 'muted small', 'data-testid': 'import-why' }, `고칠 것 ${p.errors.length}건이 있어 아직 누를 수 없습니다(위 목록)`) : null,
      o.app.readOnly ? el('span', { class: 'muted small' }, '읽기 전용이라 가져올 수 없습니다.') : null));
    slot.replaceChildren(...blocks);
  }

  // 입력칸 값은 변환·확인을 눌러야 저장되므로, 탭을 바꾸기 전에 옮겨 둔다(바꿨다 돌아와도 남게)
  function keepInputs() {
    const d = o.dialog.querySelector('#import-doc');
    const j = o.dialog.querySelector('#import-json');
    if (d) st.docText = d.value;
    if (j) st.jsonText = j.value;
  }

  // 글을 고치면 기다리던 AI 응답은 버린다(다른 글에 대한 결과가 미리 보기에 뜨지 않게)
  function onDocInput() {
    if (!st.aiBusy) return;
    cancelAi();
    setAiLive('');
    const btn = o.dialog.querySelector('[data-testid=btn-ai-convert]');
    if (btn) btn.disabled = false;
  }

  function render() {
    const tab = (key, label) => el('button', { type: 'button', class: `tab${st.tab === key ? ' active' : ''}`, 'data-testid': `import-tab-${key}`, onclick: () => { cancelAi(); keepInputs(); st.tab = key; st.result = null; st.message = ''; render(); } }, label);
    const u = o.app.doc.universe;
    const exportBody = () => el('div', { class: 'editor' },
      el('p', { class: 'muted small' }, '지금 연 업무 지도를 JSON 파일로 내려받습니다. 다른 PC에서 「JSON 파일」 탭으로 열면 그대로 이어서 쓸 수 있습니다. 브라우저 저장은 이 PC에만 남으므로, 큰 수정을 한 뒤나 다른 PC로 옮기기 전에 내려받아 두면 안전합니다.'),
      el('dl', {}, el('dt', {}, '업무 지도'), el('dd', { 'data-testid': 'export-name' }, `${u.name} (${u.level})`), el('dt', {}, '파일 이름'), el('dd', {}, exportFileName(u))),
      el('div', { class: 'row' }, el('button', { type: 'button', class: 'primary', 'data-testid': 'export-download', onclick: () => o.onExport() }, 'JSON 파일로 내려받기'),
        o.onExportHtml ? el('button', { type: 'button', 'data-testid': 'export-html', onclick: (e) => o.onExportHtml(e.currentTarget) }, 'HTML 파일로 내려받기(내용 포함)') : null),
      o.onExportHtml ? el('p', { class: 'muted small', 'data-testid': 'export-html-note' }, '받는 사람은 이 파일 하나를 더블클릭하면 이 업무 지도를 바로 볼 수 있습니다. 내용이 파일에 들어 있으니 보낼 사람에게만 주세요.') : null);
    // 키가 있을 때만 「AI로 변환」(단추와 안내 칸). 키가 없으면 둘 다 만들지 않아 화면이 지금과 같다
    const aiBtn = st.tab === 'doc' && aiOf() ? el('button', { type: 'button', 'data-testid': 'btn-ai-convert', disabled: st.aiBusy, title: 'Claude API로 문서를 읽어 업무가 여러 개인 문서도 나눕니다. 키가 있을 때만 보입니다', onclick: runAiConvert }, 'AI로 변환') : null;
    aiLive = aiBtn ? el('p', { class: 'muted small', 'data-testid': 'ai-convert-live', 'aria-live': 'polite' }, st.aiBusy ? AI_CONVERT_WAIT : '') : null;
    const body = st.tab === 'folder' ? folderTab(o, render) : st.tab === 'export' ? exportBody() : st.tab === 'doc'
      ? el('div', { class: 'editor' },
        el('p', { class: 'muted small' }, '업무정의서 같은 문서를 붙여 넣으면 제목(#)·표·번호 목록을 규칙으로 읽어 업무 지도 밑그림을 만듭니다. 업무 흐름은 업무의 「절차」 칸으로, 요건·예외 같은 절은 주제 하나로 묶어 항목을 10~20개 정도로 만듭니다(월말 정산 수준).'),
        el('p', { class: 'muted small', 'data-testid': 'import-plain-note' }, '한글·워드에서 복사한 일반 글(1. 개요 / 가. …)도 됩니다. PDF·한글·워드 파일은 바로 열리지 않으니 글을 복사해 붙여 넣으세요.'),
        el('p', { class: 'notice small', 'data-testid': 'import-new-map-note' }, '문서 하나로 새 업무 지도를 하나 만듭니다. 지금 연 지도에 더하는 것이 아닙니다.'),
        el('textarea', { id: 'import-doc', rows: '9', 'aria-label': '문서 원문', placeholder: '# 업무 이름\n## 1. 개요\n| 항목 | 내용 |\n…', oninput: onDocInput }, st.docText),
        el('div', { class: 'row' },
          el('label', { class: 'file-pick' }, '파일 열기(.md, .txt) ', el('input', { type: 'file', accept: '.md,.txt,.markdown,text/plain,text/markdown,.pdf,.hwp,.hwpx,.doc,.docx' /* PDF·한글·워드도 고를 수는 있게(고르면 붙여 넣기 안내) */, 'data-testid': 'import-doc-file', onchange: (e) => readFile(e.target, 'docText') })),
          el('button', { type: 'button', 'data-testid': 'import-example', onclick: () => { cancelAi(); st.docText = o.example.text; st.result = null; st.message = ''; render(); } }, `예시 문서 넣기: ${o.example.title}`)),
        el('div', { class: 'row' },
          el('button', { type: 'button', class: 'primary', 'data-testid': 'import-convert', onclick: runConvert }, '읽어 보기'),
          aiBtn,
          el('span', { class: 'muted small', 'data-testid': 'import-method-note' }, aiBtn ? '「읽어 보기」는 규칙으로, 「AI로 변환」은 Claude가 읽습니다(원문 인용이 확인된 항목만 담음). 결과는 미리 보기에서 사람이 확인합니다.' : '문서 변환은 규칙으로 읽습니다. 결과는 미리 보기에서 사람이 확인합니다.')),
        aiBtn ? aiLive : null)
      : el('div', { class: 'editor' },
        el('p', { class: 'muted small' }, '「내보내기」로 저장한 업무 지도 파일(.json)을 엽니다. 파일을 고르면 바로 미리 보기가 열립니다.'),
        el('label', { class: 'file-pick' }, 'JSON 파일 열기 ', el('input', { type: 'file', accept: '.json,application/json', 'data-testid': 'import-json-file', onchange: (e) => readFile(e.target, 'jsonText') })),
        el('p', { class: 'muted small', 'data-testid': 'import-json-name' }, st.jsonFile ? `고른 파일: ${st.jsonFile}` : ''),
        el('textarea', { id: 'import-json', rows: '6', 'aria-label': 'JSON 내용', placeholder: '또는 JSON 내용을 붙여 넣으세요' }, st.jsonText),
        el('div', { class: 'row' }, el('button', { type: 'button', class: 'primary', 'data-testid': 'import-check', onclick: runJson }, '확인')));

    o.dialog.replaceChildren(
      el('div', { class: 'import-head' },
        el('h2', { id: 'import-title' }, o.onExport ? '가져오기·내보내기' : '가져오기'),
        el('button', { type: 'button', 'data-testid': 'import-close', onclick: () => o.dialog.close() }, '닫기')),
      ...(st.tab === 'doc' ? [el('p', { class: 'muted small', 'data-testid': 'import-json-hint' }, '내보내기로 받아 둔 .json 파일은 「JSON 파일」 탭에서 엽니다.')] : []), // FU9-10 (replaceChildren은 null을 글자로 넣는다)
      el('div', { class: 'tabs' }, tab('doc', '문서 붙여넣기(읽어 보기)'), tab('json', 'JSON 파일'), o.onExport ? tab('export', '내보내기') : null, o.folder && o.onExport ? tab('folder', '폴더 연결') : null),
      body,
      el('p', { class: 'error-text', 'data-testid': 'import-message', 'aria-live': 'polite' }, st.message),
      head,
      slot,
      // 「고급」 안에 접어 둔다(FU-25, 처음 사용 점검 2026-10-24): 처음 보는 사람이 위험한 단추를 바로 보지 않게. 기능은 펼치면 그대로
      o.onReset ? el('details', { class: 'danger-zone', 'data-testid': 'import-advanced' },
        el('summary', {}, '고급'),
        el('h4', {}, '위험 구역'),
        el('p', { class: 'muted small' }, '모든 업무 지도를 처음 샘플 상태로 되돌립니다. 직접 만들거나 가져온 업무 지도도 지워지므로 먼저 위에서 내보내 두세요. 누르면 한 번 더 확인합니다.'),
        el('button', { type: 'button', id: 'reset', class: 'danger', 'data-testid': 'reset-all', disabled: !o.app.canReset, onclick: () => o.onReset() }, '가상 데이터 초기화')) : null,
    );
    renderHead();
    renderPreview();
  }

  o.dialog.addEventListener('close', cancelAi); // 창을 닫으면 기다리던 AI 응답은 버린다

  if (o.folder) o.folder.subscribe(() => { if (o.dialog.open && st.tab === 'folder') render(); });

  return () => {
    cancelAi();
    if ((st.tab === 'export' || st.tab === 'folder') && !o.onExport) st.tab = 'doc';
    st.result = null;
    st.message = '';
    render();
    o.dialog.showModal();
  };
}

/** 내보내기 파일 이름: 이름-ID.json(파일 이름에 못 쓰는 글자는 _). 내용 포함 HTML은 확장자만 .html(view/embed.js embedFileName) */
export function exportFileName(universe) {
  return `${String(universe.name).replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60)}-${universe.id}.json`;
}
