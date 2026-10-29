// 지도 위험 점검 → 업무잇다 점검 목록(CR-24 D24-6 c). 대시보드 「AI가 발견한 누락·갱신 필요 항목」이 같은 목록으로 보여 준다.
// 업무 유니버스 규칙(view/space-marks.js soloWorks = rules/insight-risk.js knowledgeConcentration)을 그대로 쓰고, 할 일은 빼고 업무만 센다.
import type { AppState, Work } from '../lib/types';
import type { Issue } from '../ai/engine';
import { isLeft } from '../lib/people';
import { deriveMap } from './derive';
// @ts-expect-error 유니버스 순수 모듈(JS)
import { buildView } from '../../../app/src/view/view.js';
// @ts-expect-error 유니버스 순수 모듈(JS)
import { soloWorks } from '../../../app/src/view/space-marks.js';

export interface MapRisk {
  id: string;
  workId: string;
  severity: 'mid';
  title: string;
  detail: string;
  to: string;
}

/** 혼자만 아는 업무(지금까지 한 사람만 담당해 본 업무). asOf: YYYY-MM-DD */
export function mapRiskIssues(s: AppState, asOf: string): MapRisk[] {
  if (!s.works.length) return [];
  const d = deriveMap(s, { kind: 'all' }, undefined, { actions: false });
  const view = buildView(d.doc, d.resolve);
  const out: MapRisk[] = [];
  for (const g of soloWorks(view, asOf) as Iterable<string>) {
    const n = view.getNode(g);
    const o = [g, ...(n?.merged_from || [])].map((x: string) => d.origin.get(x)).find((x) => x?.kind === 'work');
    const w = o && s.works.find((x) => x.id === o.id);
    if (!w || out.some((x) => x.workId === w.id)) continue;
    const who = w.owners.map((u) => s.users.find((x) => x.id === u)?.name ?? u).join('·');
    out.push({ id: `${w.id}-solo`, workId: w.id, severity: 'mid', title: '혼자만 아는 업무', detail: `${who || '담당자'}만 담당해 본 업무 — 인계 대비 필요(업무 유니버스 위험 점검)`, to: `/works/${w.id}?tab=map` });
  }
  return out;
}

// ── 대시보드 기록 점검 묶기(처음 사용 점검 M-11) ─────────────────────────────

export interface IssueRow {
  id: string;
  severity: 'high' | 'mid' | 'low';
  title: string;
  detail: string;
  to: string;
  workId?: string;
  members?: Issue[]; // 묶음이면 묶인 업무별 점검 항목(펼치면 보임)
}

/** 업무마다 같은 문장이 되풀이되는 점검 종류(Issue.id 끝 부분 → 묶음 제목). 기한 경과(-od)는 진짜 위험이라 묶지 않는다 */
const GROUP_TITLES: Record<string, string> = {
  em: '필수 항목 미작성',
  ref: '원문 근거 없는 타임라인 이벤트',
  why: '결정 세부 근거 미기재',
  nd: '기한 미지정 조치사항',
  st: '90일 넘게 업무정보 갱신 없음',
};
/** 같은 종류가 이 개수 이상이면 한 줄로 묶는다 */
export const GROUP_MIN = 2;
const kindOf = (i: Issue) => i.id.slice(i.id.lastIndexOf('-') + 1);
const RANK = { high: 0, mid: 1, low: 2 } as const;

/**
 * 기록 점검 목록: ① 진짜 위험(기한 경과·담당자 빈 업무·전출·퇴직 담당)을 맨 위에 개별로 ② 같은 문장이 되풀이되는 항목은 「제목: 업무 n개」 한 줄로 묶음 ③ 나머지.
 * works: 점검 범위의 업무. 업무 하나의 점검(workIssues)은 그대로 두고 대시보드 목록만 이렇게 바꾼다
 */
export function issueRows(s: AppState, works: Work[], issues: Issue[]): IssueRow[] {
  const urgent: IssueRow[] = [];
  const nameOf = (id: string) => s.users.find((u) => u.id === id)?.name ?? id;
  const isGone = (id: string) => isLeft(s.users.find((u) => u.id === id));
  for (const w of works) {
    if (w.status === '완료') continue;
    const gone = w.owners.filter(isGone);
    const stays = w.owners.filter((o) => !isGone(o));
    if (gone.length) {
      urgent.push({
        id: `${w.id}-left`,
        severity: 'high',
        title: stays.length ? '전출·퇴직 담당자가 있는 업무' : '담당자 빈 업무(담당자 전출·퇴직)',
        detail: `${gone.map(nameOf).join('·')} 전출·퇴직 — ${stays.length ? `남은 담당 ${stays.map(nameOf).join('·')}` : '지금 담당 없음'}`,
        to: `/works/${w.id}`,
        workId: w.id,
      });
    } else if (!w.owners.length) {
      urgent.push({ id: `${w.id}-noowner`, severity: 'high', title: '담당자 빈 업무', detail: '담당자가 지정되지 않음', to: `/works/${w.id}`, workId: w.id });
    }
  }
  const rest: Issue[] = [];
  for (const i of issues) {
    if (kindOf(i) === 'od') urgent.push({ id: i.id, severity: i.severity, title: i.title, detail: i.detail, to: i.to, workId: i.workId });
    else rest.push(i);
  }
  const byKind = new Map<string, Issue[]>();
  for (const i of rest) byKind.set(kindOf(i), [...(byKind.get(kindOf(i)) ?? []), i]);
  const groups: IssueRow[] = [];
  const singles: IssueRow[] = [];
  for (const [k, list] of byKind) {
    if (GROUP_TITLES[k] && list.length >= GROUP_MIN) {
      const names = list.slice(0, 3).map((i) => s.works.find((w) => w.id === i.workId)?.name ?? i.workId);
      const sev = list.map((i) => i.severity).sort((a, b) => RANK[a] - RANK[b])[0];
      groups.push({ id: `group-${k}`, severity: sev, title: `${GROUP_TITLES[k]}: 업무 ${new Set(list.map((i) => i.workId)).size}개`, detail: `${names.join(', ')}${list.length > 3 ? ` 외 ${list.length - 3}개` : ''}`, to: list[0].to, members: list });
    } else for (const i of list) singles.push({ id: i.id, severity: i.severity, title: i.title, detail: i.detail, to: i.to, workId: i.workId });
  }
  const bySev = (a: IssueRow, b: IssueRow) => RANK[a.severity] - RANK[b.severity];
  return [...urgent.sort(bySev), ...[...groups, ...singles].sort(bySev)];
}
