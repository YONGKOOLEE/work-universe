// 마지막 AI 점검 결과 저장(업무마다 1개) — 순수 함수. 브라우저 기능을 쓰지 않는다.
// 저장 칸은 AppState.aiChecks(업무 내용이 아니므로 Work.version·updatedAt을 올리지 않는다).
import type { AiCheckFinding, AiCheckKind, AiCheckRecord, AppState, Cite } from './types';

const KINDS: AiCheckKind[] = ['missing_action', 'missing_due', 'conflict', 'stale', 'missing_info', 'risk'];
const SEV = ['high', 'mid', 'low'];

export interface CheckLike {
  findings: AiCheckFinding[];
  dropped: number;
}

/** 저장할 기록 만들기. 키·프롬프트는 받지도 담지도 않는다 */
export function makeAiCheckRecord(r: CheckLike, meta: { at: string; byId: string; model: string; workVersion: number; docIds?: string[] }): AiCheckRecord {
  return { at: meta.at, byId: meta.byId, engine: 'claude', model: meta.model, workVersion: meta.workVersion, ...(meta.docIds ? { docIds: [...meta.docIds].sort() } : {}), findings: r.findings.map((f) => ({ ...f, cite: f.cite ? { ...f.cite } : null })), dropped: r.dropped };
}

type LogFn = (draft: AppState, workId: string, kind: string, summary: string, actorId?: string) => void;

/** 마지막 결과로 덮어쓰고 업무 이력에 한 줄. log는 store의 log(버전을 올리지 않음). 업무가 없으면 저장하지 않고 false */
export function saveAiCheck(d: AppState, workId: string, rec: AiCheckRecord, log: LogFn, allowed = true): boolean {
  if (!allowed) return false; // 고칠 권한이 없는 사람의 점검은 저장·이력 없이 화면에만 보인다
  if (!d.works.some((w) => w.id === workId)) return false;
  d.aiChecks = { ...(d.aiChecks ?? {}), [workId]: rec };
  log(d, workId, 'AI 점검', `AI 점검 ${rec.findings.length}건 (Claude)`, rec.byId);
  return true;
}

/** 그 업무에 연결된 문서 ID(정렬) */
export function linkedDocIds(docs: { id: string; workIds: string[] }[], workId: string): string[] {
  return docs.filter((d) => d.workIds.includes(workId)).map((d) => d.id).sort();
}

/** 점검 뒤 업무 기록이 바뀌었는가: Work.version이 다르거나(기록을 고칠 때마다 오른다), 연결 문서 목록이 다르면(승인 0건 연결 등 version이 안 오르는 경우).
 *  저장된 docIds가 없는 옛 기록은 version만 비교. docs를 안 넘기면 문서 비교는 건너뛴다 */
export function isAiCheckStale(rec: Pick<AiCheckRecord, 'workVersion' | 'docIds'>, work: { id?: string; version: number } | undefined, docs?: { id: string; workIds: string[] }[]): boolean {
  if (!work) return false;
  if (work.version !== rec.workVersion) return true;
  if (rec.docIds && docs && work.id) {
    const now = linkedDocIds(docs, work.id);
    return now.length !== rec.docIds.length || now.some((x, i) => x !== [...rec.docIds!].sort()[i]);
  }
  return false;
}

/** 업무가 지워질 때 그 저장값 정리 */
export function dropAiChecks(d: AppState, workId: string): void {
  if (!d.aiChecks || !(workId in d.aiChecks)) return;
  const next = { ...d.aiChecks };
  delete next[workId];
  d.aiChecks = Object.keys(next).length ? next : undefined;
}

const str = (x: unknown): x is string => typeof x === 'string';
function cleanCite(c: unknown): Cite | null {
  if (!c || typeof c !== 'object') return null;
  const o = c as Record<string, unknown>;
  if (!str(o.docId)) return null;
  const out: Cite = { docId: o.docId };
  if (str(o.anchor)) out.anchor = o.anchor;
  if (str(o.label)) out.label = o.label;
  return out;
}
function cleanFinding(f: unknown): AiCheckFinding | null {
  if (!f || typeof f !== 'object') return null;
  const o = f as Record<string, unknown>;
  if (!KINDS.includes(o.kind as AiCheckKind) || !str(o.title) || !str(o.quote)) return null;
  return {
    kind: o.kind as AiCheckKind,
    severity: SEV.includes(o.severity as string) ? (o.severity as AiCheckFinding['severity']) : 'mid',
    title: o.title,
    detail: str(o.detail) ? o.detail : '',
    quote: o.quote,
    cite: cleanCite(o.cite),
    recordLine: str(o.recordLine) ? o.recordLine : null,
  };
}

/** 불러온 데이터의 aiChecks를 받아들인다. 모양이 틀린 항목·없는 업무의 항목은 버린다. 모두 버려지면 칸 자체를 없앤다 */
export function cleanAiChecks<T extends { aiChecks?: unknown; works?: { id: string }[] }>(s: T): T {
  const raw = s.aiChecks;
  if (raw === undefined) return s;
  const ids = new Set((s.works ?? []).map((w) => w.id));
  const out: Record<string, AiCheckRecord> = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [wid, v] of Object.entries(raw as Record<string, unknown>)) {
      if (!ids.has(wid) || !v || typeof v !== 'object') continue;
      const o = v as Record<string, unknown>;
      if (!str(o.at) || Number.isNaN(Date.parse(o.at)) || !str(o.byId) || !str(o.model) || typeof o.workVersion !== 'number' || !Array.isArray(o.findings)) continue;
      out[wid] = {
        at: o.at,
        byId: o.byId,
        engine: 'claude',
        model: o.model,
        workVersion: o.workVersion,
        ...(Array.isArray(o.docIds) && o.docIds.every(str) ? { docIds: [...(o.docIds as string[])].sort() } : {}),
        findings: o.findings.map(cleanFinding).filter((x): x is AiCheckFinding => !!x),
        dropped: typeof o.dropped === 'number' && o.dropped >= 0 ? Math.floor(o.dropped) : 0,
      };
    }
  }
  const next = { ...s } as Record<string, unknown>;
  if (Object.keys(out).length) next.aiChecks = out;
  else delete next.aiChecks;
  return next as T;
}
