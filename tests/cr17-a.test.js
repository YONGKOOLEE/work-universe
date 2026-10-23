// CR-17 A(초안): 단추·창 이름의 「유니버스」 → 「업무 지도」. 화면에 보이는 글에 옛 이름이 남지 않았는지 소스에서 확인한다.
// 되돌리기: 이 시험의 NEW_NAMES 표와 옛 이름 표(커밋 설명)대로 거꾸로 바꾸면 된다. 제품 이름 「업무 UNIVERSE」·data-testid·id·저장 형식 낱말은 그대로다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = fileURLToPath(new URL('../app/', import.meta.url));
const NEW_NAMES = ['새 업무 지도', '업무 지도 묶기', '업무 지도 선택', '새 업무 지도 만들기', '사람·업무·문서 추가'];
// 옛 이름이 남아도 되는 곳(화면 글이 아님): 제품 이름, LLM 지시문·파싱 키
const ALLOWED = new Set(['index.html:<title>업무 유니버스</title>']);
const ALLOWED_FILES = new Set(['src/llm/prompts.js']);

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.(js|html)$/.test(e.name)) out.push(p);
  }
  return out;
}

// 줄 주석 제거(따옴표 밖 " //" 이후)와 주석만 있는 줄 건너뛰기 — 화면 글이 아닌 설명은 센 대상이 아니다
function visibleLine(l) {
  const s = l.trim();
  if (/^(\/\/|\*|\/\*)/.test(s)) return '';
  let out = '';
  let q = null;
  for (let k = 0; k < s.length; k += 1) {
    const c = s[k];
    if (q) { out += c; if (c === '\\') { out += s[k + 1] ?? ''; k += 1; } else if (c === q) q = null; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; out += c; continue; }
    if (c === '/' && s[k + 1] === '/' && (k === 0 || /\s/.test(s[k - 1]))) break;
    out += c;
  }
  return out.replace(/\/\*.*?\*\//g, '').replace(/<!--.*?-->/g, '');
}

test('CR-17 A: 화면에 보이는 글(app/index.html·app/src)에 옛 이름 「유니버스」·「노드 추가」가 남지 않았다', () => {
  const left = [];
  for (const f of walk(APP)) {
    const rel = relative(APP, f).replace(/\\/g, '/');
    if (rel.startsWith('data/') || ALLOWED_FILES.has(rel)) continue;
    readFileSync(f, 'utf8').split(/\r?\n/).forEach((l, i) => {
      const v = visibleLine(l);
      if (!/유니버스|노드 추가/.test(v)) return;
      if (ALLOWED.has(`${rel}:${l.trim()}`)) return;
      if (rel === 'src/llm/ai-convert.js' && /유니버스\(문서\) 이름/.test(v)) return; // LLM 출력 틀 설명
      left.push(`${rel}:${i + 1}: ${l.trim().slice(0, 80)}`);
    });
  }
  assert.deepEqual(left, []);
});

test('CR-17 A: 머리글·시작 화면·추가 칸에 새 이름이 있다(data-testid·id는 그대로)', () => {
  const html = readFileSync(join(APP, 'index.html'), 'utf8');
  const start = readFileSync(join(APP, 'src/ui/start.js'), 'utf8');
  for (const n of ['새 업무 지도', '업무 지도 묶기', '사람·업무·문서 추가']) assert.ok(html.includes(n), n);
  assert.ok(html.includes('aria-label="업무 지도 선택"'));
  assert.ok(start.includes('새 업무 지도 만들기'));
  for (const id of ['universe-picker', 'create-open', 'group-open']) assert.ok(html.includes(`id="${id}"`), id); // id는 바뀌지 않는다
  for (const n of NEW_NAMES) assert.ok(`${html}${start}`.includes(n), n);
});
