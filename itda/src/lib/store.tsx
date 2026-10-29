import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { AppState, Handover, HistoryEntry, Work } from './types';
import { createSeed, SCHEMA } from '../data/seed';
import { migrate } from './migrate';
import { nextId, uid } from './util';
import { orgScopeNames } from './orgs';
import { affectedWorkIds } from './docDelete';

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
  if (s.schema === SCHEMA || s.schema === 6) return migrate(s);
  throw new Error(`지원하지 않는 데이터 버전입니다 (schema ${s.schema})`);
}

function load(): AppState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s.schema === SCHEMA || s.schema === 6) return migrate(s); // aiChecks 정리 + 이전 버전 데이터 보존 변환
    }
  } catch {
    /* 저장소 접근 불가 — 초기 데이터로 시작 */
  }
  return bundled() ?? createSeed('linked');
}

/**
 * 사용자별 열람 범위(사용자 결정 2026-10-29: 팀 업무는 모두가 보고, 개인 것만 거른다).
 * 볼 수 있는 업무 = 모든 업무(남의 업무는 읽기 전용 — canEdit).
 * 나만 보는 것: 「나만 보기」 메모, 업무 연결이 없는 문서(등록자만).
 * 인계는 당사자(보내는·받는 사람)와, 그 업무가 자기 조직 범위 안인 조직장이 본다(조직장은 읽기 전용, 상태와 상관없이).
 * 그 밖의 사람은 못 본다 — 범위 밖 조직장에게 확정된 인계까지 열어 주던 규칙은 「조직 기준」과 맞지 않아 없앴다.
 */
export function canSee(s: AppState, workId: string, _userId: string) {
  return s.works.some((x) => x.id === workId);
}

/** 조직장 권한이 살아 있는가: role이 lead이고 전출·퇴직이 아님 */
function isActiveLead(s: Pick<AppState, 'users'>, userId: string) {
  const u = s.users.find((x) => x.id === userId);
  return u?.role === 'lead' && u.status !== 'left';
}

/** 그 업무가 이 사람(조직장)의 소속 조직 또는 아래 조직 업무인가. 조직장이 아니면 false */
export function inLeadScope(s: Pick<AppState, 'orgs' | 'users' | 'works'>, workId: string, userId: string) {
  if (!isActiveLead(s, userId)) return false;
  const w = s.works.find((x) => x.id === workId);
  return !!w && orgScopeNames(s, userId).has(String(w.dept || '').trim());
}

/** 고칠 수 있는가: 그 업무의 현재 담당자, 또는 소속 조직 범위 안 업무의 조직장(팀장·부장 등) */
export function canEdit(s: AppState, workId: string, userId: string) {
  const w = s.works.find((x) => x.id === workId);
  if (!w) return false;
  return w.owners.includes(userId) || inLeadScope(s, workId, userId);
}

export interface DocDeleteAccess {
  /** 지울 수 있다 */
  ok: boolean;
  /** 단추를 보인다(지울 수 있거나, 일부 업무만 고칠 수 있거나, 올린 사람) */
  show: boolean;
  /** 이 사람이 고칠 수 없어 막는 업무 */
  blocked: { id: string; name: string }[];
}

/**
 * 올린 문서를 지울 수 있는가. 문서를 지우면 연결된 업무와 이 문서를 인용한 모든 업무의 근거가 낮아지고 버전이 오른다.
 * 그러므로 그 업무 전부를 지금 사용자가 고칠 수 있을 때만 허용한다(canEdit 그대로, 새 권한 규칙 없음 — 올린 사람도 마찬가지).
 * 영향 업무가 하나도 없는 문서(연결·인용 없음)는 올린 사람만. 하나도 못 고치는 사람에게는 단추를 숨기고, 일부만 고치거나 올린 사람이면 단추를 보이되 막는다.
 */
export function docDeleteAccess(s: AppState, docId: string, userId: string): DocDeleteAccess {
  const d = s.docs.find((x) => x.id === docId);
  if (!d) return { ok: false, show: false, blocked: [] };
  const ids = affectedWorkIds(s, docId);
  const blocked = ids.filter((w) => !canEdit(s, w, userId)).map((w) => ({ id: w, name: s.works.find((x) => x.id === w)?.name ?? w }));
  const ok = ids.length ? !blocked.length : d.registeredBy === userId;
  const someEditable = ids.length > blocked.length;
  return { ok, show: ok || someEditable || d.registeredBy === userId, blocked };
}

export function canDeleteDoc(s: AppState, docId: string, userId: string) {
  return docDeleteAccess(s, docId, userId).ok;
}

/** 사람·조직을 추가·고치기·전출·삭제할 수 있는가: 조직장만 */
export function canEditPeople(s: Pick<AppState, 'users'>, userId: string) {
  return isActiveLead(s, userId);
}

/** 인계를 시작할 수 있는가: 담당자, 또는 범위 안 업무의 조직장(담당자 대신 시작) */
export function canStartHandoverFor(s: AppState, workId: string, userId: string) {
  return canEdit(s, workId, userId);
}

/**
 * 인계의 보내는 쪽 단계(사전 점검·보완·제출)를 누를 수 있는가: 보내는 사람,
 * 또는 조직장이 담당자 대신 시작한 인계에서 그 업무가 범위 안인 조직장. 받는 쪽 단계는 이 함수와 무관하다.
 */
export function canActAsSender(s: AppState, h: Pick<Handover, 'workId' | 'fromId' | 'startedById'>, userId: string) {
  return h.fromId === userId || (!!h.startedById && inLeadScope(s, h.workId, userId));
}

/**
 * 새 인계 만들기(순수). 시작하는 사람(actor)은 담당자 본인이거나 범위 안 조직장이어야 하고,
 * 보내는 사람은 그 업무의 담당자여야 한다. 조직장이 남의 담당 업무를 시작하면 startedById와 「대신 시작: 이름」 이력을 남긴다.
 */
export function buildHandover(
  s: AppState,
  input: { workId: string; fromId: string; toId: string; baseDate: string; actorId: string; now: string },
): { handover: Handover } | { error: string } {
  const w = s.works.find((x) => x.id === input.workId);
  if (!w) return { error: '업무를 찾을 수 없습니다' };
  if (!canStartHandoverFor(s, w.id, input.actorId)) return { error: '이 업무의 인계는 담당자 또는 소속 조직장만 시작할 수 있습니다(시작 권한 없음)' };
  if (!w.owners.includes(input.fromId)) return { error: '보내는 사람은 이 업무의 담당자여야 합니다' };
  if (input.actorId !== input.fromId && !inLeadScope(s, w.id, input.actorId)) return { error: '담당자 대신 인계를 시작할 수 있는 사람은 소속 조직장뿐입니다(시작 권한 없음)' };
  if (!input.toId || input.toId === input.fromId) return { error: '받는 사람을 보내는 사람과 다르게 고르세요' };
  if (w.owners.includes(input.toId)) return { error: '받는 사람이 이미 이 업무의 담당자입니다' };
  const proxy = input.actorId !== input.fromId;
  const actor = s.users.find((u) => u.id === input.actorId);
  const log: Handover['log'] = [{ at: input.now, byId: input.actorId, text: `인계 대상 업무 선택: ${w.name}` }];
  if (proxy) log.push({ at: input.now, byId: input.actorId, text: `대신 시작: ${actor?.name ?? input.actorId}` });
  return {
    handover: {
      id: nextId('HO', s.handovers.map((x) => x.id)),
      workId: w.id,
      fromId: input.fromId,
      toId: input.toId,
      baseDate: input.baseDate,
      status: 'draft',
      step: 2,
      precheckDone: false,
      checklist: { overview: false, progress: false, decisions: false, partners: false },
      supplement: '',
      fromLeaves: null,
      requests: [],
      log,
      ...(proxy ? { startedById: input.actorId } : {}),
      createdAt: input.now,
    },
  };
}

export function scopeFor(s: AppState, userId: string): AppState {
  const ids = new Set(s.works.filter((w) => canSee(s, w.id, userId)).map((w) => w.id));
  const docs = s.docs
    .filter((d) => (d.workIds.length ? d.workIds.some((w) => ids.has(w)) : d.registeredBy === userId || !!d.relevance?.some((r) => ids.has(r.workId))))
    .map((d) => ({ ...d, workIds: d.workIds.filter((w) => ids.has(w)) }));
  const docIds = new Set(docs.map((d) => d.id));
  // 인계: 당사자는 늘 보고, 조직장은 자기 조직 범위 안 업무의 인계를 상태와 상관없이 본다(읽기 전용)
  const handovers = s.handovers.filter((h) => h.fromId === userId || h.toId === userId || inLeadScope(s, h.workId, userId));
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

/** 지금 사용자가 사람·조직을 고칠 수 있는가(조직장만) */
export function useCanEditPeople() {
  const { raw } = useStore();
  return canEditPeople(raw, raw.currentUserId);
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
