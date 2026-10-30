import { NEW_WORK, openNewWork } from '../lib/newWork';
import { WorkMap } from '../universe/WorkMap';
import { useEffect, useState } from 'react';
import {
  Sparkles, Pencil, ArrowRightLeft, Gavel, ListTodo, AlertTriangle, Plus, Check, Building2, CircleDot, History, Camera, ScrollText, ChevronRight, Ban, Eye, EyeOff, Users, RefreshCw,
} from 'lucide-react';
import { PrivateMemos } from '../components/PrivateMemos';
import { ReadOnlyCtx, useCanEdit, useReadOnly, useStore, userName, ownerNames, useFocus } from '../lib/store';
import { selectableUsers, displayName } from '../lib/people';
import { useRouter } from '../lib/router';
import { Button, Card, CardHead, StatusBadge, Mono, Tabs, StmtList, ProvChip, SourceChip, CiteLink, ProvLegend, Modal, Field, inputCls, Empty, Tag } from '../components/ui';
import { Timeline } from '../components/Timeline';
import { DocRegisterModal } from '../components/DocRegisterModal';
import { WORK_STATUSES, type Stmt, type Work, type WorkStatus } from '../lib/types';
import { workIssues } from '../ai/engine';
import { effectiveOrgs, orgPathText } from '../lib/orgs';
import { CheckFindings, useClaudeCheck } from '../ai/CheckFindings';
import { fmtDate, fmtDateTime, relDays, dateKey, cx, uid, today as todayLocal } from '../lib/util';

type Tab = 'overview' | 'map' | 'docs' | 'timeline' | 'meetings' | 'actions' | 'history';

export default function WorkDetail({ id }: { id: string }) {
  const { s, update, log, touch, toast, me } = useStore();
  const { query, nav } = useRouter();
  const [tab, setTab] = useState<Tab>((query.get('tab') as Tab) || 'overview');
  const [edit, setEdit] = useState(false);
  const [docOpen, setDocOpen] = useState(false);
  const [ownersOpen, setOwnersOpen] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [pickOpen, setPickOpen] = useState(false);
  const [, setFocus] = useFocus();
  // Claude 점검(키가 있을 때, 「기록 점검」 줄의 단추). 결과는 화면에만
  const cc = useClaudeCheck(s, id);
  const w = s.works.find((x) => x.id === id);
  // 남의 업무는 읽기 전용(사용자 결정 2026-10-29: 팀 업무는 모두가 보고, 고치기는 담당자와 자기 조직 범위의 조직장)
  const ro = !useCanEdit(id);
  // 담당자가 아닌 조직장이 범위 안 업무에서 누르는 「인계 시작」은 담당자 대신 시작하는 흐름이다
  const proxyStart = !ro && !!w && !w.owners.includes(me.id);
  useEffect(() => {
    if (w) setFocus(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, !!w]);
  if (!w) return <Empty title="업무를 찾을 수 없습니다" sub="지워졌거나 아직 불러오지 않은 업무입니다." action={<Button onClick={() => nav('/works')}>업무 목록</Button>} />;

  const docs = s.docs.filter((d) => d.workIds.includes(w.id));
  const nClaude = docs.filter((x) => x.analyzedBy === 'claude').length;
  const nRule = docs.filter((x) => x.analyzedBy === 'mock').length;
  const glanceSource = docs.length
    ? `등록 문서에서 정리 · 분석: ${[nClaude && `AI ${nClaude}`, nRule && `규칙 ${nRule}`, docs.length - nClaude - nRule > 0 && `기록 없음 ${docs.length - nClaude - nRule}`].filter(Boolean).join(' · ')} · 손으로 고친 기록 포함`
    : '등록된 문서 없음 · 손으로 쓴 기록만 있음';
  const reDocs = docs.filter((x) => x.paragraphs?.length);
  const parent = s.works.find((x) => x.id === w.parentId);
  const children = s.works.filter((x) => x.parentId === w.id);
  const related = s.works.filter((x) => w.relatedIds.includes(x.id));
  const decisions = s.decisions.filter((d) => d.workId === w.id).sort((a, b) => dateKey(a.date).localeCompare(dateKey(b.date)));
  const actions = s.actions.filter((a) => a.workId === w.id);
  const open = actions.filter((a) => a.status !== '완료').sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999'));
  const events = s.events.filter((e) => e.workIds.includes(w.id) && e.source !== 'record').sort((a, b) => dateKey(a.date).localeCompare(dateKey(b.date)));
  const issues = workIssues(s, w);
  const today = todayLocal();
  // 「현재 어디까지」는 오늘까지 일어난 이벤트만(앞으로의 계획은 「앞으로 무엇을」 쪽) — 비교 검토 2026-10-29
  const happened = events.filter((e) => dateKey(e.date) <= today);
  const lastStrong = [...happened].reverse().find((e) => e.source === 'original' || e.source === 'cited');
  const lastAny = happened[happened.length - 1];
  const noDate = (t: string) => t.replace(/^\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\.?\s*/, '');

  const setStatus = (st: WorkStatus) =>
    update((d) => {
      const x = d.works.find((y) => y.id === w.id)!;
      log(d, w.id, '상태 변경', `${x.status} → ${st}`);
      x.status = st;
      touch(d, w.id);
    });

  return (
    <ReadOnlyCtx.Provider value={ro}>
    <div className="space-y-5">
      {/* 헤더 */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-1 text-xs text-muted">
          <button className="hover:text-ink" onClick={() => nav('/works')}>업무 관리</button>
          {parent && (
            <>
              <ChevronRight size={12} />
              <button className="hover:text-ink" onClick={() => nav(`/works/${parent.id}`)}>{parent.name}</button>
            </>
          )}
          <ChevronRight size={12} />
          <span className="text-ink">{w.name}</span>
          <select
            id="wd-switch"
            aria-label="업무 선택"
            className={cx(inputCls, 'ml-auto h-8 !w-auto max-w-full py-0 text-xs')}
            value={w.id}
            onChange={(e) => (e.target.value === NEW_WORK ? openNewWork() : nav(`/works/${e.target.value}?tab=${tab}`))}
          >
            {s.works.map((x) => (
              <option key={x.id} value={x.id}>
                {x.id} · {x.name}
              </option>
            ))}
            <option value={NEW_WORK}>＋ 새 업무 등록…</option>
          </select>
          <Button size="sm" variant="ghost" className="h-8" onClick={openNewWork}>
            <Plus size={14} /> 새 업무
          </Button>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[24px] font-bold leading-tight tracking-tight">{w.name}</h1>
              <StatusBadge status={w.status} />
            </div>
            <p className="mt-1 max-w-3xl text-[13.5px] text-muted">{w.summary}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {ro ? null : <select id="wd-status" className={cx(inputCls, 'h-9 !w-auto py-0')} value={w.status} onChange={(e) => setStatus(e.target.value as WorkStatus)} aria-label="진행상태 변경">
              {WORK_STATUSES.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>}
            {!ro && (
              <Button onClick={() => setEdit(true)}>
                <Pencil size={14} />
                업무정보 수정
              </Button>
            )}
            {/* 남의 업무(읽기 전용)는 흐리게 하고 이유를 보인다(처음 사용 점검 M-10) */}
            <span title={ro ? '지금 담당자 또는 이 업무가 속한 조직의 조직장만 인계를 시작할 수 있습니다. 담당자에게 요청하세요.' : undefined}>
              <Button variant="subtle" disabled={ro} onClick={() => nav(`/handover?new=${w.id}`)} data-testid="work-handover-start">
                <ArrowRightLeft size={14} />
                {proxyStart ? '인계 시작(대신)' : '인계 시작'}
              </Button>
            </span>
          </div>
        </div>
        {ro && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-sunken/60 px-4 py-2.5 text-[13px] text-muted" data-testid="work-readonly">
            <Eye size={14} className="shrink-0" />
            <span className="flex-1">
              {ownerNames(s, w.owners) || '담당자 없음'}의 업무입니다. 보기만 할 수 있고, 고치기는 담당자와 이 업무가 속한 조직의 조직장(팀장·부장)이 합니다. 「나만 보기」 메모는 남길 수 있습니다.
            </span>
          </div>
        )}
        <Card className="grid grid-cols-2 gap-x-6 gap-y-2 px-4 py-3 text-[13px] sm:grid-cols-3 lg:grid-cols-6">
          <Meta k="업무 ID"><Mono className="text-[13px] text-ink">{w.id}</Mono></Meta>
          <Meta k="담당자">
            <span className="whitespace-normal">{ownerNames(s, w.owners)}</span>
            {!ro && (
            <button className="ml-1.5 inline-flex items-center gap-0.5 text-2xs font-medium text-brand hover:underline" onClick={() => setOwnersOpen(true)}>
              <Users size={11} />
              변경
            </button>
            )}
          </Meta>
          <Meta k="담당 조직">{orgPathText(effectiveOrgs(s), w.dept)}<span className="ml-1 text-2xs text-faint">가상</span></Meta>
          <Meta k="소관 기관">{w.agency}</Meta>
          <Meta k="최초 등록">{fmtDate(w.createdAt)}</Meta>
          <Meta k="최근 갱신">{fmtDate(w.updatedAt)} <span className="text-2xs text-faint">v{w.version}</span></Meta>
        </Card>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted">업무 계층</span>
          {parent && <HierChip label="상위" name={parent.name} onClick={() => nav(`/works/${parent.id}`)} />}
          {children.map((c) => <HierChip key={c.id} label="하위" name={c.name} onClick={() => nav(`/works/${c.id}`)} />)}
          {related.map((c) => <HierChip key={c.id} label="관련" name={c.name} onClick={() => nav(`/works/${c.id}`)} />)}
          {!parent && !children.length && !related.length && <span className="text-faint">연결된 업무 없음</span>}
        </div>
      </div>

      {/* 한눈에 보기 */}
      <Card className="overflow-hidden border-brand/30">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-brandsoft/40 px-4 py-3">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold">
            <Sparkles size={16} className="text-brand" />
            업무 한눈에 보기
            <span className="text-2xs font-normal text-muted" data-testid="glance-source">{glanceSource}</span>
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            {!ro && reDocs.length > 0 && (
              <div className="relative">
                <Button size="sm" variant="subtle" onClick={() => setPickOpen((x) => !x)} data-testid="glance-reanalyze" aria-expanded={pickOpen}>
                  <RefreshCw size={13} />
                  근거 문서 다시 분석
                </Button>
                {pickOpen && (
                  <ul className="absolute right-0 z-20 mt-1 max-h-72 w-72 overflow-y-auto rounded-lg border border-line bg-surface py-1 text-[13px] shadow-pop" data-testid="glance-reanalyze-menu">
                    {reDocs.map((x) => (
                      <li key={x.id}>
                        <button className="w-full px-3 py-2 text-left hover:bg-sunken/60" onClick={() => { setPickOpen(false); nav(`/docs/${x.id}?reanalyze=1`); }} data-testid={`glance-reanalyze-${x.id}`}>
                          <span className="block font-medium">{x.title}</span>
                          <span className="text-2xs text-muted">{x.analyzedBy === 'claude' ? 'AI' : x.analyzedBy === 'mock' ? '규칙 기반' : '분석 기록 없음'} 분석</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <ProvLegend />
          </div>
        </div>
        <dl className="divide-y divide-line">
          <Glance n="1" q="이 업무는 무엇인가?">
            <StmtList items={w.purpose.length ? w.purpose : []} empty="업무 목적이 작성되지 않았습니다 — 업무정보 수정에서 입력하세요" />
          </Glance>
          <Glance n="2" q="왜 시작했는가?">
            <StmtList items={w.background} empty="추진 배경이 작성되지 않았습니다 — 근거 문서 등록 필요" />
          </Glance>
          <Glance n="3" q="지금까지 무엇을 했고, 무엇을 결정했는가?">
            {decisions.length ? (
              <>
                <ul className="space-y-2">
                  {decisions
                    .filter((d) => !d.hidden || showHidden)
                    .map((d) => (
                      <li key={d.id} className={cx('group flex flex-wrap items-start gap-x-2 gap-y-1', d.hidden && 'opacity-55')}>
                        <span className="w-[100px] shrink-0 whitespace-nowrap font-mono text-xs text-muted tnum">{fmtDate(d.date)}</span>
                        <span className="min-w-0 flex-1 text-[13.5px]">
                          {d.title}
                          {d.hidden && <span className="ml-1.5 rounded bg-sunken px-1 text-2xs text-muted">숨김</span>}
                        </span>
                        <span className="flex flex-wrap items-center gap-1">
                          <ProvChip prov={d.prov} />
                          {d.cite.map((c, i) => <CiteLink key={i} c={c} />)}
                          {!ro && (
                          <button
                            className="ml-1 inline-flex items-center gap-0.5 rounded px-1 py-px text-2xs text-muted hover:bg-sunken hover:text-ink"
                            title={d.hidden ? '숨기기 취소' : '한눈에 보기에서 숨기기'}
                            onClick={() =>
                              update((dr) => {
                                const x = dr.decisions.find((y) => y.id === d.id)!;
                                x.hidden = !x.hidden;
                                log(dr, w.id, '표시 변경', `한눈에 보기 결정사항 '${x.title}' ${x.hidden ? '숨김' : '숨김 취소'}`);
                              })
                            }
                          >
                            {d.hidden ? <Eye size={12} /> : <EyeOff size={12} />}
                            {d.hidden ? '숨기기 취소' : '숨기기'}
                          </button>
                          )}
                        </span>
                      </li>
                    ))}
                </ul>
                {decisions.some((d) => d.hidden) && (
                  <button className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline" onClick={() => setShowHidden((x) => !x)}>
                    {showHidden ? <EyeOff size={12} /> : <Eye size={12} />}
                    {showHidden ? '숨긴 항목 감추기' : `숨긴 항목 ${decisions.filter((d) => d.hidden).length}건 보기`}
                  </button>
                )}
                {decisions.every((d) => d.hidden) && !showHidden && <p className="text-[13px] text-muted">모든 결정사항이 숨겨져 있습니다.</p>}
              </>
            ) : (
              <p className="text-[13px] text-warn">등록된 결정사항 없음</p>
            )}
            <p className="mt-2 text-xs text-muted">
              추진 이벤트 {events.length}건 (원문 근거 {events.filter((e) => e.source === 'original' || e.source === 'cited').length}건) ·{' '}
              <button className="text-brand hover:underline" onClick={() => setTab('timeline')}>타임라인 보기</button>
            </p>
          </Glance>
          <Glance n="4" q="현재 어디까지 진행되었는가?">
            <div className="mb-2 flex flex-wrap gap-2 text-xs">
              {lastStrong && (
                <span className="rounded-md border border-fact/30 bg-factsoft/60 px-2 py-1">
                  <b className="text-fact">원문으로 확인된 최근 단계</b> · {fmtDate(lastStrong.date)} {noDate(lastStrong.title)}
                </span>
              )}
              {lastAny && lastAny !== lastStrong && (
                <span className="rounded-md border border-warn/30 bg-warnsoft/60 px-2 py-1">
                  <b className="text-warn">참고정보상 최근 단계</b> · {fmtDate(lastAny.date)} {noDate(lastAny.title)}
                </span>
              )}
            </div>
            <StmtList items={w.current} empty="현재 진행 사항이 작성되지 않았습니다" />
          </Glance>
          <Glance n="5" q="앞으로 무엇을 해야 하는가?">
            {open.length ? (
              <ul className="space-y-1.5">
                {open.slice(0, 5).map((a) => {
                  const od = a.due && a.due < today;
                  return (
                    <li key={a.id} className="flex flex-wrap items-center gap-2 text-[13.5px]">
                      <CircleDot size={13} className={od ? 'text-danger' : 'text-brand'} />
                      <span className="min-w-0 flex-1">{a.title}</span>
                      <span className={cx('text-xs font-semibold tnum', od ? 'text-danger' : a.due ? 'text-muted' : 'text-warn')}>{a.due ? `${fmtDate(a.due)}${od ? ' 경과' : ''}` : '기한 미지정'}</span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-[13px] text-warn">등록된 향후 조치사항 없음</p>
            )}
          </Glance>
        </dl>
        {(issues.length > 0 || cc.saved || (cc.available && !ro)) && (
          <div className="border-t border-line bg-sunken/50 px-4 py-2.5">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="flex items-center gap-1 font-semibold text-warn"><AlertTriangle size={13} />기록 점검</span>
              {!issues.length && <span className="text-muted">규칙 점검에서 찾은 것 없음</span>}
              {issues.map((i) => (
                <button key={i.id} onClick={() => setTab((new URLSearchParams(i.to.split('?')[1] ?? '').get('tab') as Tab) || 'overview')} className={cx('rounded px-1.5 py-0.5 font-medium', i.severity === 'high' ? 'bg-dangersoft text-danger' : i.severity === 'mid' ? 'bg-warnsoft text-warn' : 'bg-surface text-muted')}>
                  {i.title}
                </button>
              ))}
              {cc.available && !ro && !cc.running && (
                <button className="ml-auto inline-flex items-center gap-1 rounded border border-infer/30 bg-surface px-2 py-0.5 font-medium text-infer hover:bg-infersoft" onClick={() => void cc.run()} title="업무 기록과 연결 문서를 AI가 대조해, 문서에는 있는데 기록에 빠진 것·서로 다른 것을 찾습니다" data-testid="work-claude-check">
                  <Sparkles size={12} />
                  {cc.result || cc.saved ? 'AI로 다시 점검' : 'AI로 점검'}
                </button>
              )}
            </div>
            <CheckFindings state={cc} className="mt-2" />
          </div>
        )}
      </Card>

      {/* 결정사항 + 향후 조치 */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="min-w-0">
          <CardHead icon={<Gavel size={16} />} title="주요 결정사항" sub="회의록에서 추출된 결정은 근거 위치로 이동 가능" right={<button className="text-xs text-brand" onClick={() => setTab('meetings')}>전체</button>} />
          <ul className="divide-y divide-line">
            {decisions.map((d) => (
              <li key={d.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-xs text-muted">{fmtDate(d.date)}</span>
                  <SourceChip s={d.source} short />
                </div>
                <p className="mt-1 text-[13.5px] font-medium leading-snug">{d.title}</p>
                {d.prov === 'fact' && (
                  <ul className="mt-1.5 space-y-0.5 text-xs text-muted">
                    {d.details.slice(0, 4).map((x, i) => (
                      <li key={i}>· {x}</li>
                    ))}
                  </ul>
                )}
                <div className="mt-1.5 flex flex-wrap gap-1">{d.cite.map((c, i) => <CiteLink key={i} c={c} />)}</div>
              </li>
            ))}
            {!decisions.length && <li className="px-4 py-6 text-center text-[13px] text-muted">결정사항 없음</li>}
          </ul>
        </Card>
        <ActionsCard workId={w.id} compact onAll={() => setTab('actions')} />
      </div>

      <div>
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'overview', label: '업무 개요' },
            { id: 'map', label: '업무 지도' },
            { id: 'docs', label: '관련 문서', count: docs.length },
            { id: 'timeline', label: '추진 타임라인', count: events.length },
            { id: 'meetings', label: '회의록 및 의사결정', count: decisions.length },
            { id: 'actions', label: '향후 조치 및 유의사항', count: open.length },
            { id: 'history', label: '담당자·변경 이력' },
          ]}
        />
        <div className="pt-5">
          {tab === 'overview' && (
            <div className="space-y-5">
              <Overview w={w} />
              <PrivateMemos workId={w.id} />
            </div>
          )}
          {tab === 'map' && <WorkMap workId={w.id} />}
          {tab === 'docs' && <DocsTab w={w} onAdd={() => setDocOpen(true)} />}
          {tab === 'timeline' && (
            <Card className="p-4 sm:p-5">
              <Timeline workId={w.id} />
            </Card>
          )}
          {tab === 'meetings' && <MeetingsTab w={w} />}
          {tab === 'actions' && (
            <div className="grid gap-5 lg:grid-cols-2">
              <ActionsCard workId={w.id} />
              <CautionsCard w={w} />
            </div>
          )}
          {tab === 'history' && <HistoryTab w={w} />}
        </div>
      </div>

      {ownersOpen && <OwnersModal w={w} onClose={() => setOwnersOpen(false)} />}
      {edit && <EditWorkModal open onClose={() => setEdit(false)} w={w} onSave={() => toast('업무정보를 저장했습니다')} />}
      <DocRegisterModal open={docOpen} onClose={() => setDocOpen(false)} presetWork={w.id} />
    </div>
    </ReadOnlyCtx.Provider>
  );
}

function Meta({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-2xs text-muted">{k}</div>
      <div className="truncate font-medium">{children}</div>
    </div>
  );
}
function HierChip({ label, name, onClick }: { label: string; name: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="inline-flex items-center gap-1.5 rounded-full border border-line2 bg-surface px-2.5 py-1 hover:border-brand/50">
      <span className="text-2xs font-semibold text-faint">{label}</span>
      <span className="font-medium">{name}</span>
    </button>
  );
}
function Glance({ n, q, children }: { n: string; q: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2 px-4 py-3.5 md:grid-cols-[230px_1fr] md:gap-5">
      <dt className="flex items-start gap-2 text-[13.5px] font-semibold text-navy">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-navy text-2xs font-bold text-surface">{n}</span>
        {q}
      </dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border-b border-line px-4 py-4 last:border-0">
      <h3 className="mb-2.5 flex items-center gap-1.5 text-[13.5px] font-semibold text-navy">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}

function Overview({ w }: { w: Work }) {
  const { s } = useStore();
  const { nav } = useRouter();
  const events = s.events.filter((e) => e.workIds.includes(w.id) && e.source !== 'record').sort((a, b) => dateKey(a.date).localeCompare(dateKey(b.date)));
  return (
    <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
      <Card className="min-w-0">
        <Section title="업무 목적"><StmtList items={w.purpose} /></Section>
        <Section title="추진 배경"><StmtList items={w.background} /></Section>
        <Section title="주요 추진 경과">
          {events.length ? (
            <ol className="space-y-1.5">
              {events.map((e) => (
                <li key={e.id}>
                  <button onClick={() => nav(`/timeline?work=${w.id}&event=${e.id}`)} className="flex w-full flex-wrap items-center gap-2 text-left text-[13px] hover:text-brand">
                    <span className="w-[100px] shrink-0 whitespace-nowrap font-mono text-xs text-muted tnum">{fmtDate(e.date)}</span>
                    <span className="min-w-0 flex-1">{e.title}</span>
                    <SourceChip s={e.source} short />
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-[13px] text-warn">등록된 추진 경과 없음</p>
          )}
        </Section>
        <Section title="현재 진행 중인 사항"><StmtList items={w.current} /></Section>
        <Section title="검토했으나 채택하지 않은 대안" icon={<Ban size={14} />}>
          <StmtList items={w.rejected} empty="등록된 내용 없음 — 검토 대안이 있었다면 근거 문서와 함께 기록 필요" />
        </Section>
      </Card>
      <div className="space-y-5">
        <Card>
          <CardHead icon={<Building2 size={16} />} title="관계부서 및 협의기관" />
          <ul className="divide-y divide-line">
            {w.partners.map((p, i) => (
              <li key={i} className="px-4 py-2.5">
                <div className="text-[13.5px] font-medium">{p.name}</div>
                <div className="text-xs text-muted">{p.role}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  <ProvChip prov={p.prov} />
                  {p.cite?.map((c, j) => <CiteLink key={j} c={c} />)}
                  {p.note && <span className="text-2xs text-faint">{p.note}</span>}
                </div>
              </li>
            ))}
            {!w.partners.length && <li className="px-4 py-4 text-[13px] text-warn">등록된 관계부서·협의기관 없음</li>}
          </ul>
        </Card>
        <Card>
          <CardHead icon={<AlertTriangle size={16} />} title="주요 유의사항" />
          <div className="px-4 py-3">
            <StmtList items={w.cautions} />
          </div>
        </Card>
        <Card>
          <CardHead title="키워드" />
          <div className="flex flex-wrap gap-1.5 px-4 py-3">
            {w.keywords.length ? w.keywords.map((k) => <Tag key={k}>{k}</Tag>) : <span className="text-xs text-faint">없음</span>}
          </div>
        </Card>
      </div>
    </div>
  );
}

function DocsTab({ w, onAdd }: { w: Work; onAdd: () => void }) {
  const { s } = useStore();
  const { nav } = useRouter();
  const docs = s.docs.filter((d) => d.workIds.includes(w.id)).sort((a, b) => dateKey(b.writtenAt || '0').localeCompare(dateKey(a.writtenAt || '0')));
  const excluded = s.docs.filter((d) => d.relevance?.some((r) => r.workId === w.id && r.level === 'none'));
  const ro = useReadOnly();
  return (
    <div className="space-y-4">
      <div className={cx('flex justify-end', ro && 'hidden')}>
        <Button variant="primary" onClick={onAdd}>
          <Plus size={15} />
          이 업무에 문서 등록
        </Button>
      </div>
      <Card className="overflow-x-auto scroll-thin">
        <table className="w-full min-w-[720px] text-[13px]">
          <thead>
            <tr className="border-b border-line bg-sunken/60 text-left text-xs text-muted">
              <th className="px-4 py-2.5 font-semibold">문서명</th>
              <th className="px-3 py-2.5 font-semibold">유형</th>
              <th className="px-3 py-2.5 font-semibold">작성일</th>
              <th className="px-3 py-2.5 font-semibold">관계</th>
            </tr>
          </thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.id} className="cursor-pointer border-b border-line last:border-0 hover:bg-sunken/50" onClick={() => nav(`/docs/${d.id}`)}>
                <td className="px-4 py-2.5">
                  <div className="font-medium">{d.title}</div>
                  {d.summary[0] && <div className="line-clamp-1 text-2xs text-muted">{d.summary[1] ?? d.summary[0]}</div>}
                </td>
                <td className="px-3 py-2.5">{d.type}</td>
                <td className="px-3 py-2.5 text-muted tnum">{fmtDate(d.writtenAt)}</td>
                <td className="px-3 py-2.5 text-2xs text-muted">{d.relations.map((r) => r.type).join(' · ') || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {excluded.length > 0 && (
        <Card className="border-dashed">
          <CardHead title="AI가 검토 후 연결하지 않은 문서" sub="함께 등록되었으나 이 업무와 직접 관련성이 없다고 판단됨" />
          <ul className="divide-y divide-line">
            {excluded.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-[13px]">
                <ScrollText size={14} className="text-faint" />
                <button className="font-medium hover:text-brand" onClick={() => nav(`/docs/${d.id}`)}>{d.title}</button>
                <span className="text-xs text-muted">— {d.relevance?.find((r) => r.workId === w.id)?.reason}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function MeetingsTab({ w }: { w: Work }) {
  const { s } = useStore();
  const { nav } = useRouter();
  const decisions = s.decisions.filter((d) => d.workId === w.id).sort((a, b) => dateKey(a.date).localeCompare(dateKey(b.date)));
  // 이 업무에 연결된 회의록 + 이 업무 기준으로 AI가 실제 판단한 회의록만 (판단 이력 없는 회의록은 표시하지 않음)
  const minutes = s.docs.filter((d) => d.type === '회의록' && (d.workIds.includes(w.id) || d.relevance?.some((r) => r.workId === w.id)));
  return (
    <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
      <div className="space-y-3">
        {decisions.map((d) => (
          <Card key={d.id} className="p-4">
            <div className="flex flex-wrap items-center gap-1.5">
              <Mono>{d.id}</Mono>
              <span className="font-mono text-xs text-muted">{fmtDate(d.date)}</span>
              <SourceChip s={d.source} />
              <ProvChip prov={d.prov} />
            </div>
            <h4 className="mt-1.5 text-[14px] font-semibold leading-snug">{d.title}</h4>
            <ul className="mt-2 space-y-1 text-[13px]">
              {d.details.map((x, i) => (
                <li key={i} className="flex gap-2">
                  <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-faint" />
                  {x}
                </li>
              ))}
            </ul>
            <div className="mt-3 rounded-md bg-sunken/70 px-3 py-2">
              <div className="text-2xs font-semibold text-muted">결정 이유</div>
              <p className="text-[13px]">{d.rationale.text}</p>
              <div className="mt-1"><ProvChip prov={d.rationale.prov} /></div>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {d.cite.map((c, i) => <CiteLink key={i} c={c} />)}
              {d.eventId && (
                <button onClick={() => nav(`/timeline?work=${w.id}&event=${d.eventId}`)} className="inline-flex items-center gap-1 rounded border border-line2 px-1.5 py-px text-2xs text-muted hover:text-ink">
                  타임라인 위치
                </button>
              )}
            </div>
          </Card>
        ))}
        {!decisions.length && <Card><Empty title="등록된 결정사항이 없습니다" /></Card>}
      </div>
      <Card className="self-start">
        <CardHead icon={<ScrollText size={16} />} title="회의록 관련성" sub="이 업무에 연결된 회의록과, 이 업무 기준으로 AI가 검토한 회의록" />
        {minutes.length === 0 && <p className="px-4 py-4 text-[13px] text-muted">연결된 회의록 없음</p>}
        <ul className="divide-y divide-line">
          {minutes.map((d) => {
            const r = d.relevance?.find((x) => x.workId === w.id);
            return (
              <li key={d.id}>
                <button onClick={() => nav(`/meetings/${d.id}`)} className="w-full px-4 py-3 text-left hover:bg-sunken/60">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13.5px] font-medium">{d.title}</span>
                    {d.workIds.includes(w.id) ? (
                      <span className="rounded bg-factsoft px-1.5 text-2xs font-semibold text-fact">연결됨</span>
                    ) : (
                      <span className="rounded bg-sunken px-1.5 text-2xs font-semibold text-muted">검토 후 제외</span>
                    )}
                  </div>
                  {r?.reason && <p className="mt-0.5 text-xs text-muted">{r.reason}</p>}
                </button>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}

export function ActionsCard({ workId, compact, onAll }: { workId: string; compact?: boolean; onAll?: () => void }) {
  const { s, update, log, touch, toast } = useStore();
  const ro = useReadOnly();
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  // 체크박스는 '완료 처리 예정'으로만 표시하고, 저장을 눌러야 실제로 반영
  const [pending, setPending] = useState<string[]>([]);
  const togglePending = (id: string) => setPending((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const savePending = () => {
    const n = pending.length;
    update((d) => {
      pending.forEach((id) => {
        const x = d.actions.find((y) => y.id === id);
        if (!x) return;
        x.status = x.status === '완료' ? '진행' : '완료';
        log(d, workId, '조치사항', `${x.title} → ${x.status}`);
      });
      touch(d, workId);
    });
    setPending([]);
    toast(`조치사항 ${n}건을 저장했습니다`);
  };
  const acts = s.actions.filter((a) => a.workId === workId).sort((a, b) => (a.status === '완료' ? 1 : 0) - (b.status === '완료' ? 1 : 0) || (a.due ?? '9999').localeCompare(b.due ?? '9999'));
  const list = compact ? acts.filter((a) => a.status !== '완료').slice(0, 5) : acts;
  const today = todayLocal();
  return (
    <Card className="min-w-0">
      <CardHead icon={<ListTodo size={16} />} title="향후 조치사항 및 기한" sub={compact ? '미완료 우선 · 기한순' : ro ? '보기 전용' : '상태를 눌러 변경'} right={onAll && <button className="text-xs text-brand" onClick={onAll}>전체</button>} />
      <ul className="divide-y divide-line">
        {list.map((a) => {
          const od = a.due && a.due < today && a.status !== '완료';
          const isPending = pending.includes(a.id);
          const checked = (a.status === '완료') !== isPending;
          return (
            <li key={a.id} className={cx('flex items-start gap-3 px-4 py-2.5', isPending && 'bg-brandsoft/40')}>
              <button
                role="checkbox"
                aria-checked={checked}
                aria-label={a.status === '완료' ? '완료 취소 선택' : '완료 처리 선택'}
                onClick={() => togglePending(a.id)}
                disabled={ro}
                className={cx(
                  'mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded border',
                  checked ? (isPending ? 'border-brand bg-brand text-onbrand' : 'border-ok bg-ok text-surface') : isPending ? 'border-brand border-dashed' : 'border-line2 hover:border-brand',
                )}
              >
                {checked && <Check size={12} strokeWidth={3} />}
              </button>
              <div className="min-w-0 flex-1">
                <p className={cx('text-[13.5px] leading-snug', a.status === '완료' && !isPending && 'text-faint line-through')}>
                  {a.title}
                  {isPending && <span className="ml-1.5 rounded bg-brandsoft px-1 text-2xs font-semibold text-brand">{a.status === '완료' ? '완료 취소 예정' : '완료 처리 예정'}</span>}
                </p>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-2xs text-muted">
                  <span className={cx('font-semibold tnum', od ? 'text-danger' : a.due ? '' : 'text-warn')}>{a.due ? `기한 ${fmtDate(a.due)}${od ? ' · 경과' : ''}` : '기한 미지정'}</span>
                  <span>{userName(s, a.ownerId)}</span>
                  {!compact && (
                    <select
                      aria-label="진행 상태"
                      className="rounded border border-line bg-surface px-1 text-2xs"
                      value={a.status}
                      onChange={(e) =>
                        update((d) => {
                          const x = d.actions.find((y) => y.id === a.id)!;
                          x.status = e.target.value as typeof x.status;
                          log(d, workId, '조치사항', `${x.title} → ${x.status}`);
                          touch(d, workId);
                        })
                      }
                    >
                      {['예정', '진행', '완료'].map((x) => (
                        <option key={x}>{x}</option>
                      ))}
                    </select>
                  )}
                  {!compact && (
                    <input
                      type="date"
                      aria-label="기한"
                      className="rounded border border-line bg-surface px-1 text-2xs"
                      value={a.due ?? ''}
                      onChange={(e) =>
                        update((d) => {
                          const x = d.actions.find((y) => y.id === a.id)!;
                          x.due = e.target.value || null;
                          log(d, workId, '조치사항', `${x.title} 기한 → ${x.due ?? '미지정'}`);
                          touch(d, workId);
                        })
                      }
                    />
                  )}
                  {a.note && <span className="text-faint">{a.note}</span>}
                </div>
                {!compact && a.cite && <div className="mt-1 flex flex-wrap gap-1">{a.cite.map((c, i) => <CiteLink key={i} c={c} />)}</div>}
              </div>
            </li>
          );
        })}
        {!list.length && <li className="px-4 py-6 text-center text-[13px] text-muted">미완료 조치사항 없음</li>}
      </ul>
      {pending.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line bg-brandsoft/40 px-4 py-2.5">
          <span className="mr-auto text-xs font-medium text-brand">선택한 {pending.length}건 — 저장해야 반영됩니다</span>
          <Button size="sm" variant="ghost" onClick={() => setPending([])}>
            선택 취소
          </Button>
          <Button size="sm" variant="primary" onClick={savePending}>
            저장
          </Button>
        </div>
      )}
      {!compact && !ro && (
        <form
          className="flex flex-wrap gap-2 border-t border-line px-4 py-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim()) return;
            update((d) => {
              d.actions.push({ id: uid('A'), workId, title: title.trim(), due: due || null, status: '예정', ownerId: d.currentUserId, createdAt: new Date().toISOString() });
              log(d, workId, '조치사항', `추가: ${title.trim()}`);
              touch(d, workId);
            });
            setTitle('');
            setDue('');
            toast('조치사항을 추가했습니다');
          }}
        >
          <input id={`act-title-${workId}`} className={cx(inputCls, 'min-w-[180px] flex-1')} placeholder="새 조치사항" value={title} onChange={(e) => setTitle(e.target.value)} />
          <input id={`act-due-${workId}`} type="date" className={cx(inputCls, '!w-auto')} value={due} onChange={(e) => setDue(e.target.value)} aria-label="기한" />
          <Button type="submit" variant="primary">
            <Plus size={14} />
            추가
          </Button>
        </form>
      )}
    </Card>
  );
}

function CautionsCard({ w }: { w: Work }) {
  const { update, log, touch } = useStore();
  const ro = useReadOnly();
  const [t, setT] = useState('');
  return (
    <Card className="min-w-0 self-start">
      <CardHead icon={<AlertTriangle size={16} />} title="주요 유의사항" sub="후임자가 반드시 알아야 할 주의점" />
      <div className="px-4 py-3">
        <StmtList items={w.cautions} />
      </div>
      <form
        className={cx('flex gap-2 border-t border-line px-4 py-3', ro && 'hidden')}
        onSubmit={(e) => {
          e.preventDefault();
          if (!t.trim()) return;
          update((d) => {
            d.works.find((x) => x.id === w.id)!.cautions.push({ id: uid('k'), text: t.trim(), prov: 'owner' });
            log(d, w.id, '내용 수정', `유의사항 추가: ${t.trim()}`);
            touch(d, w.id);
          });
          setT('');
        }}
      >
        <input id="caution-new" className={cx(inputCls, 'flex-1')} placeholder="유의사항 추가" value={t} onChange={(e) => setT(e.target.value)} />
        <Button type="submit">추가</Button>
      </form>
    </Card>
  );
}

function HistoryTab({ w }: { w: Work }) {
  const { s } = useStore();
  const { nav } = useRouter();
  const hist = s.history.filter((h) => h.workId === w.id).sort((a, b) => b.at.localeCompare(a.at));
  const periods = [...w.ownerHistory].sort((a, b) => (a.to === null ? -1 : 0) - (b.to === null ? -1 : 0) || b.from.localeCompare(a.from));
  const hos = s.handovers.filter((h) => h.workId === w.id);
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
      <div className="space-y-5">
        <Card>
          <CardHead icon={<History size={16} />} title="담당자 이력" sub="담당에서 빠진 사람도 담당 기간이 남습니다" />
          <ul className="divide-y divide-line">
            {periods.map((p, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-2 px-4 py-2.5 text-[13px]">
                <b>{userName(s, p.userId)}</b>
                <span className="text-xs text-muted tnum">
                  {fmtDate(p.from)} ~ {p.to ? fmtDate(p.to) : '현재'}
                </span>
                {!p.to && <span className="rounded bg-oksoft px-1 text-2xs font-semibold text-ok">현 담당</span>}
                {p.note && <span className="w-full text-2xs text-faint">{p.note}</span>}
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHead icon={<Camera size={16} />} title="인계 기록 · 스냅샷" />
          <ul className="divide-y divide-line">
            {hos.map((h) => (
              <li key={h.id} className="px-4 py-2.5 text-[13px]">
                <button className="font-medium hover:text-brand" onClick={() => nav(`/handover/${h.id}`)}>
                  {h.id} · {userName(s, h.fromId)} → {userName(s, h.toId)}
                </button>
                <div className="flex flex-wrap items-center gap-2 text-2xs text-muted">
                  <span>기준일 {fmtDate(h.baseDate)}</span>
                  <span>{h.status === 'confirmed' ? '확정' : '진행 중'}</span>
                  {h.snapshotId && (
                    <button className="font-semibold text-brand" onClick={() => nav(`/snapshots/${h.snapshotId}`)}>
                      당시 스냅샷 보기
                    </button>
                  )}
                </div>
              </li>
            ))}
            {!hos.length && <li className="px-4 py-4 text-[13px] text-muted">인계 기록 없음</li>}
          </ul>
        </Card>
      </div>
      <Card className="min-w-0">
        <CardHead title="업무정보 변경 이력" sub={`현재 버전 v${w.version}`} />
        <ul className="divide-y divide-line">
          {hist.map((h) => (
            <li key={h.id} className="grid grid-cols-[120px_1fr] gap-3 px-4 py-2.5 text-[13px]">
              <span className="text-xs text-muted tnum">{fmtDateTime(h.at)}</span>
              <span>
                <span className={cx('mr-1.5 rounded px-1 text-2xs font-semibold', h.actorId === 'ai' ? 'bg-infersoft text-infer' : 'bg-sunken text-muted')}>{h.kind}</span>
                {h.summary}
                <span className="ml-1.5 text-2xs text-faint">{userName(s, h.actorId)} · {relDays(h.at)}</span>
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

// ─── 업무정보 수정 ───
const FIELDS: { key: 'purpose' | 'background' | 'current' | 'rejected'; label: string }[] = [
  { key: 'purpose', label: '업무 목적' },
  { key: 'background', label: '추진 배경' },
  { key: 'current', label: '현재 진행 중인 사항' },
  { key: 'rejected', label: '검토했으나 채택하지 않은 대안' },
];
function EditWorkModal({ open, onClose, w, onSave }: { open: boolean; onClose: () => void; w: Work; onSave: () => void }) {
  const { update, log, touch } = useStore();
  const toText = (xs: Stmt[]) => xs.map((x) => x.text).join('\n');
  const [summary, setSummary] = useState(w.summary);
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(FIELDS.map((f) => [f.key, toText(w[f.key])])));
  const [partners, setPartners] = useState(w.partners.map((p) => `${p.name} | ${p.role}`).join('\n'));
  const [kw, setKw] = useState(w.keywords.join(', '));
  const merge = (old: Stmt[], text: string): Stmt[] =>
    text
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean)
      .map((line) => old.find((o) => o.text === line) ?? { id: uid('s'), text: line, prov: 'owner' as const });
  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title="업무정보 수정"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>취소</Button>
          <Button
            variant="primary"
            onClick={() => {
              update((d) => {
                const x = d.works.find((y) => y.id === w.id)!;
                const changed: string[] = [];
                if (x.summary !== summary) changed.push('업무 요약');
                x.summary = summary;
                FIELDS.forEach((f) => {
                  const nv = merge(x[f.key], vals[f.key]);
                  if (toText(nv) !== toText(x[f.key])) changed.push(f.label);
                  x[f.key] = nv;
                });
                const np = partners
                  .split('\n')
                  .map((l) => l.trim())
                  .filter(Boolean)
                  .map((l) => {
                    const [name, role] = l.split('|').map((y) => y.trim());
                    return x.partners.find((p) => p.name === name && p.role === (role ?? '')) ?? { name, role: role ?? '', prov: 'owner' as const };
                  });
                if (JSON.stringify(np) !== JSON.stringify(x.partners)) changed.push('관계부서');
                x.partners = np;
                x.keywords = kw.split(',').map((k) => k.trim()).filter(Boolean);
                log(d, w.id, '내용 수정', changed.length ? `${changed.join(', ')} 수정` : '변경 없음');
                touch(d, w.id);
              });
              onSave();
              onClose();
            }}
          >
            저장
          </Button>
        </>
      }
    >
      <p className="mb-3 rounded-md bg-sunken px-3 py-2 text-xs text-muted">
        한 줄이 한 항목입니다. 기존 문장을 그대로 두면 근거 표시(원문 확인·AI 추론)가 유지되고, 새로 쓰거나 고친 문장은 '담당자 작성'으로 표시됩니다.
      </p>
      <div className="space-y-3">
        <Field label="업무 요약" htmlFor="ew-summary">
          <input id="ew-summary" className={inputCls} value={summary} onChange={(e) => setSummary(e.target.value)} />
        </Field>
        {FIELDS.map((f) => (
          <Field key={f.key} label={f.label} htmlFor={`ew-${f.key}`}>
            <textarea id={`ew-${f.key}`} className={cx(inputCls, 'min-h-[76px]')} value={vals[f.key]} onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))} />
          </Field>
        ))}
        <Field label="관계부서 및 협의기관 (기관명 | 역할)" htmlFor="ew-partners">
          <textarea id="ew-partners" className={cx(inputCls, 'min-h-[64px]')} value={partners} onChange={(e) => setPartners(e.target.value)} />
        </Field>
        <Field label="키워드 (쉼표 구분)" htmlFor="ew-kw">
          <input id="ew-kw" className={inputCls} value={kw} onChange={(e) => setKw(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

// ─── 담당자 지정 (복수) ───
function OwnersModal({ w, onClose }: { w: Work; onClose: () => void }) {
  const { s, update, log, touch, toast } = useStore();
  const [sel, setSel] = useState<string[]>(w.owners);
  const save = () => {
    update((d) => {
      const x = d.works.find((y) => y.id === w.id)!;
      const now = new Date().toISOString();
      const added = sel.filter((u) => !x.owners.includes(u));
      const removed = x.owners.filter((u) => !sel.includes(u));
      added.forEach((u) => x.ownerHistory.push({ userId: u, from: now, to: null, note: '담당자 지정' }));
      removed.forEach((u) =>
        x.ownerHistory.filter((p) => p.userId === u && !p.to).forEach((p) => {
          p.to = now;
          p.note = `${p.note ? p.note + ' · ' : ''}담당 해제`;
        }),
      );
      x.owners = [...sel];
      if (added.length || removed.length) {
        log(d, w.id, '담당자 변경', [added.length && `추가: ${added.map((u) => userName(d, u)).join(', ')}`, removed.length && `해제: ${removed.map((u) => userName(d, u)).join(', ')}`].filter(Boolean).join(' / '));
        touch(d, w.id);
      }
    });
    toast('담당자를 저장했습니다');
    onClose();
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="담당자 지정"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>취소</Button>
          <Button variant="primary" onClick={save} disabled={!sel.length}>저장</Button>
        </>
      }
    >
      <p className="mb-3 text-xs text-muted">여러 명을 지정할 수 있습니다. 해제한 담당자는 담당 기간(언제부터 언제까지)이 담당자 이력에 남습니다. 담당을 넘길 때는 '인계 시작'을 이용하면 점검·확인 절차와 스냅샷이 함께 기록됩니다.</p>
      <div className="space-y-2">
        {selectableUsers(s.users, sel).map((u) => (
          <label key={u.id} className="flex items-center gap-2.5 rounded-md border border-line px-3 py-2 text-[13.5px]">
            <input type="checkbox" className="accent-[rgb(var(--brand))]" checked={sel.includes(u.id)} onChange={(e) => setSel((x) => (e.target.checked ? [...x, u.id] : x.filter((y) => y !== u.id)))} />
            <span className="font-medium">{displayName(u)}</span>
            <span className="text-xs text-muted">{u.title}</span>
          </label>
        ))}
      </div>
      {!sel.length && <p className="mt-2 text-xs text-warn">담당자는 최소 1명이어야 합니다.</p>}
    </Modal>
  );
}
