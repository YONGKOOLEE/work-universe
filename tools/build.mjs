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

// 제3자 라이선스 고지: 번들에 실제로 들어가는 패키지(esbuild metafile로 확인, RV10S-3)를 모두 적는다. 파일 하나만 전달돼도 고지가 따라가도록 HTML 주석으로도 넣는다.
//   Cytoscape.js MIT · @anthropic-ai/sdk Apache-2.0(+이전 판 MIT, LICENSE-MIT) · @opentelemetry/api Apache-2.0 · @stablelib/base64 MIT · fast-sha256 Unlicense · standardwebhooks MIT
//   standardwebhooks 패키지에는 LICENSE 파일이 없고(package.json license: MIT만), SDK의 _vendor/partial-json-parser는 별도 LICENSE·출처 표시가 없다 → 있는 그대로 적고 미확인으로 남긴다
// files: 패키지 폴더의 라이선스 파일들(없는 것은 건너뛰고), note: 파일로 확인하지 못한 사항
const third = async (dir, label, license, { files = ['LICENSE'], note = '' } = {}) => {
  const version = JSON.parse(await readFile(join(root, 'node_modules', dir, 'package.json'), 'utf8')).version;
  const texts = [];
  for (const f of files) texts.push(await readFile(join(root, 'node_modules', dir, f), 'utf8'));
  return `${label} ${version} (${license})\n\n${[note, ...texts].filter(Boolean).join('\n\n')}`;
};
const notice = [
  await third('cytoscape', 'Cytoscape.js', 'MIT'),
  await third('@anthropic-ai/sdk', '@anthropic-ai/sdk', 'Apache-2.0', {
    files: ['LICENSE', 'LICENSE-MIT'],
    note: '아래 LICENSE-MIT는 1.0.0 이전 판과 그 이전에 합쳐진 외부 기여분에 적용된다. SDK 안의 _vendor/partial-json-parser는 별도 라이선스 파일이 없어 출처·라이선스를 확인하지 못했다(SDK와 함께 배포됨, 미확인).',
  }),
  await third('@opentelemetry/api', '@opentelemetry/api', 'Apache-2.0'),
  await third('@stablelib/base64', '@stablelib/base64', 'MIT'),
  await third('fast-sha256', 'fast-sha256', 'Unlicense'),
  await third('standardwebhooks', 'standardwebhooks', 'MIT', { files: [], note: '이 패키지에는 LICENSE 파일이 없다. package.json의 license 필드가 MIT이며 저작권자 표기는 확인하지 못했다(미확인).' }),
].join('\n\n----------------------------------------\n\n');
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
