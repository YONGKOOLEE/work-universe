// 저장된 데이터 구조 변환 (schema 6 → 7)
// - Work: nextIds(선후행), topics(주제) 빈 배열 추가
// - AppState: mapHidden(지도에서 숨긴 항목) 빈 배열 추가, meetingAnalysisApplied 제거
// - User: empNo·role 은 선택 값이라 채우지 않음
// 사용자가 등록한 데이터는 그대로 보존한다. 3~5 버전은 지원하지 않는다.
import type { AppState } from './types';
import { cleanAiChecks } from './aiChecks';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

export function migrate(input: Any, now = new Date()): AppState {
  const s: Any = input;
  if (s.schema === 7) return cleanAiChecks(s as AppState); // aiChecks(선택 칸): 잘못된 모양은 버린다
  if (s.schema === 6) return cleanAiChecks(toV7(s, now));
  throw new Error(`지원하지 않는 데이터 버전입니다 (schema ${s.schema})`);
}

export function toV7(s: Any, now = new Date()): AppState {
  for (const w of s.works ?? []) {
    w.nextIds = Array.isArray(w.nextIds) ? w.nextIds : [];
    w.topics = Array.isArray(w.topics) ? w.topics : [];
  }
  for (const sn of s.snapshots ?? []) {
    if (sn.work) {
      sn.work.nextIds = Array.isArray(sn.work.nextIds) ? sn.work.nextIds : [];
      sn.work.topics = Array.isArray(sn.work.topics) ? sn.work.topics : [];
    }
  }
  s.mapHidden = Array.isArray(s.mapHidden) ? s.mapHidden : [];
  delete s.meetingAnalysisApplied;
  for (const d of s.docs ?? []) delete d.meetingKey;
  s.migratedAt = now.toISOString();
  s.schema = 7;
  return s as AppState;
}
