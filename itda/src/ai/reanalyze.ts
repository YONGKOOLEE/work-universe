// ─────────────────────────────────────────────────────────────
// 등록된 문서 다시 분석 — 이미 기록된 항목은 건너뛰고 새 항목만 더한다 (순수 함수, 화면 의존 없음)
// ─────────────────────────────────────────────────────────────
import type { AppState, Doc } from '../lib/types';
import { applyProposals, type Proposal, type ProposalKind } from './reflect';
import { uid } from '../lib/util';

/** 같은 글인지 비교하는 정규화: 공백·가운뎃점 모양·따옴표·끝 마침표 무시, 소문자 */
export const normText = (t: string) =>
  String(t ?? '')
    .replace(/[\s ]+/g, '')
    .replace(/[ㆍ·•∙]/g, '·')
    .replace(/[“”"‘’']/g, '')
    .replace(/[.,;:!?。]+$/, '')
    .toLowerCase();

/** 제안 하나가 applyProposals로 기록될 때의 비교 키 (종류·업무·정규화한 글, 이벤트는 날짜 포함, 개요는 칸 포함) */
export function proposalKey(p: Pick<Proposal, 'kind' | 'workId' | 'text' | 'date' | 'field'>): string {
  const base = `${p.kind}|${p.workId}|`;
  if (p.kind === 'event') return `${base}${normText(p.text)}|${p.date ?? ''}`;
  if (p.kind === 'overview') return `${base}${p.field ?? ''}|${normText(p.text)}`;
  return `${base}${normText(p.text)}`;
}

/** 지금 업무에 이미 기록된 항목들의 키 */
export function recordedKeys(s: AppState): Set<string> {
  const keys = new Set<string>();
  for (const d of s.decisions) keys.add(proposalKey({ kind: 'decision', workId: d.workId, text: d.title, date: null }));
  for (const a of s.actions) keys.add(proposalKey({ kind: 'action', workId: a.workId, text: a.title, date: null }));
  for (const e of s.events) for (const w of e.workIds) keys.add(proposalKey({ kind: 'event', workId: w, text: e.title, date: e.date }));
  for (const w of s.works) {
    for (const f of ['purpose', 'background', 'current', 'cautions'] as const) for (const x of w[f]) keys.add(proposalKey({ kind: 'overview', workId: w.id, text: x.text, date: null, field: f }));
    for (const t of w.topics ?? []) keys.add(proposalKey({ kind: 'topic', workId: w.id, text: t, date: null }));
  }
  return keys;
}

/** 이미 기록된 것(또는 같은 묶음 안에서 앞서 나온 것)과 같은 제안을 걸러 낸다 */
export function splitDuplicates(s: AppState, props: Proposal[]): { fresh: Proposal[]; skipped: Proposal[] } {
  const seen = recordedKeys(s);
  const fresh: Proposal[] = [];
  const skipped: Proposal[] = [];
  for (const p of props) {
    const k = proposalKey(p);
    if (seen.has(k)) skipped.push(p);
    else {
      seen.add(k);
      fresh.push(p);
    }
  }
  return { fresh, skipped };
}

const KIND_LABEL: Record<ProposalKind, string> = { decision: '결정', event: '타임라인', action: '조치', overview: '개요', topic: '주제' };
export const engineLabel = (e: 'claude' | 'mock') => (e === 'claude' ? 'AI' : '규칙 기반');

export interface ReanalysisResult {
  added: number;
  skipped: number;
  perWork: Record<string, { added: Partial<Record<ProposalKind, number>>; skipped: number }>;
}

/**
 * 승인된 제안 중 새 것만 반영하고, 문서의 분석 엔진·시각을 갱신하며, 업무마다 이력 한 줄을 남긴다.
 * 이미 Claude로 분석된 문서를 규칙으로 다시 돌렸을 때는 요약·분석 엔진 표시를 낮추지 않는다.
 */
export function applyReanalysis(
  d: AppState,
  doc: Doc,
  props: Proposal[],
  actorId: string,
  ext: { engine: 'claude' | 'mock'; summary: string[]; keywords: string[] },
): ReanalysisResult {
  const now = new Date().toISOString();
  const approved = props.filter((p) => p.approved);
  const { fresh, skipped } = splitDuplicates(d, approved);
  const before = d.history.length;
  applyProposals(d, doc, fresh, actorId);
  d.history.splice(before); // applyProposals의 일반 이력은 아래 「문서 다시 분석」 한 줄로 대신한다

  const perWork: ReanalysisResult['perWork'] = {};
  for (const p of approved) perWork[p.workId] ??= { added: {}, skipped: 0 };
  for (const p of fresh) perWork[p.workId].added[p.kind] = (perWork[p.workId].added[p.kind] ?? 0) + 1;
  for (const p of skipped) perWork[p.workId].skipped += 1;

  const downgrade = doc.analyzedBy === 'claude' && ext.engine !== 'claude';
  if (!downgrade) {
    doc.analyzedBy = ext.engine;
    if (ext.summary.length) doc.summary = ext.summary;
    if (ext.keywords.length) doc.keywords = ext.keywords;
  }
  doc.analyzedAt = now;
  doc.analyzed = true;

  for (const [wid, r] of Object.entries(perWork)) {
    const parts = (Object.keys(KIND_LABEL) as ProposalKind[]).filter((k) => r.added[k]).map((k) => `${KIND_LABEL[k]} ${r.added[k]}`);
    const text = `${parts.length ? `${parts.join(' · ')} 추가` : '추가한 항목 없음'}${r.skipped ? `, 이미 있는 ${r.skipped}건 건너뜀` : ''}`;
    d.history.push({ id: uid('H'), workId: wid, at: now, actorId, kind: '문서 다시 분석', summary: `'${doc.title}' 문서 다시 분석(${engineLabel(ext.engine)}): ${text}` });
  }
  return { added: fresh.length, skipped: skipped.length, perWork };
}
