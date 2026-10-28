import React, { useEffect, useState } from 'react';
import { LayoutDashboard, FolderKanban, Files, GitCommitVertical, ScrollText, Search, ArrowRightLeft, ChevronLeft, Menu, RotateCcw, UserRound, Bot, X, ArrowDownUp, Orbit } from 'lucide-react';
import { DataTransfer } from './DataTransfer';
import { NewWorkModal } from './NewWorkModal';
import { useRouter } from '../lib/router';
import { useStore, useFocus, BUNDLED } from '../lib/store';
import { cx } from '../lib/util';
import { Button, Modal } from './ui';
import { useAI } from '../ai/claude';

function EngineNote() {
  const ai = useAI();
  const txt =
    ai.engine === 'claude'
      ? '문서 분석·AI 검색은 Claude로 동작합니다 (사용자 본인 Claude 계정 사용). 중복 탐지·회의록 관련성은 규칙 기반.'
      : ai.status === 'denied'
        ? 'Claude 사용이 허용되지 않아 규칙 기반 Mock 엔진으로 동작합니다.'
        : ai.status === 'unavailable'
          ? 'Claude 연결 불가 환경(claude.ai 밖) — 규칙 기반 Mock 엔진으로 동작합니다.'
          : 'AI 기능을 규칙 기반 Mock 엔진으로 동작 중입니다.';
  return (
    <div className="flex items-start gap-1.5 rounded-md border border-sidemuted/25 px-2 py-1.5">
      <Bot size={13} className="mt-0.5 shrink-0" />
      <span>{txt}</span>
    </div>
  );
}

function EngineToggle() {
  const ai = useAI();
  const can = ai.status === 'available';
  const tip = can ? 'AI 엔진 선택' : ai.status === 'checking' ? 'Claude 연결 확인 중' : ai.status === 'denied' ? 'Claude 사용이 허용되지 않음' : 'claude.ai에 게시된 페이지에서만 Claude 사용 가능';
  return (
    <div className="flex items-center rounded-md border border-line text-xs" title={tip} role="group" aria-label="AI 엔진">
      <button
        className={cx('flex items-center gap-1 rounded-l-md px-2 py-1 font-semibold', ai.engine === 'claude' ? 'bg-brand text-onbrand' : 'text-muted', !can && 'cursor-not-allowed opacity-50')}
        disabled={!can}
        onClick={() => ai.setPreferred('claude')}
      >
        <span className={cx('h-1.5 w-1.5 rounded-full', can ? 'bg-ok' : ai.status === 'checking' ? 'bg-warn' : 'bg-faint')} />
        Claude
      </button>
      <button className={cx('rounded-r-md px-2 py-1 font-semibold', ai.engine === 'mock' ? 'bg-navy text-surface' : 'text-muted')} onClick={() => ai.setPreferred('mock')}>
        Mock
      </button>
    </div>
  );
}

const NAV = [
  { to: '/dashboard', label: '대시보드', Icon: LayoutDashboard },
  { to: '/works', label: '업무 관리', Icon: FolderKanban },
  { to: '/docs', label: '문서함', Icon: Files },
  { to: '/timeline', label: '업무 타임라인', Icon: GitCommitVertical },
  { to: '/meetings', label: '회의록', Icon: ScrollText },
  { to: '/search', label: 'AI 업무 검색', Icon: Search },
  { to: '/handover', label: '업무 인계 관리', Icon: ArrowRightLeft },
  { to: '/universe', label: '업무 유니버스', Icon: Orbit },
];

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-4 py-4">
      <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
        <rect width="28" height="28" rx="7" fill="rgb(var(--brand))" />
        <circle cx="9" cy="14" r="3.2" fill="white" />
        <circle cx="19" cy="9" r="2.6" fill="white" opacity=".85" />
        <circle cx="19" cy="19" r="2.6" fill="white" opacity=".85" />
        <path d="M11.6 12.6 16.8 9.9M11.6 15.4l5.2 2.7" stroke="white" strokeWidth="1.6" />
      </svg>
      <div className="leading-tight">
        <div className="text-[15px] font-bold tracking-tight text-sideink">업무잇다</div>
        <div className="text-2xs text-sidemuted">AI 업무 지식관리 · 상시 인수인계</div>
      </div>
    </div>
  );
}

function Nav({ onPick }: { onPick?: () => void }) {
  const { path, nav } = useRouter();
  const { s } = useStore();
  const waiting = s.handovers.filter((h) => h.status === 'submitted' || h.status === 'revision' || h.status === 'accepted').length;
  const [focus] = useFocus();
  return (
    <nav className="flex flex-col gap-0.5 px-2">
      {NAV.map(({ to, label, Icon }) => {
        const active = path === to || path.startsWith(to + '/') || (to === '/handover' && path.startsWith('/snapshots'));
        const badge = to === '/handover' ? waiting : 0;
        return (
          <a
            key={to}
            href={'#' + to}
            onClick={(e) => {
              e.preventDefault();
              // 업무 관리: 마지막으로 보던 업무가 있으면 그 업무 상세로 바로 이동
              nav(to === '/works' && focus !== 'all' ? `/works/${focus}` : to);
              onPick?.();
            }}
            className={cx(
              'flex items-center gap-2.5 rounded-md px-3 py-2 text-[13.5px] font-medium transition-colors',
              active ? 'bg-sideactive text-sideink' : 'text-sidemuted hover:bg-sideactive/60 hover:text-sideink',
            )}
            aria-current={active ? 'page' : undefined}
          >
            <Icon size={17} strokeWidth={active ? 2.3 : 1.9} />
            <span className="flex-1">{label}</span>
            {badge > 0 && <span className="rounded-full bg-[rgb(255_196_92)] px-1.5 text-2xs font-bold text-[rgb(40_28_0)] tnum">{badge}</span>}
          </a>
        );
      })}
    </nav>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const { canBack, back, nav } = useRouter();
  const { s, update, reset, toastMsg, toast } = useStore();
  const [mobile, setMobile] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [dataOpen, setDataOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  useEffect(() => {
    const h = () => setNewOpen(true);
    window.addEventListener('open-new-work', h);
    return () => window.removeEventListener('open-new-work', h);
  }, []);
  const [q, setQ] = useState('');

  return (
    <div className="flex h-full">
      <aside className="hidden w-[232px] shrink-0 flex-col bg-side lg:flex">
        <Brand />
        <Nav />
        <div className="mt-auto space-y-2 px-4 py-4 text-2xs leading-relaxed text-sidemuted">
          <EngineNote />
          <p>사용자(김도윤·이서연)는 시연용 가상 인물입니다.</p>
        </div>
      </aside>

      {mobile && (
        <div className="fixed inset-0 z-50 flex bg-[rgb(10_16_32/0.5)] lg:hidden" onClick={() => setMobile(false)}>
          <aside className="flex h-full w-[248px] flex-col bg-side" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between pr-2">
              <Brand />
              <button className="p-2 text-sidemuted" onClick={() => setMobile(false)} aria-label="메뉴 닫기">
                <X size={18} />
              </button>
            </div>
            <Nav onPick={() => setMobile(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface/95 px-4 backdrop-blur">
          <button className="rounded p-1.5 text-muted hover:bg-sunken lg:hidden" onClick={() => setMobile(true)} aria-label="메뉴 열기">
            <Menu size={19} />
          </button>
          <button className={cx('rounded p-1.5 text-muted hover:bg-sunken', !canBack && 'invisible')} onClick={back} aria-label="뒤로" title="뒤로">
            <ChevronLeft size={19} />
          </button>
          <form
            className="relative hidden max-w-md flex-1 sm:block"
            onSubmit={(e) => {
              e.preventDefault();
              if (q.trim()) nav(`/search?q=${encodeURIComponent(q.trim())}`);
              setQ('');
            }}
          >
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <input
              id="global-ask"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="업무에 대해 질문하세요 — 예: 현재 추진 경과는?"
              className="h-9 w-full rounded-md border border-line bg-sunken pl-9 pr-3 text-[13px] placeholder:text-faint focus:border-brand focus:bg-surface focus:outline-none"
            />
          </form>
          <div className="ml-auto flex items-center gap-2">
            <label className="flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-xs text-muted" title="시연용 사용자 전환 (가상 인물)">
              <UserRound size={14} className="hidden sm:block" />
              <span className="hidden md:inline">사용자</span>
              <select
                id="user-switch"
                className="max-w-[92px] truncate bg-transparent text-[13px] font-semibold text-ink focus:outline-none sm:max-w-none"
                value={s.currentUserId}
                onChange={(e) => {
                  const id = e.target.value;
                  update((d) => {
                    d.currentUserId = id;
                  });
                  toast(`${s.users.find((u) => u.id === id)?.name}(으)로 전환했습니다`);
                }}
              >
                {s.users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} · {u.title}
                  </option>
                ))}
              </select>
            </label>
            <EngineToggle />
            <Button variant="ghost" size="sm" onClick={() => setDataOpen(true)} title="데이터 옮기기 (백업 · 불러오기)">
              <ArrowDownUp size={14} />
              <span className="hidden md:inline">데이터 옮기기</span>
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setResetOpen(true)} title={BUNDLED ? '처음 상태로 되돌리기' : '모든 데이터 지우기'}>
              <RotateCcw size={14} />
              <span className="hidden md:inline">초기화</span>
            </Button>
          </div>
        </header>
        <main id="main-scroll" className="flex-1 overflow-y-auto scroll-thin">
          <div className="mx-auto w-full max-w-[1280px] px-4 py-5 sm:px-6 lg:py-7">{children}</div>
        </main>
      </div>

      <NewWorkModal open={newOpen} onClose={() => setNewOpen(false)} />
      <DataTransfer open={dataOpen} onClose={() => setDataOpen(false)} />

      <Modal open={resetOpen} onClose={() => setResetOpen(false)} title={BUNDLED ? '처음 상태로 되돌리기' : '모든 데이터 지우기'}>
        <p className="mb-2 text-[13px] text-muted">
          {BUNDLED ? '이 화면에서 바꾼 내용이 지워지고, 제출본에 담긴 처음 데이터로 돌아감.' : '등록한 업무·문서·타임라인·인계 내용이 모두 지워지고 빈 상태로 돌아감. 되돌릴 수 없음.'}
        </p>
        <p className="mb-4 text-[13px] text-muted">필요하면 먼저 상단 '데이터 옮기기' → '내보내기'로 백업.</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setResetOpen(false)}>
            취소
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              reset('linked');
              setResetOpen(false);
              nav('/dashboard');
              toast(BUNDLED ? '처음 상태로 되돌렸습니다' : '모든 데이터를 지웠습니다');
            }}
          >
            {BUNDLED ? '되돌리기' : '모두 지우기'}
          </Button>
        </div>
      </Modal>

      {toastMsg && (
        <div className="fixed bottom-5 left-1/2 z-[60] -translate-x-1/2 rounded-lg bg-navy px-4 py-2.5 text-[13px] font-medium text-surface shadow-pop" role="status">
          {toastMsg}
        </div>
      )}
    </div>
  );
}
