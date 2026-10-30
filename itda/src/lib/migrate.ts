// 저장된 데이터 구조 변환 (schema 6 → 7)
// - Work: nextIds(선후행), topics(주제) 빈 배열 추가
// - AppState: mapHidden(지도에서 숨긴 항목) 빈 배열 추가, meetingAnalysisApplied 제거
// - User: empNo·role 은 선택 값이라 채우지 않음
// 사용자가 등록한 데이터는 그대로 보존한다. 3~5 버전은 지원하지 않는다.
import type { AppState } from './types';
import { cleanAiChecks } from './aiChecks';
import { cleanAssistant } from '../assistant/clean';
import { createAssistantSeed } from '../assistant/seed';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

/**
 * AI 비서(assistant, 선택 칸): 없으면(옛 데이터·백업) 처음 여는 것이므로 가상 고객 18명을 채운다(담당 영업자 = 지금 사용자, 기준일 = 오늘).
 * 있으면 깨진 항목만 걸러 낸다. 사용자가 지워서 빈 객체가 된 것은 다시 채우지 않는다.
 */
function withAssistant(s: AppState, now: Date, seed: boolean): AppState {
  if (s.assistant === undefined) {
    // 백업 파일을 불러올 때(seed=false)는 칸이 없으면 없는 채로 둔다 — 지금 고객을 가상 고객으로 바꾸거나 지운 가상 고객을 되살리지 않기 위해
    if (seed) s.assistant = createAssistantSeed(now, s.currentUserId);
  } else s.assistant = cleanAssistant(s.assistant, s.currentUserId);
  return s;
}

export interface MigrateOptions {
  /** AI 비서 칸이 없을 때 가상 고객 18명을 채울지(기본 예 = 처음 여는 경우). 백업 파일 불러오기는 아니오 */
  seedAssistant?: boolean;
}

export function migrate(input: Any, now = new Date(), opts: MigrateOptions = {}): AppState {
  const s: Any = input;
  const seed = opts.seedAssistant !== false;
  if (s.schema === 7) return withAssistant(cleanAiChecks(s as AppState), now, seed); // aiChecks(선택 칸): 잘못된 모양은 버린다
  if (s.schema === 6) return withAssistant(cleanAiChecks(toV7(s, now)), now, seed);
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
