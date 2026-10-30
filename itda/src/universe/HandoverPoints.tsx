// 지도로 본 인계 포인트(CR-24 U-5 「근거 칩이 달린 AI 문장」): 업무 유니버스의 인수인계 초안 규칙(rules/handover.js)을
// 업무잇다 데이터에서 파생한 지도에 그대로 돌린다. 문장마다 근거 칩이 붙고, 칩을 누르면 근거가 된 기록 한 줄이 펼쳐진다.
// 키가 있으면 업무 유니버스 연결부(refineDraftAsync)로 Claude가 문장을 다듬는다 — 근거 ID·인용이 확인된 문장만 쓰고, 실패하면 규칙 문장 그대로.
// 인계 절차(사전 점검·체크리스트·확정)는 업무잇다 것이 기준이고, 이 카드는 참고 자료다.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Orbit, Sparkles, Loader2, ChevronDown } from 'lucide-react';
import type { AppState } from '../lib/types';
import { Card, CardHead, Button } from '../components/ui';
import { useAI } from '../ai/claude';
import { LlmError, createSeq, isAuthFallbackReason, isModelFallbackReason, refinedUsedCount } from '../ai/llm';
import { cx, today } from '../lib/util';
import { deriveMap } from './derive';
// @ts-expect-error 유니버스 순수 모듈(JS)
import { buildView } from '../../../app/src/view/view.js';
// @ts-expect-error 유니버스 순수 모듈(JS)
import { buildHandoverDraft } from '../../../app/src/rules/handover.js';
// @ts-expect-error 유니버스 순수 모듈(JS)
import { describeEvidence } from '../../../app/src/llm/evidence-text.js';
// @ts-expect-error 유니버스 순수 모듈(JS)
import { refineDraftAsync } from '../../../app/src/llm/connector.js';

/** 업무 하나의 인계 포인트로 보여 줄 항목(업무잇다 화면에 이미 있는 것 — 개요·일정·산출물 — 은 뺀다) */
export const POINT_ITEMS = ['받는_범위', '주의사항', '진행_중', '최근_이슈', '관계자_연락처', '이전_인수인계', '유사_경험자'];

export function HandoverPoints({ data, workId, fromId, toId }: { data: AppState; workId: string; fromId: string; toId: string }) {
  const ai = useAI();
  const built = useMemo(() => {
    // 대상 업무를 일반 업무 항목으로(이전 인계·받는 범위 판정에 들어가게), 문서에서 온 할 일은 빼고(하위 업무로 세지 않게)
    const d = deriveMap(data, { kind: 'work', workId }, undefined, { people: [fromId, toId], centerAsWork: true, actions: false });
    const view = buildView(d.doc, d.resolve);
    const uid = d.doc.universe.id;
    const res = buildHandoverDraft(view, { target: `${uid}/N-work-${workId}`, from: `${uid}/N-user-${fromId}`, to: `${uid}/N-user-${toId}`, asOf: today() });
    // 화면에 보일 항목만 남긴다(다듬기 호출도 이 항목만 — 시간 절약)
    const draft = res.ok ? { ...res.draft, items: res.draft.items.filter((it: any) => POINT_ITEMS.includes(it.key)) } : null;
    return { view, draft, error: res.ok ? null : res.error };
  }, [data, workId, fromId, toId]);
  const [refined, setRefined] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  // refineDraftAsync는 취소 신호를 받지 않는다(app/src는 건드리지 않음). 그래서 호출을 끊는 대신 요청 번호로 낡은 응답을 버린다(M-4·M-7)
  const seq = useRef(createSeq());
  // 데이터가 바뀌면(인계 진행·업무 수정) 예전에 다듬은 문장을 버리고, 날아가는 응답도 버린다
  useEffect(() => {
    seq.current.cancelAll();
    setRefined(null);
    setBusy(false);
  }, [built]);
  // 엔진이 바뀌면(규칙·사내로) 날아가는 응답을 버린다
  useEffect(() => {
    seq.current.cancelAll();
    setBusy(false);
  }, [ai.engine]);
  useEffect(() => () => seq.current.cancelAll(), []);
  const [note, setNote] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const draft = refined ?? built.draft;
  if (!draft) return null;
  const items = draft.items.filter((it: any) => POINT_ITEMS.includes(it.key));
  const shown = items.filter((it: any) => !it.insufficient || it.empty_reason);

  const refine = async () => {
    if (ai.engine !== 'claude' || !ai.universeProvider) return;
    const id = seq.current.next();
    setBusy(true);
    setNote('');
    try {
      const r = await refineDraftAsync(built.draft, { provider: ai.universeProvider, exists: built.view.exists, view: built.view });
      if (!seq.current.isLatest(id)) return; // 그 사이 데이터·엔진이 바뀌었거나 다시 눌렀다 — 낡은 응답은 버린다
      if (r) {
        const reason: string | undefined = r.fallback?.reason;
        // 연결부는 키 거부·모델 문제를 예외로 던지지 않고 fallback 이유로 돌려준다 — 여기서 알려야 키 상태(거부됨)와 단추가 맞는다
        if (isAuthFallbackReason(reason)) {
          setNote(ai.onError(new LlmError('auth', reason!)));
          return;
        }
        if (isModelFallbackReason(reason)) {
          setNote(ai.onError(new LlmError('model', reason!)));
          return;
        }
        setRefined(r);
        if (r.fallback) setNote(`${refinedUsedCount(r) > 0 ? '일부 문장은 ' : ''}규칙 문장으로 남김: ${r.fallback.reason}`);
      }
    } catch (e) {
      if (!seq.current.isLatest(id)) return;
      setNote(ai.onError(e));
    } finally {
      if (seq.current.isLatest(id)) setBusy(false);
    }
  };

  return (
    <Card data-testid="handover-points">
      <CardHead
        icon={<Orbit size={16} />}
        title="지도로 본 인계 포인트"
        sub="업무 유니버스 지도에서 찾은 담당 공백·진행 중인 일·최근 이슈·관계자·유사 경험자. 문장의 근거 칩을 누르면 근거 기록이 펼쳐집니다."
        right={
          ai.engine === 'claude' && ai.universeProvider ? (
            <Button size="sm" onClick={refine} disabled={busy} data-testid="handover-points-refine">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              AI로 문장 다듬기
            </Button>
          ) : undefined
        }
      />
      <div className="space-y-3 px-4 pb-4 pt-1 text-[13px]">
        {note && <p className="rounded-md bg-warnsoft px-3 py-2 text-xs text-warn">{note}</p>}
        {!shown.length && <p className="text-muted">지도에서 찾은 인계 포인트가 없습니다(기록이 더 쌓이면 나타납니다).</p>}
        {shown.map((it: any) => (
          <div key={it.key}>
            <p className="flex items-center gap-2 text-2xs font-semibold text-faint">
              {it.title}
              <span className={cx('rounded px-1 font-normal', it.method === 'llm' ? 'bg-brandsoft text-brand' : 'bg-sunken text-muted')}>{it.method === 'llm' ? 'AI(근거 확인됨)' : '규칙 기반'}</span>
            </p>
            {it.insufficient ? (
              <p className="mt-1 text-muted">{it.empty_reason}</p>
            ) : (
              <ul className="mt-1 space-y-1.5">
                {it.sentences.map((st: any, i: number) => {
                  const k = `${it.key}-${i}`;
                  return (
                    <li key={k}>
                      <span>{st.text}</span>
                      <button className="ml-1.5 inline-flex items-center gap-0.5 rounded bg-sunken px-1.5 text-2xs text-muted hover:text-ink" onClick={() => setOpen(open === k ? null : k)} aria-expanded={open === k} data-testid="handover-point-chip">
                        근거 {st.evidence_ids.length}
                        <ChevronDown size={11} className={cx('transition-transform', open === k && 'rotate-180')} />
                      </button>
                      {open === k && (
                        <ul className="mt-1 space-y-0.5 rounded-md border border-line bg-sunken/60 px-2.5 py-1.5 text-2xs text-muted">
                          {st.evidence_ids.map((g: string) => (
                            <li key={g}>{evidenceLine(built.view, g)}</li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ))}
        <p className="text-2xs text-faint">업무 유니버스의 인수인계 규칙과 같은 기준입니다. 인계 확정은 위의 업무잇다 절차로 합니다.</p>
      </div>
    </Card>
  );
}

/** 근거 한 줄: 「gid [유형] 이름 …」에서 내부 ID를 떼고 사람이 읽는 부분만 */
function evidenceLine(view: any, gid: string) {
  return String(describeEvidence(view, gid)).replace(/^\S+\s+/, '');
}
