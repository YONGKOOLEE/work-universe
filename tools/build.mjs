// 빌드: app/src(ES 모듈) → 모듈 없는 IIFE 스크립트를 HTML 안에 넣은 파일 하나(dist/index.html) (P-1, 02-design 5.1)
// 파일 하나만 보내도 동작하게 하려고 스크립트를 따로 두지 않는다(2026-10-01, 조력자 전달 시 app.js 누락·버전 섞임 문제).
// 번들에는 공식 SDK(@anthropic-ai/sdk, CR-15)가 들어가므로 fetch 검사는 번들이 아니라 우리 소스(app/src)에서 한다.
import { build, transform } from 'esbuild';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
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

// 제3자 라이선스 고지(Cytoscape.js MIT, @anthropic-ai/sdk Apache-2.0): 파일 하나만 전달돼도 고지가 따라가도록 HTML 주석으로도 넣는다
const third = async (dir, label, license) => {
  const text = await readFile(join(root, 'node_modules', dir, 'LICENSE'), 'utf8');
  const version = JSON.parse(await readFile(join(root, 'node_modules', dir, 'package.json'), 'utf8')).version;
  return `${label} ${version} (${license})\n\n${text}`;
};
const notice = [await third('cytoscape', 'Cytoscape.js', 'MIT'), await third('@anthropic-ai/sdk', '@anthropic-ai/sdk', 'Apache-2.0')].join('\n\n----------------------------------------\n\n');
await writeFile(join(dist, 'THIRD_PARTY_LICENSES.txt'), notice);

// P-1 제약 점검: 실행 파일에 모듈 스크립트·로컬 fetch가 없어야 한다
const template = await readFile(join(root, 'app/index.html'), 'utf8');
const problems = [];
if (/type\s*=\s*["']module["']/i.test(template)) problems.push('index.html에 type="module"이 있음');
if (/^\s*(import|export)\s/m.test(js)) problems.push('스크립트에 import/export 문이 남아 있음');
// 우리 소스(app/src/**/*.js)에는 fetch( 호출이 없어야 한다. 네트워크는 llm/providers.js가 공식 SDK로만 부른다(주석은 빼고 검사).
// 번들에는 SDK가 들어가 SDK 안의 fetch는 번들 전체로는 검사할 수 없다(CR-15, D-33)
for (const rel of await readdir(join(root, 'app/src'), { recursive: true })) {
  if (!rel.endsWith('.js')) continue;
  const code = (await transform(await readFile(join(root, 'app/src', rel), 'utf8'), { minify: true, loader: 'js' })).code;
  if (/\bfetch\s*\(/.test(code)) problems.push(`app/src/${rel.replace(/\\/g, '/')}에 fetch( 호출이 있음(네트워크는 SDK로만)`);
}
if (!template.includes('<script src="app.js"></script>')) problems.push('index.html에 스크립트 자리(<script src="app.js">)가 없음');
// CSP: 외부 요청은 Anthropic API 한 곳만 허용한다(D2-9 → CR-15). 다른 출처가 끼거나 없으면 실패
const csp = (/http-equiv="Content-Security-Policy"[^>]*content="([^"]*)"/.exec(template) || [])[1] || '';
const connect = (/(?:^|;)\s*connect-src ([^;]*)/.exec(csp) || [])[1];
if (connect !== 'https://api.anthropic.com') problems.push(`index.html의 CSP connect-src가 https://api.anthropic.com 하나가 아님(지금: ${connect === undefined ? '없음' : connect})(D2-9, CR-15)`);
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
console.log(`스크립트(SDK 포함): ${(Buffer.byteLength(js, 'utf8') / 1024).toFixed(0)} KB`);
console.log(`빌드 완료: dist/index.html 하나 (${(Buffer.byteLength(html, 'utf8') / 1024).toFixed(0)} KB = ${Buffer.byteLength(html, 'utf8')}바이트, 스크립트 포함)`);
