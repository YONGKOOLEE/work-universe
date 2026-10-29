// 프롬프트 개선(사용자 질문 2026-10-29 「api 쓰는 부분 프롬프트 더 개선 가능할지」):
// AI 검색 입력(담당·상태·유의사항·협의처·조치 담당·기한 경과·기준일), 업무 기록 기준 문장, 날짜 대조, 질문 낱말, 문서 유형 힌트, 호출별 생각 깊이
import { describe, expect, it } from 'vitest';
import { createSeed } from '../src/data/seed';
import { createClient, LIMITS, LLM_EFFORT } from '../src/ai/llm';
import { claudeAsk, ASK_SYSTEM, RECORD_LABEL, terms } from '../src/ai/claudeSearch';
import { claudeExtract, contextBlock, EXTRACT_SYSTEM, TYPE_HINTS } from '../src/ai/reflect';

const NOW = new Date('2026-10-29T09:00:00+09:00');
/** 받은 요청을 적어 두는 가짜 SDK */
const spy = (output: unknown) => {
  const reqs: any[] = [];
  const client = createClient('test', 'fake-model', {
    messages: {
      parse: async (req: any) => {
        reqs.push(req);
        return { stop_reason: 'end_turn', parsed_output: output };
      },
    },
  });
  return { client, reqs };
};
const empty = { lines: [], eventIds: [], workIds: [], followups: [] };

describe('질문 낱말', () => {
  it('조사·어미를 떼고 의문사는 뺀다', () => {
    const t = terms('정하준이 빠지면 무엇이 막히나요?');
    expect(t).toContain('정하준');
    expect(t).not.toContain('무엇');
  });
  it('원래 꼴도 남겨 「참가기관과」·「참가」가 잘리지 않는다', () => {
    const t = terms('참가기관과 협의 일정은?');
    expect(t).toContain('참가기관');
    expect(terms('참가 신청')).toContain('참가');
  });
  it('업무 개념 사전의 같은 뜻 낱말을 더한다', () => {
    expect(terms('출금동의 진행 상황')).toContain('자동이체 동의');
  });
});

describe('AI 검색 입력과 문장 판정', () => {
  it('기준일, 담당(전출·퇴직 표시), 상태, 유의사항, 협의처, 조치 담당·기한 경과를 보낸다', async () => {
    const s = createSeed('linked');
    const w = s.works[0];
    const owner = s.users.find((u) => u.id === w.owners[0])!;
    owner.status = 'left';
    w.cautions = [{ id: 'cz', text: '시험용 유의사항 문장', prov: 'owner' }];
    s.actions.push({ id: 'A-T1', workId: w.id, title: '시험용 지난 조치', due: '2026-10-01', status: '예정', ownerId: owner.id, createdAt: '2026-09-01' });
    const { client, reqs } = spy(empty);
    await claudeAsk(client, s, `${w.name} 담당자는?`, undefined, NOW);
    const user: string = reqs[0].messages[0].content;
    expect(user).toContain('<기준일>2026-10-29</기준일>');
    expect(user).toContain(`${owner.name}(전출·퇴직)`);
    expect(user).toContain(`상태: ${w.status}`);
    expect(user).toContain('유의사항: 시험용 유의사항 문장');
    expect(user).toContain('협의처:');
    expect(user).toMatch(/시험용 지난 조치 \(담당 .+ · 예정 · 기한 2026-10-01 기한 경과\)/);
  });

  it('업무 기록 기준(record) 문장은 「업무 기록 기준」으로 표시하고, 기록에 없는 날짜를 쓰면 확정하지 않는다', async () => {
    const s = createSeed('linked');
    const w = s.works[0];
    const good = { text: `${w.name}의 상태는 ${w.status}입니다.`, basis: 'record', cites: [] };
    const bad = { text: '이 업무는 2031. 3. 7.까지 끝내야 합니다.', basis: 'record', cites: [] };
    const { client } = spy({ ...empty, lines: [good, bad] });
    const r = await claudeAsk(client, s, `${w.name} 상태는?`, undefined, NOW);
    // record는 숫자·날짜만 대조된다(내용 대조 아님) → 사람이 쓴 기록(owner)이 아니라 AI 해석(inference)으로 두고 라벨만 「업무 기록 요약(AI)」
    expect(r.lines[0].prov).toBe('inference');
    expect(r.lines[0].label).toBe(RECORD_LABEL);
    expect(RECORD_LABEL).toBe('업무 기록 요약(AI)');
    expect(r.lines[1].prov).toBe('unverified');
    expect(r.lines[1].label).toBeUndefined();
  });

  it('해석(inference) 문장: 자료에 없는 날짜는 확정하지 않고, AI가 센 개수는 그대로 둔다', async () => {
    const s = createSeed('linked');
    const lines = [
      { text: '관련 조치가 3건 남아 있습니다.', basis: 'inference', cites: [] },
      { text: '2031. 3. 7.에 마무리될 것으로 보입니다.', basis: 'inference', cites: [] },
    ];
    const { client } = spy({ ...empty, lines });
    const r = await claudeAsk(client, s, '남은 조치는?', undefined, NOW);
    expect(r.lines[0].prov).toBe('inference');
    expect(r.lines[1].prov).toBe('unverified');
  });

  it('지시문에 basis record·기준일·담당 규칙이 있고 스키마가 record를 받는다', async () => {
    expect(ASK_SYSTEM).toContain('"record"');
    expect(ASK_SYSTEM).toContain('<기준일>');
    expect(ASK_SYSTEM).toContain('(전출·퇴직)');
    const { client, reqs } = spy(empty);
    await claudeAsk(client, createSeed('linked'), '무엇이 있나요?', undefined, NOW);
    // SDK 도우미가 enum을 설명 글로 옮겨 보낸다 — 값이 들어 있는지만 본다
    expect(JSON.stringify(reqs[0].output_config.format)).toContain('record');
  });
});

describe('문서 분석: 문서 유형 힌트', () => {
  it('지시문에 유형별 힌트가 모두 들어 있다(업무 매뉴얼 포함)', () => {
    expect(Object.keys(TYPE_HINTS)).toContain('업무 매뉴얼');
    for (const h of Object.values(TYPE_HINTS)) expect(EXTRACT_SYSTEM).toContain(h);
  });
  it('문서 유형을 <지도 정보>에 넣고, 없으면 미상', () => {
    const s = createSeed('linked');
    expect(contextBlock(s, '제목', 'W-001', '2026-10-01', '회의록')).toContain('문서 유형: 회의록');
    expect(contextBlock(s, '제목', 'W-001', '2026-10-01')).toContain('문서 유형: 미상');
  });
  it('claudeExtract가 opts.docType을 보낸다', async () => {
    const s = createSeed('linked');
    const { client, reqs } = spy({ summary: [], core: [], keywords: [], relatedWorks: [], proposals: [] });
    await claudeExtract(client, s, '오류 대응 매뉴얼', [{ id: 'p-1', text: '오류가 나면 먼저 거래 내역을 확인한다.' }], 'W-001', '2026-10-01', undefined, { docType: '업무 매뉴얼' });
    expect(reqs[0].messages[0].content).toContain('문서 유형: 업무 매뉴얼');
  });
});

describe('호출별 생각 깊이', () => {
  it('점검만 high, 나머지는 기본(medium)', async () => {
    expect(LIMITS.check.effort).toBe('high');
    expect(LIMITS.ask.effort).toBeUndefined();
    const { client, reqs } = spy({ findings: [] });
    await client.json({ system: 's', user: 'u', schema: { type: 'object', properties: {}, required: [], additionalProperties: false }, limit: 'check' });
    await client.json({ system: 's', user: 'u', schema: { type: 'object', properties: {}, required: [], additionalProperties: false }, limit: 'ask' });
    expect(reqs[0].output_config.effort).toBe('high');
    expect(reqs[1].output_config.effort).toBe(LLM_EFFORT);
  });
});
