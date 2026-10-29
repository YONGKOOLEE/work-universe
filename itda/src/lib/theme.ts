// 화면 밝기(사용자 요청 2026-10-29 「두 가지 버전으로 on/off」): auto(PC 설정 따름, 기본) · light · dark.
// 이 브라우저에만 저장한다(localStorage). <html data-theme>로 index.css 색 토큰을 고른다.
// 유니버스 가+나 시안: auto는 어두운 우주 판, light는 흰 판(정돈 아이콘), dark는 우주 판(mapStyle.ts effectiveMapStyle).
import { useSyncExternalStore } from 'react';

export type ThemePref = 'auto' | 'light' | 'dark';
export const THEME_LABELS: Record<ThemePref, string> = { auto: '화면 자동', light: '밝게', dark: '어둡게' };
export const THEME_NEXT: Record<ThemePref, ThemePref> = { auto: 'light', light: 'dark', dark: 'auto' };
const KEY = 'itda-theme';
const EVENT = 'itda-theme';

export function readTheme(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

export function applyTheme(v: ThemePref) {
  if (typeof document === 'undefined') return;
  if (v === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = v;
}

export function writeTheme(v: ThemePref) {
  try {
    if (v === 'auto') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, v);
  } catch {
    /* 저장이 막혀도 이번 화면에서는 바뀐다 */
  }
  current = v;
  applyTheme(v);
  window.dispatchEvent(new Event(EVENT));
}

let current: ThemePref | null = null;
const snapshot = () => (current ??= readTheme());
const subscribe = (fn: () => void) => {
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
};

export function useTheme(): [ThemePref, (v: ThemePref) => void] {
  return [useSyncExternalStore(subscribe, snapshot, () => 'auto' as ThemePref), writeTheme];
}

/** 지금 어두운 화면인가(선택 우선, auto면 PC 설정) */
export const isDarkNow = () =>
  typeof window !== 'undefined' && (document.documentElement.dataset.theme === 'dark' || (document.documentElement.dataset.theme !== 'light' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches));
