// 실제 Claude AI 비서 시험(사용자 키, 가상 시연 데이터만). ITDA_LIVE=1일 때만 돈다. 키는 출력하지 않는다.
import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createClient } from '../../src/ai/llm';
import { createAssistantSeed } from '../../src/assistant/seed';
import { analyzeConversation, enrichDraft } from '../../src/assistant/claude';
import { SAMPLE_TEXT } from '../../src/assistant/sample';
import { searchQuestion, describeCond } from '../../src/assistant/nlsearch';

const LIVE = process.env.ITDA_LIVE === '1';
const key = () => readFileSync(`${process.env.USERPROFILE}/.wu-anthropic-key.txt`, 'utf8').trim();
const OUT = '../.tmp/itda-live';
const NOW = new Date('2026-10-30T10:00:00+09:00');

describe.skipIf(!LIVE)('실제 Claude AI 비서', () => {
  it('대화 분석 — 근거 대조·가림·영업사원 발언 분리', { timeout: 180000 }, async () => {
    const a = createAssistantSeed(NOW, 'U1');
    const c = a.customers.find((x) => x.name === '김도현')!;
    const t0 = Date.now();
    const d: any = await analyzeConversation(createClient(key()), a, { customerId: c.id, text: SAMPLE_TEXT, myName: '가상 영업' }, NOW);
    expect(d.error).toBeUndefined();
    const e: any = enrichDraft(a, d);
    mkdirSync(OUT, { recursive: true });
    writeFileSync(`${OUT}/assistant-analyze.json`, JSON.stringify({ ms: Date.now() - t0, ...e }, null, 1));
    const verified = e.items.filter((x: any) => x.quoteVerified).length;
    console.log(`대화 분석 ${Date.now() - t0}ms 항목 ${e.items.length} 대조 통과 ${verified}\n${e.items.map((x: any) => `${x.kind} [${x.quoteVerified ? 'O' : 'X'}${x.include ? '✓' : '-'}] ${x.field_label ?? ''} ${x.value ?? x.content} (${x.speaker}/${x.confidence}${x.warnings?.length ? '/' + x.warnings.join(',') : ''})`).join('\n')}`);
    expect(e.items.length).toBeGreaterThan(0);
    expect(verified / e.items.length).toBeGreaterThanOrEqual(0.8);
  });
  it('질문 해석 — 규칙이 약한 표현', { timeout: 180000 }, async () => {
    const a = createAssistantSeed(NOW, 'U1');
    const client = createClient(key());
    const qs = ['해산물 못 드시는 분', '회 안 드시는 은행 담당자', '골프 치는 고객 있어?', '요즘 연락 뜸한 정부기관 분들', '다음 주까지 처리해야 할 요청'];
    const rows: string[] = [];
    for (const q of qs) {
      const t0 = Date.now();
      const r: any = await searchQuestion(a, q, NOW, { client });
      rows.push(`${q} => ${r.mode}${r.aiError ? ' 오류' : ''} ${Date.now() - t0}ms 조건「${describeCond(r.conditions)}」 고객 ${r.customers?.map((x: any) => x.name).join(',')} 요청 ${r.requests?.length ?? 0}`);
      expect(r.mode).toBe('ai');
    }
    console.log(rows.join('\n'));
    writeFileSync(`${OUT}/assistant-ask.txt`, rows.join('\n'));
  });
});
