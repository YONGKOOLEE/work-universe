// AI 비서 화면 공통 훅 — 데이터 읽기, 지금 시각, 권한, 저장(복사본으로 먼저 해 보고 통과하면 반영).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore } from '../../lib/store';
import { useAI } from '../../ai/claude';
import type { AppState } from '../../lib/types';
import { assistantOf, canEditCustomer, ensureAssistant, isErr, type Err } from '../model';
import { unreadCount } from '../notices';
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

/** 왼쪽 메뉴에 붙일 안 읽은 알림 수 */
export function useUnreadCount(): number {
  const { raw } = useStore();
  const now = useNow();
  return useMemo(() => unreadCount(assistantOf(raw), now), [raw.assistant, now]); // eslint-disable-line react-hooks/exhaustive-deps
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
      if (customerId && !canEditCustomer(s, customerId, s.currentUserId)) return { error: '이 고객을 고칠 권한이 없습니다. 담당 영업자 또는 소속 조직의 조직장만 고칠 수 있습니다.' } as Err;
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
