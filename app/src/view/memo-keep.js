// 쓰던 메모 지키기(R11 FU6-3): 메모 양식(이번 주 기록·카드의 기록 남기기)에 쓰던 글·분류가 공간 전환·카드 닫기로 사라지지 않게
// 같은 탭의 메모리에만 업무별로 보관한다. 저장소(localStorage 등)에는 쓰지 않는다 — 탭을 닫으면 사라진다. 화면(DOM)·저장소를 쓰지 않는다.

/** 보관할 수 있는 글 길이(메모 양식의 maxlength와 같게) */
export const MEMO_KEEP_NOTE_MAX = 2000;

/** 보관 열쇠: 양식 종류(weekly|card) + 지도 + 업무. 업무를 아직 안 골랐으면 업무 칸은 빈 글 */
export const memoKeepKey = (kind, universeId, workId) => `${kind}:${universeId || ''}:${workId || ''}`;

const isEmpty = (d) => !d || (!String(d.note || '').trim() && !d.category);

/** 메모리 보관함 하나. 앱이 시작할 때 한 번 만든다 */
export function createMemoKeep() {
  const m = new Map();
  return {
    /** @returns {{category:string, note:string}|null} */
    get(key) {
      const d = m.get(key);
      return d ? { category: d.category, note: d.note } : null;
    },
    /** 글도 분류도 비면 지운다(빈 보관이 남아 「쓰던 글이 있다」로 보이지 않게) */
    set(key, d) {
      if (isEmpty(d)) { m.delete(key); return; }
      m.set(key, { category: String((d && d.category) || ''), note: String((d && d.note) || '').slice(0, MEMO_KEEP_NOTE_MAX) });
    },
    clear(key) { m.delete(key); },
    get size() { return m.size; },
  };
}
