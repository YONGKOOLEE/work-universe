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
 * 사용자별 열람 범위(사용자 결정 2026-10-29: 팀 업무는 모두가 보고, 개인 것만 거른다).
 * 볼 수 있는 업무 = 모든 업무(남의 업무는 읽기 전용 — canEdit).
 * 나만 보는 것: 확정 전 인계(보내는 사람·받는 사람만), 「나만 보기」 메모, 업무 연결이 없는 문서(등록자만).
 * 확정된 인계는 당사자와 팀장이 본다.
 */
export function canSee(s: AppState, workId: string, _userId: string) {
  return s.works.some((x) => x.id === workId);
}

/** 고칠 수 있는가: 그 업무의 현재 담당자 또는 팀장(전체 보기 사용자) */
export function canEdit(s: AppState, workId: string, userId: string) {
  const w = s.works.find((x) => x.id === workId);
  if (!w) return false;
  return w.owners.includes(userId) || s.users.find((u) => u.id === userId)?.role === 'lead';
}

export function scopeFor(s: AppState, userId: string): AppState {
  const ids = new Set(s.works.filter((w) => canSee(s, w.id, userId)).map((w) => w.id));
  const docs = s.docs
    .filter((d) => (d.workIds.length ? d.workIds.some((w) => ids.has(w)) : d.registeredBy === userId || !!d.relevance?.some((r) => ids.has(r.workId))))
    .map((d) => ({ ...d, workIds: d.workIds.filter((w) => ids.has(w)) }));
  const docIds = new Set(docs.map((d) => d.id));
  // 인계: 당사자는 늘 보고, 팀장은 확정된 인계를 본다(확정 전 인계는 당사자만)
  const lead = s.users.find((u) => u.id === userId)?.role === 'lead';
  const handovers = s.handovers.filter((h) => h.fromId === userId || h.toId === userId || (lead && h.status === 'confirmed'));
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
    privateMemos: (s.privateMemos || []).filter((m) => m.userId === userId),
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
  /** 저장 경고(비교 검토 2026-10-29): 브라우저 저장 실패, 다른 탭에서 바뀜 */
  saveIssue: { kind: 'fail' | 'other-tab'; at: string } | null;
  /** 다른 탭에서 저장한 내용으로 이 탭을 바꾼다 */
  reloadFromStorage: () => void;
  /** 다른 탭 경고 중 이 탭 내용으로 저장(덮어쓰기) */
  overwriteFromThisTab: () => void;
  /** 경고 닫기. 다른 탭 경고에서는 「이 탭 내용으로 저장(덮어쓰기)」와 같다(닫으면서 저장이 다시 시작되므로) */
  dismissSaveIssue: () => void;
}
const StoreCtx = createContext<Ctx | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [raw, setS] = useState<AppState>(load);
  const [toastMsg, setToast] = useState<string | null>(null);
  const timer = useRef<number>();

  const [saveIssue, setSaveIssue] = useState<Ctx['saveIssue']>(null);
  const lastWritten = useRef<string | null>(null);
  // 다른 탭 경고가 떠 있는 동안은 이 탭이 저장하지 않는다(업무 상세를 여는 focus 변경만으로도 다른 탭의 변경을 덮어쓰기 때문).
  // 「다시 불러오기」 또는 「이 탭 내용으로 저장(덮어쓰기)」를 고르면 풀린다.
  const blocked = useRef(false);
  useEffect(() => {
    if (blocked.current) return;
    const text = JSON.stringify(raw);
    try {
      localStorage.setItem(KEY, text);
      lastWritten.current = text;
      setSaveIssue((x) => (x?.kind === 'fail' ? null : x));
    } catch {
      // 용량 초과·저장소 막힘: 조용히 넘기지 않고 알린다(데이터는 이 탭 메모리에만 있음)
      setSaveIssue({ kind: 'fail', at: new Date().toISOString() });
    }
  }, [raw]);
  // 같은 파일을 다른 탭에서도 열어 고치면 서로 덮어쓴다 — 다른 탭의 저장을 알아채 알린다
  useEffect(() => {
    const on = (e: StorageEvent) => {
      if (e.key !== KEY || e.newValue === null || e.newValue === lastWritten.current) return;
      blocked.current = true;
      setSaveIssue({ kind: 'other-tab', at: new Date().toISOString() });
    };
    window.addEventListener('storage', on);
    return () => window.removeEventListener('storage', on);
  }, []);
  const reloadFromStorage = () => {
    try {
      const text = localStorage.getItem(KEY);
      const next = text ? parseBackup(text) : null; // 읽기에 실패하면 저장 멈춤을 유지한다
      blocked.current = false;
      if (next) setS(next);
      setSaveIssue(null);
    } catch {
      setSaveIssue({ kind: 'fail', at: new Date().toISOString() });
    }
  };
  const releaseBlock = () => {
    if (!blocked.current) return;
    blocked.current = false;
    setSaveIssue((x) => (x?.kind === 'other-tab' ? null : x));
  };
  /** 이 탭 내용으로 저장(덮어쓰기): 저장 멈춤을 풀고 지금 내용을 바로 저장한다 */
  const overwriteFromThisTab = () => {
    blocked.current = false;
    const text = JSON.stringify(raw);
    try {
      localStorage.setItem(KEY, text);
      lastWritten.current = text;
      setSaveIssue(null);
    } catch {
      setSaveIssue({ kind: 'fail', at: new Date().toISOString() });
    }
  };

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
      timer.current = window.setTimeout(() => setToast(null), 4000);
    };
    return {
      s: view,
      raw,
      update,
      // 초기화·가져오기는 사용자가 데이터를 통째로 정하는 동작이라 다른 탭 경고의 저장 멈춤도 푼다
      reset: (mode) => {
        releaseBlock();
        setS(bundled() ?? createSeed(mode));
      },
      replace: (next) => {
        releaseBlock();
        setS(next);
      },
      me: raw.users.find((u) => u.id === raw.currentUserId) ?? raw.users[0],
      log,
      touch,
      toast,
      toastMsg,
      saveIssue,
      reloadFromStorage,
      overwriteFromThisTab,
      dismissSaveIssue: () => setSaveIssue((x) => (x?.kind === 'other-tab' ? x : null)), // 다른 탭 경고는 닫지 않는다 — 불러오기·이 탭으로 저장 중 하나를 고른다
    };
  }, [raw, view, toastMsg, saveIssue]); // eslint-disable-line react-hooks/exhaustive-deps

  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}

export function useStore() {
  const c = useContext(StoreCtx);
  if (!c) throw new Error('StoreProvider missing');
  return c;
}

/** 지금 사용자가 이 업무를 고칠 수 있는가(남의 업무는 읽기 전용) */
export function useCanEdit(workId: string | null | undefined) {
  const { raw } = useStore();
  return !!workId && canEdit(raw, workId, raw.currentUserId);
}

/** 업무 상세 안의 카드들이 읽기 전용인지(업무 상세가 정함, 기본은 고칠 수 있음) */
export const ReadOnlyCtx = createContext(false);
export const useReadOnly = () => useContext(ReadOnlyCtx);

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
