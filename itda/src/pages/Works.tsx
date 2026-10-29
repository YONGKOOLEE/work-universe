import { openNewWork } from '../lib/newWork';
import { useEffect, useMemo, useState } from 'react';
import { Plus, Search, ListTree, LayoutGrid, CornerDownRight } from 'lucide-react';
import { useStore, ownerNames } from '../lib/store';
import { useRouter } from '../lib/router';
import { Button, Card, StatusBadge, Mono, inputCls, Empty } from '../components/ui';
import { WorkCard } from '../components/WorkCard';
import { WORK_STATUSES, type Work } from '../lib/types';
import { workIssues } from '../ai/engine';
import { fmtDate, cx } from '../lib/util';
import { effectiveOrgs, myOrgChain, orgShort, orgTree, subtreeNames } from '../lib/orgs';

export default function Works() {
  const { s, me } = useStore();
  const { query, nav } = useRouter();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<string>(query.get('status') === 'active' ? 'active' : 'all');
  // 팀 업무는 모두 보이지만(2026-10-29) 처음에는 — 조직장은 자기 소속 조직(아래 조직 포함)의 업무, 팀원은 내 업무.
  // 소속 조직을 찾을 수 없는 조직장은 팀원처럼 내 업무로 시작한다
  const myOrgId = myOrgChain(s, me.id)[0]?.id ?? 'all';
  const leadStart = me.role === 'lead' && myOrgId !== 'all';
  const [owner, setOwner] = useState(leadStart ? 'all' : me.id);
  const [orgId, setOrgId] = useState(leadStart ? myOrgId : 'all');
  const [sort, setSort] = useState(query.get('sort') === 'updated' ? 'updated' : 'tree');
  const orgs = useMemo(() => effectiveOrgs(s), [s]);
  const tree = useMemo(() => orgTree(orgs), [orgs]);
  const [view, setView] = useState<'table' | 'cards'>('table');
  useEffect(() => {
    setOwner(leadStart ? 'all' : me.id);
    setOrgId(leadStart ? myOrgId : 'all');
  }, [me.id, me.role]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (query.get('new') === '1') openNewWork();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 조직 명령(이름 바꾸기 등)으로 자동 팀 ID가 사라지면 고른 조직이 없는 ID가 되므로 「전체」로 되돌린다
  useEffect(() => {
    if (orgId !== 'all' && !orgs.some((o) => o.id === orgId)) setOrgId('all');
  }, [orgs, orgId]);
  const orgNames = useMemo(() => (orgId === 'all' ? null : subtreeNames(orgs, orgId)), [orgs, orgId]);
  const filtered = useMemo(() => {
    const t = q.trim();
    return s.works.filter(
      (w) =>
        (!t || [w.name, w.summary, w.id, ...w.keywords].join(' ').includes(t)) &&
        (status === 'all' || (status === 'active' ? w.status === '진행 중' || w.status === '운영 중' : w.status === status)) &&
        (owner === 'all' || w.owners.includes(owner)) &&
        (!orgNames || orgNames.has(String(w.dept || '').trim())),
    );
  }, [s.works, q, status, owner, orgNames]);

  const ordered: { w: Work; depth: number }[] = useMemo(() => {
    if (sort === 'updated') return [...filtered].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((w) => ({ w, depth: 0 }));
    if (sort === 'name') return [...filtered].sort((a, b) => a.name.localeCompare(b.name, 'ko')).map((w) => ({ w, depth: 0 }));
    if (sort === 'status') return [...filtered].sort((a, b) => WORK_STATUSES.indexOf(a.status) - WORK_STATUSES.indexOf(b.status)).map((w) => ({ w, depth: 0 }));
    // 계층 순
    const ids = new Set(filtered.map((w) => w.id));
    const out: { w: Work; depth: number }[] = [];
    const walk = (pid: string | null, depth: number) => {
      s.works
        .filter((w) => w.parentId === pid)
        .sort((a, b) => a.id.localeCompare(b.id))
        .forEach((w) => {
          if (ids.has(w.id)) out.push({ w, depth });
          walk(w.id, depth + 1);
        });
    };
    walk(null, 0);
    filtered.forEach((w) => !out.find((o) => o.w.id === w.id) && out.push({ w, depth: 0 }));
    return out;
  }, [filtered, sort, s.works]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight">업무 관리</h1>
          <p className="text-[13px] text-muted">문서가 아닌 업무 단위로 배경·경과·결정·향후 조치를 관리합니다.</p>
        </div>
        <Button variant="primary" onClick={openNewWork}>
          <Plus size={16} />
          업무 등록
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[13px]" role="tablist" aria-label="업무 범위">
        {[
          { id: me.id, label: `내 업무 ${s.works.filter((w) => w.owners.includes(me.id)).length}` },
          { id: 'all', label: `전체 ${s.works.length}` },
        ].map((c) => (
          <button key={c.id} role="tab" aria-selected={owner === c.id} onClick={() => setOwner(c.id)} className={cx('rounded-full border px-3 py-1 font-medium', owner === c.id ? 'border-brand bg-brand text-onbrand' : 'border-line bg-surface text-muted hover:text-ink')} data-testid={`works-scope-${c.id === 'all' ? 'all' : 'mine'}`}>
            {c.label}
          </button>
        ))}
        <span className="text-2xs text-faint">남의 업무는 열어 볼 수 있고, 고치기는 담당자와 자기 조직 범위의 조직장이 합니다.</span>
      </div>

      <Card className="flex flex-wrap items-center gap-2 p-3">
        <div className="relative min-w-[200px] flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input id="works-q" className={cx(inputCls, 'pl-9')} placeholder="업무명, ID, 키워드 검색" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select id="works-status" className={cx(inputCls, '!w-auto')} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="상태 필터">
          <option value="all">전체 상태</option>
          <option value="active">진행·운영 중</option>
          {WORK_STATUSES.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
        <select id="works-owner" className={cx(inputCls, '!w-auto')} value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="담당자 필터">
          <option value="all">전체 담당자</option>
          {s.users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <select id="works-org" className={cx(inputCls, '!w-auto')} value={orgId} onChange={(e) => setOrgId(e.target.value)} aria-label="조직">
          <option value="all">전체 조직</option>
          {tree.map(({ org, depth }) => (
            <option key={org.id} value={org.id}>
              {'  '.repeat(depth)}
              {orgShort(org.name)} ({org.level})
            </option>
          ))}
        </select>
        <select id="works-sort" className={cx(inputCls, '!w-auto')} value={sort} onChange={(e) => setSort(e.target.value)} aria-label="정렬">
          <option value="tree">업무 계층순</option>
          <option value="updated">최근 갱신순</option>
          <option value="name">업무명순</option>
          <option value="status">상태순</option>
        </select>
        <div className="flex rounded-md border border-line2">
          <button className={cx('p-2', view === 'table' ? 'bg-sunken text-ink' : 'text-faint')} onClick={() => setView('table')} aria-label="목록 보기">
            <ListTree size={16} />
          </button>
          <button className={cx('p-2', view === 'cards' ? 'bg-sunken text-ink' : 'text-faint')} onClick={() => setView('cards')} aria-label="카드 보기">
            <LayoutGrid size={16} />
          </button>
        </div>
      </Card>

      {ordered.length === 0 ? (
        <Card>
          <Empty title="조건에 맞는 업무가 없습니다" sub="검색어나 필터를 바꿔 보세요." />
        </Card>
      ) : view === 'cards' ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {ordered.map(({ w }) => (
            <WorkCard key={w.id} w={w} />
          ))}
        </div>
      ) : (
        <Card className="overflow-x-auto scroll-thin">
          <table className="w-full min-w-[820px] text-[13px]">
            <thead>
              <tr className="border-b border-line bg-sunken/60 text-left text-xs text-muted">
                <th className="px-4 py-2.5 font-semibold">업무명</th>
                <th className="px-3 py-2.5 font-semibold">상태</th>
                <th className="px-3 py-2.5 font-semibold">담당</th>
                <th className="px-3 py-2.5 font-semibold">문서</th>
                <th className="px-3 py-2.5 font-semibold">미완료 조치</th>
                <th className="px-3 py-2.5 font-semibold">기록 점검</th>
                <th className="px-3 py-2.5 font-semibold">최근 갱신</th>
              </tr>
            </thead>
            <tbody>
              {ordered.map(({ w, depth }) => {
                const iss = workIssues(s, w);
                const high = iss.filter((i) => i.severity === 'high').length;
                const mid = iss.filter((i) => i.severity === 'mid').length;
                return (
                  <tr key={w.id} className="cursor-pointer border-b border-line last:border-0 hover:bg-sunken/50" onClick={() => nav(`/works/${w.id}`)}>
                    <td className="px-4 py-3">
                      <div className="flex items-start gap-1.5" style={{ paddingLeft: depth * 20 }}>
                        {depth > 0 && <CornerDownRight size={13} className="mt-1 shrink-0 text-faint" />}
                        <div className="min-w-0">
                          <div className="font-semibold">{w.name}</div>
                          <div className="flex gap-2 text-2xs text-muted">
                            <Mono>{w.id}</Mono>
                            <span>{w.type}</span>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <StatusBadge status={w.status} />
                    </td>
                    <td className="px-3 py-3">{ownerNames(s, w.owners)}</td>
                    <td className="px-3 py-3 tnum">{s.docs.filter((d) => d.workIds.includes(w.id)).length}</td>
                    <td className="px-3 py-3 tnum">{s.actions.filter((a) => a.workId === w.id && a.status !== '완료').length}</td>
                    <td className="px-3 py-3">
                      <div className="flex gap-1">
                        {high > 0 && <span className="rounded bg-dangersoft px-1.5 text-2xs font-semibold text-danger">높음 {high}</span>}
                        {mid > 0 && <span className="rounded bg-warnsoft px-1.5 text-2xs font-semibold text-warn">보통 {mid}</span>}
                        {!high && !mid && <span className="text-2xs text-faint">—</span>}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-muted tnum">{fmtDate(w.updatedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
