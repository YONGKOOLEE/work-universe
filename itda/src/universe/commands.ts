// 지도에서 고치기(CR-24 D24-5): 모든 동작은 AppState(초안 사본)를 고치는 명령이다. 지도는 고친 AppState에서 다시 파생한다.
// 각 명령은 바꾼 업무 ID와 변경 이력 문장을 돌려준다(화면이 store.log·touch로 기록). 고칠 것이 없으면 null.
// 브라우저 기능을 쓰지 않는다(vitest로 검증).
import type { AppState, Stmt } from '../lib/types';

export interface Change {
  workId: string;
  summary: string;
}

const name = (d: AppState, userId: string) => d.users.find((u) => u.id === userId)?.name ?? userId;
const work = (d: AppState, id: string) => d.works.find((w) => w.id === id);
let seq = 0;
const sid = (prefix: string) => `${prefix}-${Date.now().toString(36)}${(seq += 1).toString(36)}`;

/**
 * 담당 넘기기·추가. add: 공동 담당으로 더함, hand: 기존 담당을 모두 끝내고 이 사람만 담당
 * 담당 기간(ownerHistory)은 업무잇다 인계 확정과 같은 방식으로 남긴다(끝난 기간도 지우지 않음)
 */
export function assignOwner(d: AppState, workId: string, userId: string, mode: 'add' | 'hand', today: string): Change | null {
  const w = work(d, workId);
  if (!w || !d.users.some((u) => u.id === userId)) return null;
  if (mode === 'add' && w.owners.includes(userId)) return null;
  if (mode === 'hand' && w.owners.length === 1 && w.owners[0] === userId) return null;
  const before = [...w.owners];
  if (mode === 'hand') {
    for (const p of w.ownerHistory) if (!p.to && p.userId !== userId) p.to = today;
    w.owners = [userId];
  } else {
    w.owners = [...w.owners, userId];
  }
  if (!w.ownerHistory.some((p) => p.userId === userId && !p.to)) w.ownerHistory.push({ userId, from: today, to: null, note: '지도에서 지정' });
  // 담당에서 빠진 사람의 미완료 조치는 새 담당에게 넘긴다(업무잇다 인계 확정과 같은 규칙)
  if (mode === 'hand') for (const a of d.actions) if (a.workId === workId && a.status !== '완료' && before.includes(a.ownerId) && a.ownerId !== userId) a.ownerId = userId;
  const summary = mode === 'hand' ? `담당자 ${before.map((u) => name(d, u)).join('·') || '없음'} → ${name(d, userId)} (지도에서 넘김)` : `담당자 ${name(d, userId)} 추가 (지도에서)`;
  return { workId, summary };
}

export type LinkKind = 'parent' | 'related' | 'next';
export const LINK_NAMES: Record<LinkKind, string> = { parent: '상위 업무', related: '관련 업무', next: '다음 업무(선후행)' };

/** 상위 업무를 정하면 순환(내 하위를 상위로)을 막는다 */
function isDescendant(d: AppState, ancestorId: string, id: string): boolean {
  let cur = work(d, id);
  const seen = new Set<string>();
  while (cur && cur.parentId && !seen.has(cur.id)) {
    if (cur.parentId === ancestorId) return true;
    seen.add(cur.id);
    cur = work(d, cur.parentId);
  }
  return false;
}

/** 업무 잇기: parent = fromId의 상위를 toId로, related = 서로 관련, next = fromId 다음에 toId */
export function linkWorks(d: AppState, fromId: string, toId: string, kind: LinkKind): Change | null {
  const a = work(d, fromId);
  const b = work(d, toId);
  if (!a || !b || fromId === toId) return null;
  if (kind === 'parent') {
    if (a.parentId === toId || isDescendant(d, fromId, toId)) return null;
    a.parentId = toId;
    return { workId: fromId, summary: `상위 업무를 '${b.name}'(으)로 지정 (지도에서)` };
  }
  if (kind === 'related') {
    if (a.relatedIds.includes(toId)) return null;
    a.relatedIds = [...a.relatedIds, toId];
    if (!b.relatedIds.includes(fromId)) b.relatedIds = [...b.relatedIds, fromId];
    return { workId: fromId, summary: `관련 업무 '${b.name}' 연결 (지도에서)` };
  }
  a.nextIds = a.nextIds || [];
  if (a.nextIds.includes(toId) || (b.nextIds || []).includes(fromId)) return null;
  a.nextIds = [...a.nextIds, toId];
  return { workId: fromId, summary: `다음 업무 '${b.name}' 연결 (지도에서)` };
}

/** 연결 끊기(지도 카드의 연결 목록에서) */
export function unlinkWorks(d: AppState, fromId: string, toId: string, kind: LinkKind): Change | null {
  const a = work(d, fromId);
  const b = work(d, toId);
  if (!a || !b) return null;
  if (kind === 'parent') {
    if (a.parentId !== toId) return null;
    a.parentId = null;
    return { workId: fromId, summary: `상위 업무 '${b.name}' 연결 해제 (지도에서)` };
  }
  if (kind === 'related') {
    if (!a.relatedIds.includes(toId) && !b.relatedIds.includes(fromId)) return null;
    a.relatedIds = a.relatedIds.filter((x) => x !== toId);
    b.relatedIds = b.relatedIds.filter((x) => x !== fromId);
    return { workId: fromId, summary: `관련 업무 '${b.name}' 연결 해제 (지도에서)` };
  }
  if (!(a.nextIds || []).includes(toId)) return null;
  a.nextIds = a.nextIds.filter((x) => x !== toId);
  return { workId: fromId, summary: `다음 업무 '${b.name}' 연결 해제 (지도에서)` };
}

export type MemoKind = 'caution' | 'current';
export const MEMO_NAMES: Record<MemoKind, string> = { caution: '유의·이슈', current: '진행 중' };

/** 메모: 담당자 작성 문장으로 업무 개요의 유의사항 또는 현재 진행 사항에 더한다 */
export function addMemo(d: AppState, workId: string, text: string, kind: MemoKind): Change | null {
  const w = work(d, workId);
  const t = text.replace(/\s+/g, ' ').trim();
  if (!w || !t) return null;
  const st: Stmt = { id: sid('S'), text: t, prov: 'owner' };
  if (kind === 'caution') w.cautions = [...w.cautions, st];
  else w.current = [...w.current, st];
  return { workId, summary: `${MEMO_NAMES[kind]} 메모 추가: ${t.length > 40 ? `${t.slice(0, 40)}…` : t} (지도에서)` };
}

export function addTopic(d: AppState, workId: string, topic: string): Change | null {
  const w = work(d, workId);
  const t = topic.replace(/\s+/g, ' ').trim();
  if (!w || !t) return null;
  w.topics = w.topics || [];
  if (w.topics.some((x) => x.replace(/\s+/g, '') === t.replace(/\s+/g, ''))) return null;
  w.topics = [...w.topics, t];
  return { workId, summary: `주제 '${t}' 붙임 (지도에서)` };
}

export function removeTopic(d: AppState, workId: string, topic: string): Change | null {
  const w = work(d, workId);
  if (!w || !(w.topics || []).includes(topic)) return null;
  w.topics = w.topics.filter((x) => x !== topic);
  return { workId, summary: `주제 '${topic}' 뗌 (지도에서)` };
}

/** 지도에서 숨김·다시 보이기(지도만 — 업무잇다 화면의 데이터는 그대로). 변경 이력에는 남기지 않는다 */
export function setMapHidden(d: AppState, key: string, hidden: boolean): boolean {
  const cur = new Set(d.mapHidden || []);
  if (hidden === cur.has(key)) return false;
  if (hidden) cur.add(key);
  else cur.delete(key);
  d.mapHidden = [...cur];
  return true;
}
