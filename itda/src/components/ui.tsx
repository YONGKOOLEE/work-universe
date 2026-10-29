import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, FileText, ExternalLink, CircleCheck, Sparkles, CircleHelp, PenLine, Link2, Archive, Quote } from 'lucide-react';
import type { Cite, Prov, SourceStatus, Stmt, WorkStatus } from '../lib/types';
import { cx } from '../lib/util';
import { useRouter } from '../lib/router';
import { useStore } from '../lib/store';

export function Button({
  variant = 'default',
  size = 'md',
  className,
  ...p
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'ghost' | 'danger' | 'subtle'; size?: 'sm' | 'md' }) {
  return (
    <button
      {...p}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45 whitespace-nowrap',
        size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-9 px-3.5 text-[13px]',
        variant === 'primary' && 'bg-brand text-onbrand hover:bg-brand/90',
        variant === 'default' && 'border border-line2 bg-surface text-ink hover:bg-sunken',
        variant === 'ghost' && 'text-muted hover:bg-sunken hover:text-ink',
        variant === 'subtle' && 'bg-brandsoft text-brand hover:bg-brandsoft/70',
        variant === 'danger' && 'border border-danger/40 bg-surface text-danger hover:bg-dangersoft',
        className,
      )}
    />
  );
}

export function Card({ className, children, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...p} className={cx('rounded-lg border border-line bg-surface shadow-card', className)}>
      {children}
    </div>
  );
}

export function CardHead({ title, icon, right, sub }: { title: React.ReactNode; icon?: React.ReactNode; right?: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-4 py-3">
      <div className="min-w-0">
        <h3 className="flex items-center gap-2 text-[14px] font-semibold text-ink">
          {icon && <span className="text-brand">{icon}</span>}
          {title}
        </h3>
        {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

const PROV: Record<Prov, { label: string; cls: string; Icon: React.ElementType }> = {
  fact: { label: '원문 확인', cls: 'bg-factsoft text-fact border-fact/25', Icon: CircleCheck },
  inference: { label: 'AI 추론', cls: 'bg-infersoft text-infer border-infer/25', Icon: Sparkles },
  unverified: { label: '추가 확인 필요', cls: 'bg-warnsoft text-warn border-warn/30', Icon: CircleHelp },
  owner: { label: '담당자 작성', cls: 'bg-ownersoft text-owner border-owner/25', Icon: PenLine },
};
/** label: 표시 문구를 바꾼다(예: 규칙으로 만든 추정은 「AI 추론」 대신 「규칙 추정」) */
export function ProvChip({ prov, compact, label }: { prov: Prov; compact?: boolean; label?: string }) {
  const p = { ...PROV[prov], label: label ?? PROV[prov].label };
  return (
    <span className={cx('inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-px text-2xs font-semibold', p.cls)} title={p.label}>
      <p.Icon size={11} strokeWidth={2.4} />
      {!compact && p.label}
    </span>
  );
}

const SRC: Record<SourceStatus, { label: string; cls: string; Icon: React.ElementType }> = {
  original: { label: '원문 확보', cls: 'bg-factsoft text-fact border-fact/25', Icon: FileText },
  cited: { label: '원문 내 인용 확인', cls: 'bg-factsoft text-fact border-fact/25', Icon: Quote },
  reference: { label: '정책 이력 참고정보', cls: 'bg-warnsoft text-warn border-warn/30', Icon: Archive },
  link: { label: '링크만 등록 · 원문 미확인', cls: 'bg-warnsoft text-warn border-warn/30', Icon: Link2 },
  record: { label: '플랫폼 기록', cls: 'bg-ownersoft text-owner border-owner/25', Icon: PenLine },
  unverified: { label: '원문 미확인 · 별도 확인 필요', cls: 'bg-warnsoft text-warn border-warn/30', Icon: CircleHelp },
};
export function SourceChip({ s, short }: { s: SourceStatus; short?: boolean }) {
  const p = SRC[s];
  return (
    <span className={cx('inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-px text-2xs font-semibold', p.cls)}>
      <p.Icon size={11} strokeWidth={2.4} />
      {short ? p.label.split(' ·')[0] : p.label}
    </span>
  );
}

const STATUS: Record<WorkStatus, string> = {
  '검토 중': 'bg-ownersoft text-owner',
  '진행 중': 'bg-brandsoft text-brand',
  '운영 중': 'bg-oksoft text-ok',
  완료: 'bg-sunken text-muted',
  보류: 'bg-warnsoft text-warn',
};
export function StatusBadge({ status }: { status: WorkStatus }) {
  return <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-semibold', STATUS[status])}><span className="h-1.5 w-1.5 rounded-full bg-current" />{status}</span>;
}

export function Tag({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cx('inline-flex items-center rounded bg-sunken px-1.5 py-px text-2xs font-medium text-muted', className)}>{children}</span>;
}

export function Mono({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cx('font-mono text-[11.5px] text-faint', className)}>{children}</span>;
}

export function CiteLink({ c }: { c: Cite }) {
  const { nav } = useRouter();
  const { s, raw } = useStore();
  const d = s.docs.find((x) => x.id === c.docId);
  // 지워진 문서(전체 데이터에도 없음)를 가리키는 옛 인용 — 이동하지 않고 「삭제된 문서」로 보인다
  if (!d && !raw.docs.some((x) => x.id === c.docId))
    return (
      <span className="inline-flex max-w-full items-center gap-1 rounded border border-line2 px-1.5 py-px text-2xs text-faint" title={c.label ? `삭제된 문서: ${c.label}` : '삭제된 문서'} data-testid="cite-deleted">
        <FileText size={11} className="shrink-0" />
        <span className="truncate">삭제된 문서</span>
      </span>
    );
  const label = c.label ?? d?.title ?? c.docId;
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        nav(`/docs/${c.docId}${c.anchor ? `?anchor=${c.anchor}` : ''}`);
      }}
      className="inline-flex max-w-full items-center gap-1 rounded border border-brand/25 bg-brandsoft/60 px-1.5 py-px text-left text-2xs font-medium text-brand hover:bg-brandsoft"
      title="근거 문서 위치로 이동"
    >
      <FileText size={11} className="shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}

export function StmtList({ items, empty = '등록된 내용 없음' }: { items: Stmt[]; empty?: string }) {
  if (!items.length) return <p className="rounded-md border border-dashed border-warn/40 bg-warnsoft/50 px-3 py-2 text-[13px] text-warn">{empty}</p>;
  return (
    <ul className="space-y-2.5">
      {items.map((x) => (
        <li key={x.id} className="flex gap-2.5">
          <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-faint" />
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] leading-relaxed text-ink">{x.text}</p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <ProvChip prov={x.prov} />
              {x.cite?.map((c, i) => <CiteLink key={i} c={c} />)}
              {x.note && <span className="text-2xs text-faint">{x.note}</span>}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Modal({ open, onClose, title, children, wide, footer }: { open: boolean; onClose: () => void; title: React.ReactNode; children: React.ReactNode; wide?: boolean | 'x'; footer?: React.ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[rgb(10_16_32/0.45)] px-4 py-8" onMouseDown={onClose}>
      <div className={cx('w-full rounded-xl border border-line bg-surface shadow-pop', wide === 'x' ? 'max-w-6xl' : wide ? 'max-w-4xl' : 'max-w-xl')} onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-muted hover:bg-sunken" aria-label="닫기">
            <X size={18} />
          </button>
        </div>
        <div className="max-h-[calc(100vh-180px)] overflow-y-auto px-5 py-4 scroll-thin">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Drawer({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: React.ReactNode; children: React.ReactNode }) {
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-40 flex justify-end bg-[rgb(10_16_32/0.3)]" onMouseDown={onClose}>
      <aside className="flex h-full w-full max-w-[520px] flex-col border-l border-line bg-surface shadow-pop" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-3.5">
          <div className="min-w-0 text-[15px] font-semibold">{title}</div>
          <button onClick={onClose} className="rounded p-1 text-muted hover:bg-sunken" aria-label="닫기">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 scroll-thin">{children}</div>
      </aside>
    </div>,
    document.body,
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-line scroll-thin" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cx(
            '-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-[13px] font-medium transition-colors',
            value === t.id ? 'border-brand text-brand' : 'border-transparent text-muted hover:text-ink',
          )}
        >
          {t.label}
          {t.count !== undefined && <span className={cx('rounded-full px-1.5 text-2xs tnum', value === t.id ? 'bg-brandsoft' : 'bg-sunken')}>{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Chips<T extends string>({ items, value, onChange }: { items: { id: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((i) => (
        <button
          key={i.id}
          onClick={() => onChange(i.id)}
          className={cx(
            'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
            value === i.id ? 'border-navy bg-navy text-surface' : 'border-line2 bg-surface text-muted hover:text-ink',
          )}
        >
          {i.label}
          {i.count !== undefined && <span className="ml-1 tnum opacity-70">{i.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, children, hint, htmlFor }: { label: string; children: React.ReactNode; hint?: string; htmlFor?: string }) {
  return (
    <label className="block" htmlFor={htmlFor}>
      <span className="mb-1 block text-xs font-semibold text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-2xs text-faint">{hint}</span>}
    </label>
  );
}
export const inputCls = 'w-full rounded-md border border-line2 bg-surface px-3 py-2 text-[13px] text-ink placeholder:text-faint focus:border-brand focus:outline-none';

export function Empty({ icon, title, sub, action }: { icon?: React.ReactNode; title: string; sub?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      {icon && <div className="text-faint">{icon}</div>}
      <p className="text-[13px] font-medium text-ink">{title}</p>
      {sub && <p className="max-w-sm text-xs text-muted">{sub}</p>}
      {action}
    </div>
  );
}

export function ExtLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand hover:underline">
      {children}
      <ExternalLink size={12} />
    </a>
  );
}

export function ProvLegend() {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-2xs text-muted">
      <ProvChip prov="fact" />
      <ProvChip prov="inference" />
      <ProvChip prov="unverified" />
      <ProvChip prov="owner" />
    </div>
  );
}

export function KV({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[96px_1fr] gap-2 py-1.5 text-[13px]">
      <dt className="text-muted">{k}</dt>
      <dd className="min-w-0 text-ink">{children}</dd>
    </div>
  );
}
