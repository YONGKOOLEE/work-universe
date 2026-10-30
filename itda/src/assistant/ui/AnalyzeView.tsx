// 「대화 분석」 — 붙여 넣은 대화(또는 TXT·MD)를 Claude가 분석 → 항목별 승인 → 체크한 것만 저장.
// 키가 없거나 규칙·사내 엔진이면 「예시 분석 체험(AI 미사용)」으로 승인 흐름만 체험한다.
// 대화 원문·분석 초안은 이 컴포넌트의 상태(메모리)에만 있다. 새로 고침·화면 이동·사용자 전환 때 사라지고, 「원문 보관」을 고른 때만 활동 상세에 저장된다.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, ChevronDown, ChevronRight, FileUp, FlaskConical, Loader2, ShieldAlert, Square } from 'lucide-react';
import { Button, Card, CardHead, Empty, Field, inputCls } from '../../components/ui';
import { INTERNAL_NOTICE } from '../../ai/claude';
import { createSeq } from '../../ai/llm';
import { Link } from '../../lib/router';
import { cx } from '../../lib/util';
import { ymd } from '../dates';
import { analyzeConversation, applyDraft, buildSendPreview, enrichDraft, MAX_TEXT_CHARS, type ApplyChoice, type Draft, type EnrichedDraft, type EnrichedItem } from '../claude';
import { isErr } from '../model';
import { SAMPLE_LABEL, sampleDraft } from '../sample';
import { INTERACTION_TYPES } from '../types';
import { ConfirmDialog } from './forms';
import { useAssistant } from './hooks';
import { customerPath } from './logic';
import { Pill, wrapCls } from './shared';

interface ItemEdit {
  include: boolean;
  value: string;
  content: string;
  dueDate: string;
  assignee: string;
  mode: 'append' | 'replace';
}
interface Review {
  draft: Draft;
  enriched: EnrichedDraft;
  edits: ItemEdit[];
  act: { type: string; date: string; title: string; summary: string };
  keepText: boolean;
}
const MAX_FILE_BYTES = 1_000_000;

const SPEAKER: Record<string, string> = { customer: '고객 발언', salesperson: '영업사원 발언', unclear: '화자 불확실' };
const CONF: Record<string, string> = { high: '신뢰도 높음', medium: '신뢰도 보통', low: '신뢰도 낮음' };
const KIND: Record<string, string> = { profile: '고객 항목', request: '고객 요청', followup: '후속조치(내가 할 일)' };

function makeReview(draft: Draft, enriched: EnrichedDraft): Review {
  return {
    draft,
    enriched,
    keepText: false,
    act: { type: draft.interactionType, date: draft.interactionDate || ymd(new Date()), title: draft.title, summary: draft.summary },
    edits: enriched.items.map((it) => ({
      include: it.include,
      value: it.value ?? '',
      content: it.content ?? '',
      dueDate: it.dueDate ?? '',
      assignee: it.assignee ?? '',
      mode: it.mode ?? 'replace',
    })),
  };
}

export default function AnalyzeView() {
  const { a, now, ai, userId, me, canEdit, exec, toast } = useAssistant();
  const customers = useMemo(() => a.customers.filter((c) => canEdit(c.id)).sort((x, y) => x.name.localeCompare(y.name, 'ko')), [a.customers, canEdit]);
  const [cid, setCid] = useState('');
  const [text, setText] = useState('');
  const [filename, setFilename] = useState('');
  const [myName, setMyName] = useState(me?.name ?? '');
  const [mask, setMask] = useState(true);
  const [consent, setConsent] = useState(false);
  const [stage, setStage] = useState<'input' | 'preview' | 'running' | 'review'>('input');
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [done, setDone] = useState<{ customerId: string; applied: { profile: number; request: number; followup: number }; label: string } | null>(null);
  const ctl = useRef<AbortController | null>(null);
  const seq = useRef(createSeq());
  const fileRef = useRef<HTMLInputElement>(null);

  const stopAll = () => {
    ctl.current?.abort();
    ctl.current = null;
    seq.current.cancelAll();
  };
  const claude = ai.engine === 'claude' && !!ai.client;
  const stageRef = useRef(stage);
  stageRef.current = stage;
  const cust = a.customers.find((c) => c.id === cid);
  // 선택한 고객이 목록에 없으면(권한이 바뀌었거나 지워짐) 첫 고객으로
  useEffect(() => {
    if (!customers.some((c) => c.id === cid)) setCid(customers[0]?.id ?? '');
  }, [customers, cid]);
  // 화면을 떠나면 호출을 끊는다
  useEffect(() => stopAll, []); // eslint-disable-line react-hooks/exhaustive-deps
  // 엔진이 바뀌면 진행 중인 호출을 끊고 늦은 결과를 버린다. 전송 내용 확인 단계였다면 입력 단계로 돌아간다
  // (보낼 곳이 바뀌었는데 이전 엔진 기준의 확인·동의가 남아 있으면 안 되므로 동의도 지운다)
  useEffect(() => {
    if (ctl.current) {
      stopAll();
      setStage('input');
      setConsent(false);
      setNotice('AI 엔진이 바뀌어 진행 중이던 분석을 취소했습니다. 다시 시작하세요.');
    } else if (stageRef.current === 'preview') {
      setStage('input');
      setConsent(false);
      setNotice('AI 엔진이 바뀌어 입력 단계로 돌아왔습니다. 다시 「전송 내용 확인」을 눌러 주세요.');
    }
  }, [ai.engine]); // eslint-disable-line react-hooks/exhaustive-deps
  // 사용자를 바꾸면 호출을 끊고 원문·초안을 모두 버린다(다른 사람 화면에 남지 않게)
  const firstUser = useRef(userId);
  useEffect(() => {
    if (firstUser.current === userId) return;
    firstUser.current = userId;
    stopAll();
    setText('');
    setFilename('');
    setReview(null);
    setDone(null);
    setError('');
    setConsent(false);
    setMask(true); // 가림 끄기는 사용자 전환 때 해제한다(앞 사람이 끈 채로 이어 보내지 않게)
    setStage('input');
    setMyName(me?.name ?? '');
    setNotice('사용자를 바꿔 분석 내용(대화 원문·초안)을 지웠습니다.');
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  const preview = useMemo(() => (stage === 'preview' && cust ? buildSendPreview(cust, text, now, { mask, myName }) : null), [stage, cust, text, mask, myName, now]);

  const readFile = async (f: File | undefined) => {
    if (!f) return;
    setError('');
    if (f.size > MAX_FILE_BYTES) return setError('파일이 너무 큽니다. (최대 약 1MB의 TXT·MD 파일)');
    if (!/\.(txt|md|markdown)$/i.test(f.name) && !/^text\//.test(f.type)) return setError('TXT 또는 MD 파일만 읽을 수 있습니다.');
    try {
      const t = await f.text();
      setText(t);
      setFilename(f.name);
    } catch {
      setError('파일을 읽지 못했습니다.');
    }
  };

  const goPreview = () => {
    setError('');
    setNotice('');
    if (!cust) return setError('고객을 고르세요.');
    const p = buildSendPreview(cust, text, now, { mask, myName });
    if (isErr(p)) return setError(p.error);
    setConsent(false);
    setStage('preview');
  };

  const runClaude = async () => {
    if (!ai.client || !cust) return;
    stopAll();
    const id = seq.current.next();
    const c = new AbortController();
    ctl.current = c;
    setError('');
    setNotice('');
    setStage('running');
    try {
      const r = await analyzeConversation(ai.client, a, { customerId: cust.id, text, filename, mask, myName }, new Date(), c.signal);
      if (c.signal.aborted || !seq.current.isLatest(id)) return;
      if (isErr(r)) {
        setError(r.error);
        setStage('input');
        return;
      }
      const en = enrichDraft(a, r);
      if (isErr(en)) {
        setError(en.error);
        setStage('input');
        return;
      }
      setReview(makeReview(r, en));
      setStage('review');
    } catch (e) {
      if (!seq.current.isLatest(id)) return; // 엔진 변경·사용자 전환·새 요청이 이어받았다 — 늦은 결과·오류는 버린다
      if (c.signal.aborted || (e as { code?: string })?.code === 'cancelled') {
        setNotice('분석을 취소했습니다.');
        setStage('preview');
        return;
      }
      setError(ai.onError(e));
      setStage('preview');
    } finally {
      if (ctl.current === c) ctl.current = null;
    }
  };
  const cancelRun = () => {
    stopAll();
    setNotice('분석을 취소했습니다. 전송은 이미 시작되었을 수 있습니다.');
    setStage('preview');
  };

  const runSample = () => {
    setError('');
    setNotice('');
    if (!cust) return setError('고객을 고르세요.');
    const d = sampleDraft(a, cust.id, now);
    if (isErr(d)) return setError(d.error);
    const en = enrichDraft(a, d);
    if (isErr(en)) return setError(en.error);
    setReview(makeReview(d, en));
    setStage('review');
  };

  const setEdit = (i: number, p: Partial<ItemEdit>) => setReview((r) => (r ? { ...r, edits: r.edits.map((e, k) => (k === i ? { ...e, ...p } : e)) } : r));

  const save = () => {
    if (!review) return;
    setError('');
    const choices: ApplyChoice[] = review.edits.map((e, idx) => ({ idx, include: e.include, value: e.value, content: e.content, dueDate: e.dueDate, assignee: e.assignee, mode: e.mode }));
    const r = exec(review.draft.customerId, (_s, d) => applyDraft(d, review.draft, choices, { interaction: review.act, keepText: review.keepText }, now));
    if (isErr(r)) return setError(r.error);
    const x = r as { applied: { profile: number; request: number; followup: number }; customerId: string };
    setDone({ customerId: x.customerId, applied: x.applied, label: review.draft.kind === 'sample' ? SAMPLE_LABEL : 'AI 분석' });
    toast(`저장했습니다 · 활동 기록 1건, 고객 항목 ${x.applied.profile}, 요청 ${x.applied.request}, 후속조치 ${x.applied.followup}`);
    setReview(null);
    setText('');
    setFilename('');
    setConsent(false);
    setMask(true); // 저장을 마치면 가림 끄기도 해제한다(다음 분석은 다시 가린 채로 시작)
    setStage('input');
  };
  const discard = () => {
    setReview(null);
    setStage('input');
    setNotice('초안을 버렸습니다. 저장된 것은 없습니다.');
  };

  if (!customers.length && stage === 'input')
    return (
      <Card>
        <Empty
          title="분석할 수 있는 고객이 없습니다"
          sub={a.customers.length ? '내가 고칠 수 있는 고객(담당 영업자 본인 또는 담당자의 조직장)이 있어야 분석 결과를 저장할 수 있습니다.' : '먼저 「고객」 탭에서 고객을 등록하거나 설정에서 가상 고객을 채우세요.'}
        />
      </Card>
    );

  return (
    <div className="space-y-4" data-testid="asst-analyze">
      {done && (
        <Card className="border-ok/40 bg-oksoft/40 p-4 text-[13px]" data-testid="asst-an-done">
          <p className="font-semibold text-ok">저장했습니다 ({done.label})</p>
          <p className="mt-1">
            활동 기록 1건 · 고객 항목 {done.applied.profile}건 · 요청 {done.applied.request}건 · 후속조치 {done.applied.followup}건
          </p>
          <p className="mt-2 flex gap-3">
            <Link to={customerPath(done.customerId, 'changes')} className="font-medium text-brand hover:underline">
              변경 이력 보기
            </Link>
            <Link to={customerPath(done.customerId, 'history')} className="font-medium text-brand hover:underline">
              히스토리 보기
            </Link>
          </p>
        </Card>
      )}
      {notice && (
        <p className="rounded-lg border border-line bg-sunken/60 px-4 py-2.5 text-[13px] text-muted" role="status" data-testid="asst-an-notice">
          {notice}
        </p>
      )}

      {stage === 'input' && (
        <Card>
          <CardHead title="대화 기록 분석" sub="통화·미팅 대화를 붙여 넣으면 고객 정보·요청·후속조치 후보를 뽑아 줍니다. 저장은 승인한 항목만 합니다." />
          <div className="space-y-4 p-4">
            <div className="rounded-lg border border-line bg-sunken/50 px-3 py-2.5 text-[13px]" data-testid="asst-an-engine">
              {claude ? (
                <p className="flex items-start gap-2">
                  <Bot size={15} className="mt-0.5 shrink-0 text-brand" aria-hidden="true" />
                  <span>
                    <b>Claude({ai.model})로 분석합니다.</b> 전송 전에 보낼 내용을 확인하는 화면이 나옵니다. 전화번호·이메일·주민번호·계좌번호 형태는 기본으로 가려서 보내고, 고객 프로필은 보내지 않습니다.
                  </span>
                </p>
              ) : (
                <p className="flex items-start gap-2">
                  <FlaskConical size={15} className="mt-0.5 shrink-0 text-infer" aria-hidden="true" />
                  <span>
                    <b>{SAMPLE_LABEL} 체험만 가능합니다.</b> {ai.preferred === 'internal' ? INTERNAL_NOTICE : '키가 없거나 엔진이 「규칙」이라 대화를 실제로 분석하지 않습니다.'} 아래 「예시 분석 체험」은 미리 써 둔 예시 결과로 승인 흐름(체크·수정·근거 확인·저장)을 보여 줍니다. 상단에서 키를 넣고 Claude를 고르면 입력한 대화를 분석합니다.
                  </span>
                </p>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="고객 (내가 고칠 수 있는 고객)" htmlFor="asst-an-customer">
                <select id="asst-an-customer" data-testid="asst-an-customer" className={inputCls} value={cid} onChange={(e) => setCid(e.target.value)}>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} {c.position} · {c.company || '소속 없음'}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="내 이름" htmlFor="asst-an-myname" hint="대화에서 영업사원(나)의 말을 가려내는 데 쓰입니다. Claude로 보낼 때 함께 전송됩니다.">
                <input id="asst-an-myname" className={inputCls} value={myName} onChange={(e) => setMyName(e.target.value)} maxLength={30} data-testid="asst-an-myname" />
              </Field>
            </div>
            <Field label="대화 내용" htmlFor="asst-an-text" hint={`붙여 넣거나 TXT·MD 파일로 불러옵니다. 최대 ${MAX_TEXT_CHARS.toLocaleString()}자.`}>
              <textarea
                id="asst-an-text"
                data-testid="asst-an-text"
                rows={10}
                className={cx(inputCls, 'resize-y font-mono text-[12.5px] leading-relaxed')}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setFilename('');
                }}
                placeholder={'[통화기록] 2026-11-05 ○○ 부장\n고객: …\n나: …'}
              />
            </Field>
            <div className="flex flex-wrap items-center gap-2">
              <input ref={fileRef} type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" className="sr-only" onChange={(e) => { void readFile(e.target.files?.[0]); e.target.value = ''; }} data-testid="asst-an-file" aria-label="TXT 또는 MD 파일 선택" />
              <Button onClick={() => fileRef.current?.click()}>
                <FileUp size={14} />
                파일 불러오기
              </Button>
              {filename && <Pill>{filename}</Pill>}
              <span className="text-xs text-muted tnum">{text.length.toLocaleString()}자</span>
              <span className="ml-auto flex flex-wrap gap-2">
                <Button onClick={runSample} data-testid="asst-an-sample">
                  <FlaskConical size={14} />
                  예시 분석 체험 (AI 미사용)
                </Button>
                {claude && (
                  <Button variant="primary" onClick={goPreview} disabled={!text.trim()} data-testid="asst-an-preview-btn">
                    전송 내용 확인
                  </Button>
                )}
              </span>
            </div>
            {error && (
              <p className="text-xs text-danger" role="alert" data-testid="asst-an-error">
                {error}
              </p>
            )}
          </div>
        </Card>
      )}

      {(stage === 'preview' || stage === 'running') && cust && (
        <Card data-testid="asst-an-preview">
          <CardHead title="전송 내용 확인" sub="아래 내용이 Claude(api.anthropic.com)로 전송됩니다. 확인한 뒤 동의하면 분석합니다." />
          <div className="space-y-3 p-4 text-[13px]">
            {preview && !isErr(preview) ? (
              <>
                <dl className="grid gap-1 sm:grid-cols-[110px_1fr]">
                  <dt className="text-muted">보내는 곳</dt>
                  <dd>Claude · 모델 {ai.model} (본인 API 키)</dd>
                  <dt className="text-muted">고객</dt>
                  <dd className={wrapCls}>{preview.customerLabel} — 이름·직책·소속만 전송, 전화·이메일·성격 등 고객 프로필은 보내지 않음</dd>
                  <dt className="text-muted">영업사원 이름</dt>
                  <dd>{myName.trim() || '(비어 있음)'}</dd>
                  <dt className="text-muted">가림 처리</dt>
                  <dd data-testid="asst-an-masked">{mask ? `전화번호·이메일·주민번호·계좌번호 형태 ${preview.maskedCount}건을 [ ]로 가림` : '가림을 껐습니다 — 원문 그대로 전송'}</dd>
                  <dt className="text-muted">전송 글자 수</dt>
                  <dd className="tnum">{preview.chars.toLocaleString()}자</dd>
                </dl>
                <label className="flex items-start gap-2 rounded-md border border-line px-3 py-2">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={!mask}
                    disabled={stage === 'running'}
                    onChange={(e) => {
                      setMask(!e.target.checked);
                      setConsent(false);
                    }}
                    data-testid="asst-an-nomask"
                  />
                  <span>
                    <b>가림 끄기</b> — 연락처 형태도 가리지 않고 보냅니다. 꼭 필요할 때만 켜세요.
                  </span>
                </label>
                <div>
                  <p className="mb-1 text-xs font-semibold text-muted">전송되는 대화 (가림 반영)</p>
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-line bg-sunken px-3 py-2 font-mono text-[12px] leading-relaxed scroll-thin" data-testid="asst-an-sent">
                    {preview.sentText}
                  </pre>
                </div>
                <Collapsible label="실제로 보내는 전체 글 보기">
                  <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded-md border border-line bg-sunken px-3 py-2 font-mono text-[12px] scroll-thin">{preview.userPrompt}</pre>
                </Collapsible>
                <label className="flex items-start gap-2 rounded-md bg-warnsoft/50 px-3 py-2">
                  <input type="checkbox" className="mt-0.5" checked={consent} disabled={stage === 'running'} onChange={(e) => setConsent(e.target.checked)} data-testid="asst-an-consent" />
                  <span>위 내용이 Claude로 전송되는 것을 확인했고 동의합니다. 사용량은 본인 키로 과금됩니다.</span>
                </label>
              </>
            ) : (
              preview && <p className="text-danger">{preview.error}</p>
            )}
            {stage === 'running' && (
              <p className="flex flex-wrap items-center gap-2 rounded-md bg-brandsoft px-3 py-2" role="status" data-testid="asst-an-running">
                <Loader2 size={15} className="animate-spin" />
                <span className="flex-1">Claude가 대화를 분석하는 중입니다. 대화 길이에 따라 수십 초에서 2분까지 걸릴 수 있습니다.</span>
                <Button size="sm" onClick={cancelRun} data-testid="asst-an-cancel">
                  <Square size={12} />
                  취소
                </Button>
              </p>
            )}
            {error && (
              <p className="text-xs text-danger" role="alert" data-testid="asst-an-error">
                {error}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" onClick={() => { setStage('input'); setError(''); }} disabled={stage === 'running'}>
                수정으로 돌아가기
              </Button>
              <Button variant="primary" onClick={runClaude} disabled={!consent || stage === 'running' || !preview || isErr(preview)} data-testid="asst-an-send">
                동의하고 Claude로 분석
              </Button>
            </div>
          </div>
        </Card>
      )}

      {stage === 'review' && review && (
        <ReviewPanel review={review} setReview={setReview} setEdit={setEdit} onSave={save} onDiscard={discard} error={error} model={ai.model} />
      )}
    </div>
  );
}

function Collapsible({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button className="inline-flex items-center gap-0.5 text-xs font-medium text-brand hover:underline" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        {label}
      </button>
      {open && <div className="mt-1.5">{children}</div>}
    </div>
  );
}

function ReviewPanel({
  review,
  setReview,
  setEdit,
  onSave,
  onDiscard,
  error,
  model,
}: {
  review: Review;
  setReview: React.Dispatch<React.SetStateAction<Review | null>>;
  setEdit: (i: number, p: Partial<ItemEdit>) => void;
  onSave: () => void;
  onDiscard: () => void;
  error: string;
  model: string;
}) {
  const { draft, enriched, edits } = review;
  const sample = draft.kind === 'sample';
  const chosen = edits.filter((e) => e.include).length;
  const [askDiscard, setAskDiscard] = useState(false);
  const setAct = (p: Partial<Review['act']>) => setReview((r) => (r ? { ...r, act: { ...r.act, ...p } } : r));
  return (
    <div className="space-y-4" data-testid="asst-an-review">
      <p className="flex items-start gap-2 rounded-lg border border-warn/50 bg-warnsoft/60 px-4 py-2.5 text-[13px] font-medium text-warn" role="status" data-testid="asst-an-leave-warn">
        <ShieldAlert size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
        <span>저장 전에 다른 곳으로 이동하면 결과가 사라집니다. 다시 분석해야 하니 필요한 항목은 아래에서 체크해 저장하세요.</span>
      </p>
      <Card className={cx('p-4 text-[13px]', sample ? 'border-infer/40 bg-infersoft/40' : 'border-brand/30')}>
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={sample ? 'infer' : 'brand'} data-testid="asst-an-label">
            {sample ? SAMPLE_LABEL : `AI 분석 · Claude ${model}`}
          </Pill>
          <span className="font-semibold">{enriched.customer.name}</span>
          <span className="text-muted">{enriched.customer.company}</span>
        </div>
        {sample && (
          <p className="mt-1.5 flex items-start gap-1.5 rounded-md bg-warnsoft px-3 py-1.5 font-semibold text-warn" data-testid="asst-an-sample-warn">
            <FlaskConical size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>시험용: 승인하면 이 고객 값이 실제로 바뀝니다. (최근 연락일은 바뀌지 않습니다)</span>
          </p>
        )}
        {sample ? (
          <p className="mt-1.5 text-muted">이 결과는 AI가 분석한 것이 아니라 미리 써 둔 예시입니다. 입력한 대화와 상관없이 같은 내용이 나오며, 승인 흐름을 체험하는 용도입니다. 저장하면 변경 이력에 「예시 분석(AI 미사용)」으로 남습니다.</p>
        ) : (
          <p className="mt-1.5 text-muted">Claude가 뽑은 후보입니다. 근거 문장을 원문에서 찾지 못한 항목은 「원문 확인 안 됨」으로 표시하고 기본으로 해제했습니다. 체크한 항목만 저장됩니다. 다른 화면으로 이동하면 이 초안은 사라집니다.</p>
        )}
        {draft.speakerNote && <p className={cx('mt-1.5', wrapCls)}>화자 판단: {draft.speakerNote}</p>}
        {enriched.hasText && (
          <div className="mt-2">
            <Collapsible label="원문 보기 (인용 확인용)">
              <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded-md border border-line bg-surface px-3 py-2 font-mono text-[12px] scroll-thin">{draft.sentText}</pre>
            </Collapsible>
          </div>
        )}
      </Card>

      <Card>
        <CardHead title="활동 기록" sub="저장하면 이 내용으로 활동 기록 1건이 만들어집니다." />
        <div className="grid gap-3 p-4 sm:grid-cols-2">
          <Field label="유형" htmlFor="asst-an-type">
            <select id="asst-an-type" className={inputCls} value={review.act.type} onChange={(e) => setAct({ type: e.target.value })} data-testid="asst-an-type">
              {INTERACTION_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </Field>
          <Field label="날짜" htmlFor="asst-an-date">
            <input id="asst-an-date" type="date" className={inputCls} value={review.act.date} onChange={(e) => setAct({ date: e.target.value })} data-testid="asst-an-date" />
          </Field>
          <div className="sm:col-span-2">
            <Field label="제목" htmlFor="asst-an-title">
              <input id="asst-an-title" className={inputCls} value={review.act.title} onChange={(e) => setAct({ title: e.target.value })} data-testid="asst-an-title" />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="요약" htmlFor="asst-an-summary">
              <textarea id="asst-an-summary" rows={3} className={cx(inputCls, 'resize-y')} value={review.act.summary} onChange={(e) => setAct({ summary: e.target.value })} />
            </Field>
          </div>
          {enriched.hasText && (
            <label className="flex items-start gap-2 text-[13px] sm:col-span-2">
              <input type="checkbox" className="mt-0.5" checked={review.keepText} onChange={(e) => setReview((r) => (r ? { ...r, keepText: e.target.checked } : r))} data-testid="asst-an-keeptext" />
              <span>
                <b>대화 원문을 활동 상세에 보관</b> — 저장하면 이 브라우저와 백업 파일에 원문이 들어갑니다. 기본은 보관하지 않습니다.
              </span>
            </label>
          )}
        </div>
      </Card>

      <Card>
        <CardHead title={`분석 항목 ${enriched.items.length}건`} sub="체크한 항목만 저장합니다. 값은 고칠 수 있습니다." />
        {enriched.items.length === 0 ? (
          <p className="px-4 py-4 text-[13px] text-muted">뽑힌 항목이 없습니다. 활동 기록만 저장할 수 있습니다.</p>
        ) : (
          <ul className="divide-y divide-line" data-testid="asst-an-items">
            {enriched.items.map((it, i) => (
              <ItemRow key={i} it={it} ed={edits[i]} setEd={(p) => setEdit(i, p)} />
            ))}
          </ul>
        )}
      </Card>

      {error && (
        <p className="text-xs text-danger" role="alert" data-testid="asst-an-error">
          {error}
        </p>
      )}
      <ConfirmDialog
        open={askDiscard}
        onClose={() => setAskDiscard(false)}
        title="분석 결과 버리기"
        confirmLabel="버리기"
        danger
        onConfirm={() => {
          setAskDiscard(false);
          onDiscard();
        }}
        testId="asst-an-discard-confirm"
      >
        <p>이 분석 결과를 버릴까요? 저장된 것은 없고, 버리면 <b>되돌릴 수 없습니다.</b> 다시 보려면 처음부터 분석해야 합니다.</p>
      </ConfirmDialog>
      <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface/95 px-4 py-3 shadow-card backdrop-blur">
        <span className="text-xs text-muted" data-testid="asst-an-summary-line">
          활동 기록 1건 + 체크한 항목 {chosen}건을 저장합니다.
        </span>
        <span className="flex gap-2">
          <Button variant="ghost" onClick={() => setAskDiscard(true)} data-testid="asst-an-discard">
            버리기
          </Button>
          <Button variant="primary" onClick={onSave} data-testid="asst-an-apply">
            선택한 항목 저장
          </Button>
        </span>
      </div>
    </div>
  );
}

function ItemRow({ it, ed, setEd }: { it: EnrichedItem; ed: ItemEdit; setEd: (p: Partial<ItemEdit>) => void }) {
  const isProfile = it.kind === 'profile';
  return (
    <li className={cx('px-4 py-3 text-[13px]', !ed.include && 'bg-sunken/40')} data-testid="asst-an-item" data-kind={it.kind} data-verified={it.quoteVerified ? '1' : '0'} data-include={ed.include ? '1' : '0'}>
      <div className="flex flex-wrap items-center gap-2">
        <input type="checkbox" checked={ed.include} onChange={(e) => setEd({ include: e.target.checked })} aria-label={`${isProfile ? it.fieldLabel : KIND[it.kind]} 저장`} data-testid="asst-an-chk" />
        <Pill tone={isProfile ? 'brand' : 'infer'}>{KIND[it.kind]}</Pill>
        {isProfile && <b>{it.fieldLabel}</b>}
        {isProfile && it.status === 'new' && <Pill tone="ok">새 정보</Pill>}
        {isProfile && it.status === 'same' && <Pill>기존 값과 같음</Pill>}
        {isProfile && it.status === 'conflict' && <Pill tone="warn">기존 값과 다름</Pill>}
        {it.warnings.map((w) => (
          <Pill key={w} tone={w === '원문 확인 안 됨' ? 'danger' : 'warn'} data-testid={w === '원문 확인 안 됨' ? 'asst-an-unverified' : undefined}>
            {w === '원문 확인 안 됨' && <ShieldAlert size={11} aria-hidden="true" />}
            {w}
          </Pill>
        ))}
      </div>

      <div className="mt-2 grid gap-2 pl-6 sm:grid-cols-2">
        {isProfile ? (
          <>
            {it.existing ? (
              <p className={cx('rounded-md bg-sunken px-3 py-2 text-xs sm:col-span-2', wrapCls)} data-testid="asst-an-existing">
                <span className="mr-1 font-semibold text-muted">기존 값</span>
                {it.existing}
              </p>
            ) : null}
            <label className="text-xs font-semibold text-muted sm:col-span-2">
              저장할 값
              <input className={cx(inputCls, 'mt-1 font-normal')} value={ed.value} onChange={(e) => setEd({ value: e.target.value })} data-testid="asst-an-value" />
            </label>
            {it.existing && !it.isSpeculation && (
              <label className="text-xs font-semibold text-muted">
                기존 값이 있을 때
                <select className={cx(inputCls, 'mt-1 font-normal')} value={ed.mode} onChange={(e) => setEd({ mode: e.target.value as 'append' | 'replace' })} data-testid="asst-an-mode">
                  {it.isList && <option value="append">기존 값에 추가</option>}
                  <option value="replace">기존 값을 교체</option>
                </select>
              </label>
            )}
            {it.targetNote && <p className="text-xs text-warn sm:col-span-2">{it.targetNote}</p>}
          </>
        ) : (
          <>
            <label className="text-xs font-semibold text-muted sm:col-span-2">
              {it.kind === 'request' ? '요청 내용' : '할 일'}
              <textarea rows={2} className={cx(inputCls, 'mt-1 resize-y font-normal')} value={ed.content} onChange={(e) => setEd({ content: e.target.value })} data-testid="asst-an-content" />
            </label>
            <label className="text-xs font-semibold text-muted">
              처리기한
              <input type="date" className={cx(inputCls, 'mt-1 font-normal')} value={ed.dueDate} onChange={(e) => setEd({ dueDate: e.target.value })} />
            </label>
            <label className="text-xs font-semibold text-muted">
              담당자
              <input className={cx(inputCls, 'mt-1 font-normal')} value={ed.assignee} onChange={(e) => setEd({ assignee: e.target.value })} />
            </label>
          </>
        )}
      </div>

      <div className="mt-2 pl-6">
        <blockquote className={cx('rounded-md border-l-[3px] px-3 py-2 text-xs leading-relaxed', it.quoteVerified ? 'border-fact bg-factsoft/50' : 'border-danger bg-dangersoft/40', wrapCls)} data-testid="asst-an-quote">
          <span className="mb-0.5 block font-semibold text-muted">근거 문장 {it.quoteVerified ? '(원문에서 확인됨)' : ''}</span>
          {it.quoteVerified && it.quoteSpan ? it.quoteSpan : it.evidence || '(근거 없음)'}
          {it.quoteVerified && it.quoteShort && <span className="mt-1 block font-semibold text-warn" data-testid="asst-an-short">근거가 짧음 — 8자 미만이라 우연히 일치했을 수 있습니다. 원문을 확인한 뒤에 체크하세요.</span>}
          {!it.quoteVerified && <span className="mt-1 block font-semibold text-danger">원문 확인 안 됨 — 이 문장을 원문에서 찾지 못했습니다. 원문을 직접 확인하기 전에는 저장하지 않는 것이 안전합니다.</span>}
        </blockquote>
        <p className="mt-1.5 flex flex-wrap gap-1.5">
          <Pill tone={it.speaker === 'customer' ? 'ok' : it.speaker === 'unclear' ? 'warn' : 'muted'}>{SPEAKER[it.speaker]}</Pill>
          <Pill tone={it.confidence === 'high' ? 'ok' : it.confidence === 'low' ? 'warn' : 'muted'}>{CONF[it.confidence]}</Pill>
        </p>
      </div>
    </li>
  );
}
