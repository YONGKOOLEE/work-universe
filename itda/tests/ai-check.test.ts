// Claude 점검(aiCheck): 입력 구성, 인용 대조, 규칙 점검 제목 전달 — 가짜 클라이언트로
import { describe, expect, it } from 'vitest';
import { createSeed } from '../src/data/seed';
import { buildCheckInput, CHECK_SCHEMA, CHECK_SYSTEM, claudeCheck, verifyFindings } from '../src/ai/aiCheck';
import { createClient } from '../src/ai/llm';

const NOW = new Date('2026-10-29T09:00:00+09:00');

function fakeClient(output: unknown, seen: any[] = []) {
  return createClient('test', 'fake-model', {
    messages: {
      parse: async (body: any) => {
        seen.push(body);
        return { stop_reason: 'end_turn', parsed_output: output };
      },
    },
  });
}

describe('Claude 점검 — 입력', () => {
  it('업무 기록 줄·연결 문서 문단을 ID와 함께, 규칙 점검 제목도 함께 보낸다', () => {
    const s = createSeed('linked');
    const inp = buildCheckInput(s, 'W-007', NOW)!;
    expect(inp.user).toContain('[기록#1] 업무명: 자동이체 오류 대응 매뉴얼 정비');
    expect(inp.user).toMatch(/\[D-105#p-\d+\]/);
    expect(inp.paras.has('D-105')).toBe(true);
    expect(inp.user).toContain('<규칙 점검이 이미 찾은 것>');
    for (const t of inp.ruleTitles) expect(inp.user).toContain(t);
    expect(buildCheckInput(s, 'W-없음')).toBeNull();
  });
  it('스키마는 모든 칸 필수 + 추가 칸 금지(구조화 출력)', () => {
    const item = (CHECK_SCHEMA as any).properties.findings.items;
    expect(item.required.sort()).toEqual(['detail', 'kind', 'quote', 'ref', 'severity', 'title']);
    expect(item.additionalProperties).toBe(false);
    expect(CHECK_SYSTEM).toContain('지어내지 않습니다');
  });
});

describe('Claude 점검 — 인용 대조', () => {
  const s = createSeed('linked');
  const inp = buildCheckInput(s, 'W-007', NOW)!;
  const para = inp.paras.get('D-105')!.find((p) => p.text.includes('재시도 횟수'))!;
  it('문서 문단·업무 기록 줄 인용은 통과, 원문에 없는 인용·짧은 인용·없는 문서는 뺀다', () => {
    const r = verifyFindings(
      {
        findings: [
          { kind: 'missing_action', severity: 'high', title: '재시도 기준 협의', detail: '조치로 등록 필요', quote: '재시도 횟수 기준은 2026. 11. 20.까지 참가기관과 협의할 계획', ref: `D-105#${para.id}` },
          { kind: 'missing_info', severity: 'mid', title: '기록 줄', detail: '', quote: '자동이체 오류 대응 매뉴얼 정비', ref: '기록#1' },
          { kind: 'conflict', severity: 'high', title: '지어낸 인용', detail: '', quote: '재시도는 다섯 번까지 허용하기로 확정함', ref: `D-105#${para.id}` },
          { kind: 'risk', severity: 'low', title: '짧은 인용', detail: '', quote: '오류', ref: `D-105#${para.id}` },
          { kind: 'risk', severity: 'low', title: '없는 문서', detail: '', quote: '재시도 횟수 기준은 2026. 11. 20.까지', ref: 'D-999#p-1' },
          { kind: 'nonsense', severity: 'low', title: '모르는 종류', detail: '', quote: '재시도 횟수 기준은 2026. 11. 20.까지', ref: `D-105#${para.id}` },
        ],
      },
      inp,
      s,
    );
    expect(r.findings.map((f) => f.title)).toEqual(['재시도 기준 협의', '기록 줄']);
    expect(r.findings[0].cite).toMatchObject({ docId: 'D-105', anchor: para.id });
    expect(r.findings[1].recordLine).toContain('업무명');
    expect(r.dropped).toBe(3); // 모르는 종류는 버리되 「인용 미확인」으로 세지 않음
  });
  it('위치(문단 ID)가 틀려도 같은 문서 안에 인용이 있으면 그 문단으로 고친다', () => {
    const r = verifyFindings({ findings: [{ kind: 'missing_due', severity: 'mid', title: 't', detail: '', quote: '재시도 횟수 기준은 2026. 11. 20.까지', ref: 'D-105#p-1' }] }, inp, s);
    expect(r.findings[0].cite?.anchor).toBe(para.id);
  });
  it('claudeCheck: 가짜 클라이언트 → 검증 결과, 요청은 check 상한·스키마', async () => {
    const seen: any[] = [];
    const cli = fakeClient({ findings: [{ kind: 'risk', severity: 'high', title: '외부 협의 대기', detail: '기한 전에 협의 필요', quote: '참가기관과 협의할 계획임', ref: `D-105#${para.id}` }, { kind: 'risk', severity: 'high', title: '가짜', detail: '', quote: '없는 문장입니다 정말로', ref: `D-105#${para.id}` }] }, seen);
    const r = await claudeCheck(cli, s, 'W-007', undefined, NOW);
    expect(r.engine).toBe('claude');
    expect(r.findings.length).toBe(1);
    expect(r.dropped).toBe(1);
    expect(seen[0].max_tokens).toBe(16000);
    expect(seen[0].system).toBe(CHECK_SYSTEM);
    expect(seen[0].messages[0].content).toContain('<규칙 점검이 이미 찾은 것>');
  });
});
