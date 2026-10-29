// 업무 유니버스 화면 시안(2026-10-29 사용자 요청 「유니버스 UI를 고급스럽게」): basic(지금) · space(가 우주) · clean(나 정돈).
// 이 브라우저에만 저장한다(localStorage). 막히거나 비어 있으면 기본값 mix.
// mix(가+나): 사용자 결정 2026-10-29 「2번(가 우주 지도)과 6번(나 정돈 내 지도) 합치기, 메인 테마는 2번」 — 우주 바탕에 정돈의 유형 아이콘·이름 띠.
import { useSyncExternalStore } from 'react';

export type MapStyle = 'basic' | 'space' | 'clean' | 'mix';
export const DEFAULT_MAP_STYLE: MapStyle = 'mix';
export const MAP_STYLES: { id: MapStyle; label: string }[] = [
  { id: 'mix', label: '가+나' },
  { id: 'basic', label: '기본' },
  { id: 'space', label: '가 우주' },
  { id: 'clean', label: '나 정돈' },
];
const KEY = 'itda-map-style';
const EVENT = 'itda-map-style';

export function readMapStyle(): MapStyle {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'basic' || v === 'space' || v === 'clean' || v === 'mix' ? v : DEFAULT_MAP_STYLE;
  } catch {
    return DEFAULT_MAP_STYLE;
  }
}

export function writeMapStyle(v: MapStyle) {
  try {
    if (v === DEFAULT_MAP_STYLE) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, v);
  } catch {
    /* 저장이 막혀도 이번 화면에서는 바뀐다 */
  }
  current = v;
  window.dispatchEvent(new Event(EVENT));
}

let current: MapStyle | null = null;
const snapshot = () => (current ??= readMapStyle());
const subscribe = (fn: () => void) => {
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
};

export function useMapStyle(): [MapStyle, (v: MapStyle) => void] {
  return [useSyncExternalStore(subscribe, snapshot, () => DEFAULT_MAP_STYLE), writeMapStyle];
}

/** 지도 공간을 감싸는 클래스(색 토큰을 시안에 맞게 다시 정함 — index.css) */
export const scopeClass = (s: MapStyle) => (s === 'space' || s === 'mix' ? 'map-space' : s === 'clean' ? 'map-clean' : '');
