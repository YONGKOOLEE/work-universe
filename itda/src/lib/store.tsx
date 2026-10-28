import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { AppState, HistoryEntry, Work } from './types';
import { createSeed, SCHEMA } from '../data/seed';
import { migrate } from './migrate';
import { uid } from './util';

/**
 * 제출본: HTML 안에 넣어 둔 초기 데이터(window.__WORKLINK_SEED__).
 * 있으면 그 데이터로 시작하고, 제출본마다 별도 저장 키를 써서 이전에 저장된 다른 데이터와 섞이지 않게 함.
 */
const BUNDLE = typeof window === 'undefined' ? undefined : (window as unknown as { __WORKLINK_SEED__?: { id: string; state: unknown } }).__WORKLINK_SEED__;
export const BUNDLED = !!BUNDLE;
const KEY = BUNDLE ? `worklink-submit-${BUNDLE.id}` : 'worklink-state';
function bundled(): AppState | null {
  if (!BUNDLE) return null;
  try {
    return parseBackup(JSON.stringify(BUNDLE.state));
  } catch {
    return null;
  }
}

/** 백업 파일(JSON 문자열)을 현재 버전 데이터로 변환. 형식이 맞지 않으면 오류 */
export function parseBackup(text: string): AppState {
  let s: any;
  try {
    s = JSON.parse(text);
  } catch {
    throw new Error('JSON 형식이 아닙니다');
  }
  if (!s || typeof s !== 'object' || !Array.isArray(s.works) || !Array.isArray(s.docs) || !Array.isArray(s.users)) throw new Error('업무잇다 데이터 형식이 아닙니다');
  if (s.schema === SCHEMA) return s as AppState;
  if (s.schema === 6) return migrate(s);
  throw new Error(`지원하지 않는 데이터 버전입니다 (schema ${s.schema})`);
}

function load(): AppState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s.schema === SCHEMA) return s as AppState;
      if (s.schema === 6) return migrate(s); // 이전 버전 데이터 보존 변환
    }
  } catch {
    /* 저장소 접근 불가 — 초기 데이터로 시작 */
  }
  return bundled() ?? createSeed('linked');
}

/**
 * 사용자별 열람 범위.
 * 볼 수 있는 업무 = 현재 담당자로 지정된 업무 + 인수 대기 중인 인계의 인수자로 지정된 업무.
 * 문서·이벤트·결정·조치·이력은 볼 수 있는 업무에 연결된 것만, 업무 연결이 없는 문서는 등록자만 본다.
 */
export function canSee(s: AppState, workId: string, userId: string) {
  const w = s.works.find((x) => x.id === workId);
  if (!w) return false;
  // 전체 보기 사용자(팀장 역할, CR-24 D24-4)는 모든 업무를 본다
  if (s.users.find((u) => u.id === userId)?.role === 'lead') return true;
  return w.owners.includes(userId) || s.handovers.some((h) => h.workId === workId && h.toId === userId && h.status !== 'confirmed');
}

export function scopeFor(s: AppState, userId: string): AppState {
  const ids = new Set(s.works.filter((w) => canSee(s, w.id, userId)).map((w) => w.id));
  const docs = s.docs
    .filter((d) => (d.workIds.length ? d.workIds.some((w) => ids.has(w)) : d.registeredBy === userId || !!d.relevance?.some((r) => ids.has(r.workId))))
    .map((d) => ({ ...d, workIds: d.workIds.filter((w) => ids.has(w)) }));
  const docIds = new Set(docs.map((d) => d.id));
  // 전체 보기 사용자(팀장 역할)는 모든 인계 기록·스냅샷을 본다(CR-24 D24-4)
  const lead = s.users.find((u) => u.id === userId)?.role === 'lead';
  const handovers = s.handovers.filter((h) => lead || h.fromId === userId || h.toId === userId);
  const hoIds = new Set(handovers.map((h) => h.id));
  return {
    ...s,
    works: s.works.filter((w) => ids.has(w.id)).map((w) => ({ ...w, relatedIds: w.relatedIds.filter((r) => ids.has(r)) })),
    docs: docs.map((d) => ({ ...d, relations: d.relations.filter((r) => docIds.has(r.targetId)) })),
    events: s.events.filter((e) => e.workIds.some((w) => ids.has(w))).map((e) => ({ ...e, workIds: e.workIds.filter((w) => ids.has(w)) })),
    decisions: s.decisions.filter((d) => ids.has(d.workId)),
    actions: s.actions.filter((a) => ids.has(a.workId)),
    history: s.history.filter((h) => ids.has(h.workId)),
    handovers,
    snapshots: s.snapshots.filter((x) => hoIds.has(x.handoverId)),
  };
}

interface Ctx {
  s: AppState; // 현재 사용자 열람 범위로 걸러진 데이터 (화면 표시용)
  raw: AppState; // 전체 데이터 (ID 생성·기록 조회용)
  update: (fn: (draft: AppState) => AppState | void) => void;
  reset: (mode: 'linked' | 'fresh') => void;
  replace: (next: AppState) => void;
  me: AppState['users'][number];
  log: (draft: AppState, workId: string, kind: string, summary: string, actorId?: string) => void;
  touch: (draft: AppState, workId: string) => void;
  toast: (msg: string) => void;
  toastMsg: string | null;
}
const StoreCtx = createContext<Ctx | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [raw, setS] = useState<AppState>(load);
  const [toastMsg, setToast] = useState<string | null>(null);
  const timer = useRef<number>();

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(raw));
    } catch {
      /* 무시 */
    }
  }, [raw]);

  const view = useMemo(() => scopeFor(raw, raw.currentUserId), [raw]);

  const value = useMemo<Ctx>(() => {
    const update: Ctx['update'] = (fn) =>
      setS((prev) => {
        const draft = JSON.parse(JSON.stringify(prev)) as AppState;
        const r = fn(draft);
        return r ?? draft;
      });
    const log: Ctx['log'] = (draft, workId, kind, summary, actorId) => {
      const e: HistoryEntry = { id: uid('H'), workId, at: new Date().toISOString(), actorId: actorId ?? draft.currentUserId, kind, summary };
      draft.history.push(e);
    };
    const touch: Ctx['touch'] = (draft, workId) => {
      const w = draft.works.find((x: Work) => x.id === workId);
      if (w) {
        w.updatedAt = new Date().toISOString();
        w.version += 1;
      }
    };
    const toast = (msg: string) => {
      setToast(msg);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setToast(null), 2800);
    };
    return {
      s: view,
      raw,
      update,
      reset: (mode) => setS(bundled() ?? createSeed(mode)),
      replace: (next) => setS(next),
      me: raw.users.find((u) => u.id === raw.currentUserId) ?? raw.users[0],
      log,
      touch,
      toast,
      toastMsg,
    };
  }, [raw, view, toastMsg]);

  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}

export function useStore() {
  const c = useContext(StoreCtx);
  if (!c) throw new Error('StoreProvider missing');
  return c;
}

/** 사용자별 '보고 있는 업무' — 업무 관리·문서함·타임라인·회의록이 공유 */
export function useFocus(): [string, (id: string) => void] {
  const { s, raw, update } = useStore();
  const f = raw.focus?.[raw.currentUserId] ?? 'all';
  const valid = f === 'all' || s.works.some((w) => w.id === f) ? f : 'all';
  const set = (id: string) => {
    if (id === valid) return;
    update((d) => {
      d.focus = { ...(d.focus ?? {}), [d.currentUserId]: id };
    });
  };
  return [valid, set];
}

export function userName(s: AppState, id: string | 'ai') {
  if (id === 'ai') return 'AI 분석';
  return s.users.find((u) => u.id === id)?.name ?? id;
}

export function ownerNames(s: AppState, owners: string[]) {
  return owners.map((o) => userName(s, o)).join(', ') || '미지정';
}
