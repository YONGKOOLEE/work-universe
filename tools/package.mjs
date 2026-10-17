// T-15 제출 압축(03-plan 1.2 배포: dist/ + 실행 안내 1쪽을 압축). 새 도구 없이 Node 기본 기능(zlib)으로 zip을 만든다.
// 사용: npm run build && npm run package  → release/업무유니버스-제출본-YYYYMMDD-커밋.zip
// 이름에 커밋 번호를 넣어 같은 날 다시 만들어도 앞 판을 덮어쓰지 않고, 어느 커밋 판인지 알 수 있게 한다(2026-10-17 검토).
// 커밋하지 않은 변경(app·docs/submission·tools·package.json)이 있으면 이름 끝에 -작업중을 붙인다(제출 점검은 이때 실패)
// 압축 안 구성: 업무유니버스/index.html, 업무유니버스/실행안내.html, 업무유니버스/THIRD_PARTY_LICENSES.txt
import { spawnSync } from 'node:child_process';
import { deflateRawSync, crc32 } from 'node:zlib';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const FOLDER = '업무유니버스';
export const FILES = [
  { from: 'dist/index.html', to: `${FOLDER}/index.html` },
  { from: 'docs/submission/실행안내.html', to: `${FOLDER}/실행안내.html` },
  { from: 'dist/THIRD_PARTY_LICENSES.txt', to: `${FOLDER}/THIRD_PARTY_LICENSES.txt` },
];

// DOS 날짜·시각(zip 헤더 형식)
function dosTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

/** 파일 목록 [{name, data}]으로 zip 바이트를 만든다(deflate, UTF-8 파일 이름 표시) */
export function makeZip(entries, when = new Date()) {
  const { time, date } = dosTime(when);
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data);
    const packed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // 필요한 버전
    local.writeUInt16LE(0x0800, 6); // 비트 11: 파일 이름 UTF-8
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, packed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + packed.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

async function newestMtime(dirs) {
  let max = 0;
  for (const d of dirs) {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      max = Math.max(max, e.isDirectory() ? await newestMtime([p]) : (await stat(p)).mtimeMs);
    }
  }
  return max;
}

/** 지금 커밋 번호(짧게)와, 제출물에 들어가는 영역에 커밋하지 않은 변경이 있는지 */
export function gitState() {
  const git = (args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  const head = git(['rev-parse', '--short', 'HEAD']);
  const st = git(['status', '--porcelain', '--', 'app', 'docs/submission', 'tools', 'package.json']);
  return { commit: head.status === 0 ? head.stdout.trim() : 'nogit', dirty: st.status !== 0 || st.stdout.trim() !== '' };
}

/** 제출 압축을 만든다. 반환: {path, bytes, files, stale(dist가 app 소스보다 오래됨), commit, dirty} */
export async function buildPackage(now = new Date()) {
  const entries = [];
  for (const f of FILES) entries.push({ name: f.to, data: await readFile(join(root, f.from)) });
  // dist가 소스보다 오래되면 경고(빌드를 잊은 경우, 검토3 LLM-2)
  const distTime = (await stat(join(root, 'dist/index.html'))).mtimeMs;
  const newest = await newestMtime([join(root, 'app')]);
  const stale = newest > distTime;
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const { commit, dirty } = gitState();
  const out = join(root, 'release', `업무유니버스-제출본-${stamp}-${commit}${dirty ? '-작업중' : ''}.zip`);
  await mkdir(dirname(out), { recursive: true });
  const zip = makeZip(entries, now);
  await writeFile(out, zip);
  return { path: out, bytes: zip.length, files: FILES.map((f) => f.to), stale, commit, dirty };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const r = await buildPackage();
  console.log(`제출 압축: ${r.path}`);
  console.log(`크기: ${r.bytes}바이트(${(r.bytes / 1024).toFixed(0)} KB)`);
  for (const f of r.files) console.log(`  - ${f}`);
  if (r.dirty) console.log('경고: 커밋하지 않은 변경이 있어 이름에 -작업중을 붙였습니다. 제출본은 커밋한 뒤 다시 만드세요.');
  if (r.stale) console.log('경고: dist/index.html이 app/ 소스보다 오래되었습니다. npm run build를 먼저 실행하세요.');
}
