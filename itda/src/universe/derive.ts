// AppState → 유니버스 문서(파생, CR-24 D24-1·D24-2). 저장하지 않고 화면을 그릴 때마다 만든다.
// 지도의 항목마다 원래 AppState의 무엇인지(origin)를 함께 돌려줘, 지도에서 고치면 AppState 명령으로 바꿀 수 있게 한다.
// 브라우저 기능을 쓰지 않는다(vitest로 검증).
import type { AppState, Work, User, Doc, Action, Stmt } from '../lib/types';

export type OriginKind = 'root' | 'work' | 'user' | 'doc' | 'action' | 'org' | 'topic';
export interface Origin {
  kind: OriginKind;
  id: string; // work/user/doc/action: AppState ID, org/topic: 이름, root: 범위 이름
}

/** 지도 범위: ① 업무 하나 ② 사람 한 명의 업무 ③ 전체(팀·부서로 접어 봄) */
export type MapScope = { kind: 'work'; workId: string } | { kind: 'mine'; userId: string } | { kind: 'all'; title?: string };

/** 숨김 키(AppState.mapHidden): 「종류:ID」 */
export const hideKey = (o: Origin) => `${o.kind}:${o.id}`;

const LABEL_MAX = 100;
// 날짜만(YYYY-MM-DD). ISO 시각(…T…Z)은 이 PC 시간대의 날짜로 — UTC로 자르면 오전 9시 전 기록이 하루 앞당겨진다
const day = (s: string | null | undefined) => {
  if (!s) return '';
  const t = String(s);
  if (!t.includes('T')) return t.slice(0, 10);
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? t.slice(0, 10) : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const clip = (s: string) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim() || '(이름 없음)';
  return t.length > LABEL_MAX ? `${t.slice(0, LABEL_MAX - 1)}…` : t;
};
// 지역 ID에는 「/」를 쓰지 않는다(전역 ID 구분자)
const safe = (s: string) => String(s).replace(/%/g, '%25').replace(/\//g, '%2F');
// 조직 이름에 붙은 「(시연용 가상 부서)」 같은 꼬리표는 같은 조직으로 본다
const orgLabel = (s: string) => String(s).replace(/\s*\((?:시연용 )?가상[^)]*\)\s*$/, '').trim();
const UNKNOWN_AGENCY = /별도\s*확인|미입력|^-$/;

interface UNode { id: string; core_type: string; label: string; subtype?: string; description?: string; attrs?: Record<string, string>; emp_no?: string; period?: { start?: string; end?: string }; hidden: boolean; created_at: string; updated_at: string }
interface UEdge { id: string; core_type: string; source: string; target: string; period?: { start?: string; end?: string }; note?: string; hidden?: boolean }
interface UEvent { id: string; type: string; occurred_at: string; recorded_at: string; source: string; payload: Record<string, unknown>; note?: string }
export interface UDoc {
  schema_version: string;
  universe: { id: string; name: string; level: string; owner?: string; description?: string; root_node_id: string; subtypes: unknown[]; created_at: string };
  nodes: UNode[];
  edges: UEdge[];
  events: UEvent[];
  refs: { child_universe_id: string; added_at: string; hidden?: boolean }[];
  identity_links: { id: string; a: string; b: string; kind: string; method: string; status: string; reason: string; decided_by: string; decided_at: string }[];
}

export interface Derived {
  doc: UDoc; // 기준(가장 바깥) 문서
  docs: Map<string, UDoc>; // 유니버스 ID → 문서(하위 포함)
  resolve: (id: string) => UDoc | null;
  origin: Map<string, Origin>; // 전역 ID(유니버스/노드) → 원래 항목
  expanded: Set<string>; // 처음에 펼쳐 둘 하위 유니버스
}

/** 한 문서를 채우는 도구. 같은 원래 항목은 한 번만 노드가 된다 */
class DocBuilder {
  nodes: UNode[] = [];
  edges: UEdge[] = [];
  events: UEvent[] = [];
  private ids = new Map<string, string>(); // hideKey → 노드 ID
  private seq = { e: 0, v: 0 };
  constructor(readonly uid: string, readonly now: string, readonly hidden: Set<string>, readonly origin: Map<string, Origin>) {}

  teamRoot = ''; // ③ 팀 문서: 이 팀 이름(소속 연결을 지도 중심으로)
  otherTeams = new Set<string>(); // ③ 다른 팀 이름(소속은 그 팀 문서에서만 그린다)
  /** asRoot: 지도 중심(N-000)으로 만든다 */
  node(o: Origin, core_type: string, label: string, extra: Partial<UNode> = {}, asRoot = false): string {
    const k = hideKey(o);
    const have = this.ids.get(k);
    if (have) return have;
    const id = asRoot || o.kind === 'root' ? 'N-000' : `N-${o.kind}-${safe(o.id)}`;
    this.ids.set(k, id);
    this.nodes.push({ id, core_type, label: clip(label), hidden: id !== 'N-000' && this.hidden.has(k), created_at: this.now, updated_at: this.now, ...extra });
    this.origin.set(`${this.uid}/${id}`, o);
    return id;
  }
  has(o: Origin) {
    return this.ids.has(hideKey(o));
  }
  idOf(o: Origin) {
    return this.ids.get(hideKey(o));
  }
  edge(core_type: string, source: string, target: string, extra: Partial<UEdge> = {}) {
    if (source === target) return;
    if (!extra.period && this.edges.some((e) => e.core_type === core_type && e.source === source && e.target === target && !e.period)) return;
    this.seq.e += 1;
    this.edges.push({ id: `L-${String(this.seq.e).padStart(3, '0')}`, core_type, source, target, ...extra });
  }
  event(type: string, occurred_at: string, payload: Record<string, unknown>, note?: string) {
    if (!occurred_at) return;
    this.seq.v += 1;
    this.events.push({ id: `E-${String(this.seq.v).padStart(3, '0')}`, type, occurred_at, recorded_at: this.now, source: 'itda', payload, ...(note ? { note } : {}) });
  }
}

interface Ctx {
  s: AppState;
  actions: boolean; // 미완료 조치를 할 일 항목으로 넣을지(위험 점검은 업무만 센다)
  users: Map<string, User>;
  works: Map<string, Work>;
}

function addPerson(b: DocBuilder, c: Ctx, userId: string): string | null {
  const u = c.users.get(userId);
  if (!u) return null;
  const id = b.node({ kind: 'user', id: u.id }, 'person', u.name, { description: u.title || undefined, ...(u.empNo ? { emp_no: u.empNo } : {}) });
  const team = orgLabel(u.dept || '');
  if (!team || b.otherTeams.has(team)) return id;
  b.edge('belongs_to', id, team === b.teamRoot ? 'N-000' : b.node({ kind: 'org', id: team }, 'org', team));
  return id;
}

/** 업무 하나를 문서에 넣는다(담당·문서·조치·주제·메모·관계 기관). workNode: 이미 만든 노드 ID(지도 중심이면 N-000) */
function addWorkBody(b: DocBuilder, c: Ctx, w: Work, workNode: string) {
  // 담당: 기간마다 수행 연결 + 시작·종료 이력. 기간 기록이 없는 현재 담당자는 기간 없이 잇는다
  const periods = (w.ownerHistory || []).filter((p) => c.users.has(p.userId));
  for (const p of periods) {
    const pid = addPerson(b, c, p.userId);
    if (!pid) continue;
    b.edge('performs', pid, workNode, { period: { start: day(p.from), ...(p.to ? { end: day(p.to) } : {}) }, ...(p.note ? { note: p.note } : {}) });
    b.event('assign_start', day(p.from), { person_id: pid, work_id: workNode }, p.note);
    if (p.to) b.event('assign_end', day(p.to), { person_id: pid, work_id: workNode });
  }
  for (const o of w.owners) {
    if (periods.some((p) => p.userId === o && !p.to)) continue;
    const pid = addPerson(b, c, o);
    if (pid) b.edge('performs', pid, workNode);
  }
  // 확정된 인계: 전임 → 후임
  for (const h of c.s.handovers.filter((x) => x.workId === w.id && x.status === 'confirmed')) {
    const from = addPerson(b, c, h.fromId);
    const to = addPerson(b, c, h.toId);
    if (from && to) b.event('handover', day(h.confirmedAt || h.baseDate), { work_id: workNode, from_person_id: from, to_person_id: to }, `${h.id} 인계 확정`);
  }
  // 문서 → 산출물
  for (const d of c.s.docs.filter((x) => x.workIds.includes(w.id))) {
    const did = b.node({ kind: 'doc', id: d.id }, 'artifact', d.title, { subtype: d.type, ...(d.writtenAt ? { attrs: { 작성일: day(d.writtenAt) } } : {}) });
    b.edge('produces', workNode, did);
  }
  // 미완료 조치 → 할 일 업무(마감) + 담당
  if (c.actions) for (const a of c.s.actions.filter((x) => x.workId === w.id && x.status !== '완료')) addAction(b, c, a, workNode);
  // 주제
  for (const t of w.topics || []) {
    const name = String(t).trim();
    if (name) b.edge('relates_to', workNode, b.node({ kind: 'topic', id: name }, 'topic', name));
  }
  // 관계 기관·소관 기관
  for (const p of w.partners || []) {
    const name = orgLabel(p.name);
    if (name) b.edge('references', workNode, b.node({ kind: 'org', id: name }, 'org', name), p.role ? { note: p.role } : {});
  }
  const agency = orgLabel(w.agency || '');
  if (agency && !UNKNOWN_AGENCY.test(agency)) b.edge('references', workNode, b.node({ kind: 'org', id: agency }, 'org', agency), { note: '소관 기관' });
  // 메모: 진행 중 사항·유의사항(문장 하나가 메모 하나)
  const memo = (list: Stmt[], category: string) => list.forEach((st) => b.event('memo', day(w.updatedAt || w.createdAt), { target_id: workNode, category }, st.text));
  memo(w.current || [], 'in_progress');
  memo(w.cautions || [], 'caution');
}

function addAction(b: DocBuilder, c: Ctx, a: Action, workNode: string) {
  const aid = b.node({ kind: 'action', id: a.id }, 'work', shortTitle(a.title), { subtype: '할 일', description: a.title, attrs: { 상태: a.status, ...(a.due ? { 마감: day(a.due) } : {}) } });
  b.edge('contains', workNode, aid);
  const pid = a.ownerId ? addPerson(b, c, a.ownerId) : null;
  if (pid) b.edge('performs', pid, aid);
}

/** 할 일 이름: 문서에서 뽑은 조치는 문장 전체라 지도에 그대로 쓰면 빽빽하다. 날짜·「까지」를 떼고 ACTION_LABEL_MAX자에서 자른다(전체는 설명·카드에) */
export const ACTION_LABEL_MAX = 22;
export function shortTitle(t: string): string {
  let x = String(t).replace(/\s+/g, ' ').trim();
  x = x.replace(/\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\.?\s*(?:까지\s*)?/g, '').replace(/\s+/g, ' ').trim(); // 날짜는 마감으로 따로 보인다
  x = x.replace(/(?:할|될)?\s*(?:예정|계획)임\.?$|함\.?$|임\.?$/, '').trim();
  return x.length > ACTION_LABEL_MAX ? `${x.slice(0, ACTION_LABEL_MAX - 1)}…` : x || t;
}

/** 완료한 업무는 기간 끝(완료 시점 ≈ 마지막 갱신)을 둔다 — 업무 유니버스 위험 규칙이 진행 중인 업무만 센다(검토 2026-10-29) */
function workPeriod(w: Work): { period?: { start?: string; end?: string } } {
  return w.status === '완료' ? { period: { start: day(w.createdAt), end: day(w.updatedAt || w.createdAt) } } : {};
}

function workAttrs(w: Work): Record<string, string> {
  return { 상태: w.status, ...(w.type ? { 유형: w.type } : {}), ID: w.id };
}

/** 업무들(과 그 하위 업무)을 평평한 문서 하나에 넣는다. 범위 밖 업무와의 관계는 「범위 밖」 업무 항목으로 잇는다 */
function fillWorks(b: DocBuilder, c: Ctx, list: Work[], rootFor: (w: Work) => string | null) {
  const inScope = new Set(list.map((w) => w.id));
  const nodeOf = (w: Work) => (rootFor(w) === 'N-000' ? 'N-000' : b.node({ kind: 'work', id: w.id }, 'work', w.name, { description: w.summary || undefined, attrs: workAttrs(w), ...workPeriod(w) }));
  // 먼저 업무 노드를 모두 만들어 둔다(관계를 그릴 때 순서와 상관없게)
  for (const w of list) nodeOf(w);
  for (const w of list) {
    const me = nodeOf(w);
    const parent = w.parentId && inScope.has(w.parentId) ? nodeOf(c.works.get(w.parentId)!) : rootFor(w);
    if (parent && parent !== me) b.edge('contains', parent, me);
    addWorkBody(b, c, w, me);
  }
  const stub = (id: string) => {
    const o = c.works.get(id);
    return o ? b.node({ kind: 'work', id: o.id }, 'work', o.name, { attrs: { ...workAttrs(o), 범위: '이 지도 밖' }, ...workPeriod(o) }) : null;
  };
  for (const w of list) {
    const me = nodeOf(w);
    for (const r of w.relatedIds || []) {
      const t = inScope.has(r) ? nodeOf(c.works.get(r)!) : stub(r);
      if (t && !b.edges.some((e) => e.core_type === 'references' && ((e.source === t && e.target === me) || (e.source === me && e.target === t)))) b.edge('references', me, t, { note: '관련 업무' });
    }
    for (const n of w.nextIds || []) {
      const t = inScope.has(n) ? nodeOf(c.works.get(n)!) : stub(n);
      if (t) b.edge('precedes', me, t);
    }
    if (w.parentId && !inScope.has(w.parentId)) {
      const p = stub(w.parentId);
      if (p) b.edge('contains', p, me);
    }
  }
}

function finish(b: DocBuilder, name: string, level: string, description?: string): UDoc {
  return {
    schema_version: '1.0',
    universe: { id: b.uid, name, level, ...(description ? { description } : {}), root_node_id: 'N-000', subtypes: [], created_at: b.now },
    nodes: b.nodes,
    edges: b.edges,
    events: b.events,
    refs: [],
    identity_links: [],
  };
}

/** 업무 ID와 그 아래(하위의 하위까지) 업무 */
function withDescendants(c: Ctx, ids: string[]): Work[] {
  const out = new Map<string, Work>();
  const queue = [...ids];
  while (queue.length) {
    const id = queue.shift()!;
    const w = c.works.get(id);
    if (!w || out.has(id)) continue;
    out.set(id, w);
    for (const ch of c.s.works) if (ch.parentId === id) queue.push(ch.id);
  }
  return [...out.values()];
}

/**
 * @param s 지도에 넣을 데이터(열람 범위로 거른 것을 넘긴다 — ①② 본인 범위, ③ 전체 보기 사용자 범위)
 * @param scope 지도 범위
 * @param now 기록 시각(ISO). 시험에서 고정한다
 */
export function deriveMap(s: AppState, scope: MapScope, now = new Date().toISOString(), opts: { actions?: boolean; people?: string[]; centerAsWork?: boolean } = {}): Derived {
  const c: Ctx = { s, actions: opts.actions !== false, users: new Map(s.users.map((u) => [u.id, u])), works: new Map(s.works.map((w) => [w.id, w])) };
  const hidden = new Set(s.mapHidden || []);
  const origin = new Map<string, Origin>();
  const docs = new Map<string, UDoc>();

  if (scope.kind === 'work') {
    const w = c.works.get(scope.workId);
    const b = new DocBuilder(`U-${safe(scope.workId)}`, now, hidden, origin);
    if (opts.centerAsWork) {
      // 인계 포인트용: 업무 유니버스 인수인계 규칙은 「work」 항목만 업무로 센다 — 지도 중심은 따로 두고 업무를 일반 업무 항목으로
      b.node({ kind: 'root', id: '인계' }, 'root', w ? w.name : scope.workId);
      if (w) fillWorks(b, c, withDescendants(c, [w.id]), (x) => (x.id === w.id ? 'ROOT' : null));
      for (const e of b.edges) if (e.source === 'ROOT') e.source = 'N-000';
    } else {
      b.node({ kind: 'work', id: scope.workId }, 'root', w ? w.name : scope.workId, { attrs: w ? workAttrs(w) : {} }, true);
      // 지도 중심 노드를 업무로도 찾을 수 있게(origin은 work)
      if (w) fillWorks(b, c, withDescendants(c, [w.id]), (x) => (x.id === w.id ? 'N-000' : null));
    }
    // 함께 둘 사람(인계 포인트의 인계자·인수자 — 아직 담당이 아니어도 지도에 있어야 규칙이 판단한다)
    for (const u of opts.people || []) addPerson(b, c, u);
    const doc = finish(b, w ? w.name : scope.workId, '업무', w?.summary);
    docs.set(doc.universe.id, doc);
    return { doc, docs, resolve: (id) => docs.get(id) ?? null, origin, expanded: new Set() };
  }

  if (scope.kind === 'mine') {
    const u = c.users.get(scope.userId);
    const b = new DocBuilder(`U-me-${safe(scope.userId)}`, now, hidden, origin);
    const title = u ? `${u.name}의 업무` : '내 업무';
    b.node({ kind: 'root', id: title }, 'root', title);
    const mine = s.works.filter((w) => w.owners.includes(scope.userId));
    fillWorks(b, c, withDescendants(c, mine.map((w) => w.id)), (w) => (w.parentId && mine.some((m) => m.id === w.parentId) ? null : 'ROOT'));
    // 위 rootFor는 'ROOT'(지도 중심과 잇기)를 돌려준다 → 지도 중심 ID로 바꿔 잇는다
    for (const e of b.edges) if (e.source === 'ROOT') e.source = 'N-000';
    const doc = finish(b, title, '개인');
    docs.set(doc.universe.id, doc);
    return { doc, docs, resolve: (id) => docs.get(id) ?? null, origin, expanded: new Set() };
  }

  // ③ 전체: 팀(업무의 담당 부서)마다 문서 하나 + 부서 문서가 묶음. 같은 사람(사번)·범위 밖으로 이어진 업무는 동일성 연결로 합친다
  const title = scope.title || '전체 업무';
  const top = s.works.filter((w) => !w.parentId || !c.works.has(w.parentId));
  const teams = new Map<string, Work[]>();
  for (const w of top) {
    const t = orgLabel(w.dept || '') || '소속 미정';
    if (!teams.has(t)) teams.set(t, []);
    teams.get(t)!.push(w);
  }
  const root = new DocBuilder('U-all', now, hidden, origin);
  root.node({ kind: 'root', id: title }, 'root', title);
  const rootDoc = finish(root, title, '부서');
  docs.set(rootDoc.universe.id, rootDoc);
  const expanded = new Set<string>();
  const teamDocs: UDoc[] = [];
  [...teams.keys()].sort().forEach((team, i) => {
    const b = new DocBuilder(`U-team-${i + 1}`, now, hidden, origin);
    b.teamRoot = team;
    b.otherTeams = new Set([...teams.keys()].filter((t) => t !== team));
    b.node({ kind: 'org', id: team }, 'root', team, {}, true);
    fillWorks(b, c, withDescendants(c, teams.get(team)!.map((w) => w.id)), (w) => (teams.get(team)!.some((t) => t.id === w.id) ? 'ROOT' : null));
    for (const e of b.edges) if (e.source === 'ROOT') e.source = 'N-000';
    const doc = finish(b, team, '팀');
    docs.set(doc.universe.id, doc);
    teamDocs.push(doc);
    rootDoc.refs.push({ child_universe_id: doc.universe.id, added_at: now });
  });
  // 동일성 연결: 같은 원래 항목(사람·업무·조직·주제)이 여러 팀 문서에 있으면 하나로 합친다
  const byKey = new Map<string, string[]>();
  for (const d of teamDocs) {
    for (const n of d.nodes) {
      const o = origin.get(`${d.universe.id}/${n.id}`);
      if (!o || n.id === 'N-000' || o.kind === 'root' || o.kind === 'action' || o.kind === 'doc') continue;
      const k = hideKey(o);
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k)!.push(`${d.universe.id}/${n.id}`);
    }
  }
  let li = 0;
  for (const [k, gids] of byKey) {
    for (let i = 1; i < gids.length; i += 1) {
      li += 1;
      const isPerson = k.startsWith('user:');
      rootDoc.identity_links.push({
        id: `I-${String(li).padStart(3, '0')}`,
        a: gids[0],
        b: gids[i],
        kind: isPerson ? 'person' : k.startsWith('topic:') ? 'topic' : 'work',
        method: isPerson && personHasEmpNo(c, k) ? 'emp_no_auto' : 'human',
        status: 'confirmed',
        reason: isPerson ? '업무잇다의 같은 사용자' : '업무잇다의 같은 항목',
        decided_by: '업무잇다(자동)',
        decided_at: now,
      });
    }
  }
  return { doc: rootDoc, docs, resolve: (id) => docs.get(id) ?? null, origin, expanded };
}

function personHasEmpNo(c: Ctx, key: string) {
  return !!c.users.get(key.slice('user:'.length))?.empNo;
}

/** 전역 ID(대표 노드)의 원래 항목. 합쳐진 노드면 대표의 원래 항목 */
export function originOf(d: Derived, gid: string): Origin | null {
  return d.origin.get(gid) ?? null;
}

export type { Doc };
