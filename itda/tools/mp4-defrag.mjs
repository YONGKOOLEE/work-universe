// 조각(fragmented) MP4를 일반 MP4로 다시 묶는다. 다시 인코딩하지 않고 영상 데이터는 그대로 옮긴다.
//   MediaRecorder가 만든 MP4는 moov에 길이·색인이 없고 moof 조각만 이어져 있어, Windows 미디어 플레이어 등에서
//   전체 시간이 안 나오고 앞뒤 이동이 안 된다. 조각의 trun을 모아 stts·stsz·stco·stss(·ctts)를 채우고 mvex를 뺀다.
//   영상 트랙 하나만 다룬다(녹화 도구 출력). 다른 구조면 멈춘다.
// 사용: node tools/mp4-defrag.mjs <입력.mp4> [출력.mp4]   (출력을 빼면 입력 옆에 -일반.mp4)
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'dinf', 'moof', 'traf']);

function boxes(buf, s = 0, e = buf.length) {
  const out = [];
  for (let p = s; p + 8 <= e; ) {
    let size = buf.readUInt32BE(p);
    const type = buf.toString('latin1', p + 4, p + 8);
    let hdr = 8;
    if (size === 1) { size = Number(buf.readBigUInt64BE(p + 8)); hdr = 16; }
    if (size === 0) size = e - p;
    if (size < hdr || p + size > e) throw new Error(`MP4 상자 크기 이상: ${type} @${p}`);
    const box = { type, start: p, body: buf.subarray(p + hdr, p + size), raw: buf.subarray(p, p + size) };
    if (CONTAINERS.has(type)) box.kids = boxes(buf, p + hdr, p + size);
    out.push(box);
    p += size;
  }
  return out;
}
const find = (list, ...path) => path.reduce((l, t) => l && (Array.isArray(l) ? l : l.kids).find((b) => b.type === t), list);

function box(type, ...parts) {
  const body = Buffer.concat(parts);
  const h = Buffer.alloc(8);
  h.writeUInt32BE(8 + body.length);
  h.write(type, 4, 'latin1');
  return Buffer.concat([h, body]);
}
const u32 = (...v) => { const b = Buffer.alloc(4 * v.length); v.forEach((x, i) => b.writeUInt32BE(x >>> 0, 4 * i)); return b; };
const full = (type, version, flags, ...parts) => box(type, u32(((version & 0xff) << 24) | (flags & 0xffffff)), ...parts);

// 조각들에서 표본(크기·길이·동기 여부·표시 시각 차·파일 위치)을 모은다
function collectSamples(buf, top, trex) {
  const samples = [];
  for (const moof of top.filter((b) => b.type === 'moof')) {
    for (const traf of moof.kids.filter((b) => b.type === 'traf')) {
      const tfhd = find(traf, 'tfhd').body;
      const tf = tfhd.readUInt32BE(0) & 0xffffff;
      let o = 8; // version/flags + track_ID
      let base = moof.start;
      if (tf & 0x1) { base = Number(tfhd.readBigUInt64BE(o)); o += 8; }
      if (tf & 0x2) o += 4;
      let defDur = trex.dur, defSize = trex.size, defFlags = trex.flags;
      if (tf & 0x8) { defDur = tfhd.readUInt32BE(o); o += 4; }
      if (tf & 0x10) { defSize = tfhd.readUInt32BE(o); o += 4; }
      if (tf & 0x20) { defFlags = tfhd.readUInt32BE(o); o += 4; }
      const tfdtBox = find(traf, 'tfdt');
      const decodeTime = tfdtBox ? (tfdtBox.body[0] ? Number(tfdtBox.body.readBigUInt64BE(4)) : tfdtBox.body.readUInt32BE(4)) : null;
      let first = true;
      let pos = null;
      for (const trun of traf.kids.filter((b) => b.type === 'trun')) {
        const t = trun.body;
        const version = t[0];
        const rf = t.readUInt32BE(0) & 0xffffff;
        const n = t.readUInt32BE(4);
        let q = 8;
        if (rf & 0x1) { pos = base + t.readInt32BE(q); q += 4; } else if (pos === null) pos = base;
        let firstFlags = null;
        if (rf & 0x4) { firstFlags = t.readUInt32BE(q); q += 4; }
        for (let i = 0; i < n; i++) {
          const dur = rf & 0x100 ? t.readUInt32BE((q += 4) - 4) : defDur;
          const size = rf & 0x200 ? t.readUInt32BE((q += 4) - 4) : defSize;
          let flags = rf & 0x400 ? t.readUInt32BE((q += 4) - 4) : defFlags;
          if (i === 0 && firstFlags !== null && !(rf & 0x400)) flags = firstFlags;
          const cto = rf & 0x800 ? (version ? t.readInt32BE((q += 4) - 4) : t.readUInt32BE((q += 4) - 4)) : 0;
          if (pos + size > buf.length) throw new Error('표본 위치가 파일 밖');
          samples.push({ dur, size, sync: !(flags & 0x10000), cto, pos, decodeTime: first ? decodeTime : null });
          first = false;
          pos += size;
        }
      }
    }
  }
  return samples;
}

export function defragMp4(buf) {
  const top = boxes(buf);
  const moov = find(top, 'moov');
  if (!moov) throw new Error('moov 없음');
  if (!top.some((b) => b.type === 'moof')) return null; // 이미 일반 MP4
  const traks = moov.kids.filter((b) => b.type === 'trak');
  if (traks.length !== 1) throw new Error(`트랙 ${traks.length}개는 지원하지 않음`);
  const mvexBox = moov.kids.find((b) => b.type === 'mvex');
  const trex = { dur: 0, size: 0, flags: 0 };
  if (mvexBox) {
    const tb = boxes(buf, mvexBox.start + 8, mvexBox.start + mvexBox.raw.length).find((b) => b.type === 'trex');
    if (tb) { trex.dur = tb.body.readUInt32BE(12); trex.size = tb.body.readUInt32BE(16); trex.flags = tb.body.readUInt32BE(20); }
  }
  const samples = collectSamples(buf, top, trex);
  if (!samples.length) throw new Error('표본 없음');
  // 조각 사이 시각(tfdt)과 길이 합이 어긋나면 조각의 마지막 표본 길이로 맞춘다
  for (let i = 0; i < samples.length; i++) {
    if (samples[i].decodeTime === null) continue;
    let j = i + 1;
    while (j < samples.length && samples[j].decodeTime === null) j++;
    if (j < samples.length) {
      const sum = samples.slice(i, j).reduce((a, s) => a + s.dur, 0);
      const gap = samples[j].decodeTime - samples[i].decodeTime;
      if (gap > 0 && gap !== sum) samples[j - 1].dur = Math.max(0, samples[j - 1].dur + gap - sum);
    }
  }
  const last = samples[samples.length - 1];
  if (!last.dur) last.dur = samples.length > 1 ? samples[samples.length - 2].dur || 1 : 1;

  const trak = traks[0];
  const mdhd = find(trak, 'mdia', 'mdhd').body;
  const mdTimescale = mdhd[0] ? mdhd.readUInt32BE(20) : mdhd.readUInt32BE(12);
  const mvhd = find(moov, 'mvhd').body;
  const mvTimescale = mvhd[0] ? mvhd.readUInt32BE(20) : mvhd.readUInt32BE(12);
  const total = samples.reduce((a, s) => a + s.dur, 0);
  const mvDur = Math.round((total * mvTimescale) / mdTimescale);
  if (total > 0xffffffff || mvDur > 0xffffffff) throw new Error('길이가 너무 김');

  // mvhd/mdhd 길이 자리: v0은 16(4바이트), v1은 24(8바이트)
  const setDur = (body, dur) => {
    const b = Buffer.from(body);
    if (b[0]) b.writeBigUInt64BE(BigInt(dur), 24); else b.writeUInt32BE(dur, 16);
    return b;
  };
  const newMvhd = setDur(mvhd, mvDur);
  const newMdhd = setDur(mdhd, total);
  const tkhd = Buffer.from(find(trak, 'tkhd').body);
  if (tkhd[0]) tkhd.writeBigUInt64BE(BigInt(mvDur), 28); else tkhd.writeUInt32BE(mvDur, 20);

  // 표본 표
  const stts = [];
  for (const s of samples) {
    const l = stts[stts.length - 1];
    if (l && l[1] === s.dur) l[0]++; else stts.push([1, s.dur]);
  }
  const anyCto = samples.some((s) => s.cto !== 0);
  const negCto = samples.some((s) => s.cto < 0);
  const ctts = [];
  for (const s of samples) {
    const l = ctts[ctts.length - 1];
    if (l && l[1] === s.cto) l[0]++; else ctts.push([1, s.cto]);
  }
  const syncIdx = samples.map((s, i) => (s.sync ? i + 1 : 0)).filter(Boolean);
  const allSync = syncIdx.length === samples.length;
  const stsd = find(trak, 'mdia', 'minf', 'stbl', 'stsd').raw;
  const buildStbl = (offsets) =>
    box(
      'stbl',
      stsd,
      full('stts', 0, 0, u32(stts.length), ...stts.map(([c, d]) => u32(c, d))),
      ...(anyCto ? [full('ctts', negCto ? 1 : 0, 0, u32(ctts.length), ...ctts.map(([c, o]) => { const b = Buffer.alloc(8); b.writeUInt32BE(c); b.writeInt32BE(o, 4); return b; }))] : []),
      ...(allSync ? [] : [full('stss', 0, 0, u32(syncIdx.length), u32(...syncIdx))]),
      full('stsc', 0, 0, u32(1), u32(1, 1, 1)),
      full('stsz', 0, 0, u32(0, samples.length), u32(...samples.map((s) => s.size))),
      full('stco', 0, 0, u32(samples.length), u32(...offsets)),
    );
  // 상자를 다시 짠다: 길이를 고친 mvhd·tkhd·mdhd, 새 stbl, mvex 빼기
  const rebuild = (b, offsets) => {
    if (b.type === 'mvhd') return box('mvhd', newMvhd);
    if (b.type === 'tkhd') return box('tkhd', tkhd);
    if (b.type === 'mdhd') return box('mdhd', newMdhd);
    if (b.type === 'stbl') return buildStbl(offsets);
    if (b.type === 'mvex') return Buffer.alloc(0);
    if (b.kids) return box(b.type, ...b.kids.map((k) => rebuild(k, offsets)));
    return Buffer.from(b.raw);
  };
  const ftyp = box('ftyp', Buffer.from('isom', 'latin1'), u32(0x200), Buffer.from('isomiso2avc1mp41', 'latin1'));
  const dataSize = samples.reduce((a, s) => a + s.size, 0);
  if (dataSize > 0xfffffff0) throw new Error('영상 데이터가 너무 큼');
  const zeros = new Array(samples.length).fill(0);
  const moovLen = rebuild(moov, zeros).length;
  let off = ftyp.length + moovLen + 8;
  const offsets = samples.map((s) => { const o = off; off += s.size; return o; });
  const newMoov = rebuild(moov, offsets);
  if (newMoov.length !== moovLen) throw new Error('moov 크기 계산 불일치');
  const mdatHdr = Buffer.alloc(8);
  mdatHdr.writeUInt32BE(8 + dataSize);
  mdatHdr.write('mdat', 4, 'latin1');
  const out = Buffer.concat([ftyp, newMoov, mdatHdr, ...samples.map((s) => buf.subarray(s.pos, s.pos + s.size))]);
  return { out, samples: samples.length, sync: syncIdx.length, seconds: total / mdTimescale };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const [inp, outp] = process.argv.slice(2);
  if (!inp) { console.error('사용: node tools/mp4-defrag.mjs <입력.mp4> [출력.mp4]'); process.exit(2); }
  const r = defragMp4(readFileSync(inp));
  if (!r) { console.log('이미 일반 MP4라서 바꾸지 않음'); process.exit(0); }
  const target = outp || inp.replace(/\.mp4$/i, '-일반.mp4');
  writeFileSync(target, r.out);
  console.log(JSON.stringify({ out: target, bytes: r.out.length, samples: r.samples, keyframes: r.sync, seconds: Number(r.seconds.toFixed(3)) }));
}
