// 시연용 문서 PDF 만들기(CR-24 D24-12): 업무잇다 시연 문서 2건(실제 기관명을 가상 기관명으로)과 지도 시연용 1건.
// 사용: node tools/make-demo-pdfs.mjs [출력 폴더(기본 demo-docs/out)] [포트]
// 헤드리스 Chrome의 Page.printToPDF로 A4 한 쪽. 맨 아래 빨간 글씨 「※ 시연용 가상 자료」
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launch, sleep } from './cdp.mjs';

const OUT = process.argv[2] || 'demo-docs/out';
const PORT = Number(process.argv[3] || 9861);

export const DOCS = [
  {
    file: '비대면 출금동의 추진 현황 보고(시연용).pdf',
    title: '비대면 출금동의 추진 현황 보고',
    lines: [
      '작성일: 2026. 9. 15.(화) · 디지털신원팀',
      '□ 보고 목적',
      '○ 비대면 출금동의 방식 확대 추진 현황을 공유하고 향후 일정을 정하기 위함.',
      '□ 추진 배경',
      '○ 비대면 가입 증가에 따라 영업점 방문 없이 출금동의를 받을 수 있는 방식이 필요함.',
      '□ 추진 경과',
      '○ 2026. 7. 1. 비대면 출금동의 방식 검토에 착수함.',
      '○ 2026. 8. 20. 내부 검토회의에서 전자서명과 ARS 녹취 방식을 우선 검토 대상으로 결정함.',
      '○ 2026. 9. 10. 참가기관 대상 사전 설명회를 개최함.',
      '□ 현재 상황',
      '○ 현재 참가기관 의견 수렴이 진행 중임.',
      '□ 향후 계획',
      '○ 2026. 10. 20. 참가기관 업무협의회에서 개선방안을 설명할 예정임.',
      '○ 2026. 12. 31.까지 약관 및 시행세칙 개정안을 마련할 계획임.',
      '□ 유의사항',
      '○ 다만, 방식별 본인확인 수준은 법무 검토 결과에 따름.',
    ],
  },
  {
    file: '참가기관 업무협의회 회의록(시연용).pdf',
    title: '비대면 출금동의 참가기관 업무협의회 회의록',
    lines: [
      '□ 회의 개요',
      '○ 일시: 2026. 10. 20.(화) 14:00~15:30',
      '○ 참석: 한빛결제원(가상) 및 참가기관 실무 담당자',
      '□ 논의 결과',
      '○ 비대면 출금동의 방식으로 전자서명과 ARS 녹취를 우선 도입하기로 합의함.',
      '○ 시행 목표 시기를 2027년 상반기로 결정함.',
      '□ 향후 조치',
      '○ 참가기관은 2026. 11. 30.까지 전산 영향도 검토 결과를 제출할 예정임.',
    ],
  },
  {
    file: '약관 개정 실무 회의록(시연용).pdf',
    title: '약관·시행세칙 개정 실무 회의록',
    lines: [
      '□ 회의 개요',
      '○ 일시: 2026. 10. 28.(수) 10:00~11:00',
      '○ 참석: 디지털신원팀 박지훈, 이서연, 최민서',
      '□ 논의 결과',
      '○ 개정안은 전자서명과 ARS 녹취 방식을 함께 반영하기로 결정함.',
      '○ 본인확인 수준은 법무 검토 의견을 받은 뒤 확정하기로 함.',
      '□ 향후 조치',
      '[[표]]',
      '□ 유의사항',
      '○ 다만, 참가기관 의견 반영안은 업무협의회 결과와 맞춰야 함.',
    ],
    table: {
      head: ['과제', '담당', '기한'],
      rows: [
        ['개정 조문 대비표 작성', '이서연', '2026. 11. 12.'],
        ['참가기관 의견 반영안 정리', '최민서', '2026. 11. 19.'],
        ['법무 검토 의견 요청', '박지훈', '2026. 11. 5.'],
      ],
    },
  },
];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
function html(d) {
  const body = d.lines
    .map((l) => {
      if (l === '[[표]]') return `<table><tr>${d.table.head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>${d.table.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table>`;
      const cls = l.startsWith('□') ? 'h' : l.startsWith('○') ? 'i' : 'm';
      return `<p class="${cls}">${esc(l)}</p>`;
    })
    .join('\n');
  return `<!doctype html><meta charset="utf-8"><style>
  @page { size: A4; margin: 22mm 20mm; }
  body { font-family: "Malgun Gothic", sans-serif; font-size: 11.5pt; line-height: 1.7; color: #111; }
  h1 { text-align: center; font-size: 17pt; margin: 0 0 6mm; }
  p { margin: 0; } p.h { font-weight: bold; margin-top: 4mm; } p.i { padding-left: 4mm; } p.m { text-align: right; color: #333; margin-bottom: 2mm; }
  table { border-collapse: collapse; margin: 2mm 0 0 4mm; } th, td { border: 1px solid #555; padding: 1.5mm 4mm; font-size: 10.5pt; } th { background: #eee; }
  .demo { position: fixed; bottom: 0; left: 0; right: 0; text-align: center; color: #c00; font-weight: bold; }
  </style><h1>${esc(d.title)}</h1>${body}<div class="demo">※ 시연용 가상 자료</div>`;
}

await mkdir(OUT, { recursive: true });
const b = await launch({ port: PORT, profile: `C:/AI/work-universe/.tmp/itda-pdf-${PORT}` });
try {
  for (const d of DOCS) {
    const src = join(OUT, d.file.replace(/\.pdf$/, '.html'));
    await writeFile(src, html(d));
    await b.cdp.send('Page.navigate', { url: pathToFileURL(src).href });
    await sleep(800);
    const { data } = await b.cdp.send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true });
    await writeFile(join(OUT, d.file), Buffer.from(data, 'base64'));
    console.log('PDF', d.file);
  }
} finally {
  await b.close();
}
