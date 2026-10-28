import { FolderKanban, Activity, RefreshCw, AlertTriangle, ArrowRightLeft, FileText, ScrollText, ListTodo, History } from 'lucide-react';
import { useStore, userName } from '../lib/store';
import { useRouter } from '../lib/router';
import { Card, CardHead, Mono, Empty } from '../components/ui';
import { WorkCard } from '../components/WorkCard';
import { allIssues } from '../ai/engine';
import { daysBetween, fmtDate, relDays, cx, localDay } from '../lib/util';

export default function Dashboard() {
  const { s, raw, me } = useStore();
  const { nav } = useRouter();
  const now = new Date();
  const nowIso = now.toISOString();
  const issues = allIssues(s, now);
  const issueWorks = new Set(issues.filter((i) => i.severity !== 'low' && i.workId).map((i) => i.workId));
  const waiting = s.handovers.filter((h) => ['submitted', 'revision', 'accepted', 'draft'].includes(h.status));
  const recentWorks = s.works.filter((w) => daysBetween(w.updatedAt, nowIso) <= 30);
  const mine = s.works.filter((w) => w.owners.includes(me.id));
  const stats = [
    { label: '전체 담당 업무', value: s.works.length, sub: `내 담당 ${mine.length}건`, Icon: FolderKanban, to: '/works' },
    { label: '진행 중인 업무', value: s.works.filter((w) => w.status === '진행 중' || w.status === '운영 중').length, sub: '진행 중 · 운영 중', Icon: Activity, to: '/works?status=active' },
    { label: '최근 업데이트', value: recentWorks.length, sub: '최근 30일 갱신', Icon: RefreshCw, to: '/works?sort=updated' },
    { label: '확인 필요 업무', value: issueWorks.size, sub: 'AI 점검 결과', Icon: AlertTriangle, to: '#issues', warn: issueWorks.size > 0 },
    { label: '인계·인수 대기', value: waiting.length, sub: '확정 전 인계 건', Icon: ArrowRightLeft, to: '/handover' },
  ];
  const recentDocs = [...s.docs].sort((a, b) => b.registeredAt.localeCompare(a.registeredAt)).slice(0, 6);
  const upcoming = s.actions
    .filter((a) => a.status !== '완료')
    .sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999'))
    .slice(0, 7);
  const recentHist = [...s.history].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 7);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-xs font-medium text-muted">{fmtDate(nowIso)} 기준</p>
          <h1 className="mt-0.5 text-[22px] font-bold tracking-tight">{me.name}님의 업무 현황</h1>
        </div>
        <p className="text-xs text-muted">{me.dept}</p>
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
                    ? "이 화면에는 등록된 업무가 하나도 없음. 다른 화면(claude.ai 게시 페이지 등)에서 등록했다면 상단 '데이터 옮기기' → '불러오기'로 가져오기. 새로 시작하려면 업무 관리에서 업무 등록."
                    : `다른 사용자가 담당하는 업무 ${raw.works.length - mine.length}건이 있음. 상단 사용자 전환으로 확인 가능.`
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
          <CardHead icon={<AlertTriangle size={16} />} title="AI가 발견한 누락 · 갱신 필요 항목" sub={`${issues.length}건 · 높음 ${issues.filter((i) => i.severity === 'high').length}`} />
          <ul className="max-h-[420px] divide-y divide-line overflow-y-auto scroll-thin">
            {issues.map((i) => (
              <li key={i.id}>
                <button onClick={() => nav(i.to)} className="flex w-full gap-3 px-4 py-2.5 text-left hover:bg-sunken/60">
                  <span className={cx('mt-1 h-2 w-2 shrink-0 rounded-full', i.severity === 'high' ? 'bg-danger' : i.severity === 'mid' ? 'bg-warn' : 'bg-faint')} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium">{i.title}</span>
                    <span className="block truncate text-2xs text-muted">
                      {i.workId && <b className="font-medium text-ink/80">{s.works.find((w) => w.id === i.workId)?.name} · </b>}
                      {i.detail}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
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
          <CardHead icon={<ListTodo size={16} />} title="향후 처리해야 할 과제" />
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
