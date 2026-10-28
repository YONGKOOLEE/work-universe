// PDF에서 읽은 줄 → 문단(pdf.ts에서 분리, 브라우저 기능 없음 — vitest로 검증).
// 기본: 글머리표로 시작하거나 앞줄이 문장 끝이면 새 문단, 아니면 앞 문단에 이어 붙인다(PDF의 끊긴 줄 잇기).
// 표·절 제목은 잇지 않는다(CR-24, 업무 유니버스 「PDF 복사 글」 연구): 「□ 향후 조치」 같은 절 제목 줄, 「과제 담당 기한」 같은 표 머리 줄,
// 날짜로 끝나는 표 행(「개정 조문 대비표 작성 이서연 2026. 11. 12.」)은 각각 한 문단 — 붙이면 표의 할 일·담당·기한을 읽을 수 없다.
const BULLET = /^(□|■|▢|○|ㅇ|◦|●|•|-|※|▸|‣|\d{1,2}\.|\(\d{1,2}\)|[가-하]\.|[①-⑳])\s*/;
const END = /(다|음|함|임|됨|요|것)\.\s*$|[.。]\s*$/;
const HEADING = /^(□|■|▢)\s*/;
const TABLE_HEAD = /^(과제|구분|항목|업무|조치\s*사항|조치)\s+(담당|담당자|담당\s*부서|주관|책임)(\s|$)/;
const ROW_END_DATE = /\d{4}\.\s*\d{1,2}\.(\s*\d{1,2}\.?)?\s*(?:\([월화수목금토일]\))?\s*$|\d{4}\.\s*\d{1,2}월\s*(초|중|말|중순|하순)?\s*$/;
const isTableLine = (l: string) => TABLE_HEAD.test(l) || ROW_END_DATE.test(l);
// 「작성일: …」「일시: …」 같은 머리 정보 줄은 제목에 붙이지 않는다
const META = /^(작성일|작성\s*부서|일시|일자|장소|참석|회의명|보고자|작성자|담당\s*부서)\s*[:：]/;

export function toParagraphs(lines: string[]): string[] {
  const out: string[] = [];
  for (const raw of lines) {
    const l = raw.replace(/\s+/g, ' ').trim();
    if (!l) continue;
    const prev = out[out.length - 1];
    const fresh = prev === undefined || BULLET.test(l) || END.test(prev) || prev.length < 4 || HEADING.test(prev) || META.test(l) || isTableLine(l) || isTableLine(prev);
    if (fresh) out.push(l);
    // 줄바꿈은 대개 띄어쓰기 자리에서 일어나므로 한 칸 띄워 잇는다(인용 대조는 공백을 무시해 영향 없음)
    else out[out.length - 1] = `${prev} ${l}`;
  }
  return out;
}
