// 내용 포함 HTML(CR-13 B): 앱 HTML에 유니버스 문서를 JSON으로 넣고 빼는 순수 함수. DOM·저장소를 쓰지 않는다.
// 데이터는 <script id="wu-embed" type="application/json"> 로 </head> 앞(= 앱 스크립트 앞)에 둔다.

import { SCHEMA_VERSION } from '../model/schema.js';

export const EMBED_ID = 'wu-embed';
export const EMBED_FORMAT = 'wu-embed';
export const EMBED_VERSION = 1;
export const EMBED_HASH_PREFIX = 'embed/'; // ID에는 '/'를 쓸 수 없으므로(가져오기 검증) 일반 ID와 섞이지 않는다

const OPEN = `<script id="${EMBED_ID}" type="application/json">`;
const CLOSE = '</script>';

/**
 * 열 유니버스와 묶음이 참조하는 하위 유니버스 문서를 모은다(손자까지, 순환·중복은 한 번만).
 * 순서: 하위가 상위보다 앞(가져올 때 하위 먼저). 마지막이 root.
 * @param {object} rootDoc
 * @param {(id:string)=>object|null} resolve
 */
export function collectDocs(rootDoc, resolve) {
  const seen = new Set();
  const out = [];
  const visit = (doc) => {
    const id = doc.universe.id;
    if (seen.has(id)) return;
    seen.add(id);
    for (const r of doc.refs || []) {
      if (!r || r.hidden || seen.has(r.child_universe_id)) continue;
      const child = resolve(r.child_universe_id);
      if (child && child.universe) visit(child);
    }
    out.push(doc);
  };
  visit(rootDoc);
  return out;
}

export function buildEmbed(rootDoc, resolve) {
  return { format: EMBED_FORMAT, version: EMBED_VERSION, schema_version: SCHEMA_VERSION, root: rootDoc.universe.id, docs: collectDocs(rootDoc, resolve) };
}

// 줄 구분 문자 U+2028·U+2029(글자 코드로 만든다: 소스에 직접 쓰지 않으려고)
const LINE_SEPARATORS = new RegExp('[' + String.fromCharCode(0x2028) + String.fromCharCode(0x2029) + ']', 'g');

/** JSON 글. '<'를 u003c 이스케이프로 바꿔 닫는 script 태그와 주석 시작이 HTML을 끊지 못하게 한다(JSON 의미는 같다). 줄 구분 문자 U+2028/2029도 이스케이프 */
export function embedJson(embed) {
  return JSON.stringify(embed).replace(/</g, '\\u003c').replace(LINE_SEPARATORS, (c) => '\\u' + c.charCodeAt(0).toString(16));
}

/** HTML 글에서 기존 내장 데이터 블록을 뺀다(없으면 그대로) */
export function stripEmbed(html) {
  const i = html.indexOf(OPEN);
  if (i < 0) return html;
  const j = html.indexOf(CLOSE, i);
  if (j < 0) return html;
  return html.slice(0, i) + html.slice(j + CLOSE.length).replace(/^\n/, '');
}

/** 기존 블록을 빼고 </head> 앞에 새로 넣는다. </head>가 없으면 null */
export function insertEmbed(html, embed) {
  const base = stripEmbed(html);
  const k = base.indexOf('</head>');
  if (k < 0) return null;
  return `${base.slice(0, k)}${OPEN}${embedJson(embed)}${CLOSE}\n${base.slice(k)}`;
}

/**
 * 내장 데이터 글(JSON) 읽기·검사. 성공 {ok:true, embed}, 실패 {ok:false, reason: 'json'|'shape'|'version'}.
 * 깨졌거나 형식 버전이 다르면 호출하는 쪽이 경고만 하고 평소처럼 연다.
 */
export function parseEmbed(text) {
  let v;
  try {
    v = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'json' };
  }
  const isDoc = (d) => d && typeof d === 'object' && d.universe && typeof d.universe === 'object' && typeof d.universe.id === 'string' && d.universe.id !== '';
  if (!v || typeof v !== 'object' || v.format !== EMBED_FORMAT || !Array.isArray(v.docs) || !v.docs.length || !v.docs.every(isDoc) || typeof v.root !== 'string' || !v.docs.some((d) => d.universe.id === v.root)) {
    return { ok: false, reason: 'shape' };
  }
  if (v.version !== EMBED_VERSION || v.docs.some((d) => d.schema_version !== SCHEMA_VERSION)) return { ok: false, reason: 'version' };
  return { ok: true, embed: v };
}

/** HTML 글 안의 내장 데이터를 읽는다(테스트·점검용). 없으면 null */
export function readEmbedFromHtml(html) {
  const i = html.indexOf(OPEN);
  if (i < 0) return null;
  const j = html.indexOf(CLOSE, i);
  if (j < 0) return null;
  const r = parseEmbed(html.slice(i + OPEN.length, j));
  return r.ok ? r.embed : null;
}

export function embedFileName(universeFileName) {
  return universeFileName.replace(/\.json$/i, '') + '.html';
}
