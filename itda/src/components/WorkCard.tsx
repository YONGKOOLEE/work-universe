import { FileText, Gavel, ListTodo, AlertTriangle, CornerDownRight } from 'lucide-react';
import type { Work } from '../lib/types';
import { useStore, ownerNames } from '../lib/store';
import { useRouter } from '../lib/router';
import { StatusBadge, Mono } from './ui';
import { relDays, cx } from '../lib/util';
import { workIssues } from '../ai/engine';

export function WorkCard({ w, compact }: { w: Work; compact?: boolean }) {
  const { s } = useStore();
  const { nav } = useRouter();
  const docs = s.docs.filter((d) => d.workIds.includes(w.id)).length;
  const decs = s.decisions.filter((d) => d.workId === w.id).length;
  const acts = s.actions.filter((a) => a.workId === w.id && a.status !== '완료').length;
  const issues = workIssues(s, w).filter((i) => i.severity !== 'low');
  const parent = s.works.find((x) => x.id === w.parentId);
  return (
    <button
      onClick={() => nav(`/works/${w.id}`)}
      className="group flex w-full flex-col gap-2 rounded-lg border border-line bg-surface p-3.5 text-left shadow-card transition-colors hover:border-brand/50"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {parent && (
            <div className="mb-0.5 flex items-center gap-1 text-2xs text-faint">
              <CornerDownRight size={11} />
              {parent.name}
            </div>
          )}
          <div className="text-[14px] font-semibold leading-snug text-ink group-hover:text-brand">{w.name}</div>
        </div>
        <StatusBadge status={w.status} />
      </div>
      {!compact && <p className="line-clamp-2 text-xs leading-relaxed text-muted">{w.summary}</p>}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-muted">
        <Mono>{w.id}</Mono>
        <span>담당 {ownerNames(s, w.owners)}</span>
        <span>갱신 {relDays(w.updatedAt)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-2 text-2xs text-muted tnum">
        <span className="inline-flex items-center gap-1"><FileText size={12} />문서 {docs}</span>
        <span className="inline-flex items-center gap-1"><Gavel size={12} />결정 {decs}</span>
        <span className="inline-flex items-center gap-1"><ListTodo size={12} />조치 {acts}</span>
        {issues.length > 0 && (
          <span className={cx('ml-auto inline-flex items-center gap-1 font-semibold', issues.some((i) => i.severity === 'high') ? 'text-danger' : 'text-warn')}>
            <AlertTriangle size={12} />
            확인 필요 {issues.length}
          </span>
        )}
      </div>
    </button>
  );
}
