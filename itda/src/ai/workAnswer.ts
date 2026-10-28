// 업무 지정형 AI 검색 답변 (규칙 기반) — 질문에 나온 업무를 찾아 그 업무 자료로만 답한다.
import type { AppState, Prov, Stmt, TEvent, Work } from '../lib/types';
import type { Answer, AnswerLine } from './engine';
import { dateKey, fmtDate } from '../lib/util';

const STOP = new Set(['추진', '업무', '관련', '도입', '현재', '경과', '현황', '사업']);
const norm = (t: string) => t.replace(/[\s·ㆍ\-_()「」『』'"]/g, '');

/** 질문에서 가리키는 업무 찾기 — 업무명·키워드가 질문에 얼마나 들어있는지로 점수화 */
export function findTargetWork(s: AppState, q: string): Work | null {
  const qn = norm(q);
  let best: { w: Work; sc: number } | null = null;
  for (const w of s.works) {
    const name = norm(w.name);
    let sc = qn.includes(name) ? 10 : 0;
    const words = w.name.split(/[\s·ㆍ]+/).map(norm).filter((x) => x.length >= 2 && !STOP.has(x));
    for (const x of words) if (qn.includes(x)) sc += 2;
    // 붙여 쓴 업무명 대응: 업무명의 2글자 조각이 질문에 얼마나 나오는지
    const bi = new Set<string>();
    for (let i = 0; i < name.length - 1; i++) bi.add(name.slice(i, i + 2));
    let hit = 0;
    bi.forEach((b) => qn.includes(b) && hit++);
    sc += bi.size ? (hit / bi.size) * 4 : 0;
    for (const k of w.keywords ?? []) if (k.length >= 2 && qn.includes(norm(k))) sc += 1;
    if (!best || sc > best.sc) best = { w, sc };
  }
  return best && best.sc >= 2 ? best.w : null;
}

const has = (q: string, ...ws: string[]) => ws.some((w) => q.includes(w));
const evProv = (e: TEvent): Prov => (e.source === 'original' || e.source === 'cited' ? 'fact' : e.source === 'record' ? 'owner' : 'unverified');
const srcLabel = (e: TEvent) => (evProv(e) === 'fact' ? '원문 확인' : evProv(e) === 'owner' ? '플랫폼 기록' : '별도 확인 필요');
const stmtLines = (xs: Stmt[]): AnswerLine[] => xs.map((x) => ({ text: x.text, prov: x.prov, cite: x.cite }));

export function workAnswer(s: AppState, w: Work, q: string): Answer {
  const qn = q.replace(/\s+/g, '');
  const evs = s.events.filter((e) => e.workIds.includes(w.id)).sort((a, b) => dateKey(a.date).localeCompare(dateKey(b.date)));
  const decs = s.decisions.filter((d) => d.workId === w.id).sort((a, b) => a.date.localeCompare(b.date));
  const acts = s.actions.filter((a) => a.workId === w.id && a.status !== '완료').sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999'));
  const docs = s.docs.filter((d) => d.workIds.includes(w.id));
  const base = { query: q, scope: `'${w.name}' 업무에 등록된 자료 기준 답변`, works: [w.id] };
  const n = w.name.replace(/\s*추진$/, '');
  const fu = [`${n} 현재 추진 경과는?`, `${n} 추진 배경은?`, `${n} 향후 조치사항은?`, `${n} 주요 결정사항은?`];
  const others = (cur: string) => fu.filter((x) => x !== cur).slice(0, 3);
  const docEvidence = docs.slice(0, 5).map((d) => ({ docId: d.id, why: `업무 연결 문서 (${d.type})` }));
  const none = (what: string): AnswerLine => ({ text: `'${w.name}' 업무에 등록된 ${what}이(가) 없음. 관련 문서 등록 또는 업무 관리 화면에서 직접 입력 필요`, prov: 'unverified' });

  if (has(qn, '왜', '이유', '배경', '목적', '취지')) {
    const lines = [...stmtLines(w.purpose), ...stmtLines(w.background)];
    return { ...base, intent: 'work-why', lines: lines.length ? lines : [none('추진 배경·목적')], evidence: docEvidence, events: evs.slice(0, 3).map((e) => e.id), followups: others(fu[1]) };
  }
  if (has(qn, '향후', '후속', '조치', '앞으로', '할일', '해야', '계획', '예정')) {
    const lines: AnswerLine[] = acts.length
      ? [
          { text: `미완료 조치사항 ${acts.length}건`, prov: 'owner' },
          ...acts.map((a) => ({ text: `${a.title} — ${a.due ? `기한 ${fmtDate(a.due)}` : '기한 미지정'} (${a.status})`, prov: 'owner' as Prov, cite: a.cite })),
        ]
      : [none('미완료 조치사항')];
    return { ...base, intent: 'work-actions', lines, evidence: docEvidence, events: [], followups: others(fu[2]) };
  }
  if (has(qn, '결정', '의결', '결론', '합의')) {
    const lines: AnswerLine[] = decs.length ? decs.map((d) => ({ text: `${fmtDate(d.date)} ${d.title}${d.details.length ? ` — ${d.details.join(' / ')}` : ''}`, prov: d.prov, cite: d.cite })) : [none('결정사항')];
    return { ...base, intent: 'work-decisions', lines, evidence: docEvidence, events: decs.map((d) => d.eventId).filter((x): x is string => !!x), followups: others(fu[3]) };
  }
  if (has(qn, '쟁점', '이슈', '주의', '유의', '리스크', '문제')) {
    const lines = [...stmtLines(w.cautions), ...stmtLines(w.rejected)];
    return { ...base, intent: 'work-issues', lines: lines.length ? lines : [none('쟁점·유의사항')], evidence: docEvidence, events: [], followups: others('') };
  }
  // 경과·현황 (기본)
  const last = evs[evs.length - 1];
  const lines: AnswerLine[] = [
    { text: `업무 상태: ${w.status}${w.summary ? ` — ${w.summary}` : ''}`, prov: 'owner' },
    ...stmtLines(w.current),
  ];
  if (evs.length) {
    const todayKey = new Date().toISOString().slice(0, 10);
    const past = evs.filter((e) => String(e.date) <= todayKey);
    const recent = past[past.length - 1];
    const nextEv = evs.find((e) => String(e.date) > todayKey);
    lines.push({ text: `타임라인 이벤트 ${evs.length}건 (${fmtDate(evs[0].date)} ~ ${fmtDate(last.date)}).${recent ? ` 가장 최근 이벤트는 ${fmtDate(recent.date)} '${recent.title}'` : ''}${nextEv ? ` 앞으로 예정: ${fmtDate(nextEv.date)} '${nextEv.title}'` : ''}`, prov: 'owner' });
    const unv = evs.filter((e) => evProv(e) === 'unverified').length;
    if (unv) lines.push({ text: `이 중 ${unv}건은 날짜 또는 근거가 원문으로 확인되지 않아 별도 확인 필요`, prov: 'unverified' });
  } else lines.push(none('타임라인 이벤트'));
  if (acts.length) {
    const dayKey = new Date().toISOString().slice(0, 10);
    const overdue = acts.filter((a) => a.due && a.due < dayKey);
    const upcoming = acts.find((a) => a.due && a.due >= dayKey);
    lines.push({ text: `남은 조치사항 ${acts.length}건${overdue.length ? ` — 기한 경과 ${overdue.length}건(${overdue.map((a) => `${a.title} ${fmtDate(a.due)}`).join(', ')})` : ''}${upcoming ? ` — 다음 기한: ${upcoming.title} (${fmtDate(upcoming.due)})` : ''}`, prov: 'owner' });
  }
  return {
    ...base,
    intent: 'work-progress',
    lines,
    table: evs.length ? { head: ['날짜', '구분', '내용', '근거'], rows: evs.map((e) => [fmtDate(e.date), e.type, e.title, srcLabel(e)]) } : undefined,
    evidence: docEvidence,
    events: evs.map((e) => e.id),
    followups: others(fu[0]),
  };
}

export function sampleQuestions(s: AppState, fallback: string[]): string[] {
  if (!s.works.length) return fallback;
  const n = s.works[0].name.replace(/\s*추진$/, '');
  return [`${n} 현재 추진 경과는?`, `${n} 추진 배경은?`, `${n} 향후 조치사항은?`, `${n} 주요 결정사항은?`];
}
