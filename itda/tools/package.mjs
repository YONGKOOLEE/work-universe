// 제출 묶음(CR-24 T-56): release/업무잇다-제출본-YYYYMMDD-커밋.zip
// 사용: node tools/package.mjs [영상.mp4]   (먼저 npx vite build --mode single)
//   - 시연용 문서 PDF와 소개자료 PDF는 이 도구가 헤드리스 Chrome으로 새로 만든다(외부 통신 막음)
//   - 영상은 인자로 준 파일을 넣는다(없으면 빼고 경고)
//   - zip은 업무 유니버스 도구(tools/package.mjs의 makeZip, UTF-8 파일 이름)로 만든다
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launch, sleep } from './cdp.mjs';
import { makeZip } from '../../tools/package.mjs';

const ROOT = resolve('..');
const VIDEO = process.argv[2] ? resolve(process.argv[2]) : null;
const FOLDER = '업무잇다';
const WORK = join(ROOT, '.tmp', 'itda-package');
await mkdir(WORK, { recursive: true });

const git = (...a) => spawnSync('git', a, { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
const commit = git('rev-parse', '--short', 'HEAD');
const dirty = !!git('status', '--porcelain', '--', 'itda/src', 'itda/index.html', 'itda/package.json', 'docs/submission');
const now = new Date();
const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;

// 1) 시연용 문서 PDF
const demoOut = join(WORK, 'demo-docs');
const r = spawnSync(process.execPath, ['tools/make-demo-pdfs.mjs', demoOut, '9866'], { encoding: 'utf8' });
if (r.status !== 0) throw new Error(`시연용 PDF 실패: ${r.stderr || r.stdout}`);
// 2) 소개자료 PDF
const b = await launch({ port: 9867, profile: join(ROOT, '.tmp', 'itda-prof-9867') });
let introPdf;
try {
  await b.cdp.send('Page.navigate', { url: pathToFileURL(join(ROOT, 'docs/submission/intro-itda/소개자료.html')).href });
  await sleep(1500);
  const { data } = await b.cdp.send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true });
  introPdf = Buffer.from(data, 'base64');
} finally {
  await b.close();
}
// 3) 라이선스 목록(함께 넣은 라이브러리)
const LIBS = [
  ['react', 'itda'], ['react-dom', 'itda'], ['scheduler', 'itda'], ['lucide-react', 'itda'], ['pdfjs-dist', 'itda'], ['fflate', 'itda'],
  ['cytoscape', 'root'], ['@anthropic-ai/sdk', 'root'], ['tailwindcss', 'itda'],
];
const lic = [];
for (const [name, where] of LIBS) {
  const dir = where === 'root' ? join(ROOT, 'node_modules', name) : join(ROOT, 'itda', 'node_modules', name);
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const file = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license'].map((f) => join(dir, f)).find((f) => existsSync(f));
  lic.push(`==== ${name} ${pkg.version} (${pkg.license}) ====\n${file ? readFileSync(file, 'utf8').trim() : '(라이선스 파일 없음 — package.json 기준)'}\n`);
}
const licText = `업무잇다에 함께 넣은 공개 라이브러리(빌드 결과 업무잇다.html 안에 포함)\n만든 날: ${now.toISOString().slice(0, 10)} · 커밋 ${commit}\n\n${lic.join('\n')}`;

// 4) 묶기
const crlfBom = (t) => Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(t.replace(/\r?\n/g, '\r\n'), 'utf8')]);
const entries = [
  { name: `${FOLDER}/00_먼저_읽어주세요.txt`, data: crlfBom(await readFile(join(ROOT, 'docs/submission/itda-먼저읽어주세요.txt'), 'utf8')) },
  { name: `${FOLDER}/업무잇다.html`, data: await readFile(join(ROOT, 'itda/dist-single/index.html')) },
  { name: `${FOLDER}/업무잇다_소개자료.pdf`, data: introPdf },
  ...['비대면 출금동의 추진 현황 보고(시연용).pdf', '참가기관 업무협의회 회의록(시연용).pdf', '약관 개정 실무 회의록(시연용).pdf'].map((f) => ({ name: `${FOLDER}/시연용_문서/${f}`, data: readFileSync(join(demoOut, f)) })),
  { name: `${FOLDER}/THIRD_PARTY_LICENSES.txt`, data: crlfBom(licText) },
];
if (VIDEO && existsSync(VIDEO)) entries.push({ name: `${FOLDER}/업무잇다_시연영상.mp4`, data: readFileSync(VIDEO) });
else console.warn('경고: 영상이 없어 빼고 묶음(인자로 mp4 경로를 주세요)');
await mkdir(join(ROOT, 'release'), { recursive: true });
const out = join(ROOT, 'release', `업무잇다-제출본-${stamp}-${commit}${dirty ? '-작업중' : ''}.zip`);
const zip = makeZip(entries, now);
await writeFile(out, zip);
console.log(JSON.stringify({ out, bytes: zip.length, files: entries.map((e) => `${e.name} (${e.data.length})`), dirty }, null, 1));
