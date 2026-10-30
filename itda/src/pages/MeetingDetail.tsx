import { useEffect } from 'react';
import { Sparkles, Info } from 'lucide-react';
import { useStore } from '../lib/store';
import { useRouter } from '../lib/router';
import { Card, CardHead, ProvChip, CiteLink, Empty, Button, KV } from '../components/ui';
import type { Prov } from '../lib/types';
import { fmtDate, cx } from '../lib/util';

export default function MeetingDetail({ id }: { id: string }) {
  const { s } = useStore();
  const { nav } = useRouter();
  const doc = s.docs.find((d) => d.id === id && d.type === '회의록');
  if (!doc) return <Empty title="회의록을 찾을 수 없거나 열람 권한이 없습니다" action={<Button onClick={() => nav('/meetings')}>회의록 목록</Button>} />;
  return <MeetingDoc docId={doc.id} />;
}

function L({ prov, children, cite }: { prov: Prov; children: React.ReactNode; cite?: { docId: string; anchor?: string; label?: string }[] }) {
  return (
    <div className={cx('rounded-md border-l-[3px] py-0.5 pl-2.5', prov === 'fact' ? 'border-fact' : prov === 'inference' ? 'border-infer' : 'border-warn')}>
      <p className="text-[13px] leading-relaxed">{children}</p>
      <div className="mt-1 flex flex-wrap gap-1">
        <ProvChip prov={prov} />
        {cite?.map((c, i) => <CiteLink key={i} c={c} />)}
      </div>
    </div>
  );
}

// ─── 회의록 (문서함의 '회의록' 유형 문서) ───
function MeetingDoc({ docId }: { docId: string }) {
  const { s } = useStore();
  const { nav, query } = useRouter();
  const d = s.docs.find((x) => x.id === docId)!;
  const anchor = query.get('anchor');
  const decs = s.decisions.filter((x) => x.cite.some((c) => c.docId === d.id));
  const evs = s.events.filter((x) => x.docIds.includes(d.id) || x.cite.some((c) => c.docId === d.id));
  const acts = s.actions.filter((x) => x.cite?.some((c) => c.docId === d.id));
  useEffect(() => {
    if (!anchor) return;
    const el = document.getElementById(`gm-${anchor}`);
    el?.scrollIntoView({ block: 'center' });
    el?.classList.add('anchor-hit');
  }, [anchor]);
  return (
    <div className="space-y-5">
      <div>
        <div className="mb-1 text-xs text-muted">
          <button className="hover:text-ink" onClick={() => nav('/meetings')}>회의록</button> / {d.title}
        </div>
        <h1 className="text-[22px] font-bold tracking-tight">{d.title}</h1>
      </div>
      <div className="grid gap-5 xl:grid-cols-[1.15fr_1fr]">
        <Card className="min-w-0 p-4 sm:p-5">
          <div className="mb-3 text-2xs font-semibold uppercase tracking-[0.08em] text-faint">회의록 원문 (등록 본문)</div>
          {d.paragraphs?.length ? (
            <div className="space-y-1.5">
              {d.paragraphs.map((p) => (
                <p key={p.id} id={`gm-${p.id}`} className="rounded px-2 py-1 text-[13.5px] leading-relaxed">
                  <span className="mr-2 font-mono text-2xs text-faint">{p.page ? `${p.page}쪽 · ` : ''}{p.id}</span>
                  {p.text}
                </p>
              ))}
            </div>
          ) : (
            <p className="text-[13px] text-muted">표시할 본문이 없습니다.</p>
          )}
        </Card>
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHead title="회의 기본정보" />
            <dl className="px-4 py-2">
              <KV k="회의명">{d.title}</KV>
              <KV k="일시">{fmtDate(d.writtenAt)}</KV>
              <KV k="출처">{d.source}</KV>
              <KV k="관련 업무">
                {d.workIds.length
                  ? d.workIds.map((w) => (
                      <button key={w} className="mr-2 text-brand hover:underline" onClick={() => nav(`/works/${w}`)}>
                        {s.works.find((x) => x.id === w)?.name}
                      </button>
                    ))
                  : '없음'}
              </KV>
            </dl>
          </Card>
          <Card>
            <CardHead icon={<Sparkles size={16} />} title={d.analyzedBy === 'claude' ? 'AI 요약' : '요약(규칙 기반)'} right={d.summary.length ? (d.analyzedBy === 'claude' ? <ProvChip prov="inference" /> : <span className="rounded bg-sunken px-1.5 text-2xs font-semibold text-muted">규칙 기반</span>) : undefined} />
            <div className="px-4 py-3 text-[13px]">
              {d.summary.length ? (
                <ol className="list-decimal space-y-1 pl-4">
                  {d.summary.map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ol>
              ) : (
                <p className="text-muted">요약 없음</p>
              )}
            </div>
          </Card>
          <Card>
            <CardHead title="이 회의록에서 업무에 반영된 항목" sub="등록 시 담당자가 승인한 항목만 표시" />
            <div className="space-y-3 px-4 py-3 text-[13px]">
              {!decs.length && !evs.length && !acts.length && <p className="text-muted">반영된 항목 없음</p>}
              {decs.map((x) => (
                <L key={x.id} prov={x.prov} cite={x.cite}>
                  결정 · {fmtDate(x.date)} {x.title}
                </L>
              ))}
              {evs.map((x) => (
                <L key={x.id} prov={x.source === 'original' ? 'fact' : 'unverified'} cite={x.cite}>
                  타임라인 · {fmtDate(x.date)} {x.title}
                </L>
              ))}
              {acts.map((x) => (
                <L key={x.id} prov={x.note && /확인 필요/.test(x.note) ? 'unverified' : 'fact'} cite={x.cite}>
                  향후 조치 · {x.title}
                  {x.due ? ` (기한 ${fmtDate(x.due)})` : ''}
                </L>
              ))}
              <p className="flex items-start gap-1.5 text-2xs text-muted">
                <Info size={12} className="mt-0.5 shrink-0" />
                이 회의록은 본문과 업무에 반영된 항목을 표시합니다.
              </p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
