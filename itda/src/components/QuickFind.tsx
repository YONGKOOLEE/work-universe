import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, CornerDownLeft, LayoutDashboard, Zap, FolderKanban, FileText, UserRound, Sparkles, Contact } from 'lucide-react';
import { useRouter } from '../lib/router';
import { useStore } from '../lib/store';
import { cx } from '../lib/util';
import { KIND_LABEL, buildItems, flatten, looksLikeQuestion, quickFind, type ActionId, type QFItem, type QFKind } from '../lib/quickFind';

const KIND_ICON: Record<QFKind, typeof Search> = { menu: LayoutDashboard, action: Zap, work: FolderKanban, doc: FileText, person: UserRound, customer: Contact };
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');

/** 상단 「바로 찾기」: 메뉴·기능·업무·문서·사람을 이름으로 바로 찾는다(업무 질문은 AI 업무 검색). Ctrl+K / Cmd+K */
export function QuickFind({ onAction }: { onAction: (a: ActionId) => void }) {
  const { s } = useStore();
  const { nav } = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const lastFocus = useRef<HTMLElement | null>(null);

  // restore=false: 기능 실행(새 업무 등록·AI 설정 등 다른 창을 여는 동작) 뒤에는 이전 초점으로 되돌리지 않는다(새로 열린 창이 초점을 가진다)
  const close = (restore = true) => {
    setOpen(false);
    setQ('');
    setActive(0);
    const el = lastFocus.current;
    lastFocus.current = null;
    if (restore && el && document.contains(el)) setTimeout(() => el.focus(), 0);
  };
  const openIt = () => {
    lastFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpen(true);
  };

  // Ctrl+K / Cmd+K: 어디서든(입력칸 안에서도) 열고 닫는다. 브라우저 기본 동작(주소창 검색 등)은 막는다
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        e.stopPropagation();
        if (open) close();
        else openIt();
      }
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  });

  // 열려 있는 동안 Esc는 이 창만 닫는다(아래에 열린 다른 창까지 닫지 않도록 먼저 가로챈다)
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  });

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  const items = useMemo(() => (open ? buildItems(s) : []), [open, s]);
  const groups = useMemo(() => (open ? quickFind(s, q, items) : []), [open, s, q, items]);
  const flat = useMemo(() => flatten(groups), [groups]);
  const showAsk = q.trim().length > 0 && (flat.length === 0 || looksLikeQuestion(q));
  const total = flat.length + (showAsk ? 1 : 0);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, groups]);

  const run = (it: QFItem) => {
    close(!it.action);
    if (it.action) onAction(it.action);
    else if (it.to) nav(it.to);
  };
  const ask = () => {
    const t = q.trim();
    close();
    nav(`/search?q=${encodeURIComponent(t)}`);
  };
  const runActive = () => {
    if (active < flat.length) run(flat[active]);
    else if (showAsk) ask();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return; // 한글 입력 중 Enter·화살표는 글자 확정용
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (total) setActive((a) => (a + 1) % total);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (total) setActive((a) => (a - 1 + total) % total);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runActive();
    }
  };

  // aria-modal이라 Tab·Shift+Tab이 창 밖으로 나가지 않게 한다. 창 안에서 초점을 받는 요소는 입력칸뿐이라 입력칸에 머문다
  const trapTab = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    inputRef.current?.focus();
  };

  const optId = (i: number) => `qf-opt-${i}`;
  let idx = -1;

  return (
    <>
      <button
        className="flex items-center gap-1.5 rounded-md border border-line px-2 py-1.5 text-xs text-muted hover:bg-sunken hover:text-ink"
        onClick={openIt}
        title={`바로 찾기 — 메뉴·기능·업무·문서·사람·고객 (${isMac ? '⌘ K' : 'Ctrl K'})`}
        aria-label="바로 찾기"
        aria-keyshortcuts={isMac ? 'Meta+K' : 'Control+K'}
        data-testid="quick-find-open"
      >
        <Search size={14} />
        <span className="hidden font-medium md:inline">바로 찾기</span>
        <kbd className="hidden rounded border border-line2 px-1 text-2xs font-semibold text-faint 2xl:inline">{isMac ? '⌘ K' : 'Ctrl K'}</kbd>
      </button>
      {open &&
        createPortal(
          <div className="fixed inset-0 z-[70] flex items-start justify-center bg-[rgb(10_16_32/0.45)] px-4 pt-[12vh]" onMouseDown={() => close()}>
            <div className="w-full max-w-xl overflow-hidden rounded-xl border border-line bg-surface shadow-pop" onMouseDown={(e) => e.stopPropagation()} onKeyDown={trapTab} role="dialog" aria-modal="true" aria-label="바로 찾기" data-testid="quick-find">
              <div className="flex items-center gap-2 border-b border-line px-4">
                <Search size={16} className="shrink-0 text-faint" />
                <input
                  ref={inputRef}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={onKey}
                  role="combobox"
                  aria-expanded="true"
                  aria-controls="qf-list"
                  aria-activedescendant={total ? optId(active) : undefined}
                  aria-autocomplete="list"
                  aria-label="찾을 말"
                  placeholder="메뉴·기능·업무·문서·사람·고객 — 예: 백업, W-001, 김도현"
                  className="h-12 w-full bg-transparent text-[14px] text-ink placeholder:text-faint focus:outline-none"
                  data-testid="quick-find-input"
                />
                <kbd className="shrink-0 rounded border border-line2 px-1 text-2xs font-semibold text-faint">Esc</kbd>
              </div>
              <div ref={listRef} id="qf-list" role="listbox" aria-label="찾은 결과" className="max-h-[56vh] overflow-y-auto py-1 scroll-thin" data-testid="quick-find-list">
                {groups.map((g) => (
                  <div key={g.kind} role="group" aria-label={KIND_LABEL[g.kind]}>
                    <div className="px-4 pb-1 pt-2 text-2xs font-semibold text-muted" aria-hidden="true">
                      {KIND_LABEL[g.kind]}
                    </div>
                    {g.items.map((it) => {
                      idx += 1;
                      const i = idx;
                      const Icon = KIND_ICON[it.kind];
                      return (
                        <div
                          key={it.key}
                          id={optId(i)}
                          role="option"
                          aria-selected={i === active}
                          onMouseMove={() => i !== active && setActive(i)}
                          onClick={() => run(it)}
                          className={cx('mx-1 flex cursor-pointer items-center gap-2.5 rounded-md px-3 py-2', i === active ? 'bg-brandsoft text-ink' : 'text-ink')}
                          data-testid="quick-find-item"
                          data-kind={it.kind}
                          data-key={it.key}
                        >
                          <Icon size={15} className="shrink-0 text-muted" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13.5px] font-medium">
                              {it.title}
                              {it.id && <span className="ml-1.5 text-2xs font-normal text-faint tnum">{it.id}</span>}
                            </span>
                            <span className="block truncate text-xs text-muted">{it.sub}</span>
                          </span>
                          {i === active && <CornerDownLeft size={13} className="shrink-0 text-faint" aria-hidden="true" />}
                        </div>
                      );
                    })}
                  </div>
                ))}
                {q.trim() && flat.length === 0 && (
                  <p className="px-4 py-3 text-[13px] text-muted" data-testid="quick-find-empty">
                    찾은 메뉴·기능·업무·문서·사람·고객이 없음.
                  </p>
                )}
                {showAsk && (
                  <div className="mt-1 border-t border-line pt-1">
                    <div
                      id={optId(flat.length)}
                      role="option"
                      aria-selected={active === flat.length}
                      onMouseMove={() => active !== flat.length && setActive(flat.length)}
                      onClick={ask}
                      className={cx('mx-1 flex cursor-pointer items-center gap-2.5 rounded-md px-3 py-2', active === flat.length ? 'bg-brandsoft' : '')}
                      data-testid="quick-find-ask"
                    >
                      <Sparkles size={15} className="shrink-0 text-brand" />
                      <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">AI 업무 검색으로 묻기: “{q.trim()}”</span>
                      {active === flat.length && <CornerDownLeft size={13} className="shrink-0 text-faint" aria-hidden="true" />}
                    </div>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-3 border-t border-line px-4 py-2 text-2xs text-faint">
                <span>↑↓ 이동</span>
                <span>Enter 실행</span>
                <span>Esc 닫기</span>
                <span className="ml-auto">업무 질문은 AI 업무 검색</span>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
