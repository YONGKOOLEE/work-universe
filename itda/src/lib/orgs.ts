// ─────────────────────────────────────────────────────────────
// 조직 계층(AppState.orgs) — 순수 함수. 브라우저 기능을 쓰지 않는다.
// 업무가 모여 팀, 팀이 모여 부, 부가 모여 본부, 회사 전체(사용자 결정 2026-10-29).
// 업무·사람의 dept는 조직 이름을 가리킨다. orgs가 없거나 이름이 목록에 없는 dept는 「상위 없는 팀」으로 본다(옛 데이터 그대로 동작).
// ─────────────────────────────────────────────────────────────
import { ORG_LEVELS, type AppState, type Org, type OrgLevel } from './types';

export const NO_ORG = '소속 미정';
const AUTO = 'auto:';

/** 화면 표시 이름: 「(시연용 가상 부서)」 같은 꼬리표를 뗀다 */
export const orgShort = (name: string) => String(name || '').replace(/\s*\((?:시연용 )?가상[^)]*\)\s*$/, '').trim();

const rank = (l: OrgLevel) => ORG_LEVELS.indexOf(l);

/** 쓰는 조직 목록: 저장된 조직 + 목록에 없는 dept 글자(상위 없는 팀으로) */
export function effectiveOrgs(s: Pick<AppState, 'orgs' | 'users' | 'works'>): Org[] {
  const list = [...(s.orgs || [])];
  const names = new Set(list.map((o) => o.name));
  for (const d of [...s.users.map((u) => u.dept), ...s.works.map((w) => w.dept)]) {
    const n = String(d || '').trim();
    if (!n || names.has(n)) continue;
    names.add(n);
    list.push({ id: `${AUTO}${n}`, name: n, level: '팀', parentId: null });
  }
  return list;
}

export const orgOfName = (orgs: Org[], name: string) => orgs.find((o) => o.name === String(name || '').trim()) ?? null;

/** 자기부터 맨 위까지(아래 → 위) */
export function orgChain(orgs: Org[], id: string | null | undefined): Org[] {
  const out: Org[] = [];
  const seen = new Set<string>();
  let cur = id ? orgs.find((o) => o.id === id) : undefined;
  while (cur && !seen.has(cur.id)) {
    out.push(cur);
    seen.add(cur.id);
    cur = cur.parentId ? orgs.find((o) => o.id === cur!.parentId) : undefined;
  }
  return out;
}

/** 소속 경로 글: 「결제서비스본부 › 전자금융부 › 출금이체팀」(위 → 아래) */
export function orgPathText(orgs: Org[], deptName: string): string {
  const o = orgOfName(orgs, deptName);
  if (!o) return orgShort(deptName) || NO_ORG;
  return orgChain(orgs, o.id)
    .reverse()
    .map((x) => orgShort(x.name))
    .join(' › ');
}

export const orgChildren = (orgs: Org[], id: string | null) => orgs.filter((o) => o.parentId === id);

/** 그 조직과 아래 조직 전부의 이름 */
export function subtreeNames(orgs: Org[], id: string): Set<string> {
  const out = new Set<string>();
  const queue = [id];
  const seen = new Set<string>();
  while (queue.length) {
    const x = queue.shift()!;
    if (seen.has(x)) continue;
    seen.add(x);
    const o = orgs.find((y) => y.id === x);
    if (o) out.add(o.name);
    queue.push(...orgChildren(orgs, x).map((c) => c.id));
  }
  return out;
}

/** 그 조직(아래 조직 포함)이 담당하는 업무 */
export function worksOfOrg(s: Pick<AppState, 'orgs' | 'users' | 'works'>, id: string) {
  const names = subtreeNames(effectiveOrgs(s), id);
  return s.works.filter((w) => names.has(String(w.dept || '').trim()));
}

/** 목록 표시용: 위에서 아래로, 깊이와 함께(고르기 칸·조직 화면) */
export function orgTree(orgs: Org[]): { org: Org; depth: number }[] {
  const out: { org: Org; depth: number }[] = [];
  const seen = new Set<string>();
  const ids = new Set(orgs.map((o) => o.id));
  const walk = (pid: string | null, depth: number) => {
    orgs
      .filter((o) => (pid === null ? !o.parentId || !ids.has(o.parentId) : o.parentId === pid))
      .sort((a, b) => rank(a.level) - rank(b.level) || a.name.localeCompare(b.name, 'ko'))
      .forEach((o) => {
        if (seen.has(o.id)) return;
        seen.add(o.id);
        out.push({ org: o, depth });
        walk(o.id, depth + 1);
      });
  };
  walk(null, 0);
  return out;
}

// ── 명령(조직 화면) ─────────────────────────────────────────────
type Result = { id: string; summary: string } | { error: string };

/** 목록에 없던 dept 글자(자동 팀)를 저장된 조직으로 만든다 — 명령 전에 한 번 */
function materialize(d: AppState): Org[] {
  const saved = d.orgs || [];
  let n = maxNo(saved);
  const extra = effectiveOrgs(d)
    .filter((o) => o.id.startsWith(AUTO))
    .map((o) => ({ ...o, id: `O-${String((n += 1)).padStart(3, '0')}` }));
  d.orgs = [...saved, ...extra];
  return d.orgs;
}

const maxNo = (orgs: Org[]) => orgs.reduce((m, o) => Math.max(m, Number(/^O-(\d+)$/.exec(o.id)?.[1] ?? 0)), 0);
const nextOrgId = (orgs: Org[]) => `O-${String(maxNo(orgs) + 1).padStart(3, '0')}`;

function checkParent(orgs: Org[], selfId: string | null, level: OrgLevel, parentId: string | null): string | null {
  if (!parentId) return null;
  const p = orgs.find((o) => o.id === parentId);
  if (!p) return '상위 조직을 찾을 수 없습니다';
  if (selfId && orgChain(orgs, parentId).some((o) => o.id === selfId)) return '자기 아래 조직을 상위로 둘 수 없습니다';
  if (rank(p.level) >= rank(level)) return `${level}의 상위는 ${level}보다 큰 단계(${ORG_LEVELS.slice(0, rank(level)).join('·') || '없음'})여야 합니다`;
  return null;
}

export function addOrg(d: AppState, input: { name: string; level: OrgLevel; parentId: string | null }): Result {
  const orgs = materialize(d);
  const name = input.name.replace(/\s+/g, ' ').trim();
  if (name.length < 2) return { error: '조직 이름은 2자 이상이어야 합니다' };
  if (orgs.some((o) => o.name === name)) return { error: `「${name}」은(는) 이미 있습니다` };
  if (!ORG_LEVELS.includes(input.level)) return { error: '조직 단계를 고르세요' };
  const bad = checkParent(orgs, null, input.level, input.parentId);
  if (bad) return { error: bad };
  const id = nextOrgId(orgs);
  orgs.push({ id, name, level: input.level, parentId: input.parentId || null });
  return { id, summary: `조직 추가: ${orgShort(name)}(${input.level})` };
}

/** 이름·단계·상위 바꾸기. 이름을 바꾸면 그 조직을 가리키던 업무·사람의 dept도 바꾼다. 상위 바꾸기가 곧 조직개편 */
export function editOrg(d: AppState, id: string, patch: Partial<{ name: string; level: OrgLevel; parentId: string | null }>): Result | null {
  const eff = effectiveOrgs(d);
  const before = eff.find((o) => o.id === id);
  if (!before) return { error: '조직을 찾을 수 없습니다' };
  const orgs = materialize(d);
  const o = orgs.find((x) => x.name === before.name)!;
  const name = (patch.name ?? o.name).replace(/\s+/g, ' ').trim();
  const level = patch.level ?? o.level;
  const parentId = patch.parentId === undefined ? o.parentId : patch.parentId || null;
  if (name.length < 2) return { error: '조직 이름은 2자 이상이어야 합니다' };
  if (name !== o.name && orgs.some((x) => x.name === name)) return { error: `「${name}」은(는) 이미 있습니다` };
  const bad = checkParent(orgs, o.id, level, parentId);
  if (bad) return { error: bad };
  if (orgChildren(orgs, o.id).some((c) => rank(c.level) <= rank(level))) return { error: `아래 조직보다 작은 단계로 바꿀 수 없습니다` };
  const changed: string[] = [];
  if (name !== o.name) {
    changed.push(`이름 ${orgShort(o.name)} → ${orgShort(name)}`);
    for (const u of d.users) if (u.dept === o.name) u.dept = name;
    for (const w of d.works) if (w.dept === o.name) w.dept = name;
    o.name = name;
  }
  if (level !== o.level) {
    changed.push(`단계 ${o.level} → ${level}`);
    o.level = level;
  }
  if (parentId !== o.parentId) {
    const nm = (x: string | null) => (x ? orgShort(orgs.find((y) => y.id === x)?.name ?? x) : '없음');
    changed.push(`상위 ${nm(o.parentId)} → ${nm(parentId)}`);
    o.parentId = parentId;
  }
  if (!changed.length) return null;
  return { id: o.id, summary: `조직 고침: ${orgShort(o.name)} — ${changed.join(', ')}` };
}

/** 아래 조직·업무·사람이 없을 때만 지운다 */
export function removeOrg(d: AppState, id: string): Result {
  const eff = effectiveOrgs(d);
  const o = eff.find((x) => x.id === id);
  if (!o) return { error: '조직을 찾을 수 없습니다' };
  if (orgChildren(eff, id).length) return { error: '아래 조직이 있어 지울 수 없습니다. 아래 조직을 먼저 옮기세요' };
  const used = d.works.filter((w) => w.dept === o.name).length + d.users.filter((u) => u.dept === o.name).length;
  if (used) return { error: `이 조직에 속한 업무·사람(${used})이 있어 지울 수 없습니다` };
  d.orgs = (d.orgs || []).filter((x) => x.id !== id);
  return { id, summary: `조직 삭제: ${orgShort(o.name)}` };
}

/** 사람이 속한 조직부터 위로(팀 → 부 → 본부 → 회사). 지도·업무 관리의 「우리 팀·우리 부…」 칩 */
export function myOrgChain(s: Pick<AppState, 'orgs' | 'users' | 'works'>, userId: string): Org[] {
  const orgs = effectiveOrgs(s);
  const u = s.users.find((x) => x.id === userId);
  const o = u ? orgOfName(orgs, u.dept) : null;
  return o ? orgChain(orgs, o.id) : [];
}
