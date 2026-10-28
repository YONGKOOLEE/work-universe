import { useState } from 'react';
import { HandoverPoints } from '../universe/HandoverPoints';
import { Check, Sparkles, Loader2, UserRound, Camera, ExternalLink, MessageSquareWarning, Send, ShieldCheck, Stamp } from 'lucide-react';
import { useStore, userName } from '../lib/store';
import { useRouter } from '../lib/router';
import { Button, Card, CardHead, Mono, Empty, KV, inputCls, StatusBadge } from '../components/ui';
import { HO_STATUS } from './Handover';
import { workIssues } from '../ai/engine';
import type { AppState, Handover, Snapshot } from '../lib/types';
import { fmtDate, fmtDateTime, clone, cx, uid, localDay } from '../lib/util';

const STEPS = ['업무 선택', 'AI 사전 점검', '정보 확인·보완', '인계 제출', '인수자 검토', '보완 요청', '인수 확인', '확정·스냅샷'];
const CHECKS: { key: string; label: string; tab: string; hint: (s: AppState, wid: string) => string }[] = [
  { key: 'overview', label: '업무 개요 및 추진 배경 확인', tab: 'overview', hint: (s, w) => `목적 ${s.works.find((x) => x.id === w)!.purpose.length}항목 · 배경 ${s.works.find((x) => x.id === w)!.background.length}항목` },
  { key: 'progress', label: '진행 중 과제 및 향후 조치사항 확인', tab: 'actions', hint: (s, w) => `미완료 조치 ${s.actions.filter((a) => a.workId === w && a.status !== '완료').length}건` },
  { key: 'decisions', label: '주요 결정사항과 관련 문서 확인', tab: 'meetings', hint: (s, w) => `결정 ${s.decisions.filter((d) => d.workId === w).length}건 · 문서 ${s.docs.filter((d) => d.workIds.includes(w)).length}건` },
  { key: 'partners', label: '협의처 및 유의사항 확인', tab: 'overview', hint: (s, w) => `협의기관 ${s.works.find((x) => x.id === w)!.partners.length}곳 · 유의사항 ${s.works.find((x) => x.id === w)!.cautions.length}건` },
];

export default function HandoverDetail({ id }: { id: string }) {
  const { s, raw, update, toast, log, me } = useStore();
  const { nav } = useRouter();
  const [running, setRunning] = useState(false);
  const [reqText, setReqText] = useState('');
  const [respText, setRespText] = useState('');
  const h = s.handovers.find((x) => x.id === id);
  if (!h) return <Empty title="인계 기록을 찾을 수 없습니다" action={<Button onClick={() => nav('/handover')}>인계 관리</Button>} />;
  const w = s.works.find((x) => x.id === h.workId);
  if (!w) {
    // 인계 후 담당에서 빠진 인계자: 업무 내용은 볼 수 없고, 인계 기록과 당시 스냅샷만 열람
    const name = raw.works.find((x) => x.id === h.workId)?.name ?? h.workId;
    return (
      <div className="space-y-5">
        <div>
          <div className="mb-1 text-xs text-muted">
            <button className="hover:text-ink" onClick={() => nav('/handover')}>업무 인계 관리</button> / <Mono>{h.id}</Mono>
          </div>
          <h1 className="text-[22px] font-bold tracking-tight">{name} 인계</h1>
          <p className="text-[13px] text-muted">
            {userName(s, h.fromId)} → {userName(s, h.toId)} · 기준일 {fmtDate(h.baseDate)} · {HO_STATUS[h.status].label}
          </p>
        </div>
        <Card className="p-5 text-[13px]">
          <p className="text-muted">인계 후 이 업무의 담당에서 빠져 현재 업무 내용은 열람할 수 없습니다. 인계 기록과 인계 당시 스냅샷은 계속 볼 수 있습니다.</p>
          {h.snapshotId && (
            <Button className="mt-3" variant="primary" onClick={() => nav(`/snapshots/${h.snapshotId}`)}>
              인계 당시 스냅샷 조회
            </Button>
          )}
          <ol className="mt-4 space-y-1.5">
            {h.log.map((l, i) => (
              <li key={i} className="text-xs text-muted">
                {fmtDateTime(l.at)} · {l.text} · {userName(s, l.byId)}
              </li>
            ))}
          </ol>
        </Card>
      </div>
    );
  }
  const issues = workIssues(s, w);
  const openActs = s.actions.filter((a) => a.workId === w.id && a.status !== '완료');
  const isFrom = me.id === h.fromId;
  const isTo = me.id === h.toId;
  const now = () => new Date().toISOString();
  const allChecked = CHECKS.every((c) => h.checklist[c.key]);
  const done = (i: number) => i < h.step || h.status === 'confirmed';
  const openReq = h.requests.find((r) => !r.resolvedAt);

  const mut = (fn: (x: Handover, d: AppState) => void) =>
    update((d) => {
      const x = d.handovers.find((y) => y.id === h.id)!;
      fn(x, d);
    });
  const switchTo = (uidv: string) => {
    update((d) => {
      d.currentUserId = uidv;
    });
    toast(`${userName(s, uidv)}(으)로 전환했습니다`);
  };

  const precheck = () => {
    setRunning(true);
    window.setTimeout(() => {
      mut((x, d) => {
        x.precheckDone = true;
        x.step = 3;
        x.log.push({ at: now(), byId: d.currentUserId, text: `AI 사전 점검 완료 · 확인 필요 ${issues.length}건` });
      });
      setRunning(false);
    }, 800);
  };

  const confirm = () => {
    update((d) => {
      const x = d.handovers.find((y) => y.id === h.id)!;
      const wk = d.works.find((y) => y.id === h.workId)!;
      const snap: Snapshot = {
        id: uid('S'),
        handoverId: x.id,
        workId: wk.id,
        takenAt: now(),
        version: wk.version,
        work: clone(wk),
        decisions: clone(d.decisions.filter((y) => y.workId === wk.id)),
        actions: clone(d.actions.filter((y) => y.workId === wk.id)),
        events: clone(d.events.filter((y) => y.workIds.includes(wk.id))),
        docs: d.docs.filter((y) => y.workIds.includes(wk.id)).map((y) => ({ id: y.id, title: y.title, type: y.type, writtenAt: y.writtenAt, availability: y.availability })),
      };
      d.snapshots.push(snap);
      x.snapshotId = snap.id;
      x.status = 'confirmed';
      x.step = 8;
      x.confirmedAt = now();
      x.log.push({ at: now(), byId: d.currentUserId, text: `인계 확정 · 업무정보 v${wk.version} 스냅샷 보존` });
      const from = userName(d, x.fromId);
      const to = userName(d, x.toId);
      // 인수자를 담당자로 추가하고 담당 기간 기록 시작
      if (!wk.owners.includes(x.toId)) wk.owners.push(x.toId);
      wk.ownerHistory.push({ userId: x.toId, from: now(), to: null, note: `${x.id} 인계로 지정` });
      if (x.fromLeaves) {
        // 인계자 담당 종료 — 담당 기간 이력은 남김
        wk.owners = wk.owners.filter((o) => o !== x.fromId);
        wk.ownerHistory.filter((p) => p.userId === x.fromId && !p.to).forEach((p) => {
          p.to = now();
          p.note = `${p.note ? p.note + ' · ' : ''}${x.id} 인계로 담당 종료`;
        });
        d.actions.filter((a) => a.workId === wk.id && a.status !== '완료' && a.ownerId === x.fromId).forEach((a) => (a.ownerId = x.toId));
      }
      wk.updatedAt = now();
      wk.version += 1;
      log(d, wk.id, '인계 확정', x.fromLeaves ? `담당자 ${from} → ${to} (${x.id}, ${from} 담당 종료)` : `담당자 ${to} 추가 (${x.id}, ${from} 공동 담당 유지)`);
      d.events.push({
        id: uid('E'),
        workIds: [wk.id],
        date: localDay(now()),
        type: '담당자 변경',
        title: x.fromLeaves ? `업무 담당자 변경: ${from} → ${to}` : `업무 담당자 추가: ${to} (${from} 공동 담당 유지)`,
        summary: `${x.id} 인계 확정 (플랫폼 기록)`,
        decisions: [],
        agency: wk.dept,
        docIds: [],
        cite: [],
        source: 'record',
        meaning: '인계 시점의 업무정보는 스냅샷으로 보존됨',
        causes: [],
        phase: '플랫폼 기록',
      });
    });
    toast('인계를 확정하고 스냅샷을 보존했습니다');
  };

  const actor = h.status === 'draft' || h.status === 'revision' ? h.fromId : h.status === 'confirmed' ? null : h.toId;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="mb-1 text-xs text-muted">
            <button className="hover:text-ink" onClick={() => nav('/handover')}>업무 인계 관리</button> / <Mono>{h.id}</Mono>
          </div>
          <h1 className="text-[22px] font-bold tracking-tight">{w.name} 인계</h1>
          <p className="text-[13px] text-muted">
            {userName(s, h.fromId)} → {userName(s, h.toId)} · 기준일 {fmtDate(h.baseDate)}
          </p>
        </div>
        <span className={cx('rounded-md px-2.5 py-1 text-xs font-semibold', HO_STATUS[h.status].cls)}>{HO_STATUS[h.status].label}</span>
      </div>

      {/* 단계 표시 */}
      <Card className="overflow-x-auto px-4 py-4 scroll-thin">
        <ol className="flex min-w-[760px] items-start">
          {STEPS.map((t, i) => {
            const n = i + 1;
            const cur = n === h.step && h.status !== 'confirmed';
            const skipped = n === 6 && !h.requests.length && h.step > 6;
            return (
              <li key={t} className="flex flex-1 flex-col items-center gap-1.5 text-center">
                <div className="flex w-full items-center">
                  <span className={cx('h-0.5 flex-1', i === 0 ? 'bg-transparent' : done(i) || cur ? 'bg-brand' : 'bg-line2')} />
                  <span
                    className={cx(
                      'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold',
                      done(n) && !cur ? 'border-brand bg-brand text-onbrand' : cur ? 'border-brand bg-surface text-brand' : 'border-line2 bg-surface text-faint',
                      skipped && 'border-dashed border-line2 bg-surface text-faint',
                    )}
                  >
                    {done(n) && !cur && !skipped ? <Check size={14} strokeWidth={3} /> : n}
                  </span>
                  <span className={cx('h-0.5 flex-1', i === STEPS.length - 1 ? 'bg-transparent' : done(n) ? 'bg-brand' : 'bg-line2')} />
                </div>
                <span className={cx('px-1 text-2xs font-medium leading-tight', cur ? 'text-brand' : done(n) ? 'text-ink' : 'text-faint')}>
                  {t}
                  {skipped && <span className="block text-faint">(해당 없음)</span>}
                </span>
              </li>
            );
          })}
        </ol>
      </Card>

      {actor && actor !== me.id && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-brand/30 bg-brandsoft/50 px-4 py-3 text-[13px]">
          <UserRound size={16} className="text-brand" />
          <span className="flex-1">
            다음 단계는 <b>{h.status === 'draft' || h.status === 'revision' ? '인계자' : '인수자'} {userName(s, actor)}</b>님이 진행합니다. 현재 사용자: {me.name}
          </span>
          <Button size="sm" variant="primary" onClick={() => switchTo(actor)}>
            {userName(s, actor)}(으)로 전환
          </Button>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <div className="min-w-0 space-y-5">
          {/* 2. AI 사전 점검 */}
          <Card>
            <CardHead icon={<Sparkles size={16} />} title="AI 사전 점검" sub="업무정보 누락·갱신 필요 항목을 인계 전에 확인" right={!h.precheckDone && isFrom ? <Button size="sm" variant="primary" onClick={precheck} disabled={running}>{running ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}점검 실행</Button> : undefined} />
            <div className="px-4 py-3">
              {!h.precheckDone ? (
                <p className="text-[13px] text-muted">{isFrom ? "'점검 실행'을 눌러 인계 전 업무정보 상태를 확인하세요." : '인계자가 사전 점검을 실행하기 전입니다.'}</p>
              ) : (
                <>
                  <div className="mb-3 flex flex-wrap gap-2 text-xs">
                    <span className="rounded bg-dangersoft px-2 py-0.5 font-semibold text-danger">높음 {issues.filter((i) => i.severity === 'high').length}</span>
                    <span className="rounded bg-warnsoft px-2 py-0.5 font-semibold text-warn">보통 {issues.filter((i) => i.severity === 'mid').length}</span>
                    <span className="rounded bg-sunken px-2 py-0.5 font-semibold text-muted">낮음 {issues.filter((i) => i.severity === 'low').length}</span>
                  </div>
                  <ul className="space-y-1.5">
                    {issues.map((i) => (
                      <li key={i.id} className="flex items-start gap-2 text-[13px]">
                        <span className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', i.severity === 'high' ? 'bg-danger' : i.severity === 'mid' ? 'bg-warn' : 'bg-faint')} />
                        <span className="min-w-0 flex-1">
                          <b className="font-medium">{i.title}</b> <span className="text-xs text-muted">— {i.detail}</span>
                        </span>
                        <button className="shrink-0 text-xs text-brand hover:underline" onClick={() => nav(i.to)}>
                          보완
                        </button>
                      </li>
                    ))}
                    {!issues.length && <li className="text-[13px] text-fact">누락·갱신 필요 항목 없음</li>}
                  </ul>
                  <p className="mt-3 text-2xs text-faint">점검 결과가 남아 있어도 제출할 수 있으며, 미해결 항목은 인수자에게 그대로 표시됩니다.</p>
                </>
              )}
            </div>
          </Card>

          {/* 2-1. 지도로 본 인계 포인트(업무 유니버스 규칙, CR-24) */}
          {w && <HandoverPoints data={s} workId={w.id} fromId={h.fromId} toId={h.toId} />}

          {/* 3. 체크리스트 */}
          <Card>
            <CardHead icon={<ShieldCheck size={16} />} title="인계 점검 체크리스트" sub="업무 상세 화면의 각 영역을 확인하고 체크합니다" />
            <ul className="divide-y divide-line">
              {CHECKS.map((c) => (
                <li key={c.key} className="flex items-center gap-3 px-4 py-3">
                  <input
                    id={`chk-${c.key}`}
                    type="checkbox"
                    className="h-4 w-4 accent-[rgb(var(--brand))]"
                    checked={!!h.checklist[c.key]}
                    disabled={!h.precheckDone || !(h.status === 'draft' || h.status === 'revision') || !isFrom}
                    onChange={(e) =>
                      mut((x) => {
                        x.checklist[c.key] = e.target.checked;
                      })
                    }
                  />
                  <label htmlFor={`chk-${c.key}`} className="min-w-0 flex-1">
                    <span className="block text-[13.5px] font-medium">{c.label}</span>
                    <span className="block text-2xs text-muted">{c.hint(s, w.id)}</span>
                  </label>
                  <button className="inline-flex items-center gap-1 text-xs text-brand hover:underline" onClick={() => nav(`/works/${w.id}?tab=${c.tab}`)}>
                    확인 <ExternalLink size={11} />
                  </button>
                </li>
              ))}
            </ul>
            <div className="border-t border-line px-4 py-3">
              <label htmlFor="ho-sup" className="mb-1 block text-xs font-semibold text-muted">
                인계자 보완 메모
              </label>
              <textarea
                id="ho-sup"
                className={cx(inputCls, 'min-h-[64px]')}
                value={h.supplement}
                disabled={!isFrom || !(h.status === 'draft' || h.status === 'revision')}
                placeholder="업무 화면에 담기 어려운 맥락이 있으면 짧게 남깁니다"
                onChange={(e) =>
                  mut((x) => {
                    x.supplement = e.target.value;
                  })
                }
              />
              <fieldset className="mt-3 rounded-md border border-line px-3 py-2.5" disabled={!isFrom || !(h.status === 'draft' || h.status === 'revision')}>
                <legend className="px-1 text-xs font-semibold text-muted">인계 후 내 담당 여부 (인계자 선택)</legend>
                <div className="flex flex-col gap-1.5 text-[13px] sm:flex-row sm:gap-5">
                  <label className="flex items-center gap-2">
                    <input type="radio" name="ho-leave" className="accent-[rgb(var(--brand))]" checked={h.fromLeaves === true} onChange={() => mut((x) => void (x.fromLeaves = true))} />
                    담당에서 빠짐 (인수자에게 넘김)
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="radio" name="ho-leave" className="accent-[rgb(var(--brand))]" checked={h.fromLeaves === false} onChange={() => mut((x) => void (x.fromLeaves = false))} />
                    공동 담당자로 남음
                  </label>
                </div>
                <p className="mt-1 text-2xs text-faint">어느 쪽이든 담당 기간 이력(언제부터 언제까지)은 업무의 담당자 이력에 남습니다.</p>
              </fieldset>
              {(h.status === 'draft' || h.status === 'revision') && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {h.status === 'revision' && openReq && (
                    <input id="ho-resp" className={cx(inputCls, 'min-w-[200px] flex-1')} placeholder="보완 내용 답변" value={respText} onChange={(e) => setRespText(e.target.value)} disabled={!isFrom} />
                  )}
                  <Button
                    variant="primary"
                    disabled={!isFrom || !h.precheckDone || !allChecked || h.fromLeaves === null || (h.status === 'revision' && !respText.trim())}
                    onClick={() => {
                      mut((x, d) => {
                        if (x.status === 'revision') {
                          const r = x.requests.find((y) => !y.resolvedAt);
                          if (r) {
                            r.response = respText.trim();
                            r.resolvedAt = now();
                          }
                          x.log.push({ at: now(), byId: d.currentUserId, text: `보완 후 재제출: ${respText.trim()}` });
                        } else x.log.push({ at: now(), byId: d.currentUserId, text: '인계 제출' });
                        x.status = 'submitted';
                        x.step = 5;
                        x.submittedAt = now();
                      });
                      setRespText('');
                      toast('인계를 제출했습니다. 인수자 검토 단계로 이동합니다');
                    }}
                  >
                    <Send size={14} />
                    {h.status === 'revision' ? '보완 완료 · 재제출' : '인계 제출'}
                  </Button>
                  {(!allChecked || h.fromLeaves === null) && <span className="text-2xs text-faint">체크리스트 4개 항목 확인과 인계 후 담당 여부 선택이 필요합니다</span>}
                </div>
              )}
            </div>
          </Card>

          {/* 5~7 인수자 */}
          {(h.status === 'submitted' || h.status === 'accepted') && (
            <Card className="border-brand/40">
              <CardHead icon={<Stamp size={16} />} title={h.status === 'submitted' ? '인수자 검토' : '인계 확정'} sub={h.status === 'submitted' ? '업무 상세를 직접 열어 확인한 뒤 보완 요청 또는 인수 확인' : '확정하면 현재 업무정보가 스냅샷으로 보존되고 담당자가 변경됩니다'} />
              <div className="space-y-3 px-4 py-4">
                <Button onClick={() => nav(`/works/${w.id}`)}>
                  <ExternalLink size={14} />
                  업무 상세(인계 자료) 열기
                </Button>
                {h.status === 'submitted' && (
                  <>
                    <div className="flex flex-wrap gap-2">
                      <input id="ho-req" className={cx(inputCls, 'min-w-[220px] flex-1')} placeholder="보완 요청 내용 (예: 유효기간 3년 근거 확인 계획 추가)" value={reqText} onChange={(e) => setReqText(e.target.value)} disabled={!isTo} />
                      <Button
                        disabled={!isTo || !reqText.trim()}
                        onClick={() => {
                          mut((x, d) => {
                            x.requests.push({ id: uid('R'), at: now(), byId: d.currentUserId, text: reqText.trim() });
                            x.status = 'revision';
                            x.step = 6;
                            x.log.push({ at: now(), byId: d.currentUserId, text: `보완 요청: ${reqText.trim()}` });
                          });
                          setReqText('');
                          toast('보완을 요청했습니다');
                        }}
                      >
                        <MessageSquareWarning size={14} />
                        보완 요청
                      </Button>
                    </div>
                    <Button
                      variant="primary"
                      disabled={!isTo}
                      onClick={() => {
                        mut((x, d) => {
                          x.status = 'accepted';
                          x.step = 7;
                          x.acceptedAt = now();
                          x.log.push({ at: now(), byId: d.currentUserId, text: '인수 확인' });
                        });
                        toast('인수를 확인했습니다');
                      }}
                    >
                      <Check size={14} />
                      인수 확인
                    </Button>
                  </>
                )}
                {h.status === 'accepted' && (
                  <Button variant="primary" disabled={!isTo && !isFrom} onClick={confirm}>
                    <Camera size={14} />
                    인계 확정 및 업무정보 스냅샷 보존
                  </Button>
                )}
              </div>
            </Card>
          )}

          {h.status === 'confirmed' && h.snapshotId && (
            <Card className="border-ok/40 p-5">
              <div className="flex flex-wrap items-center gap-3">
                <Camera size={20} className="text-ok" />
                <div className="flex-1">
                  <p className="text-[14px] font-semibold">인계 확정 완료</p>
                  <p className="text-xs text-muted">확정 시점 업무정보 v{s.snapshots.find((x) => x.id === h.snapshotId)?.version} 보존 · 이후 업무정보가 바뀌어도 당시 내용을 그대로 조회할 수 있습니다.</p>
                </div>
                <Button variant="primary" onClick={() => nav(`/snapshots/${h.snapshotId}`)}>
                  인계 당시 스냅샷 조회
                </Button>
              </div>
            </Card>
          )}
        </div>

        {/* 기록 */}
        <div className="space-y-5">
          <Card>
            <CardHead title="인계 기록" />
            <dl className="px-4 py-2">
              <KV k="인계 ID"><Mono className="text-[13px] text-ink">{h.id}</Mono></KV>
              <KV k="업무 ID"><Mono className="text-[13px] text-ink">{w.id}</Mono> <StatusBadge status={w.status} /></KV>
              <KV k="인계자">{userName(s, h.fromId)}</KV>
              <KV k="인수자">{userName(s, h.toId)}</KV>
              <KV k="인계 후 인계자">{h.fromLeaves === null ? '선택 전' : h.fromLeaves ? '담당 종료' : '공동 담당 유지'}</KV>
              <KV k="인계 기준일">{fmtDate(h.baseDate)}</KV>
              <KV k="제출일">{h.submittedAt ? fmtDateTime(h.submittedAt) : '—'}</KV>
              <KV k="인수 확인일">{h.acceptedAt ? fmtDateTime(h.acceptedAt) : '—'}</KV>
              <KV k="확정일">{h.confirmedAt ? fmtDateTime(h.confirmedAt) : '—'}</KV>
              <KV k="업무정보 버전">{h.snapshotId ? `v${s.snapshots.find((x) => x.id === h.snapshotId)?.version} (스냅샷)` : `현재 v${w.version}`}</KV>
            </dl>
          </Card>
          <Card>
            <CardHead title="미완료 과제" sub={`${openActs.length}건 — 인수자에게 그대로 이관`} />
            <ul className="divide-y divide-line">
              {openActs.map((a) => (
                <li key={a.id} className="px-4 py-2 text-[13px]">
                  {a.title}
                  <span className="ml-2 text-2xs text-muted tnum">{a.due ? fmtDate(a.due) : '기한 미지정'}</span>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <CardHead title="보완 요청 내역" sub={`${h.requests.length}건`} />
            <ul className="divide-y divide-line">
              {h.requests.map((r) => (
                <li key={r.id} className="px-4 py-2.5 text-[13px]">
                  <p>
                    <b className="text-warn">요청</b> {r.text}
                  </p>
                  <p className="text-2xs text-muted">
                    {userName(s, r.byId)} · {fmtDateTime(r.at)}
                  </p>
                  {r.response && (
                    <p className="mt-1">
                      <b className="text-fact">답변</b> {r.response}
                    </p>
                  )}
                </li>
              ))}
              {!h.requests.length && <li className="px-4 py-3 text-xs text-muted">없음</li>}
            </ul>
          </Card>
          <Card>
            <CardHead title="인계·인수 확인 이력" />
            <ol className="space-y-2 px-4 py-3">
              {h.log.map((l, i) => (
                <li key={i} className="grid grid-cols-[110px_1fr] gap-2 text-[13px]">
                  <span className="text-2xs text-muted tnum">{fmtDateTime(l.at)}</span>
                  <span>
                    {l.text} <span className="text-2xs text-faint">· {userName(s, l.byId)}</span>
                  </span>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </div>
  );
}
