// 문서 분석 실행: 키가 있고 Claude가 선택되어 있으면 Claude, 아니면(또는 실패하면) 규칙 기반 — 문서 등록·다시 분석이 함께 쓴다
import type { AppState, DocParagraph } from '../lib/types';
import type { LlmClient } from './llm';
import { claudeExtract, mockExtract, type Extraction } from './reflect';

export interface ExtractEngine {
  engine: 'claude' | 'mock';
  client: LlmClient | null | undefined;
  onError: (e: unknown) => string;
}

/** 취소(cancelled)면 규칙 결과로 대체하지 않는다 — 호출하는 쪽은 상태를 채우지 말고 「취소됨」으로 끝낸다 */
export type ExtractOutcome = { cancelled: false; result: Extraction; msg: string } | { cancelled: true; result: null; msg: string };
export const CANCELLED_MSG = '분석을 취소했습니다. 반영된 것은 없습니다.';

export async function runExtraction(
  ai: ExtractEngine,
  s: AppState,
  title: string,
  paras: DocParagraph[],
  def: string,
  writtenAt: string,
  signal: AbortSignal | undefined,
  opts: { review?: boolean; onStage?: (stage: 'read' | 'review') => void; docType?: string },
): Promise<ExtractOutcome> {
  if (ai.engine === 'claude' && ai.client) {
    try {
      const result = await claudeExtract(ai.client, s, title, paras, def, writtenAt, signal, opts);
      let msg = '';
      if (result.review && !result.review.ok) msg = '꼼꼼히 읽기(두 번째 대조)는 실패해 첫 분석 결과만 보여 줍니다.';
      else if (result.review) msg = `꼼꼼히 읽기: 빠진 항목 ${result.review.added}건을 더했고, 확인이 필요한 항목 ${result.review.flagged}건을 표시했습니다.`;
      if (result.truncatedInput) msg = '문서가 길어 앞부분(약 6만 자)만 Claude에 보냈습니다. 뒷부분 내용은 반영 제안에 포함되지 않았습니다.';
      if (signal?.aborted) return { cancelled: true, result: null, msg: CANCELLED_MSG }; // 응답이 취소와 겹쳐 도착해도 버린다
      return { cancelled: false, result, msg };
    } catch (e) {
      if (signal?.aborted || (e as { code?: string })?.code === 'cancelled') return { cancelled: true, result: null, msg: CANCELLED_MSG };
      console.warn('[AI 호출 오류]', (e as any)?.code, String((e as any)?.message ?? e).slice(0, 300));
      return { cancelled: false, result: mockExtract(s, title, paras, def), msg: `${ai.onError(e)} 이번 분석은 규칙 기반 결과입니다.` };
    }
  }
  return { cancelled: false, result: mockExtract(s, title, paras, def), msg: '' };
}
