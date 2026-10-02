// T-15 제출 압축(03-plan 1.2 배포: dist/ + 실행 안내 1쪽을 압축). 새 도구 없이 Node 기본 기능(zlib)으로 zip을 만든다.
// 사용: npm run build && npm run package  → release/업무유니버스-제출본-YYYYMMDD.zip
// 압축 안 구성: 업무유니버스/index.html, 업무유니버스/실행안내.html, 업무유니버스/THIRD_PARTY_LICENSES.txt
import { deflateRawSync, crc32 } from 'node:zlib';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
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

/** 제출 압축을 만든다. 반환: {path, bytes, files} */
export async function buildPackage(now = new Date()) {
  const entries = [];
  for (const f of FILES) entries.push({ name: f.to, data: await readFile(join(root, f.from)) });
  // dist가 소스보다 오래되면 경고(빌드를 잊은 경우)
  const distTime = (await stat(join(root, 'dist/index.html'))).mtimeMs;
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const out = join(root, 'release', `업무유니버스-제출본-${stamp}.zip`);
  await mkdir(dirname(out), { recursive: true });
  const zip = makeZip(entries, now);
  await writeFile(out, zip);
  return { path: out, bytes: zip.length, files: FILES.map((f) => f.to), distTime };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const r = await buildPackage();
  console.log(`제출 압축: ${r.path}`);
  console.log(`크기: ${r.bytes}바이트(${(r.bytes / 1024).toFixed(0)} KB)`);
  for (const f of r.files) console.log(`  - ${f}`);
}
