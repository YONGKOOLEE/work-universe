// AI 비서 화면 공통 부품 — 대화상자(초점·Esc·인쇄), 아바타, 표시 칩, 글자 강조.
import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ListChecks, Lock, X } from 'lucide-react';
import { Tabs } from '../../components/ui';
import { cx } from '../../lib/util';
import { avatarTone, ddayLabel, ddayTone, highlightParts, initialOf } from './logic';

// ───────────── 대화상자 ─────────────

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
const visibleFocusables = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((e) => e.offsetWidth || e.offsetHeight || e.getClientRects().length);
/** 열려 있는 대화상자 쌓기 — Esc는 맨 위 하나만 닫는다 */
const stack: symbol[] = [];

const PRINT_CSS = `@media print {
  #root { display: none !important; }
  body { background: #fff !important; }
  .asst-dialog-root { position: static !important; display: block !important; background: none !important; padding: 0 !important; overflow: visible !important; }
  .asst-dialog-root, .asst-dialog-root * { color: #111 !important; background: transparent !important; border-color: #999 !important; box-shadow: none !important; }
  .asst-dialog-root [role="dialog"] { max-width: none !important; border: 0 !important; }
  .asst-dialog-body { max-height: none !important; overflow: visible !important; }
  .asst-no-print { display: none !important; }
}`;

export function AsstDialog({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
  printable,
  testId,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'md' | 'lg' | 'xl';
  /** true면 인쇄할 때 이 대화상자만 종이에 나간다 */
  printable?: boolean;
  testId?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const me = Symbol('dialog');
    stack.push(me);
    const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const t = window.setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      const auto = el.querySelector<HTMLElement>('[data-autofocus]');
      (auto ?? el.querySelector<HTMLElement>('.asst-dialog-body ' + FOCUSABLE.split(',').join(', .asst-dialog-body ')) ?? visibleFocusables(el)[0])?.focus();
    }, 0);
    const key = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== me) return;
      const el = ref.current;
      if (!el) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeRef.current();
      } else if (e.key === 'Tab') {
        const list = visibleFocusables(el);
        if (!list.length) return;
        const first = list[0];
        const last = list[list.length - 1];
        const active = document.activeElement;
        if (!el.contains(active)) {
          e.preventDefault();
          first.focus();
        } else if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', key);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('keydown', key);
      const i = stack.indexOf(me);
      if (i >= 0) stack.splice(i, 1);
      if (prev && document.contains(prev)) prev.focus();
    };
  }, [open]);
  if (!open) return null;
  return createPortal(
    <div className="asst-dialog-root fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[rgb(10_16_32/0.45)] px-4 py-8" onMouseDown={() => closeRef.current()}>
      {printable && <style>{PRINT_CSS}</style>}
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid={testId}
        className={cx('w-full rounded-xl border border-line bg-surface shadow-pop', size === 'xl' ? 'max-w-5xl' : size === 'lg' ? 'max-w-3xl' : 'max-w-xl')}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <h2 id={titleId} className="min-w-0 break-words text-[15px] font-semibold">
            {title}
          </h2>
          <button onClick={onClose} className="asst-no-print shrink-0 rounded p-1 text-muted hover:bg-sunken" aria-label="닫기">
            <X size={18} />
          </button>
        </div>
        <div className="asst-dialog-body max-h-[calc(100vh-190px)] overflow-y-auto px-5 py-4 scroll-thin">{children}</div>
        {footer && <div className="asst-no-print flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// ───────────── 표시 부품 ─────────────

const AVATAR_TONES = ['bg-brandsoft text-brand', 'bg-factsoft text-fact', 'bg-infersoft text-infer', 'bg-ownersoft text-owner', 'bg-warnsoft text-warn', 'bg-oksoft text-ok'];
const AVATAR_SIZE = { sm: 'h-8 w-8 text-[13px]', md: 'h-10 w-10 text-[15px]', lg: 'h-14 w-14 text-[22px]' };
/** 머리글자 아바타(사진은 저장하지 않는다) */
export function Avatar({ id, name, size = 'md' }: { id: string; name: string; size?: keyof typeof AVATAR_SIZE }) {
  return (
    <span aria-hidden="true" className={cx('inline-flex shrink-0 items-center justify-center rounded-full font-bold', AVATAR_SIZE[size], AVATAR_TONES[avatarTone(id)])}>
      {initialOf(name)}
    </span>
  );
}

type PillTone = 'muted' | 'brand' | 'ok' | 'warn' | 'danger' | 'infer';
const PILL: Record<PillTone, string> = {
  muted: 'bg-sunken text-muted',
  brand: 'bg-brandsoft text-brand',
  ok: 'bg-oksoft text-ok',
  warn: 'bg-warnsoft text-warn',
  danger: 'bg-dangersoft text-danger',
  infer: 'bg-infersoft text-infer',
};
export function Pill({ tone = 'muted', children, title, className, ...rest }: { tone?: PillTone; children: React.ReactNode; title?: string; className?: string } & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span {...rest} title={title} className={cx('inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded px-1.5 py-px text-2xs font-semibold', PILL[tone], className)}>
      {children}
    </span>
  );
}

/** D-day 칩(마감 경과·오늘은 붉게, 3일 이내는 주황) */
export function DDay({ n }: { n: number | null | undefined }) {
  if (n === null || n === undefined) return null;
  const t = ddayTone(n);
  return <Pill tone={t === 'danger' ? 'danger' : t === 'warn' ? 'warn' : 'muted'}>{ddayLabel(n)}</Pill>;
}

/** 「규칙 기반」 표시 — 이 계산에는 AI도 외부 전송도 쓰지 않는다 */
export function RuleBadge({ label = '규칙 기반' }: { label?: string }) {
  return (
    <Pill tone="muted" title="저장된 고객정보를 규칙으로 계산한 결과입니다. AI를 쓰지 않고 외부로 보내지 않습니다.">
      <ListChecks size={11} aria-hidden="true" />
      {label}
    </Pill>
  );
}

/** 읽기 전용 안내(열람만 가능할 때) */
export function ReadOnlyNote({ owner, testId = 'asst-readonly' }: { owner: string; testId?: string }) {
  return (
    <p className="flex items-start gap-2 rounded-lg border border-line bg-sunken/60 px-4 py-2.5 text-[13px] text-muted" data-testid={testId}>
      <Lock size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span>
        이 고객은 <b className="text-ink">{owner}</b>님이 담당합니다. 열람만 할 수 있고, 고치는 것은 담당 영업자와 담당자 소속 조직의 조직장입니다.
      </span>
    </p>
  );
}

/** 글 속 키워드를 칠해서 보인다 */
export function Highlight({ text, keywords }: { text: string; keywords: string[] }) {
  const parts = highlightParts(text, keywords);
  return (
    <>
      {parts.map((p, i) =>
        p.hit ? (
          <mark key={i} className="rounded bg-warnsoft px-0.5 text-ink">
            {p.text}
          </mark>
        ) : (
          <React.Fragment key={i}>{p.text}</React.Fragment>
        ),
      )}
    </>
  );
}

/** 값 없음 표시 */
export const Blank = ({ children = '미입력' }: { children?: React.ReactNode }) => <span className="text-muted">{children}</span>;

/** 안쪽 화면 제목 줄 */
export function PageTitle({ title, sub, right }: { title: string; sub?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-[18px] font-bold tracking-tight">{title}</h2>
        {sub && <p className="mt-0.5 text-[13px] text-muted">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

/** 모든 긴 글이 칸 밖으로 나가지 않게 줄바꿈하는 글 상자 */
export const wrapCls = 'min-w-0 break-words [overflow-wrap:anywhere]';

/** 기존 Tabs를 그대로 쓰되 가로 스크롤 띠에 세로 스크롤바가 끼지 않게 한다 */
export function TabsBar<T extends string>(p: { tabs: { id: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="[&>div]:overflow-y-hidden">
      <Tabs {...p} />
    </div>
  );
}
