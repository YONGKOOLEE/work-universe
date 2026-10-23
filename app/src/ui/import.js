// 가져오기 화면(T-17): 문서 붙여넣기 → 규칙 기반 초벌 변환(CR-5 ②) 또는 JSON 파일 → 미리 보기 → 사람이 「가져오기」(CR-3 AC ③).
// 미리 보기에서 검증 오류가 있으면 가져올 수 없다(AC ①). 원문 근거와 [가정]·[미확인] 표시를 보여 준다(AC ②④).

import { el } from './dom.js';
import { josa, messageFor } from './messages.js';
import { SCHEMA_VERSION, nodeTypeLabel } from '../model/schema.js';
import { parseImportText } from '../model/import.js';
import { METHOD_LABELS } from '../llm/connector.js';
import { folderTab } from './folder-tab.js';

const KIND_TEXT = {
  overview: () => '개요 → 유니버스의 중심 노드(꼭지)의 이름·목적·배경, 그리고 범위·이해관계자',
  scope: (n) => `범위 → 업무 ${n}개`,
  scope_out: () => '범위 제외 → 유니버스 설명',
  steps: (n) => `업무 흐름 → 대표 업무의 절차 속성 ${n}단계(노드로 만들지 않음)`,
  topic: () => '주제 노드 1개(항목은 설명에)',
  people: (n) => `역할 ${n}개`,
  cautions: (n) => `주의사항 → 대표 업무의 주의사항 속성 ${n}줄`,
  artifacts: (n) => `산출물 ${n}개`,
  memos: (n) => `메모 ${n}건`,
  toc: () => '목차 → 건너뜀(노드로 만들지 않음)',
  outline: () => '아래 절 제목의 목록 → 건너뜀(아래 절에서 만듦)',
};

function noteText(n) {
  switch (n.code) {
    case 'C-NO-OWNER': return '원문에 작성 주체가 없습니다. 위 「작성 주체」 칸에 입력해야 가져올 수 있습니다.';
    case 'C-DATE-ASSUMED': return `원문에 작성일이 없어 메모(질문·리스크) 날짜를 변환한 날(${n.date})로 적었습니다.`;
    case 'C-TOPIC-GUESS': return `규칙에 없는 제목의 절 ${n.count}개를 주제로 만들었습니다(표에 「규칙 밖」 표시). 맞는지 확인하세요.`;
    case 'C-TOO-MANY': return `노드가 ${n.count}개로, 정한 세분화(월말 정산 수준, ${n.max}개 이하)보다 많습니다. 범위 항목을 묶을 수 있는지 확인하세요.`;
    case 'C-TOO-FEW': return `노드가 ${n.count}개로 적습니다(${n.min}개 이상 목표). 원문에 제목(#)·표·번호 목록이 있는지 확인하세요.`;
    case 'C-PERFORMS-GUESS': return `담당(수행) 연결 ${n.count}건을 추정했습니다 — 원문의 역할 「하는 일」 항목이 업무 이름과 같은 경우만이고(결재·검토처럼 이름이 일부만 들어간 항목은 잇지 않음), 기간이 없어 '지금 담당'으로 계산됩니다. 맞는지 확인하세요.`;
    case 'C-ROW-NO-NAME': return `${n.ref} 표의 ${n.row}번째 행은 이름 칸이 비어 있어 건너뛰었습니다. 원문을 확인하세요.`;
    case 'C-NO-NAME': return `${n.ref}의 「${n.text}」는 이름이 없어(표시·번호·괄호뿐) 노드로 만들지 않았습니다. 원문을 확인하세요.`;
    case 'C-TABLE-NAME-COL': return `${n.ref} 표에서 ${n.col}번째 칸을 업무 이름으로 썼습니다(첫 칸은 구분·순서로 보임). 이름이 엉뚱하면 표 머리글을 「업무」로 바꿔 다시 변환하세요.`;
    case 'C-NO-SCOPE': return '원문에서 범위(업무 목록)를 찾지 못해 문서 이름으로 업무 하나를 만들었습니다.';
    case 'C-NO-STRUCTURE': return '제목(#)이 없어 구조를 거의 읽지 못했습니다. 마크다운 제목·표·번호 목록이 있으면 더 잘 바뀝니다.';
    case 'C-TRUNCATED': return `「${n.where}」 글이 너무 길어 ${n.max}자에서 잘랐습니다.`;
    case 'C-UNUSED': return `개요 표에서 쓰지 못한 칸이 있습니다(${n.refs.join(', ')}). 원문을 함께 보세요.`;
    case 'C-PEOPLE-PROSE': return `${n.ref}의 문장 ${n.count}줄은 사람 이름이 아니라서 역할로 만들지 않고 그 절의 주제 설명에 넣었습니다.`;
    default: return n.code;
  }
}

function warningText(w, from) {
  if (w.code === 'W-SAMPLE-OVERWRITE') return `내장 샘플「${w.name}」${josa(w.name, '을/를')} 덮어씁니다. 이 창 맨 아래 「가상 데이터 초기화」를 누르면 원래 샘플로 돌아갑니다.`;
  if (w.code === 'W-SAMPLE-FLAG') return '파일에 샘플 표시가 있지만 내장 샘플이 아니므로 「내 유니버스」로 가져옵니다.';
  if (w.code === 'W-REAL-NAME-LIKE') return `실명처럼 보이는 사람 이름 ${w.count}개가 있습니다(${w.labels.join(', ')}). 이 도구는 가상 데이터용입니다. 실제 이름이면 가져오기 전에 역할 이름(예: 정산 담당)으로 바꾸세요.`;
  if (w.code === 'W-EMPNO-LIKE') return `사번·주민번호처럼 보이는 숫자(6자리 이상)가 ${w.count}곳에 있습니다. 실제 번호면 지우거나 V-0000 형식의 가상 사번으로 바꾸세요.`;
  if (w.code === 'W-SAME-NAME' && from === 'json') return `이름·단위가 같은 유니버스「${w.name}」(${w.level})가 이미 있습니다. 가져오면 따로 하나 더 생깁니다.`;
  if (w.code === 'W-NO-SOURCE') return `원문 근거가 없는 노드 ${w.count}개가 있습니다(${w.ids.slice(0, 5).join(', ')}${w.ids.length > 5 ? ' …' : ''}).`;
  if (w.code === 'W-SAME-NAME') return `이름·단위가 같은 유니버스「${w.name}」(${w.level})가 이미 있습니다. 같은 문서를 다시 가져오는 것이면 위에서 이름을 바꾸거나 취소하세요. 가져오면 따로 하나 더 생깁니다.`;
  if (w.code === 'W-MISSING-CHILD') return `이 유니버스가 묶는 하위 유니버스가 이 브라우저에 없습니다(${w.ids.join(', ')}). 가져와도 그 부분은 비어 보입니다.`;
  return messageFor(w);
}

function errorText(e) {
  if (e.path === 'universe.owner') return '작성 주체를 입력하세요.';
  if (e.path === 'universe.name') return '이름을 입력하세요(1~100자).';
  if (e.bad_id) return `${e.path} — ID에 '/'나 공백을 쓸 수 없습니다.`;
  if (e.code === 'E-CYCLE') return `${e.path} — 묶은 유니버스를 따라가면 이 유니버스로 다시 돌아옵니다(순환). 가져올 수 없습니다.`;
  return `${e.path} — ${messageFor({ ...e, field: e.path.split('.').pop().replace(/\[\d+\]$/, '') })}`;
}

function parseErrorText(err) {
  if (err.reason === 'empty') return '가져올 내용이 비어 있습니다.';
  if (err.reason === 'too_big') return `파일이 너무 큽니다(${err.max.toLocaleString()}자 이하).`;
  if (err.reason === 'json') return 'JSON 형식이 아닙니다. 파일이 깨졌거나 다른 형식입니다. 가져오지 않았습니다.';
  if (err.reason === 'shape') return '유니버스 문서 형식이 아닙니다. 가져오지 않았습니다.';
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
  const st = { tab: 'doc', docText: '', jsonText: '', result: null, message: '' };

  const setUniverse = (field, value) => {
    const d = st.result.doc;
    d.universe[field] = value;
    if (field === 'name') {
      const root = d.nodes.find((n) => n.id === d.universe.root_node_id);
      if (root) root.label = value;
    }
    renderPreview();
  };

  async function readFile(input, key) {
    const f = input.files && input.files[0];
    if (!f) return;
    try {
      st[key] = await f.text();
      st.result = null; // 새 파일을 고르면 이전 미리 보기를 지운다(다른 파일이 가져와지지 않게)
      st.message = '';
    } catch {
      st.message = '파일을 읽지 못했습니다.';
    }
    render();
  }

  function runConvert() {
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

  function runJson() {
    st.jsonText = o.dialog.querySelector('#import-json').value;
    const r = parseImportText(st.jsonText);
    if (!r.ok) {
      st.result = null;
      st.message = parseErrorText(r.error);
    } else {
      st.result = { from: 'json', doc: r.doc };
      st.message = '';
    }
    render();
  }

  function doImport(preview) {
    if (preview.same_name && !window.confirm(`이름·단위가 같은 유니버스「${preview.same_name.name}」가 이미 있습니다. 그래도 하나 더 가져올까요?`)) return;
    if (preview.conflict && !window.confirm(`같은 ID(${preview.conflict.id})의 유니버스「${preview.conflict.name}」가 이미 있습니다. 덮어쓸까요? 덮어쓰면 그 유니버스에 고친 내용은 사라집니다.`)) return;
    const r = o.app.importUniverse(st.result.doc, { overwrite: !!preview.conflict });
    if (!r.ok) {
      st.message = r.error.code === 'E-DUP' ? '같은 ID의 유니버스가 있어 가져오지 않았습니다.' : messageFor(r.error);
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
    if (from === 'doc') {
      blocks.push(el('p', { class: 'muted small', 'data-testid': 'import-method' }, `만든 방식: ${METHOD_LABELS[st.result.method] || st.result.method} 초벌(규칙 ${report ? report.rules_version : '-'}). 원문 구조를 규칙으로 옮긴 것이라 사람이 확인해야 합니다.`));
      if (st.result.fallback) blocks.push(el('p', { class: 'notice', 'data-testid': 'import-fallback' }, st.result.fallback.reason));
      if (st.result.note) blocks.push(el('p', { class: 'muted small', 'data-testid': 'import-note' }, st.result.note));
      blocks.push(el('div', { class: 'import-fields' },
        el('label', { class: 'field' }, el('span', {}, '이름'), el('input', { id: 'import-name', value: u.name || '', maxlength: '100', oninput: (e) => setUniverse('name', e.target.value) })),
        el('label', { class: 'field' }, el('span', {}, '작성 주체(필수)'), el('input', { id: 'import-owner', value: u.owner || '', placeholder: '예: 가상 시스템분석팀', oninput: (e) => setUniverse('owner', e.target.value) })),
      ));
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
        el('dt', {}, '규모'), el('dd', {}, `노드 ${p.node_total}개(${p.counts.map((c) => `${c.label} ${c.count}`).join(', ')}), 연결 ${p.edge_total}개, 메모 ${p.memo_total}건`));
      if (report) {
        const { min, max } = report.target;
        const fit = report.node_count > max ? '많음' : report.node_count < min ? '적음' : '맞음';
        summary.append(el('dt', {}, '세분화'), el('dd', { 'data-testid': 'import-granularity' }, `월말 정산 수준(노드 ${min}~${max}개) — ${fit}`));
      }
      if (p.source) summary.append(el('dt', {}, '원문 근거'), el('dd', { 'data-testid': 'import-source' }, `노드 ${p.source.with}/${p.source.total}개`));
      summary.append(el('dt', {}, '표시 보존'), el('dd', { 'data-testid': 'import-marks' }, `[미확인] 노드 ${p.marks.미확인}개, [가정] 노드 ${p.marks.가정}개`));
      blocks.push(summary);

      // 작성 주체만 비어 있는 것은 실패가 아니라 "입력할 차례"다: 빨간 오류 대신 안내로 둔다(여섯 번째 검토 U-6). 가져오기 버튼은 그대로 막힌다
      if (st.result.from === 'doc' && p.errors.length && p.errors.every((e) => e.path === 'universe.owner')) {
        blocks.push(el('p', { class: 'notice', 'data-testid': 'import-errors' }, '변환은 끝났습니다. 위의 「작성 주체」 칸에 이 유니버스를 책임질 팀·부서 이름을 넣으면 「가져오기」를 누를 수 있습니다.'));
      } else if (p.errors.length) {
        blocks.push(el('div', { class: 'error-text', 'data-testid': 'import-errors' },
          el('strong', {}, `가져올 수 없습니다 — 고칠 것 ${p.errors.length}건`),
          el('ul', {}, ...p.errors.slice(0, 8).map((e) => el('li', {}, errorText(e)))),
          p.errors.length > 8 ? el('p', {}, `외 ${p.errors.length - 8}건`) : null));
      }
      if (p.conflict) blocks.push(el('p', { class: 'notice', 'data-testid': 'import-conflict' }, `같은 ID의 유니버스「${p.conflict.name}」가 이미 있습니다. 가져오면 덮어쓸지 묻습니다.`));

      const noEmp = p.warnings.filter((w) => w.code === 'W-NO-EMPNO').length;
      const notes = [
        ...(report ? report.notes.map(noteText) : []),
        ...(noEmp ? [`사번 없는 사람 ${noEmp}명 — 원문에 사번이 없어 비워 두었습니다. 통합할 때 확인 목록에 오르고, 가져온 뒤 입력할 수 있습니다.`] : []),
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
        blocks.push(el('h4', {}, '원문의 절 → 유니버스'));
        blocks.push(el('table', { class: 'dg-table import-sections', 'data-testid': 'import-sections' },
          el('thead', {}, el('tr', {}, el('th', {}, '원문'), el('th', {}, '제목'), el('th', {}, '바뀐 것'))),
          el('tbody', {}, ...report.sections.map((s) => el('tr', {},
            el('td', {}, s.ref), el('td', {}, s.title), el('td', {}, s.merged ? `같은 이름의 주제 「${s.merged}」에 합침` : (KIND_TEXT[s.kind] || (() => s.kind))(s.made) + (s.unknown ? ' · 규칙 밖' : '')))))));
      }

      blocks.push(el('h4', {}, '노드'));
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
        blocks.push(el('details', {}, el('summary', {}, `메모 ${memos.length}건(질문·리스크)`),
          el('ul', { class: 'import-memos' }, ...memos.map((m) => el('li', { class: 'small' }, m.note || '')))));
      }
    }

    const can = p.ok && !o.app.readOnly;
    blocks.push(el('div', { class: 'row import-actions' },
      el('button', { type: 'button', class: 'primary', 'data-testid': 'import-confirm', disabled: !can, onclick: () => doImport(p) }, '가져오기'),
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

  function render() {
    const tab = (key, label) => el('button', { type: 'button', class: `tab${st.tab === key ? ' active' : ''}`, 'data-testid': `import-tab-${key}`, onclick: () => { keepInputs(); st.tab = key; st.result = null; st.message = ''; render(); } }, label);
    const u = o.app.doc.universe;
    const exportBody = () => el('div', { class: 'editor' },
      el('p', { class: 'muted small' }, '지금 연 유니버스를 JSON 파일로 내려받습니다. 다른 PC에서 「JSON 파일」 탭으로 열면 그대로 이어서 쓸 수 있습니다. 브라우저 저장은 이 PC에만 남으므로, 시연 전후에 내려받아 두면 안전합니다.'),
      el('dl', {}, el('dt', {}, '유니버스'), el('dd', { 'data-testid': 'export-name' }, `${u.name} (${u.level})`), el('dt', {}, '파일 이름'), el('dd', {}, exportFileName(u))),
      el('div', { class: 'row' }, el('button', { type: 'button', class: 'primary', 'data-testid': 'export-download', onclick: () => o.onExport() }, 'JSON 파일로 내려받기'),
        o.onExportHtml ? el('button', { type: 'button', 'data-testid': 'export-html', onclick: (e) => o.onExportHtml(e.currentTarget) }, 'HTML 파일로 내려받기(내용 포함)') : null),
      o.onExportHtml ? el('p', { class: 'muted small', 'data-testid': 'export-html-note' }, '받는 사람은 이 파일 하나를 더블클릭하면 이 유니버스를 바로 볼 수 있습니다. 내용이 파일에 들어 있으니 보낼 사람에게만 주세요.') : null);
    const body = st.tab === 'folder' ? folderTab(o, render) : st.tab === 'export' ? exportBody() : st.tab === 'doc'
      ? el('div', { class: 'editor' },
        el('p', { class: 'muted small' }, '업무정의서 같은 문서를 붙여 넣으면 제목(#)·표·번호 목록을 규칙으로 읽어 유니버스 초벌을 만듭니다. 업무 흐름은 절차 속성으로, 요건·예외 같은 절은 주제 하나로 묶어 노드를 10~20개 정도로 만듭니다(월말 정산 수준).'),
        el('textarea', { id: 'import-doc', rows: '9', 'aria-label': '문서 원문', placeholder: '# 업무 이름\n## 1. 개요\n| 항목 | 내용 |\n…' }, st.docText),
        el('div', { class: 'row' },
          el('label', { class: 'file-pick' }, '파일 열기(.md, .txt) ', el('input', { type: 'file', accept: '.md,.txt,.markdown,text/plain,text/markdown', 'data-testid': 'import-doc-file', onchange: (e) => readFile(e.target, 'docText') })),
          el('button', { type: 'button', 'data-testid': 'import-example', onclick: () => { st.docText = o.example.text; st.result = null; st.message = ''; render(); } }, `예시 문서 넣기: ${o.example.title}`)),
        el('div', { class: 'row' },
          el('button', { type: 'button', class: 'primary', 'data-testid': 'import-convert', onclick: runConvert }, '초벌 변환'),
          el('span', { class: 'muted small', 'data-testid': 'import-method-note' }, '문서 변환은 규칙으로 읽습니다. 결과는 미리 보기에서 사람이 확인합니다.')))
      : el('div', { class: 'editor' },
        el('p', { class: 'muted small' }, '「내보내기」로 저장한 유니버스 파일(.json)이나, 개발 중 변환해 둔 유니버스 파일을 엽니다.'),
        el('label', { class: 'file-pick' }, 'JSON 파일 열기 ', el('input', { type: 'file', accept: '.json,application/json', 'data-testid': 'import-json-file', onchange: (e) => readFile(e.target, 'jsonText') })),
        el('textarea', { id: 'import-json', rows: '6', 'aria-label': 'JSON 내용', placeholder: '또는 JSON 내용을 붙여 넣으세요' }, st.jsonText),
        el('div', { class: 'row' }, el('button', { type: 'button', class: 'primary', 'data-testid': 'import-check', onclick: runJson }, '확인')));

    o.dialog.replaceChildren(
      el('div', { class: 'import-head' },
        el('h2', { id: 'import-title' }, o.onExport ? '가져오기·내보내기' : '가져오기'),
        el('button', { type: 'button', 'data-testid': 'import-close', onclick: () => o.dialog.close() }, '닫기')),
      el('div', { class: 'tabs' }, tab('doc', '문서 붙여넣기(초벌 변환)'), tab('json', 'JSON 파일'), o.onExport ? tab('export', '내보내기') : null, o.folder && o.onExport ? tab('folder', '폴더 연결') : null),
      body,
      el('p', { class: 'error-text', 'data-testid': 'import-message', 'aria-live': 'polite' }, st.message),
      head,
      slot,
      o.onReset ? el('div', { class: 'danger-zone' },
        el('h4', {}, '위험 구역'),
        el('p', { class: 'muted small' }, '모든 유니버스를 처음 샘플 상태로 되돌립니다. 직접 만들거나 가져온 유니버스도 지워지므로 먼저 위에서 내보내 두세요. 누르면 한 번 더 확인합니다.'),
        el('button', { type: 'button', id: 'reset', class: 'danger', 'data-testid': 'reset-all', disabled: !o.app.canReset, onclick: () => o.onReset() }, '가상 데이터 초기화')) : null,
    );
    renderHead();
    renderPreview();
  }

  if (o.folder) o.folder.subscribe(() => { if (o.dialog.open && st.tab === 'folder') render(); });

  return () => {
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
