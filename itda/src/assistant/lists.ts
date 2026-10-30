// 목록 항목(선호 음식·취미 등 「A, B, C」 꼴) 공용 처리 — 대화 분석 승인(claude.ts)과 미팅 후 질문(followup.ts)이 같은 규칙을 쓴다.
// 조각은 쉼표·슬래시·가운뎃점으로 나눈다. 「이미 있는가」는 글 일부 포함이 아니라 조각 단위로 본다
// (「한식 위주, 파스타」에 「한식」을 더하면 조각 「한식」은 없으므로 더한다 / 「골프, 등산」에 「골프」는 이미 있다).

const SPLIT = /[,/·]/;
// 비교할 때는 공백을 모두 없앤다(「매운 음식」=「매운음식」). 저장하는 값은 원래 표기 그대로 둔다
const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();

/** 「A, B / C」 → ['A','B','C'] */
export const listParts = (s: string | undefined | null): string[] => String(s ?? '').split(SPLIT).map((x) => x.trim()).filter(Boolean);

/** value의 조각이 모두 existing에 이미 들어 있는가(existing이 비어 있으면 거짓) */
export function listHas(existing: string | undefined | null, value: string | undefined | null): boolean {
  const have = listParts(existing).map(norm);
  const want = listParts(value);
  if (!have.length || !want.length) return false;
  return want.every((w) => have.includes(norm(w)));
}

/**
 * 기존 값 뒤에 value를 이어 붙인 새 값. value의 조각 중 이미 있는 것은 빼고, 더할 것이 하나도 없으면 null(저장·반영안을 만들지 않는다).
 * 기존 값이 비어 있으면 value 그대로.
 */
export function appendToList(existing: string | undefined | null, value: string | undefined | null): string | null {
  const cur = String(existing ?? '').trim();
  const v = String(value ?? '').trim();
  if (!v) return null;
  if (!cur) return v;
  const have = listParts(cur).map(norm);
  const add = listParts(v).filter((w, i, arr) => !have.includes(norm(w)) && arr.findIndex((x) => norm(x) === norm(w)) === i);
  return add.length ? `${cur}, ${add.join(', ')}` : null;
}
