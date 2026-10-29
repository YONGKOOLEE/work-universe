import { useState } from 'react';
import { ChevronDown, ChevronRight, Orbit, FolderKanban, Activity, RefreshCw, AlertTriangle, ArrowRightLeft, FileText, ScrollText, ListTodo, History } from 'lucide-react';
import { useStore, userName } from '../lib/store';
import { useRouter } from '../lib/router';
import { Button, Card, CardHead, Mono, Empty } from '../components/ui';
import { WorkCard } from '../components/WorkCard';
import { workIssues } from '../ai/engine';
import { useAI } from '../ai/claude';
import { effectiveOrgs, myOrgScope, orgPathText } from '../lib/orgs';
import { handoverInsights, insightSummary, INSIGHT_NAMES } from '../universe/insights';
import { issueRows } from '../universe/risk';
import { daysBetween, fmtDate, relDays, cx, localDay } from '../lib/util';

export default function Dashboard() {
  const { s, raw, me } = useStore();
  const { nav } = useRouter();
  const ai = useAI();
  const claudeOn = ai.engine === 'claude' && !!ai.client;
  const now = new Date();
  const nowIso = now.toISOString();
  // 기록 점검(업무잇다 규칙) — 업무마다 빈 칸·기한·갱신. 인계 위험(업무 유니버스 규칙)은 아래 카드에 따로
  // 팀 업무는 모두 보이지만(2026-10-29) 대시보드는 내 업무 기준 — 팀장은 팀 전체
  const lead = me.role === 'lead';
  const mine = s.works.filter((w) => w.owners.includes(me.id));
  // 범위(처음 사용 점검 H-1): 팀장은 본인 소속 조직(팀이면 그 팀, 부면 그 부, 하위 포함). 예전에는 회사 전체를 「팀 전체」로 셌다
  const org = myOrgScope(s, me.id);
  const scopeName = lead ? org.name : '내 업무';
  const base = lead ? org.works : mine;
  const baseIds = new Set(base.map((w) => w.id));
  const rank = { high: 0, mid: 1, low: 2 };
  const issues = base.flatMap((w) => workIssues(s, w, now)).sort((a, b) => rank[a.severity] - rank[b.severity]);
  const insights = handoverInsights(s, lead ? (org.org ? { kind: 'org', orgId: org.org.id } : { kind: 'all' }) : { kind: 'mine', userId: me.id }, localDay(nowIso));
  const rows = issueRows(s, base, issues);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const issueWorks = new Set(issues.filter((i) => i.severity !== 'low' && i.workId).map((i) => i.workId));
  const waiting = s.handovers.filter((h) => ['submitted', 'revision', 'accepted', 'draft'].includes(h.status));
  const recentWorks = base.filter((w) => daysBetween(w.updatedAt, nowIso) <= 30);
  const stats = [
    { label: lead ? `${org.name} 업무` : '내 담당 업무', value: base.length, sub: lead ? `내 담당 ${mine.length}건` : `${org.name} 전체 ${org.works.length}건`, Icon: FolderKanban, to: '/works' },
    { label: '진행 중인 업무', value: base.filter((w) => w.status === '진행 중' || w.status === '운영 중').length, sub: '진행 중 · 운영 중', Icon: Activity, to: '/works?status=active' },
    { label: '최근 업데이트', value: recentWorks.length, sub: '최근 30일 갱신', Icon: RefreshCw, to: '/works?sort=updated' },
    { label: '확인 필요 업무', value: issueWorks.size, sub: '기록 점검 결과', Icon: AlertTriangle, to: '#issues', warn: issueWorks.size > 0 },
    { label: '인계·인수 대기', value: waiting.length, sub: '확정 전 인계 건', Icon: ArrowRightLeft, to: '/handover' },
  ];
  const recentDocs = s.docs.filter((d) => d.workIds.some((w) => baseIds.has(w)) || d.registeredBy === me.id).sort((a, b) => b.registeredAt.localeCompare(a.registeredAt)).slice(0, 6);
  const upcoming = s.actions
    .filter((a) => a.status !== '완료' && (lead ? baseIds.has(a.workId) : a.ownerId === me.id))
    .sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999'))
    .slice(0, 7);
  const recentHist = s.history.filter((h) => baseIds.has(h.workId)).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 7);

  return (
    <div className="space-y-6">
      {raw.seedMode === 'fresh' && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-brand/40 bg-brandsoft px-4 py-3" data-testid="fresh-people-guide">
          <div>
            <p className="text-[14px] font-bold">먼저 나를 등록하세요</p>
            <p className="text-xs text-muted">빈 데이터로 시작했습니다. 「사람」 화면에서 본인을 추가한 뒤 「이 사람으로 쓰기」를 누르면 그 사람으로 업무를 쌓을 수 있습니다.</p>
          </div>
          <Button variant="primary" size="sm" onClick={() => nav('/people')}>
            사람 화면으로
          </Button>
        </div>
      )}
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-xs font-medium text-muted">{fmtDate(nowIso)} 기준</p>
          <h1 className="mt-0.5 text-[22px] font-bold tracking-tight">{me.name}님의 업무 현황</h1>
          <p className="mt-1 text-[13px] text-muted" data-testid="app-oneliner">업무잇다는 문서에서 결정·일정·할 일(담당·기한)을 뽑아 업무에 쌓고, 업무 화면을 그대로 인계하며, 쌓인 업무를 「업무 유니버스」 지도로 넓게 봅니다.</p>
        </div>
        <p className="text-xs text-muted">{orgPathText(effectiveOrgs(s), me.dept)}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {stats.map((x) => (
          <button
            key={x.label}
            onClick={() => (x.to.startsWith('#') ? document.getElementById('issues')?.scrollIntoView({ behavior: 'smooth' }) : nav(x.to))}
            className="flex flex-col gap-1 rounded-lg border border-line bg-surface px-4 py-3.5 text-left shadow-card hover:border-brand/50"
          >
            <span className="flex items-center gap-1.5 text-xs font-medium text-muted">
              <x.Icon size={14} className={x.warn ? 'text-warn' : 'text-brand'} />
              {x.label}
            </span>
            <span className={cx('text-[26px] font-bold leading-none tnum', x.warn ? 'text-warn' : 'text-ink')}>{x.value}</span>
            <span className="text-2xs text-faint">{x.sub}</span>
          </button>
        ))}
      </div>

      <section className="min-w-0 space-y-3">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold">
            내가 담당하는 업무 <span className="text-xs font-normal text-muted tnum">{mine.length}건</span>
          </h2>
          {mine.length === 0 ? (
            <Card>
              <Empty
                title="담당 중인 업무가 없습니다"
                sub={
                  raw.works.length === 0
                    ? "등록된 업무가 하나도 없음. 동료가 내보낸 파일이 있으면 상단 '데이터 옮기기' → '합쳐 불러오기'로 더하기. 새로 시작하려면 업무 관리에서 업무 등록."
                    : `${org.name}의 다른 업무 ${org.works.filter((w) => !w.owners.includes(me.id)).length}건은 업무 관리 「전체」에서 볼 수 있음.`
                }
              />
            </Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {mine.map((w) => (
                <WorkCard key={w.id} w={w} />
              ))}
            </div>
          )}
      </section>

        <Card id="issues" className="min-w-0">
          <CardHead icon={<AlertTriangle size={16} />} title="기록 점검 — 빠진 항목 · 갱신 필요" sub={`${scopeName} · 확인 필요 업무 ${issueWorks.size}개 · 점검 항목 ${issues.length}건(높음 ${issues.filter((i) => i.severity === 'high').length})`} right={<span className="rounded bg-sunken px-1.5 text-2xs font-semibold text-muted" title="업무잇다 규칙으로 업무 기록의 빈 칸·기한·갱신을 점검합니다">규칙 기반</span>} />
          <ul className="max-h-[420px] divide-y divide-line overflow-y-auto scroll-thin">
            {rows.map((i) => {
              const dot = <span className={cx('mt-1 h-2 w-2 shrink-0 rounded-full', i.severity === 'high' ? 'bg-danger' : i.severity === 'mid' ? 'bg-warn' : 'bg-faint')} />;
              if (i.members) {
                const on = !!open[i.id];
                return (
                  <li key={i.id} data-testid="issue-group">
                    <button onClick={() => setOpen((v) => ({ ...v, [i.id]: !v[i.id] }))} aria-expanded={on} className="flex w-full gap-3 px-4 py-2.5 text-left hover:bg-sunken/60">
                      {dot}
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-medium">{i.title}</span>
                        <span className="block truncate text-2xs text-muted">{i.detail}</span>
                      </span>
                      {on ? <ChevronDown size={15} className="mt-0.5 shrink-0 text-muted" /> : <ChevronRight size={15} className="mt-0.5 shrink-0 text-muted" />}
                    </button>
                    {on && (
                      <ul className="border-t border-line bg-sunken/40">
                        {i.members.map((m) => (
                          <li key={m.id}>
                            <button onClick={() => nav(m.to)} className="flex w-full gap-2 px-8 py-1.5 text-left hover:bg-sunken/60">
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[12.5px]">{s.works.find((w) => w.id === m.workId)?.name}</span>
                                <span className="block truncate text-2xs text-muted">{m.detail}</span>
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              }
              return (
                <li key={i.id}>
                  <button onClick={() => nav(i.to)} className="flex w-full gap-3 px-4 py-2.5 text-left hover:bg-sunken/60">
                    {dot}
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium">{i.title}</span>
                      <span className="block truncate text-2xs text-muted">
                        {i.workId && <b className="font-medium text-ink/80">{s.works.find((w) => w.id === i.workId)?.name} · </b>}
                        {i.detail}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card className="min-w-0" data-testid="dash-insights">
          <CardHead
            icon={<Orbit size={16} />}
            title="인계 위험 인사이트"
            sub={`${scopeName} · ${insightSummary(insights)}`}
            right={<button className="text-xs text-brand" onClick={() => nav('/universe')}>지도에서 보기</button>}
          />
          <ul className="max-h-[300px] divide-y divide-line overflow-y-auto scroll-thin">
            {insights.items.slice(0, 8).map((x) => (
              <li key={x.id}>
                <button onClick={() => nav(x.workIds[0] ? `/works/${x.workIds[0]}?tab=map` : '/universe')} className="flex w-full gap-3 px-4 py-2.5 text-left hover:bg-sunken/60" data-testid="dash-insight-item">
                  <span className={cx('mt-1 h-2 w-2 shrink-0 rounded-full', x.level === 'high' ? 'bg-danger' : x.level === 'mid' ? 'bg-warn' : 'bg-faint')} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium">
                      <span className="mr-1.5 text-2xs font-semibold text-muted">{INSIGHT_NAMES[x.kind]}</span>
                      {x.title}
                    </span>
                    <span className="block truncate text-2xs text-muted">{x.detail}</span>
                    {x.next && <span className="block truncate text-2xs font-medium text-brand">{x.next}</span>}
                  </span>
                </button>
              </li>
            ))}
            {!insights.items.length && <li className="px-4 py-3 text-[13px] text-muted">{insights.notes[0] ?? '찾은 위험이 없습니다'}</li>}
          </ul>
          <p className="border-t border-line px-4 py-2 text-2xs text-faint">
            업무 유니버스의 위험 규칙(혼자만 아는 일·길목 업무·일 몰린 사람·담당자 빈 업무)으로 계산합니다. 키 없이 동작합니다.
            {claudeOn && <span data-testid="dash-insight-claude"> 업무 유니버스 지도 오른쪽 「AI로 더 찾기」로 AI가 업무 기록을 읽고 더 찾습니다.</span>}
          </p>
        </Card>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="min-w-0">
          <CardHead icon={<History size={16} />} title="최근 변경된 업무" />
          <ul className="divide-y divide-line">
            {recentHist.map((h) => (
              <li key={h.id}>
                <button onClick={() => nav(`/works/${h.workId}?tab=history`)} className="w-full px-4 py-2.5 text-left hover:bg-sunken/60">
                  <div className="flex items-center justify-between gap-2 text-2xs text-muted">
                    <span className="truncate font-medium text-ink/90">{s.works.find((w) => w.id === h.workId)?.name}</span>
                    <span className="shrink-0">{relDays(h.at)}</span>
                  </div>
                  <div className="mt-0.5 text-[13px]">
                    <span className={cx('mr-1.5 rounded px-1 text-2xs font-semibold', h.actorId === 'ai' ? 'bg-infersoft text-infer' : 'bg-sunken text-muted')}>{h.kind}</span>
                    {h.summary}
                  </div>
                  <div className="text-2xs text-faint">{userName(s, h.actorId)}</div>
                </button>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="min-w-0">
          <CardHead icon={<FileText size={16} />} title="최근 등록된 문서 · 회의록" right={<button className="text-xs text-brand" onClick={() => nav('/docs')}>문서함</button>} />
          <ul className="divide-y divide-line">
            {recentDocs.map((d) => (
              <li key={d.id}>
                <button onClick={() => nav(`/docs/${d.id}`)} className="w-full px-4 py-2.5 text-left hover:bg-sunken/60">
                  <div className="flex items-start gap-2">
                    {d.type === '회의록' ? <ScrollText size={15} className="mt-0.5 shrink-0 text-brand" /> : <FileText size={15} className="mt-0.5 shrink-0 text-muted" />}
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium leading-snug">{d.title}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-2xs text-muted">
                        <span>{d.type}</span>
                        <span>등록 {relDays(d.registeredAt)}</span>
                      </div>
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="min-w-0">
          <CardHead icon={<ListTodo size={16} />} title={lead ? `${org.name}의 처리해야 할 과제` : '내가 처리해야 할 과제'} />
          <ul className="divide-y divide-line">
            {upcoming.map((a) => {
              const od = a.due && a.due < localDay(nowIso);
              return (
                <li key={a.id}>
                  <button onClick={() => nav(`/works/${a.workId}?tab=actions`)} className="w-full px-4 py-2.5 text-left hover:bg-sunken/60">
                    <div className="text-[13px] leading-snug">{a.title}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-2xs text-muted">
                      <span className={cx('font-semibold tnum', od ? 'text-danger' : a.due ? 'text-ink/80' : 'text-warn')}>{a.due ? `${fmtDate(a.due)}${od ? ' · 기한 경과' : ''}` : '기한 미지정'}</span>
                      <Mono>{a.workId}</Mono>
                      <span>{userName(s, a.ownerId)}</span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>
    </div>
  );
}
