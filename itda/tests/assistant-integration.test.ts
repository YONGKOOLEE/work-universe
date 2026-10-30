// AI 비서와 업무 데이터의 연결: 권한, 처음 열기·깨진 칸 방어(migrate), 합쳐 불러오기, 백업 왕복, 사람 삭제 판단,
// 그리고 기존 AI 호출·지도 파생·인계 스냅샷에 고객 정보가 들어가지 않는다는 것(0건)을 시험으로 고정한다. 가상 데이터·가짜 SDK만.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createSeed } from '../src/data/seed';
import { migrate } from '../src/lib/migrate';
import { canEdit, parseBackup, scopeFor } from '../src/lib/store';
import { applyMerge, checkIntegrity, exportBackupState, newCustomers, planMerge, previewCounts, replaceKeepingOtherMemos, sameCustomer } from '../src/lib/mergeImport';
import { addPerson, personUsages, removePerson } from '../src/lib/people';
import { createClient } from '../src/ai/llm';
import { claudeAsk } from '../src/ai/claudeSearch';
import { claudeExtract } from '../src/ai/reflect';
import { claudeCheck } from '../src/ai/aiCheck';
import { claudeInsights } from '../src/ai/aiInsight';
import { claudeOverall } from '../src/ai/aiOverall';
import { deriveMap } from '../src/universe/derive';
import { addInteraction, addRequest, canEditCustomer, createCustomer, emptyAssistant, ensureAssistant, isErr, updateCustomer } from '../src/assistant/model';
import { cleanAssistant } from '../src/assistant/clean';
import { createAssistantSeed } from '../src/assistant/seed';
import { DEFAULT_CONF, type AssistantData } from '../src/assistant/types';
import type { AppState } from '../src/lib/types';

const NOW = new Date(2026, 9, 30, 10, 0, 0);
const seed = (): AppState => createSeed('linked', NOW);

describe('고객 편집 권한(canEditCustomer)', () => {
  it('담당 영업자 본인만, 다른 팀원은 못 고친다(열람은 모두)', () => {
    const s = seed();
    const c = s.assistant!.customers[0];
    expect(c.ownerId).toBe('U1');
    expect(canEditCustomer(s, c.id, 'U1')).toBe(true);
    expect(canEditCustomer(s, c.id, 'U2')).toBe(false); // 같은 팀 팀원
    expect(canEditCustomer(s, c.id, 'U9')).toBe(false); // 다른 부서
  });
  it('담당 영업자 소속이 내 조직 범위인 조직장은 고칠 수 있다(팀장 U3, 부장 U8). 범위 밖 조직장은 못 고친다', () => {
    const s = seed();
    const c = s.assistant!.customers[0]; // 담당 U1: 디지털신원팀
    expect(canEditCustomer(s, c.id, 'U3')).toBe(true); // 같은 팀 팀장
    expect(canEditCustomer(s, c.id, 'U8')).toBe(true); // 위 조직(부) 부장
    // 팀 둘째 업무 담당 U5(정산·결제팀)의 고객은 U3(다른 팀 팀장)가 못 고치고, U8(부장)은 고친다
    const owned = createCustomer(s.assistant!, { name: '결제팀고객' }, { now: NOW, ownerId: 'U5' }) as { id: string };
    expect(canEditCustomer(s, owned.id, 'U3')).toBe(false);
    expect(canEditCustomer(s, owned.id, 'U8')).toBe(true);
    expect(canEditCustomer(s, owned.id, 'U5')).toBe(true);
  });
  it('전출·퇴직한 조직장·조직장이 아닌 사람(role 없음)·없는 고객·없는 담당자', () => {
    const s = seed();
    const c = s.assistant!.customers[0];
    s.users.find((u) => u.id === 'U3')!.status = 'left';
    expect(canEditCustomer(s, c.id, 'U3')).toBe(false);
    s.users.find((u) => u.id === 'U3')!.status = undefined;
    expect(canEditCustomer(s, c.id, 'U3')).toBe(true);
    expect(canEditCustomer(s, 'CU-없음', 'U1')).toBe(false);
    const ghost = createCustomer(s.assistant!, { name: '주인없음' }, { now: NOW, ownerId: 'U-GHOST' }) as { id: string };
    expect(canEditCustomer(s, ghost.id, 'U3')).toBe(false); // 담당자를 찾을 수 없으면 조직장도 못 고침
    expect(canEditCustomer(s, ghost.id, 'U-GHOST')).toBe(true);
  });
  it('업무의 canEdit 규칙을 바꾸지 않았다(같은 함수 공유)', () => {
    const s = seed();
    expect(canEdit(s, 'W-004', 'U3')).toBe(false);
    expect(canEdit(s, 'W-001', 'U3')).toBe(true);
  });
});

describe('저장 데이터 열기(migrate): 처음 열기·지운 뒤·깨진 칸', () => {
  it('assistant가 없으면 가상 고객 18명(담당 = 지금 사용자, 기준일 = 오늘)을 채운다', () => {
    const base = JSON.parse(JSON.stringify(seed())) as AppState;
    delete base.assistant;
    base.currentUserId = 'U2';
    const s = migrate(base, new Date(2026, 10, 5, 9, 0, 0));
    expect(s.assistant!.customers.length).toBe(18);
    expect(new Set(s.assistant!.customers.map((c) => c.ownerId))).toEqual(new Set(['U2']));
    expect(s.assistant!.customers.find((c) => c.name === '윤지아')!.firstMetDate).toBe('2026-10-06'); // 기준일 11-05의 30일 전
    expect(s.assistant!.changes).toEqual([]);
  });
  it('옛 스키마(6)도 같다', () => {
    const base = JSON.parse(JSON.stringify(seed())) as Record<string, unknown>;
    delete base.assistant;
    base.schema = 6;
    expect((migrate(base, NOW).assistant as AssistantData).customers.length).toBe(18);
  });
  it('빈 데이터로 지운 뒤에는 다시 채우지 않는다(저장·불러오기를 거쳐도)', () => {
    const s = seed();
    s.assistant = emptyAssistant();
    const again = parseBackup(JSON.stringify(s));
    expect(again.assistant!.customers).toEqual([]);
    expect(migrate(JSON.parse(JSON.stringify(again)), NOW).assistant).toEqual(emptyAssistant());
  });
  it('깨진 칸 방어: 객체가 아니면 빈 데이터, 모양이 틀린 항목·없는 고객의 하위 기록·잘못된 날짜는 버린다', () => {
    for (const bad of ['망가짐', 7, null, []]) {
      const x = JSON.parse(JSON.stringify(seed())) as Record<string, unknown>;
      x.assistant = bad;
      expect((migrate(x, NOW).assistant as AssistantData).customers).toEqual([]);
    }
    const x = JSON.parse(JSON.stringify(seed())) as Record<string, any>;
    const good = x.assistant.customers[0];
    x.assistant = {
      customers: [good, { id: 'CU-X', name: '' }, 'oops', { id: good.id, name: '중복 ID' }, { id: 'CU-Y', name: '담당자없음', birthDate: '2026-02-30', mobile: 123 }],
      interactions: [{ id: 'IA-1', customerId: good.id, type: '미팅', date: '2026-10-01', title: 't' }, { id: 'IA-2', customerId: 'CU-없음', date: '2026-10-01', title: 't' }, { id: 'IA-3', customerId: good.id, date: '2026-13-01', title: 't' }, { id: 'IA-4', customerId: good.id, date: '2026-10-02', title: '' }],
      requests: [{ id: 'RQ-1', customerId: good.id, content: '요청', dueDate: '엉터리', interactionId: 'IA-없음' }, { id: 'RQ-2', customerId: 'CU-없음', content: 'x' }],
      anniversaries: [{ id: 'AN-1', customerId: good.id, date: '2000-05-05', remindDays: 'abc' }, { id: 'AN-2', customerId: good.id, date: '' }],
      changes: [{ id: 'CH-1', customerId: good.id, field: 'hobbies', oldValue: 1, newValue: null }, { id: 'CH-2', customerId: 'CU-없음', field: 'x' }],
      followups: [{ interactionId: 'IA-1', status: '이상한상태', answers: { held: { value: 'yes', n: 3 }, bad: 'x' }, asked: ['held', 5] }, { interactionId: 'IA-없음' }],
      noticeRead: ['a', 'a', 5, 'b'],
      conf: { notifyTime: '25:00', reqRemind: '', fuDuration: 5, fuEnable: false, meetHourbefore: false },
    };
    const a = migrate(x, NOW).assistant!;
    expect(a.customers.map((c) => c.id)).toEqual([good.id, 'CU-Y']);
    const y = a.customers[1];
    expect(y).toMatchObject({ birthDate: '', mobile: '123', ownerId: 'U1', isDemo: false });
    expect(a.interactions.map((i) => i.id)).toEqual(['IA-1']);
    expect(a.requests).toHaveLength(1);
    expect(a.requests[0]).toMatchObject({ dueDate: '', interactionId: null, status: '미착수' });
    expect(a.anniversaries.map((z) => [z.id, z.remindDays])).toEqual([['AN-1', '7,2,0']]);
    expect(a.changes).toEqual([{ id: 'CH-1', customerId: good.id, field: 'hobbies', oldValue: '1', newValue: '', source: 'manual', note: '', changedAt: '' }]);
    expect(a.followups).toEqual([{ interactionId: 'IA-1', status: 'pending', answers: { held: { value: 'yes', n: '3' } }, asked: ['held'], updatedAt: '' }]);
    expect(a.noticeRead).toEqual(['a', 'b']);
    expect(a.conf).toEqual({ ...DEFAULT_CONF, fuEnable: false, meetHourbefore: false }); // 잘못된 설정은 기본값, 올바른 것만 받음
  });
  it('올바른 데이터는 바뀌지 않는다(두 번 정리해도 같다)', () => {
    const s = seed();
    const a = s.assistant!;
    ensureAssistant(s);
    updateCustomer(a, a.customers[0].id, { hobbies: '골프, 등산, 낚시' }, { now: NOW });
    expect(cleanAssistant(JSON.parse(JSON.stringify(a)))).toEqual(a);
    expect(cleanAssistant(cleanAssistant(a))).toEqual(a);
  });
  it('새 시드: createSeed(fresh)는 고객을 채우지 않고(검토 16), 가상 고객 시드는 데이터 크기를 크게 키우지 않는다', () => {
    const f = createSeed('fresh', NOW);
    expect(f.assistant!.customers.length).toBe(0);
    expect(f.assistant!.interactions.length + f.assistant!.requests.length + f.assistant!.anniversaries.length).toBe(0);
    const size = JSON.stringify(createAssistantSeed(NOW, 'U1')).length;
    expect(size).toBeLessThan(25000); // 실측 21,880자(이력을 저장하지 않아서. 원본은 이력 273행까지 합쳐 약 7만 자)
    expect(size / (5 * 1024 * 1024)).toBeLessThan(0.01); // 저장소 5MB의 1% 미만
  });
});

describe('백업·전체 불러오기 왕복', () => {
  it('내보낸 백업을 그대로 다시 불러오면 AI 비서 데이터가 같다(고객·활동·요청·기념일·이력·질문 상태·읽음·설정)', () => {
    const s = seed();
    const a = s.assistant!;
    const c = createCustomer(a, { name: '왕복고객', company: '시험(가상)', mobile: '010-0000-7777' }, { now: NOW, ownerId: 'U1' }) as { id: string };
    addInteraction(a, c.id, { type: '미팅', date: '2026-10-28', title: '왕복 미팅' }, { now: NOW });
    addRequest(a, c.id, { content: '왕복 요청', dueDate: '2026-11-02' }, { now: NOW });
    a.noticeRead.push('req:RQ-001:2026-10-30:0');
    a.conf = { ...a.conf, notifyTime: '08:30' };
    const back = parseBackup(JSON.stringify(exportBackupState(s)));
    expect(back.assistant).toEqual(s.assistant);
    expect(replaceKeepingOtherMemos(seed(), back).assistant).toEqual(s.assistant);
    expect(checkIntegrity(back)).toEqual([]);
  });
  it('옛 백업(assistant 없음)을 열면 가상 고객이 채워진다', () => {
    const s = seed();
    const old = JSON.parse(JSON.stringify(s));
    delete old.assistant;
    expect(parseBackup(JSON.stringify(old)).assistant!.customers.length).toBe(18);
  });
});

describe('합쳐 불러오기: 고객', () => {
  /** 현재 = 시드, 들어온 = 동료 백업(시드 + 동료 고객 몇 명) */
  function pair() {
    const cur = seed();
    const inc = JSON.parse(JSON.stringify(seed())) as AppState;
    const ia = inc.assistant!;
    const base = Object.fromEntries(ia.customers.map((c) => [c.name, c.id]));
    return { cur, inc, ia, base };
  }
  it('같은 고객(이름+소속·휴대전화·이메일)은 현재 값을 그대로 두고 새 고객으로 더하지 않는다', () => {
    const { cur, inc, ia } = pair();
    const kim = ia.customers.find((c) => c.name === '김도현')!;
    kim.hobbies = '동료가 바꾼 취미'; // 현재 값이 유지되어야 한다
    ia.customers.push({ ...kim, id: 'CU-777', name: '다른 이름', company: '다른 회사', mobile: '010-0000-1001', email: '' }); // 휴대전화로 같은 사람
    ia.customers.push({ ...kim, id: 'CU-778', name: '또 다른 이름', company: '또 다른 회사', mobile: '', email: 'DH.KIM@gaon-bank.example' }); // 이메일로 같은 사람
    expect(previewCounts(cur, inc, planMerge(cur, inc), {}).customers).toBe(0);
    const { state, summary } = applyMerge(cur, inc);
    expect(state.assistant!.customers.length).toBe(18);
    expect(state.assistant!.customers.find((c) => c.name === '김도현')!.hobbies).toBe('골프, 등산');
    expect(summary).not.toContain('고객');
  });
  it('새 고객만 하위 기록과 함께 새 ID로 더하고, 건수가 계획·요약에 나온다', () => {
    const { cur, inc, ia } = pair();
    const c = createCustomer(ia, { name: '동료고객', company: '동료상사(가상)', mobile: '010-0000-8888' }, { now: NOW, ownerId: 'U2' }) as { id: string };
    expect(c.id).toBe('CU-019');
    const m = addInteraction(ia, c.id, { type: '미팅', date: '2026-10-20', title: '동료 미팅' }, { now: NOW }) as { id: string };
    addRequest(ia, c.id, { content: '동료 요청', interactionId: m.id, dueDate: '2026-11-04' }, { now: NOW });
    updateCustomer(ia, c.id, { hobbies: '독서' }, { now: NOW });
    ia.followups.push({ interactionId: m.id, status: 'done', answers: {}, asked: [], updatedAt: '2026-10-21 10:00:00' });
    // 같은 사람이 두 번 들어 있어도 한 번만
    createCustomer(ia, { name: '동료고객', company: '동료상사(가상)' }, { now: NOW, ownerId: 'U2', force: true });
    const plan = planMerge(cur, inc);
    expect(plan.counts.customers).toBe(1);
    expect(newCustomers(cur.assistant, inc.assistant).map((x) => x.name)).toEqual(['동료고객']);
    const { state, summary } = applyMerge(cur, inc);
    const a = state.assistant!;
    expect(a.customers.length).toBe(19);
    expect(summary).toContain('고객 1명');
    const nc = a.customers.find((x) => x.name === '동료고객')!;
    expect(nc.id).toBe('CU-019'); // 겹치지 않으므로 그대로
    expect(nc.ownerId).toBe('U2'); // 같은 사람(사번 일치)이라 현재 U2로
    const ni = a.interactions.find((i) => i.customerId === nc.id)!;
    expect(ni.title).toBe('동료 미팅');
    expect(a.requests.find((r) => r.customerId === nc.id)).toMatchObject({ content: '동료 요청', interactionId: ni.id });
    expect(a.changes.filter((h) => h.customerId === nc.id).length).toBeGreaterThan(0);
    expect(a.followups.find((f) => f.interactionId === ni.id)).toBeTruthy();
    // 현재 쪽 데이터는 그대로
    expect(a.customers.slice(0, 18)).toEqual(cur.assistant!.customers);
    // 두 번째로 같은 파일을 합쳐도 더 늘지 않는다
    expect(applyMerge(state, inc).state.assistant!.customers.length).toBe(19);
    expect(checkIntegrity(state)).toEqual([]);
  });
  it('ID가 겹치면 새 ID를 매기고, 담당 영업자는 사람 매핑을 따른다(같은 사람은 현재 ID, 새 사람은 새 ID)', () => {
    const { cur, inc, ia } = pair();
    // 현재에 이미 CU-019가 다른 고객으로 있다
    createCustomer(cur.assistant!, { name: '현재고객', company: '현재(가상)' }, { now: NOW, ownerId: 'U1' });
    inc.users.push({ id: 'U77', name: '새동료', dept: inc.users[0].dept, title: '주무관', empNo: 'V-7777', role: 'member' });
    const c = createCustomer(ia, { name: '동료고객', company: '동료상사(가상)' }, { now: NOW, ownerId: 'U77' }) as { id: string };
    expect(c.id).toBe('CU-019');
    const { state } = applyMerge(cur, inc);
    const nc = state.assistant!.customers.find((x) => x.name === '동료고객')!;
    expect(nc.id).not.toBe('CU-019');
    expect(nc.ownerId).toBe('U77'); // 새 사람이라 같은 ID로 들어왔다
    expect(state.users.some((u) => u.id === 'U77')).toBe(true);
    expect(state.assistant!.customers.find((x) => x.name === '현재고객')!.id).toBe('CU-019');
  });
  it('sameCustomer: 소속·휴대전화·이메일이 양쪽 다 비어 있으면 이름이 같은 고객은 같은 고객(검토 4 — 반복해서 합쳐도 중복이 안 생김). 한쪽이라도 있으면 이름만으로는 같게 보지 않는다', () => {
    const [a, b] = createAssistantSeed(NOW, 'U1').customers;
    expect(sameCustomer({ ...a, company: '', mobile: '', email: '' }, { ...a, company: '', mobile: '', email: '' })).toBe(true);
    expect(sameCustomer({ ...a, company: '', mobile: '', email: '' }, { ...a, company: '', mobile: '', email: 'x@y.example' })).toBe(false);
    expect(sameCustomer({ ...a, company: '', mobile: '', email: '' }, { ...a, company: '다른회사', mobile: '', email: '' })).toBe(false);
    expect(sameCustomer({ ...a, company: '', mobile: '', email: '' }, { ...b, company: '', mobile: '', email: '' })).toBe(false);
    expect(sameCustomer({ ...a, company: '가나 상사', mobile: '', email: '' }, { ...a, company: '가나상사', mobile: '', email: '' })).toBe(true);
    expect(sameCustomer(a, b)).toBe(false);
  });
  it('들어온 쪽에 assistant가 없어도 오류 없이 0건', () => {
    const cur = seed();
    const inc = JSON.parse(JSON.stringify(seed())) as AppState;
    delete inc.assistant;
    expect(planMerge(cur, inc).counts.customers).toBe(0);
    expect(applyMerge(cur, inc).state.assistant!.customers.length).toBe(18);
  });
});

describe('사람 삭제 판단: 고객 담당자는 사용처로 센다', () => {
  it('담당 고객이 있으면 막고, 다른 사람에게 넘긴 뒤에는 지울 수 있다', () => {
    const s = seed();
    const p = addPerson(s, { name: '임시사람', dept: s.users[0].dept, title: '주무관' });
    if (isErr(p)) throw new Error(p.error);
    expect(personUsages(s, p.id)).toEqual([]);
    const c = createCustomer(s.assistant!, { name: '임시고객' }, { now: NOW, ownerId: p.id }) as { id: string };
    expect(personUsages(s, p.id)).toEqual(['AI 비서 고객 담당 1건']);
    expect(removePerson(s, p.id)).toEqual({ blocked: ['AI 비서 고객 담당 1건'] });
    s.assistant!.customers.find((x) => x.id === c.id)!.ownerId = 'U1';
    expect('summary' in removePerson(s, p.id)).toBe(true);
  });
  it('AI 점검 기록(aiChecks)은 사용처로 세지 않는 기존 규칙 그대로', () => {
    const s = seed();
    const p = addPerson(s, { name: '점검사람', dept: s.users[0].dept, title: '주무관' });
    if (isErr(p)) throw new Error(p.error);
    s.aiChecks = { 'W-001': { at: '2026-10-29T00:00:00Z', byId: p.id, engine: 'claude', model: 'm', workVersion: 1, findings: [], dropped: 0 } };
    expect(personUsages(s, p.id)).toEqual([]);
  });
});

// ───────────── 정보 흐름: 고객 정보는 기존 AI 호출·지도·스냅샷으로 나가지 않는다 ─────────────

describe('정보 흐름 0건 고정', () => {
  const s = seed();
  const customers = s.assistant!.customers;
  /** 고객에게만 있는 값: 전화·이메일·성격·참고사항·주소·업무 관계·관계 경위 */
  const secrets = [
    ...new Set(customers.flatMap((c) => [c.mobile, c.email, c.personality, c.salesNotes, c.companyAddress, c.orgRelationship, c.relationshipOrigin, c.contactPreference]).filter((x) => x.length >= 6)),
  ];
  const base = JSON.stringify({ ...s, assistant: undefined });
  const hits = (text: string) => secrets.filter((x) => text.includes(x));
  const spy = (output: unknown) => {
    const reqs: any[] = [];
    const client = createClient('test', 'fake-model', { messages: { parse: async (req: any) => (reqs.push(req), { stop_reason: 'end_turn', parsed_output: output }) } });
    return { client, reqs };
  };

  it('시험이 의미 있으려면: 비밀 문자열이 충분히 있고 업무 데이터에는 원래 없다', () => {
    expect(secrets.length).toBeGreaterThan(30);
    expect(hits(base)).toEqual([]);
    expect(hits(JSON.stringify(s)).length).toBeGreaterThan(30); // 상태 전체를 직렬화하면 나온다(그래서 아래 호출들이 안 쓰는 것을 확인)
  });
  it('AI 업무 검색(claudeAsk)', async () => {
    const { client, reqs } = spy({ lines: [], eventIds: [], workIds: [], followups: [] });
    await claudeAsk(client, s, '자동이체 오류 대응 담당자는 누구인가요?', undefined, NOW);
    expect(reqs.length).toBe(1);
    expect(hits(JSON.stringify(reqs))).toEqual([]);
  });
  it('문서 분석(claudeExtract)', async () => {
    const { client, reqs } = spy({ summary: [], core: [], keywords: [], relatedWorks: [], proposals: [] });
    await claudeExtract(client, s, '시험 문서', [{ id: 'p-1', text: '이 문서는 자동이체 오류 대응을 설명한다.' }], 'W-001', '2026-10-01', undefined, {});
    expect(hits(JSON.stringify(reqs))).toEqual([]);
  });
  it('업무 점검(claudeCheck)', async () => {
    const { client, reqs } = spy({ findings: [] });
    await claudeCheck(client, s, 'W-007', undefined, NOW);
    expect(reqs.length).toBe(1);
    expect(hits(JSON.stringify(reqs))).toEqual([]);
  });
  it('지도 인사이트(claudeInsights)와 팀 전체 인사이트(claudeOverall)', async () => {
    const a = spy({ insights: [] });
    await claudeInsights(a.client, s, { kind: 'all' }, '2026-10-30');
    const b = spy({ findings: [] });
    await claudeOverall(b.client, s, { kind: 'all' }, '2026-10-30');
    expect(a.reqs.length + b.reqs.length).toBe(2);
    expect(hits(JSON.stringify([a.reqs, b.reqs]))).toEqual([]);
  });
  it('지도 파생 결과(deriveMap): 전체·내 지도·조직 범위 모두', () => {
    for (const scope of [{ kind: 'all' as const }, { kind: 'mine' as const, userId: 'U1' }, { kind: 'work' as const, workId: 'W-001' }]) {
      expect(hits(JSON.stringify(deriveMap(s, scope, NOW.toISOString())))).toEqual([]);
    }
  });
  it('인계 스냅샷: 기존 스냅샷에 0건이고, 스냅샷을 만드는 코드는 업무·결정·조치·이벤트·문서 요약만 골라 담는다(상태 전체를 복사하지 않음)', () => {
    expect(hits(JSON.stringify(s.snapshots))).toEqual([]);
    const src = readFileSync(new URL('../src/pages/HandoverDetail.tsx', import.meta.url), 'utf8');
    const block = src.slice(src.indexOf('const snap: Snapshot = {'), src.indexOf('d.snapshots.push(snap)'));
    expect(block.length).toBeGreaterThan(200);
    expect(block).not.toMatch(/assistant/);
    expect(block).not.toMatch(/\.\.\.\s*d\b|clone\(\s*d\s*\)|JSON\.stringify\(d\)/);
    expect(src.match(/assistant/g) ?? []).toEqual([]);
  });
  it('열람 범위 거르기(scopeFor)는 AI 비서 데이터를 그대로 두고, 사용자 전환이 고객을 숨기거나 바꾸지 않는다(열람은 모두)', () => {
    expect(scopeFor(s, 'U2').assistant).toEqual(s.assistant);
  });
});
