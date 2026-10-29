// 팀장 눈 보강(처음 사용 점검 H-2·H-3·M-1·M-8·M-11): 전출·퇴직 반영, 업무 이름·인계 후보, 한눈에 문장, 규칙 검색, 기록 점검 묶기
import { describe, expect, it } from 'vitest';
import { createSeed } from '../src/data/seed';
import { handoverInsights, insightSummary, namesText, personImpact, riskTotals } from '../src/universe/insights';
import { flowInsights, overview } from '../src/universe/flowInsights';
import { deriveMap } from '../src/universe/derive';
import { issueRows } from '../src/universe/risk';
import { allIssues, askAI, SAMPLE_QUESTIONS, workIssues } from '../src/ai/engine';
import { leaderQuestions, sampleQuestions } from '../src/ai/workAnswer';

const AS_OF = '2026-10-29';
const NOW = new Date('2026-10-29T09:00:00Z');
const ALL = { kind: 'all' as const };
const fresh = () => createSeed('linked', NOW);
const leftHajun = () => {
  const s = fresh();
  s.users.find((u) => u.id === 'U5')!.status = 'left'; // 정하준
  return s;
};

describe('H-2 전출·퇴직 → 위험 반영', () => {
  it('정하준을 전출·퇴직 처리하면 담당자 빈 업무가 1건에서 3건으로(월 정산·개선 요구사항 정리가 늘어남)', () => {
    const before = handoverInsights(fresh(), ALL, AS_OF);
    const after = handoverInsights(leftHajun(), ALL, AS_OF);
    expect(before.counts.gap).toBe(1);
    expect(after.counts.gap).toBe(3);
    const added = after.items.filter((x) => x.kind === 'gap').map((x) => x.workIds[0]).filter((id) => id !== 'W-010').sort();
    expect(added).toEqual(['W-004', 'W-009']);
    expect(after.items.find((x) => x.kind === 'gap' && x.workIds[0] === 'W-004')!.detail).toContain('정하준 전출·퇴직');
  });
  it('공동 담당(W-008 정하준·윤재민)은 남은 사람 기준으로 다시 계산 → 윤재민만 아는 일, 정하준 일 몰린·빠지면 막히는 사람 항목은 사라짐', () => {
    const after = handoverInsights(leftHajun(), ALL, AS_OF);
    expect(after.items.some((x) => x.kind === 'solo' && x.workIds[0] === 'W-008' && x.detail.startsWith('윤재민'))).toBe(true);
    expect(after.counts.dense).toBe(0);
    expect(after.items.some((x) => x.kind === 'sole_person' && x.userIds[0] === 'U5')).toBe(false);
  });
  it('한눈에 문장·대시보드 요약이 바뀐다', () => {
    const s0 = fresh();
    const s1 = leftHajun();
    const ov = (s: typeof s0) => overview(s, ALL, handoverInsights(s, ALL, AS_OF), flowInsights(s, ALL, AS_OF));
    expect(ov(s0).text).not.toBe(ov(s1).text);
    expect(ov(s1).text).toContain('전출·퇴직한 정하준의 업무 2개가 담당 없이 남았습니다');
    expect(ov(s1).people[0].name).not.toBe('정하준'); // 가장 많이 맡은 사람에서 빠짐
    expect(insightSummary(handoverInsights(s0, ALL, AS_OF))).not.toBe(insightSummary(handoverInsights(s1, ALL, AS_OF)));
  });
  it('지도: 떠난 사람은 현 담당 선이 없고 이름에 꼬리표가 붙는다', () => {
    const s = leftHajun();
    const d = deriveMap(s, ALL, undefined, { actions: false });
    for (const doc of d.docs.values()) {
      const ids = doc.nodes.filter((n) => d.origin.get(`${doc.universe.id}/${n.id}`)?.id === 'U5');
      for (const n of ids) {
        expect(n.label).toContain('전출·퇴직');
        expect(doc.edges.some((e) => e.core_type === 'performs' && e.source === n.id && !e.period?.end)).toBe(false);
      }
    }
  });
  it('인계 후보·유사 경험자에 떠난 사람은 안 나온다', () => {
    const s = leftHajun();
    const text = JSON.stringify([...handoverInsights(s, ALL, AS_OF).items.map((x) => x.next), ...flowInsights(s, ALL, AS_OF).items.filter((x) => x.kind === 'similar').map((x) => x.detail)]);
    expect(text).not.toContain('정하준');
  });
  it('복귀(status 없음)하면 원래대로', () => {
    const s = leftHajun();
    s.users.find((u) => u.id === 'U5')!.status = 'active';
    expect(handoverInsights(s, ALL, AS_OF).counts.gap).toBe(1);
  });
});

describe('M-1 업무 이름과 다음 행동', () => {
  const r = handoverInsights(fresh(), ALL, AS_OF);
  it('빠지면 함께 막히는 사람 항목에 막히는 업무 이름이 있다', () => {
    const x = r.items.find((i) => i.kind === 'sole_person' && i.userIds[0] === 'U5')!;
    expect(x.detail).toContain('「출금이체 수수료 정산 대사」');
    expect(x.blockedWorkIds).toEqual(['W-008']);
  });
  it('이름은 최대 3개 + 외 n개', () => {
    expect(namesText(['가', '나', '다', '라', '마'])).toBe('「가」, 「나」, 「다」 외 2개');
    expect(namesText(['가', '나'])).toBe('「가」, 「나」');
  });
  it('사람·업무 위험 항목에 인계 후보 한 줄(후보가 없으면 없음)', () => {
    const x = r.items.find((i) => i.kind === 'sole_person' && i.userIds[0] === 'U5')!;
    expect(x.next).toBe('인계 후보: 윤재민(비슷한 일 경험), 문태오(비슷한 일 경험)');
    expect(r.items.find((i) => i.kind === 'gap')!.next).toContain('강예린(이전 담당)');
    expect(r.items.find((i) => i.kind === 'solo' && i.title === '접근권한 정기 점검')!.next).toBeUndefined();
    for (const i of r.items) if (i.next) expect(i.next.startsWith('인계 후보: ')).toBe(true);
  });
  it('한눈에: 가장 위험한 건을 문장으로 + 짧은 숫자', () => {
    const s = fresh();
    const ov = overview(s, ALL, handoverInsights(s, ALL, AS_OF), flowInsights(s, ALL, AS_OF));
    expect(ov.text).toContain('정하준이 빠지면 업무 3개가 막힙니다 · 인계 준비 3/6');
    expect(ov.text).toMatch(/업무 15개 · 위험 업무 \d+건\(항목 \d+개, 높음 \d+\)$/);
  });
  it('M-8 숫자 단위: 위험 업무 수와 항목 수를 따로 센다', () => {
    const s = fresh();
    const all = [...handoverInsights(s, ALL, AS_OF).items, ...flowInsights(s, ALL, AS_OF).items];
    const t = riskTotals(all);
    expect(t.items).toBe(all.length);
    expect(t.works).toBeLessThanOrEqual(s.works.length);
    expect(t.works).toBeGreaterThan(0);
    expect(insightSummary(handoverInsights(s, ALL, AS_OF))).toMatch(/^위험 업무 \d+건\(항목 \d+개\) · /);
  });
});

describe('개인 영향(personImpact)', () => {
  it('정하준: 혼자 맡은 2개 + 이어서 막히는 1개 = 3개, 후보·준비도', () => {
    const p = personImpact(fresh(), 'U5', AS_OF)!;
    expect(p.soleWorks.map((w) => w.id).sort()).toEqual(['W-004', 'W-009']);
    expect(p.blocked.map((w) => w.id)).toEqual(['W-008']);
    expect(p.candidates.map((c) => c.name)).toEqual(['윤재민', '문태오']);
    expect(p.readiness.length).toBe(3);
  });
  it('업무 유니버스 규칙의 「빠지면 막히는 사람」 결과와 같다', () => {
    const s = fresh();
    const r = handoverInsights(s, ALL, AS_OF);
    for (const x of r.items.filter((i) => i.kind === 'sole_person')) {
      const p = personImpact(s, x.userIds[0], AS_OF)!;
      expect(p.blocked.map((w) => w.id).sort()).toEqual([...(x.blockedWorkIds ?? [])].sort());
    }
  });
  it('없는 사람은 null', () => expect(personImpact(fresh(), 'U-NONE', AS_OF)).toBeNull());
});

describe('H-3 규칙 검색이 사람·위험 질문에 답', () => {
  const s = fresh();
  const text = (q: string) => {
    const a = askAI(s, q);
    return { a, t: a.lines.map((l) => l.text).join('\n') };
  };
  it('「정하준이 빠지면 무엇이 막히나요?」 → 그의 업무 3개·혼자 맡은 일·막히는 업무·후보·준비도', () => {
    const { a, t } = text('정하준이 빠지면 무엇이 막히나요?');
    expect(a.intent).toBe('risk-person');
    expect(t).toContain('맡은 진행 중 업무 3개');
    for (const n of ['출금이체 월 정산', '출금이체 수수료 정산 대사', '정산 시스템 개선 요구사항 정리']) expect(t).toContain(n);
    expect(t).toContain('빠지면 담당이 비는 업무(혼자만 맡은 일) 2개');
    expect(t).toContain('이어서 함께 막히는 업무 1개');
    expect(t).toContain('인계 후보: 윤재민(비슷한 일 경험), 문태오(비슷한 일 경험)');
    expect(t).toContain('인계 준비도');
    expect(a.lines.every((l) => l.prov === 'fact')).toBe(true);
    expect(a.works).toEqual(expect.arrayContaining(['W-004', 'W-008', 'W-009']));
  });
  it('「김도윤 담당 업무 중 위험한 것은?」도 사람 답', () => {
    const { a, t } = text('김도윤 담당 업무 중 위험한 것은?');
    expect(a.intent).toBe('risk-person');
    expect(t).toContain('비대면 출금동의 추진');
  });
  it('조직 이름이 있는 위험 질문', () => {
    const { a, t } = text('디지털신원팀에서 인계 위험이 큰 업무는?');
    expect(a.intent).toBe('risk-org');
    expect(t).toContain('디지털신원팀');
    expect(t).toMatch(/위험 업무 \d+건\(항목 \d+개/);
    expect(a.works.length).toBeGreaterThan(0);
  });
  it('이미 전출·퇴직한 사람은 그렇다고 알린다', () => {
    const a = askAI(leftHajun(), '정하준이 빠지면 무엇이 막히나요?');
    expect(a.lines[0].text).toContain('이미 전출·퇴직');
    expect(a.lines.map((l) => l.text).join('\n')).toContain('담당이 비어 있는 업무(혼자만 맡은 일) 2개');
  });
  it('기존 업무 질문은 그대로', () => {
    expect(askAI(s, '출금동의 업무의 추진 배경은?').intent).toBe('work-why');
    expect(askAI(s, '출금동의 업무의 향후 조치사항은?').intent).toBe('work-actions');
  });
  it('답할 수 없는 질문에는 인사이트 안내', () => {
    const a = askAI(s, '내일 점심 메뉴는 무엇인가요');
    expect(a.lines.map((l) => l.text).join('\n')).toContain('업무 유니버스 인사이트');
  });
  it('예시 질문에 팀장용 문장', () => {
    expect(SAMPLE_QUESTIONS).toContain('정하준이 빠지면 무엇이 막히나요?');
    expect(SAMPLE_QUESTIONS).toContain('디지털신원팀에서 인계 위험이 큰 업무는?');
    expect(leaderQuestions(s)).toEqual(['정하준이 빠지면 무엇이 막히나요?', '디지털신원팀에서 인계 위험이 큰 업무는?']);
    expect(sampleQuestions(s, SAMPLE_QUESTIONS).length).toBe(6);
  });
});

describe('M-11 대시보드 기록 점검 묶기', () => {
  const s = fresh();
  const issues = s.works.flatMap((w) => workIssues(s, w, NOW));
  const rows = issueRows(s, s.works, issues);
  it('필수 항목 미작성은 「제목: 업무 n개」 한 줄로 묶고 펼치면 업무별 항목이 있다', () => {
    const em = issues.filter((i) => i.id.endsWith('-em'));
    const g = rows.find((r) => r.id === 'group-em')!;
    expect(em.length).toBeGreaterThan(1);
    expect(g.title).toBe(`필수 항목 미작성: 업무 ${em.length}개`);
    expect(g.members!.length).toBe(em.length);
    expect(rows.some((r) => r.title.startsWith('필수 항목 미작성 '))).toBe(false);
  });
  it('진짜 위험(기한 경과·담당자 빈 업무)이 묶음보다 위에 있다', () => {
    const iGroup = rows.findIndex((r) => r.id === 'group-em');
    const od = rows.findIndex((r) => r.id.endsWith('-od'));
    const empty = rows.findIndex((r) => r.title === '담당자 빈 업무');
    expect(empty).toBeGreaterThanOrEqual(0);
    if (od >= 0) expect(od).toBeLessThan(iGroup);
    expect(empty).toBeLessThan(iGroup);
  });
  it('전출·퇴직 담당 업무가 위에 올라온다', () => {
    const s2 = leftHajun();
    const r2 = issueRows(s2, s2.works, s2.works.flatMap((w) => workIssues(s2, w, NOW)));
    const left = r2.filter((r) => r.id.endsWith('-left'));
    expect(left.map((r) => r.workId).sort()).toEqual(['W-004', 'W-008', 'W-009']);
    expect(left.find((r) => r.workId === 'W-004')!.title).toContain('담당자 빈 업무');
    expect(left.find((r) => r.workId === 'W-008')!.detail).toContain('남은 담당 윤재민');
    expect(r2.findIndex((r) => r.id.endsWith('-left'))).toBeLessThan(r2.findIndex((r) => r.id === 'group-em'));
  });
  it('업무 하나의 점검(workIssues)은 그대로', () => {
    const w = s.works.find((x) => workIssues(s, x, NOW).some((i) => i.id.endsWith('-em')))!;
    expect(workIssues(s, w, NOW).find((i) => i.id.endsWith('-em'))!.title).toMatch(/^필수 항목 미작성 \d+개$/);
    expect(allIssues(s, NOW).length).toBeGreaterThan(0);
  });
});
