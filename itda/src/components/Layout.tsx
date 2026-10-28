import React, { useEffect, useState } from 'react';
import { LayoutDashboard, FolderKanban, Files, GitCommitVertical, ScrollText, Search, ArrowRightLeft, ChevronLeft, Menu, RotateCcw, UserRound, Bot, X, ArrowDownUp, Orbit, KeyRound, Users } from 'lucide-react';
import { DataTransfer } from './DataTransfer';
import { NewWorkModal } from './NewWorkModal';
import { useRouter } from '../lib/router';
import { useStore, useFocus, BUNDLED } from '../lib/store';
import { cx } from '../lib/util';
import { Button, Modal } from './ui';
import { useAI } from '../ai/claude';
import { selectableUsers, displayName } from '../lib/people';

function EngineNote() {
  const ai = useAI();
  const txt =
    ai.engine === 'claude'
      ? `문서 분석·AI 검색을 Claude(${ai.model})로 합니다 — 본인 API 키 사용. 결과는 원문 대조를 거쳐 표시합니다.`
      : ai.status === 'available'
        ? '규칙 기반으로 동작 중입니다(키는 저장되어 있음 — 상단에서 Claude를 고르면 바로 사용).'
        : '키가 없어 규칙 기반으로 동작합니다. 상단 「AI 설정」에 본인 Claude API 키를 넣으면 Claude가 분석합니다.';
  return (
    <div className="flex items-start gap-1.5 rounded-md border border-sidemuted/25 px-2 py-1.5" data-testid="engine-note">
      <Bot size={13} className="mt-0.5 shrink-0" />
      <span>{txt}</span>
    </div>
  );
}

function EngineToggle({ onSettings }: { onSettings: () => void }) {
  const ai = useAI();
  const can = ai.status === 'available';
  return (
    <div className="flex items-center gap-1">
      <div className="flex items-center rounded-md border border-line text-xs" title={can ? 'AI 엔진 선택: Claude(본인 키로 실시간 분석) 또는 규칙(키 없이, 밖으로 보내지 않음)' : '지금은 규칙 기반(키 없이 동작). 「AI 설정」에 본인 키를 넣으면 Claude를 쓸 수 있습니다'} role="group" aria-label="AI 엔진">
        <button
          className={cx('flex items-center gap-1 rounded-l-md px-2 py-1 font-semibold', ai.engine === 'claude' ? 'bg-brand text-onbrand' : 'text-muted')}
          onClick={() => (can ? ai.setPreferred('claude') : onSettings())}
          data-testid="engine-claude"
        >
          <span className={cx('h-1.5 w-1.5 rounded-full', can ? 'bg-ok' : 'bg-faint')} />
          Claude
        </button>
        <button className={cx('rounded-r-md px-2 py-1 font-semibold', ai.engine === 'mock' ? 'bg-navy text-surface' : 'text-muted')} onClick={() => ai.setPreferred('mock')} data-testid="engine-rule">
          규칙
        </button>
      </div>
      <button className="flex items-center rounded-md p-1.5 text-muted hover:bg-sunken hover:text-ink" onClick={onSettings} title="AI 설정(API 키)" aria-label="AI 설정" data-testid="ai-settings-open">
        <KeyRound size={15} />
        <span className="ml-1 hidden text-xs font-medium xl:inline">AI 설정</span>
      </button>
    </div>
  );
}

function AISettings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ai = useAI();
  const { toast } = useStore();
  const [key, setKey] = useState('');
  const [model, setModel] = useState(ai.model);
  useEffect(() => {
    if (open) {
      setKey('');
      setModel(ai.model);
    }
  }, [open, ai.model]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="AI 설정 — Claude API 키"
      footer={
        <>
          {ai.status === 'available' && (
            <Button
              variant="ghost"
              onClick={() => {
                ai.setKey('');
                toast('키를 지웠습니다 — 규칙 기반으로 동작합니다');
                onClose();
              }}
              data-testid="ai-key-clear"
            >
              키 지우기
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            닫기
          </Button>
          <Button
            onClick={() => {
              if (key.trim()) ai.setKey(key, model);
              else ai.setKey(null, model);
              ai.setPreferred('claude');
              toast(key.trim() ? '키를 저장했습니다 — Claude로 분석합니다' : '설정을 저장했습니다');
              onClose();
            }}
            disabled={!key.trim() && ai.status !== 'available'}
            data-testid="ai-key-save"
          >
            저장
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-[13px]">
        <p>
          상태: <b data-testid="ai-key-status">{ai.status === 'available' ? '키 있음' : '키 없음'}</b> · 키가 없으면 문서 분석·AI 검색은 규칙 기반으로 동작합니다.
        </p>
        <label className="block">
          <span className="text-xs font-semibold text-muted">API 키 {ai.status === 'available' ? '(바꿀 때만 입력)' : ''}</span>
          <input type="password" autoComplete="off" className="mt-1 w-full rounded-md border border-line2 bg-surface px-3 py-2 font-mono text-[13px]" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-…" data-testid="ai-key-input" />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-muted">모델</span>
          <input className="mt-1 w-full rounded-md border border-line2 bg-surface px-3 py-2 font-mono text-[13px]" value={model} onChange={(e) => setModel(e.target.value)} data-testid="ai-model-input" />
        </label>
        <ul className="list-disc space-y-1 pl-4 text-xs text-muted">
          <li>키는 이 브라우저 저장소에만 저장됩니다(암호화 없음). 데이터 옮기기·백업 파일에는 들어가지 않습니다.</li>
          <li>호출은 api.anthropic.com으로만 가고, 사용량은 본인 키로 과금됩니다. 키를 넣고 Claude 기능(문서 분석·점검·인사이트)을 쓰면 문서 본문과 업무 기록(담당자 이름 포함)이 전송됩니다(「나만 보기」 메모는 보내지 않음) — 실제 업무 문서는 회사의 외부 전송 기준을 확인한 뒤 쓰세요.</li>
          <li>브라우저에서 키를 직접 쓰는 방식은 시연·개인 도구용입니다. 조직 서비스로 쓰려면 서버 중계로 바꿔야 합니다.</li>
        </ul>
      </div>
    </Modal>
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
  { to: '/people', label: '사람', Icon: Users },
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
  const { s, update, reset, toastMsg, toast, saveIssue, reloadFromStorage, dismissSaveIssue } = useStore();
  const [mobile, setMobile] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [dataOpen, setDataOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
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
          <p>사용자·부서·문서는 모두 시연용 가상 자료입니다.</p>
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
                {selectableUsers(s.users, [s.currentUserId]).map((u) => (
                  <option key={u.id} value={u.id}>
                    {displayName(u)} · {u.title}
                  </option>
                ))}
              </select>
            </label>
            <EngineToggle onSettings={() => setAiOpen(true)} />
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
        {saveIssue && (
          <div role="alert" className="flex flex-wrap items-center gap-2 border-b border-danger/30 bg-dangersoft px-4 py-2 text-[13px] text-danger sm:px-6" data-testid="save-issue">
            <span className="flex-1">
              {saveIssue.kind === 'fail'
                ? '이 브라우저 저장소에 저장하지 못했습니다(용량 초과 등). 지금 내용은 이 탭에만 있으니 「데이터 옮기기 → 내보내기」로 파일을 받아 두세요.'
                : '다른 탭에서 데이터가 바뀌었습니다. 이 탭에서 계속 고치면 다른 탭의 변경을 덮어씁니다.'}
            </span>
            {saveIssue.kind === 'other-tab' && (
              <Button size="sm" variant="primary" onClick={reloadFromStorage} data-testid="save-issue-reload">
                다른 탭 내용 불러오기
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={dismissSaveIssue}>
              닫기
            </Button>
          </div>
        )}
        <main id="main-scroll" className="flex-1 overflow-y-auto scroll-thin">
          <div className="mx-auto w-full max-w-[1280px] px-4 py-5 sm:px-6 lg:py-7">{children}</div>
        </main>
      </div>

      <NewWorkModal open={newOpen} onClose={() => setNewOpen(false)} />
      <AISettings open={aiOpen} onClose={() => setAiOpen(false)} />
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
