// 빌드: app/src(ES 모듈) → 모듈 없는 IIFE 스크립트를 HTML 안에 넣은 파일 하나(dist/index.html) (P-1, 02-design 5.1)
// 파일 하나만 보내도 동작하게 하려고 스크립트를 따로 두지 않는다(2026-10-01, 조력자 전달 시 app.js 누락·버전 섞임 문제).
import { build } from 'esbuild';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const result = await build({
  entryPoints: [join(root, 'app/src/ui/main.js')],
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  target: ['chrome110', 'edge110', 'firefox110', 'safari16'],
  minify: true,
  legalComments: 'eof',
  charset: 'utf8',
  logLevel: 'warning',
});
const js = result.outputFiles[0].text;

// 제3자 라이선스 고지(Cytoscape.js, MIT): 파일 하나만 전달돼도 고지가 따라가도록 HTML 주석으로도 넣는다
const cyLicense = await readFile(join(root, 'node_modules/cytoscape/LICENSE'), 'utf8');
const cyVersion = JSON.parse(await readFile(join(root, 'node_modules/cytoscape/package.json'), 'utf8')).version;
const notice = `Cytoscape.js ${cyVersion} (MIT)\n\n${cyLicense}`;
await writeFile(join(dist, 'THIRD_PARTY_LICENSES.txt'), notice);

// P-1 제약 점검: 실행 파일에 모듈 스크립트·로컬 fetch가 없어야 한다
const template = await readFile(join(root, 'app/index.html'), 'utf8');
const problems = [];
if (/type\s*=\s*["']module["']/i.test(template)) problems.push('index.html에 type="module"이 있음');
if (/^\s*(import|export)\s/m.test(js)) problems.push('스크립트에 import/export 문이 남아 있음');
if (/\bfetch\s*\(/.test(js)) problems.push('스크립트에 fetch( 호출이 있음');
if (!template.includes('<script src="app.js"></script>')) problems.push('index.html에 스크립트 자리(<script src="app.js">)가 없음');
if (problems.length) {
  console.error('빌드 점검 실패:\n- ' + problems.join('\n- '));
  process.exit(1);
}

// 스크립트 안의 "</script"가 HTML 파서를 끊지 않도록 바꾼다(JS 문자열 의미는 같다)
const inline = js.replace(/<\/script/gi, '<\\/script');
const html = template
  .replace('<script src="app.js"></script>', () => `<script>\n${inline}</script>`)
  .replace('<!doctype html>', () => `<!doctype html>\n<!--\n${notice.replace(/--/g, '- -')}\n-->`);
await writeFile(join(dist, 'index.html'), html);
console.log(`빌드 완료: dist/index.html 하나 (${(html.length / 1024).toFixed(0)} KB, 스크립트 포함)`);
