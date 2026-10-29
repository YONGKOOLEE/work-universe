// 업무 유니버스 화면 시안(2026-10-29 사용자 요청 「유니버스 UI를 고급스럽게」): basic(지금) · space(가 우주) · clean(나 정돈).
// 2026-10-29 사용자 결정 「시안 단추 숨기고 가+나로 고정」: 화면에는 시안 단추를 보이지 않고 값은 늘 mix다.
// 시안 코드(저장·읽기·단추 목록)는 지우지 않았다 — 다시 열려면 MAP_STYLE_LOCKED를 null로 바꾸고 UniversePage의 단추 줄을 보인다.
// 저장한 값(localStorage)은 잠금이 풀릴 때만 읽는다.
// mix(가+나): 사용자 결정 2026-10-29 「2번(가 우주 지도)과 6번(나 정돈 내 지도) 합치기, 메인 테마는 2번」 — 우주 바탕에 정돈의 유형 아이콘·이름 띠.
import { useSyncExternalStore } from 'react';
import { useIsDark } from '../lib/theme';

export type MapStyle = 'basic' | 'space' | 'clean' | 'mix';
export const DEFAULT_MAP_STYLE: MapStyle = 'mix';
export const MAP_STYLES: { id: MapStyle; label: string }[] = [
  { id: 'mix', label: '가+나' },
  { id: 'basic', label: '기본' },
  { id: 'space', label: '가 우주' },
  { id: 'clean', label: '나 정돈' },
];
/** 시안을 이 값으로 고정한다. null이면 저장된 값을 따른다 */
export const MAP_STYLE_LOCKED: MapStyle | null = 'mix';
const KEY = 'itda-map-style';
const EVENT = 'itda-map-style';

export function readMapStyle(): MapStyle {
  if (MAP_STYLE_LOCKED) return MAP_STYLE_LOCKED;
  try {
    const v = localStorage.getItem(KEY);
    return v === 'basic' || v === 'space' || v === 'clean' || v === 'mix' ? v : DEFAULT_MAP_STYLE;
  } catch {
    return DEFAULT_MAP_STYLE;
  }
}

export function writeMapStyle(v: MapStyle) {
  if (MAP_STYLE_LOCKED) return; // 고정 중에는 저장도 바꾸지도 않는다
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

/** 실제로 그릴 모양: 가+나는 지금 화면이 밝으면 흰 판(정돈 아이콘), 어두우면 우주 판. dark는 실제 적용된 밝기(자동이면 PC 설정) */
export const effectiveMapStyle = (s: MapStyle, dark: boolean): MapStyle => (s === 'mix' && !dark ? 'clean' : s);

/** 화면 밝기까지 반영한 지도 모양. 자동일 때 PC 설정이 바뀌면 따라 바뀐다 */
export function useEffectiveMapStyle(): MapStyle {
  const [s] = useMapStyle();
  return effectiveMapStyle(s, useIsDark());
}
