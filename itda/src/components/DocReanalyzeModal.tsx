import { useEffect, useRef, useState } from 'react';
import { Sparkles, Loader2, Square, Bot } from 'lucide-react';
import { Modal, Button } from './ui';
import { ReflectionPreview } from './ReflectionPreview';
import { canEdit, useStore } from '../lib/store';
import { useAI } from '../ai/claude';
import { analyzeDocument } from '../ai/engine';
import type { Extraction, Proposal } from '../ai/reflect';
import { runExtraction } from '../ai/runExtract';
import { applyReanalysis, engineLabel, splitDuplicates } from '../ai/reanalyze';

/** 등록된 문서를 지금 엔진으로 다시 분석하고, 이미 기록된 것은 빼고 새 항목만 승인해 반영한다 */
export function DocReanalyzeModal({ open, onClose, docId }: { open: boolean; onClose: () => void; docId: string }) {
  const { s, raw, update, toast } = useStore();
  const ai = useAI();
  const doc = s.docs.find((x) => x.id === docId);
  const rawDoc = raw.docs.find((x) => x.id === docId);
  // 반영 대상은 이 문서에 연결된 업무 중 내가 고칠 수 있는 업무
  const myWorks = s.works.filter((w) => (rawDoc?.workIds ?? []).includes(w.id) && canEdit(raw, w.id, raw.currentUserId));
  const [busy, setBusy] = useState(false);
  const [careful, setCareful] = useState(true);
  const [stage, setStage] = useState<'read' | 'review'>('read');
  const [msg, setMsg] = useState('');
  const [ext, setExt] = useState<Extraction | null>(null);
  const [props, setProps] = useState<Proposal[]>([]);
  const [skipped, setSkipped] = useState(0);
  const ctl = useRef<AbortController | null>(null);

  const reset = () => {
    ctl.current?.abort();
    setBusy(false);
    setMsg('');
    setExt(null);
    setProps([]);
    setSkipped(0);
  };
  useEffect(() => {
    if (!open) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const close = () => {
    reset();
    onClose();
  };
  if (!open || !doc || !rawDoc) return null;
  const paras = doc.paragraphs ?? [];

  const run = async () => {
    const def = myWorks[0]?.id;
    if (!def) return setMsg('이 문서에 연결된 업무 중 내가 고칠 수 있는 업무가 없습니다.');
    setBusy(true);
    setMsg('');
    setExt(null);
    setProps([]);
    ctl.current = new AbortController();
    const md = analyzeDocument(s, doc.title, paras.map((p) => p.text).join('\n'), doc.writtenAt);
    const { result, msg: m } = await runExtraction(ai, s, doc.title, paras, def, doc.writtenAt, ctl.current.signal, { review: careful, onStage: setStage });
    if (!result.keywords.length) result.keywords = md.keywords;
    // 이 문서에 연결된 내 업무로만 반영 — 그 밖의 업무가 지목되면 기본 업무로 돌린다
    const ids = new Set(myWorks.map((w) => w.id));
    const mine = result.proposals.map((p) => (ids.has(p.workId) ? p : { ...p, workId: def }));
    const { fresh, skipped: dup } = splitDuplicates(s, mine);
    setMsg(m);
    setExt(result);
    setProps(fresh);
    setSkipped(dup.length);
    setBusy(false);
  };

  const approved = props.filter((p) => p.approved);
  const apply = () => {
    if (!ext) return;
    let res: ReturnType<typeof applyReanalysis> | undefined;
    update((d) => {
      const target = d.docs.find((x) => x.id === docId);
      if (target) res = applyReanalysis(d, target, props, d.currentUserId, ext);
    });
    toast(`다시 분석했습니다 · ${engineLabel(ext.engine)} · ${res?.added ?? 0}건 추가${res?.skipped ? `, 이미 있는 ${res.skipped}건 건너뜀` : ''}`);
    close();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      wide="x"
      title={`문서 다시 분석 — ${doc.title}`}
      footer={
        <>
          <span className="mr-auto self-center text-xs text-muted" data-testid="reanalyze-status">
            {ext ? `승인 ${approved.length} / 새 제안 ${props.length}건 · 이미 기록된 ${skipped}건은 제외됨 — 취소하면 아무것도 바뀌지 않습니다` : '지금 엔진으로 등록 원문을 다시 읽습니다. 이미 기록된 항목은 건너뜁니다.'}
          </span>
          <Button variant="ghost" onClick={close} data-testid="reanalyze-cancel">
            취소
          </Button>
          {busy ? (
            <Button onClick={() => ctl.current?.abort()}>
              <Square size={13} />
              분석 중지
            </Button>
          ) : (
            <>
              {ai.engine === 'claude' && (
                <label className="flex items-center gap-1.5 self-center text-xs text-muted">
                  <input type="checkbox" checked={careful} onChange={(e) => setCareful(e.target.checked)} />
                  꼼꼼히 읽기
                </label>
              )}
              <Button onClick={run} disabled={!paras.length} data-testid="reanalyze-run">
                <Sparkles size={14} />
                {ext ? '한 번 더 분석' : '분석 시작'}
              </Button>
            </>
          )}
          <Button variant="primary" onClick={apply} disabled={!ext || busy} data-testid="reanalyze-apply">
            반영{approved.length ? ` · ${approved.length}건` : ''}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="flex flex-wrap items-center gap-2 text-[13px]">
          분석 엔진:
          {ai.engine === 'claude' ? (
            <span className="inline-flex items-center gap-1 rounded bg-brandsoft px-1.5 text-2xs font-semibold text-brand">
              <Bot size={11} />
              Claude 분석
            </span>
          ) : (
            <span className="rounded bg-warnsoft px-1.5 text-2xs font-semibold text-warn">규칙 기반 분석</span>
          )}
          <span className="text-xs text-muted">
            이전 분석: {doc.analyzedBy ? engineLabel(doc.analyzedBy) : '기록 없음'}
            {rawDoc.analyzedAt ? ` (${rawDoc.analyzedAt.slice(0, 10)})` : ''} · 반영 대상 업무: {myWorks.map((w) => w.name).join(', ') || '없음'}
          </span>
        </p>
        {!paras.length && <p className="rounded-md bg-warnsoft px-3 py-2 text-xs text-warn">등록된 원문 문단이 없어 다시 분석할 수 없습니다.</p>}
        {msg && <p className="rounded-md bg-warnsoft px-3 py-2 text-xs text-warn">{msg}</p>}
        {busy && (
          <div className="flex items-start gap-2 py-4 text-[13px] text-muted">
            <Loader2 size={16} className="mt-0.5 animate-spin" />
            <span>{ai.engine === 'claude' ? (stage === 'review' ? '2단계: 꼼꼼히 읽기 중입니다(최대 1분 30초).' : '1단계: Claude가 등록 원문을 읽는 중입니다(긴 문서는 최대 2분).') : '규칙으로 원문을 읽는 중입니다.'}</span>
          </div>
        )}
        {ext && !busy && (
          <>
            {doc.analyzedBy === 'claude' && ext.engine !== 'claude' && <p className="rounded-md bg-sunken px-3 py-2 text-xs text-muted">이 문서는 Claude로 분석된 기록이 있어, 규칙 기반 결과로 문서 요약·분석 표시를 바꾸지 않고 새 항목만 더합니다.</p>}
            <ReflectionPreview props={props} setProps={setProps} paras={paras} works={myWorks} users={s.users} emptyText={skipped ? `새로 반영할 항목이 없습니다. 찾은 ${skipped}건은 모두 이미 업무에 기록되어 있습니다.` : '이 문서에서 업무에 반영할 항목을 찾지 못했습니다.'} />
          </>
        )}
      </div>
    </Modal>
  );
}
