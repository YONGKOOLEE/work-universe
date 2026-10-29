// AI 호출 수명 처리의 순수 로직: 캐시 키(M-2), 키 상태·오류 분류(L-1), 요청 번호(M-7·L-6), 다듬기 fallback 판별(L-2)
import { describe, expect, it } from 'vitest';
import { classify, createSeq, errorText, insightCacheKey, isAuthFallbackReason, isModelFallbackReason, keyStatusOf, refinedUsedCount, LlmError } from '../src/ai/llm';

describe('M-2 캐시 키에 사용자', () => {
  it('사용자·범위·모델이 다르면 키가 다르다', () => {
    const sc = { kind: 'all' };
    const a = insightCacheKey(sc, 'm1', 'U-1');
    expect(insightCacheKey(sc, 'm1', 'U-2')).not.toBe(a);
    expect(insightCacheKey({ kind: 'mine', userId: 'U-1' }, 'm1', 'U-1')).not.toBe(a);
    expect(insightCacheKey(sc, 'm2', 'U-1')).not.toBe(a);
    expect(insightCacheKey(sc, 'm1', 'U-1')).toBe(a);
  });
});

describe('L-1 키 상태와 오류 분류', () => {
  it('키 없음 / 있음 / 거부', () => {
    expect(keyStatusOf('', false)).toBe('none');
    expect(keyStatusOf('', true)).toBe('none');
    expect(keyStatusOf('k', false)).toBe('available');
    expect(keyStatusOf('k', true)).toBe('denied');
  });
  it('401은 키 거부(auth), 403·404는 모델 문제(model)', () => {
    expect(classify({ status: 401 }).code).toBe('auth');
    expect(classify({ status: 403 }).code).toBe('model');
    expect(classify({ status: 404 }).code).toBe('model');
    expect(classify({ status: 429 }).code).toBe('rate');
    expect(errorText(new LlmError('model', 'x'))).toContain('모델');
    expect(errorText(new LlmError('model', 'x'))).not.toContain('거부되었습니다.');
  });
});

describe('요청 번호', () => {
  it('마지막 요청만 최신이고 cancelAll 뒤에는 모두 낡은 것', () => {
    const q = createSeq();
    const a = q.next();
    const b = q.next();
    expect(q.isLatest(a)).toBe(false);
    expect(q.isLatest(b)).toBe(true);
    q.cancelAll();
    expect(q.isLatest(b)).toBe(false);
  });
});

describe('L-2 다듬기 fallback 판별', () => {
  it('인증 실패 이유와 모델 문제 이유를 가른다', () => {
    expect(isAuthFallbackReason('연결 오류: 키가 맞지 않음')).toBe(true);
    expect(isAuthFallbackReason('연결 오류: 요청 한도 초과')).toBe(false);
    expect(isAuthFallbackReason(null)).toBe(false);
    expect(isModelFallbackReason('연결 오류: 키에 이 모델을 쓸 권한이 없음')).toBe(true);
    expect(isModelFallbackReason('연결 오류: 모델 이름을 찾을 수 없음(설정의 모델 칸 확인)')).toBe(true);
    expect(isAuthFallbackReason('연결 오류: 키에 이 모델을 쓸 권한이 없음')).toBe(false);
  });
  it('Claude 문장이 쓰인 항목 수', () => {
    expect(refinedUsedCount(null)).toBe(0);
    expect(refinedUsedCount({ items: [{ method: 'rule' }, { method: 'llm' }] })).toBe(1);
  });
});

describe('M-5 문서 분석 취소', async () => {
  const { runExtraction, CANCELLED_MSG } = await import('../src/ai/runExtract');
  const { createSeed } = await import('../src/data/seed');
  const s = createSeed('linked', new Date('2026-10-29T09:00:00Z'));
  const paras = [{ id: 'p-1', text: '개정안은 전자서명 방식을 반영하기로 결정함.' }];
  const mkAi = (client: any) => ({ engine: 'claude' as const, client, onError: (e: unknown) => errorText(e) });

  it('취소되면 규칙 결과로 대체하지 않고 취소로 끝난다', async () => {
    const ac = new AbortController();
    const client = {
      model: 'm',
      json: async () => {
        ac.abort();
        throw new LlmError('cancelled', '취소');
      },
    };
    const r = await runExtraction(mkAi(client), s, 't', paras, 'W-003', '2026-10-01', ac.signal, {});
    expect(r.cancelled).toBe(true);
    expect(r.result).toBeNull();
    expect(r.msg).toBe(CANCELLED_MSG);
  });
  it('다른 오류는 지금처럼 규칙 결과로 대체한다', async () => {
    const client = { model: 'm', json: async () => { throw new LlmError('timeout', 'x'); } };
    const r = await runExtraction(mkAi(client), s, 't', paras, 'W-003', '2026-10-01', undefined, {});
    expect(r.cancelled).toBe(false);
    expect(r.result?.engine).toBe('mock');
    expect(r.msg).toContain('규칙 기반');
  });
  it('엔진이 규칙이면 그대로 규칙 결과', async () => {
    const r = await runExtraction({ engine: 'mock', client: null, onError: () => '' }, s, 't', paras, 'W-003', '2026-10-01', undefined, {});
    expect(r.cancelled).toBe(false);
  });
});
