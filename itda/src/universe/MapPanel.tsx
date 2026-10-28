// 지도 + 항목 카드 + 위험 점검(CR-24 D24-3·D24-5·D24-6). 업무 지도(①, 업무 상세 탭)와 업무 유니버스 메뉴(②③)가 함께 쓴다.
import { useMemo, useState } from 'react';
import { ArrowRight, ExternalLink, EyeOff, Eye, FileText, Link2, StickyNote, Tag as TagIcon, UserPlus, X, AlertTriangle } from 'lucide-react';
import { useStore } from '../lib/store';
import { useRouter } from '../lib/router';
import { Button, CiteLink, Mono, StatusBadge, inputCls } from '../components/ui';
import { cx, fmtDate, today } from '../lib/util';
import type { AppState } from '../lib/types';
import { deriveMap, hideKey, type MapScope, type Origin, type Derived } from './derive';
import { MapLegend, MapView, useMapView } from './MapView';
import { addMemo, addTopic, assignOwner, linkWorks, LINK_NAMES, MEMO_NAMES, removeTopic, setMapHidden, unlinkWorks, type Change, type LinkKind, type MemoKind } from './commands';
// @ts-expect-error 유니버스 순수 모듈(JS)
import { soloWorks } from '../../../app/src/view/space-marks.js';
// @ts-expect-error 유니버스 순수 모듈(JS)
import { buildView } from '../../../app/src/view/view.js';
// @ts-expect-error 유니버스 순수 모듈(JS)
import { teamRiskSummary, teamRiskParts } from '../../../app/src/view/risk-summary.js';

const SOLO_CLS = 'mk-solo';

/** 지도의 전역 ID → 원래 항목(합쳐진 노드는 합쳐진 것 중 아무거나 — 같은 항목) */
function originOfGid(d: Derived, view: any, gid: string | null): Origin | null {
  if (!gid) return null;
  const n = view.getNode(gid);
  for (const g of [gid, ...(n?.merged_from || [])]) {
    const o = d.origin.get(g);
    if (o) return o;
  }
  return null;
}

/** 원래 항목 → 지금 지도의 전역 ID(위험 목록에서 고르기용) */
function gidOfOrigin(d: Derived, view: any, o: Origin): string | null {
  for (const [g, x] of d.origin) if (x.kind === o.kind && x.id === o.id) return view.canonical(g);
  return null;
}

export function MapPanel({ data, scope, height = 600, showRisk = true, testid = 'itda-map' }: { data: AppState; scope: MapScope; height?: number; showRisk?: boolean; testid?: string }) {
  // 팀·부서 지도는 항목이 많아 할 일(문서에서 온 조치)은 기본으로 숨긴다 — 「할 일 보기」로 켬. 업무·내 지도는 늘 보임
  const [showTodo, setShowTodo] = useState(scope.kind !== 'all');
  const derived = useMemo(() => deriveMap(data, scope, undefined, { actions: showTodo }), [data, scope, showTodo]);
  const view = useMapView(derived);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [soloOn, setSoloOn] = useState(scope.kind === 'all');
  const asOf = today();
  // 위험 점검은 업무만 센다(문서에서 뽑은 할 일은 빼고 다시 파생 — 업무 노드 ID는 같다)
  const riskView = useMemo(() => (showRisk ? buildView(...(() => { const d = deriveMap(data, scope, undefined, { actions: false }); return [d.doc, d.resolve] as const; })()) : null), [data, scope, showRisk]);
  const solo: string[] = useMemo(() => (riskView ? [...soloWorks(riskView, asOf)].map((g: string) => view.canonical(g)).filter((g: string) => view.getNode(g)) : []), [riskView, view, asOf]);
  const risk = useMemo(() => (riskView ? teamRiskParts(teamRiskSummary(riskView, { asOf, n: 5 })) : []), [riskView, asOf]);
  const marks = useMemo(() => (soloOn ? { cls: SOLO_CLS, gids: solo } : { cls: null, gids: [] }), [soloOn, solo]);
  const sel = originOfGid(derived, view, selected);
  // 선택한 항목이 다시 그린 지도에서 사라지면(숨김 등) 선택을 푼다
  const selectedNow = selected && view.getNode(selected) && !view.getNode(selected).hidden ? selected : null;

  const toggle = (u: string) =>
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(u)) next.delete(u);
      else next.add(u);
      return next;
    });
  const pick = (o: Origin) => {
    const g = gidOfOrigin(derived, view, o);
    if (!g) return;
    // 접힌 팀 안에 있으면 그 팀을 펼친다
    const node = view.getNode(g);
    if (node && node.universe_id !== derived.doc.universe.id && !expanded.has(node.universe_id)) toggle(node.universe_id);
    setSelected(g);
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0 space-y-2">
        <MapView derived={derived} view={view} expanded={expanded} selected={selectedNow} onSelect={setSelected} onToggle={toggle} marks={marks} height={height} testid={testid} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <MapLegend view={view} />
            {scope.kind === 'all' && (
              <label className="flex items-center gap-1 text-2xs text-muted">
                <input type="checkbox" checked={showTodo} onChange={(e) => setShowTodo(e.target.checked)} data-testid="map-show-todo" />
                할 일 보기
              </label>
            )}
          </div>
          <p className="text-2xs text-faint">
            {soloOn && solo.length > 0 && <span className="mr-2 inline-flex items-center gap-1 font-semibold text-danger"><span className="inline-block h-2.5 w-2.5 rounded-sm border-2 border-danger" />빨간 겹테두리 = 혼자만 아는 업무</span>}
            항목을 누르면 오른쪽에 카드가 열립니다{scope.kind === 'all' ? '' : ''}
          </p>
        </div>
      </div>
      <div className="space-y-3">
        {sel ? <NodeCard origin={sel} data={data} onClose={() => setSelected(null)} onPick={pick} isCenter={!!selectedNow && view.getNode(selectedNow)?.core_type === 'root'} /> : <IdleCard scope={scope} />}
        {showRisk && (
          <div className="rounded-lg border border-line bg-surface p-4" data-testid="map-risk">
            <div className="flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-1.5 text-[14px] font-bold">
                <AlertTriangle size={15} className="text-warn" /> 지도 위험 점검
              </h3>
              <label className="flex items-center gap-1.5 text-2xs text-muted">
                <input type="checkbox" checked={soloOn} onChange={(e) => setSoloOn(e.target.checked)} data-testid="map-solo-toggle" />
                지도에 표시
              </label>
            </div>
            <p className="mt-1 text-[12.5px] text-muted">{risk.join(' · ')}</p>
            {solo.length > 0 && (
              <ul className="mt-2 space-y-1">
                {solo.slice(0, 6).map((g) => {
                  const o = originOfGid(derived, view, g);
                  const n = view.getNode(g);
                  return (
                    <li key={g}>
                      <button className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-[12.5px] hover:bg-sunken" onClick={() => o && pick(o)} data-testid="map-solo-item">
                        <span className="h-2 w-2 shrink-0 rounded-full border-2 border-danger" />
                        <span className="flex-1 truncate">{n?.label}</span>
                        <span className="text-2xs text-faint">혼자만 아는 일</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="mt-2 text-2xs text-faint">혼자만 아는 일 = 지금까지 한 사람만 담당해 본 업무(인계 대비 필요). 업무 유니버스의 위험 규칙과 같은 기준입니다.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function IdleCard({ scope }: { scope: MapScope }) {
  return (
    <div className="rounded-lg border border-dashed border-line2 bg-surface p-4 text-[12.5px] text-muted" data-testid="map-card-idle">
      <p className="font-semibold text-ink">지도에서 항목을 눌러 보세요</p>
      <ul className="mt-2 list-disc space-y-1 pl-4">
        <li>업무: 담당 넘기기·추가, 업무 잇기, 메모, 주제 붙이기</li>
        <li>결정·조치의 근거 칩을 누르면 원문 문단으로 갑니다</li>
        <li>지도에서 고친 내용은 업무 화면·타임라인·변경 이력에 바로 반영됩니다</li>
        {scope.kind === 'all' && <li>팀 도형(＋숫자)은 두 번 누르면 펼쳐집니다</li>}
      </ul>
    </div>
  );
}

/** 명령 실행 → 변경 이력·버전·알림 */
function useApply() {
  const { raw, update, log, touch, toast } = useStore();
  return (fn: (d: AppState) => Change | null, done?: string) => {
    // 알림 글은 지금 데이터의 사본에 명령을 먼저 돌려 정한다(상태 갱신 함수가 언제 불리는지와 상관없게)
    const probe = fn(JSON.parse(JSON.stringify(raw)) as AppState);
    if (!probe) {
      toast('바뀐 것이 없습니다');
      return;
    }
    update((d) => {
      const res = fn(d);
      if (!res) return;
      log(d, res.workId, '지도 편집', res.summary);
      touch(d, res.workId);
      for (const x of res.also || []) {
        log(d, x.workId, '지도 편집', x.summary);
        touch(d, x.workId);
      }
    });
    toast(done ?? probe.summary);
  };
}

function NodeCard({ origin, data, onClose, onPick, isCenter = false }: { origin: Origin; data: AppState; onClose: () => void; onPick: (o: Origin) => void; isCenter?: boolean }) {
  const { update, toast } = useStore();
  const { nav } = useRouter();
  const key = hideKey(origin);
  const hidden = (data.mapHidden || []).includes(key);
  const hide = () => {
    update((d) => {
      setMapHidden(d, key, !hidden);
    });
    toast(hidden ? '지도에 다시 보입니다' : '지도에서 숨겼습니다 — 업무 화면의 데이터는 그대로입니다');
    if (!hidden) onClose();
  };
  const head = (kind: string, title: string, extra?: React.ReactNode) => (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="text-2xs font-semibold text-faint">{kind}</p>
        <h3 className="text-[15px] font-bold leading-snug" data-testid="map-card-title">
          {title}
        </h3>
        {extra}
      </div>
      <button className="rounded p-1 text-faint hover:bg-sunken hover:text-ink" onClick={onClose} aria-label="카드 닫기">
        <X size={15} />
      </button>
    </div>
  );
  const foot = origin.kind !== 'root' && !isCenter && (
    <div className="mt-3 border-t border-line pt-2">
      <button className="flex items-center gap-1 text-2xs text-muted hover:text-ink" onClick={hide} data-testid="map-hide">
        {hidden ? <Eye size={13} /> : <EyeOff size={13} />} {hidden ? '지도에 다시 보이기' : '지도에서 숨기기'}
      </button>
    </div>
  );
  const wrap = (body: React.ReactNode) => (
    <div className="rounded-lg border border-line bg-surface p-4 shadow-card" data-testid="map-card" data-kind={origin.kind}>
      {body}
      {foot}
    </div>
  );

  if (origin.kind === 'work') {
    const w = data.works.find((x) => x.id === origin.id);
    if (!w) return wrap(head('업무', origin.id, <p className="text-[12.5px] text-muted">볼 수 있는 범위 밖의 업무입니다.</p>));
    return wrap(<WorkCardBody w={w} data={data} head={head} onPick={onPick} nav={nav} />);
  }
  if (origin.kind === 'action') {
    const a = data.actions.find((x) => x.id === origin.id);
    if (!a) return wrap(head('할 일', origin.id));
    const w = data.works.find((x) => x.id === a.workId);
    return wrap(
      <>
        {head('할 일(향후 조치)', a.title)}
        <dl className="mt-2 space-y-1 text-[12.5px]">
          <Row k="기한">{a.due ? fmtDate(a.due) : '기한 미지정'}{a.due && a.due < today() && a.status !== '완료' ? <span className="ml-1 font-semibold text-danger">기한 경과</span> : null}</Row>
          <Row k="상태">{a.status}</Row>
          <Row k="담당">{data.users.find((u) => u.id === a.ownerId)?.name ?? '미지정'}</Row>
          {w && <Row k="업무">{w.name}</Row>}
        </dl>
        {!!a.cite?.length && (
          <div className="mt-2 flex flex-wrap gap-1">
            {a.cite.map((c, i) => (
              <CiteLink key={i} c={c} />
            ))}
          </div>
        )}
        {w && (
          <Button className="mt-3" variant="subtle" onClick={() => nav(`/works/${w.id}?tab=actions`)}>
            업무 상세에서 처리 <ArrowRight size={14} />
          </Button>
        )}
      </>,
    );
  }
  if (origin.kind === 'user') {
    const u = data.users.find((x) => x.id === origin.id);
    if (!u) return wrap(head('사람', origin.id));
    const now = data.works.filter((w) => w.owners.includes(u.id));
    const past = data.works.filter((w) => !w.owners.includes(u.id) && w.ownerHistory.some((p) => p.userId === u.id));
    return wrap(
      <>
        {head('사람', u.name, <p className="text-[12.5px] text-muted">{[u.title, u.dept, u.empNo].filter(Boolean).join(' · ')}</p>)}
        <WorkList title={`지금 담당 ${now.length}건`} works={now} onPick={onPick} />
        {past.length > 0 && <WorkList title={`전에 담당 ${past.length}건`} works={past} onPick={onPick} />}
      </>,
    );
  }
  if (origin.kind === 'doc') {
    const d = data.docs.find((x) => x.id === origin.id);
    if (!d) return wrap(head('문서', origin.id));
    return wrap(
      <>
        {head(`문서 · ${d.type}`, d.title, <p className="text-[12.5px] text-muted">작성일 {d.writtenAt ? fmtDate(d.writtenAt) : '별도 확인 필요'}</p>)}
        {d.summary?.length > 0 && <p className="mt-2 text-[12.5px] text-muted">{d.summary[0]}</p>}
        <Button className="mt-3" variant="subtle" onClick={() => nav(`/docs/${d.id}`)}>
          <FileText size={14} /> 문서 원문 보기
        </Button>
      </>,
    );
  }
  // 조직·주제·지도 중심: 이어진 업무 목록
  const works =
    origin.kind === 'topic'
      ? data.works.filter((w) => (w.topics || []).includes(origin.id))
      : origin.kind === 'org'
        ? data.works.filter((w) => w.dept.startsWith(origin.id) || w.agency === origin.id || w.partners.some((p) => p.name === origin.id) || w.owners.some((o) => data.users.find((u) => u.id === o)?.dept.startsWith(origin.id)))
        : [];
  return wrap(
    <>
      {head(origin.kind === 'topic' ? '주제' : origin.kind === 'org' ? '조직' : '지도 중심', origin.id)}
      {works.length > 0 && <WorkList title={`이어진 업무 ${works.length}건`} works={works} onPick={onPick} />}
    </>,
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-12 shrink-0 text-faint">{k}</dt>
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  );
}

function WorkList({ title, works, onPick }: { title: string; works: AppState['works']; onPick: (o: Origin) => void }) {
  return (
    <div className="mt-3">
      <p className="text-2xs font-semibold text-faint">{title}</p>
      <ul className="mt-1 space-y-0.5">
        {works.map((w) => (
          <li key={w.id}>
            <button className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-[12.5px] hover:bg-sunken" onClick={() => onPick({ kind: 'work', id: w.id })}>
              <Mono className="text-2xs text-faint">{w.id}</Mono>
              <span className="flex-1 truncate">{w.name}</span>
              <span className="text-2xs text-faint">{w.status}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

type EditMode = null | 'owner' | 'link' | 'memo' | 'topic';

function WorkCardBody({ w, data, head, onPick, nav }: { w: AppState['works'][number]; data: AppState; head: (k: string, t: string, e?: React.ReactNode) => React.ReactNode; onPick: (o: Origin) => void; nav: (to: string) => void }) {
  const apply = useApply();
  const [mode, setMode] = useState<EditMode>(null);
  const owners = w.owners.map((o) => data.users.find((u) => u.id === o)?.name ?? o);
  const decisions = data.decisions.filter((d) => d.workId === w.id && !d.hidden).slice(-3);
  const actions = data.actions.filter((a) => a.workId === w.id && a.status !== '완료').sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999'));
  const [allActs, setAllActs] = useState(false);
  const links: { kind: LinkKind; id: string; name: string; dir?: string }[] = [
    ...(w.parentId ? [{ kind: 'parent' as LinkKind, id: w.parentId, name: data.works.find((x) => x.id === w.parentId)?.name ?? `다른 담당자의 업무(${w.parentId})` }] : []),
    ...w.relatedIds.map((id) => ({ kind: 'related' as LinkKind, id, name: data.works.find((x) => x.id === id)?.name ?? `다른 담당자의 업무(${id})` })),
    ...(w.nextIds || []).map((id) => ({ kind: 'next' as LinkKind, id, name: data.works.find((x) => x.id === id)?.name ?? `다른 담당자의 업무(${id})` })),
  ];
  return (
    <>
      {head(
        `업무 · ${w.id}`,
        w.name,
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted">
          <StatusBadge status={w.status} />
          <span>담당 {owners.join('·') || '없음'}</span>
        </div>,
      )}
      {w.summary && <p className="mt-2 text-[12.5px] text-muted">{w.summary}</p>}

      {decisions.length > 0 && (
        <div className="mt-3">
          <p className="text-2xs font-semibold text-faint">최근 결정</p>
          <ul className="mt-1 space-y-1.5">
            {decisions.map((d) => (
              <li key={d.id} className="text-[12.5px]">
                <span className="tnum text-faint">{fmtDate(d.date)}</span> {d.title.replace(/^\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\.\s*/, '')}
                {d.cite?.length > 0 && (
                  <span className="ml-1 inline-flex flex-wrap gap-1 align-middle">
                    {d.cite.slice(0, 1).map((c, i) => (
                      <CiteLink key={i} c={c} />
                    ))}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {actions.length > 0 && (
        <div className="mt-3">
          <p className="text-2xs font-semibold text-faint">남은 조치 {actions.length}건</p>
          <ul className="mt-1 space-y-1">
            {(allActs ? actions : actions.slice(0, 6)).map((a) => (
              <li key={a.id}>
                <button className="w-full rounded px-1 py-0.5 text-left text-[12.5px] hover:bg-sunken" onClick={() => onPick({ kind: 'action', id: a.id })}>
                  <span className={cx('tnum', a.due && a.due < today() ? 'font-semibold text-danger' : 'text-faint')}>{a.due ? fmtDate(a.due) : '기한 미지정'}</span> {a.title.replace(/^\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\.\s*/, '')}
                  {a.ownerId && <span className="ml-1 text-2xs text-faint">· {data.users.find((u) => u.id === a.ownerId)?.name}</span>}
                </button>
              </li>
            ))}
          </ul>
          {actions.length > 6 && (
            <button className="mt-1 text-2xs text-brand hover:underline" onClick={() => setAllActs(!allActs)} data-testid="map-card-more-actions">
              {allActs ? '접기' : `${actions.length - 6}건 더 보기`}
            </button>
          )}
        </div>
      )}
      {links.length > 0 && (
        <div className="mt-3">
          <p className="text-2xs font-semibold text-faint">이어진 업무</p>
          <ul className="mt-1 space-y-0.5">
            {links.map((l) => (
              <li key={l.kind + l.id} className="flex items-center gap-1 text-[12.5px]">
                <span className="w-16 shrink-0 text-2xs text-faint">{LINK_NAMES[l.kind].replace('(선후행)', '')}</span>
                <button className="flex-1 truncate text-left hover:underline" onClick={() => onPick({ kind: 'work', id: l.id })}>
                  {l.name}
                </button>
                <button className="rounded p-0.5 text-faint hover:bg-sunken hover:text-danger" title="연결 끊기" aria-label={`${l.name} 연결 끊기`} onClick={() => apply((d) => unlinkWorks(d, w.id, l.id, l.kind))}>
                  <X size={12} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {(w.topics || []).length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1">
          {w.topics.map((t) => (
            <span key={t} className="inline-flex items-center gap-1 rounded-full bg-sunken px-2 py-0.5 text-2xs">
              #{t}
              <button aria-label={`주제 ${t} 떼기`} className="text-faint hover:text-danger" onClick={() => apply((d) => removeTopic(d, w.id, t))}>
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-1.5">
        <EditBtn on={mode === 'owner'} onClick={() => setMode(mode === 'owner' ? null : 'owner')} icon={<UserPlus size={13} />} label="담당 넘기기·추가" testid="map-edit-owner" />
        <EditBtn on={mode === 'link'} onClick={() => setMode(mode === 'link' ? null : 'link')} icon={<Link2 size={13} />} label="업무 잇기" testid="map-edit-link" />
        <EditBtn on={mode === 'memo'} onClick={() => setMode(mode === 'memo' ? null : 'memo')} icon={<StickyNote size={13} />} label="메모 남기기" testid="map-edit-memo" />
        <EditBtn on={mode === 'topic'} onClick={() => setMode(mode === 'topic' ? null : 'topic')} icon={<TagIcon size={13} />} label="주제 붙이기" testid="map-edit-topic" />
      </div>
      {mode === 'owner' && <OwnerForm w={w} data={data} onDone={() => setMode(null)} />}
      {mode === 'link' && <LinkForm w={w} data={data} onDone={() => setMode(null)} />}
      {mode === 'memo' && <MemoForm w={w} onDone={() => setMode(null)} />}
      {mode === 'topic' && <TopicForm w={w} data={data} onDone={() => setMode(null)} />}

      <Button className="mt-3 w-full justify-center" variant="subtle" onClick={() => nav(`/works/${w.id}`)}>
        <ExternalLink size={14} /> 업무 상세(인계 자료) 열기
      </Button>
    </>
  );
}

function EditBtn({ on, onClick, icon, label, testid }: { on: boolean; onClick: () => void; icon: React.ReactNode; label: string; testid: string }) {
  return (
    <button
      className={cx('flex items-center justify-center gap-1 rounded-md border px-2 py-1.5 text-[12px] font-medium', on ? 'border-brand bg-brandsoft text-brand' : 'border-line2 text-muted hover:border-brand hover:text-ink')}
      onClick={onClick}
      aria-pressed={on}
      data-testid={testid}
    >
      {icon}
      {label}
    </button>
  );
}

function FormBox({ children }: { children: React.ReactNode }) {
  // 열리면 화면 안으로 끌어온다(입력칸·저장 단추가 첫 화면 아래에 숨지 않게, 처음 사용 점검 2026-10-29)
  return <div ref={(el) => el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })} className="mt-2 space-y-2 rounded-md bg-sunken p-2.5">{children}</div>;
}

function OwnerForm({ w, data, onDone }: { w: AppState['works'][number]; data: AppState; onDone: () => void }) {
  const apply = useApply();
  const others = data.users.filter((u) => !(w.owners.length === 1 && w.owners[0] === u.id));
  const [who, setWho] = useState(others.find((u) => !w.owners.includes(u.id))?.id ?? others[0]?.id ?? '');
  const [how, setHow] = useState<'hand' | 'add'>('hand');
  return (
    <FormBox>
      <select className={inputCls} value={who} onChange={(e) => setWho(e.target.value)} aria-label="담당할 사람" data-testid="map-owner-who">
        {others.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name} · {u.title}
          </option>
        ))}
      </select>
      <div className="flex gap-3 text-[12px]">
        <label className="flex items-center gap-1">
          <input type="radio" checked={how === 'hand'} onChange={() => setHow('hand')} /> 넘기기(기존 담당 끝냄)
        </label>
        <label className="flex items-center gap-1">
          <input type="radio" checked={how === 'add'} onChange={() => setHow('add')} /> 공동 담당 추가
        </label>
      </div>
      <p className="text-2xs text-faint">정식 인계(사전 점검·인수 확인·스냅샷)는 「업무 인계 관리」에서 합니다. 여기서는 담당만 바꿉니다.</p>
      <Button
        onClick={() => {
          apply((d) => assignOwner(d, w.id, who, how, today()));
          onDone();
        }}
        disabled={!who}
        data-testid="map-owner-save"
      >
        저장
      </Button>
    </FormBox>
  );
}

function LinkForm({ w, data, onDone }: { w: AppState['works'][number]; data: AppState; onDone: () => void }) {
  const apply = useApply();
  const cands = data.works.filter((x) => x.id !== w.id);
  const [to, setTo] = useState(cands[0]?.id ?? '');
  const [kind, setKind] = useState<LinkKind>('related');
  if (!cands.length) return <FormBox><p className="text-[12px] text-muted">이을 다른 업무가 없습니다. 업무 관리에서 업무를 먼저 등록하세요.</p></FormBox>;
  return (
    <FormBox>
      <select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value as LinkKind)} aria-label="연결 종류" data-testid="map-link-kind">
        {(Object.keys(LINK_NAMES) as LinkKind[]).map((k) => (
          <option key={k} value={k}>
            {k === 'parent' ? '이 업무의 상위 업무' : k === 'next' ? '이 업무 다음에 하는 업무' : '관련 업무'}
          </option>
        ))}
      </select>
      <select className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} aria-label="이을 업무" data-testid="map-link-to">
        {cands.map((x) => (
          <option key={x.id} value={x.id}>
            {x.id} · {x.name}
          </option>
        ))}
      </select>
      <Button
        onClick={() => {
          apply((d) => linkWorks(d, w.id, to, kind));
          onDone();
        }}
        data-testid="map-link-save"
      >
        잇기
      </Button>
    </FormBox>
  );
}

function MemoForm({ w, onDone }: { w: AppState['works'][number]; onDone: () => void }) {
  const apply = useApply();
  const [text, setText] = useState('');
  const [kind, setKind] = useState<MemoKind>('caution');
  return (
    <FormBox>
      <textarea className={cx(inputCls, 'min-h-[64px]')} value={text} onChange={(e) => setText(e.target.value)} placeholder="예: 매월 첫 영업일 새벽은 점검 시간이라 대조를 시작하지 않음" aria-label="메모 내용" data-testid="map-memo-text" />
      <div className="flex gap-3 text-[12px]">
        {(Object.keys(MEMO_NAMES) as MemoKind[]).map((k) => (
          <label key={k} className="flex items-center gap-1">
            <input type="radio" checked={kind === k} onChange={() => setKind(k)} /> {MEMO_NAMES[k]}
          </label>
        ))}
      </div>
      <p className="text-2xs text-faint">업무 개요의 「{kind === 'caution' ? '유의사항' : '현재 진행 중인 사항'}」에 담당자 작성으로 들어갑니다.</p>
      <Button
        onClick={() => {
          apply((d) => addMemo(d, w.id, text, kind));
          onDone();
        }}
        disabled={!text.trim()}
        data-testid="map-memo-save"
      >
        남기기
      </Button>
    </FormBox>
  );
}

function TopicForm({ w, data, onDone }: { w: AppState['works'][number]; data: AppState; onDone: () => void }) {
  const apply = useApply();
  const [t, setT] = useState('');
  const known = [...new Set(data.works.flatMap((x) => x.topics || []))].filter((x) => !(w.topics || []).includes(x));
  return (
    <FormBox>
      <input className={inputCls} value={t} onChange={(e) => setT(e.target.value)} placeholder="주제 이름(예: 본인확인)" list="map-topic-known" aria-label="주제 이름" data-testid="map-topic-text" />
      <datalist id="map-topic-known">
        {known.map((k) => (
          <option key={k} value={k} />
        ))}
      </datalist>
      <p className="text-2xs text-faint">같은 주제를 붙인 업무끼리 지도에서 이어집니다.</p>
      <Button
        onClick={() => {
          apply((d) => addTopic(d, w.id, t));
          onDone();
        }}
        disabled={!t.trim()}
        data-testid="map-topic-save"
      >
        붙이기
      </Button>
    </FormBox>
  );
}
