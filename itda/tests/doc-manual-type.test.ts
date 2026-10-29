// 문서 유형 「업무 매뉴얼」(사용자 결정 2026-10-29)
import { describe, expect, it } from 'vitest';
import { createSeed } from '../src/data/seed';
import { docEventFor, EXCLUDED_DOC_TYPES, guessDocType } from '../src/lib/docEvents';
import { DOC_TYPES } from '../src/lib/types';

describe('유형 목록', () => {
  it('결과보고서 다음, 기타 앞에 있다', () => {
    const i = DOC_TYPES.indexOf('업무 매뉴얼');
    expect(DOC_TYPES[i - 1]).toBe('결과보고서');
    expect(DOC_TYPES[i + 1]).toBe('기타');
  });
});

describe('타임라인 기본 제외', () => {
  it('업무 매뉴얼은 자동 이벤트를 만들지 않는다', () => {
    expect(EXCLUDED_DOC_TYPES).toContain('업무 매뉴얼');
    const d = { ...createSeed('linked', new Date('2026-10-29T00:00:00Z')).docs[0], type: '업무 매뉴얼' as const, timelineOff: false };
    expect(docEventFor(d)).toBeNull();
    expect(docEventFor({ ...d, type: '검토보고서' })).not.toBeNull();
  });
  it('시연 데이터 D-105는 업무 매뉴얼이고 E-105 이벤트는 그대로 있다', () => {
    const s = createSeed('linked', new Date('2026-10-29T00:00:00Z'));
    expect(s.docs.find((d) => d.id === 'D-105')!.type).toBe('업무 매뉴얼');
    expect(s.events.some((e) => e.id === 'E-105')).toBe(true);
  });
});

describe('제목으로 유형 짐작', () => {
  it.each(['오류 대응 매뉴얼 초안', '정산 업무 지침서', '출금 절차서(개정)', '신입 업무 가이드', '업무안내서 2026', '업무  안내서'])('%s → 업무 매뉴얼', (t) => {
    expect(guessDocType(t)).toBe('업무 매뉴얼');
  });
  it.each(['약관 개정 추진계획', '업무 협의 결과', '가이드라인 검토 보고', ''])('%s → 짐작 없음', (t) => {
    expect(guessDocType(t)).toBeNull();
  });
  it('회의록 단서가 먼저다', () => {
    expect(guessDocType('운영 매뉴얼 협의회', true)).toBe('회의록');
  });
});
