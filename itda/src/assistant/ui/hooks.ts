// AI 비서 화면 공통 훅 — 데이터 읽기, 지금 시각, 권한, 저장(복사본으로 먼저 해 보고 통과하면 반영).
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useStore } from '../../lib/store';
import { useAI } from '../../ai/claude';
import type { AppState } from '../../lib/types';
import { assistantOf, canEditCustomer, ensureAssistant, isErr, type Err } from '../model';
import { unreadCount } from '../notices';
import { customerIdsInScope, effectiveScope, filterAssistant, isViewScope, ownedCount, scopeChoices, type ViewScope } from '../scope';
import type { AssistantData } from '../types';

/** 지금 시각. 화면이 열려 있는 동안 1분마다 새로 읽는다(알림·D-day가 시간이 지나면 바뀌게) */
export function useNow(intervalMs = 60000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(t);
  }, [intervalMs]);
  return now;
}

// ───────────── 보는 범위(내 담당 / 내 조직 전체 / 전체 보기) ─────────────
// 사용자마다 고른 범위를 localStorage에 기억한다. 저장소를 못 쓰면(막힌 환경) 이 탭에서만 기억하고 오류는 무시한다.
const scopeKey = (userId: string) => `itda-asst-scope:${userId}`;
const memoryScope = new Map<string, ViewScope>();
const scopeListeners = new Set<() => void>();
let scopeVersion = 0;
function readScope(userId: string): ViewScope | null {
  try {
    const v = localStorage.getItem(scopeKey(userId));
    if (isViewScope(v)) return v;
  } catch {
    /* 저장소를 못 쓰면 이 탭의 기억만 쓴다 */
  }
  return memoryScope.get(userId) ?? null;
}
function writeScope(userId: string, v: ViewScope) {
  memoryScope.set(userId, v);
  try {
    localStorage.setItem(scopeKey(userId), v);
  } catch {
    /* 기억하지 못해도 이 탭에서는 바뀐 채로 둔다 */
  }
  scopeVersion += 1;
  scopeListeners.forEach((l) => l());
}
const subscribeScope = (l: () => void) => {
  scopeListeners.add(l);
  return () => void scopeListeners.delete(l);
};

/**
 * 「오늘」·알림·메뉴 숫자·미팅 후 질문 대기가 볼 고객 범위. 기본은 내 담당 고객만.
 * 조직장은 「내 조직 전체」, 누구나 「전체 보기」를 고를 수 있다(고른 범위는 사용자별로 기억).
 */
export function useViewScope() {
  const { raw } = useStore();
  useSyncExternalStore(subscribeScope, () => scopeVersion);
  const userId = raw.currentUserId;
  const scope = effectiveScope(raw, userId, readScope(userId));
  const a = useMemo(() => assistantOf(raw), [raw.assistant]); // eslint-disable-line react-hooks/exhaustive-deps
  const ids = useMemo(() => customerIdsInScope(raw, a, userId, scope), [raw, a, userId, scope]);
  const view = useMemo(() => filterAssistant(a, ids), [a, ids]);
  return {
    userId,
    scope,
    setScope: (v: ViewScope) => writeScope(userId, v),
    choices: scopeChoices(raw, userId),
    ids,
    /** 범위 안 고객만 남긴 읽기용 사본 */
    view,
    /** 내가 담당하는 고객 수 */
    mine: ownedCount(a, userId),
    total: a.customers.length,
  };
}

/** 왼쪽 메뉴에 붙일 안 읽은 알림 수(고른 범위, 읽음은 사용자별) */
export function useUnreadCount(): number {
  const { raw } = useStore();
  const now = useNow();
  const { ids, userId } = useViewScope();
  return useMemo(() => unreadCount(assistantOf(raw), now, { userId, ids }), [raw.assistant, now, ids, userId]); // eslint-disable-line react-hooks/exhaustive-deps
}

export type Exec = <T>(customerId: string | null, fn: (s: AppState, a: AssistantData) => T) => T | Err;

export function useAssistant() {
  const { raw, update, toast, me } = useStore();
  const ai = useAI();
  const now = useNow();
  const a = useMemo(() => assistantOf(raw), [raw.assistant]); // eslint-disable-line react-hooks/exhaustive-deps
  const userId = raw.currentUserId;
  const canEdit = useCallback((customerId: string) => canEditCustomer(raw, customerId, userId), [raw, userId]);

  /**
   * 고치기. 먼저 복사본에서 해 보고 오류({error})면 저장하지 않고 그대로 돌려준다.
   * customerId를 주면 그 고객을 고칠 권한이 있을 때만 한다(권한 검사는 저장 직전에 한 번 더).
   * fn은 같은 입력이면 같은 결과를 내야 한다(복사본과 실제 저장소에서 두 번 실행한다).
   */
  const exec: Exec = (customerId, fn) => {
    const run = (s: AppState, d: AssistantData) => {
      if (customerId && !canEditCustomer(s, customerId, s.currentUserId)) return { error: '이 고객을 고칠 권한이 없습니다. 담당 영업자 또는 담당자의 조직장만 고칠 수 있습니다.' } as Err;
      return fn(s, d);
    };
    const probe = JSON.parse(JSON.stringify(a)) as AssistantData;
    const r = run({ ...raw, assistant: probe }, probe);
    if (isErr(r)) return r;
    // 등록 중복 후보처럼 아무것도 바꾸지 않은 결과는 저장하지 않는다
    if (r && typeof r === 'object' && 'duplicates' in (r as object)) return r;
    update((d) => {
      run(d, ensureAssistant(d));
    });
    return r;
  };

  return { raw, a, now, me, userId, ai, toast, canEdit, exec };
}
export type AssistantCtx = ReturnType<typeof useAssistant>;
