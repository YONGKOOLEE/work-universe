// 실제 Claude 점검 시험(사용자 키, 가상 시연 데이터만). ITDA_LIVE=1일 때만 돈다. 키는 출력하지 않는다.
import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createClient } from '../../src/ai/llm';
import { claudeCheck, CHECK_NAMES } from '../../src/ai/aiCheck';
import { createSeed } from '../../src/data/seed';

const LIVE = process.env.ITDA_LIVE === '1';
const key = () => readFileSync(`${process.env.USERPROFILE}/.wu-anthropic-key.txt`, 'utf8').trim();
const OUT = '../.tmp/itda-live';

describe.skipIf(!LIVE)('실제 Claude 점검', () => {
  for (const workId of ['W-001', 'W-007']) {
    it(`${workId} — 찾은 것은 모두 원문 인용 통과`, { timeout: 180000 }, async () => {
      const s = createSeed('linked');
      const t0 = Date.now();
      const r = await claudeCheck(createClient(key()), s, workId, undefined, new Date('2026-10-29T09:00:00+09:00'));
      mkdirSync(OUT, { recursive: true });
      writeFileSync(`${OUT}/check-${workId}.json`, JSON.stringify({ ms: Date.now() - t0, ...r }, null, 1));
      console.log(`${workId} (${Date.now() - t0}ms) 찾은 것 ${r.findings.length} · 뺀 것 ${r.dropped}\n${r.findings.map((f) => `${f.severity}\t${CHECK_NAMES[f.kind]}\t${f.title} — ${f.detail}\n\t「${f.quote}」 ${f.cite ? `${f.cite.docId}#${f.cite.anchor ?? ''}` : '기록'}`).join('\n')}`);
      expect(r.findings.every((f) => f.cite || f.recordLine)).toBe(true);
      expect(r.findings.length).toBeLessThanOrEqual(8);
    });
  }
});
