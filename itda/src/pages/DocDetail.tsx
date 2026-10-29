import { useEffect, useState } from 'react';
import { Sparkles, AlertTriangle, ArrowRight, Link2, RefreshCw } from 'lucide-react';
import { canEdit, useStore, userName } from '../lib/store';
import { useRouter } from '../lib/router';
import { Button, Card, CardHead, ProvChip, Mono, Empty, ExtLink, KV } from '../components/ui';
import { DocReanalyzeModal } from '../components/DocReanalyzeModal';
import { fmtDate, cx } from '../lib/util';

export default function DocDetail({ id }: { id: string }) {
  const { s, raw } = useStore();
  const { query, nav } = useRouter();
  const d = s.docs.find((x) => x.id === id);
  const anchor = query.get('anchor');
  // 다시 분석: 연결된 업무 중 하나라도 내가 고칠 수 있으면(원문 문단이 있을 때). ?reanalyze=1 로 들어오면 바로 연다
  const canRe = !!d?.paragraphs?.length && !!raw.docs.find((x) => x.id === id)?.workIds.some((w) => canEdit(raw, w, raw.currentUserId));
  const [reOpen, setReOpen] = useState(false);
  const wantRe = query.get('reanalyze') === '1';
  useEffect(() => {
    if (wantRe && canRe) setReOpen(true);
  }, [wantRe, canRe]);

  useEffect(() => {
    if (!anchor || !d) return;
    const el = document.getElementById(`doc-${anchor}`);
    if (el) {
      el.scrollIntoView({ block: 'center' });
      el.classList.add('anchor-hit');
    }
  }, [anchor, d]);

  if (!d) return <Empty title="문서를 찾을 수 없습니다" action={<Button onClick={() => nav('/docs')}>문서함</Button>} />;
  const inbound = s.docs.flatMap((x) => x.relations.filter((r) => r.targetId === d.id && !d.relations.some((o) => o.targetId === x.id)).map((r) => ({ from: x, r })));
  const evs = s.events.filter((e) => e.docIds.includes(d.id) || e.cite.some((c) => c.docId === d.id));

  return (
    <div className="space-y-5">
      <div>
        <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted">
          <button className="hover:text-ink" onClick={() => nav('/docs')}>문서함</button>
          <span>/</span>
          <Mono>{d.id}</Mono>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-[22px] font-bold leading-tight tracking-tight">{d.title}</h1>
          {canRe && (
            <Button onClick={() => setReOpen(true)} data-testid="doc-reanalyze" title="등록 원문을 지금 엔진으로 다시 읽고, 아직 기록되지 않은 항목만 승인해 더합니다">
              <RefreshCw size={14} />
              다시 분석
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
        <div className="space-y-5">
          <Card className="px-4 py-3">
            <dl>
              <KV k="문서 유형">{d.type}</KV>
              <KV k="작성일">{fmtDate(d.writtenAt)}</KV>
              <KV k="등록일">{fmtDate(d.registeredAt)} · {userName(s, d.registeredBy)}</KV>
              <KV k="출처">{d.source}</KV>
              {d.fileName && <KV k="원본 파일">{d.fileName}</KV>}
              {d.analyzedBy && <KV k="AI 분석">{d.analyzedBy === 'claude' ? 'Claude' : '규칙 기반'}{d.analyzedAt ? ` · ${fmtDate(d.analyzedAt)}` : ''}</KV>}
              {d.url && <KV k="원문 링크"><ExtLink href={d.url}>원문 링크</ExtLink></KV>}
              <KV k="관련 업무">
                {d.workIds.length ? (
                  d.workIds.map((w) => (
                    <button key={w} className="block text-left text-brand hover:underline" onClick={() => nav(`/works/${w}`)}>
                      {s.works.find((x) => x.id === w)?.name}
                    </button>
                  ))
                ) : (
                  <span className="text-muted">{d.analyzed ? (d.analyzedBy === 'claude' ? '없음 (AI 판단)' : '없음 (규칙 판단)') : '미연결'}</span>
                )}
              </KV>
            </dl>
            {d.note && <p className="mt-2 rounded-md bg-warnsoft px-3 py-2 text-xs text-warn">{d.note}</p>}
          </Card>

          <Card>
            <CardHead icon={<Sparkles size={15} />} title={d.analyzedBy === 'claude' ? 'AI 요약' : '요약(규칙 기반)'} right={d.summary.length ? (d.analyzedBy === 'claude' ? <ProvChip prov="inference" /> : <span className="rounded bg-sunken px-1.5 text-2xs font-semibold text-muted">규칙 기반</span>) : undefined} />
            <div className="px-4 py-3 text-[13px]">
              {d.summary.length ? (
                <ol className="list-decimal space-y-1.5 pl-4">
                  {d.summary.map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ol>
              ) : (
                <p className="text-warn">원문이 확보되지 않아 요약을 생성하지 않았습니다. 링크 원문을 확인한 뒤 본문을 등록하세요.</p>
              )}
              {d.relevance?.filter((r) => s.works.some((w) => w.id === r.workId)).map((r) => (
                <p key={r.workId} className={cx('mt-3 rounded-md px-3 py-2 text-xs', r.level === 'direct' ? 'bg-factsoft text-fact' : 'bg-sunken text-muted')}>
                  <b>{s.works.find((w) => w.id === r.workId)?.name}</b> — {r.level === 'direct' ? '직접 관련' : '직접 관련성 없음'}: {r.reason}
                </p>
              ))}
            </div>
          </Card>

          <Card>
            <CardHead icon={<Link2 size={15} />} title="문서 간 관계" />
            <ul className="divide-y divide-line">
              {d.relations.map((r, i) => {
                const t = s.docs.find((x) => x.id === r.targetId);
                return (
                  <li key={i}>
                    <button onClick={() => nav(`/docs/${r.targetId}`)} className="w-full px-4 py-2.5 text-left hover:bg-sunken/60">
                      <div className="flex items-center gap-1.5">
                        <span className="rounded bg-navy px-1.5 text-2xs font-semibold text-surface">{r.type}</span>
                        <ProvChip prov={r.basis === 'fact' ? 'fact' : 'inference'} label={r.basis !== 'fact' && d.analyzedBy !== 'claude' ? '규칙 추정' : undefined} />
                      </div>
                      <div className="mt-1 text-[13px] font-medium">{t?.title ?? r.targetId}</div>
                      <div className="text-2xs text-muted">{r.note}</div>
                    </button>
                  </li>
                );
              })}
              {inbound.map(({ from, r }, i) => (
                <li key={'in' + i}>
                  <button onClick={() => nav(`/docs/${from.id}`)} className="w-full px-4 py-2.5 text-left hover:bg-sunken/60">
                    <div className="flex items-center gap-1.5 text-2xs text-muted">
                      <ArrowRight size={11} className="rotate-180" />
                      이 문서를 '{r.type}'(으)로 참조
                    </div>
                    <div className="mt-1 text-[13px] font-medium">{from.title}</div>
                  </button>
                </li>
              ))}
              {!d.relations.length && !inbound.length && <li className="px-4 py-3 text-xs text-muted">등록된 관계 없음</li>}
            </ul>
          </Card>
          {evs.length > 0 && (
            <Card>
              <CardHead title="이 문서가 근거인 타임라인 이벤트" />
              <ul className="divide-y divide-line">
                {evs.map((e) => (
                  <li key={e.id}>
                    <button onClick={() => nav(`/timeline?work=${e.workIds[0]}&event=${e.id}`)} className="w-full px-4 py-2 text-left text-[13px] hover:bg-sunken/60">
                      <span className="mr-2 font-mono text-xs text-muted">{fmtDate(e.date)}</span>
                      {e.title}
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <Card className="min-w-0 p-4 sm:p-5">
          {d.paragraphs?.length ? (
            <div className="space-y-2">
              <div className="text-2xs font-semibold uppercase tracking-[0.08em] text-faint">등록 원문</div>
              {d.paragraphs.map((p) => (
                <p key={p.id} id={`doc-${p.id}`} className="rounded px-2 py-1 text-[13.5px] leading-relaxed">
                  <span className="mr-2 font-mono text-2xs text-faint">{p.page ? `${p.page}쪽 · ` : ''}{p.id}</span>
                  {p.text}
                </p>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <AlertTriangle size={28} className="text-warn" />
              <p className="text-[14px] font-semibold">표시할 본문이 없습니다</p>
              {d.url && <ExtLink href={d.url}>원문 링크 열기</ExtLink>}
            </div>
          )}
        </Card>
      </div>
      {canRe && <DocReanalyzeModal key={d.id} open={reOpen} onClose={() => { setReOpen(false); if (wantRe) nav(`/docs/${d.id}`); }} docId={d.id} />}
    </div>
  );
}
