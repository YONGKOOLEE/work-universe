// 고객 상세 — 헤더(아바타·소속·연락처), 개요/선호·관심사/히스토리/요청/경조사/변경 이력, 미팅 브리핑, 수정·삭제.
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Cake, ChevronDown, ChevronRight, FileText, Mail, Pencil, Phone, Plus, RotateCcw, Smartphone, Trash2 } from 'lucide-react';
import { Button, Card, CardHead, Empty, inputCls } from '../../components/ui';
import { useRouter } from '../../lib/router';
import { cx } from '../../lib/util';
import { ymd } from '../dates';
import { getState, meetingError } from '../followup';
import { deleteAnniversary, deleteCustomer, deleteInteraction, deleteRequest, isErr, restoreChange, updateRequest } from '../model';
import { customerDetail, type CustomerDetail as Detail } from '../queries';
import { CUSTOMER_FIELDS, FIELD_KEYS, FIELD_LABELS, REQUEST_STATUSES, type Anniversary, type CustomerFieldKey, type CustRequest, type Interaction } from '../types';
import { AnniversaryFormDialog, ActivityFormDialog, ConfirmDialog, CustomerFormDialog, RequestFormDialog } from './forms';
import { BriefingDialog } from './BriefingDialog';
import { useAssistant } from './hooks';
import { customerPath, followupPath, isCustomerTab, ownerLabel, type CustomerTab } from './logic';
import { Avatar, Blank, FollowupButton, DDay, Pill, ReadOnlyNote, SMALL_SELECT, TabsBar, wrapCls } from './shared';

const TAB_LABEL: Record<CustomerTab, string> = { overview: '개요', prefs: '선호·관심사', history: '히스토리', requests: '요청', events: '경조사', changes: '변경 이력' };
const CHANGE_PAGE = 60;

/** 지울 대상. customerId는 지우기를 누른 시점의 고객이다(대화상자가 열린 채 다른 고객으로 옮겨 가도 엉뚱한 고객을 지우지 않게 상태에 담는다) */
type Del = { kind: 'interaction' | 'request' | 'anniversary' | 'customer'; id: string; customerId: string; label: string } | null;

export default function CustomerDetail({ id }: { id: string }) {
  const { a, raw, now, canEdit, exec, toast } = useAssistant();
  const { nav, query, replace, back, canBack } = useRouter();
  const d = useMemo(() => customerDetail(a, id, now), [a, id, now]);
  const tabQ = query.get('tab');
  const tab: CustomerTab = isCustomerTab(tabQ) ? tabQ : 'overview';
  const [edit, setEdit] = useState<{ focus?: CustomerFieldKey } | null>(null);
  const [brief, setBrief] = useState<{ interactionId?: string } | null>(null);
  const [act, setAct] = useState<{ interaction?: Interaction | null } | null>(null);
  const [req, setReq] = useState<{ request?: CustRequest | null } | null>(null);
  const [ann, setAnn] = useState<{ anniversary?: Anniversary | null } | null>(null);
  const [del, setDel] = useState<Del>(null);
  // 다른 고객으로 옮겨 가면 열려 있던 삭제 확인은 닫는다
  useEffect(() => setDel(null), [id]);

  // 알림에서 온 「브리핑」 링크(?briefing=…): 창을 열고 주소의 값은 지운다
  const wantBrief = query.get('briefing');
  useEffect(() => {
    if (wantBrief && d) {
      setBrief({ interactionId: wantBrief === '1' ? undefined : wantBrief });
      replace(customerPath(id, tab));
    }
  }, [wantBrief, !!d]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!d)
    return (
      <Card>
        <Empty title="고객을 찾을 수 없습니다" sub="지워졌거나 아직 불러오지 않은 고객입니다." action={<Button onClick={() => nav('/assistant/customers')}>고객 목록</Button>} />
      </Card>
    );
  const c = d.customer;
  const editable = canEdit(id);
  const owner = ownerLabel(raw, c.ownerId);
  const why = editable ? undefined : `담당 영업자(${owner}) 또는 담당자의 조직장만 고칠 수 있습니다.`;
  const setTab = (t: CustomerTab) => replace(customerPath(id, t));

  const runDelete = () => {
    if (!del) return;
    const x = del;
    setDel(null);
    const r = exec(x.customerId, (_s, dd) => {
      if (x.kind === 'interaction') return deleteInteraction(dd, x.id, now);
      if (x.kind === 'request') return deleteRequest(dd, x.id);
      if (x.kind === 'anniversary') return deleteAnniversary(dd, x.id);
      return deleteCustomer(dd, x.customerId);
    });
    if (isErr(r)) return toast(r.error);
    toast(x.kind === 'customer' ? `${x.label} 고객을 지웠습니다` : `${x.label}을(를) 지웠습니다`);
    if (x.kind === 'customer') nav('/assistant/customers');
  };

  const counts: Record<CustomerTab, number | undefined> = {
    overview: undefined,
    prefs: undefined,
    history: d.interactions.length,
    requests: d.requests.filter((r) => r.status !== '완료').length,
    events: d.anniversaries.length + (d.birthday ? 1 : 0),
    changes: d.history.length,
  };

  return (
    <div className="space-y-4" data-testid="asst-detail" data-id={id}>
      <button className={cx('inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink')} onClick={() => (canBack ? back() : nav('/assistant/customers'))}>
        <ArrowLeft size={14} />
        고객 목록
      </button>

      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start gap-4">
          <Avatar id={c.id} name={c.name} size="lg" />
          <div className="min-w-0 flex-1">
            <h2 className={cx('flex flex-wrap items-baseline gap-x-2 text-[20px] font-bold tracking-tight', wrapCls)} data-testid="asst-detail-name">
              {c.name}
              <span className="text-[14px] font-normal text-muted">{c.position}</span>
              {c.isDemo && <Pill>가상</Pill>}
            </h2>
            <p className={cx('mt-0.5 text-[13px] text-muted', wrapCls)}>{[c.company, c.department, c.duties].filter(Boolean).join(' · ') || '소속 정보 없음'}</p>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
              {c.customerType && <Pill tone="brand">{c.customerType}</Pill>}
              {c.mobile && (
                <span className="inline-flex items-center gap-1 tnum">
                  <Smartphone size={13} className="text-muted" aria-hidden="true" />
                  {c.mobile}
                </span>
              )}
              {c.officePhone && (
                <span className="inline-flex items-center gap-1 tnum">
                  <Phone size={13} className="text-muted" aria-hidden="true" />
                  {c.officePhone}
                </span>
              )}
              {c.email && (
                <span className={cx('inline-flex items-center gap-1', wrapCls)}>
                  <Mail size={13} className="text-muted" aria-hidden="true" />
                  {c.email}
                </span>
              )}
              {!c.mobile && !c.officePhone && !c.email && <Blank>연락처 미입력</Blank>}
            </div>
            <p className="mt-1.5 text-xs text-muted">
              담당 영업자 <b className="text-ink" data-testid="asst-detail-owner">{owner}</b>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => setBrief({})} data-testid="asst-brief-open">
              <FileText size={14} />
              미팅 브리핑
            </Button>
            <span title={why}>
              <Button onClick={() => setEdit({})} disabled={!editable} data-testid="asst-edit-open">
                <Pencil size={14} />
                수정
              </Button>
            </span>
            <span title={why}>
              <Button variant="danger" onClick={() => setDel({ kind: 'customer', id, customerId: id, label: c.name })} disabled={!editable} data-testid="asst-cust-delete">
                <Trash2 size={14} />
                삭제
              </Button>
            </span>
          </div>
        </div>
      </Card>

      {!editable && <ReadOnlyNote owner={owner} />}
      {editable && c.ownerId !== raw.currentUserId && (
        <p className="flex items-start gap-2 rounded-lg border border-brand/30 bg-brandsoft/40 px-4 py-2.5 text-[13px] text-ink" data-testid="asst-lead-note">
          <Pencil size={14} className="mt-0.5 shrink-0 text-brand" aria-hidden="true" />
          <span>
            이 고객은 <b>{owner}</b>님이 담당합니다. 조직장이라 수정할 수 있습니다.
          </span>
        </p>
      )}

      <TabsBar tabs={(Object.keys(TAB_LABEL) as CustomerTab[]).map((t) => ({ id: t, label: TAB_LABEL[t], count: counts[t] }))} value={tab} onChange={setTab} />

      {tab === 'overview' && <Overview d={d} editable={editable} onFill={(k) => setEdit({ focus: k })} />}
      {tab === 'prefs' && <Prefs d={d} editable={editable} onFill={(k) => setEdit({ focus: k })} />}
      {tab === 'history' && (
        <History
          d={d}
          editable={editable}
          why={why}
          onAdd={() => setAct({})}
          onEdit={(i) => setAct({ interaction: i })}
          onDelete={(i) => setDel({ kind: 'interaction', id: i.id, customerId: id, label: `활동 기록 「${i.title}」` })}
          onBrief={(i) => setBrief({ interactionId: i.id })}
        />
      )}
      {tab === 'requests' && (
        <Requests
          d={d}
          editable={editable}
          why={why}
          onAdd={() => setReq({})}
          onEdit={(r) => setReq({ request: r })}
          onDelete={(r) => setDel({ kind: 'request', id: r.id, customerId: id, label: '요청사항' })}
        />
      )}
      {tab === 'events' && (
        <Events d={d} editable={editable} why={why} onAdd={() => setAnn({})} onEdit={(x) => setAnn({ anniversary: x })} onDelete={(x) => setDel({ kind: 'anniversary', id: x.id, customerId: id, label: `경조사 「${x.label || x.kind}」` })} />
      )}
      {tab === 'changes' && <Changes d={d} editable={editable} why={why} />}

      <CustomerFormDialog open={!!edit} onClose={() => setEdit(null)} customer={c} focusKey={edit?.focus} />
      <BriefingDialog customerId={brief ? id : null} interactionId={brief?.interactionId} onClose={() => setBrief(null)} />
      <ActivityFormDialog open={!!act} onClose={() => setAct(null)} customerId={id} interaction={act?.interaction} />
      <RequestFormDialog open={!!req} onClose={() => setReq(null)} customerId={id} request={req?.request} />
      <AnniversaryFormDialog open={!!ann} onClose={() => setAnn(null)} customerId={id} anniversary={ann?.anniversary} />
      <ConfirmDialog
        open={!!del}
        onClose={() => setDel(null)}
        title={del?.kind === 'customer' ? '고객 삭제' : '삭제 확인'}
        confirmLabel="삭제"
        danger
        onConfirm={runDelete}
        testId="asst-del"
      >
        {del?.kind === 'customer' ? (
          <>
            <p>
              <b>{c.name}</b> 고객을 지울까요? 이 고객의 아래 기록도 <b>함께 지워지며 되돌릴 수 없습니다.</b>
            </p>
            <ul className="list-disc pl-5 text-muted">
              <li>활동 기록 {d.interactions.length}건 (미팅 후 질문 상태 포함)</li>
              <li>요청사항 {d.requests.length}건</li>
              <li>경조사 {d.anniversaries.length}건</li>
              <li>변경 이력 {d.history.length}건</li>
            </ul>
            <p className="text-muted">필요하면 먼저 상단 「데이터 옮기기 → 내보내기」로 백업하세요.</p>
          </>
        ) : (
          <p>{del?.label}을(를) 지울까요? 되돌릴 수 없습니다.</p>
        )}
      </ConfirmDialog>
    </div>
  );
}

// ───────────── 항목 줄 ─────────────

function FieldRow({ k, d, editable, onFill }: { k: CustomerFieldKey; d: Detail; editable: boolean; onFill: (k: CustomerFieldKey) => void }) {
  const c = d.customer;
  const v = (c[k] || '').trim();
  const meta = d.fieldMeta[k];
  return (
    <div className="grid grid-cols-1 gap-0.5 px-4 py-2.5 text-[13px] sm:grid-cols-[132px_1fr] sm:gap-3" data-testid={`asst-row-${k}`}>
      <dt className="font-medium text-muted">{FIELD_LABELS[k]}</dt>
      <dd className="min-w-0">
        {v ? (
          <p className={cx('whitespace-pre-wrap', wrapCls)} data-testid={`asst-v-${k}`}>
            {v}
          </p>
        ) : (
          <p className="flex flex-wrap items-center gap-2">
            <Blank />
            {editable && (
              <button className="text-xs font-medium text-brand hover:underline" onClick={() => onFill(k)}>
                채우기
              </button>
            )}
          </p>
        )}
        {v && (
          <p className="mt-0.5 text-2xs text-muted" data-testid={`asst-meta-${k}`}>
            {meta ? `마지막 수정 ${meta.changedAt.slice(0, 10)} · ${meta.sourceLabel}` : c.isDemo ? '가상 데이터 · 수정 이력 없음' : '수정 이력 없음'}
          </p>
        )}
      </dd>
    </div>
  );
}

function Overview({ d, editable, onFill }: { d: Detail; editable: boolean; onFill: (k: CustomerFieldKey) => void }) {
  const basic = CUSTOMER_FIELDS.filter((f) => f.group === 'basic' && f.key !== 'name');
  const relation = CUSTOMER_FIELDS.filter((f) => f.group === 'relation');
  return (
    <div className="space-y-4">
      {d.missing.length > 0 && (
        <p className="rounded-lg border border-warn/40 bg-warnsoft/50 px-4 py-2.5 text-[13px] text-warn" data-testid="asst-missing">
          영업에 도움이 되는데 비어 있는 항목: <b>{d.missing.join(', ')}</b>
          {editable ? ' — 미팅 후 질문이나 「수정」으로 채우세요.' : ''}
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHead title="기본 정보" />
          <dl className="divide-y divide-line">
            {basic.map((f) => (
              <FieldRow key={f.key} k={f.key} d={d} editable={editable} onFill={onFill} />
            ))}
          </dl>
        </Card>
        <Card>
          <CardHead title="고객과의 관계" />
          <dl className="divide-y divide-line">
            {relation.map((f) => (
              <FieldRow key={f.key} k={f.key} d={d} editable={editable} onFill={onFill} />
            ))}
            <div className="grid grid-cols-1 gap-0.5 px-4 py-2.5 text-[13px] sm:grid-cols-[132px_1fr] sm:gap-3">
              <dt className="font-medium text-muted">다가오는 생일</dt>
              <dd className="flex flex-wrap items-center gap-2">{d.birthday ? <><span className="tnum">{d.birthday.date}</span><DDay n={d.birthday.dDay} /></> : <Blank>생년월일 미입력</Blank>}</dd>
            </div>
            <div className="grid grid-cols-1 gap-0.5 px-4 py-2.5 text-[13px] sm:grid-cols-[132px_1fr] sm:gap-3">
              <dt className="font-medium text-muted">미처리 요청</dt>
              <dd>{d.requests.filter((r) => r.status !== '완료').length}건</dd>
            </div>
          </dl>
        </Card>
      </div>
    </div>
  );
}

function Prefs({ d, editable, onFill }: { d: Detail; editable: boolean; onFill: (k: CustomerFieldKey) => void }) {
  const personal = CUSTOMER_FIELDS.filter((f) => f.group === 'personal');
  return (
    <Card>
      <CardHead title="선호·관심사" sub="성향·음식·취미·연락 방식은 미팅 준비와 안부 연락에 쓰는 참고 정보입니다." />
      <dl className="divide-y divide-line">
        {personal.map((f) => (
          <FieldRow key={f.key} k={f.key} d={d} editable={editable} onFill={onFill} />
        ))}
      </dl>
    </Card>
  );
}

function History({
  d,
  editable,
  why,
  onAdd,
  onEdit,
  onDelete,
  onBrief,
}: {
  d: Detail;
  editable: boolean;
  why?: string;
  onAdd: () => void;
  onEdit: (i: Interaction) => void;
  onDelete: (i: Interaction) => void;
  onBrief: (i: Interaction) => void;
}) {
  const { a, now } = useAssistant();
  const { nav } = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const today = ymd(now);
  return (
    <Card>
      <CardHead
        title="활동 히스토리"
        sub="미팅·통화·이메일·메모 기록(최근 순)"
        right={
          <span title={why}>
            <Button size="sm" variant="primary" onClick={onAdd} disabled={!editable} data-testid="asst-act-add">
              <Plus size={13} />
              활동 추가
            </Button>
          </span>
        }
      />
      {d.interactions.length === 0 ? (
        <Empty title="활동 기록이 없습니다" sub="미팅·통화를 기록하면 여기에 쌓이고 최근 연락일이 자동으로 갱신됩니다." />
      ) : (
        <ul className="divide-y divide-line">
          {d.interactions.map((i) => {
            const isOpen = open === i.id;
            const st = i.type === '미팅' ? getState(a, i.id) : undefined;
            const canAsk = i.type === '미팅' && !meetingError(a, i.id, now);
            return (
              <li key={i.id} className="px-4 py-3 text-[13px]" data-testid="asst-act-row" data-id={i.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <Pill tone={i.type === '미팅' ? 'brand' : 'muted'}>{i.type}</Pill>
                  <span className="tnum text-muted">
                    {i.date}
                    {i.time ? ` ${i.time}` : ''}
                  </span>
                  {i.date > today && <Pill tone="warn">예정</Pill>}
                  {st && st.status === 'skipped' && <Pill tone="muted">미팅 후 질문 건너뜀</Pill>}
                  <span className="ml-auto flex flex-wrap gap-1">
                    {i.type === '미팅' && (
                      <Button size="sm" onClick={() => onBrief(i)}>
                        브리핑
                      </Button>
                    )}
                    {canAsk && (
                      <span title={editable ? undefined : why}>
                        <FollowupButton done={st?.status === 'done'} onClick={() => nav(followupPath(i.id))} />
                      </span>
                    )}
                    <span title={why}>
                      <Button size="sm" variant="ghost" onClick={() => onEdit(i)} disabled={!editable} aria-label={`${i.title} 수정`}>
                        <Pencil size={13} />
                      </Button>
                    </span>
                    <span title={why}>
                      <Button size="sm" variant="ghost" onClick={() => onDelete(i)} disabled={!editable} aria-label={`${i.title} 삭제`}>
                        <Trash2 size={13} />
                      </Button>
                    </span>
                  </span>
                </div>
                <p className={cx('mt-1 font-semibold', wrapCls)}>{i.title}</p>
                {i.summary && <p className={cx('mt-0.5 text-muted', wrapCls)}>{i.summary}</p>}
                {i.details && (
                  <div className="mt-1">
                    <button className="inline-flex items-center gap-0.5 text-xs font-medium text-brand hover:underline" onClick={() => setOpen(isOpen ? null : i.id)} aria-expanded={isOpen}>
                      {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      상세 내용 {isOpen ? '접기' : '보기'}
                    </button>
                    {isOpen && <p className={cx('mt-1 whitespace-pre-wrap rounded-md bg-sunken px-3 py-2 text-xs', wrapCls)}>{i.details}</p>}
                  </div>
                )}
                {i.source !== 'manual' && i.source !== 'demo' && <p className="mt-1 text-2xs text-muted">출처: {i.source === 'sample' ? '예시 분석(AI 미사용)' : i.source === 'ai' ? 'AI 분석 승인' : i.source}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function Requests({ d, editable, why, onAdd, onEdit, onDelete }: { d: Detail; editable: boolean; why?: string; onAdd: () => void; onEdit: (r: CustRequest) => void; onDelete: (r: CustRequest) => void }) {
  const { now, exec, toast } = useAssistant();
  const setStatus = (r: CustRequest, status: string) => {
    const x = exec(d.customer.id, (_s, dd) => updateRequest(dd, r.id, { status }, now));
    if (isErr(x)) toast(x.error);
  };
  return (
    <Card>
      <CardHead
        title="요청사항"
        sub="미처리 요청이 위에 옵니다. 상태를 바로 바꿀 수 있습니다."
        right={
          <span title={why}>
            <Button size="sm" variant="primary" onClick={onAdd} disabled={!editable} data-testid="asst-req-add">
              <Plus size={13} />
              요청 추가
            </Button>
          </span>
        }
      />
      {d.requests.length === 0 ? (
        <Empty title="요청사항이 없습니다" sub="고객이 요청한 일을 기록하면 기한 알림과 오늘 할 일에 나타납니다." />
      ) : (
        <ul className="divide-y divide-line">
          {d.requests.map((r) => (
            <li key={r.id} className="px-4 py-3 text-[13px]" data-testid="asst-req-row" data-id={r.id}>
              <div className="flex flex-wrap items-center gap-2">
                {r.status !== '완료' && <DDay n={r.dDay} />}
                <span className="tnum text-xs text-muted">
                  접수 {r.receivedDate}
                  {r.dueDate ? ` · 기한 ${r.dueDate}` : ''}
                </span>
                {r.assignee && <span className="text-xs text-muted">담당 {r.assignee}</span>}
                <span className="ml-auto flex items-center gap-1">
                  <select
                    className={cx(inputCls, SMALL_SELECT)}
                    value={r.status}
                    disabled={!editable}
                    title={why}
                    onChange={(e) => setStatus(r, e.target.value)}
                    aria-label="진행 상태"
                    data-testid="asst-req-status"
                  >
                    {REQUEST_STATUSES.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                  <span title={why}>
                    <Button size="sm" variant="ghost" onClick={() => onEdit(r)} disabled={!editable} aria-label="요청 수정">
                      <Pencil size={13} />
                    </Button>
                  </span>
                  <span title={why}>
                    <Button size="sm" variant="ghost" onClick={() => onDelete(r)} disabled={!editable} aria-label="요청 삭제">
                      <Trash2 size={13} />
                    </Button>
                  </span>
                </span>
              </div>
              <p className={cx('mt-1', wrapCls, r.status === '완료' && 'text-muted line-through')}>{r.content}</p>
              {r.result && <p className={cx('mt-0.5 text-xs text-muted', wrapCls)}>처리 결과: {r.result}</p>}
              {r.source && r.source !== 'manual' && r.source !== 'demo' && <p className="mt-0.5 text-2xs text-muted">출처: {r.source === 'ai' ? 'AI 분석 승인' : r.source === 'sample' ? '예시 분석(AI 미사용)' : r.source === 'followup' ? '미팅 후 질문' : r.source}</p>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Events({ d, editable, why, onAdd, onEdit, onDelete }: { d: Detail; editable: boolean; why?: string; onAdd: () => void; onEdit: (x: Anniversary) => void; onDelete: (x: Anniversary) => void }) {
  return (
    <Card>
      <CardHead
        title="경조사"
        sub="생일(고객 정보의 생년월일)과 등록한 기념일. 며칠 전에 알릴지 정할 수 있습니다."
        right={
          <span title={why}>
            <Button size="sm" variant="primary" onClick={onAdd} disabled={!editable} data-testid="asst-ann-add">
              <Plus size={13} />
              경조사 추가
            </Button>
          </span>
        }
      />
      <ul className="divide-y divide-line">
        {d.birthday && (
          <li className="flex flex-wrap items-center gap-2 px-4 py-3 text-[13px]">
            <Cake size={14} className="text-brand" aria-hidden="true" />
            <b>생일</b>
            <span className="tnum text-muted">{d.birthday.date}</span>
            <DDay n={d.birthday.dDay} />
            <span className="text-xs text-muted">생년월일에서 계산 — 고치려면 「수정」</span>
          </li>
        )}
        {d.anniversaries.map((x) => (
          <li key={x.id} className="flex flex-wrap items-center gap-2 px-4 py-3 text-[13px]" data-testid="asst-ann-row">
            <Pill tone="brand">{x.kind}</Pill>
            <b className={wrapCls}>{x.label || x.kind}</b>
            <span className="tnum text-muted">{x.repeatYearly ? `매년 ${x.date.slice(5)}` : x.date}</span>
            {x.dDay !== null && <DDay n={x.dDay} />}
            <span className="text-xs text-muted">{x.remindDays}일 전 알림</span>
            {x.notes && <span className={cx('text-xs text-muted', wrapCls)}>{x.notes}</span>}
            <span className="ml-auto flex gap-1">
              <span title={why}>
                <Button size="sm" variant="ghost" onClick={() => onEdit(x)} disabled={!editable} aria-label="경조사 수정">
                  <Pencil size={13} />
                </Button>
              </span>
              <span title={why}>
                <Button size="sm" variant="ghost" onClick={() => onDelete(x)} disabled={!editable} aria-label="경조사 삭제">
                  <Trash2 size={13} />
                </Button>
              </span>
            </span>
          </li>
        ))}
        {!d.birthday && d.anniversaries.length === 0 && <li>
          <Empty title="등록된 경조사가 없습니다" sub="생년월일을 입력하면 생일이 자동으로 나타나고, 결혼기념일 등은 「경조사 추가」로 등록합니다." />
        </li>}
      </ul>
    </Card>
  );
}

function Changes({ d, editable, why }: { d: Detail; editable: boolean; why?: string }) {
  const { now, exec, toast } = useAssistant();
  const [limit, setLimit] = useState(CHANGE_PAGE);
  const c = d.customer;
  const restore = (hid: string, label: string) => {
    const r = exec(c.id, (_s, dd) => restoreChange(dd, hid, now));
    if (isErr(r)) return toast(r.error);
    const v = (r as { value: string }).value;
    const shown = v ? (v.length > 24 ? `${v.slice(0, 24)}…` : v) : '(비어 있음)';
    toast(`「${label}」을(를) 이전 값 ${v ? `'${shown}'` : shown}(으)로 복원했습니다 — 복원도 변경 이력에 남습니다`);
  };
  return (
    <Card>
      <CardHead title="변경 이력" sub="항목이 바뀔 때마다 이전 값과 출처를 남깁니다. 「이전 값으로 복원」은 새 이력으로 남습니다." />
      {d.history.length === 0 ? (
        <Empty title="변경 이력이 없습니다" sub="가상 고객은 등록 이력을 저장하지 않습니다. 항목을 고치면 이 목록에 쌓입니다." />
      ) : (
        <>
          <ul className="divide-y divide-line" data-testid="asst-changes">
            {d.history.slice(0, limit).map((h) => {
              const isField = (FIELD_KEYS as string[]).includes(h.field);
              const cur = isField ? c[h.field as CustomerFieldKey] || '' : '';
              const same = isField && cur === h.oldValue;
              const blockName = h.field === 'name' && !h.oldValue;
              return (
                <li key={h.id} className="px-4 py-3 text-[13px]" data-testid="asst-change-row" data-field={h.field}>
                  <div className="flex flex-wrap items-center gap-2">
                    <b>{h.fieldLabel}</b>
                    <span className="tnum text-xs text-muted">{h.changedAt}</span>
                    <Pill>{h.sourceLabel}</Pill>
                    {isField ? (
                      <span className="ml-auto" title={!editable ? why : same ? '현재 값이 이미 이전 값과 같습니다.' : blockName ? '이름을 빈 값으로 복원할 수 없습니다.' : undefined}>
                        <Button size="sm" onClick={() => restore(h.id, h.fieldLabel)} disabled={!editable || same || blockName} data-testid="asst-restore">
                          <RotateCcw size={13} />
                          이전 값으로 복원
                        </Button>
                      </span>
                    ) : (
                      <Pill className="ml-auto" title="고객 항목이 아니라서 되돌릴 수 없습니다. 담당 영업자는 「수정」에서 다시 바꿉니다." data-testid="asst-change-norestore">
                        복원 대상 아님
                      </Pill>
                    )}
                  </div>
                  <div className="mt-1.5 grid gap-1 sm:grid-cols-2">
                    <p className={cx('rounded-md bg-sunken px-2.5 py-1.5 text-xs', wrapCls)}>
                      <span className="mr-1 font-semibold text-muted">이전</span>
                      {h.oldValue || <span className="text-muted">(비어 있음)</span>}
                    </p>
                    <p className={cx('rounded-md bg-brandsoft/60 px-2.5 py-1.5 text-xs', wrapCls)}>
                      <span className="mr-1 font-semibold text-muted">이후</span>
                      {h.newValue || <span className="text-muted">(비어 있음)</span>}
                    </p>
                  </div>
                  {h.note && <p className={cx('mt-1 text-2xs text-muted', wrapCls)}>{h.note}</p>}
                </li>
              );
            })}
          </ul>
          {d.history.length > limit && (
            <div className="border-t border-line px-4 py-2 text-center">
              <Button size="sm" onClick={() => setLimit((n) => n + CHANGE_PAGE)}>
                이력 더 보기 (남은 {d.history.length - limit}건)
              </Button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
