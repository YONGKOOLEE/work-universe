// 제출 전 비밀값 점검(R-15 ③, 02-design 5.4): 소스·빌드 결과·문서에서 API 키 형식 문자열을 찾는다. 0건이어야 통과.
// 사용: npm run build && node tools/secret-scan.mjs   (T-15 제출 점검에서 다시 쓴다)
//   push 전: node tools/secret-scan.mjs --history origin/main..HEAD   (git log -p 출력에서 추가된 줄만 검사. 범위 없이 --history만 쓰면 HEAD 전체 이력)
// 시험 파일(tests/)은 통째로 빼지 않는다. 같은 줄에 가짜 값 표지(「가짜 키」「가짜 값」「fake key」)가 있는 줄만 건너뛴다(RV10S-12).
// 찾은 값은 화면에 그대로 출력하지 않는다(앞 6자만 보이고 나머지는 가린다).
import { execFileSync } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SECRET_PATTERNS = [
  ['Anthropic API 키', /sk-ant-[A-Za-z0-9_-]{20,}/g],
  ['일반 API 키(sk-, sk-proj- 등)', /\bsk-(?!ant-)[A-Za-z0-9_-]{32,}/g],
  ['Google API 키', /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ['키 헤더에 넣은 값', /x-api-key["'\s:=]+["'][A-Za-z0-9_-]{20,}["']/gi],
  ['Bearer 토큰', /Bearer\s+[A-Za-z0-9._-]{30,}/g],
  ['AWS 액세스 키', /\bAKIA[0-9A-Z]{16}\b/g],
  ['GitHub 토큰', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})/g],
  ['Slack 토큰', /\bxox[baprs]-[A-Za-z0-9-]{10,}/g],
  ['api_key 대입(긴 값)', /api[_-]?key\s*[:=]\s*['"][A-Za-z0-9_-]{16,}/gi],
];

const SKIP_DIRS = new Set(['node_modules', '.git', '.tmp']);
// .ps1·.yml·.env 같은 설정·스크립트도 본다. 점으로 시작하는 .env* 파일과 .status는 이름으로 고른다
const TEXT_EXT = /\.(m?js|cjs|html|md|json|txt|css|status|ps1|psm1|sh|bat|cmd|ya?ml|toml|ini|cfg|conf|env|properties|csv)$/i;
const TEXT_NAME = /^(\.status|\.env(\..+)?)$/i;
const FAKE_MARK = /가짜\s*(키|값)|fake[\s_-]*(key|value)/i;

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else if (TEXT_EXT.test(entry.name) || TEXT_NAME.test(entry.name)) yield p;
  }
}

/** 시험 파일(tests/ 아래)에서 가짜 값 표지가 있는 줄 */
export const isFakeKeyLine = (line) => FAKE_MARK.test(line);

const mask = (s) => `${s.slice(0, 6)}…(${s.length}자)`;

/** 텍스트에서 비밀값 형식을 찾는다. 테스트에서도 쓴다 */
export function scanText(text) {
  const hits = [];
  for (const [rule, re] of SECRET_PATTERNS) {
    for (const m of text.matchAll(re)) hits.push({ rule, value: mask(m[0]), index: m.index });
  }
  return hits;
}

/** 파일 하나를 검사한다. tests/ 아래 파일은 가짜 값 표지가 있는 줄만 뺀다 */
export function scanFile(relPath, text) {
  const isTest = /(^|[\\/])tests[\\/]/.test(relPath);
  if (!isTest) return scanText(text);
  const lines = text.split('\n').map((l) => (isFakeKeyLine(l) ? '' : l));
  return scanText(lines.join('\n'));
}

/**
 * git log -p 출력에서 추가된 줄(+)만 검사한다. 커밋(앞 8자)과 파일 이름을 함께 돌려준다.
 * 시험 파일의 가짜 값 표지 줄은 scanFile과 같이 뺀다.
 */
export function scanHistory(logText) {
  const hits = [];
  let commit = '';
  let file = '';
  for (const line of String(logText).split('\n')) {
    const c = /^commit ([0-9a-f]{40})/.exec(line);
    if (c) { commit = c[1].slice(0, 8); file = ''; continue; }
    const f = /^\+\+\+ b\/(.+)$/.exec(line);
    if (f) { file = f[1].replace(/\r$/, ''); continue; }
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    const body = line.slice(1);
    if (/(^|\/)tests\//.test(file) && isFakeKeyLine(body)) continue;
    for (const h of scanText(body)) hits.push({ commit, file, rule: h.rule, value: h.value });
  }
  return hits;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
  const hi = process.argv.indexOf('--history');
  if (hi >= 0) {
    const range = process.argv[hi + 1] && !process.argv[hi + 1].startsWith('--') ? process.argv[hi + 1] : 'HEAD';
    let log;
    try {
      log = execFileSync('git', ['-c', 'core.quotepath=off', 'log', '-p', '--no-color', '--no-ext-diff', range, '--'], { cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024 });
    } catch (e) {
      console.error(`git log 실패(범위: ${range}): ${String((e && e.message) || e).split('\n')[0]}`);
      process.exit(2);
    }
    const found = scanHistory(log);
    console.log(`이력 검사: ${range} (커밋 ${(log.match(/^commit [0-9a-f]{40}/gm) || []).length}개, 추가된 줄만)`);
    for (const h of found) console.log(`  - ${h.commit} ${h.file}: ${h.rule} ${h.value}`);
    console.log(found.length ? `\n이력에 비밀값 의심 ${found.length}건 — push 불가` : '\n이력 비밀값 형식 0건');
    process.exit(found.length ? 1 : 0);
  }
  // 점으로 시작하는 폴더(.github·.claude)와 저장소 맨 위의 설정 파일(.env*·*.yml …)도 본다
  const top = (await readdir(root, { withFileTypes: true })).filter((e) => (e.isDirectory() ? /^\.(github|claude)$/.test(e.name) : (TEXT_EXT.test(e.name) || TEXT_NAME.test(e.name)))).map((e) => e.name);
  const targets = [...new Set(['app', 'dist', 'docs', 'tools', 'tests', 'README.md', 'CLAUDE.md', 'package.json', ...top])];
  let files = 0;
  const found = [];
  for (const t of targets) {
    const p = join(root, t);
    let st;
    try { st = await stat(p); } catch { continue; }
    const list = st.isDirectory() ? walk(p) : [p];
    for await (const f of list) {
      files += 1;
      for (const h of scanFile(relative(root, f), await readFile(f, 'utf8'))) found.push({ file: relative(root, f), ...h });
    }
  }
  console.log(`검사한 파일 ${files}개 (dist 포함 여부: ${await stat(join(root, 'dist')).then(() => '포함', () => '없음 — 먼저 npm run build')})`);
  for (const h of found) console.log(`  - ${h.file}: ${h.rule} ${h.value}`);
  console.log(found.length ? `\n비밀값 의심 ${found.length}건 — 제출 불가` : '\n비밀값 형식 0건');
  process.exit(found.length ? 1 : 0);
}
