// 업무 지정형 AI 검색 답변 (규칙 기반) — 질문에 나온 업무를 찾아 그 업무 자료로만 답한다.
import type { AppState, Prov, Stmt, TEvent, Work } from '../lib/types';
import type { Answer, AnswerLine } from './engine';
import { dateKey, fmtDate, localDay } from '../lib/util';
import { effectiveOrgs, orgShort } from '../lib/orgs';
import { isLeft } from '../lib/people';
import { handoverInsights, INSIGHT_NAMES, namesText, personImpact, riskTotals } from '../universe/insights';

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
  return [`${n} 현재 추진 경과는?`, `${n} 추진 배경은?`, `${n} 향후 조치사항은?`, `${n} 주요 결정사항은?`, ...leaderQuestions(s)];
}

// ─── 사람·조직 위험 질문(팀장용) — 인사이트 계산으로 답한다 ───
const josa = (name: string, a: string, b: string) => {
  const c = name.charCodeAt(name.length - 1) - 0xac00;
  return c >= 0 && c <= 11171 && c % 28 !== 0 ? a : b;
};
const QUIT = /빠지면|없으면|퇴직|전출|휴가|자리를\s*비|부재/; // 그 사람이 없을 때
const RISKY = /위험|막히|막힘|인계/;
const OWNS = /담당|맡은|맡고|맡아/;
/** 팀장용 예시 질문 2개: 맡은 업무가 가장 많은 사람, 첫 업무의 조직 */
export function leaderQuestions(s: AppState): string[] {
  const load = new Map<string, number>();
  for (const w of s.works) for (const o of w.owners) if (!isLeft(s.users.find((u) => u.id === o))) load.set(o, (load.get(o) ?? 0) + 1);
  const top = [...load.entries()].sort((a, b) => b[1] - a[1])[0];
  const name = top && s.users.find((u) => u.id === top[0])?.name;
  const org = orgShort(s.works.find((w) => w.dept)?.dept ?? '');
  return [...(name ? [`${name}${josa(name, '이', '가')} 빠지면 무엇이 막히나요?`] : []), ...(org ? [`${org}에서 인계 위험이 큰 업무는?`] : [])];
}
/** 답할 수 없을 때 붙이는 안내 */
export const INSIGHT_GUIDE = '사람·조직별 인계 위험(누가 빠지면 무엇이 막히는지)은 「업무 유니버스 인사이트」에서 볼 수 있습니다.';

const L = (text: string): AnswerLine => ({ text, prov: 'fact' }); // 기록에서 규칙으로 센 값

/**
 * 「정하준이 빠지면 무엇이 막히나요?」「디지털신원팀에서 인계 위험이 큰 업무는?」 같은 질문.
 * 질문에 사람·조직 이름과 위험 말이 있으면 인사이트 계산으로 답한다. 아니면 null(다른 규칙이 이어받는다)
 */
export function riskAnswer(s: AppState, q: string, now = new Date()): Answer | null {
  const asOf = localDay(now.toISOString());
  const qn = q.replace(/\s+/g, '');
  const hit = (re: RegExp) => re.test(qn);
  if (!hit(QUIT) && !hit(RISKY) && !hit(OWNS)) return null;
  const pos = (name: string) => qn.indexOf(name.replace(/\s+/g, ''));
  const user = s.users.filter((u) => u.name.length >= 2 && pos(u.name) >= 0).sort((a, b) => pos(a.name) - pos(b.name))[0];
  if (user) {
    // 업무 이름이 질문에 통째로 있고 위험 말이 없으면 업무 답변이 맡는다(「김도윤이 맡은 OO 업무 현황」)
    const target = findTargetWork(s, q);
    if (!hit(QUIT) && !hit(RISKY) && target && qn.includes(norm(target.name))) return null;
    const imp = personImpact(s, user.id, asOf);
    if (!imp) return null;
    const nm = user.name;
    const list = (ws: { name: string }[]) => namesText(ws.map((w) => w.name), 4);
    const lines: AnswerLine[] = [];
    if (imp.left) lines.push(L(`${nm}${josa(nm, '은', '는')} 이미 전출·퇴직으로 표시되어 있습니다. 아래는 아직 ${nm} 이름으로 남은 업무 기준입니다.`));
    lines.push(imp.works.length ? L(`${nm}${josa(nm, '이', '가')} 맡은 진행 중 업무 ${imp.works.length}개: ${list(imp.works)}`) : L(`${nm}${josa(nm, '이', '가')} 맡은 진행 중 업무가 없습니다.`));
    if (imp.works.length) {
      lines.push(imp.soleWorks.length ? L(`${imp.left ? '담당이 비어 있는' : '빠지면 담당이 비는'} 업무(혼자만 맡은 일) ${imp.soleWorks.length}개: ${list(imp.soleWorks)}`) : L('혼자만 맡은 업무는 없습니다. 모든 업무에 다른 재직 담당이 있습니다.'));
      lines.push(imp.blocked.length ? L(`이어서 함께 막히는 업무 ${imp.blocked.length}개: ${list(imp.blocked)} (선후행·산출물로 이어진 업무)`) : L('선후행·산출물로 이어져 함께 막히는 업무는 없습니다.'));
      lines.push(imp.candidates.length ? L(`인계 후보: ${imp.candidates.map((c) => `${c.name}(${c.direct ? '이전 담당' : '비슷한 일 경험'})`).join(', ')}`) : L('인계 후보: 비슷한 일을 해 본 사람을 찾지 못했습니다.'));
      if (imp.readiness.length) lines.push(L(`인계 준비도(6점 만점): ${imp.readiness.map((r) => `「${r.work.name}」 ${r.score}/${r.total}`).join(', ')}`));
    }
    const ids = [...new Set([...imp.works, ...imp.blocked].map((w) => w.id))];
    return { query: q, intent: 'risk-person', lines, evidence: [], events: [], works: ids, followups: leaderQuestions(s).filter((x) => !x.startsWith(nm)), scope: `업무 유니버스 인사이트 규칙으로 계산한 결과입니다(회사 전체 지도, ${asOf} 기준)` };
  }
  // 조직 이름이 있는 위험 질문
  if (!hit(QUIT) && !hit(RISKY)) return null;
  const org = effectiveOrgs(s)
    .map((o) => ({ o, n: orgShort(o.name).replace(/\s+/g, '') }))
    .filter((x) => x.n.length >= 2 && qn.includes(x.n))
    .sort((a, b) => b.n.length - a.n.length)[0]?.o;
  if (!org) return null;
  const r = handoverInsights(s, { kind: 'org', orgId: org.id }, asOf);
  const t = riskTotals(r.items);
  const top = r.items.filter((x) => x.level !== 'low').slice(0, 5);
  const lines: AnswerLine[] = [L(`${orgShort(org.name)}의 인계 위험: 위험 업무 ${t.works}건(항목 ${t.items}개, 높음 ${t.high}).`)];
  for (const x of top) lines.push(L(`${INSIGHT_NAMES[x.kind]} — ${x.title}: ${x.detail}${x.next ? ` · ${x.next}` : ''}`));
  if (!top.length) lines.push(L('높음·중간 위험 항목이 없습니다.'));
  const ids = [...new Set(top.flatMap((x) => x.workIds))];
  return { query: q, intent: 'risk-org', lines, evidence: [], events: [], works: ids, followups: leaderQuestions(s), scope: `업무 유니버스 인사이트 규칙으로 계산한 결과입니다(${orgShort(org.name)} 지도, ${asOf} 기준)` };
}
