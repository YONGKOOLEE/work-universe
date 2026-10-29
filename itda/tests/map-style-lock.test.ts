// 지도 시안 고정(가+나)과 밝기 연동(사용자 결정 2026-10-29): 자동 밝기에서 PC가 밝으면 흰 판, 어두우면 우주 판
import { describe, expect, it } from 'vitest';
import { DEFAULT_MAP_STYLE, MAP_STYLE_LOCKED, effectiveMapStyle, readMapStyle, scopeClass } from '../src/universe/mapStyle';

describe('지도 시안', () => {
  it('시안은 가+나(mix)로 고정되고 저장된 다른 값은 무시한다', () => {
    expect(MAP_STYLE_LOCKED).toBe('mix');
    expect(DEFAULT_MAP_STYLE).toBe('mix');
    const store: Record<string, string> = { 'itda-map-style': 'basic' };
    (globalThis as any).localStorage = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => (store[k] = v), removeItem: (k: string) => delete store[k] };
    expect(readMapStyle()).toBe('mix');
    delete (globalThis as any).localStorage;
  });
  it('밝으면 흰 판(clean), 어두우면 우주 판(mix)', () => {
    expect(effectiveMapStyle('mix', false)).toBe('clean');
    expect(effectiveMapStyle('mix', true)).toBe('mix');
    expect(scopeClass(effectiveMapStyle('mix', true))).toBe('map-space');
    expect(scopeClass(effectiveMapStyle('mix', false))).toBe('map-clean');
  });
  it('다른 시안은 밝기와 상관없이 그대로(점검 도구용 코드 보존)', () => {
    for (const st of ['basic', 'space', 'clean'] as const) expect(effectiveMapStyle(st, false)).toBe(st);
  });
});
