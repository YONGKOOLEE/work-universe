import { Gavel, GitCommitVertical, ListTodo, LayoutList, CheckCircle2, CircleHelp, Quote, Tag } from 'lucide-react';
import type { DocParagraph, EventType, User, Work } from '../lib/types';
import { verify, FIELD_LABEL, EVENT_TYPES, PHASE_OPTIONS, phaseOf, type Proposal, type ProposalKind, type OverviewField } from '../ai/reflect';
import { cx } from '../lib/util';
import { selectableUsers, displayName } from '../lib/people';

const GROUPS: { kind: ProposalKind; title: string; Icon: React.ElementType; to: string }[] = [
  { kind: 'decision', title: '결정사항', Icon: Gavel, to: '업무 상세 › 결정사항' },
  { kind: 'event', title: '타임라인 이벤트', Icon: GitCommitVertical, to: '업무 타임라인' },
  { kind: 'action', title: '향후 조치', Icon: ListTodo, to: '향후 조치 및 유의사항' },
  { kind: 'overview', title: '업무 개요 갱신', Icon: LayoutList, to: '업무 개요' },
  { kind: 'topic', title: '주제(업무 유니버스 지도)', Icon: Tag, to: '업무 지도의 주제 — 같은 주제의 업무끼리 이어짐' },
];
const SOURCE_LABEL: Record<string, string> = { rule: '표·목록 규칙', review: '꼼꼼히 읽기' };
const small = 'rounded border border-line2 bg-surface px-1.5 py-1 text-xs text-ink focus:border-brand focus:outline-none';

export function ReflectionPreview({ props, setProps, paras, works, users = [] }: { props: Proposal[]; setProps: (f: (p: Proposal[]) => Proposal[]) => void; paras: DocParagraph[]; works: Work[]; users?: User[] }) {
  const set = (id: string, patch: Partial<Proposal>, reverify = false) =>
    setProps((ps) => ps.map((p) => (p.id === id ? (reverify ? verify({ ...p, ...patch }, paras) : { ...p, ...patch }) : p)));
  const verifiedN = props.filter((p) => p.verified).length;
  return (
    <section className="rounded-lg border border-brand/30">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-brandsoft/40 px-4 py-3">
        <h3 className="text-[14px] font-semibold">업무 반영 미리보기</h3>
        <span className="text-xs text-muted">
          제안 {props.length}건 · 원문 확인 {verifiedN}건 · 별도 확인 필요 {props.length - verifiedN}건
        </span>
        <div className="ml-auto flex gap-1.5">
          <button className="rounded border border-fact/40 bg-surface px-2 py-1 text-xs font-medium text-fact hover:bg-factsoft" onClick={() => setProps((ps) => ps.map((p) => ({ ...p, approved: p.verified ? true : p.approved })))}>
            원문 확인 항목 모두 승인
          </button>
          <button className="rounded border border-line2 bg-surface px-2 py-1 text-xs text-muted hover:text-ink" onClick={() => setProps((ps) => ps.map((p) => ({ ...p, approved: false })))}>
            모두 해제
          </button>
        </div>
      </div>
      <p className="border-b border-line px-4 py-2 text-xs text-muted">
        체크한 항목만 업무에 반영됩니다. 문구·날짜·대상 업무는 반영 전에 고칠 수 있습니다. '별도 확인 필요' 항목을 승인하면 해당 표시가 붙은 채로 반영되어, 업무 화면과 기록 점검에서 확인 대상으로 남습니다.
      </p>
      {props.length === 0 && <p className="px-4 py-6 text-center text-[13px] text-muted">이 문서에서 업무에 반영할 항목을 찾지 못했습니다. 문서만 등록됩니다.</p>}
      {GROUPS.map((g) => {
        const list = props.filter((p) => p.kind === g.kind);
        if (!list.length) return null;
        return (
          <div key={g.kind} className="border-b border-line last:border-0">
            <div className="flex items-center gap-2 bg-sunken/50 px-4 py-2 text-xs font-semibold text-muted">
              <g.Icon size={13} className="text-brand" />
              {g.title} <span className="tnum">{list.length}</span>
              <span className="ml-auto font-normal text-faint">반영 위치: {g.to}</span>
            </div>
            <ul className="divide-y divide-line">
              {list.map((p) => {
                const para = paras.find((x) => x.id === p.paraId);
                return (
                  <li key={p.id} className={cx('grid gap-3 px-4 py-3 sm:grid-cols-[22px_1fr]', p.approved && 'bg-brandsoft/25')}>
                    <input
                      type="checkbox"
                      aria-label="반영 승인"
                      className="mt-1.5 h-4 w-4 accent-[rgb(var(--brand))]"
                      checked={p.approved}
                      disabled={p.kind === 'event' && !p.date}
                      onChange={(e) => set(p.id, { approved: e.target.checked })}
                    />
                    <div className="min-w-0 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {p.verified ? (
                          <span className="inline-flex items-center gap-1 rounded border border-fact/25 bg-factsoft px-1.5 py-px text-2xs font-semibold text-fact">
                            <CheckCircle2 size={11} />
                            원문 확인{para ? ` · ${para.page ? `${para.page}쪽 ` : ''}${para.id}` : ''}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded border border-warn/30 bg-warnsoft px-1.5 py-px text-2xs font-semibold text-warn">
                            <CircleHelp size={11} />
                            별도 확인 필요
                          </span>
                        )}
                        {p.date && !p.dateVerified && <span className="rounded bg-warnsoft px-1.5 py-px text-2xs font-semibold text-warn">날짜 원문 미확인</span>}
                        <select className={small} value={p.workId} onChange={(e) => set(p.id, { workId: e.target.value })} aria-label="반영 대상 업무">
                          {works.map((w) => (
                            <option key={w.id} value={w.id}>
                              {w.name}
                            </option>
                          ))}
                        </select>
                        {p.kind === 'overview' && (
                          <select className={small} value={p.field} onChange={(e) => set(p.id, { field: e.target.value as OverviewField })} aria-label="개요 항목">
                            {(Object.keys(FIELD_LABEL) as OverviewField[]).map((f) => (
                              <option key={f} value={f}>
                                {FIELD_LABEL[f]}
                              </option>
                            ))}
                          </select>
                        )}
                        {p.kind === 'event' && (
                          <>
                            <select className={small} value={p.eventType} onChange={(e) => set(p.id, { eventType: e.target.value as EventType, phase: phaseOf(e.target.value as EventType) })} aria-label="이벤트 유형">
                              {EVENT_TYPES.map((t) => (
                                <option key={t}>{t}</option>
                              ))}
                            </select>
                            <select className={small} value={p.phase} onChange={(e) => set(p.id, { phase: e.target.value })} aria-label="단계">
                              {PHASE_OPTIONS.map((t) => (
                                <option key={t}>{t}</option>
                              ))}
                            </select>
                          </>
                        )}
                        {(p.kind === 'event' || p.kind === 'action' || p.kind === 'decision') && (
                          <input
                            className={cx(small, 'w-[118px] font-mono')}
                            key={p.id + (p.date ?? '')}
                            defaultValue={p.date ?? ''}
                            placeholder={p.kind === 'action' ? '기한 YYYY-MM-DD' : 'YYYY-MM-DD'}
                            title="YYYY-MM-DD 또는 YYYY-MM 형식"
                            aria-label={p.kind === 'action' ? '기한' : '날짜'}
                            onBlur={(e) => {
                              const v = e.target.value.trim();
                              if (!v) set(p.id, { date: null, dateText: null }, true);
                              else if (/^\d{4}-\d{2}(-\d{2})?$/.test(v)) set(p.id, { date: v, dateText: null }, true);
                              else e.target.value = p.date ?? '';
                            }}
                          />
                        )}
                        {p.kind === 'action' && (
                          <select className={small} value={p.ownerId ?? ''} onChange={(e) => set(p.id, { ownerId: e.target.value || null })} aria-label="조치 담당" title={p.ownerName ? `문서상 담당: ${p.ownerName}` : '문서에 담당이 없으면 업무의 첫 담당자'} data-testid="proposal-owner">
                            <option value="">{p.ownerName ? `담당: ${p.ownerName}(사용자 아님 → 업무 담당자)` : '담당: 업무 담당자(기본)'}</option>
                            {selectableUsers(users, p.ownerId ? [p.ownerId] : []).map((u) => (
                              <option key={u.id} value={u.id}>
                                담당: {displayName(u)}
                              </option>
                            ))}
                          </select>
                        )}
                        {p.source && SOURCE_LABEL[p.source] && <span className="rounded bg-sunken px-1.5 py-0.5 text-2xs text-muted">{SOURCE_LABEL[p.source]}</span>}
                      </div>
                      <input className={cx(small, 'w-full py-1.5 text-[13px]')} value={p.text} onChange={(e) => set(p.id, { text: e.target.value })} aria-label="반영 문구" />
                      {p.quote && (
                        <p className="flex gap-1.5 text-2xs leading-relaxed text-muted">
                          <Quote size={11} className="mt-0.5 shrink-0" />
                          <span className="line-clamp-2">근거: {p.quote}</span>
                        </p>
                      )}
                      {p.issue && <p className="text-2xs font-medium text-warn">{p.issue}</p>}
                      {p.kind === 'event' && !p.date && <p className="text-2xs text-warn">날짜가 없어 타임라인에 놓을 수 없습니다. 날짜를 입력하면 승인할 수 있습니다.</p>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
