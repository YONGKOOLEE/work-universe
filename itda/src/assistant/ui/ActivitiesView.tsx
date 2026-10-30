// 「활동·요청」 — 미팅·통화 기록, 요청사항, 경조사를 고객 전체에서 모아 본다. 안쪽 구역 3개.
import { useMemo, useState } from 'react';
import { MessageCircleQuestion, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { Button, Card, CardHead, Chips, Empty, inputCls } from '../../components/ui';
import { Link, useRouter } from '../../lib/router';
import { cx } from '../../lib/util';
import { meetingError } from '../followup';
import { deleteAnniversary, deleteInteraction, deleteRequest, isErr, updateRequest } from '../model';
import { listAnniversaries, listInteractions, listRequests } from '../queries';
import { REQUEST_STATUSES, type Anniversary, type CustRequest, type Interaction } from '../types';
import { ActivityFormDialog, AnniversaryFormDialog, ConfirmDialog, RequestFormDialog } from './forms';
import { useAssistant } from './hooks';
import { customerPath, followupPath } from './logic';
import { DDay, Pill, wrapCls } from './shared';

type Sec = 'acts' | 'reqs' | 'anns';
const PAGE = 50;
const NO_RIGHT = '담당 영업자 또는 소속 조직의 조직장만 고칠 수 있습니다.';

export default function ActivitiesView() {
  const { query, replace } = useRouter();
  const secQ = query.get('sec');
  const sec: Sec = secQ === 'reqs' || secQ === 'anns' ? secQ : 'acts';
  return (
    <div className="space-y-4" data-testid="asst-activities">
      <Chips
        items={[
          { id: 'acts' as Sec, label: '활동 기록' },
          { id: 'reqs' as Sec, label: '요청사항' },
          { id: 'anns' as Sec, label: '경조사' },
        ]}
        value={sec}
        onChange={(v) => replace(v === 'acts' ? '/assistant/activities' : `/assistant/activities?sec=${v}`)}
      />
      {sec === 'acts' && <Acts />}
      {sec === 'reqs' && <Reqs />}
      {sec === 'anns' && <Anns />}
    </div>
  );
}

type Del = { kind: 'interaction' | 'request' | 'anniversary'; id: string; customerId: string; label: string } | null;

function useDelete() {
  const { now, exec, toast } = useAssistant();
  const [del, setDel] = useState<Del>(null);
  const run = () => {
    if (!del) return;
    const x = del;
    setDel(null);
    const r = exec(x.customerId, (_s, d) => (x.kind === 'interaction' ? deleteInteraction(d, x.id, now) : x.kind === 'request' ? deleteRequest(d, x.id) : deleteAnniversary(d, x.id)));
    toast(isErr(r) ? r.error : `${x.label}을(를) 지웠습니다`);
  };
  const dialog = (
    <ConfirmDialog open={!!del} onClose={() => setDel(null)} title="삭제 확인" confirmLabel="삭제" danger onConfirm={run} testId="asst-del">
      <p>{del?.label}을(를) 지울까요? 되돌릴 수 없습니다.</p>
    </ConfirmDialog>
  );
  return { setDel, dialog };
}

function Acts() {
  const { a, now, canEdit } = useAssistant();
  const { nav } = useRouter();
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [form, setForm] = useState<{ interaction?: Interaction | null } | null>(null);
  const { setDel, dialog } = useDelete();
  const rows = useMemo(() => listInteractions(a, q), [a, q]);
  return (
    <Card>
      <CardHead
        title="활동 기록"
        sub="미팅·통화·이메일·메모를 모든 고객에서 모아 최근 순으로 봅니다."
        right={
          <Button size="sm" variant="primary" onClick={() => setForm({})} data-testid="asst-act-add">
            <Plus size={13} />
            활동 추가
          </Button>
        }
      />
      <div className="border-b border-line px-4 py-2.5">
        <div className="relative max-w-md">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" aria-hidden="true" />
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setLimit(PAGE);
            }}
            placeholder="제목·요약·고객 이름으로 찾기"
            aria-label="활동 기록 찾기"
            className={cx(inputCls, 'h-9 pl-9')}
            data-testid="asst-act-search"
          />
        </div>
      </div>
      {rows.length === 0 ? (
        <Empty title={q ? '찾은 활동 기록이 없습니다' : '활동 기록이 없습니다'} sub={q ? '찾는 말을 바꿔 보세요.' : '「활동 추가」로 미팅·통화를 기록하세요.'} />
      ) : (
        <ul className="divide-y divide-line">
          {rows.slice(0, limit).map((i) => {
            const ok = canEdit(i.customerId);
            const canAsk = i.type === '미팅' && !meetingError(a, i.id, now);
            return (
              <li key={i.id} className="px-4 py-3 text-[13px]" data-testid="asst-act-row">
                <div className="flex flex-wrap items-center gap-2">
                  <Pill tone={i.type === '미팅' ? 'brand' : 'muted'}>{i.type}</Pill>
                  <span className="tnum text-muted">
                    {i.date}
                    {i.time ? ` ${i.time}` : ''}
                  </span>
                  <Link to={customerPath(i.customerId, 'history')} className="font-semibold text-brand hover:underline">
                    {i.name}
                  </Link>
                  <span className="text-muted">{i.company}</span>
                  <span className="ml-auto flex gap-1">
                    {canAsk && (
                      <span title={ok ? undefined : NO_RIGHT}>
                        <Button size="sm" variant="subtle" onClick={() => nav(followupPath(i.id))}>
                          <MessageCircleQuestion size={13} />
                          미팅 후 질문
                        </Button>
                      </span>
                    )}
                    <span title={ok ? undefined : NO_RIGHT}>
                      <Button size="sm" variant="ghost" disabled={!ok} onClick={() => setForm({ interaction: i })} aria-label={`${i.title} 수정`}>
                        <Pencil size={13} />
                      </Button>
                    </span>
                    <span title={ok ? undefined : NO_RIGHT}>
                      <Button size="sm" variant="ghost" disabled={!ok} onClick={() => setDel({ kind: 'interaction', id: i.id, customerId: i.customerId, label: `활동 기록 「${i.title}」` })} aria-label={`${i.title} 삭제`}>
                        <Trash2 size={13} />
                      </Button>
                    </span>
                  </span>
                </div>
                <p className={cx('mt-1 font-semibold', wrapCls)}>{i.title}</p>
                {i.summary && <p className={cx('mt-0.5 text-muted', wrapCls)}>{i.summary}</p>}
              </li>
            );
          })}
        </ul>
      )}
      {rows.length > limit && (
        <div className="border-t border-line px-4 py-2 text-center">
          <Button size="sm" onClick={() => setLimit((n) => n + PAGE)}>
            더 보기 (남은 {rows.length - limit}건)
          </Button>
        </div>
      )}
      <ActivityFormDialog open={!!form} onClose={() => setForm(null)} interaction={form?.interaction} />
      {dialog}
    </Card>
  );
}

function Reqs() {
  const { a, now, canEdit, exec, toast } = useAssistant();
  const [status, setStatus] = useState('open');
  const [form, setForm] = useState<{ request?: CustRequest | null } | null>(null);
  const { setDel, dialog } = useDelete();
  const rows = useMemo(() => listRequests(a, status, now), [a, status, now]);
  const change = (id: string, cid: string, st: string) => {
    const r = exec(cid, (_s, d) => updateRequest(d, id, { status: st }, now));
    if (isErr(r)) toast(r.error);
  };
  return (
    <Card>
      <CardHead
        title="요청사항"
        sub="처리기한이 가까운 순. 진행 상태를 바로 바꿀 수 있습니다."
        right={
          <Button size="sm" variant="primary" onClick={() => setForm({})} data-testid="asst-req-add">
            <Plus size={13} />
            요청 추가
          </Button>
        }
      />
      <div className="border-b border-line px-4 py-2.5">
        <Chips
          items={[{ id: 'open', label: '미처리' }, { id: '', label: '전체' }, ...REQUEST_STATUSES.map((s) => ({ id: s as string, label: s }))]}
          value={status}
          onChange={setStatus}
        />
      </div>
      {rows.length === 0 ? (
        <Empty title="해당하는 요청사항이 없습니다" sub="고객이 요청한 일을 기록하면 기한 알림과 오늘 할 일에 나타납니다." />
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((r) => {
            const ok = canEdit(r.customerId);
            return (
              <li key={r.id} className="px-4 py-3 text-[13px]" data-testid="asst-req-row">
                <div className="flex flex-wrap items-center gap-2">
                  {r.status !== '완료' && <DDay n={r.dDay} />}
                  <Link to={customerPath(r.customerId, 'requests')} className="font-semibold text-brand hover:underline">
                    {r.name}
                  </Link>
                  <span className="text-muted">{r.company}</span>
                  <span className="tnum text-xs text-muted">{r.dueDate ? `기한 ${r.dueDate}` : '기한 없음'}</span>
                  <span className="ml-auto flex items-center gap-1">
                    <select className={cx(inputCls, 'h-7 !w-auto py-0 text-xs')} value={r.status} disabled={!ok} title={ok ? undefined : NO_RIGHT} onChange={(e) => change(r.id, r.customerId, e.target.value)} aria-label="진행 상태">
                      {REQUEST_STATUSES.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                    <span title={ok ? undefined : NO_RIGHT}>
                      <Button size="sm" variant="ghost" disabled={!ok} onClick={() => setForm({ request: r })} aria-label="요청 수정">
                        <Pencil size={13} />
                      </Button>
                    </span>
                    <span title={ok ? undefined : NO_RIGHT}>
                      <Button size="sm" variant="ghost" disabled={!ok} onClick={() => setDel({ kind: 'request', id: r.id, customerId: r.customerId, label: '요청사항' })} aria-label="요청 삭제">
                        <Trash2 size={13} />
                      </Button>
                    </span>
                  </span>
                </div>
                <p className={cx('mt-1', wrapCls, r.status === '완료' && 'text-muted line-through')}>{r.content}</p>
              </li>
            );
          })}
        </ul>
      )}
      <RequestFormDialog open={!!form} onClose={() => setForm(null)} request={form?.request} />
      {dialog}
    </Card>
  );
}

function Anns() {
  const { a, now, canEdit } = useAssistant();
  const [form, setForm] = useState<{ anniversary?: Anniversary | null } | null>(null);
  const { setDel, dialog } = useDelete();
  const { events, anniversaries } = useMemo(() => listAnniversaries(a, now), [a, now]);
  const [more, setMore] = useState(false);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHead title="다가오는 경조사" sub="앞으로 1년, 가까운 날부터(생일 포함)" />
        {events.length === 0 ? (
          <Empty title="다가오는 경조사가 없습니다" />
        ) : (
          <>
            <ul className="divide-y divide-line">
              {(more ? events : events.slice(0, 15)).map((e, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-[13px]">
                  <DDay n={e.dDay} />
                  <span className="tnum text-muted">{e.date}</span>
                  <Link to={customerPath(e.customerId, 'events')} className="font-semibold text-brand hover:underline">
                    {e.name}
                  </Link>
                  <span className={wrapCls}>{e.label}</span>
                </li>
              ))}
            </ul>
            {events.length > 15 && (
              <div className="border-t border-line px-4 py-2">
                <button className="text-xs font-medium text-brand hover:underline" onClick={() => setMore((v) => !v)}>
                  {more ? '접기' : `나머지 ${events.length - 15}건 더 보기`}
                </button>
              </div>
            )}
          </>
        )}
      </Card>
      <Card>
        <CardHead
          title="등록한 기념일"
          sub="결혼기념일·자녀 일정 등"
          right={
            <Button size="sm" variant="primary" onClick={() => setForm({})} data-testid="asst-ann-add">
              <Plus size={13} />
              경조사 추가
            </Button>
          }
        />
        {anniversaries.length === 0 ? (
          <Empty title="등록한 기념일이 없습니다" sub="생일은 고객 정보의 생년월일에서 자동으로 나타납니다." />
        ) : (
          <ul className="divide-y divide-line">
            {anniversaries.map((x) => {
              const ok = canEdit(x.customerId);
              return (
                <li key={x.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-[13px]" data-testid="asst-ann-row">
                  <Pill tone="brand">{x.kind}</Pill>
                  <Link to={customerPath(x.customerId, 'events')} className="font-semibold text-brand hover:underline">
                    {x.name}
                  </Link>
                  <span className={wrapCls}>{x.label || x.kind}</span>
                  <span className="tnum text-muted">{x.repeatYearly ? `매년 ${x.date.slice(5)}` : x.date}</span>
                  <span className="ml-auto flex gap-1">
                    <span title={ok ? undefined : NO_RIGHT}>
                      <Button size="sm" variant="ghost" disabled={!ok} onClick={() => setForm({ anniversary: x })} aria-label="경조사 수정">
                        <Pencil size={13} />
                      </Button>
                    </span>
                    <span title={ok ? undefined : NO_RIGHT}>
                      <Button size="sm" variant="ghost" disabled={!ok} onClick={() => setDel({ kind: 'anniversary', id: x.id, customerId: x.customerId, label: `경조사 「${x.label || x.kind}」` })} aria-label="경조사 삭제">
                        <Trash2 size={13} />
                      </Button>
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <AnniversaryFormDialog open={!!form} onClose={() => setForm(null)} anniversary={form?.anniversary} />
      {dialog}
    </div>
  );
}
