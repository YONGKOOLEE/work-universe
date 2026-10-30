// 「묻기」 — 평소 말투의 질문을 검색 조건으로 해석해 이 브라우저의 고객 정보에서 찾고, 결과마다 근거를 보여 준다.
// 해석: 규칙(기본, 전송 없음) 또는 Claude(질문 문장과 기준일만 전송, 실패하면 규칙으로 대체).
import { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Loader2, Search, ShieldCheck, Square } from 'lucide-react';
import { Button, Card, Empty } from '../../components/ui';
import { INTERNAL_NOTICE } from '../../ai/claude';
import { createSeq } from '../../ai/llm';
import { Link, useRouter } from '../../lib/router';
import { cx } from '../../lib/util';
import { searchQuestion, type SearchOutcome } from '../nlsearch';
import { useAssistant } from './hooks';
import { customerPath, evidencePath } from './logic';
import { Avatar, DDay, Highlight, Pill, wrapCls } from './shared';

export const ASK_EXAMPLES = [
  '골프 좋아하는 은행 담당자 찾아줘',
  '최근 3개월 동안 만나지 못한 고객은?',
  '다음 달 생일인 고객 알려줘',
  'CMS 운영시간 확대에 관심을 보인 고객은?',
  '지난번에 자료를 요청했던 고객은 누구야?',
  '아직 처리하지 못한 요청사항을 모두 보여줘',
];

export default function AskView() {
  const { a, ai, userId } = useAssistant();
  const { nav, query } = useRouter();
  const [q, setQ] = useState(query.get('q') ?? '');
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<SearchOutcome | null>(null);
  const [err, setErr] = useState('');
  const ctl = useRef<AbortController | null>(null);
  const seq = useRef(createSeq());
  const stopAll = () => {
    ctl.current?.abort();
    ctl.current = null;
    seq.current.cancelAll();
  };
  // 화면을 떠나면 진행 중인 호출을 끊는다. 엔진을 바꾸거나 사용자를 바꾸면 진행 중인 호출을 끊고 늦은 결과를 버린다
  useEffect(() => stopAll, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (ctl.current) {
      stopAll();
      setBusy(false);
    }
    setOut(null);
    setErr('');
  }, [ai.engine, userId]); // eslint-disable-line react-hooks/exhaustive-deps

  const claude = ai.engine === 'claude' && !!ai.client;

  const run = async (text: string) => {
    const t = text.trim();
    if (!t) return;
    stopAll();
    const id = seq.current.next();
    const c = new AbortController();
    ctl.current = c;
    setQ(t);
    setBusy(true);
    setOut(null);
    setErr('');
    try {
      const r = await searchQuestion(a, t, new Date(), { client: ai.client, errorText: ai.onError, signal: c.signal });
      if (c.signal.aborted || !seq.current.isLatest(id)) return;
      if ('error' in r) setErr(r.error);
      else setOut(r);
    } catch (e) {
      if (c.signal.aborted || !seq.current.isLatest(id)) return;
      setErr(ai.onError(e));
    } finally {
      if (seq.current.isLatest(id)) setBusy(false);
    }
  };

  const kws = useMemo(() => {
    if (!out) return [];
    const c = out.conditions;
    return [...c.keywords.map((k) => k.text), ...c.conversationKeywords, ...c.requestKeywords, ...c.orgKeywords];
  }, [out]);

  return (
    <div className="space-y-4" data-testid="asst-ask">
      <Card className="space-y-3 p-4">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(q);
          }}
        >
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" aria-hidden="true" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="예: 골프 좋아하는 은행 담당자 찾아줘"
              aria-label="고객에 대한 질문"
              maxLength={200}
              className="h-11 w-full rounded-lg border border-line2 bg-surface pl-10 pr-3 text-[14px] placeholder:text-faint focus:border-brand focus:outline-none"
              data-testid="asst-ask-input"
            />
          </div>
          <Button type="submit" variant="primary" className="h-11 px-5" disabled={busy || !q.trim()} data-testid="asst-ask-submit">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
            검색
          </Button>
        </form>
        <div className="flex flex-wrap gap-1.5" aria-label="예시 질문">
          {ASK_EXAMPLES.map((x) => (
            <button key={x} onClick={() => run(x)} className="rounded-full border border-line2 bg-surface px-3 py-1 text-xs text-muted hover:border-brand hover:text-brand" data-testid="asst-ask-ex">
              {x}
            </button>
          ))}
        </div>
        <p className="flex items-start gap-1.5 text-xs text-muted" data-testid="asst-ask-note">
          {claude ? (
            <>
              <Bot size={13} className="mt-0.5 shrink-0 text-brand" aria-hidden="true" />
              <span>
                질문을 Claude({ai.model})가 검색 조건으로 해석합니다. <b className="text-ink">전송되는 것은 질문 문장과 오늘 날짜뿐</b>이며 고객 정보와 검색 결과는 보내지 않습니다. 질문에 고객 이름을 쓰면 그 이름도 함께 전송됩니다. 실제 검색은 이 브라우저에서만 합니다. 해석에 실패하면 규칙으로 대신합니다.
              </span>
            </>
          ) : (
            <>
              <ShieldCheck size={13} className="mt-0.5 shrink-0 text-ok" aria-hidden="true" />
              <span>
                {ai.preferred === 'internal' ? INTERNAL_NOTICE : '규칙으로 질문을 해석합니다. 외부로 보내는 것이 없습니다.'} 상단에서 키를 넣고 Claude를 고르면 더 다양한 표현을 이해합니다.
              </span>
            </>
          )}
        </p>
      </Card>

      {busy && (
        <Card className="flex flex-wrap items-center gap-2 p-4 text-[13px] text-muted" role="status">
          <Loader2 size={16} className="animate-spin" />
          <span className="flex-1">{claude ? 'Claude가 질문을 해석하는 중입니다(보통 몇 초).' : '고객 정보에서 찾는 중입니다.'}</span>
          {claude && (
            <Button
              size="sm"
              onClick={() => {
                stopAll();
                setBusy(false);
              }}
              data-testid="asst-ask-cancel"
            >
              <Square size={12} />
              취소
            </Button>
          )}
        </Card>
      )}
      {err && (
        <p className="rounded-lg border border-danger/40 bg-dangersoft px-4 py-2.5 text-[13px] text-danger" role="alert" data-testid="asst-ask-error">
          {err}
        </p>
      )}

      {out && (
        <div className="space-y-3" data-testid="asst-ask-result">
          {out.aiError && (
            <p className="rounded-lg border border-warn/40 bg-warnsoft/50 px-4 py-2.5 text-[13px] text-warn" role="status" data-testid="asst-ask-aierror">
              AI 해석에 실패해 규칙 해석으로 검색했습니다. ({out.aiError})
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface px-4 py-3">
            <Pill tone={out.mode === 'ai' ? 'infer' : 'muted'} data-testid="asst-ask-mode" data-mode={out.mode}>
              {out.mode === 'ai' ? 'AI 해석 (Claude)' : '규칙 해석'}
            </Pill>
            <span className="text-[13px] text-muted">해석된 조건</span>
            <span className="flex flex-wrap gap-1.5" data-testid="asst-ask-explain">
              {out.explain.map((x) => (
                <Pill key={x} tone="brand" className="!whitespace-normal">
                  {x}
                </Pill>
              ))}
            </span>
            <b className="ml-auto text-[14px] tnum" data-testid="asst-ask-count">
              {out.count}
              {out.target === 'requests' ? '건' : '명'}
            </b>
          </div>

          {out.target === 'requests' ? (
            out.requests.length === 0 ? (
              <Card>
                <Empty title="조건에 맞는 요청사항이 없습니다" sub="해석된 조건이 질문과 다르면 표현을 바꿔 다시 검색해 보세요." />
              </Card>
            ) : (
              <Card>
                <ul className="divide-y divide-line">
                  {out.requests.map((r) => (
                    <li key={r.id} className="px-4 py-3 text-[13px]" data-testid="asst-ask-req">
                      <div className="flex flex-wrap items-center gap-2">
                        {r.status !== '완료' && <DDay n={r.dDay} />}
                        <Link to={customerPath(r.customerId, 'requests')} className="font-semibold text-brand hover:underline">
                          {r.name}
                        </Link>
                        <span className="text-muted">{r.company}</span>
                        <Pill>{r.status}</Pill>
                        <span className="tnum text-xs text-muted">{r.dueDate ? `기한 ${r.dueDate}` : '기한 없음'}</span>
                      </div>
                      <p className={cx('mt-1', wrapCls)}>
                        <Highlight text={r.content} keywords={kws} />
                      </p>
                    </li>
                  ))}
                </ul>
              </Card>
            )
          ) : out.customers.length === 0 ? (
            <Card>
              <Empty title="조건에 맞는 고객이 없습니다" sub="해석된 조건이 질문과 다르면 표현을 바꿔 다시 검색해 보세요. 핵심 낱말만 넣어도 됩니다." />
            </Card>
          ) : (
            <ul className="grid gap-3 lg:grid-cols-2">
              {out.customers.map((c) => (
                <li key={c.id}>
                  <Card className="h-full p-4" data-testid="asst-ask-cust" data-id={c.id}>
                    <div className="flex items-start gap-3">
                      <Avatar id={c.id} name={c.name} />
                      <div className="min-w-0 flex-1">
                        <p className={wrapCls}>
                          <Link to={customerPath(c.id)} className="text-[14px] font-semibold text-brand hover:underline">
                            {c.name}
                          </Link>
                          <span className="ml-1.5 text-[13px] text-muted">{c.position}</span>
                          {c.customerType && <Pill className="ml-1.5">{c.customerType}</Pill>}
                          {c.isDemo && <Pill className="ml-1">가상</Pill>}
                        </p>
                        <p className={cx('text-xs text-muted', wrapCls)}>{[c.company, c.department].filter(Boolean).join(' · ')}</p>
                      </div>
                    </div>
                    {c.evidence.length > 0 && (
                      <ul className="mt-2.5 space-y-1.5 border-t border-line pt-2.5">
                        {c.evidence.map((e, i) => (
                          <li key={i} className="flex gap-2 text-[13px]" data-testid="asst-ask-evidence">
                            <span className="w-[72px] shrink-0 text-xs font-semibold text-muted">{e.label}</span>
                            {e.link ? (
                              <button className={cx('min-w-0 text-left hover:underline', wrapCls)} onClick={() => nav(evidencePath(e.link!))} title="근거 위치로 이동">
                                <Highlight text={e.text} keywords={kws} />
                              </button>
                            ) : (
                              <span className={cx('min-w-0', wrapCls)}>
                                <Highlight text={e.text} keywords={kws} />
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </Card>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted">검색은 이 브라우저에 저장된 고객 정보·활동 기록·요청사항에서만 이루어지며, 결과마다 찾은 근거를 보여 줍니다.</p>
        </div>
      )}
      {!out && !busy && !err && (
        <p className="text-center text-[13px] text-muted">위 예시 질문을 눌러 보거나 직접 물어보세요. 예: 「해산물 못 드시는 분」「이번 달에 챙겨야 할 사람」</p>
      )}
    </div>
  );
}
