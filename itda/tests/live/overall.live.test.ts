// 실제 Claude 전체 인사이트 시험(사용자 키, 가상 시연 데이터만). ITDA_LIVE=1일 때만 돈다. 키는 출력하지 않는다.
import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createClient } from '../../src/ai/llm';
import { claudeOverall, OVERALL_MAX } from '../../src/ai/aiOverall';
import { createSeed } from '../../src/data/seed';
import { scopeFor } from '../../src/lib/store';

const LIVE = process.env.ITDA_LIVE === '1';
const key = () => readFileSync(`${process.env.USERPROFILE}/.wu-anthropic-key.txt`, 'utf8').trim();
const OUT = '../.tmp/itda-live';

describe.skipIf(!LIVE)('실제 Claude 전체 인사이트', () => {
  it('팀 범위(팀장 박지훈) — 남은 항목은 모두 서로 다른 업무 둘 이상의 확인된 근거', { timeout: 240000 }, async () => {
    const s = scopeFor(createSeed('linked', new Date('2026-10-29T09:00:00+09:00')), 'U3');
    const t0 = Date.now();
    const r = await claudeOverall(createClient(key()), s, { kind: 'all' }, '2026-10-29');
    mkdirSync(OUT, { recursive: true });
    writeFileSync(`${OUT}/overall-team.json`, JSON.stringify({ ms: Date.now() - t0, ...r }, null, 1));
    console.log(
      `팀 전체 (${Date.now() - t0}ms) 찾은 것 ${r.items.length} · 뺀 것 ${r.dropped}\n${r.items
        .map((x) => `${x.title}\n\t${x.insight}\n\t왜: ${x.why}\n\t다음: ${x.suggestion}\n${x.evidence.map((f) => `\t「${f.quote}」 ${f.workId}#${f.lineNo}`).join('\n')}`)
        .join('\n')}`,
    );
    expect(r.items.every((x) => x.evidence.length >= 2 && x.workIds.length >= 2)).toBe(true);
    expect(r.items.length).toBeLessThanOrEqual(OVERALL_MAX);
  });
});
