// 보는 범위 — 「오늘」·알림·메뉴 숫자·미팅 후 질문 대기를 누구의 고객까지 볼지.
//  mine: 내가 담당 영업자인 고객만(기본)  /  org: 조직장만 — 내 조직(아래 조직 포함) 담당자의 고객  /  all: 전체 보기(누구나)
// 순수 함수: 브라우저 기능을 쓰지 않는다(고른 범위를 기억하는 일은 화면의 hooks.ts가 한다).
import { isActiveLead, leadCoversDept } from '../lib/orgs';
import type { AppState } from '../lib/types';
import type { AssistantData } from './types';

export type ViewScope = 'mine' | 'org' | 'all';
export const SCOPE_NAMES: Record<ViewScope, string> = { mine: '내 담당 고객', org: '내 조직 전체', all: '전체 보기' };
export const isViewScope = (v: unknown): v is ViewScope => v === 'mine' || v === 'org' || v === 'all';

/** 이 사람이 고를 수 있는 범위(조직장이 아니면 「내 조직 전체」는 없다) */
export function scopeChoices(s: Pick<AppState, 'users'>, userId: string): ViewScope[] {
  return isActiveLead(s, userId) ? ['mine', 'org', 'all'] : ['mine', 'all'];
}
/** 고를 수 없는 범위(예: 조직장에서 내려온 뒤 기억된 「내 조직 전체」)는 기본 「내 담당」으로 */
export function effectiveScope(s: Pick<AppState, 'users'>, userId: string, want: ViewScope | null | undefined): ViewScope {
  return want && scopeChoices(s, userId).includes(want) ? want : 'mine';
}

/** 범위 안 고객 ID. all이면 null(제한 없음) */
export function customerIdsInScope(s: AppState, a: AssistantData, userId: string, scope: ViewScope): Set<string> | null {
  const sc = effectiveScope(s, userId, scope);
  if (sc === 'all') return null;
  const ids = new Set<string>();
  for (const c of a.customers) {
    if (c.ownerId === userId) ids.add(c.id);
    else if (sc === 'org') {
      const owner = s.users.find((u) => u.id === c.ownerId);
      if (owner && leadCoversDept(s, owner.dept, userId)) ids.add(c.id);
    }
  }
  return ids;
}

/** ids에 든 고객과 그 하위 기록만 남긴 읽기용 사본(얕은 복사 — 원본은 바꾸지 않는다). ids가 null이면 그대로 */
export function filterAssistant(a: AssistantData, ids: ReadonlySet<string> | null | undefined): AssistantData {
  if (!ids) return a;
  const interactions = a.interactions.filter((i) => ids.has(i.customerId));
  const iids = new Set(interactions.map((i) => i.id));
  return {
    ...a,
    customers: a.customers.filter((c) => ids.has(c.id)),
    interactions,
    requests: a.requests.filter((r) => ids.has(r.customerId)),
    anniversaries: a.anniversaries.filter((x) => ids.has(x.customerId)),
    changes: a.changes.filter((h) => ids.has(h.customerId)),
    followups: a.followups.filter((f) => iids.has(f.interactionId)),
  };
}

/** 내 담당 고객 수(범위 안내문에 쓴다) */
export const ownedCount = (a: AssistantData, userId: string) => a.customers.filter((c) => c.ownerId === userId).length;
