// 「오늘」 화면 — 오늘 할 일, 다음 할 일 추천, 이번 주 미팅, 기한 임박, 경조사, 장기 미연락, 미팅 후 질문 대기, 알림.
import { useMemo, useState } from 'react';
import { Bell, CalendarClock, CalendarHeart, CheckCheck, ClipboardList, Hourglass, ListTodo, MessageCircleQuestion, Sparkles, Users } from 'lucide-react';
import { Button, Card, CardHead, Empty } from '../../components/ui';
import { useRouter } from '../../lib/router';
import { cx } from '../../lib/util';
import { markAllNoticesRead, markNoticeRead, computeNotices, NOTICE_KIND_LABEL } from '../notices';
import { pending } from '../followup';
import { buildToday } from '../today';
import { BriefingDialog } from './BriefingDialog';
import { useAssistant, useViewScope } from './hooks';
import { SCOPE_NAMES, type ViewScope } from '../scope';
import { customerPath, followupPath, noticePath } from './logic';
import { DDay, Pill, RuleBadge, wrapCls } from './shared';

const SHOW_NO_CONTACT = 8;

function Who({ id, name, sub }: { id: string; name: string; sub?: string }) {
  const { nav } = useRouter();
  return (
    <button onClick={() => nav(customerPath(id))} className="text-left font-semibold text-brand hover:underline">
      {name}
      {sub ? <span className="ml-1 font-normal text-muted">{sub}</span> : null}
    </button>
  );
}

const SCOPE_HINT: Record<ViewScope, string> = {
  mine: '내가 담당 영업자인 고객만 보입니다.',
  org: '내 조직(아래 조직 포함) 담당자의 고객이 보입니다.',
  all: '모든 담당자의 고객이 보입니다.',
};

/** 오늘·알림·메뉴 숫자가 볼 고객 범위를 고른다(기본 내 담당. 조직장은 내 조직 전체, 누구나 전체 보기) */
function ScopeBar({ sc }: { sc: ReturnType<typeof useViewScope> }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-[13px]" data-testid="asst-scope" data-value={sc.scope}>
      <span className="text-muted">보는 범위</span>
      <div className="flex rounded-md border border-line2" role="group" aria-label="보는 범위">
        {sc.choices.map((id, i) => (
          <button
            key={id}
            type="button"
            onClick={() => sc.setScope(id)}
            aria-pressed={sc.scope === id}
            data-testid={`asst-scope-${id}`}
            className={cx('h-8 px-3 text-xs font-medium', i === 0 && 'rounded-l-md', i === sc.choices.length - 1 && 'rounded-r-md', sc.scope === id ? 'bg-navy text-surface' : 'text-muted hover:bg-sunken')}
          >
            {SCOPE_NAMES[id]}
          </button>
        ))}
      </div>
      <span className="text-xs text-muted">{SCOPE_HINT[sc.scope]}</span>
    </div>
  );
}

export default function TodayView() {
  const { a, now, exec, userId, raw } = useAssistant();
  const sc = useViewScope();
  const { nav } = useRouter();
  const [brief, setBrief] = useState<{ customerId: string; interactionId?: string } | null>(null);
  const [moreNo, setMoreNo] = useState(false);
  const t = useMemo(() => buildToday(sc.view, now), [sc.view, now]);
  const notices = useMemo(() => computeNotices(a, now, { userId, ids: sc.ids }), [a, now, userId, sc.ids]);
  const waiting = useMemo(() => pending(sc.view, now), [sc.view, now]);
  const unread = notices.filter((n) => !n.read).length;
  const todayMeetings = t.meetings.filter((m) => m.date === t.today);
  const todoCount = t.todayRequests.length + todayMeetings.length;

  // 읽음 표시는 사용자별로 저장한다(같은 브라우저를 여러 사람이 써도 서로의 읽음에 영향이 없다)
  const readOne = (key: string) => exec(null, (s, d) => (markNoticeRead(d, key, now, s.currentUserId), { ok: true }));
  const readAll = () => exec(null, (s, d) => (markAllNoticesRead(d, now, { userId: s.currentUserId, ids: sc.ids }), { ok: true }));

  if (!a.customers.length)
    return (
      <Card>
        <Empty
          icon={<Users size={28} />}
          title="아직 고객이 없습니다"
          sub="「고객」 탭에서 고객을 등록하면 오늘 할 일·알림·미팅 브리핑이 여기에 나타납니다. 설정에서 가상 고객 18명을 다시 채울 수도 있습니다."
          action={
            <Button variant="primary" onClick={() => nav('/assistant/customers?new=1')}>
              고객 등록
            </Button>
          }
        />
      </Card>
    );

  // 고른 범위에 고객이 없으면(예: 담당 고객이 없는 사람) 그 사실과 전체 보기 안내
  if (!sc.view.customers.length)
    return (
      <div className="space-y-4" data-testid="asst-today">
        <ScopeBar sc={sc} />
        <Card data-testid="asst-today-noowned">
          <Empty
            icon={<Users size={28} />}
            title={sc.scope === 'mine' ? `${raw.users.find((u) => u.id === userId)?.name ?? '지금 사용자'}님이 담당하는 고객이 없습니다` : '이 범위에는 고객이 없습니다'}
            sub={`오늘 할 일·알림은 고른 범위의 고객만 보여 줍니다. 「전체 보기」로 바꾸면 등록된 고객 ${sc.total}명의 일정을 모두 볼 수 있습니다.`}
            action={
              <Button variant="primary" onClick={() => sc.setScope('all')} data-testid="asst-scope-goall">
                전체 보기
              </Button>
            }
          />
        </Card>
      </div>
    );

  return (
    <div className="space-y-5" data-testid="asst-today">
      <ScopeBar sc={sc} />
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
        <span>
          {t.today} 기준 · 고객 <b className="text-ink tnum">{t.total}</b>명{sc.scope !== 'all' && sc.total !== t.total ? ` (전체 ${sc.total}명 중)` : ''}
        </span>
        {Object.entries(t.byType)
          .filter(([, n]) => n > 0)
          .map(([k, n]) => (
            <Pill key={k}>
              {k} {n}
            </Pill>
          ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-5">
          <Card data-testid="asst-today-todo">
            <CardHead icon={<ListTodo size={16} />} title="오늘 할 일" sub={`오늘 기한이 된 요청과 오늘 미팅 ${todoCount}건`} />
            {todoCount === 0 ? (
              <p className="px-4 py-4 text-[13px] text-muted">오늘 기한이 된 요청이나 미팅이 없습니다.</p>
            ) : (
              <ul className="divide-y divide-line">
                {todayMeetings.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-[13px]">
                    <Pill tone="brand">미팅</Pill>
                    <span className="tnum text-muted">{m.time || '시간 미정'}</span>
                    <span className={cx('min-w-0 flex-1', wrapCls)}>
                      <Who id={m.customerId} name={m.name} sub={m.position} /> · {m.title}
                    </span>
                    <Button size="sm" onClick={() => setBrief({ customerId: m.customerId, interactionId: m.id })}>
                      브리핑
                    </Button>
                  </li>
                ))}
                {t.todayRequests.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-[13px]">
                    <Pill tone="warn">요청</Pill>
                    <DDay n={r.dDay} />
                    <span className={cx('min-w-0 flex-1', wrapCls)}>
                      <Who id={r.customerId} name={r.name} sub={r.position} /> · {r.content}
                    </span>
                    <Pill>{r.status}</Pill>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card data-testid="asst-today-recs">
            <CardHead
              icon={<Sparkles size={16} />}
              title="다음 할 일 추천"
              sub="기한이 지난 요청 → 가까운 미팅 준비·예정 연락일 → 경조사 → 장기 미연락 순으로 규칙에 따라 고릅니다."
              right={<RuleBadge />}
            />
            {t.recommendations.length === 0 ? (
              <p className="px-4 py-4 text-[13px] text-muted">지금 추천할 일이 없습니다.</p>
            ) : (
              <ul className="divide-y divide-line">
                {t.recommendations.map((r, i) => (
                  <li key={i} className="px-4 py-2.5 text-[13px]" data-testid="asst-rec">
                    <div className="flex flex-wrap items-center gap-2">
                      <Pill tone={r.priority === 1 ? 'danger' : r.priority === 2 ? 'warn' : r.priority === 3 ? 'brand' : 'muted'}>{['', '먼저', '곧', '챙기기', '여유 있을 때'][r.priority] ?? '참고'}</Pill>
                      <Who id={r.customerId} name={r.name} />
                    </div>
                    <p className={cx('mt-1', wrapCls)}>{r.text}</p>
                    <p className={cx('mt-0.5 text-xs text-muted', wrapCls)}>근거: {r.reason}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card data-testid="asst-today-meetings">
            <CardHead icon={<CalendarClock size={16} />} title="이번 주 미팅" sub="오늘부터 7일 안의 예정 미팅" />
            {t.meetings.length === 0 ? (
              <p className="px-4 py-4 text-[13px] text-muted">이번 주 예정된 미팅이 없습니다.</p>
            ) : (
              <ul className="divide-y divide-line">
                {t.meetings.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-[13px]">
                    <span className="w-[92px] shrink-0 tnum text-muted">
                      {m.date.slice(5)} {m.time}
                    </span>
                    <span className={cx('min-w-0 flex-1', wrapCls)}>
                      <Who id={m.customerId} name={m.name} sub={m.position} /> · {m.title}
                    </span>
                    <Button size="sm" onClick={() => setBrief({ customerId: m.customerId, interactionId: m.id })}>
                      브리핑
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card data-testid="asst-today-soon">
            <CardHead icon={<Hourglass size={16} />} title="기한 임박 요청" sub="7일 안에 기한이 오는 미처리 요청" />
            {t.soonRequests.length === 0 ? (
              <p className="px-4 py-4 text-[13px] text-muted">기한이 임박한 요청이 없습니다.</p>
            ) : (
              <ul className="divide-y divide-line">
                {t.soonRequests.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-[13px]">
                    <DDay n={r.dDay} />
                    <span className={cx('min-w-0 flex-1', wrapCls)}>
                      <Who id={r.customerId} name={r.name} sub={r.position} /> · {r.content}
                    </span>
                    <Pill>{r.status}</Pill>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card data-testid="asst-notices">
            <CardHead
              icon={<Bell size={16} />}
              title={
                <span className="flex items-center gap-2">
                  알림
                  <Pill tone={unread ? 'danger' : 'muted'} data-testid="asst-notices-unread">
                    안 읽음 {unread}
                  </Pill>
                </span>
              }
              sub="이 화면을 연 동안만 표시됩니다(Windows·브라우저 알림은 없음)."
              right={
                <Button size="sm" onClick={readAll} disabled={!unread} data-testid="asst-notices-readall">
                  <CheckCheck size={13} />
                  모두 읽음
                </Button>
              }
            />
            {notices.length === 0 ? (
              <p className="px-4 py-4 text-[13px] text-muted">지금 알릴 일이 없습니다.</p>
            ) : (
              <ul className="max-h-[420px] divide-y divide-line overflow-y-auto scroll-thin">
                {notices.slice(0, 40).map((n) => (
                  <li key={n.key} className={cx('px-4 py-2.5 text-[13px]', !n.read && 'bg-brandsoft/40')} data-testid="asst-notice" data-read={n.read ? '1' : '0'}>
                    <div className="flex flex-wrap items-center gap-2">
                      {!n.read && <span className="h-2 w-2 shrink-0 rounded-full bg-brand" aria-label="안 읽음" />}
                      <Pill tone={n.kind === 'request' ? 'warn' : n.kind === 'followup' ? 'infer' : 'brand'}>{NOTICE_KIND_LABEL[n.kind]}</Pill>
                      <span className="tnum text-xs text-muted">{n.eventDate}</span>
                      <span className="ml-auto flex gap-1">
                        <Button
                          size="sm"
                          variant="subtle"
                          onClick={() => {
                            readOne(n.key);
                            nav(noticePath(n.link));
                          }}
                          data-testid="asst-notice-go"
                        >
                          이동
                        </Button>
                        {!n.read && (
                          <Button size="sm" variant="ghost" onClick={() => readOne(n.key)} data-testid="asst-notice-read">
                            읽음
                          </Button>
                        )}
                      </span>
                    </div>
                    <p className={cx('mt-1 font-medium', wrapCls)}>{n.title}</p>
                    {n.body && <p className={cx('text-xs text-muted', wrapCls)}>{n.body}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card data-testid="asst-today-followups">
            <CardHead icon={<MessageCircleQuestion size={16} />} title="미팅 후 질문 대기" sub="끝난 미팅에서 비어 있는 고객 정보를 짧게 묻습니다. 답하지 않은 항목은 저장되지 않습니다." />
            {waiting.length === 0 ? (
              <p className="px-4 py-4 text-[13px] text-muted">답하지 않은 최근 미팅이 없습니다.</p>
            ) : (
              <ul className="divide-y divide-line">
                {waiting.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-[13px]" data-testid="asst-fu-wait">
                    <span className="tnum text-muted">{m.date.slice(5)}</span>
                    <span className={cx('min-w-0 flex-1', wrapCls)}>
                      <Who id={m.customerId} name={m.name} sub={m.position} /> · {m.title}
                    </span>
                    <Button size="sm" variant="subtle" onClick={() => nav(followupPath(m.id))}>
                      질문 답하기
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card data-testid="asst-today-events">
            <CardHead icon={<CalendarHeart size={16} />} title="30일 안 경조사" sub="생일과 등록한 기념일" />
            {t.events.length === 0 ? (
              <p className="px-4 py-4 text-[13px] text-muted">30일 안에 다가오는 경조사가 없습니다.</p>
            ) : (
              <ul className="divide-y divide-line">
                {t.events.map((e, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-[13px]">
                    <DDay n={e.dDay} />
                    <span className="tnum text-muted">{e.date.slice(5)}</span>
                    <span className={cx('min-w-0 flex-1', wrapCls)}>
                      <Who id={e.customerId} name={e.name} sub={e.position} /> · {e.label}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card data-testid="asst-today-nocontact">
            <CardHead icon={<ClipboardList size={16} />} title="장기 미연락" sub={`${t.noContactDays}일 이상 연락 기록이 없는 고객`} />
            {t.noContact.length === 0 ? (
              <p className="px-4 py-4 text-[13px] text-muted">오래 연락하지 못한 고객이 없습니다.</p>
            ) : (
              <>
                <ul className="divide-y divide-line">
                  {(moreNo ? t.noContact : t.noContact.slice(0, SHOW_NO_CONTACT)).map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-[13px]">
                      <span className={cx('min-w-0 flex-1', wrapCls)}>
                        <Who id={c.id} name={c.name} sub={c.position} />
                        {c.company && <span className="text-muted"> · {c.company}</span>}
                      </span>
                      <Pill tone={c.days === null ? 'warn' : 'muted'}>{c.days === null ? '기록 없음' : `${c.days}일`}</Pill>
                    </li>
                  ))}
                </ul>
                {t.noContact.length > SHOW_NO_CONTACT && (
                  <div className="border-t border-line px-4 py-2">
                    <button className="text-xs font-medium text-brand hover:underline" onClick={() => setMoreNo((v) => !v)}>
                      {moreNo ? '접기' : `나머지 ${t.noContact.length - SHOW_NO_CONTACT}명 더 보기`}
                    </button>
                  </div>
                )}
              </>
            )}
          </Card>
        </div>
      </div>
      <BriefingDialog customerId={brief?.customerId ?? null} interactionId={brief?.interactionId} onClose={() => setBrief(null)} />
    </div>
  );
}
