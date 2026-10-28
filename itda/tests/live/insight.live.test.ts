// 실제 Claude 인사이트 시험(사용자 키, 가상 시연 데이터만). ITDA_LIVE=1일 때만 돈다. 키는 출력하지 않는다.
import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createClient } from '../../src/ai/llm';
import { claudeInsights, AI_INSIGHT_NAMES } from '../../src/ai/aiInsight';
import { createSeed } from '../../src/data/seed';
import { scopeFor } from '../../src/lib/store';

const LIVE = process.env.ITDA_LIVE === '1';
const key = () => readFileSync(`${process.env.USERPROFILE}/.wu-anthropic-key.txt`, 'utf8').trim();
const OUT = '../.tmp/itda-live';

describe.skipIf(!LIVE)('실제 Claude 인사이트', () => {
  it('팀 범위(팀장 박지훈) — 찾은 것은 모두 근거 인용 통과', { timeout: 240000 }, async () => {
    const s = scopeFor(createSeed('linked', new Date('2026-10-29T09:00:00+09:00')), 'U3');
    const t0 = Date.now();
    const r = await claudeInsights(createClient(key()), s, { kind: 'all' }, '2026-10-29');
    mkdirSync(OUT, { recursive: true });
    writeFileSync(`${OUT}/insight-team.json`, JSON.stringify({ ms: Date.now() - t0, ...r }, null, 1));
    console.log(
      `팀 (${Date.now() - t0}ms) 찾은 것 ${r.items.length} · 뺀 것 ${r.dropped}\n${r.items
        .map((x) => `${x.level}\t${AI_INSIGHT_NAMES[x.kind]}\t${x.title} — ${x.detail}\n${x.refs.map((f) => `\t「${f.quote}」 ${f.workId}#${f.lineNo}`).join('\n')}`)
        .join('\n')}`,
    );
    expect(r.items.every((x) => x.refs.length > 0)).toBe(true);
    expect(r.items.length).toBeLessThanOrEqual(8);
  });
});
