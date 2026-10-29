// ─────────────────────────────────────────────────────────────
// 사람(AppState.users) 관리 명령 — 순수 함수. 브라우저 기능을 쓰지 않는다.
// 고칠 것이 없으면 null을 돌려주고, 거절·막힘은 error / blocked로 알린다.
// ─────────────────────────────────────────────────────────────
import type { AppState, User } from './types';
import { effectiveOrgs, orgOfName } from './orgs';

export type UserRole = NonNullable<User['role']>;
export interface PersonInput {
  name: string;
  dept: string;
  title: string;
  empNo?: string;
  role?: UserRole;
}

const EMP_NO = /^V-\d{4}$/;

/** 전출·퇴직 여부(status가 없으면 재직) */
export function isLeft(u: User | undefined): boolean {
  return u?.status === 'left';
}

/** 선택 목록에 보일 사람: 재직자 + 이미 선택·지정된 사람(keep) */
export function selectableUsers(users: User[], keep: string[] = []): User[] {
  return users.filter((u) => !isLeft(u) || keep.includes(u.id));
}

/** 역할 표시: member는 팀원, lead는 소속 조직 단계에 따라 팀장·부장·본부장·대표(소속을 알 수 없으면 조직장) */
export function roleLabel(s: Pick<AppState, 'orgs' | 'users' | 'works'>, u: User | undefined): string {
  if (u?.role !== 'lead') return '팀원';
  const level = orgOfName(effectiveOrgs(s), u.dept)?.level;
  return level === '팀' ? '팀장' : level === '부' ? '부장' : level === '본부' ? '본부장' : level === '회사' ? '대표' : '조직장';
}

/** 표시 이름: 전출·퇴직이면 「(전출·퇴직)」을 붙인다 */
export function displayName(u: User | undefined, fallback = ''): string {
  if (!u) return fallback;
  return isLeft(u) ? `${u.name} (전출·퇴직)` : u.name;
}

/**
 * 새 사람 번호: 남은 사람뿐 아니라 데이터 어디에든(업무·이력·메모·인계·스냅샷·열람 기억 등) 한 번이라도 쓰인
 * U 번호의 최댓값보다 크게 매긴다. 지운 사람의 번호를 다시 쓰면 남은 흔적이 새 사람에게 붙기 때문이다(A-M4).
 * 따옴표로 둘러싸인 값·키(「"U12"」)만 센다 — 글 속 우연한 글자로 번호가 커지는 일을 줄인다.
 */
function nextUserId(d: AppState): string {
  let max = 0;
  for (const u of d.users) {
    const m = /^U(\d+)$/.exec(u.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  for (const m of JSON.stringify(d).matchAll(/"U(\d+)"/g)) max = Math.max(max, Number(m[1]));
  return `U${max + 1}`;
}

/** 이 사람이 쓴 「나만 보기」 메모 건수(사람을 지우면 함께 지워진다) */
export function personPrivateMemoCount(d: AppState, id: string): number {
  return (d.privateMemos || []).filter((m) => m.userId === id).length;
}

type Clean = { name: string; dept: string; title: string; empNo?: string; role?: UserRole };

/** 입력 검사. 오류 문장 또는 정리된 값을 돌려준다 */
function check(d: AppState, input: PersonInput, selfId?: string): { error: string } | { value: Clean } {
  const name = input.name.replace(/\s+/g, ' ').trim();
  if (name.length < 2) return { error: '이름은 2자 이상이어야 합니다' };
  const empNo = input.empNo?.trim() || undefined;
  if (empNo) {
    if (!EMP_NO.test(empNo)) return { error: '사번은 「V-」 다음에 숫자 4자리여야 합니다(예: V-1234)' };
    if (d.users.some((u) => u.id !== selfId && u.empNo === empNo)) return { error: `사번 ${empNo}은 다른 사람이 이미 쓰고 있습니다` };
  }
  return { value: { name, dept: input.dept.trim(), title: input.title.trim(), empNo, role: input.role } };
}

export function addPerson(d: AppState, input: PersonInput): { id: string; summary: string } | { error: string } {
  const r = check(d, input);
  if ('error' in r) return r;
  const id = nextUserId(d);
  const u: User = { id, name: r.value.name, dept: r.value.dept, title: r.value.title, role: r.value.role ?? 'member' };
  if (r.value.empNo) u.empNo = r.value.empNo;
  d.users.push(u);
  return { id, summary: `사람 추가: ${u.name}` };
}

export function editPerson(d: AppState, id: string, patch: Partial<PersonInput>): { id: string; summary: string } | { error: string } | null {
  const u = d.users.find((x) => x.id === id);
  if (!u) return { error: '사람을 찾을 수 없습니다' };
  const r = check(d, { name: patch.name ?? u.name, dept: patch.dept ?? u.dept, title: patch.title ?? u.title, empNo: 'empNo' in patch ? patch.empNo : u.empNo, role: patch.role ?? u.role }, id);
  if ('error' in r) return r;
  const v = r.value;
  const changed: string[] = [];
  if (v.name !== u.name) changed.push('이름');
  if (v.dept !== u.dept) changed.push('부서');
  if (v.title !== u.title) changed.push('직급');
  if ((v.empNo ?? '') !== (u.empNo ?? '')) changed.push('사번');
  if ((v.role ?? 'member') !== (u.role ?? 'member')) changed.push('역할');
  if (!changed.length) return null;
  u.name = v.name;
  u.dept = v.dept;
  u.title = v.title;
  if (v.empNo) u.empNo = v.empNo;
  else delete u.empNo;
  u.role = v.role ?? 'member';
  return { id, summary: `사람 고침(${changed.join('·')}): ${u.name}` };
}

/** 이 사람 id를 가리키는 모든 곳을 설명 문장으로 모은다 */
export function personUsages(d: AppState, id: string): string[] {
  const out: string[] = [];
  const n = (label: string, count: number) => {
    if (count > 0) out.push(`${label} ${count}건`);
  };
  n('업무 담당', d.works.filter((w) => w.owners.includes(id)).length);
  n('업무 담당 이력', d.works.reduce((a, w) => a + w.ownerHistory.filter((o) => o.userId === id).length, 0));
  n('조치 담당', d.actions.filter((a) => a.ownerId === id).length);
  n('문서 등록자', d.docs.filter((x) => x.registeredBy === id).length);
  n('변경 기록', d.history.filter((h) => h.actorId === id).length);
  n('인계(인계자)', d.handovers.filter((h) => h.fromId === id).length);
  n('인계(인수자)', d.handovers.filter((h) => h.toId === id).length);
  n('인계 요청·진행 기록', d.handovers.reduce((a, h) => a + h.requests.filter((q) => q.byId === id).length + h.log.filter((l) => l.byId === id).length, 0));
  n('인계 스냅샷', d.snapshots.filter((sn) => sn.work.owners.includes(id) || sn.work.ownerHistory.some((o) => o.userId === id) || sn.actions.some((a) => a.ownerId === id)).length);
  return out;
}

export function removePerson(d: AppState, id: string): { id: string; summary: string } | { blocked: string[] } | { error: string } {
  const u = d.users.find((x) => x.id === id);
  if (!u) return { error: '사람을 찾을 수 없습니다' };
  if (d.currentUserId === id) return { blocked: ['지금 사용 중인 사람입니다(다른 사람으로 바꾼 뒤에 지울 수 있습니다)'] };
  const used = personUsages(d, id);
  if (used.length) return { blocked: used };
  d.users = d.users.filter((x) => x.id !== id);
  // 지운 사람의 「나만 보기」 메모도 함께 지운다(남기면 같은 번호를 쓰는 사람에게 보일 수 있음)
  const memos = personPrivateMemoCount(d, id);
  if (memos) d.privateMemos = (d.privateMemos || []).filter((m) => m.userId !== id);
  if (d.focus && id in d.focus) {
    const f = { ...d.focus };
    delete f[id];
    d.focus = f;
  }
  return { id, summary: `사람 지움: ${u.name}${memos ? ` (나만 보기 메모 ${memos}건도 지움)` : ''}` };
}

export function setPersonStatus(
  d: AppState,
  id: string,
  status: 'active' | 'left',
): { id: string; summary: string; ownedWorks: { id: string; name: string }[] } | { error: string } | null {
  const u = d.users.find((x) => x.id === id);
  if (!u) return { error: '사람을 찾을 수 없습니다' };
  if (status === 'left' && d.currentUserId === id) return { error: '지금 사용 중인 사람은 전출·퇴직으로 바꿀 수 없습니다' };
  if ((u.status ?? 'active') === status) return null;
  if (status === 'left') u.status = 'left';
  else delete u.status;
  const ownedWorks = status === 'left' ? d.works.filter((w) => w.owners.includes(id)).map((w) => ({ id: w.id, name: w.name })) : [];
  return { id, summary: status === 'left' ? `전출·퇴직 표시: ${u.name}` : `복귀: ${u.name}`, ownedWorks };
}
