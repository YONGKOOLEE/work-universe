import { useEffect, useRef, useState } from 'react';
import { Search, Sparkles, FileText, GitCommitVertical, FolderKanban, MessageCircleQuestion, Loader2, CornerDownRight, Quote, Bot, Square, ShieldCheck } from 'lucide-react';
import { useStore } from '../lib/store';
import { useRouter } from '../lib/router';
import { Card, ProvChip, CiteLink, SourceChip, ProvLegend, StatusBadge, Button } from '../components/ui';
import { askAI, SAMPLE_QUESTIONS, type Answer } from '../ai/engine';
import { fmtDate } from '../lib/util';
import { useAI } from '../ai/claude';
import { claudeAsk } from '../ai/claudeSearch';
import { sampleQuestions } from '../ai/workAnswer';

export default function SearchPage() {
  const { s, update } = useStore();
  const { query, nav } = useRouter();
  const [q, setQ] = useState(query.get('q') ?? '');
  const [ans, setAns] = useState<Answer | null>(null);
  const [busy, setBusy] = useState(false);
  const [meta, setMeta] = useState<{ engine: 'claude' | 'mock'; verify?: { checked: number; passed: number }; note?: string } | null>(null);
  const ai = useAI();
  const ctl = useRef<AbortController | null>(null);

  const ask = async (text: string) => {
    const t = text.trim();
    if (!t) return;
    ctl.current?.abort();
    setQ(t);
    setBusy(true);
    setAns(null);
    setMeta(null);
    update((d) => {
      d.searchLog = [t, ...d.searchLog.filter((x) => x !== t)].slice(0, 6);
    });
    if (ai.engine === 'claude' && ai.sample) {
      const c = new AbortController();
      ctl.current = c;
      try {
        const r = await claudeAsk(ai.sample, s, t, c.signal);
        if (c.signal.aborted) return;
        setAns(r);
        setMeta({ engine: 'claude', verify: r.verify });
      } catch (e) {
        if ((e as { code?: string })?.code === 'cancelled') {
          setBusy(false);
          return;
        }
        const msg = ai.onError(e);
        setAns(askAI(s, t));
        setMeta({ engine: 'mock', note: `${msg} 아래는 규칙 기반 Mock 답변입니다.` });
      }
      setBusy(false);
      return;
    }
    window.setTimeout(() => {
      setAns(askAI(s, t));
      setMeta({ engine: 'mock' });
      setBusy(false);
    }, 450);
  };

  // Claude 연결 확인이 끝난 뒤에 URL 질문을 실행 (확인 전 실행되면 Mock으로 답하게 됨)
  const lastAsked = useRef<string | null>(null);
  useEffect(() => {
    if (ai.status === 'checking') return;
    const qq = query.get('q');
    if (qq && lastAsked.current !== qq) {
      lastAsked.current = qq;
      ask(qq);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.get('q'), ai.status]);

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <h1 className="text-[22px] font-bold tracking-tight">AI 업무 검색</h1>
        <p className="text-[13px] text-muted">등록된 업무·문서·회의록만 근거로 답합니다. 원문에서 확인되지 않는 내용은 '추가 확인 필요'로 안내합니다.</p>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(q);
        }}
        className="flex gap-2"
      >
        <div className="relative flex-1">
          <Search size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
          <input
            id="ai-q"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`예: ${sampleQuestions(s, SAMPLE_QUESTIONS)[0]}`}
            className="h-12 w-full rounded-lg border border-line2 bg-surface pl-11 pr-3 text-[15px] shadow-card placeholder:text-faint focus:border-brand focus:outline-none"
          />
        </div>
        <Button type="submit" variant="primary" className="h-12 px-5" disabled={busy}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
          질문
        </Button>
      </form>
      <div className="flex flex-wrap gap-1.5">
        {sampleQuestions(s, SAMPLE_QUESTIONS).map((x) => (
          <button key={x} onClick={() => ask(x)} className="rounded-full border border-line2 bg-surface px-3 py-1 text-xs text-muted hover:border-brand hover:text-brand">
            {x}
          </button>
        ))}
      </div>

      {busy && (
        <Card className="flex flex-wrap items-center gap-2 p-5 text-[13px] text-muted">
          <Loader2 size={16} className="animate-spin" />
          <span className="flex-1">
            {ai.engine === 'claude'
              ? 'Claude가 등록 자료를 읽고 답변을 작성하는 중입니다. 처음 호출할 때는 사용 동의 창이 뜨며, 답변까지 보통 10~60초 걸립니다.'
              : '등록된 업무·문서·회의록에서 근거를 찾는 중'}
          </span>
          {ai.engine === 'claude' && (
            <Button
              size="sm"
              onClick={() => {
                ctl.current?.abort();
                setBusy(false);
              }}
            >
              <Square size={12} />
              중지
            </Button>
          )}
        </Card>
      )}

      {ans && (
        <div className="space-y-4">
          <Card className="overflow-hidden border-brand/30">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-brandsoft/40 px-5 py-3">
              <h2 className="flex items-center gap-2 text-[15px] font-semibold">
                <Sparkles size={16} className="text-brand" />
                AI 종합 답변
              </h2>
              <ProvLegend />
            </div>
            <div className="space-y-3 px-5 py-4">
              <p className="text-xs text-muted">
                질문: <b className="text-ink">{ans.query}</b>
              </p>
              {meta?.note && <p className="rounded-md bg-warnsoft px-3 py-2 text-xs text-warn">{meta.note}</p>}
              {ans.scope && meta?.engine === 'mock' && <p className="rounded-md bg-warnsoft px-3 py-2 text-xs text-warn">{ans.scope}</p>}
              {ans.lines.map((l, i) => (
                <div key={i} className={'border-l-[3px] pl-3 ' + (l.prov === 'fact' ? 'border-fact' : l.prov === 'inference' ? 'border-infer' : l.prov === 'owner' ? 'border-owner' : 'border-warn')}>
                  <p className="text-[14.5px] leading-relaxed">{l.text}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <ProvChip prov={l.prov} />
                    {l.cite?.map((c, j) => <CiteLink key={j} c={c} />)}
                  </div>
                </div>
              ))}
              {ans.table && (
                <div className="overflow-x-auto scroll-thin">
                  <table className="w-full min-w-[560px] border border-line text-[13px]">
                    <thead>
                      <tr className="bg-sunken">
                        {ans.table.head.map((h) => (
                          <th key={h} className="border border-line px-3 py-2 text-left font-semibold">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {ans.table.rows.map((r, i) => (
                        <tr key={i}>
                          {r.map((c, j) => (
                            <td key={j} className={'border border-line px-3 py-2 align-top ' + (j === 0 ? 'font-medium text-muted' : '')}>
                              {c}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {meta?.engine === 'claude' ? (
                <p className="flex flex-wrap items-center gap-1.5 text-2xs text-faint">
                  <Bot size={12} className="text-brand" />
                  Claude 답변 · 등록 자료만 제공해 생성
                  {meta.verify && (
                    <span className="inline-flex items-center gap-1">
                      <ShieldCheck size={12} className="text-fact" />
                      인용 검증 {meta.verify.passed}/{meta.verify.checked}건 통과 — 원문과 일치하지 않는 인용은 '추가 확인 필요'로 낮춤
                    </span>
                  )}
                </p>
              ) : (
                <p className="text-2xs text-faint">Mock 답변 · 규칙 기반 시연 엔진이 등록 자료에서 생성.</p>
              )}
            </div>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <Head icon={<FileText size={15} />} title="핵심 근거 문서" n={ans.evidence.length} />
              <ul className="divide-y divide-line">
                {ans.evidence.map((e, i) => {
                  const d = s.docs.find((x) => x.id === e.docId);
                  return (
                    <li key={i} className="px-4 py-3">
                      <button className="text-left text-[13.5px] font-semibold text-brand hover:underline" onClick={() => nav(`/docs/${e.docId}${e.anchor ? `?anchor=${e.anchor}` : ''}`)}>
                        {d?.title ?? e.docId}
                        {e.anchor && <span className="ml-1 text-xs font-normal">· {e.anchor.replace('item-', '')}번 안건으로 이동</span>}
                      </button>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-2xs text-muted">
                        {d && <span className="rounded bg-sunken px-1 font-medium">{d.type}</span>}
                        <span>{e.why}</span>
                      </div>
                      {e.quote && (
                        <blockquote className="mt-2 flex gap-2 rounded-md bg-sunken px-3 py-2 text-xs leading-relaxed text-ink/85">
                          <Quote size={12} className="mt-0.5 shrink-0 text-faint" />
                          {e.quote}
                        </blockquote>
                      )}
                    </li>
                  );
                })}
                {!ans.evidence.length && <li className="px-4 py-3 text-xs text-muted">근거 문서 없음</li>}
              </ul>
            </Card>
            <Card>
              <Head icon={<GitCommitVertical size={15} />} title="관련 타임라인" n={ans.events.length} />
              <ul className="divide-y divide-line">
                {ans.events.map((id) => {
                  const e = s.events.find((x) => x.id === id);
                  if (!e) return null;
                  return (
                    <li key={id}>
                      <button onClick={() => nav(`/timeline?work=${e.workIds[0]}&event=${e.id}`)} className="flex w-full flex-wrap items-center gap-2 px-4 py-2.5 text-left text-[13px] hover:bg-sunken/60">
                        <span className="w-[100px] whitespace-nowrap font-mono text-xs text-muted tnum">{fmtDate(e.date)}</span>
                        <span className="min-w-0 flex-1">{e.title}</span>
                        <SourceChip s={e.source} short />
                      </button>
                    </li>
                  );
                })}
                {!ans.events.length && <li className="px-4 py-3 text-xs text-muted">관련 이벤트 없음</li>}
              </ul>
            </Card>
            <Card>
              <Head icon={<FolderKanban size={15} />} title="관련 업무" n={ans.works.length} />
              <ul className="divide-y divide-line">
                {ans.works.map((id) => {
                  const w = s.works.find((x) => x.id === id);
                  if (!w) return null;
                  return (
                    <li key={id}>
                      <button onClick={() => nav(`/works/${id}`)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-[13px] hover:bg-sunken/60">
                        {w.parentId && <CornerDownRight size={12} className="text-faint" />}
                        <span className="flex-1 font-medium">{w.name}</span>
                        <StatusBadge status={w.status} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Card>
            <Card>
              <Head icon={<MessageCircleQuestion size={15} />} title="추가로 물어볼 질문" />
              <ul className="divide-y divide-line">
                {ans.followups.map((f) => (
                  <li key={f}>
                    <button onClick={() => ask(f)} className="w-full px-4 py-2.5 text-left text-[13px] text-brand hover:bg-sunken/60">
                      {f}
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </div>
      )}

      {!ans && !busy && s.searchLog.length > 0 && (
        <div className="text-xs text-muted">
          최근 질문:{' '}
          {s.searchLog.map((x) => (
            <button key={x} onClick={() => ask(x)} className="mr-2 text-brand hover:underline">
              {x}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Head({ icon, title, n }: { icon: React.ReactNode; title: string; n?: number }) {
  return (
    <div className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-[13.5px] font-semibold">
      <span className="text-brand">{icon}</span>
      {title}
      {n !== undefined && <span className="text-xs font-normal text-muted tnum">{n}</span>}
    </div>
  );
}
