// ─────────────────────────────────────────────────────────────
// Mock AI 엔진 (규칙 기반 시연용)
// 실제 LLM 연계 시: 각 함수의 입·출력 타입을 유지한 채 내부만 API 호출로 교체.
// 원칙: 등록 문서에 없는 내용은 사실로 만들지 않는다.
// ─────────────────────────────────────────────────────────────
import type { AppState, Doc, Prov, Work, Cite, RelType } from '../lib/types';
import { mapRiskIssues } from '../universe/risk';
import { conceptsOf, similarity, coreConcepts, conceptLabel, dice } from './concepts';
import { daysBetween, fmtDate, dateKey, localDay } from '../lib/util';
import { findTargetWork, INSIGHT_GUIDE, riskAnswer, workAnswer } from './workAnswer';

export const workText = (w: Work) => [w.name, w.summary, ...w.keywords].join(' ');

// ─── 1. 업무정보 누락·갱신 필요 점검 ───
export interface Issue {
  id: string;
  workId: string;
  severity: 'high' | 'mid' | 'low';
  title: string;
  detail: string;
  to: string;
}

export function workIssues(s: AppState, w: Work, now = new Date()): Issue[] {
  const out: Issue[] = [];
  const nowIso = now.toISOString();
  const evs = s.events.filter((e) => e.workIds.includes(w.id) && e.source !== 'record');
  const refEvents = evs.filter((e) => e.source === 'reference');
  const acts = s.actions.filter((a) => a.workId === w.id && a.status !== '완료');
  const overdue = acts.filter((a) => a.due && a.due < localDay(nowIso));
  const noDue = acts.filter((a) => !a.due);
  const decs = s.decisions.filter((d) => d.workId === w.id);
  const empty: string[] = [];
  if (!w.purpose.length) empty.push('업무 목적');
  if (!w.background.length) empty.push('추진 배경');
  if (!w.current.length) empty.push('현재 진행 사항');
  if (!w.cautions.length) empty.push('유의사항');
  if (!w.partners.length) empty.push('관계부서·협의기관');

  if (overdue.length)
    out.push({ id: w.id + '-od', workId: w.id, severity: 'high', title: `기한 경과 조치사항 ${overdue.length}건`, detail: overdue.map((a) => a.title).join(' · '), to: `/works/${w.id}?tab=actions` });
  if (empty.length)
    out.push({ id: w.id + '-em', workId: w.id, severity: 'high', title: `필수 항목 미작성 ${empty.length}개`, detail: empty.join(', '), to: `/works/${w.id}?tab=overview` });
  if (refEvents.length)
    out.push({ id: w.id + '-ref', workId: w.id, severity: 'mid', title: `원문 근거 없는 타임라인 이벤트 ${refEvents.length}건`, detail: '정책 이력 참고정보로만 등록됨 — 원문 확보 시 근거 연결 필요', to: `/works/${w.id}?tab=timeline` });
  const decNoWhy = decs.filter((d) => d.prov === 'fact' && /명시되어 있지 않음|확인되지 않음/.test(d.rationale.text));
  if (decNoWhy.length)
    out.push({ id: w.id + '-why', workId: w.id, severity: 'low', title: `결정 세부 근거 미기재 ${decNoWhy.length}건`, detail: '결정 이유가 문서에서 확인되지 않음', to: `/works/${w.id}?tab=meetings` });
  if (noDue.length)
    out.push({ id: w.id + '-nd', workId: w.id, severity: 'low', title: `기한 미지정 조치사항 ${noDue.length}건`, detail: noDue.map((a) => a.title).join(' · '), to: `/works/${w.id}?tab=actions` });
  if (daysBetween(w.updatedAt, nowIso) > 90)
    out.push({ id: w.id + '-st', workId: w.id, severity: 'mid', title: `${daysBetween(w.updatedAt, nowIso)}일간 업무정보 갱신 없음`, detail: '최근 90일 이내 갱신 이력 없음', to: `/works/${w.id}` });
  return out;
}

export function allIssues(s: AppState, now = new Date()) {
  // 업무 유니버스 지도 위험 점검(혼자만 아는 업무)도 같은 목록에(CR-24 D24-6 c)
  const list: Issue[] = [...s.works.flatMap((w) => workIssues(s, w, now)), ...mapRiskIssues(s, localDay(now.toISOString()))];
  const rank = { high: 0, mid: 1, low: 2 };
  return list.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

// ─── 2. AI 업무 브리핑 (등록 데이터에서 생성) ───
export interface BriefLine {
  text: string;
  prov: Prov;
  to?: string;
}
export function briefing(s: AppState, now = new Date()): BriefLine[] {
  const out: BriefLine[] = [];
  const nowIso = now.toISOString();
  const recent = (iso: string) => daysBetween(iso, nowIso) <= 30;
  for (const w of s.works) {
    const docs = s.docs.filter((d) => d.workIds.includes(w.id) && recent(d.registeredAt));
    if (!docs.length) continue;
    let t = `최근 30일 동안 '${w.name}' 업무에 관련 문서 ${docs.length}건이 추가되었습니다(${docs.map((d) => d.title).join(', ')}).`;
    out.push({ text: t, prov: 'fact', to: `/works/${w.id}?tab=docs` });
  }
  const od = s.actions.filter((a) => a.status !== '완료' && a.due && a.due < localDay(nowIso));
  if (od.length) out.push({ text: `기한이 지난 조치사항이 ${od.length}건 있습니다: ${od.map((a) => a.title).join(', ')}.`, prov: 'fact', to: `/works/${od[0].workId}?tab=actions` });
  return out;
}

// ─── 3. 업무 등록 시 중복·유사 업무 탐지 ───
export interface DupCandidate {
  work: Work;
  score: number;
  matched: string[];
  reason: string;
}
export interface DupResult {
  candidates: DupCandidate[];
  recommendation: 'append' | 'child' | 'separate' | 'none';
  parentId: string | null;
  relatedIds: string[];
  message: string;
}
export function detectDuplicates(s: AppState, name: string, desc: string): DupResult {
  const text = `${name} ${desc}`;
  const newSet = conceptsOf(text);
  const cands = s.works
    .map((w) => {
      const r = similarity(text, workText(w), name, w.name);
      return {
        work: w,
        score: r.score,
        matched: r.matched,
        reason: r.matched.length ? `공통 개념: ${r.matched.map(conceptLabel).join(', ')}` : '공통 개념 없음',
      };
    })
    .filter((c) => c.score >= 0.2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
  if (!name.trim() || !cands.length) return { candidates: cands, recommendation: 'none', parentId: null, relatedIds: [], message: '유사한 기존 업무가 없습니다. 별도 업무로 등록합니다.' };
  const top = cands[0];
  if (dice(name, top.work.name) > 0.85 && top.score > 0.7)
    return { candidates: cands, recommendation: 'append', parentId: null, relatedIds: [top.work.id], message: `기존 업무 '${top.work.name}'와 사실상 같은 업무입니다. 새 업무를 만들기보다 기존 업무에 자료를 추가하는 것을 추천합니다.` };
  if (top.score >= 0.35) {
    const umbrella = cands
      .filter((c) => c.score >= 0.3 && s.works.some((w) => w.parentId === c.work.id))
      .find((c) => {
        const core = coreConcepts(conceptsOf(c.work.name));
        return core.length > 0 && core.every((id) => newSet.has(id));
      });
    const parent = umbrella?.work ?? top.work;
    const related = cands.filter((c) => c.work.id !== parent.id && c.score >= 0.3).map((c) => c.work.id);
    return {
      candidates: cands,
      recommendation: 'child',
      parentId: parent.id,
      relatedIds: related,
      message: `기존 업무 '${parent.name}'와 관련성이 높습니다. 해당 업무의 하위 업무로 등록하는 것을 추천합니다.${related.length ? ` 함께 관련 업무로 연결할 후보: ${related.map((id) => `'${s.works.find((w) => w.id === id)!.name}'`).join(', ')}.` : ''}`,
    };
  }
  return { candidates: cands, recommendation: 'separate', parentId: null, relatedIds: cands.map((c) => c.work.id).slice(0, 2), message: '일부 개념이 겹치는 업무가 있습니다. 별도 업무로 등록하고 관련 업무로 연결하는 것을 추천합니다.' };
}

// ─── 5. 신규 문서 AI 분석 (mock) ───
export interface DocAnalysis {
  summary: string[];
  core: string[];
  decisions: string[];
  todos: { text: string; prov: Prov }[];
  keywords: string[];
  relatedWorks: { id: string; name: string; score: number; reason: string }[];
  similarDocs: { id: string; title: string; score: number; type: RelType; basis: 'fact' | 'inference'; note: string }[];
  isMinutes: boolean;
  minutesNote?: string;
}

function sentences(text: string) {
  return text
    .replace(/\r/g, '')
    .split(/\n+|(?<=[다임음함됨요]\.)\s+(?=\S)/)
    .map((x) => x.trim())
    .filter((x) => x.length > 6);
}

export function analyzeDocument(s: AppState, title: string, text: string, writtenAt: string): DocAnalysis {
  const all = `${title}\n${text}`;
  const sents = sentences(text);
  const cs = conceptsOf(all);
  const scored = sents.map((x, i) => ({ x, i, sc: conceptsOf(x).size * 2 + (i < 3 ? 1 : 0) + (/의결|결정|확정|개정|시행/.test(x) ? 1 : 0) }));
  const top3 = [...scored].sort((a, b) => b.sc - a.sc).slice(0, 3).sort((a, b) => a.i - b.i).map((x) => clip(x.x, 120));
  const core = scored.filter((x) => conceptsOf(x.x).size >= 2).slice(0, 4).map((x) => clip(x.x, 160));
  const decisions = sents.filter((x) => /의결|결정|확정|승인|채택|합의/.test(x)).slice(0, 4).map((x) => clip(x, 160));
  const todoSents = sents.filter((x) => /예정|계획|추진할|조치할|하기로|해야|후속 조치|향후/.test(x)).slice(0, 4);
  const todos: DocAnalysis['todos'] = todoSents.length
    ? todoSents.map((x) => ({ text: clip(x, 160), prov: 'fact' as Prov }))
    : [{ text: '원문에서 향후 조치에 해당하는 문장을 찾지 못함 — 담당자 확인 필요', prov: 'unverified' }];
  const keywords = [...cs].map(conceptLabel).slice(0, 8);
  const extra = [...new Set((all.match(/(법률\s*제\d+호|\d+년)/g) ?? []).map((x) => x.replace(/\s+/g, ' ')))].slice(0, 4);
  const relatedWorks = s.works
    .map((w) => {
      const r = similarity(all, workText(w), title, w.name);
      return { id: w.id, name: w.name, score: r.score, reason: r.matched.length ? r.matched.map(conceptLabel).join(', ') : '-' };
    })
    .filter((x) => x.score >= 0.2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  const topWork = relatedWorks[0]?.id;
  const wk = dateKey(writtenAt || '9999');
  const similarDocs: DocAnalysis['similarDocs'] = s.docs
    .map((d) => {
      const dText = [d.title, ...d.keywords, ...d.summary].join(' ');
      const r = similarity(all, dText, title, d.title);
      const sameWork = topWork && d.workIds.includes(topWork);
      const score = r.score + (sameWork ? 0.15 : 0);
      let type: RelType = '유사';
      let basis: 'fact' | 'inference' = 'inference';
      let note = r.matched.length ? `공통 개념: ${r.matched.map(conceptLabel).join(', ')}` : '같은 업무 문서';
      const lawNo = d.title.match(/법률 제(\d+)호/);
      if (lawNo && all.includes(lawNo[1])) {
        type = '근거';
        basis = 'fact';
        note = `본문에 법률 제${lawNo[1]}호 인용`;
      } else if (dice(title, d.title) > 0.8 && wk > dateKey(d.writtenAt || '0')) {
        type = '대체';
        note = '제목이 거의 같고 작성일이 더 최근 — 기존 문서를 대체하는 개정판일 가능성';
      } else if (/개정/.test(all) && d.type === '법령 개정자료') {
        type = '개정';
      } else if (d.writtenAt && writtenAt && sameWork) {
        type = dateKey(d.writtenAt) < wk ? '선행' : dateKey(d.writtenAt) > wk ? '후속' : '유사';
        note += ` · 작성일 ${fmtDate(d.writtenAt)}`;
      }
      return { id: d.id, title: d.title, score, type, basis, note };
    })
    .filter((x) => x.score >= 0.25)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  const isMinutes = /회의록/.test(title);
  return {
    summary: top3.length ? top3 : ['본문이 짧아 요약할 문장이 부족함'],
    core: core.length ? core : top3,
    decisions: decisions.length ? decisions : ['원문에서 결정사항에 해당하는 문장을 찾지 못함'],
    todos,
    keywords: [...keywords, ...extra],
    relatedWorks,
    similarDocs,
    isMinutes,
    minutesNote: isMinutes ? '회의록으로 판단됨 — 문서 유형을 회의록으로 등록하면 회의록 메뉴에 표시됨' : undefined,
  };
}
const clip = (x: string, n: number) => (x.length > n ? x.slice(0, n - 1) + '…' : x);

// ─── 6. AI 업무 검색 (자연어 질의 → 근거 기반 답변) ───
export interface AnswerLine {
  text: string;
  prov: Prov;
  cite?: Cite[];
}
export interface Answer {
  query: string;
  intent: string;
  lines: AnswerLine[];
  table?: { head: string[]; rows: string[][] };
  evidence: { docId: string; anchor?: string; why: string; quote?: string }[];
  events: string[];
  works: string[];
  followups: string[];
  scope?: string;
}


export function askAI(s: AppState, raw: string): Answer {
  const q = raw.replace(/\s+/g, ' ').trim();
  // 사람·조직의 인계 위험 질문(팀장용)은 인사이트 계산으로 답함
  const risk = riskAnswer(s, q);
  if (risk) return risk;
  // 질문이 특정 업무를 가리키면 그 업무 자료로만 답함
  const target = findTargetWork(s, q) ?? (s.works.length === 1 ? s.works[0] : null);
  if (target) return workAnswer(s, target, q);
  // 일반 검색 (키워드)
  const terms = q.split(/[\s,?？.]+/).filter((t) => t.length >= 2 && !/^(무엇|어떤|있나|있었나|알려줘|인가|대해)$/.test(t));
  const docHits = s.docs.filter((d) => terms.some((t) => [d.title, ...d.keywords, ...d.summary].join(' ').includes(t)));
  const evHits = s.events.filter((e) => terms.some((t) => `${e.title} ${e.summary}`.includes(t)));
  const workHits = s.works.filter((w) => terms.some((t) => workText(w).includes(t)));
  if (!docHits.length && !evHits.length && !workHits.length) {
    return {
      query: q,
      intent: 'none',
      lines: [{ text: '현재 등록된 업무·문서·회의록에서는 해당 내용을 확인할 수 없습니다. 관련 문서를 문서함에 등록하면 다시 검색할 수 있습니다.', prov: 'unverified' }, { text: INSIGHT_GUIDE, prov: 'unverified' }],
      evidence: [],
      events: [],
      works: [],
      followups: SAMPLE_QUESTIONS.slice(0, 3),
    };
  }
  return {
    query: q,
    intent: 'keyword',
    lines: [
      { text: `질문과 일치하는 등록 자료를 찾았습니다: 문서 ${docHits.length}건, 타임라인 이벤트 ${evHits.length}건, 업무 ${workHits.length}건.`, prov: 'fact' },
      { text: '질문에 대한 직접적인 답변 문장은 등록 문서에서 찾지 못했습니다. 아래 근거 자료를 직접 확인해 주세요.', prov: 'unverified' },
      { text: INSIGHT_GUIDE, prov: 'unverified' },
    ],
    evidence: docHits.slice(0, 5).map((d) => ({ docId: d.id, why: '키워드 일치' })),
    events: evHits.slice(0, 6).map((e) => e.id),
    works: workHits.map((w) => w.id),
    followups: SAMPLE_QUESTIONS.slice(0, 3),
  };
}

export const SAMPLE_QUESTIONS = [
  '출금동의 업무의 현재 추진 경과는?',
  '출금동의 업무의 추진 배경은?',
  '출금동의 업무의 향후 조치사항은?',
  '출금동의 업무의 주요 결정사항은?',
  '정하준이 빠지면 무엇이 막히나요?',
  '디지털신원팀에서 인계 위험이 큰 업무는?',
];

export function docOf(s: AppState, id: string): Doc | undefined {
  return s.docs.find((d) => d.id === id);
}
