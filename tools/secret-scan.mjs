// 제출 전 비밀값 점검(R-15 ③, 02-design 5.4): 소스·빌드 결과·문서에서 API 키 형식 문자열을 찾는다. 0건이어야 통과.
// 사용: npm run build && node tools/secret-scan.mjs   (T-15 제출 점검에서 다시 쓴다)
// 찾은 값은 화면에 그대로 출력하지 않는다(앞 6자만 보이고 나머지는 가린다).
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SECRET_PATTERNS = [
  ['Anthropic API 키', /sk-ant-[A-Za-z0-9_-]{20,}/g],
  ['일반 API 키(sk-)', /\bsk-[A-Za-z0-9]{32,}\b/g],
  ['키 헤더에 넣은 값', /x-api-key["'\s:=]+["'][A-Za-z0-9_-]{20,}["']/gi],
  ['Bearer 토큰', /Bearer\s+[A-Za-z0-9._-]{30,}/g],
  ['AWS 액세스 키', /\bAKIA[0-9A-Z]{16}\b/g],
];

const SKIP_DIRS = new Set(['node_modules', '.git', '.tmp']);
const TEXT_EXT = /\.(m?js|cjs|html|md|json|txt|css|status)$/i;

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else if (TEXT_EXT.test(entry.name) || entry.name === '.status') yield p;
  }
}

const mask = (s) => `${s.slice(0, 6)}…(${s.length}자)`;

/** 텍스트에서 비밀값 형식을 찾는다. 테스트에서도 쓴다 */
export function scanText(text) {
  const hits = [];
  for (const [rule, re] of SECRET_PATTERNS) {
    for (const m of text.matchAll(re)) hits.push({ rule, value: mask(m[0]), index: m.index });
  }
  return hits;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
  const targets = ['app', 'dist', 'docs', 'tools', 'tests', 'README.md', 'CLAUDE.md', 'package.json'];
  let files = 0;
  const found = [];
  for (const t of targets) {
    const p = join(root, t);
    let st;
    try { st = await stat(p); } catch { continue; }
    const list = st.isDirectory() ? walk(p) : [p];
    for await (const f of list) {
      files += 1;
      // 이 점검 도구 자신의 패턴 정의와 테스트의 가짜 키는 뺀다
      if (/secret-scan\.(mjs|test\.js)$/.test(f)) continue;
      for (const h of scanText(await readFile(f, 'utf8'))) found.push({ file: relative(root, f), ...h });
    }
  }
  console.log(`검사한 파일 ${files}개 (dist 포함 여부: ${await stat(join(root, 'dist')).then(() => '포함', () => '없음 — 먼저 npm run build')})`);
  for (const h of found) console.log(`  - ${h.file}: ${h.rule} ${h.value}`);
  console.log(found.length ? `\n비밀값 의심 ${found.length}건 — 제출 불가` : '\n비밀값 형식 0건');
  process.exit(found.length ? 1 : 0);
}
