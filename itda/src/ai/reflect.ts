// ─────────────────────────────────────────────────────────────
// 문서 → 업무 반영 제안 (결정사항 · 타임라인 이벤트 · 향후 조치 · 업무 개요)
//
// 1) 추출: Claude(sample) 또는 규칙 기반 Mock
// 2) 검증: 제안마다 '근거 인용문'이 원문에 그대로 있는지, 날짜가 원문에 있는지 대조
//    → 통과: 원문 확인 / 실패: 별도 확인 필요 (AI가 확정하지 않음)
// 3) 반영: 담당자가 승인한 항목만 업무 데이터에 기록
// ─────────────────────────────────────────────────────────────
import type { AppState, Doc, DocParagraph, EventType, Work } from '../lib/types';
import { workText } from './engine';
import { similarity, conceptLabel } from './concepts';
import type { SampleFn } from './claude';
import { uid, localDay } from '../lib/util';

export type ProposalKind = 'decision' | 'event' | 'action' | 'overview';
export type OverviewField = 'purpose' | 'background' | 'current' | 'cautions';
export const FIELD_LABEL: Record<OverviewField, string> = { purpose: '업무 목적', background: '추진 배경', current: '현재 진행 사항', cautions: '유의사항' };
export const EVENT_TYPES: EventType[] = ['업무 착수', '법령', '회의', '의사결정', '보도자료', '시행', '업무 변경'];
export const PHASE_OPTIONS = ['입법', '하위법령 정비', '시행·확대', '문서 등록 반영'];

export interface Proposal {
  id: string;
  kind: ProposalKind;
  workId: string;
  text: string; // 결정 제목 / 이벤트 제목 / 조치 / 개요 문장
  detail?: string;
  date: string | null; // YYYY-MM-DD 또는 YYYY-MM
  dateText?: string | null; // 원문에 적힌 날짜 표기
  eventType?: EventType;
  phase?: string;
  field?: OverviewField;
  quote: string; // 근거 인용문 (원문 그대로여야 함)
  paraId?: string;
  basis: 'source' | 'inference'; // 추출 엔진이 밝힌 근거 유형
  // 검증 결과
  verified: boolean;
  dateVerified: boolean;
  issue?: string;
  approved: boolean;
}

export interface Extraction {
  summary: string[];
  core: string[];
  keywords: string[];
  relatedWorks: { id: string; name: string; score: number; reason: string }[];
  proposals: Proposal[];
  engine: 'claude' | 'mock';
  truncatedInput: boolean;
}

// ─── 검증 ───
const norm = (s: string) =>
  s
    .replace(/[\s ]+/g, '')
    .replace(/[ㆍ·•∙]/g, '·')
    .replace(/[“”"]/g, '"')
    .replace(/[‘’']/g, "'")
    .replace(/[∼~〜]/g, '~')
    .toLowerCase();

export function locate(paras: DocParagraph[], quote: string, hint?: string): DocParagraph | null {
  const q = norm(quote);
  if (q.length < 6) return null;
  const hinted = paras.find((p) => p.id === hint);
  if (hinted && norm(hinted.text).includes(q)) return hinted;
  return paras.find((p) => norm(p.text).includes(q)) ?? null;
}

const DATE_RE = /(\d{4})\s*[.년-]\s*(\d{1,2})\s*[.월-]?\s*(?:(\d{1,2})\s*[.일]?)?/g;
export function parseDates(text: string): { iso: string; raw: string }[] {
  const out: { iso: string; raw: string }[] = [];
  for (const m of text.matchAll(DATE_RE)) {
    const y = +m[1];
    const mo = +m[2];
    const d = m[3] ? +m[3] : null;
    if (y < 1990 || y > 2100 || mo < 1 || mo > 12 || (d !== null && (d < 1 || d > 31))) continue;
    const iso = `${y}-${String(mo).padStart(2, '0')}${d ? '-' + String(d).padStart(2, '0') : ''}`;
    out.push({ iso, raw: m[0].trim() });
  }
  return out;
}

export function verify(p: Proposal, paras: DocParagraph[]): Proposal {
  const hit = p.quote ? locate(paras, p.quote, p.paraId) : null;
  const all = paras.map((x) => x.text).join('\n');
  let dateVerified = true;
  if (p.date) {
    const inDoc = parseDates(all).some((d) => d.iso === p.date || (p.date!.length === 7 && d.iso.startsWith(p.date!)));
    const textOk = p.dateText ? norm(all).includes(norm(p.dateText)) : false;
    dateVerified = inDoc || textOk;
  }
  const issues: string[] = [];
  if (!hit) issues.push(p.quote ? '근거 인용문이 원문에서 확인되지 않음' : '근거 인용문 없음');
  if (p.basis === 'inference') issues.push('원문에 직접 기재되지 않은 AI 추론');
  if (p.date && !dateVerified) issues.push('날짜가 원문에서 확인되지 않음');
  return {
    ...p,
    paraId: hit?.id ?? p.paraId,
    verified: !!hit && p.basis === 'source',
    dateVerified,
    issue: issues.length ? issues.join(' · ') + ' — 별도 확인 필요' : undefined,
  };
}

// ─── 공통 ───
function sentencesOf(paras: DocParagraph[]) {
  return paras.flatMap((p) =>
    p.text
      .split(/(?<=[다임음함됨요]\.)\s+(?=\S)/)
      .map((t) => t.trim())
      .filter((t) => t.length > 8)
      .map((t) => ({ t, paraId: p.id })),
  );
}
const clip = (x: string, n: number) => {
  const t = x.replace(/^(□|■|▢|○|ㅇ|◦|●|•|-|※|▸|‣|\d{1,2}\.|[가-하]\.)\s*/, '');
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};
function typeOf(t: string): EventType {
  if (/의결|결정|확정|승인|채택/.test(t)) return '의사결정';
  if (/시행(?!령)|확대|개시|오픈|운영 개시/.test(t)) return '시행';
  if (/공포|개정|제정|입법|법률|시행령|제출/.test(t)) return '법령';
  if (/의결|결정|확정|승인|채택/.test(t)) return '의사결정';
  if (/개최|회의|위원회/.test(t)) return '회의';
  if (/보도|발표|공개/.test(t)) return '보도자료';
  if (/착수|추진 계획|시작/.test(t)) return '업무 착수';
  return '업무 변경';
}
export function phaseOf(t: EventType) {
  return t === '시행' ? '시행·확대' : t === '법령' || t === '업무 착수' ? '입법' : '문서 등록 반영';
}

export function relatedWorksOf(s: AppState, title: string, text: string) {
  return s.works
    .map((w) => {
      const r = similarity(`${title}\n${text}`, workText(w), title, w.name);
      return { id: w.id, name: w.name, score: r.score, reason: r.matched.length ? r.matched.map(conceptLabel).join(', ') : '-' };
    })
    .filter((x) => x.score >= 0.2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

// ─── Mock 추출 (규칙 기반) ───
export function mockExtract(s: AppState, title: string, paras: DocParagraph[], defaultWork: string): Extraction {
  const sents = sentencesOf(paras);
  const P = (x: Partial<Proposal> & Pick<Proposal, 'kind' | 'text' | 'quote'>): Proposal =>
    verify({ id: uid('PR'), workId: defaultWork, date: null, basis: 'source', verified: false, dateVerified: true, approved: false, ...x } as Proposal, paras);
  const out: Proposal[] = [];
  const seen = new Set<string>();
  const take = (kind: ProposalKind, re: RegExp, max: number, make: (x: { t: string; paraId: string }) => Proposal | null) => {
    let n = 0;
    for (const x of sents) {
      if (n >= max) break;
      if (!re.test(x.t) || seen.has(kind + x.t)) continue;
      const p = make(x);
      if (p) {
        out.push(p);
        seen.add(kind + x.t);
        n++;
      }
    }
  };
  take('decision', /의결|결정|확정|승인|채택|합의/, 5, (x) => P({ kind: 'decision', text: clip(x.t, 90), quote: x.t, paraId: x.paraId, date: parseDates(x.t)[0]?.iso ?? null }));
  take('event', /시행|공포|의결|개최|발표|착수|제출|개정|확대|변경|출범/, 6, (x) => {
    const ds = parseDates(x.t);
    if (!ds.length) return null;
    const et = typeOf(x.t);
    // 유형을 정한 단어 바로 앞의 날짜를 우선 (예: '…공포되었고, 2024. 12. 27. 시행됨' → 시행일)
    const kw = x.t.search(et === '시행' ? /시행(?!령)|확대|개시/ : et === '의사결정' ? /의결|결정|확정|승인|채택/ : /공포|개정|제정|제출|개최|발표|착수/);
    const d = kw >= 0 ? [...ds].reverse().find((z) => x.t.indexOf(z.raw) < kw) ?? ds[0] : ds[0];
    return P({ kind: 'event', text: clip(x.t, 70), quote: x.t, paraId: x.paraId, date: d.iso, dateText: d.raw, eventType: et, phase: phaseOf(et) });
  });
  take('action', /예정|계획|추진할|하기로|해야|할 것|조치할|마련할/, 5, (x) => {
    const d = parseDates(x.t).find((z) => z.iso.length === 10);
    return P({ kind: 'action', text: clip(x.t, 90), quote: x.t, paraId: x.paraId, date: d?.iso ?? null, dateText: d?.raw ?? null });
  });
  const ov: [OverviewField, RegExp][] = [
    ['purpose', /목적|위하여|위해/],
    ['background', /에 따라|배경|때문|필요성/],
    ['current', /현재|진행 중|운영 중/],
    ['cautions', /유의|주의|다만|단,/],
  ];
  for (const [f, re] of ov) take('overview', re, 2, (x) => (out.some((o) => o.kind === 'overview' && o.quote === x.t) ? null : P({ kind: 'overview', field: f, text: clip(x.t, 140), quote: x.t, paraId: x.paraId })));

  const scored = sents.map((x, i) => ({ ...x, i, sc: (/의결|결정|목적|위하여|시행|개정/.test(x.t) ? 2 : 0) + (i < 3 ? 1 : 0) }));
  const summary = [...scored].sort((a, b) => b.sc - a.sc).slice(0, 3).sort((a, b) => a.i - b.i).map((x) => clip(x.t, 120));
  const text = paras.map((p) => p.text).join('\n');
  return {
    summary: summary.length ? summary : ['본문이 짧아 요약할 문장이 부족함'],
    core: scored.filter((x) => x.sc >= 2).slice(0, 4).map((x) => clip(x.t, 160)),
    keywords: [],
    relatedWorks: relatedWorksOf(s, title, text),
    proposals: out,
    engine: 'mock',
    truncatedInput: false,
  };
}

// ─── Claude 추출 ───
const MAX_CHARS = 60000;
interface ClaudeRaw {
  summary?: string[];
  core?: string[];
  keywords?: string[];
  relatedWorks?: { id: string; reason?: string; score?: number }[];
  proposals?: {
    kind?: string;
    workId?: string;
    text?: string;
    detail?: string;
    date?: string | null;
    dateText?: string | null;
    eventType?: string;
    field?: string;
    paraId?: string;
    quote?: string;
    basis?: string;
  }[];
}

export async function claudeExtract(sample: SampleFn, s: AppState, title: string, paras: DocParagraph[], defaultWork: string, writtenAt: string, signal?: AbortSignal): Promise<Extraction> {
  let used = 0;
  const lines: string[] = [];
  let truncatedInput = false;
  for (const p of paras) {
    const l = `[${p.id}] ${p.text}`;
    if (used + l.length > MAX_CHARS) {
      truncatedInput = true;
      break;
    }
    lines.push(l);
    used += l.length;
  }
  const works = s.works.map((w: Work) => `- ${w.id} | ${w.name} | ${w.summary}`).join('\n');
  const prompt = `당신은 정부·공공기관 업무 인수인계 플랫폼의 문서 분석기입니다. 아래 문서에서 업무 정보에 반영할 항목을 추출합니다.

## 절대 규칙
1. 문서에 적힌 내용만 추출합니다. 문서에 없는 사실, 배경, 이유를 지어내지 않습니다.
2. 모든 제안에는 근거 문장 "quote"를 문서에서 **글자 그대로** 복사합니다(150자 이내, 고쳐 쓰기·요약 금지). 근거 문단 번호 "paraId"(예: p-3, p2-4)도 적습니다.
3. 문서에 직접 쓰여 있지 않고 해석한 항목은 "basis": "inference"로 표시합니다. 직접 기재는 "basis": "source".
4. 날짜는 문서에 적힌 것만 씁니다. "date"는 YYYY-MM-DD(일이 없으면 YYYY-MM), "dateText"는 문서에 적힌 날짜 표기 그대로. 없으면 둘 다 null.
5. 확인할 수 없는 것은 비워 둡니다. 개수를 채우려고 억지로 만들지 않습니다.
6. 출력은 JSON 객체 하나만 씁니다.

## 문서 정보
- 제목: ${title}
- 작성일: ${writtenAt || '미상'}
- 기본 연결 업무: ${defaultWork || '없음'}

## 플랫폼에 등록된 업무 (workId는 이 목록에서만 선택)
${works}

## 추출 항목
- summary: 문서 3줄 요약 (문자열 3개, 명사형 종결)
- core: 핵심 내용 2~4개 (문서 표현 위주)
- keywords: 핵심 키워드 3~8개
- relatedWorks: 관련 업무 [{ "id", "reason", "score"(0~1) }] 최대 3개
- proposals: 업무 반영 제안 배열. 각 항목:
  { "kind": "decision"|"event"|"action"|"overview",
    "workId": 위 목록의 업무 ID,
    "text": 결정 제목 / 이벤트 제목 / 조치 내용 / 업무 개요 문장 (명사형 종결),
    "detail": 보충 설명(선택),
    "date", "dateText",
    "eventType": event일 때만 — "업무 착수"|"법령"|"회의"|"의사결정"|"보도자료"|"시행"|"업무 변경",
    "field": overview일 때만 — "purpose"(업무 목적)|"background"(추진 배경)|"current"(현재 진행 사항)|"cautions"(유의사항),
    "paraId", "quote", "basis" }
  - decision: 의결·결정·확정된 사항 (최대 6)
  - event: 날짜가 있는 사건 (최대 8)
  - action: 앞으로 해야 할 조치·예정 사항 (최대 6, 기한이 있으면 date)
  - overview: 업무 개요에 추가할 문장 (최대 6)

## 문서 본문${truncatedInput ? ' (분량이 많아 앞부분만 제공)' : ''}
${lines.join('\n')}`;

  const raw = await sample.json<ClaudeRaw>(prompt, { modelTier: 'default', signal });
  const validWork = (id?: string) => (id && s.works.some((w) => w.id === id) ? id : defaultWork);
  const kinds: ProposalKind[] = ['decision', 'event', 'action', 'overview'];
  const fields: OverviewField[] = ['purpose', 'background', 'current', 'cautions'];
  const proposals = (raw.proposals ?? [])
    .filter((p) => p && kinds.includes(p.kind as ProposalKind) && typeof p.text === 'string' && p.text.trim())
    .slice(0, 30)
    .map((p) => {
      const kind = p.kind as ProposalKind;
      const et = EVENT_TYPES.includes(p.eventType as EventType) ? (p.eventType as EventType) : kind === 'event' ? typeOf(p.text!) : undefined;
      const date = typeof p.date === 'string' && /^\d{4}-\d{2}(-\d{2})?$/.test(p.date) ? p.date : null;
      return verify(
        {
          id: uid('PR'),
          kind,
          workId: validWork(p.workId),
          text: String(p.text).slice(0, 200),
          detail: p.detail ? String(p.detail).slice(0, 300) : undefined,
          date,
          dateText: p.dateText ?? null,
          eventType: et,
          phase: et ? phaseOf(et) : undefined,
          field: kind === 'overview' ? (fields.includes(p.field as OverviewField) ? (p.field as OverviewField) : 'current') : undefined,
          quote: String(p.quote ?? ''),
          paraId: p.paraId,
          basis: p.basis === 'inference' ? 'inference' : 'source',
          verified: false,
          dateVerified: true,
          approved: false,
        },
        paras,
      );
    })
    .filter((p) => p.kind !== 'event' || p.date); // 날짜 없는 이벤트는 타임라인에 놓을 수 없음
  const rw = (raw.relatedWorks ?? [])
    .filter((r) => s.works.some((w) => w.id === r.id))
    .slice(0, 3)
    .map((r) => ({ id: r.id, name: s.works.find((w) => w.id === r.id)!.name, score: Math.max(0, Math.min(1, Number(r.score ?? 0.6))), reason: String(r.reason ?? '') }));
  return {
    summary: (raw.summary ?? []).map(String).slice(0, 3),
    core: (raw.core ?? []).map(String).slice(0, 4),
    keywords: (raw.keywords ?? []).map(String).slice(0, 8),
    relatedWorks: rw,
    proposals,
    engine: 'claude',
    truncatedInput,
  };
}

// ─── 승인 항목 반영 ───
export function applyProposals(d: AppState, doc: Doc, props: Proposal[], actorId: string) {
  const now = new Date().toISOString();
  const label = (pid?: string) => {
    const p = doc.paragraphs?.find((x) => x.id === pid);
    return `${doc.title}${p ? ` · ${p.page ? `${p.page}쪽 ` : ''}${p.id}` : ''}`;
  };
  const counts: Record<string, Record<ProposalKind, number>> = {};
  for (const p of props.filter((x) => x.approved)) {
    const w = d.works.find((x) => x.id === p.workId);
    if (!w) continue;
    counts[w.id] ??= { decision: 0, event: 0, action: 0, overview: 0 };
    counts[w.id][p.kind]++;
    if (!doc.workIds.includes(w.id)) doc.workIds.push(w.id);
    const cite = p.verified ? [{ docId: doc.id, anchor: p.paraId, label: label(p.paraId) }] : [];
    const note = p.verified ? undefined : p.issue;
    if (p.kind === 'decision') {
      d.decisions.push({
        id: uid('DEC'),
        workId: w.id,
        date: p.date ?? doc.writtenAt ?? localDay(now),
        title: p.text,
        details: [p.detail, p.quote && `원문: "${p.quote}"`].filter(Boolean) as string[],
        prov: p.verified ? 'fact' : 'unverified',
        source: p.verified ? 'original' : 'unverified',
        cite,
        rationale: { id: 'x', text: '결정 이유는 등록 문서에서 별도 확인 필요', prov: 'unverified' },
      });
    } else if (p.kind === 'event' && p.date) {
      d.events.push({
        id: uid('E'),
        workIds: [w.id],
        date: p.date,
        type: p.eventType ?? '업무 변경',
        title: p.text,
        summary: p.detail || p.quote,
        decisions: [],
        agency: '등록 문서 기준 · 별도 확인 필요',
        docIds: [doc.id],
        cite,
        source: p.verified && p.dateVerified ? 'original' : 'unverified',
        meaning: `'${doc.title}'에서 추출해 담당자가 승인한 이벤트. 다른 사건과의 인과관계는 아직 분석되지 않음`,
        causes: [],
        phase: p.phase ?? '문서 등록 반영',
      });
    } else if (p.kind === 'action') {
      d.actions.push({
        id: uid('A'),
        workId: w.id,
        title: p.text,
        due: p.date && p.date.length === 10 ? p.date : null,
        status: '예정',
        ownerId: w.owners[0] ?? actorId,
        createdAt: now,
        note: p.verified ? (p.date && !p.dateVerified ? '기한 원문 미확인 — 별도 확인 필요' : `출처: ${doc.title}`) : note,
        cite,
      });
    } else if (p.kind === 'overview' && p.field) {
      w[p.field].push({ id: uid('s'), text: p.text, prov: p.verified ? 'fact' : 'unverified', cite, note });
    }
  }
  for (const [wid, c] of Object.entries(counts)) {
    const parts = [c.decision && `결정 ${c.decision}`, c.event && `타임라인 ${c.event}`, c.action && `조치 ${c.action}`, c.overview && `개요 ${c.overview}`].filter(Boolean);
    d.history.push({ id: uid('H'), workId: wid, at: now, actorId, kind: '문서 반영 승인', summary: `'${doc.title}'에서 ${parts.join(' · ')}건 반영` });
    const w = d.works.find((x) => x.id === wid)!;
    w.updatedAt = now;
    w.version += 1;
  }
  return counts;
}
