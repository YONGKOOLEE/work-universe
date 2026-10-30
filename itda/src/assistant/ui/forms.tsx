// AI 비서 입력 대화상자 — 고객 등록·수정, 활동, 요청사항, 경조사, 확인 창.
import { useEffect, useMemo, useState } from 'react';
import { Button, Field, inputCls } from '../../components/ui';
import { cx } from '../../lib/util';
import { ymd } from '../dates';
import { addAnniversary, addInteraction, addRequest, createCustomer, findDuplicates, isErr, updateAnniversary, updateCustomer, updateInteraction, updateRequest, type DuplicateHit } from '../model';
import { ANNIVERSARY_KINDS, CUSTOMER_FIELDS, CUSTOMER_TYPES, INTERACTION_TYPES, REQUEST_STATUSES, type Anniversary, type Customer, type CustomerFieldKey, type CustRequest, type Interaction } from '../types';
import { useAssistant } from './hooks';
import { canChangeOwner, changedKeys, emptyForm, formOf, ownerChoices, ownerLabel, setCustomerOwner, type CustomerForm } from './logic';
import { AsstDialog, Pill } from './shared';

// ───────────── 확인 창 ─────────────

export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel = '확인',
  danger,
  onConfirm,
  onClose,
  testId = 'asst-confirm',
}: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  testId?: string;
}) {
  return (
    <AsstDialog
      open={open}
      onClose={onClose}
      title={title}
      testId={testId}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            취소
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} data-testid={`${testId}-ok`}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-2 text-[13px]">{children}</div>
    </AsstDialog>
  );
}

const GROUPS: { id: 'basic' | 'personal' | 'relation'; label: string }[] = [
  { id: 'basic', label: '기본 인적사항' },
  { id: 'personal', label: '개인적 특성' },
  { id: 'relation', label: '고객과의 관계' },
];

// ───────────── 고객 ─────────────

export function CustomerFormDialog({ open, onClose, customer, focusKey, onSaved }: { open: boolean; onClose: () => void; customer?: Customer | null; focusKey?: CustomerFieldKey; onSaved?: (id: string) => void }) {
  const { raw, a, now, userId, toast, exec } = useAssistant();
  const editing = !!customer;
  const base = useMemo(() => (customer ? formOf(customer) : emptyForm()), [customer]);
  const [form, setForm] = useState<CustomerForm>(base);
  const [ownerId, setOwnerId] = useState(customer?.ownerId ?? userId);
  const [error, setError] = useState('');
  const [dups, setDups] = useState<DuplicateHit[] | null>(null);
  useEffect(() => {
    if (open) {
      setForm(base);
      setOwnerId(customer?.ownerId ?? userId);
      setError('');
      setDups(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, customer?.id]);

  const leadMode = canChangeOwner(raw, userId, customer?.id ?? null);
  const owners = useMemo(() => (leadMode ? ownerChoices(raw, userId, customer?.ownerId ?? userId) : []), [leadMode, raw, userId, customer?.ownerId]);
  const set = (k: CustomerFieldKey, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setDups(null);
  };
  // 수정 중에도 같은 사람이 이미 있는지 알려 준다(막지는 않음)
  const editDup = editing && form.name.trim() ? findDuplicates(a, form, customer!.id).filter((d) => d.reasons.some((r) => r !== '이름 일치')) : [];

  const submit = (force = false) => {
    setError('');
    if (!form.name.trim()) {
      setError('이름은 필수 입력 항목입니다.');
      return;
    }
    if (editing) {
      const r = exec(customer!.id, (s, d) => {
        const u = updateCustomer(d, customer!.id, form, { now, source: 'manual' });
        if (isErr(u)) return u;
        let ownerChanged = false;
        if (ownerId !== customer!.ownerId) {
          const o = setCustomerOwner(s, d, customer!.id, ownerId, s.currentUserId, now);
          if (isErr(o)) return o;
          ownerChanged = o.changed;
        }
        return { changed: u.changed, ownerChanged };
      });
      if (isErr(r)) return setError(r.error);
      const n = (r as { changed: string[] }).changed.length;
      toast(n || (r as { ownerChanged: boolean }).ownerChanged ? `저장했습니다${n ? ` · ${n}개 항목 변경` : ''}${(r as { ownerChanged: boolean }).ownerChanged ? ' · 담당 영업자 변경' : ''}` : '바뀐 내용이 없습니다');
      onClose();
      return;
    }
    const r = exec(null, (s, d) => {
      const c = createCustomer(d, form, { now, ownerId: leadMode ? ownerId : s.currentUserId, source: 'manual', force });
      return c;
    });
    if (isErr(r)) return setError(r.error);
    if ('duplicates' in r) return setDups(r.duplicates);
    toast(`${form.name.trim()} 고객을 등록했습니다`);
    onSaved?.(r.id);
    onClose();
  };

  const changed = editing ? changedKeys(base, form) : [];
  return (
    <AsstDialog
      open={open}
      onClose={onClose}
      size="lg"
      title={editing ? `고객 정보 수정 — ${customer!.name}` : '고객 등록'}
      testId="asst-cust-form"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            취소
          </Button>
          {dups ? (
            <Button variant="primary" onClick={() => submit(true)} data-testid="asst-dup-force">
              그래도 등록
            </Button>
          ) : (
            <Button variant="primary" onClick={() => submit(false)} data-testid="asst-cust-save">
              {editing ? '저장' : '등록'}
            </Button>
          )}
        </>
      }
    >
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          submit(!!dups);
        }}
      >
        {dups && (
          <div className="rounded-lg border border-warn/50 bg-warnsoft/60 p-3 text-[13px]" role="alert" data-testid="asst-dup">
            <p className="font-semibold text-warn">비슷한 고객이 이미 있습니다. 같은 사람이면 등록하지 말고 기존 고객을 확인하세요.</p>
            <ul className="mt-1.5 space-y-1">
              {dups.map((d) => (
                <li key={d.customer.id} className="text-ink">
                  <b>{d.customer.name}</b> {d.customer.position} · {d.customer.company || '소속 없음'} <span className="text-muted">({d.reasons.join(', ')})</span>
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-muted">다른 사람이 맞다면 「그래도 등록」을 누르세요.</p>
          </div>
        )}
        {editDup.length > 0 && (
          <p className="rounded-lg border border-warn/50 bg-warnsoft/60 px-3 py-2 text-[13px] text-warn" role="status">
            같은 연락처·이름과 소속을 가진 다른 고객이 있습니다: {editDup.map((d) => `${d.customer.name}(${d.reasons.join(', ')})`).join(', ')}
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="담당 영업자" htmlFor="asst-f-owner" hint={leadMode ? '조직장은 내 조직 범위 안에서 담당을 바꿀 수 있습니다.' : editing ? '담당 영업자는 소속 조직의 조직장이 바꿉니다.' : '새 고객의 담당은 지금 사용자입니다.'}>
            {leadMode ? (
              <select id="asst-f-owner" data-testid="asst-f-owner" className={inputCls} value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
                {owners.map((u) => (
                  <option key={u.id} value={u.id}>
                    {ownerLabel(raw, u.id)} · {u.title}
                  </option>
                ))}
              </select>
            ) : (
              <input id="asst-f-owner" className={cx(inputCls, 'bg-sunken')} value={ownerLabel(raw, editing ? customer!.ownerId : userId)} readOnly />
            )}
          </Field>
        </div>
        {GROUPS.map((g) => (
          <fieldset key={g.id} className="space-y-3">
            <legend className="mb-1 text-[13px] font-semibold text-ink">{g.label}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {CUSTOMER_FIELDS.filter((f) => f.group === g.id).map((f) => {
                const common = {
                  id: `asst-f-${f.key}`,
                  'data-testid': `asst-f-${f.key}`,
                  value: form[f.key],
                  className: inputCls,
                  ...(f.key === (focusKey ?? 'name') ? { 'data-autofocus': true } : {}),
                };
                return (
                  <Field key={f.key} label={f.label + (f.key === 'name' ? ' (필수)' : '')} htmlFor={`asst-f-${f.key}`}>
                    {f.input === 'select' ? (
                      <select {...common} onChange={(e) => set(f.key, e.target.value)}>
                        <option value="">선택 안 함</option>
                        {CUSTOMER_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    ) : f.input === 'textarea' ? (
                      <textarea {...common} rows={2} className={cx(inputCls, 'resize-y')} onChange={(e) => set(f.key, e.target.value)} />
                    ) : (
                      <input {...common} type={f.input === 'date' ? 'date' : f.input === 'tel' ? 'tel' : f.input === 'email' ? 'email' : 'text'} onChange={(e) => set(f.key, e.target.value)} />
                    )}
                  </Field>
                );
              })}
            </div>
          </fieldset>
        ))}
        {error && (
          <p className="text-xs text-danger" role="alert" data-testid="asst-form-error">
            {error}
          </p>
        )}
        {editing && changed.length > 0 && (
          <p className="text-xs text-muted">
            바뀐 칸 <Pill tone="brand">{changed.length}</Pill> — 저장하면 항목마다 변경 이력(이전 값)이 남고 복원할 수 있습니다.
          </p>
        )}
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </AsstDialog>
  );
}

// ───────────── 고객 고르기 ─────────────

function CustomerSelect({ id, value, onChange, disabled }: { id: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const { a, canEdit } = useAssistant();
  const list = useMemo(() => a.customers.filter((c) => canEdit(c.id) || c.id === value).sort((x, y) => x.name.localeCompare(y.name, 'ko')), [a.customers, canEdit, value]);
  return (
    <select id={id} data-testid={id} className={inputCls} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      <option value="">고객을 고르세요</option>
      {list.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name} {c.position} · {c.company || '소속 없음'}
        </option>
      ))}
    </select>
  );
}

// ───────────── 활동 ─────────────

export function ActivityFormDialog({ open, onClose, customerId, interaction, defaultType }: { open: boolean; onClose: () => void; customerId?: string; interaction?: Interaction | null; defaultType?: string }) {
  const { now, toast, exec } = useAssistant();
  const editing = !!interaction;
  const init = () => ({
    cid: interaction?.customerId ?? customerId ?? '',
    type: interaction?.type ?? defaultType ?? '미팅',
    date: interaction?.date ?? ymd(now),
    time: interaction?.time ?? '',
    endTime: interaction?.endTime ?? '',
    title: interaction?.title ?? '',
    summary: interaction?.summary ?? '',
    details: interaction?.details ?? '',
  });
  const [f, setF] = useState(init);
  const [error, setError] = useState('');
  useEffect(() => {
    if (open) {
      setF(init());
      setError('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, interaction?.id, customerId]);
  const up = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const save = () => {
    if (!f.cid) return setError('고객을 고르세요.');
    const data = { type: f.type, date: f.date, time: f.time, endTime: f.endTime, title: f.title, summary: f.summary, details: f.details };
    const r = exec(f.cid, (_s, d) => (editing ? updateInteraction(d, interaction!.id, data, now) : addInteraction(d, f.cid, data, { now })));
    if (isErr(r)) return setError(r.error);
    toast(editing ? '활동 기록을 고쳤습니다' : '활동 기록을 추가했습니다');
    onClose();
  };
  return (
    <AsstDialog
      open={open}
      onClose={onClose}
      title={editing ? '활동 기록 수정' : '활동 기록 추가'}
      testId="asst-act-form"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            취소
          </Button>
          <Button variant="primary" onClick={save} data-testid="asst-act-save">
            {editing ? '저장' : '추가'}
          </Button>
        </>
      }
    >
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className="sm:col-span-2">
          <Field label="고객" htmlFor="asst-a-cid">
            <CustomerSelect id="asst-a-cid" value={f.cid} onChange={(v) => up('cid', v)} disabled={editing || !!customerId} />
          </Field>
        </div>
        <Field label="유형" htmlFor="asst-a-type">
          <select id="asst-a-type" data-testid="asst-a-type" className={inputCls} value={f.type} onChange={(e) => up('type', e.target.value)}>
            {INTERACTION_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </Field>
        <Field label="날짜" htmlFor="asst-a-date">
          <input id="asst-a-date" data-testid="asst-a-date" type="date" className={inputCls} value={f.date} onChange={(e) => up('date', e.target.value)} />
        </Field>
        <Field label="시작 시간 (선택)" htmlFor="asst-a-time">
          <input id="asst-a-time" type="time" className={inputCls} value={f.time} onChange={(e) => up('time', e.target.value)} />
        </Field>
        <Field label="종료 시간 (선택)" htmlFor="asst-a-end">
          <input id="asst-a-end" type="time" className={inputCls} value={f.endTime} onChange={(e) => up('endTime', e.target.value)} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="제목" htmlFor="asst-a-title">
            <input id="asst-a-title" data-testid="asst-a-title" data-autofocus className={inputCls} value={f.title} onChange={(e) => up('title', e.target.value)} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="요약" htmlFor="asst-a-summary">
            <textarea id="asst-a-summary" rows={2} className={cx(inputCls, 'resize-y')} value={f.summary} onChange={(e) => up('summary', e.target.value)} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="상세 내용 (선택)" htmlFor="asst-a-details">
            <textarea id="asst-a-details" rows={4} className={cx(inputCls, 'resize-y')} value={f.details} onChange={(e) => up('details', e.target.value)} />
          </Field>
        </div>
        {error && (
          <p className="text-xs text-danger sm:col-span-2" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </AsstDialog>
  );
}

// ───────────── 요청사항 ─────────────

export function RequestFormDialog({ open, onClose, customerId, request }: { open: boolean; onClose: () => void; customerId?: string; request?: CustRequest | null }) {
  const { now, toast, exec, me } = useAssistant();
  const editing = !!request;
  const init = () => ({
    cid: request?.customerId ?? customerId ?? '',
    content: request?.content ?? '',
    receivedDate: request?.receivedDate ?? ymd(now),
    dueDate: request?.dueDate ?? '',
    status: request?.status ?? '미착수',
    assignee: request?.assignee ?? me?.name ?? '',
    result: request?.result ?? '',
  });
  const [f, setF] = useState(init);
  const [error, setError] = useState('');
  useEffect(() => {
    if (open) {
      setF(init());
      setError('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, request?.id, customerId]);
  const up = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const save = () => {
    if (!f.cid) return setError('고객을 고르세요.');
    const data = { content: f.content, receivedDate: f.receivedDate, dueDate: f.dueDate, status: f.status, assignee: f.assignee, result: f.result };
    const r = exec(f.cid, (_s, d) => (editing ? updateRequest(d, request!.id, data, now) : addRequest(d, f.cid, data, { now })));
    if (isErr(r)) return setError(r.error);
    toast(editing ? '요청사항을 고쳤습니다' : '요청사항을 추가했습니다');
    onClose();
  };
  return (
    <AsstDialog
      open={open}
      onClose={onClose}
      title={editing ? '요청사항 수정' : '요청사항 추가'}
      testId="asst-req-form"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            취소
          </Button>
          <Button variant="primary" onClick={save} data-testid="asst-req-save">
            {editing ? '저장' : '추가'}
          </Button>
        </>
      }
    >
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className="sm:col-span-2">
          <Field label="고객" htmlFor="asst-r-cid">
            <CustomerSelect id="asst-r-cid" value={f.cid} onChange={(v) => up('cid', v)} disabled={editing || !!customerId} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="요청 내용" htmlFor="asst-r-content">
            <textarea id="asst-r-content" data-testid="asst-r-content" data-autofocus rows={2} className={cx(inputCls, 'resize-y')} value={f.content} onChange={(e) => up('content', e.target.value)} />
          </Field>
        </div>
        <Field label="접수일" htmlFor="asst-r-recv">
          <input id="asst-r-recv" type="date" className={inputCls} value={f.receivedDate} onChange={(e) => up('receivedDate', e.target.value)} />
        </Field>
        <Field label="처리기한 (선택)" htmlFor="asst-r-due">
          <input id="asst-r-due" data-testid="asst-r-due" type="date" className={inputCls} value={f.dueDate} onChange={(e) => up('dueDate', e.target.value)} />
        </Field>
        <Field label="진행상태" htmlFor="asst-r-status">
          <select id="asst-r-status" className={inputCls} value={f.status} onChange={(e) => up('status', e.target.value)}>
            {REQUEST_STATUSES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </Field>
        <Field label="담당자" htmlFor="asst-r-assignee">
          <input id="asst-r-assignee" className={inputCls} value={f.assignee} onChange={(e) => up('assignee', e.target.value)} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="처리 결과 (선택)" htmlFor="asst-r-result">
            <textarea id="asst-r-result" rows={2} className={cx(inputCls, 'resize-y')} value={f.result} onChange={(e) => up('result', e.target.value)} />
          </Field>
        </div>
        {error && (
          <p className="text-xs text-danger sm:col-span-2" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </AsstDialog>
  );
}

// ───────────── 경조사 ─────────────

export function AnniversaryFormDialog({ open, onClose, customerId, anniversary }: { open: boolean; onClose: () => void; customerId?: string; anniversary?: Anniversary | null }) {
  const { now, toast, exec } = useAssistant();
  const editing = !!anniversary;
  const init = () => ({
    cid: anniversary?.customerId ?? customerId ?? '',
    kind: anniversary?.kind ?? '결혼기념일',
    label: anniversary?.label ?? '',
    date: anniversary?.date ?? ymd(now),
    repeatYearly: anniversary?.repeatYearly ?? true,
    remindDays: anniversary?.remindDays ?? '7,2,0',
    notes: anniversary?.notes ?? '',
  });
  const [f, setF] = useState(init);
  const [error, setError] = useState('');
  useEffect(() => {
    if (open) {
      setF(init());
      setError('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, anniversary?.id, customerId]);
  const save = () => {
    if (!f.cid) return setError('고객을 고르세요.');
    const data = { kind: f.kind, label: f.label, date: f.date, repeatYearly: f.repeatYearly, remindDays: f.remindDays, notes: f.notes };
    const r = exec(f.cid, (_s, d) => (editing ? updateAnniversary(d, anniversary!.id, data) : addAnniversary(d, f.cid, data, { now })));
    if (isErr(r)) return setError(r.error);
    toast(editing ? '경조사를 고쳤습니다' : '경조사를 추가했습니다');
    onClose();
  };
  return (
    <AsstDialog
      open={open}
      onClose={onClose}
      title={editing ? '경조사 수정' : '경조사 추가'}
      testId="asst-ann-form"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            취소
          </Button>
          <Button variant="primary" onClick={save} data-testid="asst-ann-save">
            {editing ? '저장' : '추가'}
          </Button>
        </>
      }
    >
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className="sm:col-span-2">
          <Field label="고객" htmlFor="asst-n-cid">
            <CustomerSelect id="asst-n-cid" value={f.cid} onChange={(v) => setF((x) => ({ ...x, cid: v }))} disabled={editing || !!customerId} />
          </Field>
        </div>
        <Field label="종류" htmlFor="asst-n-kind">
          <select id="asst-n-kind" data-autofocus className={inputCls} value={f.kind} onChange={(e) => setF((x) => ({ ...x, kind: e.target.value }))}>
            {ANNIVERSARY_KINDS.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </Field>
        <Field label="이름 (선택)" htmlFor="asst-n-label" hint="예: 자녀 수능일">
          <input id="asst-n-label" className={inputCls} value={f.label} onChange={(e) => setF((x) => ({ ...x, label: e.target.value }))} />
        </Field>
        <Field label="날짜" htmlFor="asst-n-date">
          <input id="asst-n-date" type="date" className={inputCls} value={f.date} onChange={(e) => setF((x) => ({ ...x, date: e.target.value }))} />
        </Field>
        <Field label="알림 시점 (며칠 전)" htmlFor="asst-n-remind" hint="쉼표로 구분, 예: 7,2,0">
          <input id="asst-n-remind" className={inputCls} value={f.remindDays} onChange={(e) => setF((x) => ({ ...x, remindDays: e.target.value }))} />
        </Field>
        <label className="flex items-center gap-2 text-[13px] sm:col-span-2">
          <input type="checkbox" checked={f.repeatYearly} onChange={(e) => setF((x) => ({ ...x, repeatYearly: e.target.checked }))} />
          매년 반복
        </label>
        <div className="sm:col-span-2">
          <Field label="메모 (선택)" htmlFor="asst-n-notes">
            <textarea id="asst-n-notes" rows={2} className={cx(inputCls, 'resize-y')} value={f.notes} onChange={(e) => setF((x) => ({ ...x, notes: e.target.value }))} />
          </Field>
        </div>
        {error && (
          <p className="text-xs text-danger sm:col-span-2" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </AsstDialog>
  );
}
