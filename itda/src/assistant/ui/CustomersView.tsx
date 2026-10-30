// 「고객」 목록 — 찾기·유형 거르기·정렬, 표/카드 중 하나, 고객 등록.
import { useEffect, useMemo, useState } from 'react';
import { LayoutGrid, Plus, Rows3, Search, Users } from 'lucide-react';
import { Button, Card, Chips, Empty, inputCls } from '../../components/ui';
import { Link, useRouter } from '../../lib/router';
import { cx } from '../../lib/util';
import { listCustomers, type CustomerRow, type CustomerSort } from '../queries';
import { CUSTOMER_TYPES } from '../types';
import { CustomerFormDialog } from './forms';
import { useAssistant } from './hooks';
import { customerPath, ownerLabel } from './logic';
import { Avatar, Pill, wrapCls } from './shared';

const PAGE = 50;
const LAYOUT_KEY = 'itda-assistant-layout';
const SORTS: { id: CustomerSort; label: string }[] = [
  { id: 'name', label: '이름순' },
  { id: 'recent', label: '최근 수정순' },
  { id: 'contact', label: '오래 연락 안 한 순' },
  { id: 'company', label: '소속순' },
];

function initialLayout(): 'table' | 'card' {
  try {
    const v = localStorage.getItem(LAYOUT_KEY);
    if (v === 'table' || v === 'card') return v;
  } catch {
    /* 저장소를 못 쓰면 기본값 */
  }
  return typeof window !== 'undefined' && window.innerWidth < 640 ? 'card' : 'table';
}

export default function CustomersView() {
  const { a, raw, userId } = useAssistant();
  const { nav, query, replace } = useRouter();
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [sort, setSort] = useState<CustomerSort>('name');
  const [mine, setMine] = useState(false);
  const [layout, setLayoutState] = useState<'table' | 'card'>(initialLayout);
  const [limit, setLimit] = useState(PAGE);
  const [formOpen, setFormOpen] = useState(false);
  const setLayout = (v: 'table' | 'card') => {
    setLayoutState(v);
    try {
      localStorage.setItem(LAYOUT_KEY, v);
    } catch {
      /* 보기 방식은 저장하지 못해도 된다 */
    }
  };

  // 바로 찾기의 「고객 추가」(?new=1): 창을 열고 주소의 new 값은 지운다(새로 고침해도 다시 안 열리게)
  const wantNew = query.get('new') === '1';
  useEffect(() => {
    if (wantNew) {
      setFormOpen(true);
      replace('/assistant/customers');
    }
  }, [wantNew]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => setLimit(PAGE), [q, type, sort, mine]);

  const rows = useMemo(() => {
    const r = listCustomers(a, { q, type, sort });
    return mine ? r.filter((x) => x.ownerId === userId) : r;
  }, [a, q, type, sort, mine, userId]);
  const typeCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of a.customers) m[c.customerType || '기타'] = (m[c.customerType || '기타'] ?? 0) + 1;
    return m;
  }, [a.customers]);
  const shown = rows.slice(0, limit);

  return (
    <div className="space-y-4" data-testid="asst-customers">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1 sm:max-w-md">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" aria-hidden="true" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="이름·소속·직책·관심사로 찾기"
            aria-label="고객 찾기"
            className={cx(inputCls, 'h-9 pl-9')}
            data-testid="asst-cust-search"
          />
        </div>
        <select className={cx(inputCls, 'h-9 !w-auto py-0')} value={sort} onChange={(e) => setSort(e.target.value as CustomerSort)} aria-label="정렬" data-testid="asst-cust-sort">
          {SORTS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <div className="flex rounded-md border border-line2" role="group" aria-label="보기 방식">
          <button
            className={cx('flex h-9 items-center gap-1 rounded-l-md px-2.5 text-xs font-medium', layout === 'table' ? 'bg-navy text-surface' : 'text-muted hover:bg-sunken')}
            onClick={() => setLayout('table')}
            aria-pressed={layout === 'table'}
            data-testid="asst-layout-table"
          >
            <Rows3 size={14} />표
          </button>
          <button
            className={cx('flex h-9 items-center gap-1 rounded-r-md px-2.5 text-xs font-medium', layout === 'card' ? 'bg-navy text-surface' : 'text-muted hover:bg-sunken')}
            onClick={() => setLayout('card')}
            aria-pressed={layout === 'card'}
            data-testid="asst-layout-card"
          >
            <LayoutGrid size={14} />
            카드
          </button>
        </div>
        <Button variant="primary" className="ml-auto" onClick={() => setFormOpen(true)} data-testid="asst-cust-add">
          <Plus size={15} />
          고객 등록
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Chips
          items={[{ id: '', label: '전체', count: a.customers.length }, ...CUSTOMER_TYPES.map((t) => ({ id: t as string, label: t, count: typeCounts[t] ?? 0 }))]}
          value={type}
          onChange={setType}
        />
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} data-testid="asst-cust-mine" />
          내 담당만
        </label>
        <span className="ml-auto text-[13px] text-muted" data-testid="asst-cust-count" aria-live="polite">
          {rows.length}명{rows.length !== a.customers.length ? ` (전체 ${a.customers.length}명)` : ''}
        </span>
      </div>

      {rows.length === 0 ? (
        <Card>
          <Empty
            icon={<Users size={28} />}
            title={a.customers.length ? '찾은 고객이 없습니다' : '아직 고객이 없습니다'}
            sub={a.customers.length ? '찾는 말이나 거르기를 바꿔 보세요.' : '「고객 등록」으로 첫 고객을 추가하세요. 설정에서 가상 고객 18명을 다시 채울 수도 있습니다.'}
          />
        </Card>
      ) : layout === 'table' ? (
        <Card className="overflow-x-auto scroll-thin">
          <table className="w-full min-w-[820px] text-[13px]">
            <thead>
              <tr className="border-b border-line bg-sunken/70 text-left text-xs text-muted">
                <th className="px-4 py-2 font-semibold">이름</th>
                <th className="px-3 py-2 font-semibold">소속</th>
                <th className="px-3 py-2 font-semibold">유형</th>
                <th className="px-3 py-2 font-semibold">담당</th>
                <th className="px-3 py-2 font-semibold">최근 연락</th>
                <th className="px-3 py-2 text-right font-semibold">미처리 요청</th>
                <th className="px-4 py-2 text-right font-semibold">빈 항목</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {shown.map((c) => (
                <tr key={c.id} className="cursor-pointer hover:bg-sunken/50" onClick={() => nav(customerPath(c.id))} data-testid="asst-cust-row" data-id={c.id}>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <Avatar id={c.id} name={c.name} size="sm" />
                      <span className={cx('min-w-0', wrapCls)}>
                        <Link to={customerPath(c.id)} className="font-semibold text-brand hover:underline">
                          {c.name}
                        </Link>
                        <span className="ml-1.5 text-muted">{c.position}</span>
                        {c.isDemo && <Pill className="ml-1.5">가상</Pill>}
                      </span>
                    </div>
                  </td>
                  <td className={cx('px-3 py-2.5', wrapCls)}>{[c.company, c.department].filter(Boolean).join(' · ') || <span className="text-muted">-</span>}</td>
                  <td className="px-3 py-2.5">{c.customerType ? <Pill>{c.customerType}</Pill> : <span className="text-muted">-</span>}</td>
                  <td className="px-3 py-2.5">{ownerLabel(raw, c.ownerId)}</td>
                  <td className="px-3 py-2.5 tnum">{c.lastContactDate || <span className="text-muted">기록 없음</span>}</td>
                  <td className="px-3 py-2.5 text-right tnum">{c.openRequests ? <Pill tone="warn">{c.openRequests}</Pill> : <span className="text-muted">0</span>}</td>
                  <td className="px-4 py-2.5 text-right tnum">{c.missing ? c.missing : <span className="text-muted">0</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 min-[2000px]:grid-cols-4">
          {shown.map((c) => (
            <CustomerCard key={c.id} c={c} owner={ownerLabel(raw, c.ownerId)} onOpen={() => nav(customerPath(c.id))} />
          ))}
        </div>
      )}
      {rows.length > limit && (
        <div className="flex justify-center">
          <Button onClick={() => setLimit((n) => n + PAGE)} data-testid="asst-cust-more">
            더 보기 (남은 {rows.length - limit}명)
          </Button>
        </div>
      )}
      <CustomerFormDialog open={formOpen} onClose={() => setFormOpen(false)} onSaved={(id) => nav(customerPath(id))} />
    </div>
  );
}

function CustomerCard({ c, owner, onOpen }: { c: CustomerRow; owner: string; onOpen: () => void }) {
  return (
    <Card className="cursor-pointer p-4 transition-colors hover:bg-sunken/40" onClick={onOpen} data-testid="asst-cust-row" data-id={c.id}>
      <div className="flex items-start gap-3">
        <Avatar id={c.id} name={c.name} />
        <div className="min-w-0 flex-1">
          <p className={cx('text-[14px]', wrapCls)}>
            <Link to={customerPath(c.id)} className="font-semibold text-brand hover:underline">
              {c.name}
            </Link>
            <span className="ml-1.5 text-muted">{c.position}</span>
          </p>
          <p className={cx('text-xs text-muted', wrapCls)}>{[c.company, c.department].filter(Boolean).join(' · ') || '소속 없음'}</p>
        </div>
        {c.isDemo && <Pill>가상</Pill>}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
        {c.customerType && <Pill>{c.customerType}</Pill>}
        {c.openRequests > 0 && <Pill tone="warn">미처리 요청 {c.openRequests}</Pill>}
        {c.missing > 0 && <Pill tone="muted">빈 항목 {c.missing}</Pill>}
      </div>
      <dl className="mt-3 space-y-0.5 text-xs">
        <div className="flex gap-2">
          <dt className="w-[56px] shrink-0 text-muted">담당</dt>
          <dd className={wrapCls}>{owner}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-[56px] shrink-0 text-muted">최근 연락</dt>
          <dd className="tnum">{c.lastContactDate || '기록 없음'}</dd>
        </div>
        {c.recentInterests && (
          <div className="flex gap-2">
            <dt className="w-[56px] shrink-0 text-muted">관심</dt>
            <dd className={wrapCls}>{c.recentInterests}</dd>
          </div>
        )}
      </dl>
    </Card>
  );
}
