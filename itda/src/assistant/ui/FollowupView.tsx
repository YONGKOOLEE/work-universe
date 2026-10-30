// 미팅 후 질문 — 끝난 미팅마다 비어 있거나 오래된 고객 정보를 객관식+짧은 입력으로 묻고, 답을 반영안으로 보여 준 뒤 체크한 것만 저장한다.
import { useMemo, useState } from 'react';
import { ArrowLeft, Check, SkipForward } from 'lucide-react';
import { Button, Card, CardHead, Empty, inputCls } from '../../components/ui';
import { useRouter } from '../../lib/router';
import { cx } from '../../lib/util';
import { applyFollowup, buildQuestions, meetingError, proposals, skipFollowup, type Answers, type FollowupChoice, type FollowupProblem, type FollowupProposal, type Question } from '../followup';
import { isErr } from '../model';
import { useAssistant } from './hooks';
import { clearAnswer, customerPath, ownerLabel, pickOption, setAnswerInput } from './logic';
import { Pill, ReadOnlyNote, wrapCls } from './shared';

const KIND_LABEL: Record<FollowupProposal['kind'], string> = {
  field: '고객 정보',
  request: '요청사항 등록',
  request_due: '요청사항 기한 변경',
  meeting_held: '최근 미팅일 갱신',
  meeting_note: '미팅 기록 메모',
  meeting_move: '미팅 날짜 변경',
  meeting_cancel: '미팅 취소 처리',
};

export default function FollowupView({ interactionId }: { interactionId: string }) {
  const { a, now, me, canEdit, exec, toast, raw } = useAssistant();
  const { nav } = useRouter();
  const info = useMemo(() => buildQuestions(a, interactionId, now, me?.name ?? ''), [a, interactionId, now, me?.name]);
  const [answers, setAnswers] = useState<Answers>({});
  const [step, setStep] = useState<'ask' | 'review'>('ask');
  const [props, setProps] = useState<FollowupProposal[]>([]);
  const [choices, setChoices] = useState<FollowupChoice[]>([]);
  const [error, setError] = useState('');

  if (!info)
    return (
      <Card>
        <Empty title="미팅 기록을 찾을 수 없습니다" sub="지워졌거나 아직 불러오지 않은 미팅입니다." action={<Button onClick={() => nav('/assistant')}>오늘 화면</Button>} />
      </Card>
    );
  const cid = info.customer.id;
  const back = () => nav(customerPath(cid, 'history'));
  const editable = canEdit(cid);
  const meErr = meetingError(a, interactionId, now);
  const answered = Object.values(answers).filter((x) => x.value).length;
  // 답은 했는데 이대로는 저장되지 않는 곳(내용을 비운 요청·관심 주제, 날짜 없는 연기)을 그 질문에 안내한다
  const problems = proposals(a, interactionId, answers, now, me?.name ?? '')?.problems ?? [];
  const blocking = problems.find((p) => p.blocking);

  const toReview = () => {
    setError('');
    const r = proposals(a, interactionId, answers, now, me?.name ?? '');
    if (!r) return;
    const stop = r.problems.find((p) => p.blocking);
    if (stop) return setError(stop.text);
    setProps(r.proposals);
    setChoices(r.proposals.map((p, idx) => ({ idx, include: true, new: p.new, dueDate: p.dueDate, assignee: p.assignee })));
    setStep('review');
  };
  const patch = (idx: number, p: Partial<FollowupChoice>) => setChoices((cs) => cs.map((c) => (c.idx === idx ? { ...c, ...p } : c)));

  const apply = () => {
    setError('');
    // 확인 화면에서 보여 준 반영안(props)을 그대로 넘긴다 — 저장할 때 다시 계산하면 그 사이에 고객 정보가 바뀌어 선택 번호가 어긋날 수 있다
    const r = exec(cid, (_s, d) => applyFollowup(d, interactionId, answers, choices, now, me?.name ?? '', props));
    if (isErr(r)) return setError(r.error);
    const x = r as { applied: number; moved: boolean; conflicts?: string[] };
    toast((x.moved ? '미팅 날짜를 바꿨습니다 — 새 날짜에 다시 묻습니다' : `${x.applied}건을 저장했습니다`) + (x.conflicts?.length ? ` (${x.conflicts.join(' ')})` : ''));
    back();
  };
  const skipAll = () => {
    const r = exec(cid, (_s, d) => skipFollowup(d, interactionId, now));
    if (isErr(r)) return setError(r.error);
    toast('이 미팅의 질문을 건너뛰었습니다');
    back();
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4" data-testid="asst-followup">
      <button className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink" onClick={back}>
        <ArrowLeft size={14} />
        {info.customer.name} 고객으로 돌아가기
      </button>
      <div>
        <h2 className="text-[18px] font-bold tracking-tight">미팅 후 질문</h2>
        <p className={cx('mt-0.5 text-[13px] text-muted', wrapCls)}>
          {info.customer.name} {info.customer.position} · {info.meeting.date} {info.meeting.title}
        </p>
        <p className="mt-1 text-xs text-muted">{info.note}</p>
      </div>

      {!editable && <ReadOnlyNote owner={ownerLabel(raw, a.customers.find((c) => c.id === cid)?.ownerId ?? '')} />}
      {meErr && (
        <p className="rounded-lg border border-warn/40 bg-warnsoft/50 px-4 py-2.5 text-[13px] text-warn" role="status" data-testid="asst-fu-blocked">
          {meErr}
        </p>
      )}
      {info.status !== 'pending' && !meErr && (
        <p className="rounded-lg border border-line bg-sunken/60 px-4 py-2.5 text-[13px] text-muted" role="status">
          이 미팅의 질문은 이미 {info.status === 'done' ? '답했습니다' : '건너뛰었습니다'}. 다시 답하면 새 답으로 반영안을 만듭니다.
        </p>
      )}

      {editable && !meErr && step === 'ask' && (
        <>
          {info.questions.map((q, n) => (
            <QuestionCard key={q.id} q={q} n={n + 1} answers={answers} setAnswers={setAnswers} problems={problems.filter((p) => p.qid === q.id)} />
          ))}
          {error && (
            <p className="text-xs text-danger" role="alert">
              {error}
            </p>
          )}
          <div className="sticky bottom-0 -mx-1 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface/95 px-4 py-3 shadow-card backdrop-blur">
            <span className="text-xs text-muted">답한 질문 {answered} / {info.questions.length}</span>
            <span className="flex gap-2">
              <Button variant="ghost" onClick={skipAll} data-testid="asst-fu-skip-all">
                <SkipForward size={14} />
                전체 건너뛰기
              </Button>
              <Button variant="primary" onClick={toReview} disabled={!answered || !!blocking} title={blocking?.text} data-testid="asst-fu-review-btn">
                답변 확인
              </Button>
            </span>
          </div>
        </>
      )}

      {editable && !meErr && step === 'review' && (
        <Card data-testid="asst-fu-review">
          <CardHead title="저장할 내용 확인" sub="체크한 항목만 저장합니다. 값은 고칠 수 있고, 고객 항목은 변경 이력(출처 「미팅 후 질문」)에 남습니다." />
          {props.length === 0 ? (
            <p className="px-4 py-4 text-[13px] text-muted">답변에서 새로 저장할 내용이 없습니다. 「질문 마치기」를 누르면 이 미팅의 질문을 완료로 표시합니다.</p>
          ) : (
            <ul className="divide-y divide-line">
              {props.map((p, idx) => {
                const ch = choices[idx];
                if (!ch) return null;
                const editableText = p.kind === 'field' || p.kind === 'request' || p.kind === 'meeting_note' || p.kind === 'meeting_move';
                return (
                  <li key={idx} className="px-4 py-3 text-[13px]" data-testid="asst-fu-prop">
                    <label className="flex items-start gap-2.5">
                      <input type="checkbox" className="mt-1" checked={ch.include} onChange={(e) => patch(idx, { include: e.target.checked })} data-testid="asst-fu-chk" aria-label={`${KIND_LABEL[p.kind]} ${p.label} 저장`} />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <b>{p.label}</b>
                          <Pill tone={p.kind === 'field' ? 'brand' : 'infer'}>{KIND_LABEL[p.kind]}</Pill>
                          {p.mode === 'append' && <Pill>기존 값에 추가</Pill>}
                          {p.kind === 'field' && p.old && p.mode !== 'append' && <Pill tone="warn">기존 값 변경</Pill>}
                        </span>
                        {p.old && <span className={cx('mt-1 block text-xs text-muted', wrapCls)}>기존: {p.old}</span>}
                      </span>
                    </label>
                    <div className="mt-2 pl-6">
                      {editableText ? (
                        <>
                          <input
                            className={inputCls}
                            type={p.kind === 'meeting_move' || (p.kind === 'field' && (p.field === 'nextContactDate' || p.field === 'birthDate')) ? 'date' : 'text'}
                            value={ch.new ?? ''}
                            disabled={!ch.include}
                            onChange={(e) => patch(idx, { new: e.target.value })}
                            aria-label={`${p.label} 저장할 값`}
                          />
                          {p.kind === 'request' && (
                            <div className="mt-2 grid gap-2 sm:grid-cols-2">
                              <label className="text-xs text-muted">
                                처리기한
                                <input type="date" className={cx(inputCls, 'mt-0.5')} value={ch.dueDate ?? ''} disabled={!ch.include} onChange={(e) => patch(idx, { dueDate: e.target.value })} />
                              </label>
                              <label className="text-xs text-muted">
                                담당자
                                <input className={cx(inputCls, 'mt-0.5')} value={ch.assignee ?? ''} disabled={!ch.include} onChange={(e) => patch(idx, { assignee: e.target.value })} />
                              </label>
                            </div>
                          )}
                        </>
                      ) : (
                        <p className={cx('rounded-md bg-sunken px-3 py-2 text-xs', wrapCls)}>{p.old ? `${p.old} → ` : ''}{p.new}</p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {error && (
            <p className="px-4 pb-2 text-xs text-danger" role="alert">
              {error}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2 border-t border-line px-4 py-3">
            <Button variant="ghost" onClick={() => setStep('ask')}>
              <ArrowLeft size={14} />
              답변 고치기
            </Button>
            <Button variant="primary" onClick={apply} data-testid="asst-fu-apply">
              <Check size={14} />
              {props.length === 0 ? '질문 마치기' : `체크한 ${choices.filter((c) => c.include).length}건 저장`}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

function QuestionCard({ q, n, answers, setAnswers, problems }: { q: Question; n: number; answers: Answers; setAnswers: (f: (a: Answers) => Answers) => void; problems: FollowupProblem[] }) {
  const cur = answers[q.id];
  const opt = q.options.find((o) => o.value === cur?.value);
  return (
    <Card className="p-4" data-testid={`asst-fu-q-${q.id}`}>
      <div className="flex flex-wrap items-start gap-2">
        <span className="text-[13px] font-bold text-brand">Q{n}</span>
        <p className={cx('min-w-0 flex-1 text-[14px] font-semibold', wrapCls)} id={`fu-q-${q.id}`}>
          {q.text}
        </p>
        <Pill>{q.reason}</Pill>
      </div>
      <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-labelledby={`fu-q-${q.id}`}>
        {q.options.map((o) => {
          const on = cur?.value === o.value;
          return (
            <label
              key={o.value}
              className={cx('cursor-pointer rounded-full border px-3 py-1.5 text-[13px] transition-colors focus-within:ring-2 focus-within:ring-brand', on ? 'border-brand bg-brandsoft font-semibold text-brand' : 'border-line2 bg-surface text-ink hover:border-brand')}
            >
              <input
                type="radio"
                className="sr-only"
                name={`fu-${q.id}`}
                value={o.value}
                checked={on}
                onChange={() => setAnswers((x) => pickOption(x, q.id, o.value))}
                data-testid={`asst-fu-opt-${q.id}-${o.value}`}
              />
              {o.label}
            </label>
          );
        })}
      </div>
      {opt && opt.inputs.length > 0 && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {opt.inputs.map((inp) => (
            <label key={inp.key} className="block text-xs font-semibold text-muted">
              {inp.label}
              <input
                type={inp.type}
                className={cx(inputCls, 'mt-1 font-normal')}
                placeholder={inp.placeholder}
                value={cur?.[inp.key] ?? ''}
                onChange={(e) => setAnswers((x) => setAnswerInput(x, q.id, inp.key, e.target.value))}
                data-testid={`asst-fu-in-${q.id}-${inp.key}`}
              />
            </label>
          ))}
        </div>
      )}
      {problems.map((p, i) => (
        <p key={i} className={cx('mt-2 text-xs font-medium', p.blocking ? 'text-danger' : 'text-warn')} role="status" data-testid={`asst-fu-hint-${q.id}`}>
          {p.text}
        </p>
      ))}
      {cur?.value && (
        <button className="mt-2 text-xs font-medium text-muted underline hover:text-ink" onClick={() => setAnswers((x) => clearAnswer(x, q.id))}>
          이 질문 건너뛰기(답 지우기)
        </button>
      )}
    </Card>
  );
}
