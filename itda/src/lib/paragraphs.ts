// PDF에서 읽은 줄 → 문단(pdf.ts에서 분리, 브라우저 기능 없음 — vitest로 검증).
// 기본: 글머리표로 시작하거나 앞줄이 문장 끝이면 새 문단, 아니면 앞 문단에 이어 붙인다(PDF의 끊긴 줄 잇기).
// 표·절 제목은 잇지 않는다(CR-24, 업무 유니버스 「PDF 복사 글」 연구):
//   「□ 향후 조치」 같은 절 제목 줄 뒤에는 잇지 않고,
//   「과제 담당 기한」 같은 표 머리 줄(머리 낱말 셋 이상, 문장 끝 아님)을 만나면 그 뒤는 「표 구간」 — 행마다 한 문단(날짜가 없는 행도).
//   표 구간은 글머리표·절 제목·문장으로 끝나는 줄이 나오면 끝난다. 표 구간 밖의 날짜로 끝나는 줄은 일반 문장으로 본다(검토 2026-10-29).
const BULLET = /^(□|■|▢|○|ㅇ|◦|●|•|-|※|▸|‣|\d{1,2}\.|\(\d{1,2}\)|[가-하]\.|[①-⑳])\s*/;
const END = /(다|음|함|임|됨|요|것)\.\s*$|[.。]\s*$/;
const HEADING = /^(□|■|▢)\s*/;
// 표를 끝내는 문장 끝: 한국어 종결 + 마침표(표의 날짜 칸 「2026. 11. 12.」의 마침표는 문장 끝이 아님)
const SENT_END = /(다|음|함|임|됨|요|것)\.\s*$/;
const HEAD_WORDS = ['과제', '구분', '항목', '업무', '조치', '조치사항', '내용', '담당', '담당자', '담당부서', '주관', '책임', '기한', '일정', '완료일', '마감', '비고', '상태'];
// 「작성일: …」「일시: …」 같은 머리 정보 줄은 제목에 붙이지 않는다
const META = /^(작성일|작성\s*부서|일시|일자|장소|참석|회의명|보고자|작성자|담당\s*부서)\s*[:：]/;

/** 표 머리 줄: 낱말이 모두 머리 낱말이고 셋 이상(「과제 담당 기한」), 담당류 낱말이 하나는 있음 */
export function isTableHead(l: string): boolean {
  if (END.test(l)) return false;
  const words = l.split(/\s+/).filter(Boolean);
  return words.length >= 3 && words.every((w) => HEAD_WORDS.includes(w)) && words.some((w) => /^(담당|담당자|담당부서|주관|책임)$/.test(w));
}

export function toParagraphs(lines: string[]): string[] {
  const out: string[] = [];
  let inTable = false;
  for (const raw of lines) {
    const l = raw.replace(/\s+/g, ' ').trim();
    if (!l) continue;
    const prev = out[out.length - 1];
    if (isTableHead(l)) {
      inTable = true;
      out.push(l);
      continue;
    }
    if (inTable && (BULLET.test(l) || HEADING.test(l) || SENT_END.test(l) || META.test(l))) inTable = false;
    if (inTable) {
      out.push(l); // 표의 한 행
      continue;
    }
    const fresh = prev === undefined || BULLET.test(l) || END.test(prev) || prev.length < 4 || HEADING.test(prev) || META.test(l);
    // 줄바꿈은 대개 띄어쓰기 자리에서 일어나므로 한 칸 띄워 잇는다(인용 대조는 공백을 무시해 영향 없음)
    if (fresh) out.push(l);
    else out[out.length - 1] = `${prev} ${l}`;
  }
  return out;
}

/**
 * 문서 작성일 읽기(처음 사용 점검 1 M-1·L-7): 머리 6줄 안에서 「일시/작성일: 2026. 10. 28.」 또는 줄 맨 앞(글머리표 허용)에서 시작하는 날짜.
 * 본문 중간의 날짜(사건·기한)는 작성일이 아니므로 읽지 않는다. 못 찾으면 null
 */
const DOC_DATE_LINE = /^[○□■▢◦●•\-※\s]*(?:(?:일\s*시|일\s*자|작성\s*일(?:\s*자)?|회\s*의\s*일(?:\s*시)?|개\s*최\s*일(?:\s*시)?|날\s*짜)\s*[:：]\s*)?(\d{4})\s*[.년-]\s*(\d{1,2})\s*[.월-]\s*(\d{1,2})\s*[.일]?(?=\s*(?:\(.\))?\s*(?:\d{1,2}:\d{2}.*)?$)/;
export function readDocDate(lines: string[]): { iso: string; raw: string } | null {
  const head = lines.map((l) => l.trim()).filter(Boolean).slice(0, 6);
  for (const l of head) {
    const m = DOC_DATE_LINE.exec(l);
    if (!m) continue;
    const [y, mo, d] = [+m[1], +m[2], +m[3]];
    if (y < 1990 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) continue;
    return { iso: `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`, raw: m[0].replace(/^[○□■▢◦●•\-※\s]*/, '').replace(/^[^\d]*:\s*/, '').trim() };
  }
  return null;
}
