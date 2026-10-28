// 문서 → 타임라인 자동 등록
// 회의록·기타를 제외한 모든 문서는 등록 시 연결 업무의 타임라인에 '문서' 이벤트로 올라간다.
// 타임라인에서 삭제하면 doc.timelineOff = true 로 표시해 다시 만들지 않는다.
import type { AppState, Doc, TEvent } from './types';
import { localDay } from './util';

export const EXCLUDED_DOC_TYPES = ['회의록', '기타'];

export function docEventFor(doc: Doc): TEvent | null {
  if (EXCLUDED_DOC_TYPES.includes(doc.type) || doc.timelineOff || !doc.workIds.length) return null;
  const hasDate = !!doc.writtenAt;
  return {
    id: `E-DOC-${doc.id}`,
    workIds: [...doc.workIds],
    date: hasDate ? doc.writtenAt : localDay(doc.registeredAt),
    type: '문서',
    title: doc.title,
    summary: doc.summary[0] ?? `${doc.type} 등록`,
    decisions: [],
    agency: doc.source || '사용자 등록',
    docIds: [doc.id],
    cite: [{ docId: doc.id, label: doc.title }],
    source: hasDate ? 'original' : 'unverified',
    meaning: hasDate
      ? `${doc.type} 문서 등록으로 자동 추가된 이벤트. 필요 없으면 타임라인에서 삭제할 수 있음`
      : '작성일이 입력되지 않아 등록일 기준으로 배치함 — 실제 작성일 별도 확인 필요',
    causes: [],
    phase: '문서 등록 반영',
    autoDocId: doc.id,
  };
}

/** 아직 자동 이벤트가 없는 대상 문서에 이벤트를 만든다 (중복 생성 없음) */
export function ensureDocEvents(s: AppState) {
  for (const d of s.docs) {
    if (s.events.some((e) => e.autoDocId === d.id)) continue;
    const e = docEventFor(d);
    if (e) s.events.push(e);
  }
}
