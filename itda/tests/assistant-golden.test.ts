// AI 비서 골든 비교 — ClientMemory 원본(파이썬)을 같은 시각(2026-10-30 10:00)으로 돌려 저장한 결과(tests/fixtures/assistant-golden.json,
// tools/gen-assistant-golden.py가 만든다)와 TS 이식 결과가 같은지 본다. ID는 이름으로 맞춘다.
// 일부러 바꾼 차이는 아래 DIFFS에 명시했고(CR-25 2.3), 그 밖의 차이는 허용하지 않는다.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createAssistantSeed } from '../src/assistant/seed';
import { buildBriefing, upcomingMeetings } from '../src/assistant/briefing';
import { applyFollowup, buildQuestions, meetingDayWord, pending, proposals } from '../src/assistant/followup';
import { executeSearch, describeCond, ruleParse, type Cond } from '../src/assistant/nlsearch';
import { computeNotices } from '../src/assistant/notices';
import { buildToday } from '../src/assistant/today';
import { customerDetail, listCustomers, upcomingEvents } from '../src/assistant/queries';
import { applyDraft, enrichDraft } from '../src/assistant/claude';
import { sampleDraft } from '../src/assistant/sample';
import type { AssistantData } from '../src/assistant/types';

/* eslint-disable @typescript-eslint/no-explicit-any */
const g: any = JSON.parse(readFileSync(new URL('./fixtures/assistant-golden.json', import.meta.url), 'utf8'));
const NOW = new Date(2026, 8 + 1, 30, 10, 0, 0); // 현지 시각 2026-10-30 10:00
const at = (s: string) => {
  const [d, t] = s.split(' ');
  const [y, m, dd] = d.split('-').map(Number);
  const [h, mi] = t.split(':').map(Number);
  return new Date(y, m - 1, dd, h, mi, 0);
};
const seed = (): AssistantData => createAssistantSeed(NOW, 'U1');
const idOf = (a: AssistantData, name: string) => a.customers.find((c) => c.name === name)!.id;
const nameOf = (a: AssistantData, id: string) => a.customers.find((c) => c.id === id)!.name;
const camel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/**
 * 일부러 바꾼 차이 목록(원본과 결과가 다른 것). 각 항목은 원본 결과가 실제로 그랬는지도 함께 확인한다.
 *  D1 검색 「해산물 못 드시는 분」: 원본 0건 → 기피 음식 해산물 고객을 찾음 (2.3-3)
 *  D2 검색 「이번 달에 내가 챙겨야 할 사람 누구야」: 원본 0건 → 기한 임박 요청·경조사·예정 연락이 있는 고객 (2.3-3)
 *  D3 검색 「매운 음식 싫어하는 분」: 원본은 핵심어를 「음식」으로 잘못 잡아 날음식 고객까지 찾음 → 「매운」으로 찾음 (원본 버그 수정)
 *  D4 미팅 후 질문 interest: 「가족·생활」 선택지 제거 (2.3-6)
 *  D5 예시 분석 승인: 활동 상세에 「[후속조치]」 목록을 또 쓰지 않음 — 요청사항 한 곳만 (2.3-5)
 *  --- 검토 반영(2026-10-30) ---
 *  D6 미팅 후 질문 문구의 「오늘」: 원본은 미팅 날짜와 상관없이 늘 「오늘」 → 미팅이 오늘이 아니면 「10월 29일」 식으로 미팅 날짜를 쓴다 (검토 12)
 *  D7 미팅 후 질문의 미팅 기록 메모 머리말 「[미팅 후 확인 날짜]」: 원본은 질문에 답한 날(오늘) → 미팅 날짜 (검토 12)
 *  D8 예시 분석 승인: 원본은 예시 통화 기록을 더하며 고객의 최근 연락일을 오늘로 올렸다 → 시험용 예시라 실제 연락이 아니므로 올리지 않는다 (검토 14)
 *  D9 예시 분석의 파일명·변경 이력 메모: 원본 sample_call_kimdohyun.txt(고객 이름이 들어감) → 「예시 대화」 (검토 14)
 */
const DIFFS: Record<string, { cond?: Partial<Cond>; customers?: string[]; evidence?: Record<string, { label: string; text: string }[]> }> = {
  '해산물 못 드시는 분': { cond: { keywords: [{ text: '해산물', scope: 'food_dislike' }], conversationKeywords: [] }, customers: ['김도현'], evidence: { 김도현: [{ label: '기피 음식', text: '해산물' }] } },
  '이번 달에 내가 챙겨야 할 사람 누구야': { cond: { agendaFrom: '2026-10-30', agendaTo: '2026-10-31', keywords: [] }, customers: ['조성훈', '김도현', '오정석', '장태우'] },
  '매운 음식 싫어하는 분': { cond: { keywords: [{ text: '매운', scope: 'food_dislike' }] }, customers: ['정민수'], evidence: { 정민수: [{ label: '기피 음식', text: '매운 음식' }] } },
};

const condOf = (py: any): Cond => ({
  target: py.target, keywords: py.keywords, conversationKeywords: py.conversation_keywords, orgKeywords: py.org_keywords, customerTypes: py.customer_types,
  noContactDays: py.no_contact_days, contactKind: py.contact_kind, birthdayFrom: py.birthday_from, birthdayTo: py.birthday_to, requestStatus: py.request_status,
  requestKeywords: py.request_keywords, dueWithinDays: py.due_within_days, overdue: py.overdue, agendaFrom: '', agendaTo: '',
  // 원본에 없는 조건(검토 반영으로 더한 칸)은 원본 질문에서 늘 비어 있어야 한다
  meetingFrom: '', meetingTo: '', nameKeywords: [], show: [],
});

describe('골든: 기준 시각과 시드', () => {
  it('골든은 2026-10-30 10:00에 만들어졌다', () => expect(g.meta.fakeNow).toBe('2026-10-30 10:00'));
  it('시드 고객 18명이 원본과 같은 순서·이름이다', () => {
    const a = seed();
    expect(a.customers.map((c) => c.name)).toEqual(g.customers);
    expect(a.customers.every((c) => c.isDemo && c.ownerId === 'U1')).toBe(true);
    expect(a.changes).toEqual([]); // 데모 등록 이력은 저장하지 않는다(2.3-8)
  });
});

describe('골든: 브리핑(전 고객)', () => {
  const a = seed();
  for (const name of g.customers as string[]) {
    it(`${name}`, () => {
      const want = g.briefings[name];
      const got = buildBriefing(a, idOf(a, name), NOW)!;
      expect(got.lines).toEqual(want.lines);
      expect(got.checks).toEqual(want.checks);
      expect(got.openRequests).toEqual(want.open_requests);
      expect(got.readSeconds).toBe(want.read_seconds);
      expect(got.meeting ? { date: got.meeting.date, time: got.meeting.time, title: got.meeting.title, type: got.meeting.type } : null).toEqual(want.meeting);
    });
  }
  it('다가오는 미팅(14일)', () => {
    expect(upcomingMeetings(a, NOW, 14).map((m) => ({ name: m.name, date: m.date, time: m.time, title: m.title }))).toEqual(g.upcomingMeetings);
  });
});

describe('골든: 미팅 후 질문(전 미팅)', () => {
  const a = seed();
  const strip = (qs: any[]) => qs.map((q) => ({ ...q, options: q.options.map((o: any) => ({ value: o.value, label: o.label, inputs: o.inputs })) }));
  for (const [key, want] of Object.entries(g.followupQuestions as Record<string, any[]>)) {
    it(key, () => {
      const [name, date, title] = key.split('|');
      const m = a.interactions.find((i) => i.customerId === idOf(a, name) && i.date === date && i.title === title)!;
      const got = buildQuestions(a, m.id, NOW)!.questions.map((q) => ({ id: q.id, reason: q.reason, text: q.text, options: q.options.map((o) => ({ value: o.value, label: o.label, inputs: o.inputs.map((i) => i.key) })) }));
      // D4: 원본의 interest 질문에서 「가족·생활」만 뺀 것과 같아야 한다
      // D6: 원본 문구는 늘 「오늘 …」로 시작 → 미팅이 오늘이 아니면 미팅 날짜(「10월 29일 …」)로 바뀐다
      const dayWord = date === '2026-10-30' ? '오늘' : meetingDayWord(date, '2026-10-30');
      const dated = (text: string) => (/^오늘 /.test(text) ? dayWord + text.slice(2) : text);
      const expected = strip(want)
        .map((q) => (q.id === 'interest' ? { ...q, options: q.options.filter((o: any) => o.value !== '가족·생활') } : q))
        .map((q) => ({ ...q, text: dated(q.text) }));
      expect(got).toEqual(expected);
    });
  }
  it('D4: 원본에는 「가족·생활」 선택지가 있었고 TS에는 없다', () => {
    const py = (Object.values(g.followupQuestions) as any[][]).flat().find((q) => q.id === 'interest');
    expect(py.options.map((o: any) => o.value)).toContain('가족·생활');
    for (const m of a.interactions.filter((i) => i.type === '미팅')) {
      const q = buildQuestions(a, m.id, NOW)!.questions.find((x) => x.id === 'interest');
      if (q) expect(q.options.map((o) => o.value)).not.toContain('가족·생활');
    }
  });
  it('질문 대기 목록', () => {
    expect(pending(a, NOW).map((m) => ({ name: m.name, date: m.date, time: m.time, title: m.title, fire_at: m.fireAt }))).toEqual(g.followupPending);
  });
});

describe('골든: 자연어 검색', () => {
  const a = seed();
  for (const s of g.searches as any[]) {
    const diff = DIFFS[s.q];
    it(`${diff ? '[차이 D] ' : ''}${s.q}`, () => {
      const cond = ruleParse(s.q, NOW);
      const res = executeSearch(a, cond, NOW);
      if (diff) {
        // 원본 결과를 먼저 확인한다(차이 목록이 사실인지)
        if (s.q !== '매운 음식 싫어하는 분') expect(s.count).toBe(0);
        else expect(s.customers.map((c: any) => c.name)).toEqual(['장태우', '정민수']);
        if (diff.cond) expect(cond).toMatchObject(diff.cond);
        expect(res.customers.map((c) => c.name)).toEqual(diff.customers);
        for (const [n, ev] of Object.entries(diff.evidence ?? {})) expect(res.customers.find((c) => c.name === n)!.evidence.map((e) => ({ label: e.label, text: e.text }))).toEqual(ev);
        return;
      }
      expect(cond).toEqual(condOf(s.conditions));
      expect(describeCond(cond)).toEqual(s.explain);
      expect(res.target).toBe(s.target);
      expect(res.count).toBe(s.count);
      expect(res.customers.map((c) => ({ name: c.name, evidence: c.evidence.map((e) => ({ label: e.label, text: e.text })) }))).toEqual(s.customers);
      expect(res.requests.map((r) => ({ name: r.name, content: r.content, status: r.status, due_date: r.dueDate, d_day: r.dDay }))).toEqual(s.requests);
    });
  }
  it('README 예시 6개 결과 건수(1·9·5·2·4명, 요청 8건)가 유지된다', () => {
    const counts = (g.searches as any[]).slice(0, 6).map((s) => executeSearch(a, ruleParse(s.q, NOW), NOW).count);
    expect(counts).toEqual([1, 9, 5, 2, 4, 8]);
  });
});

describe('골든: 알림 후보', () => {
  const a = seed();
  for (const [stamp, want] of Object.entries(g.notices as Record<string, any[]>)) {
    it(stamp, () => {
      const got = computeNotices(a, at(stamp))
        .map((n) => ({ kind: n.kind, customer: nameOf(a, n.customerId), event_date: n.eventDate, fire_at: n.fireAt, title: n.title, body: n.body }))
        .sort((x, y) => (x.kind + x.customer + x.title + x.event_date < y.kind + y.customer + y.title + y.event_date ? -1 : 1));
      const exp = want.map((w) => w).sort((x, y) => (x.kind + x.customer + x.title + x.event_date < y.kind + y.customer + y.title + y.event_date ? -1 : 1));
      expect(got).toEqual(exp);
    });
  }
  it('후보 키는 모두 다르다', () => {
    const keys = computeNotices(a, NOW).map((n) => n.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('골든: 오늘 화면·목록·상세', () => {
  const a = seed();
  it('대시보드', () => {
    const d = buildToday(a, NOW);
    const w = g.dashboard;
    expect(d.today).toBe(w.today);
    expect(d.total).toBe(w.total);
    expect(d.byType).toEqual(w.by_type);
    expect(d.noContactDays).toBe(w.no_contact_days);
    expect(d.meetings.map((m) => ({ name: m.name, date: m.date, time: m.time, title: m.title }))).toEqual(w.meetings);
    expect(d.todayRequests.map((r) => ({ name: r.name, content: r.content, due_date: r.dueDate, d_day: r.dDay, status: r.status }))).toEqual(w.today_requests);
    expect(d.soonRequests.map((r) => ({ name: r.name, content: r.content, due_date: r.dueDate, d_day: r.dDay, status: r.status }))).toEqual(w.soon_requests);
    expect(d.events.map((e) => ({ name: e.name, kind: e.kind, label: e.label, date: e.date, d_day: e.dDay }))).toEqual(w.events);
    expect(d.noContact.map((c) => ({ name: c.name, days: c.days, last_contact_date: c.lastContactDate }))).toEqual(w.no_contact);
    expect(d.recentChanges.map((h) => h.field)).toEqual(w.recent_changes);
    expect(d.recentCustomers.map((c) => c.name)).toEqual(w.recent_customers);
    expect(d.recommendations.map((r) => ({ priority: r.priority, name: r.name, text: r.text, reason: r.reason }))).toEqual(w.recommendations);
  });
  it('고객 상세(비어 있는 항목·생일·기념일·요청 D-day·활동 순서)', () => {
    for (const name of g.customers as string[]) {
      const want = g.customerView[name];
      const got = customerDetail(a, idOf(a, name), NOW)!;
      expect(got.missing).toEqual(want.missing);
      expect(got.birthday).toEqual(want.birthday ? { date: want.birthday.date, dDay: want.birthday.d_day } : null);
      expect(got.anniversaries.map((x) => ({ kind: x.kind, label: x.label, next_date: x.nextDate, d_day: x.dDay }))).toEqual(want.anniversaries);
      expect(got.requests.map((r) => ({ content: r.content, status: r.status, d_day: r.dDay }))).toEqual(want.requests);
      expect(got.interactions.map((i) => ({ type: i.type, date: i.date, time: i.time, title: i.title }))).toEqual(want.interactions);
    }
  });
  it('고객 목록(미처리 요청 수·비어 있는 항목 수)과 1년 일정', () => {
    expect(listCustomers(a).map((c) => ({ name: c.name, open_requests: c.openRequests, missing: c.missing }))).toEqual(g.customerList);
    expect(upcomingEvents(a, NOW, 366).map((e) => ({ name: e.name, kind: e.kind, label: e.label, date: e.date, d_day: e.dDay }))).toEqual(g.upcomingEvents366);
  });
});

describe('골든: 승인 흐름', () => {
  it('예시 분석: 항목별 경고·기본 선택·기존 값 비교가 같다(근거 문장은 모두 원문 확인 통과)', () => {
    const a = seed();
    const d = sampleDraft(a, idOf(a, '김도현'), NOW);
    if ('error' in d) throw new Error(d.error);
    expect(d.items.every((i) => i.quoteVerified)).toBe(true);
    const e = enrichDraft(a, d);
    if ('error' in e) throw new Error(e.error);
    expect(e.items.map((i) => ({ kind: i.kind, field: i.field ?? undefined, value: i.value, content: i.content, due_date: i.dueDate, warnings: i.warnings, include: i.include, status: i.status, existing: i.existing, is_list: i.isList, mode: i.mode, target_note: i.targetNote }))).toEqual(
      (g.sampleEnriched as any[]).map((w) => ({ ...w, field: w.field ? camel(w.field) : undefined, value: w.value ?? undefined, content: w.content ?? undefined, due_date: w.due_date ?? undefined, status: w.status ?? undefined, existing: w.existing ?? undefined, is_list: w.is_list ?? undefined, mode: w.mode ?? undefined, target_note: w.target_note ?? undefined })),
    );
    expect(d.title).toBe(g.sampleResult.title);
    expect(d.summary).toBe(g.sampleResult.summary);
    expect(d.speakerNote).toBe(g.sampleResult.speaker_note);
    expect(d.interactionType).toBe(g.sampleResult.interaction_type);
  });

  it('예시 분석 승인(기본 선택 그대로): 고객 항목·변경 이력·요청사항이 같고, 활동 상세에 후속조치를 또 쓰지 않는다(D5)', () => {
    const a = seed();
    const cid = idOf(a, '김도현');
    const before = { ...a.customers.find((c) => c.id === cid)! };
    const d = sampleDraft(a, cid, NOW);
    if ('error' in d) throw new Error(d.error);
    const e = enrichDraft(a, d);
    if ('error' in e) throw new Error(e.error);
    const choices = e.items.filter((i) => i.include).map((i) => ({ idx: i.idx, include: true, mode: i.mode }));
    const r = applyDraft(a, d, choices, {}, NOW);
    if ('error' in r) throw new Error(r.error);
    const want = g.sampleApply;
    // D8: 원본은 예시 통화 기록으로 최근 연락일을 오늘로 올렸다 → 예시는 실제 연락이 아니므로 올리지 않는다
    expect(Object.keys(want.changed)).toContain('last_contact_date');
    const wantChanged = Object.fromEntries(Object.entries(want.changed).filter(([k]) => k !== 'last_contact_date'));
    const after = a.customers.find((c) => c.id === cid)!;
    const changed: Record<string, string[]> = {};
    for (const k of Object.keys(wantChanged)) changed[camel(k)] = [before[camel(k) as 'name'] ?? '', after[camel(k) as 'name'] ?? ''];
    expect(changed).toEqual(Object.fromEntries(Object.entries(wantChanged).map(([k, v]) => [camel(k), v])));
    expect(after.lastContactDate).toBe(before.lastContactDate);
    // 바뀐 항목이 이것뿐인지(골든에 없는 항목이 바뀌지 않았는지)
    const fields = (Object.keys(after) as (keyof typeof after)[]).filter((k) => !['updatedAt'].includes(k) && before[k] !== after[k]);
    expect(fields.sort()).toEqual(Object.keys(wantChanged).map(camel).sort());
    // D9: 변경 이력 메모의 파일명이 고객 이름이 들어간 sample_call_kimdohyun.txt → 「예시 대화」
    expect(want.history.every((h: any) => h.note === '예시 분석 승인 (sample_call_kimdohyun.txt)')).toBe(true);
    expect(a.changes.filter((h) => h.source === 'sample').map((h) => ({ field: h.field, old: h.oldValue, new: h.newValue, source: h.source, note: h.note }))).toEqual(
      want.history.map((h: any) => ({ ...h, field: camel(h.field), note: '예시 분석 승인 (예시 대화)' })),
    );
    const ints = a.interactions.filter((i) => i.customerId === cid).map((i) => ({ type: i.type, date: i.date, time: i.time, title: i.title, summary: i.summary, source: i.source }));
    expect(ints).toEqual(want.interactions.map((i: any) => ({ type: i.type, date: i.date, time: i.time, title: i.title, summary: i.summary, source: i.source })));
    const mine = a.interactions.find((i) => i.id === r.interactionId)!;
    expect(want.interactions.at(-1).details).toContain('[후속조치]'); // 원본은 활동 상세에도 후속조치를 썼다
    expect(mine.details).toBe(''); // D5
    expect(a.requests.filter((q) => q.customerId === cid).map((q) => ({ content: q.content, received_date: q.receivedDate, due_date: q.dueDate, status: q.status, assignee: q.assignee, source: q.source, has_interaction: q.interactionId !== null }))).toEqual(want.requests);
  });

  it('미팅 후 질문 반영(윤지아의 어제 미팅): 반영안·저장 결과·질문 상태가 같다', () => {
    const a = seed();
    const cid = idOf(a, '윤지아');
    const m = a.interactions.find((i) => i.customerId === cid && i.time === '15:00')!;
    const want = g.followupProposals;
    const p = proposals(a, m.id, want.answers, NOW)!;
    expect(p.info.questions.map((q) => q.id)).toEqual(want.questionIds);
    // D7: 메모 머리말의 날짜가 원본은 답한 날(2026-10-30), TS는 미팅 날짜(2026-10-29)
    const d7 = (t: string) => t.replace('[미팅 후 확인 2026-10-30]', '[미팅 후 확인 2026-10-29]');
    expect(want.proposals.some((x: any) => String(x.new).includes('[미팅 후 확인 2026-10-30]'))).toBe(true);
    expect(p.proposals.map((x) => ({ kind: x.kind, field: x.field ? x.field : null, label: x.label, old: x.old, new: x.new, mode: x.mode ?? null, due_date: x.dueDate ?? null, assignee: x.assignee ?? null }))).toEqual(
      want.proposals.map((x: any) => ({ ...x, new: d7(x.new), field: x.field ? camel(x.field) : null, mode: x.mode ?? null, due_date: x.due_date ?? null, assignee: x.assignee ?? null })),
    );
    expect(p.problems).toEqual([]);
    const before = { ...a.customers.find((c) => c.id === cid)! };
    const r = applyFollowup(a, m.id, want.answers, p.proposals.map((_, idx) => ({ idx, include: true })), NOW);
    if ('error' in r) throw new Error(r.error);
    const wa = g.followupApply;
    const after = a.customers.find((c) => c.id === cid)!;
    expect(Object.fromEntries(Object.keys(wa.changed).map((k) => [camel(k), [before[camel(k) as 'name'], after[camel(k) as 'name']]]))).toEqual(Object.fromEntries(Object.entries(wa.changed).map(([k, v]) => [camel(k), v])));
    expect(a.changes.filter((h) => h.source === 'followup').map((h) => ({ field: h.field, old: h.oldValue, new: h.newValue, source: h.source, note: h.note }))).toEqual(wa.history.map((h: any) => ({ ...h, field: camel(h.field) })));
    expect(a.interactions.filter((i) => i.customerId === cid).map((i) => ({ type: i.type, date: i.date, time: i.time, title: i.title, summary: i.summary, details: i.details, source: i.source }))).toEqual(wa.interactions.map((i: any) => ({ ...i, details: d7(i.details) })));
    expect(a.requests.filter((q) => q.customerId === cid).map((q) => ({ content: q.content, received_date: q.receivedDate, due_date: q.dueDate, status: q.status, assignee: q.assignee, source: q.source, has_interaction: q.interactionId !== null }))).toEqual(wa.requests);
    const st = a.followups.find((f) => f.interactionId === m.id)!;
    expect({ status: st.status, answers: st.answers, asked: st.asked }).toEqual(wa.state);
  });
});
