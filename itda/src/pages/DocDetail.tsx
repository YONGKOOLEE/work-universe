import { useEffect, useState } from 'react';
import { Sparkles, AlertTriangle, ArrowRight, Link2, RefreshCw, Trash2 } from 'lucide-react';
import { canEdit, docDeleteAccess, useStore, userName } from '../lib/store';
import { deleteDoc, deleteImpact } from '../lib/docDelete';
import { useRouter } from '../lib/router';
import { Button, Card, CardHead, ProvChip, Mono, Empty, ExtLink, KV, Modal } from '../components/ui';
import { DocReanalyzeModal } from '../components/DocReanalyzeModal';
import { fmtDate, cx } from '../lib/util';

export default function DocDetail({ id }: { id: string }) {
  const { s, raw, update, toast } = useStore();
  const { query, nav } = useRouter();
  const d = s.docs.find((x) => x.id === id);
  const anchor = query.get('anchor');
  // 다시 분석: 연결된 업무 중 하나라도 내가 고칠 수 있으면(원문 문단이 있을 때). ?reanalyze=1 로 들어오면 바로 연다
  const canRe = !!d?.paragraphs?.length && !!raw.docs.find((x) => x.id === id)?.workIds.some((w) => canEdit(raw, w, raw.currentUserId));
  const [reOpen, setReOpen] = useState(false);
  // 문서 삭제: 이 문서 삭제로 내용이 바뀌는 모든 업무(연결 + 인용)를 내가 고칠 수 있을 때만(새 권한 규칙 없음). 일부만 고칠 수 있으면 비활성 + 이유
  const delAccess = docDeleteAccess(raw, id, raw.currentUserId);
  const [delOpen, setDelOpen] = useState(false);
  const impact = delOpen ? deleteImpact(raw, id) : null;
  const doDelete = () => {
    const title = raw.docs.find((x) => x.id === id)?.title ?? '';
    update((d) => deleteDoc(d, id, d.currentUserId, new Date().toISOString()));
    setDelOpen(false);
    nav('/docs');
    toast(`'${title}' 문서를 삭제했습니다 · 반영된 내용은 남고 근거만 '추가 확인 필요'로 바뀌었습니다`);
  };
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

  if (!d) return <Empty title="문서를 찾을 수 없습니다" sub="삭제되었거나 볼 수 없는 문서입니다. 문서함에서 다시 찾아 보세요." action={<Button onClick={() => nav('/docs')}>문서함</Button>} />;
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
          <div className="flex flex-wrap gap-2">
          {canRe && (
            <Button onClick={() => setReOpen(true)} data-testid="doc-reanalyze" title="등록 원문을 지금 엔진으로 다시 읽고, 아직 기록되지 않은 항목만 승인해 더합니다">
              <RefreshCw size={14} />
              다시 분석
            </Button>
          )}
          {delAccess.show && !delAccess.ok && (
            <div className="flex flex-col items-end gap-1">
              <Button variant="danger" disabled data-testid="doc-delete">
                <Trash2 size={14} />
                문서 삭제
              </Button>
              <p className="max-w-xs text-right text-2xs text-muted" data-testid="doc-delete-blocked">
                {delAccess.blocked.length
                  ? `내가 고칠 수 없는 업무(${delAccess.blocked.slice(0, 3).map((b) => b.name).join(', ')}${delAccess.blocked.length > 3 ? ` 외 ${delAccess.blocked.length - 3}건` : ''})에 걸린 문서라 삭제할 수 없습니다 — 그 업무 담당자나 조직장이 삭제할 수 있습니다`
                  : '이 문서는 업무에 걸려 있지 않아 올린 사람만 삭제할 수 있습니다'}
              </p>
            </div>
          )}
          {delAccess.ok && (
            <Button variant="danger" onClick={() => setDelOpen(true)} data-testid="doc-delete" title="이 문서를 지웁니다. 반영된 내용은 남고 근거만 '추가 확인 필요'로 바뀝니다">
              <Trash2 size={14} />
              문서 삭제
            </Button>
          )}
          </div>
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
      <Modal
        open={delOpen}
        onClose={() => setDelOpen(false)}
        title="문서 삭제"
        footer={
          <>
            <Button onClick={() => setDelOpen(false)}>취소</Button>
            <Button variant="danger" onClick={doDelete} data-testid="doc-delete-do">삭제</Button>
          </>
        }
      >
        <div data-testid="doc-delete-confirm" className="space-y-2 text-[13px]">
          <p className="font-semibold">'{d.title}' 문서를 삭제할까요?</p>
          {impact && (
            <ul className="list-disc space-y-0.5 pl-5 text-muted" data-testid="doc-delete-impact">
              <li>연결된 업무 {impact.works}건</li>
              <li>이 문서를 근거로 든 업무 문장 {impact.stmts}건 · 협의처 {impact.partners}건</li>
              <li>결정 {impact.decisions}건 · 조치 {impact.actions}건</li>
              <li>타임라인 이벤트 {impact.events}건{impact.autoEvents ? ` (문서 등록으로 생긴 ${impact.autoEvents}건 포함)` : ''}</li>
              <li>다른 문서와의 관계 {impact.relations}건</li>
              <li>근거가 이 문서뿐이라 「추가 확인 필요」로 바뀌는 항목 {impact.downgraded}건</li>
            </ul>
          )}
          <p className="rounded-md bg-warnsoft px-3 py-2 text-warn">반영된 내용은 남고 근거만 '추가 확인 필요'로 바뀝니다. 되돌릴 수 없습니다.</p>
        </div>
      </Modal>
      {canRe && <DocReanalyzeModal key={d.id} open={reOpen} onClose={() => { setReOpen(false); if (wantRe) nav(`/docs/${d.id}`); }} docId={d.id} />}
    </div>
  );
}
