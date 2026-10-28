import { NEW_WORK, openNewWork } from '../lib/newWork';
import { useEffect, useMemo, useState } from 'react';
import { Plus, Search, ScrollText, FileText, FolderOpen, ExternalLink } from 'lucide-react';
import { useStore, useFocus } from '../lib/store';
import { useRouter } from '../lib/router';
import { Button, Card, inputCls, Empty, StatusBadge, Mono } from '../components/ui';
import { ownerNames } from '../lib/store';
import type { Work } from '../lib/types';
import { DocRegisterModal } from '../components/DocRegisterModal';
import { DOC_TYPES } from '../lib/types';
import { fmtDate, cx, dateKey } from '../lib/util';

export default function Docs() {
  const { s } = useStore();
  const { query, nav } = useRouter();
  const [q, setQ] = useState('');
  const [type, setType] = useState('all');
  // 선택 업무는 업무 관리·타임라인·회의록과 공유 ('연결 업무 없음'만 문서함 전용)
  const [focus, setFocus] = useFocus();
  const [noneSel, setNoneSel] = useState(false);
  const work = noneSel ? 'none' : focus;
  const setWork = (v: string) => {
    if (v === 'none') setNoneSel(true);
    else {
      setNoneSel(false);
      setFocus(v);
    }
  };
  useEffect(() => {
    const qw = query.get('work');
    if (qw) setWork(qw);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [open, setOpen] = useState(query.get('new') === '1');
  const [withSub, setWithSub] = useState(false);

  // 업무 계층 순서 (상위 → 하위)
  const tree = useMemo(() => {
    const out: { w: Work; depth: number }[] = [];
    const walk = (pid: string | null, depth: number) =>
      s.works
        .filter((w) => w.parentId === pid)
        .sort((a, b) => a.id.localeCompare(b.id))
        .forEach((w) => {
          out.push({ w, depth });
          walk(w.id, depth + 1);
        });
    walk(null, 0);
    s.works.forEach((w) => !out.some((o) => o.w.id === w.id) && out.push({ w, depth: 0 }));
    return out;
  }, [s.works]);
  const descendants = (id: string): string[] => s.works.filter((w) => w.parentId === id).flatMap((w) => [w.id, ...descendants(w.id)]);
  const selected = s.works.find((w) => w.id === work);
  const hasSub = !!selected && descendants(selected.id).length > 0;
  const scope = selected ? (withSub ? [selected.id, ...descendants(selected.id)] : [selected.id]) : [];
  const countOf = (id: string) => s.docs.filter((d) => d.workIds.includes(id)).length;

  const list = useMemo(
    () =>
      s.docs
        .filter(
          (d) =>
            (!q.trim() || [d.title, d.source, ...d.summary].join(' ').includes(q.trim())) &&
            (type === 'all' || d.type === type) &&
            (work === 'all' || (work === 'none' ? d.workIds.length === 0 : d.workIds.some((w) => scope.includes(w)))),
        )
        .sort((a, b) => dateKey(b.writtenAt || '0').localeCompare(dateKey(a.writtenAt || '0'))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s.docs, q, type, work, withSub],
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight">문서함</h1>
          <p className="text-[13px] text-muted">모든 문서는 업무에 연결되어 관리됩니다. 원문 확보 여부를 함께 표시합니다.</p>
        </div>
        <Button variant="primary" onClick={() => setOpen(true)}>
          <Plus size={16} />
          문서 등록
        </Button>
      </div>
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="docs-work" className="flex items-center gap-1.5 text-[13px] font-semibold text-navy">
            <FolderOpen size={16} className="text-brand" />
            업무 선택
          </label>
          <select id="docs-work" className={cx(inputCls, 'min-w-0 flex-1 text-[14px] font-medium sm:max-w-[460px]')} value={work} onChange={(e) => (e.target.value === NEW_WORK ? openNewWork() : setWork(e.target.value))}>
            <option value="all">전체 업무 ({s.docs.length})</option>
            {tree.map(({ w, depth }) => (
              <option key={w.id} value={w.id}>
                {'\u00a0\u00a0\u00a0'.repeat(depth)}
                {depth ? '└ ' : ''}
                {w.name} ({countOf(w.id)})
              </option>
            ))}
            <option value="none">연결 업무 없음 ({s.docs.filter((d) => d.workIds.length === 0).length})</option>
            <option value={NEW_WORK}>＋ 새 업무 등록…</option>
          </select>
          {hasSub && (
            <label className="flex items-center gap-1.5 text-xs text-muted">
              <input type="checkbox" className="accent-[rgb(var(--brand))]" checked={withSub} onChange={(e) => setWithSub(e.target.checked)} />
              하위 업무 문서 포함
            </label>
          )}
        </div>
        {selected && (
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line pt-3 text-xs text-muted">
            <StatusBadge status={selected.status} />
            <Mono>{selected.id}</Mono>
            <span>담당 {ownerNames(s, selected.owners)}</span>
            <span className="tnum">문서 {list.length}건</span>
            {selected.parentId && <span>상위: {s.works.find((w) => w.id === selected.parentId)?.name}</span>}
            <button className="ml-auto inline-flex items-center gap-1 font-medium text-brand hover:underline" onClick={() => nav(`/works/${selected.id}?tab=docs`)}>
              업무 상세 보기 <ExternalLink size={11} />
            </button>
          </div>
        )}
        {work === 'none' && <p className="mt-3 border-t border-line pt-3 text-xs text-muted">어느 업무에도 연결되지 않은 문서입니다. AI가 관련 업무 없음으로 판단한 문서(예: 업무와 무관한 회의록)도 여기에 표시됩니다.</p>}
      </Card>

      <Card className="flex flex-wrap items-center gap-2 p-3">
        <div className="relative min-w-[200px] flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input id="docs-q" className={cx(inputCls, 'pl-9')} placeholder="문서명, 출처, 요약 검색" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select id="docs-type" className={cx(inputCls, '!w-auto')} value={type} onChange={(e) => setType(e.target.value)} aria-label="문서 유형">
          <option value="all">전체 유형</option>
          {DOC_TYPES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </Card>

      <Card className="overflow-x-auto scroll-thin">
        {list.length === 0 ? (
          <Empty title={selected ? `'${selected.name}' 업무에 연결된 문서가 없습니다` : '조건에 맞는 문서가 없습니다'} sub={selected ? '문서 등록을 누르면 이 업무를 기본 연결 업무로 선택한 상태로 등록합니다.' : undefined} />
        ) : (
          <table className="w-full min-w-[920px] text-[13px]">
            <thead>
              <tr className="border-b border-line bg-sunken/60 text-left text-xs text-muted">
                <th className="px-4 py-2.5 font-semibold">문서명 · AI 요약</th>
                <th className="px-3 py-2.5 font-semibold">유형</th>
                <th className="px-3 py-2.5 font-semibold">작성일</th>
                <th className="px-3 py-2.5 font-semibold">등록일</th>
                <th className="px-3 py-2.5 font-semibold">관련 업무</th>
                <th className="px-3 py-2.5 font-semibold">출처</th>
                <th className="px-3 py-2.5 font-semibold">문서 관계</th>
              </tr>
            </thead>
            <tbody>
              {list.map((d) => (
                <tr key={d.id} className="cursor-pointer border-b border-line align-top last:border-0 hover:bg-sunken/50" onClick={() => nav(`/docs/${d.id}`)}>
                  <td className="max-w-[340px] px-4 py-3">
                    <div className="flex items-start gap-2">
                      {d.type === '회의록' ? <ScrollText size={15} className="mt-0.5 shrink-0 text-brand" /> : <FileText size={15} className="mt-0.5 shrink-0 text-faint" />}
                      <div className="min-w-0">
                        <div className="font-semibold leading-snug">{d.title}</div>
                        {d.summary.length > 0 ? (
                          <p className="mt-0.5 line-clamp-2 text-xs text-muted">{d.summary[0]}</p>
                        ) : (
                          <p className="mt-0.5 text-xs text-warn">AI 분석 대기</p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3">{d.type}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-muted tnum">{fmtDate(d.writtenAt)}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-muted tnum">{fmtDate(d.registeredAt)}</td>
                  <td className="px-3 py-3">
                    {d.workIds.length ? (
                      d.workIds.map((w) => (
                        <div key={w} className="text-xs">
                          {s.works.find((x) => x.id === w)?.name}
                        </div>
                      ))
                    ) : (
                      <span className="text-xs text-faint">{d.analyzed ? '관련 업무 없음 (AI 판단)' : '—'}</span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <div className="max-w-[200px] text-xs text-muted">{d.source}</div>
                  </td>
                  <td className="px-3 py-3 text-xs">
                    {d.relations.slice(0, 3).map((r, i) => (
                      <div key={i} className="whitespace-nowrap">
                        <span className="mr-1 rounded bg-navy px-1 text-2xs font-semibold text-surface">{r.type}</span>
                        <span className="text-muted">{s.docs.find((x) => x.id === r.targetId)?.title.slice(0, 14)}…</span>
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {open && <DocRegisterModal open onClose={() => setOpen(false)} presetWork={selected?.id} />}
    </div>
  );
}
