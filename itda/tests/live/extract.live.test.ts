// 실제 Claude 호출 시험(사용자 키, 가상 문서만). 평소 `npm test`에서는 건너뛴다: ITDA_LIVE=1일 때만 돈다.
// 키는 저장소 밖 파일(%USERPROFILE%\.wu-anthropic-key.txt)에서 읽고 어디에도 출력하지 않는다.
import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createClient } from '../../src/ai/llm';
import { claudeExtract } from '../../src/ai/reflect';
import { claudeAsk } from '../../src/ai/claudeSearch';
import { createSeed } from '../../src/data/seed';
import type { DocParagraph } from '../../src/lib/types';

const LIVE = process.env.ITDA_LIVE === '1';
const key = () => readFileSync(`${process.env.USERPROFILE}/.wu-anthropic-key.txt`, 'utf8').trim();
const OUT = '../.tmp/itda-live';
const paras = (text: string): DocParagraph[] => text.split(/\r?\n/).filter((l) => l.trim()).map((t, i) => ({ id: `p-${i + 1}`, text: t.trim() }));
const show = (r: any) =>
  r.proposals.map((p: any) => `${p.kind}\t${p.verified ? '원문' : '확인필요'}\t${p.date ?? ''}\t${p.ownerName ?? ''}${p.ownerId ? `(${p.ownerId})` : ''}\t${p.source}\t${p.text}${p.issue ? `\t⚠ ${p.issue}` : ''}`).join('\n');

describe.skipIf(!LIVE)('실제 Claude 문서 분석', () => {
  it('가상 회의록(표: 과제·담당·기한) — 담당은 원문 이름, 꼼꼼히 읽기', { timeout: 300000 }, async () => {
    const s = createSeed('linked');
    const text = readFileSync('../tests/fixtures/doc-attach/demo-대사확인.txt', 'utf8');
    const ps = paras(text);
    const t0 = Date.now();
    const r = await claudeExtract(createClient(key()), s, '대사 확인 개선 회의록', ps, 'W-004', '2026-10-26', undefined, { review: true });
    mkdirSync(OUT, { recursive: true });
    writeFileSync(`${OUT}/extract-demo.json`, JSON.stringify({ ms: Date.now() - t0, review: r.review, summary: r.summary, proposals: r.proposals }, null, 1));
    console.log(`(${Date.now() - t0}ms) review=${JSON.stringify(r.review)}\n${show(r)}`);
    const actions = r.proposals.filter((p) => p.kind === 'action');
    expect(actions.length).toBeGreaterThanOrEqual(2);
    expect(actions.some((p) => p.ownerName === '서하늘' && p.date === '2026-11-06')).toBe(true);
    expect(actions.some((p) => p.ownerName === '윤바다' && p.date === '2026-11-13')).toBe(true);
    expect(r.proposals.filter((p) => p.kind === 'decision').length).toBeGreaterThanOrEqual(2);
  });

  it('시연 보고자료(업무잇다 문서) — 원문 확인 비율, 담당은 지어내지 않음', { timeout: 300000 }, async () => {
    const s = createSeed('linked');
    const d = s.docs.find((x) => x.title.includes('추진 현황 보고'))!;
    const t0 = Date.now();
    const r = await claudeExtract(createClient(key()), s, d.title, d.paragraphs!, 'W-001', d.writtenAt, undefined, { review: false });
    writeFileSync(`${OUT}/extract-report.json`, JSON.stringify({ ms: Date.now() - t0, summary: r.summary, proposals: r.proposals }, null, 1));
    console.log(`(${Date.now() - t0}ms)\n${show(r)}`);
    const verified = r.proposals.filter((p) => p.verified).length;
    expect(verified / Math.max(1, r.proposals.length)).toBeGreaterThan(0.7);
    // 원문에 담당 이름이 없는 문서: 담당을 붙이지 않는다
    expect(r.proposals.filter((p) => p.ownerName).every((p) => d.paragraphs!.some((x) => x.text.includes(p.ownerName!)))).toBe(true);
  });

  it('AI 업무 검색 — 인용 대조', { timeout: 120000 }, async () => {
    const s = createSeed('linked');
    const r = await claudeAsk(createClient(key()), s, '비대면 출금동의 현재 추진 경과는?');
    writeFileSync(`${OUT}/ask.json`, JSON.stringify(r, null, 1));
    console.log(JSON.stringify(r.verify), r.lines.map((l) => `${l.prov}: ${l.text}`).join('\n'));
    expect(r.lines.length).toBeGreaterThan(0);
    expect(r.verify.passed).toBeGreaterThan(0);
  });
});
