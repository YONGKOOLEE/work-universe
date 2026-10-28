// PDF 본문 추출 (pdf.js) — 서버 없이 브라우저에서 동작.
// 워커 코드는 번들에 포함해 blob URL로 띄운다 (단일 파일 배포·아티팩트 환경 대응).
import type { DocParagraph } from './types';

let ready: Promise<typeof import('pdfjs-dist')> | null = null;

async function lib() {
  if (!ready) {
    ready = (async () => {
      const pdfjs = await import('pdfjs-dist');
      const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?raw')).default;
      const url = URL.createObjectURL(new Blob([worker], { type: 'text/javascript' }));
      pdfjs.GlobalWorkerOptions.workerSrc = url;
      return pdfjs;
    })();
  }
  return ready;
}

export interface PdfResult {
  pages: number;
  paragraphs: DocParagraph[];
  text: string;
  chars: number;
  likelyScanned: boolean;
}

const BULLET = /^(□|■|▢|○|ㅇ|◦|●|•|-|※|▸|‣|\d{1,2}\.|\(\d{1,2}\)|[가-하]\.|[①-⑳])\s*/;
const END = /(다|음|함|임|됨|요|것)\.\s*$|[.。]\s*$/;

/** 줄 단위 텍스트를 문단으로 묶는다: 글머리표로 시작하거나 앞줄이 문장 끝이면 새 문단 */
function toParagraphs(lines: string[]): string[] {
  const out: string[] = [];
  for (const raw of lines) {
    const l = raw.replace(/\s+/g, ' ').trim();
    if (!l) continue;
    const prev = out[out.length - 1];
    if (prev === undefined || BULLET.test(l) || END.test(prev) || prev.length < 4) out.push(l);
    else out[out.length - 1] = prev + (/[가-힣]$/.test(prev) && /^[가-힣]/.test(l) ? '' : ' ') + l;
  }
  return out;
}

export async function extractPdf(buf: ArrayBuffer): Promise<PdfResult> {
  const pdfjs = await lib();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false }).promise;
  const paragraphs: DocParagraph[] = [];
  let chars = 0;
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const lines: string[] = [];
    let cur = '';
    let lastY: number | null = null;
    for (const it of tc.items as { str?: string; hasEOL?: boolean; transform?: number[] }[]) {
      if (typeof it.str !== 'string') continue;
      const y = it.transform ? Math.round(it.transform[5]) : null;
      if (lastY !== null && y !== null && Math.abs(y - lastY) > 2 && cur) {
        lines.push(cur);
        cur = '';
      }
      cur += it.str;
      if (y !== null) lastY = y;
      if (it.hasEOL) {
        lines.push(cur);
        cur = '';
      }
    }
    if (cur) lines.push(cur);
    const paras = toParagraphs(lines).filter((x) => !/^-\s*\d+\s*-$/.test(x)); // 쪽번호 제거
    paras.forEach((t, i) => {
      chars += t.length;
      paragraphs.push({ id: `p${p}-${i + 1}`, text: t, page: p });
    });
    page.cleanup();
  }
  await doc.destroy();
  return {
    pages: doc.numPages,
    paragraphs,
    text: paragraphs.map((x) => x.text).join('\n'),
    chars,
    likelyScanned: chars < doc.numPages * 40,
  };
}
