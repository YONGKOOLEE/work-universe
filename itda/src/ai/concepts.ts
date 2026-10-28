// 업무 개념 사전 — 표현이 달라도 같은 업무를 가리키는지 판별하기 위한 정규화 계층.
// 실제 LLM/임베딩 연계 시 이 모듈을 임베딩 유사도 API 호출로 교체한다.

export interface Concept {
  id: string;
  label: string;
  terms: string[];
  weight: number; // 업무 식별력 (높을수록 핵심)
  implies?: string[];
  excludes?: string[]; // 이 표현이 나오면 다른 개념으로 오인하지 않음
}

// 가상 업무에 맞춘 일반 예시 용어. 실제 업무 용어는 사용자가 쓰는 말에 맞게 바꿔 쓴다.
export const CONCEPTS: Concept[] = [
  { id: 'consent', label: '출금동의', terms: ['출금동의', '출금 동의', '자동이체 동의'], weight: 3 },
  { id: 'settle', label: '정산', terms: ['정산', '대사', '청산'], weight: 3 },
  { id: 'terms', label: '약관 개정', terms: ['약관', '시행세칙', '세칙'], weight: 2, implies: [] },
  { id: 'nonface', label: '비대면', terms: ['비대면', '온라인 가입', '모바일 가입'], weight: 2 },
  { id: 'authn', label: '본인확인', terms: ['본인확인', '본인 확인', '전자서명', 'ars'], weight: 2 },
  { id: 'agency', label: '참가기관', terms: ['참가기관', '이용기관', '협의회'], weight: 1.2 },
  { id: 'law', label: '법령 개정', terms: ['개정', '법률', '법령'], weight: 0.6 },
  { id: 'expand', label: '확대', terms: ['확대', '확산', '전면'], weight: 0.6 },
  { id: 'intro', label: '도입', terms: ['도입', '시행', '구축'], weight: 0.5 },
  { id: 'validity', label: '유효기간', terms: ['유효기간'], weight: 1.2 },
];
const BY_ID = Object.fromEntries(CONCEPTS.map((c) => [c.id, c]));

export function conceptsOf(text: string): Set<string> {
  const t = text.toLowerCase();
  const out = new Set<string>();
  for (const c of CONCEPTS) {
    let hit = false;
    for (const term of c.terms) {
      let idx = t.indexOf(term.toLowerCase());
      while (idx >= 0) {
        const excluded = (c.excludes ?? []).some((ex) => t.startsWith(ex.toLowerCase(), idx));
        if (!excluded) {
          hit = true;
          break;
        }
        idx = t.indexOf(term.toLowerCase(), idx + 1);
      }
      if (hit) break;
    }
    if (hit) {
      out.add(c.id);
      (c.implies ?? []).forEach((x) => out.add(x));
    }
  }
  return out;
}

export function conceptLabel(id: string) {
  return BY_ID[id]?.label ?? id;
}
export function conceptWeight(id: string) {
  return BY_ID[id]?.weight ?? 0.5;
}

function bigrams(s: string) {
  const t = s.replace(/\s+/g, '');
  const out = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}
export function dice(a: string, b: string) {
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  A.forEach((x) => B.has(x) && n++);
  return (2 * n) / (A.size + B.size);
}

/** 가중 개념 겹침(70%) + 문자열 유사도(30%) */
export function similarity(aText: string, bText: string, aName = aText, bName = bText) {
  const A = conceptsOf(aText);
  const B = conceptsOf(bText);
  let inter = 0;
  let uni = 0;
  const matched: string[] = [];
  new Set([...A, ...B]).forEach((id) => {
    const w = conceptWeight(id);
    uni += w;
    if (A.has(id) && B.has(id)) {
      inter += w;
      matched.push(id);
    }
  });
  const c = uni ? inter / uni : 0;
  const s = dice(aName, bName);
  return { score: Math.min(1, c * 0.7 + s * 0.3), matched, conceptScore: c, textScore: s, a: A, b: B };
}

export function coreConcepts(set: Set<string>) {
  return [...set].filter((id) => conceptWeight(id) >= 2);
}
