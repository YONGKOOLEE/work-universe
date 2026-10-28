import { useState } from 'react';
import { ArrowRightLeft, Plus, Camera, Info } from 'lucide-react';
import { useStore, userName, ownerNames } from '../lib/store';
import { useRouter } from '../lib/router';
import { Button, Card, CardHead, Field, inputCls, Mono } from '../components/ui';
import type { Handover as HO, HandoverStatus } from '../lib/types';
import { fmtDate, cx, today, nextId } from '../lib/util';

export const HO_STATUS: Record<HandoverStatus, { label: string; cls: string }> = {
  draft: { label: '인계 준비', cls: 'bg-sunken text-muted' },
  submitted: { label: '인수자 검토 대기', cls: 'bg-brandsoft text-brand' },
  revision: { label: '보완 요청', cls: 'bg-warnsoft text-warn' },
  accepted: { label: '인수 확인 · 확정 대기', cls: 'bg-infersoft text-infer' },
  confirmed: { label: '인계 확정', cls: 'bg-oksoft text-ok' },
};

export default function Handover() {
  const { s, raw, update, me, toast } = useStore();
  const { query, nav } = useRouter();
  const preset = query.get('new');
  // 인계는 본인이 현재 담당자인 업무에 대해서만 시작할 수 있음
  const mine = s.works.filter((w) => w.owners.includes(me.id));
  const [work, setWork] = useState(preset && mine.some((w) => w.id === preset) ? preset : mine[0]?.id ?? '');
  const w = mine.find((x) => x.id === work) ?? mine[0];
  const candidates = w ? s.users.filter((u) => !w.owners.includes(u.id)) : [];
  const [toSel, setTo] = useState('');
  const to = candidates.some((u) => u.id === toSel) ? toSel : candidates[0]?.id ?? '';
  const [base, setBase] = useState(today());
  // 남의 업무에서 「인계 시작」으로 들어온 경우(처음 사용 점검 2026-10-29): 현재 담당자만 시작할 수 있음을 알린다
  const presetOther = preset && !mine.some((x) => x.id === preset) ? s.works.find((x) => x.id === preset) ?? null : null;
  const activeForWork = w && raw.handovers.find((h) => h.workId === w.id && h.fromId === me.id && h.status !== 'confirmed');

  const create = () => {
    if (!w || !to) return;
    const id = nextId('HO', raw.handovers.map((x) => x.id));
    const now = new Date().toISOString();
    const h: HO = {
      id,
      workId: w.id,
      fromId: me.id,
      toId: to,
      baseDate: base,
      status: 'draft',
      step: 2,
      precheckDone: false,
      checklist: { overview: false, progress: false, decisions: false, partners: false },
      supplement: '',
      fromLeaves: null,
      requests: [],
      log: [{ at: now, byId: s.currentUserId, text: `인계 대상 업무 선택: ${w.name}` }],
      createdAt: now,
    };
    update((d) => {
      d.handovers.push(h);
    });
    toast(`${id} 인계를 시작했습니다`);
    nav(`/handover/${id}`);
  };

  const list = [...s.handovers].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold tracking-tight">업무 인계 관리</h1>
        <p className="max-w-3xl text-[13px] text-muted">
          별도의 인수인계서를 작성하지 않습니다. 업무 상세 화면 자체가 인계 자료이며, 인사이동 시에는 그 정보가 정확하고 최신인지 확인한 뒤 인계·인수를 확정합니다. 확정 시점의 업무정보는 스냅샷으로 보존됩니다.
        </p>
      </div>

      {presetOther && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-warn/40 bg-warnsoft px-4 py-3 text-[13px]" data-testid="handover-not-owner">
          <span className="flex-1">
            「{presetOther.name}」은(는) 지금 담당자({presetOther.owners.map((o) => s.users.find((u) => u.id === o)?.name ?? o).join('·')})만 인계를 시작할 수 있습니다. 인계는 넘기는 사람이 시작하고, 받는 사람이 확인합니다.
          </span>
          {presetOther.owners[0] && (
            <Button
              size="sm"
              onClick={() =>
                update((d) => {
                  d.currentUserId = presetOther.owners[0];
                })
              }
              data-testid="handover-switch-owner"
            >
              {s.users.find((u) => u.id === presetOther.owners[0])?.name}(으)로 전환
            </Button>
          )}
        </div>
      )}
      <div className="grid gap-5 lg:grid-cols-[1fr_1.6fr]">
      <Card className={presetOther ? 'self-start opacity-50' : 'self-start'} aria-disabled={!!presetOther}>
          <CardHead icon={<Plus size={16} />} title="새 인계 시작" sub={presetOther ? '위 안내대로 담당자로 전환하면 그 업무로 시작합니다' : '1단계 · 인계 대상 업무 선택'} />
          <div className="space-y-3 px-4 py-4">
            {!w ? (
              <p className="rounded-md bg-sunken px-3 py-3 text-[13px] text-muted">현재 사용자({me.name})가 담당자로 지정된 업무가 없어 인계를 시작할 수 없습니다.</p>
            ) : (
            <>
            <Field label="인계 대상 업무 (내가 담당 중인 업무)" htmlFor="ho-work">
              <select id="ho-work" className={inputCls} value={w.id} onChange={(e) => setWork(e.target.value)}>
                {mine.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.id} · {x.name}
                  </option>
                ))}
              </select>
            </Field>
            <p className="text-xs text-muted">현재 담당자: {ownerNames(s, w.owners)}</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="인계자">
                <div className={cx(inputCls, 'bg-sunken')}>{me.name}</div>
              </Field>
              <Field label="인수자" htmlFor="ho-to">
                <select id="ho-to" className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} disabled={!candidates.length}>
                  {candidates.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                  {!candidates.length && <option value="">지정 가능한 인수자 없음</option>}
                </select>
              </Field>
            </div>
            <Field label="인계 기준일" htmlFor="ho-base">
              <input id="ho-base" type="date" className={inputCls} value={base} onChange={(e) => setBase(e.target.value)} />
            </Field>
            {activeForWork ? (
              <p className="flex items-start gap-2 rounded-md bg-warnsoft px-3 py-2 text-xs text-warn">
                <Info size={14} className="mt-0.5 shrink-0" />
                이 업무는 진행 중인 인계({activeForWork.id})가 있습니다.
                <button className="font-semibold underline" onClick={() => nav(`/handover/${activeForWork.id}`)}>
                  이어서 진행
                </button>
              </p>
            ) : (
              <Button variant="primary" className="w-full" onClick={create} disabled={!to}>
                <ArrowRightLeft size={15} />
                인계 시작
              </Button>
            )}
            {!candidates.length && <p className="text-2xs text-faint">모든 사용자가 이미 이 업무의 담당자입니다.</p>}
            </>
            )}
          </div>
        </Card>

        <Card className="min-w-0 overflow-x-auto scroll-thin">
          <CardHead title="인계 기록" sub={`${list.length}건`} />
          <table className="w-full min-w-[620px] text-[13px]">
            <thead>
              <tr className="border-b border-line bg-sunken/60 text-left text-xs text-muted">
                <th className="px-4 py-2.5 font-semibold">인계 ID · 업무</th>
                <th className="px-3 py-2.5 font-semibold">인계자 → 인수자</th>
                <th className="px-3 py-2.5 font-semibold">기준일</th>
                <th className="px-3 py-2.5 font-semibold">상태</th>
                <th className="px-3 py-2.5 font-semibold">스냅샷</th>
              </tr>
            </thead>
            <tbody>
              {list.map((h) => (
                <tr key={h.id} className="cursor-pointer border-b border-line last:border-0 hover:bg-sunken/50" onClick={() => nav(`/handover/${h.id}`)}>
                  <td className="px-4 py-3">
                    <Mono>{h.id}</Mono>
                    <div className="font-medium">{raw.works.find((w) => w.id === h.workId)?.name}</div>
                  </td>
                  <td className="px-3 py-3">
                    {userName(s, h.fromId)} → {userName(s, h.toId)}
                  </td>
                  <td className="px-3 py-3 text-muted tnum">{fmtDate(h.baseDate)}</td>
                  <td className="px-3 py-3">
                    <span className={cx('rounded px-1.5 py-0.5 text-2xs font-semibold', HO_STATUS[h.status].cls)}>{HO_STATUS[h.status].label}</span>
                  </td>
                  <td className="px-3 py-3">
                    {h.snapshotId ? (
                      <button
                        className="inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline"
                        onClick={(e) => {
                          e.stopPropagation();
                          nav(`/snapshots/${h.snapshotId}`);
                        }}
                      >
                        <Camera size={13} />
                        조회
                      </button>
                    ) : (
                      <span className="text-2xs text-faint">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
