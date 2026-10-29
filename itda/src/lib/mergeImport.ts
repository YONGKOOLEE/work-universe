// 합쳐 불러오기 — 동료가 내보낸 백업을 지금 데이터에 더한다(팀 지도용). 순수 함수만(브라우저 기능 없음).
import type { Action, AppState, Org, Cite, Decision, Doc, Handover, HistoryEntry, Snapshot, Stmt, TEvent, User, Work } from './types';
import { clone, nextId, uid } from './util';
// @ts-expect-error 유니버스 순수 모듈(JS) — 비슷한 업무 점수(주제 3, 산출물 유형 2, 이름 낱말 1)
import { tokensOf, WEIGHTS } from '../../../app/src/rules/insight.js';

/** 사번 정규화 — 유니버스 app/src/model/schema.js의 normalizeEmpNo와 같은 규칙(NFC·공백 제거·대문자) */
export function normalizeEmpNo(empNo: string): string {
  return String(empNo).normalize('NFC').replace(/\s+/g, '').toUpperCase();
}
/** 업무 이름 정규화 — NFC·공백 제거·소문자 */
export function normalizeWorkName(name: string): string {
  return String(name).normalize('NFC').replace(/\s+/g, '').toLowerCase();
}
const normText = (s: string) => String(s ?? '').normalize('NFC').replace(/\s+/g, '').toLowerCase();

export interface PersonMatch {
  incomingId: string;
  name: string;
  dept: string;
  /** same: 사번이 같음 · candidate: 사번 없이 이름+부서만 같음(확인 필요) · new: 새 사람 */
  status: 'same' | 'candidate' | 'new';
  currentId?: string;
  currentName?: string;
}
export interface WorkMatch {
  incomingId: string;
  name: string;
  /** same: 이름이 같음(기본 합치기) / candidate: 비슷한 업무(점수·이유, 기본 따로 두기 — 사람이 정함) / new */
  status: 'same' | 'candidate' | 'new';
  currentId?: string;
  currentName?: string;
  score?: number;
  reason?: string;
}

/** 비슷한 업무 후보 기준 점수(업무 유니버스 통합 후보와 같은 가중치: 주제 3, 문서 유형 2, 이름 낱말 1). 바꾸기 쉬운 곳 하나 */
export const WORK_CANDIDATE_MIN = 3;
// 인계서처럼 어느 업무에나 생기는 문서 유형은 비슷하다는 근거가 아니다(유니버스 GENERIC_ARTIFACT_TYPES와 같은 뜻)
const GENERIC_DOC_TYPES = new Set(['인수인계서']);

/** 업무 하나의 비교 기준: 주제, 연결 문서 유형, 이름 낱말 */
function workProfile(s: AppState, w: Work) {
  return {
    topics: new Set((w.topics || []).map(normText)),
    types: new Set(s.docs.filter((d) => d.workIds.includes(w.id) && !GENERIC_DOC_TYPES.has(d.type)).map((d) => d.type)),
    tokens: tokensOf(w.name) as Set<string>,
  };
}

/** 두 업무의 점수와 이유(겹친 것). 유니버스 merge.js·유사 경험자(insight.js)의 WEIGHTS를 그대로 쓴다 */
export function workSimilarity(a: ReturnType<typeof workProfile>, b: ReturnType<typeof workProfile>) {
  const both = <T,>(x: Set<T>, y: Set<T>) => [...x].filter((v) => y.has(v));
  const topics = both(a.topics, b.topics);
  const types = both(a.types, b.types);
  const tokens = both(a.tokens, b.tokens);
  const score = topics.length * WEIGHTS.topic + types.length * WEIGHTS.artifactType + tokens.length * WEIGHTS.token;
  const why = [
    ...topics.map((t) => `같은 주제 「${t}」`),
    ...types.map((t) => `같은 문서 유형 「${t}」`),
    ...tokens.map((t) => `이름에 같은 낱말 「${t}」`),
  ];
  return { score, reason: why.join(', ') };
}
export interface MergeCounts {
  users: number;
  usersSame: number;
  works: number;
  worksMerged: number;
  docs: number;
  decisions: number;
  actions: number;
  events: number;
  handovers: number;
  orgs: number;
}
/** 같은 업무로 합칠 때 두 쪽 내용이 다른 칸(서술 목록 5칸 + 한 값 칸 4개). 후보 업무도 계획에는 담고, 화면은 합치기를 고른 것만 보임 */
export interface MergeConflict {
  incomingWorkId: string;
  currentWorkId: string;
  field: ConflictField;
  /** 업무 화면에 보이는 칸 이름 */
  label: string;
  kind: 'list' | 'scalar';
  /** 내용 미리 보기(서술 목록은 항목을 ' / '로 이음) */
  current: string;
  incoming: string;
  /** 서술 목록만: 한쪽에만 있는 문장(미리 보기에서 무엇이 다른지 보이게) */
  onlyCurrent?: string[];
  onlyIncoming?: string[];
}
export type ConflictChoice = 'both' | 'current' | 'incoming';
const LIST_FIELDS = ['purpose', 'background', 'current', 'cautions', 'rejected'] as const;
const SCALAR_FIELDS = ['summary', 'agency', 'status', 'type'] as const;
export type ConflictField = (typeof LIST_FIELDS)[number] | (typeof SCALAR_FIELDS)[number];
/** 칸 이름 — WorkDetail 화면의 제목·입력 칸 이름과 같게 */
export const CONFLICT_LABELS: Record<ConflictField, string> = {
  purpose: '업무 목적',
  background: '추진 배경',
  current: '현재 진행 중인 사항',
  cautions: '주요 유의사항',
  rejected: '검토했으나 채택하지 않은 대안',
  summary: '업무 요약',
  agency: '소관 기관',
  status: '진행 상태',
  type: '업무 유형',
};
export const conflictKey = (incomingWorkId: string, field: string) => `${incomingWorkId}|${field}`;

export interface MergePlan {
  people: PersonMatch[];
  works: WorkMatch[];
  /** 같은 업무(또는 후보)인데 내용이 다른 칸 */
  conflicts: MergeConflict[];
  /** 기본 선택 기준으로 추가될 건수 */
  counts: MergeCounts;
}
export interface MergeChoices {
  /** 들어온 사람 ID → true: 같은 사람 / false: 다른 사람. 없으면 기본값(사번 일치만 같은 사람) */
  people?: Record<string, boolean>;
  /** 들어온 업무 ID → true: 합치기 / false: 따로 두기. 없으면 기본값(후보가 있으면 합치기) */
  works?: Record<string, boolean>;
  /** `${들어온 업무 ID}|${칸}` → 서술 목록: both(둘 다, 기본)/current/incoming · 한 값 칸: current(기본)/incoming */
  fields?: Record<string, ConflictChoice>;
}

const empOf = (u: User) => (u.empNo ? normalizeEmpNo(u.empNo) : '');

export function planMerge(current: AppState, incoming: AppState): MergePlan {
  const people: PersonMatch[] = incoming.users.map((u) => {
    const e = empOf(u);
    const byEmp = e ? current.users.find((c) => empOf(c) === e) : undefined;
    if (byEmp) return { incomingId: u.id, name: u.name, dept: u.dept, status: 'same', currentId: byEmp.id, currentName: byEmp.name };
    // 사번이 서로 다르게 있으면 다른 사람. 한쪽이라도 사번이 없을 때만 이름+부서로 후보
    const cand = current.users.find((c) => !(e && empOf(c)) && normText(c.name) === normText(u.name) && normText(c.dept) === normText(u.dept));
    if (cand) return { incomingId: u.id, name: u.name, dept: u.dept, status: 'candidate', currentId: cand.id, currentName: cand.name };
    return { incomingId: u.id, name: u.name, dept: u.dept, status: 'new' };
  });
  const profiles = new Map(current.works.map((x) => [x.id, workProfile(current, x)]));
  const works: WorkMatch[] = incoming.works.map((w) => {
    const k = normalizeWorkName(w.name);
    const c = current.works.find((x) => normalizeWorkName(x.name) === k);
    if (c) return { incomingId: w.id, name: w.name, status: 'same', currentId: c.id, currentName: c.name };
    // 이름이 다르면 점수로 가장 비슷한 업무 하나를 후보로(자동으로 합치지 않음)
    const mine = workProfile(incoming, w);
    let best: { w: Work; score: number; reason: string } | null = null;
    for (const x of current.works) {
      const r = workSimilarity(mine, profiles.get(x.id)!);
      if (r.score >= WORK_CANDIDATE_MIN && (!best || r.score > best.score)) best = { w: x, ...r };
    }
    return best ? { incomingId: w.id, name: w.name, status: 'candidate', currentId: best.w.id, currentName: best.w.name, score: best.score, reason: best.reason } : { incomingId: w.id, name: w.name, status: 'new' };
  });
  const conflicts = works.flatMap((m) => {
    const c = m.currentId ? current.works.find((x) => x.id === m.currentId) : undefined;
    return c ? workConflicts(c, incoming.works.find((x) => x.id === m.incomingId)!) : [];
  });
  const base: MergePlan = { people, works, conflicts, counts: undefined as unknown as MergeCounts };
  base.counts = previewCounts(current, incoming, base, {});
  return base;
}

const stmtText = (xs: Stmt[]) => xs.map((x) => x.text).join(' / ');
/** 두 업무의 다른 칸. 한쪽이 비어 있으면 빈 칸을 채우면 되므로 충돌이 아님. 들어온 서술이 모두 지금에 있으면 잃는 것이 없어 충돌 아님 */
function workConflicts(c: Work, w: Work): MergeConflict[] {
  const out: MergeConflict[] = [];
  const base = { incomingWorkId: w.id, currentWorkId: c.id };
  for (const f of LIST_FIELDS) {
    if (!c[f].length || !w[f].length) continue;
    const have = new Set(c[f].map((x) => normText(x.text)));
    if (w[f].every((x) => have.has(normText(x.text)))) continue;
    const theirs = new Set(w[f].map((x) => normText(x.text)));
    const onlyCurrent = c[f].filter((x) => !theirs.has(normText(x.text))).map((x) => x.text);
    const onlyIncoming = w[f].filter((x) => !have.has(normText(x.text))).map((x) => x.text);
    out.push({ ...base, field: f, label: CONFLICT_LABELS[f], kind: 'list', current: stmtText(c[f]), incoming: stmtText(w[f]), onlyCurrent, onlyIncoming });
  }
  for (const f of SCALAR_FIELDS) {
    const a = String(c[f] ?? '');
    const b = String(w[f] ?? '');
    if (!a.trim() || !b.trim() || normText(a) === normText(b)) continue;
    out.push({ ...base, field: f, label: CONFLICT_LABELS[f], kind: 'scalar', current: a, incoming: b });
  }
  return out;
}

function resolvePeople(plan: MergePlan, choices: MergeChoices) {
  const m = new Map<string, string>(); // 들어온 사람 ID → 지금 사람 ID (같은 사람만)
  for (const p of plan.people) {
    const same = choices.people?.[p.incomingId] ?? p.status === 'same';
    if (same && p.currentId) m.set(p.incomingId, p.currentId);
  }
  return m;
}
function resolveWorks(plan: MergePlan, choices: MergeChoices) {
  const m = new Map<string, string>(); // 들어온 업무 ID → 지금 업무 ID (합칠 업무만)
  for (const w of plan.works) {
    const merge = choices.works?.[w.incomingId] ?? w.status === 'same';
    if (merge && w.currentId) m.set(w.incomingId, w.currentId);
  }
  return m;
}

const docKey = (d: Pick<Doc, 'title' | 'writtenAt'>) => `${normText(d.title)}|${d.writtenAt}`;
const decKey = (d: Decision, wid: string) => `${wid}|${d.date}|${normText(d.title)}`;
const actKey = (a: Action, wid: string) => `${wid}|${normText(a.title)}|${a.due ?? ''}`;
const evKey = (e: TEvent) => `${e.date}|${e.type}|${normText(e.title)}`;
const hoKey = (h: Pick<Handover, 'workId' | 'fromId' | 'toId' | 'baseDate'>) => `${h.workId}|${h.fromId}|${h.toId}|${h.baseDate}`;
/** 같은 제목+작성일이고 같은 업무(합쳐진 업무)에 걸린 문서인가 */
const sameDoc = (c: Doc, d: Doc, mappedWorkIds: string[]) =>
  docKey(c) === docKey(d) && (mappedWorkIds.length === 0 ? c.workIds.length === 0 : mappedWorkIds.some((w) => c.workIds.includes(w)));

/** 조직 합집합: 이름이 지금 없는 들어온 조직 */
const newOrgs = (current: AppState, incoming: AppState): Org[] => {
  const have = new Set((current.orgs ?? []).map((o) => o.name));
  return (incoming.orgs ?? []).filter((o) => !have.has(o.name));
};

/** 선택을 반영한 추가 건수(미리 보기·요약용) */
export function previewCounts(current: AppState, incoming: AppState, plan: MergePlan, choices: MergeChoices): MergeCounts {
  const pm = resolvePeople(plan, choices);
  const wm = resolveWorks(plan, choices);
  const mw = (id: string) => wm.get(id) ?? id;
  const dec = new Set(current.decisions.map((d) => decKey(d, d.workId)));
  const act = new Set(current.actions.map((a) => actKey(a, a.workId)));
  const ev = new Set(current.events.map(evKey));
  return {
    users: incoming.users.length - pm.size,
    usersSame: pm.size,
    works: incoming.works.length - wm.size,
    worksMerged: wm.size,
    docs: incoming.docs.filter((d) => !current.docs.some((c) => sameDoc(c, d, d.workIds.map(mw)))).length,
    decisions: incoming.decisions.filter((d) => !dec.has(decKey(d, mw(d.workId)))).length,
    actions: incoming.actions.filter((a) => !act.has(actKey(a, mw(a.workId)))).length,
    events: incoming.events.filter((e) => !ev.has(evKey(e))).length,
    handovers: incoming.handovers.filter((h) => !current.handovers.some((c) => hoKey(c) === hoKey({ ...h, workId: mw(h.workId), fromId: pm.get(h.fromId) ?? h.fromId, toId: pm.get(h.toId) ?? h.toId }))).length,
    orgs: newOrgs(current, incoming).length,
  };
}

/** 새 ID: 겹치지 않으면 그대로, 겹치면 접두어-3자리(기존 최댓값+1). 번호 형식이 아니면 무작위 접미 */
function allocator(used: Set<string>) {
  return (id: string) => {
    let out = id;
    if (used.has(id)) {
      const m = /^(.*)-\d+$/.exec(id);
      if (m) out = nextId(m[1], [...used]);
      else {
        const p = id.includes('-') ? id.slice(0, id.indexOf('-')) : 'X';
        do out = uid(p);
        while (used.has(out));
      }
    }
    used.add(out);
    return out;
  };
}
const uniq = <T,>(a: T[]) => [...new Set(a)];

export function applyMerge(current: AppState, incoming: AppState, choices: MergeChoices = {}): { state: AppState; summary: string } {
  const cur = clone(current);
  const inc = clone(incoming);
  const plan = planMerge(cur, inc);
  const pm = resolvePeople(plan, choices);
  const wm = resolveWorks(plan, choices);
  const now = new Date().toISOString();
  const counts = previewCounts(current, incoming, plan, choices);

  // ── 1) ID 표 ──
  const uMap = new Map<string, string>();
  const allocU = allocator(new Set(cur.users.map((x) => x.id)));
  for (const u of inc.users) uMap.set(u.id, pm.get(u.id) ?? allocU(u.id));

  const wMap = new Map<string, string>();
  const allocW = allocator(new Set(cur.works.map((x) => x.id)));
  for (const w of inc.works) wMap.set(w.id, wm.get(w.id) ?? allocW(w.id));

  const mu = (id: string) => uMap.get(id) ?? id;
  const mw = (id: string) => wMap.get(id) ?? id;

  // 문서·결정·조치·이벤트: 합쳐진 업무에서 같은 것은 중복 추가 안 함
  const dMap = new Map<string, string>();
  const dupDocs = new Set<string>();
  const allocD = allocator(new Set(cur.docs.map((x) => x.id)));
  for (const d of inc.docs) {
    const hit = cur.docs.find((c) => sameDoc(c, d, d.workIds.map(mw)));
    if (hit) {
      dMap.set(d.id, hit.id);
      dupDocs.add(d.id);
    } else dMap.set(d.id, allocD(d.id));
  }
  const decMap = new Map<string, string>();
  const dupDec = new Set<string>();
  const allocDec = allocator(new Set(cur.decisions.map((x) => x.id)));
  for (const d of inc.decisions) {
    const hit = cur.decisions.find((c) => decKey(c, c.workId) === decKey(d, mw(d.workId)));
    if (hit) {
      decMap.set(d.id, hit.id);
      dupDec.add(d.id);
    } else decMap.set(d.id, allocDec(d.id));
  }
  const actMap = new Map<string, string>();
  const dupAct = new Set<string>();
  const allocAct = allocator(new Set(cur.actions.map((x) => x.id)));
  for (const a of inc.actions) {
    const hit = cur.actions.find((c) => actKey(c, c.workId) === actKey(a, mw(a.workId)));
    if (hit) {
      actMap.set(a.id, hit.id);
      dupAct.add(a.id);
    } else actMap.set(a.id, allocAct(a.id));
  }
  const evMap = new Map<string, string>();
  const dupEv = new Set<string>();
  const allocEv = allocator(new Set(cur.events.map((x) => x.id)));
  for (const e of inc.events) {
    const hit = cur.events.find((c) => evKey(c) === evKey(e));
    if (hit) {
      evMap.set(e.id, hit.id);
      dupEv.add(e.id);
    } else evMap.set(e.id, allocEv(e.id));
  }
  const hUsed = new Set(cur.history.map((x) => x.id));
  const allocH = allocator(hUsed);
  const hMap = new Map<string, string>();
  for (const h of inc.history) hMap.set(h.id, allocH(h.id));
  const hoMap = new Map<string, string>();
  const allocHo = allocator(new Set(cur.handovers.map((x) => x.id)));
  for (const h of inc.handovers) hoMap.set(h.id, allocHo(h.id));
  const sMap = new Map<string, string>();
  const allocS = allocator(new Set(cur.snapshots.map((x) => x.id)));
  for (const s of inc.snapshots) sMap.set(s.id, allocS(s.id));
  const md = (id: string) => dMap.get(id) ?? id;
  const mev = (id: string) => evMap.get(id) ?? id;
  const mdec = (id: string) => decMap.get(id) ?? id;
  const mact = (id: string) => actMap.get(id) ?? id;
  const mho = (id: string) => hoMap.get(id) ?? id;
  const ms = (id: string) => sMap.get(id) ?? id;

  // ── 2) 참조 바꾸기 ──
  const rc = (c: Cite): Cite => ({ ...c, docId: md(c.docId) });
  const rcs = (a?: Cite[]) => a?.map(rc);
  const rst = (s: Stmt): Stmt => (s.cite ? { ...s, cite: s.cite.map(rc) } : s);
  const rework = (w: Work): Work => ({
    ...w,
    id: mw(w.id),
    parentId: w.parentId ? mw(w.parentId) : null,
    relatedIds: uniq(w.relatedIds.map(mw)).filter((x) => x !== mw(w.id)),
    nextIds: uniq(w.nextIds.map(mw)).filter((x) => x !== mw(w.id)),
    owners: uniq(w.owners.map(mu)),
    ownerHistory: w.ownerHistory.map((o) => ({ ...o, userId: mu(o.userId) })),
    purpose: w.purpose.map(rst),
    background: w.background.map(rst),
    current: w.current.map(rst),
    cautions: w.cautions.map(rst),
    rejected: w.rejected.map(rst),
    partners: w.partners.map((p) => (p.cite ? { ...p, cite: p.cite.map(rc) } : p)),
  });
  const redec = (d: Decision): Decision => ({
    ...d,
    id: mdec(d.id),
    workId: mw(d.workId),
    cite: d.cite.map(rc),
    eventId: d.eventId ? mev(d.eventId) : d.eventId,
    rationale: rst(d.rationale),
  });
  const react = (a: Action): Action => ({ ...a, id: mact(a.id), workId: mw(a.workId), ownerId: mu(a.ownerId), cite: rcs(a.cite) });
  const reev = (e: TEvent): TEvent => ({
    ...e,
    id: mev(e.id),
    workIds: uniq(e.workIds.map(mw)),
    docIds: uniq(e.docIds.map(md)),
    cite: e.cite.map(rc),
    causes: e.causes.map((c) => ({ ...c, eventId: mev(c.eventId), cite: rcs(c.cite) })),
    autoDocId: e.autoDocId ? md(e.autoDocId) : e.autoDocId,
  });
  const redoc = (d: Doc): Doc => ({
    ...d,
    id: md(d.id),
    workIds: uniq(d.workIds.map(mw)),
    relevance: d.relevance?.map((r) => ({ ...r, workId: mw(r.workId) })),
    relations: d.relations.map((r) => ({ ...r, targetId: md(r.targetId) })),
    registeredBy: mu(d.registeredBy),
  });

  // ── 2.5) 조직(이름이 같으면 지금 것 그대로, 없는 것만 새 번호 O-###로 더함. 상위는 이름으로 다시 잇는다) ──
  const addOrgs = newOrgs(cur, inc);
  if (addOrgs.length) {
    cur.orgs = [...(cur.orgs ?? [])];
    const incName = new Map((inc.orgs ?? []).map((o) => [o.id, o.name]));
    let oNo = cur.orgs.reduce((m, o) => Math.max(m, Number(/^O-(\d+)$/.exec(o.id)?.[1] ?? 0)), 0);
    const byName = new Map<string, string>(cur.orgs.map((o) => [o.name, o.id]));
    for (const o of addOrgs) byName.set(o.name, `O-${String((oNo += 1)).padStart(3, '0')}`);
    for (const o of addOrgs) {
      const pName = o.parentId ? incName.get(o.parentId) : undefined;
      cur.orgs.push({ id: byName.get(o.name)!, name: o.name, level: o.level, parentId: pName ? byName.get(pName) ?? null : null });
    }
  }

  // ── 3) 사람 ──
  for (const u of inc.users) {
    const to = uMap.get(u.id)!;
    if (pm.has(u.id)) {
      const have = cur.users.find((c) => c.id === to);
      if (have && !have.empNo && u.empNo) have.empNo = u.empNo;
    } else cur.users.push({ ...u, id: to });
  }

  // ── 4) 업무 ──
  const conflictFields = new Set(plan.conflicts.filter((c) => wm.has(c.incomingWorkId)).map((c) => conflictKey(c.incomingWorkId, c.field)));
  let conflictedWorks = 0;
  for (const w of inc.works) {
    const r = rework(w);
    const target = wm.has(w.id) ? cur.works.find((c) => c.id === r.id) : undefined;
    if (!target) {
      cur.works.push(r);
      continue;
    }
    // 합치기: 지금 업무 기준
    target.owners = uniq([...target.owners, ...r.owners]);
    const oh = new Set(target.ownerHistory.map((o) => `${o.userId}|${o.from}|${o.to}`));
    for (const o of r.ownerHistory) if (!oh.has(`${o.userId}|${o.from}|${o.to}`)) target.ownerHistory.push(o);
    target.relatedIds = uniq([...target.relatedIds, ...r.relatedIds]).filter((x) => x !== target.id);
    target.nextIds = uniq([...target.nextIds, ...r.nextIds]).filter((x) => x !== target.id);
    target.topics = uniq([...(target.topics ?? []), ...(r.topics ?? [])]);
    target.keywords = uniq([...target.keywords, ...r.keywords]);
    const pk = new Set(target.partners.map((p) => `${normText(p.name)}|${normText(p.role)}`));
    for (const p of r.partners) if (!pk.has(`${normText(p.name)}|${normText(p.role)}`)) target.partners.push(p);
    // 서술·한 값 칸: 비어 있으면 채움. 둘 다 있고 다르면 선택대로(서술 기본 둘 다, 한 값 기본 지금 것)
    const changed: string[] = [];
    for (const f of LIST_FIELDS) {
      if (target[f].length === 0) target[f] = r[f];
      else if (conflictFields.has(conflictKey(w.id, f))) {
        const ch = choices.fields?.[conflictKey(w.id, f)] ?? 'both';
        if (ch === 'incoming') target[f] = r[f];
        else if (ch === 'both') {
          const seen = new Set(target[f].map((x) => normText(x.text)));
          const ids = new Set(target[f].map((x) => x.id));
          for (const st of r[f]) {
            const k = normText(st.text);
            if (seen.has(k)) continue;
            seen.add(k);
            let id = st.id;
            while (ids.has(id)) id = uid('s');
            ids.add(id);
            target[f].push({ ...st, id });
          }
        }
        changed.push(`${CONFLICT_LABELS[f]} ${ch === 'both' ? '두 쪽 내용 함께 남김' : ch === 'incoming' ? '가져온 것으로 바꿈' : '지금 것 유지'}`);
      }
    }
    for (const f of SCALAR_FIELDS) {
      const t = target as unknown as Record<string, string>;
      if (!t[f]) t[f] = (r as unknown as Record<string, string>)[f];
      else if (conflictFields.has(conflictKey(w.id, f))) {
        const inc = choices.fields?.[conflictKey(w.id, f)] === 'incoming';
        if (inc) t[f] = (r as unknown as Record<string, string>)[f];
        changed.push(`${CONFLICT_LABELS[f]} ${inc ? '가져온 것으로 바꿈' : '지금 것 유지'}`);
      }
    }
    if (changed.length) {
      conflictedWorks += 1;
      let hid: string;
      do hid = uid('H');
      while (hUsed.has(hid));
      hUsed.add(hid);
      cur.history.push({ id: hid, workId: target.id, at: now, actorId: cur.currentUserId, kind: '합쳐 불러오기', summary: `합쳐 불러오기: ${changed.join(', ')}` });
    }
    if (!target.parentId && r.parentId && r.parentId !== target.id && !wouldCycle(cur, target.id, r.parentId)) target.parentId = r.parentId;
    target.version += 1;
    target.updatedAt = now;
  }

  // ── 5) 문서·결정·조치·이벤트·이력 ──
  for (const d of inc.docs) {
    const r = redoc(d);
    if (dupDocs.has(d.id)) {
      const have = cur.docs.find((c) => c.id === r.id);
      if (have) have.workIds = uniq([...have.workIds, ...r.workIds]);
    } else cur.docs.push(r);
  }
  for (const d of inc.decisions) if (!dupDec.has(d.id)) cur.decisions.push(redec(d));
  for (const a of inc.actions) if (!dupAct.has(a.id)) cur.actions.push(react(a));
  for (const e of inc.events) {
    const r = reev(e);
    if (dupEv.has(e.id)) {
      const have = cur.events.find((c) => c.id === r.id);
      if (have) {
        have.workIds = uniq([...have.workIds, ...r.workIds]);
        have.docIds = uniq([...have.docIds, ...r.docIds]);
      }
    } else cur.events.push(r);
  }
  const hk = new Set(cur.history.map((h) => `${h.workId}|${h.at}|${h.kind}|${h.summary}`));
  for (const h of inc.history) {
    const r: HistoryEntry = { ...h, id: hMap.get(h.id)!, workId: mw(h.workId), actorId: h.actorId === 'ai' ? 'ai' : mu(h.actorId) };
    const k = `${r.workId}|${r.at}|${r.kind}|${r.summary}`;
    if (hk.has(k)) continue;
    hk.add(k);
    cur.history.push(r);
  }

  // ── 6) 인계·스냅샷(같은 인계·스냅샷은 지금 것으로 맞추고 더하지 않음) ──
  const dupHo = new Set<string>();
  for (const h of inc.handovers) {
    const have = cur.handovers.find((c) => hoKey(c) === hoKey({ ...h, workId: mw(h.workId), fromId: mu(h.fromId), toId: mu(h.toId) }));
    if (have) {
      hoMap.set(h.id, have.id);
      dupHo.add(h.id);
    }
  }
  const dupSnap = new Set<string>();
  for (const sn of inc.snapshots) {
    const have = cur.snapshots.find((c) => c.handoverId === mho(sn.handoverId) && c.takenAt === sn.takenAt);
    if (have) {
      sMap.set(sn.id, have.id);
      dupSnap.add(sn.id);
    }
  }
  for (const h of inc.handovers) {
    if (dupHo.has(h.id)) continue;
    const r: Handover = {
      ...h,
      id: mho(h.id),
      workId: mw(h.workId),
      fromId: mu(h.fromId),
      toId: mu(h.toId),
      snapshotId: h.snapshotId ? ms(h.snapshotId) : h.snapshotId,
      requests: h.requests.map((q) => ({ ...q, byId: mu(q.byId) })),
      log: h.log.map((l) => ({ ...l, byId: mu(l.byId) })),
    };
    cur.handovers.push(r);
  }
  for (const s of inc.snapshots) {
    if (dupSnap.has(s.id)) continue;
    const r: Snapshot = {
      ...s,
      id: ms(s.id),
      handoverId: mho(s.handoverId),
      workId: mw(s.workId),
      work: rework(s.work),
      decisions: s.decisions.map(redec),
      actions: s.actions.map(react),
      events: s.events.map(reev),
      docs: s.docs.map((d) => ({ ...d, id: md(d.id) })),
    };
    cur.snapshots.push(r);
  }

  // ── 7) 지도 숨김(합집합, 종류별 ID 바꿈) ──
  const byKind: Record<string, (id: string) => string> = { work: mw, doc: md, user: mu, action: mact };
  const hidden = new Set(cur.mapHidden ?? []);
  for (const k of inc.mapHidden ?? []) {
    const i = k.indexOf(':');
    const kind = i > 0 ? k.slice(0, i) : '';
    const f = byKind[kind];
    hidden.add(f ? `${kind}:${f(k.slice(i + 1))}` : k);
  }
  cur.mapHidden = [...hidden];

  // ── 8) 기록 ──
  const summary = `사람 ${inc.users.length}명(같은 사람 ${pm.size}) · 업무 ${inc.works.length}건(합침 ${wm.size}) · 문서 ${counts.docs}건 · 결정 ${counts.decisions} · 조치 ${counts.actions} · 인계 ${counts.handovers}${counts.orgs ? ` · 조직 ${counts.orgs}` : ''}${conflictedWorks ? ` · 내용이 다른 업무 ${conflictedWorks}건(칸 ${conflictFields.size})` : ''}`;
  const logWork = [...wm.values()][0] ?? wMap.get(inc.works[0]?.id ?? '') ?? cur.works[0]?.id;
  if (logWork) {
    let id: string;
    do id = uid('H');
    while (hUsed.has(id));
    cur.history.push({ id, workId: logWork, at: now, actorId: cur.currentUserId, kind: '합쳐 불러오기', summary });
  }
  return { state: cur, summary };
}

/** 참조 무결성 점검 — 모든 참조가 실제로 존재하는지. 문제 목록(빈 배열이면 정상) */
export function checkIntegrity(s: AppState): string[] {
  const bad: string[] = [];
  const U = new Set(s.users.map((x) => x.id));
  const W = new Set(s.works.map((x) => x.id));
  const D = new Set(s.docs.map((x) => x.id));
  const E = new Set(s.events.map((x) => x.id));
  const H = new Set(s.handovers.map((x) => x.id));
  const SN = new Set(s.snapshots.map((x) => x.id));
  const dupes = (name: string, ids: string[]) => {
    if (new Set(ids).size !== ids.length) bad.push(`${name}: ID 중복`);
  };
  dupes('users', s.users.map((x) => x.id));
  dupes('works', s.works.map((x) => x.id));
  dupes('docs', s.docs.map((x) => x.id));
  dupes('events', s.events.map((x) => x.id));
  dupes('decisions', s.decisions.map((x) => x.id));
  dupes('actions', s.actions.map((x) => x.id));
  dupes('history', s.history.map((x) => x.id));
  dupes('handovers', s.handovers.map((x) => x.id));
  dupes('snapshots', s.snapshots.map((x) => x.id));
  const need = (set: Set<string>, id: string | null | undefined, where: string) => {
    if (id && !set.has(id)) bad.push(`${where} → ${id}`);
  };
  const cites = (a: Cite[] | undefined, where: string) => a?.forEach((c) => need(D, c.docId, `${where}.cite`));
  const work = (w: Work, where: string, links: boolean) => {
    if (links) {
      need(W, w.parentId, `${where}.parentId`);
      w.relatedIds.forEach((x) => need(W, x, `${where}.relatedIds`));
      w.nextIds.forEach((x) => need(W, x, `${where}.nextIds`));
    }
    w.owners.forEach((x) => need(U, x, `${where}.owners`));
    w.ownerHistory.forEach((o) => need(U, o.userId, `${where}.ownerHistory`));
    for (const f of ['purpose', 'background', 'current', 'cautions', 'rejected'] as const) w[f].forEach((st) => cites(st.cite, `${where}.${f}`));
    w.partners.forEach((p) => cites(p.cite, `${where}.partners`));
  };
  s.works.forEach((w) => work(w, `work ${w.id}`, true));
  s.docs.forEach((d) => {
    d.workIds.forEach((x) => need(W, x, `doc ${d.id}.workIds`));
    d.relevance?.forEach((r) => need(W, r.workId, `doc ${d.id}.relevance`));
    d.relations.forEach((r) => need(D, r.targetId, `doc ${d.id}.relations`));
    need(U, d.registeredBy, `doc ${d.id}.registeredBy`);
  });
  const ev = (e: TEvent, where: string) => {
    e.docIds.forEach((x) => need(D, x, `${where}.docIds`));
    cites(e.cite, where);
    e.causes.forEach((c) => cites(c.cite, `${where}.causes`));
    need(D, e.autoDocId, `${where}.autoDocId`);
  };
  s.events.forEach((e) => {
    e.workIds.forEach((x) => need(W, x, `event ${e.id}.workIds`));
    e.causes.forEach((c) => need(E, c.eventId, `event ${e.id}.causes`));
    ev(e, `event ${e.id}`);
  });
  s.decisions.forEach((d) => {
    need(W, d.workId, `decision ${d.id}.workId`);
    cites(d.cite, `decision ${d.id}`);
    need(E, d.eventId, `decision ${d.id}.eventId`);
    cites(d.rationale.cite, `decision ${d.id}.rationale`);
  });
  s.actions.forEach((a) => {
    need(W, a.workId, `action ${a.id}.workId`);
    need(U, a.ownerId, `action ${a.id}.ownerId`);
    cites(a.cite, `action ${a.id}`);
  });
  s.history.forEach((h) => {
    need(W, h.workId, `history ${h.id}.workId`);
    if (h.actorId !== 'ai') need(U, h.actorId, `history ${h.id}.actorId`);
  });
  s.handovers.forEach((h) => {
    need(W, h.workId, `handover ${h.id}.workId`);
    need(U, h.fromId, `handover ${h.id}.fromId`);
    need(U, h.toId, `handover ${h.id}.toId`);
    need(SN, h.snapshotId, `handover ${h.id}.snapshotId`);
    h.requests.forEach((q) => need(U, q.byId, `handover ${h.id}.requests`));
    h.log.forEach((l) => need(U, l.byId, `handover ${h.id}.log`));
  });
  s.snapshots.forEach((sn) => {
    need(H, sn.handoverId, `snapshot ${sn.id}.handoverId`);
    need(W, sn.workId, `snapshot ${sn.id}.workId`);
    work(sn.work, `snapshot ${sn.id}.work`, false);
    sn.decisions.forEach((d) => {
      need(W, d.workId, `snapshot ${sn.id}.decision`);
      cites(d.cite, `snapshot ${sn.id}.decision`);
    });
    sn.actions.forEach((a) => need(U, a.ownerId, `snapshot ${sn.id}.action`));
    sn.events.forEach((e) => ev(e, `snapshot ${sn.id}.event`));
    sn.docs.forEach((d) => need(D, d.id, `snapshot ${sn.id}.docs`));
  });
  need(U, s.currentUserId, 'currentUserId');
  return bad;
}

/** childId의 상위를 parentId로 정하면 순환이 되는가(parentId의 조상 사슬에 childId가 있음) */
function wouldCycle(s: AppState, childId: string, parentId: string): boolean {
  const seen = new Set<string>();
  let cur: string | null = parentId;
  while (cur && !seen.has(cur)) {
    if (cur === childId) return true;
    seen.add(cur);
    cur = s.works.find((w) => w.id === cur)?.parentId ?? null;
  }
  return false;
}
