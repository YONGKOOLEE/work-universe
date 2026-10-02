// T-15 제출 점검 자동화(03-plan T-15, R-10, R-06, R-15 ③). 사람이 해야 하는 것(깨끗한 PC, 메일 발송)은 마지막에 따로 알린다.
// 사용: npm run check:submit            (브라우저 점검 포함, 몇 분 걸림)
//       npm run check:submit -- --quick (브라우저 점검 생략)
// 순서: 빌드 → 단위 테스트 → 비밀값(소스·dist) → R-06 형식 → 압축 → 압축 풀기(새 폴더) → 풀린 파일 비교·비밀값
//       → 풀린 index.html을 새 브라우저 프로필로 열어 전체 브라우저 점검(이 PC에서 "깨끗한 환경"을 흉내)
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SAMPLES } from '../app/data/index.js';
import { scanVirtualData } from './virtual-data-check.mjs';
import { scanText } from './secret-scan.mjs';
import { FILES, FOLDER, buildPackage } from './package.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const quick = process.argv.includes('--quick');
const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`);
};
const run = (args, env = {}) => spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024 });

// 1) 빌드
const b = run(['tools/build.mjs']);
record('빌드(dist/index.html 하나, type=module·fetch 없음 검사 포함)', b.status === 0, (b.stdout.match(/\d[\d,]* ?바이트|\(\d+ KB[^)]*\)/) || [''])[0]);

// 2) 단위 테스트
const t = run(['--test', 'tests/**/*.test.js']);
const passLine = (t.stdout.match(/ℹ pass (\d+)/) || [])[1];
const failLine = (t.stdout.match(/ℹ fail (\d+)/) || [])[1];
record('단위 테스트', t.status === 0 && failLine === '0', `통과 ${passLine}, 실패 ${failLine}`);

// 3) 비밀값(R-15 ③)
const s = run(['tools/secret-scan.mjs']);
record('비밀값 형식 0건(소스·문서·dist)', s.status === 0 && /0건/.test(s.stdout), s.stdout.trim().split('\n').pop());

// 4) R-06 형식
const r06 = SAMPLES.flatMap((d) => scanVirtualData(d).map((p) => `${d.universe.id}:${p.rule}`));
record(`R-06 형식 점검(내장 샘플 ${SAMPLES.length}개)`, r06.length === 0, r06.slice(0, 3).join(', '));

// 5) 압축
const pkg = await buildPackage();
record('제출 압축 만들기', pkg.bytes > 0, `${pkg.path.replace(root, '.')} ${pkg.bytes}바이트`);

// 6) 압축 풀기 → 파일 비교. Windows 탐색기와 같은 계열인 PowerShell Expand-Archive(.NET)로 푼다(zip 작성 코드와 별개 구현으로 검증)
const out = join(root, '.tmp', 'submit-extract');
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
const x = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${pkg.path}' -DestinationPath '${out}' -Force`], { encoding: 'utf8' });
let same = x.status === 0;
const extracted = same ? await readdir(join(out, FOLDER)).catch(() => []) : [];
for (const f of FILES) {
  try {
    const a = await readFile(join(root, f.from));
    const c = await readFile(join(out, f.to));
    if (!a.equals(c)) same = false;
  } catch {
    same = false;
  }
}
record('압축을 풀면 원본과 같은 파일 3개(한글 폴더 이름 포함)', same && extracted.length === FILES.length, extracted.join(', ') || x.stderr);

// 7) 풀린 파일의 비밀값
let leaks = 0;
for (const f of FILES) leaks += scanText(await readFile(join(out, f.to), 'utf8').catch(() => '')).length;
record('풀린 제출 파일의 비밀값 형식 0건', leaks === 0, String(leaks));

// 8) 풀린 index.html로 전체 브라우저 점검(새 프로필 = 저장소가 빈 상태)
if (!quick) {
  const page = join(out, FOLDER, 'index.html');
  const bc = run(['tools/browser-check.mjs'], { PAGE: page });
  const fails = (bc.stdout.match(/^FAIL .*$/gm) || []);
  record('풀린 index.html로 Chrome·Edge 전체 점검(새 프로필)', bc.status === 0 && /모두 통과/.test(bc.stdout), fails.slice(0, 3).join(' | '));
} else {
  record('브라우저 점검(--quick이라 생략)', true, '미실행');
}

const failed = results.filter((r) => !r.ok);
console.log(`\n자동 점검: ${results.length - failed.length}/${results.length} 통과`);
console.log('\n사람이 해야 하는 것(자동으로 확인할 수 없음, 03-plan T-15·K-6):');
console.log('  1. 다른 PC(가능하면 조력자 PC)에서 압축을 풀고 index.html 더블클릭 → 실행 안내의 "5분 둘러보기" 그대로 해 보기');
console.log('  2. 압축 파일을 자기 메일이나 조력자에게 보내 첨부가 막히지 않는지 확인');
console.log('  3. 실행안내.html을 열어 1쪽 분량·문구 확인');
process.exit(failed.length ? 1 : 0);
