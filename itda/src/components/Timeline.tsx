import { useMemo, useState } from 'react';
import { ArrowRight, ArrowDownRight, FileText, Gavel, Building2, Sparkles, Link2, Trash2, Undo2 } from 'lucide-react';
import type { TEvent, CauseLink } from '../lib/types';
import { useStore } from '../lib/store';
import { useRouter } from '../lib/router';
import { Chips, SourceChip, Drawer, CiteLink, ProvChip, Tag, Mono, Empty } from './ui';
import { fmtDate, dateKey, cx } from '../lib/util';

type F = 'all' | 'meeting' | 'decision' | 'law' | 'launch' | 'doc' | 'owner';
const FILTERS: { id: F; label: string; test: (e: TEvent) => boolean }[] = [
  { id: 'all', label: '전체', test: () => true },
  { id: 'meeting', label: '회의', test: (e) => e.type === '회의' },
  { id: 'decision', label: '의사결정', test: (e) => e.type === '의사결정' },
  { id: 'law', label: '법령', test: (e) => e.type === '법령' || (e.type === '업무 착수' && /법/.test(e.title)) || /시행령|법률/.test(e.title) },
  { id: 'launch', label: '시행', test: (e) => e.type === '시행' },
  { id: 'doc', label: '문서', test: (e) => e.type === '문서' },
  { id: 'owner', label: '담당자 변경', test: (e) => e.type === '담당자 변경' },
];
const PHASES = ['입법', '하위법령 정비', '시행·확대', '문서 등록 반영', '플랫폼 기록'];
const strong = (e: TEvent) => e.source === 'original' || e.source === 'cited';

const TYPE_CLS: Record<string, string> = {
  '업무 착수': 'bg-brandsoft text-brand',
  법령: 'bg-brandsoft text-brand',
  회의: 'bg-sunken text-muted',
  의사결정: 'bg-navy text-surface',
  보도자료: 'bg-sunken text-muted',
  시행: 'bg-oksoft text-ok',
  '업무 변경': 'bg-sunken text-muted',
  '담당자 변경': 'bg-ownersoft text-owner',
  문서: 'bg-infersoft text-infer',
};

export function Timeline({ workId, initialEvent }: { workId: string; initialEvent?: string }) {
  const { s, update, log, toast } = useStore();
  const [f, setF] = useState<F>('all');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ ev: TEvent; decs: string[]; causes: { eventId: string; cause: CauseLink }[] } | null>(null);

  // 타임라인 이벤트 삭제 — 연결(계기·결정사항)은 정리하고, 문서 자동 이벤트는 다시 만들지 않도록 표시
  const remove = (e: TEvent) => {
    const decs = s.decisions.filter((d) => d.eventId === e.id).map((d) => d.id);
    const causes = s.events.flatMap((x) => x.causes.filter((c) => c.eventId === e.id).map((cause) => ({ eventId: x.id, cause })));
    update((d) => {
      d.events = d.events.filter((x) => x.id !== e.id);
      d.events.forEach((x) => (x.causes = x.causes.filter((c) => c.eventId !== e.id)));
      d.decisions.forEach((x) => x.eventId === e.id && (x.eventId = undefined));
      if (e.autoDocId) {
        const doc = d.docs.find((x) => x.id === e.autoDocId);
        if (doc) doc.timelineOff = true;
      }
      e.workIds.forEach((w) => log(d, w, '타임라인', `이벤트 삭제: ${e.title}`));
    });
    setConfirmId(null);
    if (sel === e.id) setSel(null);
    setUndo({ ev: e, decs, causes });
  };
  const restore = () => {
    if (!undo) return;
    const { ev, decs, causes } = undo;
    update((d) => {
      if (!d.events.some((x) => x.id === ev.id)) d.events.push(ev);
      causes.forEach(({ eventId, cause }) => d.events.find((x) => x.id === eventId)?.causes.push(cause));
      d.decisions.forEach((x) => decs.includes(x.id) && (x.eventId = ev.id));
      if (ev.autoDocId) {
        const doc = d.docs.find((x) => x.id === ev.autoDocId);
        if (doc) doc.timelineOff = false;
      }
      ev.workIds.forEach((w) => log(d, w, '타임라인', `이벤트 삭제 취소: ${ev.title}`));
    });
    setUndo(null);
    toast('삭제한 이벤트를 되돌렸습니다');
  };
  const undoBar = undo && (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-sunken px-3 py-2 text-[13px]">
      <Trash2 size={14} className="text-muted" />
      <span className="min-w-0 flex-1 truncate">'{undo.ev.title}' 이벤트를 삭제했습니다</span>
      <button className="inline-flex items-center gap-1 font-semibold text-brand hover:underline" onClick={restore}>
        <Undo2 size={13} />
        되돌리기
      </button>
      <button className="text-xs text-muted hover:text-ink" onClick={() => setUndo(null)}>
        닫기
      </button>
    </div>
  );
  const [onlyStrong, setOnlyStrong] = useState(false);
  const [sel, setSel] = useState<string | null>(initialEvent ?? null);

  const all = useMemo(
    () => s.events.filter((e) => workId === 'all' || e.workIds.includes(workId)).sort((a, b) => dateKey(a.date).localeCompare(dateKey(b.date)) || a.id.localeCompare(b.id)),
    [s.events, workId],
  );
  const list = all.filter((e) => FILTERS.find((x) => x.id === f)!.test(e) && (!onlyStrong || strong(e)));
  const byId = Object.fromEntries(s.events.map((e) => [e.id, e]));
  const selected = sel ? byId[sel] : null;

  if (!all.length)
    return (
      <div className="space-y-3">
        {undoBar}
        <Empty title="등록된 타임라인 이벤트가 없습니다" sub="회의록·기타 외 문서를 등록하면 연결 업무의 타임라인에 자동으로 추가됩니다." />
      </div>
    );

  const phases = PHASES.map((p) => ({ p, evs: all.filter((e) => e.phase === p) })).filter((x) => x.evs.length);

  return (
    <div className="space-y-4">
      {/* 인과 흐름 요약 */}
      <div className="overflow-x-auto scroll-thin">
        <div className="flex min-w-max items-stretch gap-2">
          {phases
            .filter((x) => x.p !== '플랫폼 기록')
            .map((x, i, arr) => {
              const first = x.evs[0];
              const last = x.evs[x.evs.length - 1];
              const sc = x.evs.filter(strong).length;
              return (
                <div key={x.p} className="flex items-center gap-2">
                  <div className="w-[220px] rounded-lg border border-line bg-surface p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] font-semibold">{x.p}</span>
                      <span className="text-2xs text-muted tnum">{x.evs.length}건</span>
                    </div>
                    <div className="mt-0.5 text-2xs text-muted tnum">
                      {fmtDate(first.date)} – {fmtDate(last.date)}
                    </div>
                    <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-warnsoft" title={`원문 근거 ${sc}건 / 참고정보 ${x.evs.length - sc}건`}>
                      <div className="h-full bg-fact" style={{ width: `${(sc / x.evs.length) * 100}%` }} />
                    </div>
                    <div className="mt-1 text-2xs text-faint">
                      원문 근거 {sc} · 참고정보 {x.evs.length - sc}
                    </div>
                  </div>
                  {i < arr.length - 1 && (
                    <div className="flex flex-col items-center text-2xs text-faint">
                      <ArrowRight size={16} />
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      </div>

      {undoBar}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Chips items={FILTERS.map((x) => ({ id: x.id, label: x.label, count: all.filter(x.test).length }))} value={f} onChange={setF} />
        <label className="flex items-center gap-2 text-xs text-muted">
          <input type="checkbox" className="accent-[rgb(var(--brand))]" checked={onlyStrong} onChange={(e) => setOnlyStrong(e.target.checked)} />
          원문 근거가 있는 이벤트만
        </label>
      </div>

      <div className="flex flex-wrap gap-3 text-2xs text-muted">
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-full border-2 border-fact bg-fact" />원문 확보·인용 확인</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-full border-2 border-dashed border-warn bg-surface" />정책 이력 참고정보 / 별도 확인 필요</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-full border-2 border-owner bg-ownersoft" />플랫폼 기록</span>
      </div>

      <ol className="relative">
        {list.map((e, i) => {
          const prevPhase = i > 0 ? list[i - 1].phase : null;
          const followers = s.events.filter((x) => x.causes.some((c) => c.eventId === e.id));
          return (
            <li key={e.id} className="relative">
              {e.phase !== prevPhase && (
                <div className="mb-2 mt-1 pl-[88px] text-2xs font-bold uppercase tracking-[0.08em] text-faint sm:pl-[120px]">{e.phase}</div>
              )}
              <div className="grid grid-cols-[76px_24px_1fr] gap-x-0 sm:grid-cols-[108px_24px_1fr]">
                <div className="pr-2 pt-3 text-right font-mono text-[12px] leading-tight text-muted tnum">{fmtDate(e.date)}</div>
                <div className="relative flex justify-center">
                  <span className="absolute bottom-0 top-0 w-px bg-line2" />
                  <span
                    className={cx(
                      'relative mt-3.5 h-3.5 w-3.5 rounded-full border-2',
                      strong(e) ? 'border-fact bg-fact' : e.source === 'record' ? 'border-owner bg-ownersoft' : 'border-dashed border-warn bg-surface',
                    )}
                  />
                </div>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setSel(e.id)}
                  onKeyDown={(k) => k.key === 'Enter' && setSel(e.id)}
                  className={cx(
                    'group relative mb-3 ml-2 min-w-0 cursor-pointer rounded-lg border bg-surface p-3 pr-10 text-left shadow-card transition-colors hover:border-brand/50',
                    sel === e.id ? 'border-brand ring-1 ring-brand' : 'border-line',
                    !strong(e) && e.source !== 'record' && 'border-dashed',
                  )}
                >
                  <button
                    aria-label="이벤트 삭제"
                    title="타임라인에서 삭제"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      setConfirmId(confirmId === e.id ? null : e.id);
                    }}
                    className="absolute right-2 top-2 rounded p-1 text-faint hover:bg-dangersoft hover:text-danger"
                  >
                    <Trash2 size={14} />
                  </button>
                  {confirmId === e.id && (
                    <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md bg-dangersoft px-2.5 py-1.5 text-xs text-danger" onClick={(ev) => ev.stopPropagation()}>
                      <span className="flex-1">이 이벤트를 타임라인에서 삭제할까요?{e.autoDocId ? ' (문서는 삭제되지 않음)' : ''}</span>
                      <button className="rounded bg-danger px-2 py-0.5 font-semibold text-surface" onClick={() => remove(e)}>
                        삭제
                      </button>
                      <button className="px-1 font-medium" onClick={() => setConfirmId(null)}>
                        취소
                      </button>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={cx('rounded px-1.5 py-px text-2xs font-semibold', TYPE_CLS[e.type])}>{e.type}</span>
                    <SourceChip s={e.source} short />
                    {e.docIds.length > 0 && (
                      <span className="inline-flex items-center gap-0.5 text-2xs text-muted">
                        <FileText size={11} />
                        문서 {e.docIds.length}
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5 text-[13.5px] font-semibold leading-snug">{e.title}</div>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted">{e.summary}</p>
                  {(e.causes.length > 0 || followers.length > 0) && (
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 border-t border-line pt-2 text-2xs">
                      {e.causes.map((c) => (
                        <span key={c.eventId} className="inline-flex items-center gap-1 text-muted">
                          <span className={cx('font-semibold', c.basis === 'fact' ? 'text-fact' : 'text-infer')}>계기{c.basis === 'fact' ? '(원문)' : '(추론)'}</span>
                          {byId[c.eventId]?.title.slice(0, 26)}
                          {(byId[c.eventId]?.title.length ?? 0) > 26 && '…'}
                        </span>
                      ))}
                      {followers.length > 0 && (
                        <span className="inline-flex items-center gap-1 text-muted">
                          <ArrowDownRight size={11} />
                          후속 {followers.length}건
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      <Drawer open={!!selected} onClose={() => setSel(null)} title={selected ? <EventTitle e={selected} /> : ''}>
        {selected && <EventDetail e={selected} onPick={setSel} />}
      </Drawer>
    </div>
  );
}

function EventTitle({ e }: { e: TEvent }) {
  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center gap-1.5">
        <Mono>{e.id}</Mono>
        <span className="font-mono text-xs text-muted">{fmtDate(e.date)}</span>
        <SourceChip s={e.source} />
      </div>
      <div className="leading-snug">{e.title}</div>
    </div>
  );
}

function EventDetail({ e, onPick }: { e: TEvent; onPick: (id: string) => void }) {
  const { s } = useStore();
  const { nav } = useRouter();
  const byId = Object.fromEntries(s.events.map((x) => [x.id, x]));
  const followers = s.events.filter((x) => x.causes.some((c) => c.eventId === e.id));
  const srcText: Record<string, string> = {
    original: '등록된 원문에서 직접 확인된 이벤트입니다.',
    cited: '이 이벤트의 원문은 등록되지 않았지만, 다른 원문 안에 날짜·내용이 인용되어 있어 확인됩니다.',
    reference: '정책 이력 참고정보입니다. 관련 원문이 등록되지 않아 내용을 확정하지 않습니다.',
    link: '관련 문서가 링크로만 등록되어 본문이 확인되지 않았습니다.',
    record: '플랫폼 내부 기록입니다.',
    unverified: '등록 문서에서 추출했지만 원문 근거 문장(또는 날짜)이 확인되지 않아 확정하지 않은 이벤트입니다. 별도 확인 필요.',
  };
  return (
    <div className="space-y-5 text-[13.5px]">
      <p className={cx('rounded-md px-3 py-2 text-xs', e.source === 'original' || e.source === 'cited' ? 'bg-factsoft text-fact' : e.source === 'record' ? 'bg-ownersoft text-owner' : 'bg-warnsoft text-warn')}>{srcText[e.source]}</p>
      <section>
        <h4 className="mb-1 text-xs font-semibold text-muted">핵심 내용</h4>
        <p>{e.summary}</p>
      </section>
      <div className="grid grid-cols-2 gap-3 text-[13px]">
        <div>
          <h4 className="mb-1 flex items-center gap-1 text-xs font-semibold text-muted"><Building2 size={12} />담당기관</h4>
          <p>{e.agency}</p>
        </div>
        <div>
          <h4 className="mb-1 flex items-center gap-1 text-xs font-semibold text-muted"><Gavel size={12} />결정사항</h4>
          {e.decisions.length ? e.decisions.map((d, i) => <p key={i}>{d}</p>) : <p className="text-faint">기록 없음</p>}
        </div>
      </div>
      <section>
        <h4 className="mb-1.5 text-xs font-semibold text-muted">관련 문서 · 근거</h4>
        <div className="flex flex-wrap gap-1.5">
          {e.cite.map((c, i) => <CiteLink key={i} c={c} />)}
          {e.docIds
            .filter((id) => !e.cite.some((c) => c.docId === id))
            .map((id) => {
              const d = s.docs.find((x) => x.id === id);
              return (
                <button key={id} onClick={() => nav(`/docs/${id}`)} className="inline-flex items-center gap-1 rounded border border-line2 px-1.5 py-px text-2xs text-muted hover:text-ink">
                  <Link2 size={11} />
                  {d?.title ?? id}
                </button>
              );
            })}
          {!e.cite.length && !e.docIds.length && <span className="text-xs text-warn">연결된 근거 문서 없음 — 원문 확보 필요</span>}
        </div>
      </section>
      <section className="rounded-md border border-infer/25 bg-infersoft/60 p-3">
        <h4 className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-infer">
          <Sparkles size={12} />
          AI가 분석한 의미
        </h4>
        <p>{e.meaning}</p>
        <div className="mt-1.5">
          <ProvChip prov="inference" />
        </div>
      </section>
      <section>
        <h4 className="mb-2 text-xs font-semibold text-muted">선후 · 인과관계</h4>
        <div className="space-y-2">
          {e.causes.map((c) => (
            <button key={c.eventId} onClick={() => onPick(c.eventId)} className="block w-full rounded-md border border-line p-2.5 text-left hover:border-brand/50">
              <div className="flex items-center gap-1.5 text-2xs">
                <Tag>선행 · 계기</Tag>
                <ProvChip prov={c.basis === 'fact' ? 'fact' : 'inference'} />
                <span className="font-mono text-muted">{fmtDate(byId[c.eventId]?.date)}</span>
              </div>
              <div className="mt-1 text-[13px] font-medium">{byId[c.eventId]?.title}</div>
              <div className="text-2xs text-muted">{c.note}</div>
              {c.cite && <div className="mt-1 flex gap-1">{c.cite.map((x, i) => <CiteLink key={i} c={x} />)}</div>}
            </button>
          ))}
          {followers.map((x) => (
            <button key={x.id} onClick={() => onPick(x.id)} className="block w-full rounded-md border border-line p-2.5 text-left hover:border-brand/50">
              <div className="flex items-center gap-1.5 text-2xs">
                <Tag>후속</Tag>
                <span className="font-mono text-muted">{fmtDate(x.date)}</span>
              </div>
              <div className="mt-1 text-[13px] font-medium">{x.title}</div>
              <div className="text-2xs text-muted">{x.causes.find((c) => c.eventId === e.id)?.note}</div>
            </button>
          ))}
          {!e.causes.length && !followers.length && <p className="text-xs text-faint">연결된 선후 이벤트 없음</p>}
        </div>
      </section>
      <section className="flex flex-wrap gap-1.5">
        {e.workIds.map((id) => (
          <button key={id} onClick={() => nav(`/works/${id}`)} className="rounded-full border border-line2 px-2 py-0.5 text-2xs text-muted hover:text-ink">
            {s.works.find((w) => w.id === id)?.name}
          </button>
        ))}
      </section>
    </div>
  );
}
