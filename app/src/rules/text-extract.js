// 글로 추가(CR-19, D-37): 몇 문장짜리 줄글 → 항목·연결 「제안」(규칙 기반)과, 사용자가 고른 것 → applyBatch 명령.
// 순수 모듈 — DOM·저장소·네트워크를 쓰지 않는다(Node 단위 테스트: tests/cr19-text.test.js).
//   extractFromText(text, view, opt)   글 → 제안 {method:'rule', nodes, edges, unread, notes}
//   finalizeProposal(proposal, view)   지금 지도와 맞대어 match(있는 항목)·exists(이미 있는 연결)·방향을 채운다(규칙 읽기와 AI 읽기가 같은 함수를 쓴다)
//   defaultSelection / resolveSelection  사용자가 체크·고친 값 → 최종 유형·이름·연결 방향·넣을 수 있는지(화면과 proposalToOps가 같은 계산을 쓴다)
//   proposalToOps(proposal, selection, doc, opt)  → app.applyBatch에 넘길 명령 목록(전부 아니면 전무, 되감기 한 점)
// 지어내지 않는다: 아래 TEXT_PATTERNS 모양에 맞는 문장만 읽고, 나머지는 unread로 돌려준다. 모든 quote는 글에 있는 그대로의 부분 문자열이다.
// 값(상한·단어 목록)은 이 파일 맨 위 상수 한 곳에 둔다.

import {
  BATCH_MAX_ROWS, CODES, EDGE_TYPES, LABEL_MAX, NODE_TYPES, hasKey, normalizeEmpNo, normalizeLabel, pairAllowed,
} from '../model/schema.js';

// ── 상수 ────────────────────────────────────────────────────────────────────

/** 글·항목 상한(넘으면 notes로 알린다). 항목·연결 상한은 applyBatch의 행 상한(BATCH_MAX_ROWS)과 맞춘다 */
export const TEXT_LIMITS = Object.freeze({
  maxChars: 4000, // 붙여 넣을 수 있는 글자 수. 넘으면 읽지 않고 안내(일부만 읽어 오해하지 않게)
  maxSentences: 60, // 읽는 문장 수. 넘는 문장은 읽지 않았다고 알린다
  sentenceMax: 300, // 한 문장의 길이. 넘으면 읽지 않고 「읽지 못한 문장」으로(인용 한도 300자와 같은 기준)
  nameMin: 2, // 이름 길이(조사를 뗀 뒤)
  nameMax: 20,
  nameTokens: 4, // 이름 하나를 이루는 최대 낱말 수
  maxNodes: BATCH_MAX_ROWS,
  maxEdges: BATCH_MAX_ROWS * 2,
});

/** 읽는 모양에 쓰는 낱말(바꾸려면 여기 한 곳만 고친다) */
export const TEXT_WORDS = Object.freeze({
  artifactSuffixes: ['보고서', '계획서', '자료', '문서', '양식', '파일', '대장', '결과', '표', '서'],
  orgSuffixes: ['본부', '센터', '팀', '실', '부', '과'],
  titles: ['님', '씨', '팀장', '실장', '부장', '차장', '과장', '대리', '사원', '주임', '책임', '매니저', '선임', '본부장', '센터장', '팀원'],
  stopNames: ['담당자', '이것', '그것', '저것', '우리', '저희', '본인', '해당', '다음', '이후', '모두', '각자', '여기', '거기', '그분', '이분'],
  leading: ['그리고', '그러면', '그다음', '다음으로', '이어서', '먼저', '우선', '또', '또한', '바로', '곧', '즉시', '다시', '이때', '그때', '이후'],
  performVerb: /^(맡|담당|처리|진행)/,
  produceVerb: /^(만들|만든|만듭|작성|산출|낸다|내고|내며|냅니다|낸|내는)/,
  referenceVerb: /^(공유|문의|협업|보고|전달)/,
  verbLike: /(니다|한다|했다|된다|있다|없다|이다|하고|하며|하면|해서)$/, // 「바다」처럼 이름이 「다」로 끝날 수 있어 서술어 끝은 두 글자 이상으로만 본다
});

/** 이름 끝의 조사(긴 것부터). 이름 자체가 이 글자로 끝날 수 있어, 떼고 남은 이름이 한 글자면 떼지 않는다 */
const JOSA = ['에게서', '에게는', '에게', '에서는', '에서도', '에서', '으로는', '으로', '로는', '에는', '에도', '은', '는', '이', '가', '을', '를', '로', '의', '와', '과', '도'];
const SUBJ = new Set(['은', '는', '이', '가']);
const OBJ = new Set(['을', '를']);
const DIR = new Set(['에서', '에서는', '에서도', '으로', '으로는', '로', '로는']);
const Z_JOSA = new Set(['을', '를', '은', '는', '이', '가', '도']);
const TO_PERSON = new Set(['에게', '에게는']);
const TITLE_RE = new RegExp(`^(${TEXT_WORDS.titles.join('|')})(은|는|이|가|을|를|에게|에서|의|와|과|도)?(?:입니다|이다|이에요|예요)?$`);
const EMP_RE = /\(([A-Za-z0-9]+-\d+)\)/;
const COPULA_RE = /(입니다|이다|이에요|예요|이며)$/;

/** 규칙 한 줄 설명(화면 도움말·단위 테스트용). 읽는 모양 표 */
export const TEXT_PATTERN_DOC = Object.freeze([
  { id: 'perform_sv', relation: 'performs', shape: 'X(이/가/은/는) Y(을/를) 맡는다·맡고·맡아·담당·처리·진행', example: '서하늘이 대사 확인을 맡는다' },
  { id: 'perform_vs', relation: 'performs', shape: 'Y 담당(은/는/:) X', example: '대사 확인 담당: 서하늘' },
  { id: 'produce', relation: 'produces', shape: 'Y(에서/으로/로) Z(을/를) 만든다·작성·산출·낸다', example: '보고에서 월말 정산 보고서를 만든다' },
  { id: 'precedes_a', relation: 'precedes', shape: 'Y(이/가) 끝나면·끝난 뒤·다음에·뒤에·후에 Z', example: '대사 확인이 끝나면 보고를 한다' },
  { id: 'precedes_b', relation: 'precedes', shape: 'Y(을/를) 마치면·마친 뒤·하고 나서 Z', example: '대사 확인을 마치면 보고를 한다' },
  { id: 'belongs_a', relation: 'belongs_to', shape: 'X(은/는) T 소속 · T 소속 X(T가 팀·실·부·과·센터·본부로 끝날 때)', example: '도하람은 감사팀 소속이다' },
  { id: 'belongs_b', relation: 'belongs_to', shape: 'T의 X(T가 팀·실·부·과·센터·본부로 끝날 때)', example: '감사팀의 도하람이 확인한다' },
  { id: 'reference', relation: 'references', shape: 'X에게 공유·문의·협업·보고·전달 (그 문장의 업무, 없으면 앞 문장의 업무)', example: '도하람에게 결과를 공유한다' },
  { id: 'emp_no', relation: null, shape: '이름(V-1234) → 사번이 있는 사람', example: '서하늘(V-1003)' },
]);

// ── 낱말·이름 다루기 ────────────────────────────────────────────────────────

const LETTER_RE = /[\p{L}\p{N}]/u;
const oneLine = (s) => String(s).replace(/\s+/g, ' ').trim();
const endsWithAny = (name, list) => list.some((w) => name.endsWith(w) && (w.length >= 2 || name.length >= 3));

/** 이름 끝말이 산출물이면 true(보고서·자료·문서·양식·파일·대장·표·서·계획서·결과) */
export const looksArtifact = (name) => endsWithAny(name, TEXT_WORDS.artifactSuffixes);
/** 이름 끝말이 팀·실·부·과·센터·본부이면 true(세 글자 이상) */
export const looksOrg = (name) => name.length >= 3 && endsWithAny(name, TEXT_WORDS.orgSuffixes);

/** 이름으로 쓸 수 있는 글로 다듬는다. 쓸 수 없으면 '' (2~20자, 글자·숫자 포함, 지시어 제외) */
export function cleanName(raw) {
  const s = oneLine(String(raw ?? '').replace(/^["'“‘「『(\[<]+|["'”’」』)\]>,，、]+$/g, ''));
  if (s.length < TEXT_LIMITS.nameMin || s.length > TEXT_LIMITS.nameMax) return '';
  if (!LETTER_RE.test(s) || /^[\d\s.\-]+$/.test(s)) return '';
  if (TEXT_WORDS.stopNames.includes(s)) return '';
  return s;
}

/** 낱말 하나 해석: 괄호 사번·앞뒤 부호·조사·「님/씨」를 떼어 낸다 */
function parseToken(raw) {
  let w = raw;
  let emp_no = '';
  const m = EMP_RE.exec(w);
  if (m) {
    emp_no = m[1];
    w = w.replace(EMP_RE, '');
  }
  w = w.replace(/^["'“‘「『(\[<]+/, '');
  let colon = false;
  w = w.replace(/[,，、"'”’」』)\]>.!?:：]+$/, (tail) => { if (/[:：]/.test(tail)) colon = true; return ''; });
  if (!w) return { empty: true, colon };
  const t = TITLE_RE.exec(w);
  if (t) return { raw, core: w, name: t[1], josa: t[2] || '', emp_no: '', titled: false, title: true, colon };
  let josa = '';
  let name = w;
  for (const j of JOSA) {
    if (w.endsWith(j) && w.length - j.length >= 2) {
      josa = j;
      name = w.slice(0, w.length - j.length);
      break;
    }
  }
  let titled = false;
  if (/(님|씨)$/.test(name) && name.length >= 3) {
    name = name.slice(0, -1);
    titled = true;
  }
  return { raw, core: w, name, josa, emp_no, titled, title: false, colon };
}

/** 문장 → 낱말 목록. 「이름 (V-1)」의 띄어 쓴 사번을 붙이고, 이름 뒤 직함 낱말은 앞 낱말에 합친다 */
function parseTokens(sentence) {
  const s = sentence.replace(/\s+(\([A-Za-z0-9]+-\d+\))/g, '$1');
  const out = [];
  for (const raw of s.split(/\s+/).filter(Boolean)) {
    const t = parseToken(raw);
    if (t.empty) {
      if (t.colon && out.length) out[out.length - 1].colon = true;
      continue;
    }
    const prev = out[out.length - 1];
    if (t.title && prev && prev.josa === '' && !prev.title) {
      prev.titled = true;
      prev.josa = t.josa;
      prev.colon = prev.colon || t.colon;
      continue;
    }
    out.push(t);
  }
  return out;
}

/** 앞쪽으로 조사 없는 낱말을 이어 붙여 이름이 시작하는 자리를 찾는다(끝 낱말 포함 최대 max개) */
function backStart(T, end, max) {
  let a = end;
  while (a - 1 >= 0 && end - (a - 1) + 1 <= max && T[a - 1].josa === '' && !T[a - 1].colon && !T[a - 1].title) a -= 1;
  return a;
}

/** T[a..b] → 이름. 맨 앞의 이음말(그리고·바로 …)은 뗀다. 끝 낱말은 조사를 뗀 이름 */
function phrase(T, a, b) {
  let s = a;
  while (s < b && TEXT_WORDS.leading.includes(T[s].core)) s += 1;
  const names = [];
  for (let i = s; i <= b; i += 1) names.push(i === b ? T[i].name : T[i].core);
  return cleanName(names.join(' '));
}

const isWorkName = (n) => !!n && !looksArtifact(n) && !looksOrg(n);
const isPersonName = (n) => !!n && !looksArtifact(n) && !looksOrg(n);
const stripCopula = (s) => s.replace(COPULA_RE, '');

/** 뒤따르는 업무 이름(Z): 조사가 붙은 낱말까지, 조사가 없으면 서술어 앞까지 */
function laterWork(T, s) {
  let j = s;
  while (j < T.length && TEXT_WORDS.leading.includes(T[j].core)) j += 1;
  const start = j;
  let end = -1;
  for (; j < T.length && j - start < TEXT_LIMITS.nameTokens; j += 1) {
    if (T[j].josa !== '') {
      if (Z_JOSA.has(T[j].josa)) end = j;
      break;
    }
    if (TEXT_WORDS.verbLike.test(T[j].core)) break;
  }
  if (end < 0) end = j - 1;
  return end < start ? '' : phrase(T, start, end);
}

// ── 제안을 쌓는 도구(규칙 읽기와 AI 읽기가 함께 쓴다) ─────────────────────

/**
 * 항목·연결을 쌓는 도구. 같은 이름(공백·대소문자 무시)은 한 항목으로 합치고, 상한을 넘으면 flags로 알린다.
 * 항목 key는 n1, n2…, 연결 key는 e1, e2…(만든 순서)
 */
export function createBuilder(limits = TEXT_LIMITS) {
  const nodes = [];
  const byLabel = new Map();
  const edges = [];
  const edgeKeys = new Set();
  const flags = { nodesCapped: false, edgesCapped: false };
  return {
    nodes,
    edges,
    flags,
    /** @param {{type:string, label:string, emp_no?:string, unsure?:boolean}} spec */
    addNode(spec, quote) {
      const k = normalizeLabel(spec.label);
      const old = byLabel.get(k);
      if (old) {
        if (spec.emp_no && !old.emp_no && old.type === 'person') old.emp_no = spec.emp_no;
        // 확실하지 않던 유형이 다른 문장에서 확실해지면 그 유형으로(둘 다 확실한데 다르면 먼저 나온 것을 둔다)
        if (old.unsure && !spec.unsure) {
          old.type = spec.type;
          delete old.unsure;
          if (spec.type !== 'person') delete old.emp_no;
          if (spec.emp_no && spec.type === 'person') old.emp_no = spec.emp_no;
        }
        return old;
      }
      if (nodes.length >= limits.maxNodes) {
        flags.nodesCapped = true;
        return null;
      }
      const n = { key: `n${nodes.length + 1}`, type: spec.type, label: spec.label, ...(spec.emp_no && spec.type === 'person' ? { emp_no: spec.emp_no } : {}), quote, match: null, ...(spec.unsure ? { unsure: true } : {}) };
      nodes.push(n);
      byLabel.set(k, n);
      return n;
    },
    addEdge(a, b, type, quote) {
      if (!a || !b || a === b) return null;
      const k = `${a.key}>${b.key}>${type}`;
      if (edgeKeys.has(k)) return null;
      if (edges.length >= limits.maxEdges) {
        flags.edgesCapped = true;
        return null;
      }
      edgeKeys.add(k);
      const e = { key: `e${edges.length + 1}`, from: a.key, to: b.key, type, quote };
      edges.push(e);
      return e;
    },
  };
}

// ── 문장 나누기 ─────────────────────────────────────────────────────────────

/** 마침표·물음표·느낌표(뒤가 공백이거나 끝일 때)·줄바꿈·「;」로 나눈다. 목록 머리(「- 」「1. 」)는 뗀다. 모든 문장은 글의 부분 문자열이다 */
export function splitSentences(text) {
  const out = [];
  const push = (s) => {
    const t = s.trim();
    if (t && LETTER_RE.test(t)) out.push(t);
  };
  for (const rawLine of String(text).split(/\r\n?|\n/)) {
    const line = rawLine.replace(/^\s*(?:[-*•·▪‣◦]|\d{1,2}[.)])\s+/, '');
    let start = 0;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      const stop = ch === ';' || ch === '；' || ch === '。'
        || ('.!?！？'.includes(ch) && (i + 1 === line.length || /[\s"')\]」』”’]/.test(line[i + 1])));
      if (stop) {
        push(line.slice(start, i));
        start = i + 1;
      }
    }
    push(line.slice(start));
  }
  return out;
}

// ── 읽는 모양 표 ────────────────────────────────────────────────────────────
// 각 항목 run(sc)은 문장 한 개(sc.T = 낱말 목록)를 읽어 sc.node/sc.edge로 쌓는다. 모양에 안 맞으면 아무것도 쌓지 않는다.
// sc.node는 이름 검사를 이미 통과한 것만 받는다. 연결의 유형 조합·방향은 finalizeProposal에서 PAIR_RULES로 검사한다.

const personSpec = (t, name = t.name) => {
  const label = cleanName(stripCopula(name));
  return label && isPersonName(label) && !t.title ? { type: 'person', label, emp_no: t.emp_no, unsure: !(t.emp_no || t.titled) } : null;
};

function runPerformSV(sc) {
  const { T } = sc;
  for (let i = 1; i < T.length; i += 1) {
    if (!TEXT_WORDS.performVerb.test(T[i].core) || !OBJ.has(T[i - 1].josa)) continue;
    const oe = i - 1;
    let k = oe - 1;
    while (k >= 0 && T[k].josa === '' && !T[k].title && oe - k <= TEXT_LIMITS.nameTokens) k -= 1;
    if (k < 0 || !SUBJ.has(T[k].josa) || oe - k > TEXT_LIMITS.nameTokens) continue;
    const who = personSpec(T[k]);
    const what = phrase(T, k + 1, oe);
    if (!who || !isWorkName(what)) continue;
    const p = sc.node(who);
    const w = sc.node({ type: 'work', label: what });
    sc.edge(p, w, 'performs');
    sc.focus = w;
  }
}

function runPerformVS(sc) {
  const { T } = sc;
  for (let i = 1; i < T.length - 1; i += 1) {
    if (!(T[i].name === '담당' || T[i].name === '담당자') || !(SUBJ.has(T[i].josa) || T[i].colon)) continue;
    const x = T[i + 1];
    if (!['', ...SUBJ].includes(x.josa) || TEXT_WORDS.verbLike.test(stripCopula(x.core)) && !x.emp_no) continue;
    const who = personSpec(x);
    const what = phrase(T, backStart(T, i - 1, TEXT_LIMITS.nameTokens), i - 1);
    if (!who || !isWorkName(what)) continue;
    const p = sc.node(who);
    const w = sc.node({ type: 'work', label: what });
    sc.edge(p, w, 'performs');
    sc.focus = w;
  }
}

function runProduce(sc) {
  const { T } = sc;
  for (let i = 1; i < T.length; i += 1) {
    if (!TEXT_WORDS.produceVerb.test(T[i].core) || !OBJ.has(T[i - 1].josa)) continue;
    const oe = i - 1;
    let k = oe - 1;
    while (k >= 0 && T[k].josa === '' && oe - k <= TEXT_LIMITS.nameTokens) k -= 1;
    if (k < 0 || !DIR.has(T[k].josa) || oe - k > TEXT_LIMITS.nameTokens) continue;
    const from = phrase(T, backStart(T, k, TEXT_LIMITS.nameTokens), k);
    const what = phrase(T, k + 1, oe);
    if (!isWorkName(from) || !what) continue;
    const w = sc.node({ type: 'work', label: from });
    const a = sc.node({ type: 'artifact', label: what });
    sc.edge(w, a, 'produces');
    sc.focus = w;
  }
}

/** 「앞 일 → 뒤 일」 두 업무를 잇는다. 앞 일 끝 낱말 yEnd, 뒤 일은 laterWork(T, zStart) */
function precede(sc, yEnd, zStart) {
  const { T } = sc;
  const y = phrase(T, backStart(T, yEnd, TEXT_LIMITS.nameTokens), yEnd);
  const z = laterWork(T, zStart);
  if (!isWorkName(y) || !isWorkName(z) || normalizeLabel(y) === normalizeLabel(z)) return;
  const a = sc.node({ type: 'work', label: y });
  const b = sc.node({ type: 'work', label: z });
  sc.edge(a, b, 'precedes');
  sc.focus = b;
}

function runPrecedesA(sc) {
  const { T } = sc;
  for (let i = 1; i < T.length; i += 1) {
    const c = T[i].core;
    const ye = T[i - 1];
    if (/^(끝나면|끝나면은|끝나고|끝나자)$/.test(c)) {
      if ([...SUBJ, ''].includes(ye.josa)) precede(sc, i - 1, i + 1);
    } else if (c === '끝난' && T[i + 1] && /^(뒤에?|후에?)$/.test(T[i + 1].core)) {
      if ([...SUBJ, ''].includes(ye.josa)) precede(sc, i - 1, i + 2);
    } else if (/^(다음에|뒤에|후에|이후에)$/.test(c) && !['끝난', '마친', '난'].includes(ye.core) && ['', '의'].includes(ye.josa)) {
      precede(sc, i - 1, i + 1);
    }
  }
}

function runPrecedesB(sc) {
  const { T } = sc;
  for (let i = 1; i < T.length; i += 1) {
    const c = T[i].core;
    if (!OBJ.has(T[i - 1].josa)) continue;
    if (/^(마치면|마치면은|마치고)$/.test(c)) precede(sc, i - 1, i + 1);
    else if (c === '마친' && T[i + 1] && /^(뒤에?|후에?)$/.test(T[i + 1].core)) precede(sc, i - 1, i + 2);
    else if (c === '하고' && T[i + 1] && /^나서는?$/.test(T[i + 1].core)) precede(sc, i - 1, i + 2);
    else if (c === '하고' && T[i + 1] && T[i + 1].core === '난' && T[i + 2] && /^(뒤에?|후에?)$/.test(T[i + 2].core)) precede(sc, i - 1, i + 3);
  }
}

/** 사람(또는 조직) X가 조직 T에 속한다. x는 낱말 */
function belong(sc, x, orgLabel) {
  const xLabel = cleanName(stripCopula(x.name));
  if (!xLabel || !orgLabel || normalizeLabel(xLabel) === normalizeLabel(orgLabel) || looksArtifact(xLabel)) return;
  const xs = looksOrg(xLabel) ? { type: 'org', label: xLabel } : personSpec(x);
  if (!xs) return;
  const a = sc.node(xs);
  const t = sc.node({ type: 'org', label: orgLabel });
  sc.edge(a, t, 'belongs_to');
}

function runBelongsA(sc) {
  const { T } = sc;
  for (let i = 1; i < T.length; i += 1) {
    if (!T[i].core.startsWith('소속') || T[i - 1].josa !== '') continue;
    const ta = backStart(T, i - 1, 3);
    const org = phrase(T, ta, i - 1);
    if (!looksOrg(org)) continue;
    const k = ta - 1;
    if (k >= 0 && SUBJ.has(T[k].josa)) {
      belong(sc, T[k], org);
    } else if (T[i + 1] && (SUBJ.has(T[i + 1].josa) || T[i + 1].emp_no || T[i + 1].titled) && !TEXT_WORDS.verbLike.test(T[i + 1].core)) {
      belong(sc, T[i + 1], org);
    }
  }
}

function runBelongsB(sc) {
  const { T } = sc;
  for (let i = 0; i < T.length - 1; i += 1) {
    if (T[i].josa !== '의' || !looksOrg(T[i].name)) continue;
    const x = T[i + 1];
    if (!(SUBJ.has(x.josa) || x.emp_no || x.titled)) continue;
    const org = phrase(T, backStart(T, i, 2), i);
    if (!org) continue;
    belong(sc, x, org);
  }
}

function runReference(sc) {
  const { T } = sc;
  for (let i = 0; i < T.length; i += 1) {
    if (!TO_PERSON.has(T[i].josa)) continue;
    if (!T.slice(i + 1).some((t) => TEXT_WORDS.referenceVerb.test(t.core))) continue;
    const label = cleanName(T[i].name);
    if (!label || looksArtifact(label)) continue;
    const work = sc.focus || sc.prevFocus;
    if (!work) continue;
    let spec;
    if (looksOrg(label)) {
      const org = phrase(T, backStart(T, i, 2), i);
      spec = { type: 'org', label: org || label };
    } else spec = personSpec(T[i]);
    if (!spec) continue;
    const x = sc.node(spec);
    sc.edge(work, x, 'references');
  }
}

function runEmpNo(sc) {
  for (const t of sc.T) {
    if (!t.emp_no) continue;
    const spec = personSpec(t);
    if (spec) sc.node(spec);
  }
}

/** 읽는 모양 표. 순서가 곧 읽는 순서다(참조는 같은 문장의 업무를 먼저 알아야 하므로 맨 뒤쪽) */
export const TEXT_PATTERNS = Object.freeze([
  { id: 'perform_sv', run: runPerformSV },
  { id: 'perform_vs', run: runPerformVS },
  { id: 'produce', run: runProduce },
  { id: 'precedes_a', run: runPrecedesA },
  { id: 'precedes_b', run: runPrecedesB },
  { id: 'belongs_a', run: runBelongsA },
  { id: 'belongs_b', run: runBelongsB },
  { id: 'reference', run: runReference },
  { id: 'emp_no', run: runEmpNo },
]);

// ── 지금 지도와 맞대기 ──────────────────────────────────────────────────────

/** 지금 지도(view)의 이 유니버스 항목들(숨김·삭제·꼭지 제외). 새 항목은 이 문서에만 만들 수 있으므로 하위 지도의 항목은 맞대지 않는다 */
export function ownCandidates(view) {
  if (!view || !Array.isArray(view.raw_nodes)) return [];
  return view.raw_nodes
    .filter((n) => n.universe_id === view.universe_id && !n.hidden && !n.deleted && n.core_type !== 'root')
    .map((n) => ({ id: n.id, gid: n.gid, core_type: n.core_type, label: String(n.label ?? ''), emp_no: n.emp_no || '' }));
}

/** 문서(doc)의 항목들(ownCandidates와 같은 모양) */
export function docCandidates(doc) {
  return (doc.nodes || [])
    .filter((n) => !n.hidden && !n.deleted && n.core_type !== 'root')
    .map((n) => ({ id: n.id, gid: '', core_type: n.core_type, label: String(n.label ?? ''), emp_no: n.emp_no || '' }));
}

/**
 * 같은 사번(사람) 또는 같은 유형·이름(공백 무시)의 항목이 하나뿐이면 hit. 둘 이상이면 ambiguous.
 * 글에 사번이 있는데 같은 이름의 사람이 다른 사번이면 다른 사람이므로 맞대지 않는다. adopt: 유형이 확실하지 않은 이름은 다른 유형이라도 같은 이름 하나면 그 항목으로(유형을 따라간다)
 * @returns {{hit?:object, ambiguous?:boolean}}
 */
export function findMatch(cands, { type, label, emp_no = '', adopt = false }) {
  if (type === 'person' && emp_no) {
    const e = normalizeEmpNo(emp_no);
    const hs = cands.filter((c) => c.core_type === 'person' && c.emp_no && normalizeEmpNo(c.emp_no) === e);
    if (hs.length === 1) return { hit: hs[0] };
    if (hs.length > 1) return { ambiguous: true };
  }
  const key = normalizeLabel(label);
  const sameName = cands.filter((c) => normalizeLabel(c.label) === key);
  const ok = (c) => !(type === 'person' && emp_no && c.core_type === 'person' && c.emp_no && normalizeEmpNo(c.emp_no) !== normalizeEmpNo(emp_no));
  const same = sameName.filter((c) => c.core_type === type && ok(c));
  if (same.length === 1) return { hit: same[0] };
  if (same.length > 1) return { ambiguous: true };
  if (adopt) {
    const any = sameName.filter((c) => c.core_type !== type);
    if (any.length === 1) return { hit: any[0] };
    if (any.length > 1) return { ambiguous: true };
  }
  return {};
}

/** 관계 방향: a→b로 되면 'forward', b→a로만 되면 'backward', 안 되면 null */
export function orientRelation(type, aType, bType) {
  if (pairAllowed(type, aType, bType)) return 'forward';
  if (pairAllowed(type, bType, aType)) return 'backward';
  return null;
}

const typeName = (t) => (hasKey(NODE_TYPES, t) ? NODE_TYPES[t] : t);
const relName = (t) => (hasKey(EDGE_TYPES, t) ? EDGE_TYPES[t] : t);

/** 같은 연결이 이미 있는가(숨김 제외, 수행은 끝나지 않은 담당만) */
const edgeIn = (edges, src, tgt, type) => edges.some((e) => !e.hidden && e.source === src && e.target === tgt && e.core_type === type && !(type === 'performs' && e.period && e.period.end));

/**
 * 제안을 지금 지도와 맞댄다(규칙 읽기와 AI 읽기가 같이 쓴다).
 *  - 항목: match(지도의 gid)·match_label, 유형이 확실하지 않던 이름이 다른 유형의 항목과 맞으면 그 유형을 따라간다(unsure 해제). 같은 이름이 둘 이상이면 ambiguous + notes
 *  - 연결: 두 항목 유형에 PAIR_RULES가 맞을 때만 둔다(반대 방향만 맞으면 뒤집는다). 안 맞으면 빼고 notes. 두 끝이 지도에 이미 있고 같은 연결이 있으면 exists
 * view가 없으면(null) 맞대지 않고 방향 검사만 한다.
 */
export function finalizeProposal(proposal, view) {
  const notes = [...(proposal.notes || [])];
  const cands = ownCandidates(view);
  const nodes = proposal.nodes.map((n) => {
    const out = { ...n };
    delete out.ambiguous;
    const m = findMatch(cands, { type: n.type, label: n.label, emp_no: n.emp_no || '', adopt: !!n.unsure });
    if (m.hit) {
      out.match = m.hit.gid;
      out.match_label = m.hit.label;
      if (m.hit.core_type !== n.type) out.type = m.hit.core_type;
      if (out.type !== 'person') delete out.emp_no;
      delete out.unsure;
    } else {
      out.match = null;
      delete out.match_label;
    }
    if (m.ambiguous) {
      out.ambiguous = true;
      notes.push(`「${n.label}」: 지도에 같은 이름의 항목이 둘 이상 있어 어느 쪽인지 정하지 못했습니다(체크하면 새 항목으로 만듭니다)`);
    }
    return out;
  });
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const edges = [];
  const viewEdges = view && Array.isArray(view.edges) ? view.edges.filter((e) => e.universe_id === view.universe_id).map((e) => ({ source: e.source, target: e.target, core_type: e.core_type, hidden: e.hidden, period: e.period })) : [];
  for (const e of proposal.edges) {
    const a = byKey.get(e.from);
    const b = byKey.get(e.to);
    if (!a || !b) continue;
    const dir = orientRelation(e.type, a.type, b.type);
    if (!dir) {
      notes.push(`연결 「${a.label} — ${b.label}」(${relName(e.type)})은 두 항목의 유형(${typeName(a.type)}·${typeName(b.type)})에 맞지 않아 뺐습니다`);
      continue;
    }
    const [from, to] = dir === 'forward' ? [a, b] : [b, a];
    const out = { key: e.key, from: from.key, to: to.key, type: e.type, quote: e.quote };
    if (from.match && to.match) {
      const c = (g) => (view && view.canonical ? view.canonical(g) : g);
      if (edgeIn(viewEdges, c(from.match), c(to.match), e.type)) out.exists = true;
    }
    edges.push(out);
  }
  return { ...proposal, nodes, edges, notes };
}

// ── 글 → 제안 ───────────────────────────────────────────────────────────────

const emptyProposal = (notes) => ({ method: 'rule', nodes: [], edges: [], unread: [], notes });

/** 상한·잘림 안내를 notes에 더한다(규칙 읽기와 AI 읽기가 같은 문구를 쓴다) */
export function capNotes(flags, limits = TEXT_LIMITS) {
  const notes = [];
  if (flags.nodesCapped) notes.push(`항목이 너무 많아 앞의 ${limits.maxNodes}개만 담았습니다. 글을 나누어 넣으세요`);
  if (flags.edgesCapped) notes.push(`연결이 너무 많아 앞의 ${limits.maxEdges}개만 담았습니다. 글을 나누어 넣으세요`);
  return notes;
}

/** 글이 읽을 수 있는 크기인가 → null이면 통과, 아니면 notes에 쓸 안내 */
export function textSizeNote(text, limits = TEXT_LIMITS) {
  if (typeof text !== 'string' || !text.trim()) return '읽을 글이 비어 있습니다';
  if (text.length > limits.maxChars) return `글이 너무 깁니다(${limits.maxChars.toLocaleString()}자 이하로 나누어 넣으세요)`;
  return null;
}

/**
 * 줄글을 읽어 항목·연결 제안을 만든다. 모양(TEXT_PATTERNS)에 안 맞는 문장은 unread에 둔다(지어내지 않는다).
 * @param {string} text 붙여 넣은 글
 * @param {object|null} view 지금 지도(buildView 결과). 있으면 같은 이름·사번의 항목은 새로 만들지 않고 match로 잇는다
 * @param {{limits?:object}} [opt]
 * @returns {{method:'rule', nodes:object[], edges:object[], unread:string[], notes:string[]}}
 *   nodes[]: {key, type, label, emp_no?, quote, match:gid|null, match_label?, unsure?, ambiguous?}, edges[]: {key, from, to, type, quote, exists?}
 */
export function extractFromText(text, view = null, opt = {}) {
  const limits = { ...TEXT_LIMITS, ...(opt.limits || {}) };
  const size = textSizeNote(text, limits);
  if (size) return emptyProposal([size]);
  const notes = [];
  let sentences = splitSentences(text);
  if (sentences.length > limits.maxSentences) {
    notes.push(`문장이 ${sentences.length}개라 앞의 ${limits.maxSentences}개만 읽었습니다`);
    sentences = sentences.slice(0, limits.maxSentences);
  }
  const b = createBuilder(limits);
  const unread = [];
  let prevFocus = null;
  for (const s of sentences) {
    if (s.length > limits.sentenceMax) {
      unread.push(s);
      continue;
    }
    let touched = false;
    const sc = {
      T: parseTokens(s),
      focus: null,
      prevFocus,
      node(spec) {
        const q = s;
        const n = b.addNode(spec, q);
        if (n) touched = true;
        return n;
      },
      edge(a, c, type) {
        if (a && c) touched = true;
        return b.addEdge(a, c, type, s);
      },
    };
    for (const p of TEXT_PATTERNS) p.run(sc);
    if (!touched) unread.push(s);
    if (sc.focus) prevFocus = sc.focus;
  }
  notes.push(...capNotes(b.flags, limits));
  const proposal = { method: 'rule', nodes: b.nodes, edges: b.edges, unread, notes };
  return finalizeProposal(proposal, view);
}

// ── 사용자가 고른 것 → 명령 ─────────────────────────────────────────────────

/** 처음 선택: 같은 이름이 둘 이상인 항목은 체크하지 않고, 이미 있는 연결은 체크하지 않는다 */
export function defaultSelection(proposal) {
  const nodes = {};
  const edges = {};
  for (const n of proposal.nodes) nodes[n.key] = { include: !n.ambiguous, type: n.type, label: n.label, emp_no: n.emp_no || '' };
  for (const e of proposal.edges) edges[e.key] = { include: !e.exists, type: e.type };
  return { nodes, edges };
}

const NEW_TYPES = Object.keys(NODE_TYPES).filter((k) => k !== 'root');
export const TEXT_NODE_TYPES = Object.freeze(NEW_TYPES);

/**
 * 제안 + 사용자의 선택 → 화면과 명령이 함께 쓰는 최종 값.
 *  nodes[key]: {include, type, label, emp_no, problem:''|'empty'|'too_long', match:{id,gid,label}|null, ambiguous}
 *  edges[key]: {include(실제로 넣을지), wanted(사용자가 체크했는지), type, source, target(방향 반영한 항목 key), reason:''|'pair'|'end_missing'|'same', exists}
 * @param {object} selection {nodes:{key:{include?,type?,label?,emp_no?}}, edges:{key:{include?,type?}}} 빠진 값은 defaultSelection
 * @param {{id:string, core_type:string, label:string, emp_no:string}[]} cands docCandidates(doc) 또는 ownCandidates(view)
 * @param {object[]} [docEdges] 같은 연결이 이미 있는지 볼 문서의 연결 목록(없으면 exists는 제안 값)
 */
export function resolveSelection(proposal, selection, cands, docEdges = null) {
  const def = defaultSelection(proposal);
  const nodes = {};
  for (const n of proposal.nodes) {
    const s = { ...def.nodes[n.key], ...((selection && selection.nodes && selection.nodes[n.key]) || {}) };
    const type = NEW_TYPES.includes(s.type) ? s.type : n.type;
    const label = oneLine(s.label ?? '');
    const emp_no = type === 'person' ? String(s.emp_no ?? '').trim() : '';
    const problem = !label ? 'empty' : label.length > LABEL_MAX ? 'too_long' : '';
    const m = problem ? {} : findMatch(cands, { type, label, emp_no });
    nodes[n.key] = {
      key: n.key,
      include: s.include !== false,
      type,
      label,
      emp_no,
      problem,
      match: m.hit ? { id: m.hit.id, gid: m.hit.gid, label: m.hit.label } : null,
      ambiguous: !!m.ambiguous,
    };
  }
  const idOf = (key) => (nodes[key].match ? nodes[key].match.id : null);
  const edges = {};
  for (const e of proposal.edges) {
    const s = { ...def.edges[e.key], ...((selection && selection.edges && selection.edges[e.key]) || {}) };
    const type = hasKey(EDGE_TYPES, s.type) ? s.type : e.type;
    const a = nodes[e.from];
    const b = nodes[e.to];
    const dir = orientRelation(type, a.type, b.type);
    const source = dir === 'backward' ? e.to : e.from;
    const target = dir === 'backward' ? e.from : e.to;
    let reason = '';
    if (!dir) reason = 'pair';
    else if (!a.include || !b.include || a.problem || b.problem) reason = 'end_missing';
    else if ((a.match && b.match && a.match.id === b.match.id) || (a.type === b.type && normalizeLabel(a.label) === normalizeLabel(b.label))) reason = 'same';
    const sid = idOf(source);
    const tid = idOf(target);
    const exists = docEdges ? !!(sid && tid && edgeIn(docEdges, sid, tid, type)) : !!e.exists && type === e.type;
    const wanted = s.include !== false;
    edges[e.key] = { key: e.key, include: wanted && !reason, wanted, type, source, target, reason, exists };
  }
  return { nodes, edges };
}

/**
 * 제안 + 선택 → app.applyBatch 명령 목록(항목 먼저, 연결 나중). 한 번의 묶음이라 하나라도 오류면 아무것도 저장되지 않는다.
 *  - 지도에 이미 있는 항목(match)은 새로 만들지 않고 그 항목 id로 잇는다. 새 항목은 '@행번호'로 가리킨다(표로 추가의 연결 칸과 같은 방식)
 *  - 수행은 assign(담당 시작 이력 + 수행 연결, 오늘부터. 이미 담당 중이면 건너뜀), 나머지는 addEdge(skipDup: 이미 있으면 건너뜀)
 *  - 이름이 빈 항목은 invalid 명령(그 행 사유)으로 돌려 저장을 막는다
 * 명령마다 key(제안의 항목·연결 key)를 붙인다 — 오류 행을 화면 행에 되짚기 위한 것이고 applyBatch는 읽지 않는다.
 * @param {{attachRoot?: boolean|'work'}} [opt] attachRoot: 새 항목을 지도 중심에 포함으로 잇는 범위. 기본 'work'(표로 추가와 같음)
 */
export function proposalToOps(proposal, selection, doc, opt = {}) {
  const attach = opt.attachRoot === undefined ? 'work' : opt.attachRoot;
  const r = resolveSelection(proposal, selection, docCandidates(doc), doc.edges || []);
  const ops = [];
  const ref = new Map();
  let row = 1;
  for (const n of proposal.nodes) {
    const f = r.nodes[n.key];
    if (!f.include) continue;
    if (f.problem) {
      ops.push({ op: 'invalid', row, key: n.key, error: { code: CODES.REQUIRED, field: 'label', ...(f.problem === 'too_long' ? { too_long: LABEL_MAX } : {}) } });
      row += 1;
      continue;
    }
    if (f.match) {
      ref.set(n.key, f.match.id);
      continue;
    }
    const input = { core_type: f.type, label: f.label, ...(f.type === 'person' && f.emp_no ? { emp_no: f.emp_no } : {}) };
    ops.push({ op: 'addNode', row, key: n.key, input, attachRoot: attach === true || (attach === 'work' && f.type === 'work') });
    ref.set(n.key, `@${row}`);
    row += 1;
  }
  for (const e of proposal.edges) {
    const f = r.edges[e.key];
    if (!f.include || !ref.has(f.source) || !ref.has(f.target)) continue;
    if (f.type === 'performs') ops.push({ op: 'assign', row, key: e.key, input: { person_id: ref.get(f.source), work_id: ref.get(f.target) } });
    else ops.push({ op: 'addEdge', row, key: e.key, skipDup: true, input: { source: ref.get(f.source), target: ref.get(f.target), core_type: f.type } });
    row += 1;
  }
  return ops;
}
