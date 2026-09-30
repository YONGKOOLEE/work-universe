// 빌드: app/src(ES 모듈) → dist/app.js(모듈 없는 IIFE 단일 스크립트) + dist/index.html (P-1)
import { build } from 'esbuild';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

await build({
  entryPoints: [join(root, 'app/src/ui/main.js')],
  outfile: join(dist, 'app.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome110', 'edge110', 'firefox110', 'safari16'],
  minify: true,
  legalComments: 'eof',
  charset: 'utf8',
  logLevel: 'warning',
});

await copyFile(join(root, 'app/index.html'), join(dist, 'index.html'));

// 제3자 라이선스 고지(Cytoscape.js, MIT)
const cyLicense = await readFile(join(root, 'node_modules/cytoscape/LICENSE'), 'utf8');
const cyVersion = JSON.parse(await readFile(join(root, 'node_modules/cytoscape/package.json'), 'utf8')).version;
await writeFile(join(dist, 'THIRD_PARTY_LICENSES.txt'), `Cytoscape.js ${cyVersion} (MIT)\n\n${cyLicense}`);

// P-1 제약 점검: 실행 파일에 모듈 스크립트·로컬 fetch가 없어야 한다
const html = await readFile(join(dist, 'index.html'), 'utf8');
const js = await readFile(join(dist, 'app.js'), 'utf8');
const problems = [];
if (/type\s*=\s*["']module["']/i.test(html)) problems.push('index.html에 type="module"이 있음');
if (/^\s*(import|export)\s/m.test(js)) problems.push('app.js에 import/export 문이 남아 있음');
if (/\bfetch\s*\(/.test(js)) problems.push('app.js에 fetch( 호출이 있음');
if (problems.length) {
  console.error('빌드 점검 실패:\n- ' + problems.join('\n- '));
  process.exit(1);
}
console.log(`빌드 완료: dist/index.html, dist/app.js (${(js.length / 1024).toFixed(0)} KB)`);
