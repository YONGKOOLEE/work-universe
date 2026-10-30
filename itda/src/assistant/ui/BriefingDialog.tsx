// 미팅 30초 브리핑 — 저장된 고객정보를 규칙으로 정리해 보여 준다(AI·외부 전송 없음). 인쇄 단추가 있다.
import { useMemo } from 'react';
import { Clock, Printer } from 'lucide-react';
import { Button, Empty } from '../../components/ui';
import { cx } from '../../lib/util';
import { buildBriefing, type Tone } from '../briefing';
import { useAssistant } from './hooks';
import { AsstDialog, Avatar, Pill, RuleBadge, wrapCls } from './shared';

const TONE: Record<Tone, string> = { '': 'text-ink', muted: 'text-muted', good: 'text-ok', bad: 'text-danger', warn: 'text-warn' };

export function BriefingDialog({ customerId, interactionId, onClose }: { customerId: string | null; interactionId?: string | null; onClose: () => void }) {
  const { a, now } = useAssistant();
  const b = useMemo(() => (customerId ? buildBriefing(a, customerId, now, interactionId && interactionId !== '1' ? interactionId : null) : null), [a, customerId, interactionId, now]);
  return (
    <AsstDialog
      open={!!customerId}
      onClose={onClose}
      size="lg"
      printable
      testId="asst-briefing"
      title={b ? `미팅 브리핑 — ${b.customer.name} ${b.customer.position}` : '미팅 브리핑'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            닫기
          </Button>
          <Button variant="primary" onClick={() => window.print()} disabled={!b} data-testid="asst-brief-print">
            <Printer size={14} />
            인쇄
          </Button>
        </>
      }
    >
      {!b ? (
        <Empty title="고객을 찾을 수 없습니다" sub="지워졌거나 아직 불러오지 않은 고객입니다." />
      ) : (
        <div className="space-y-4" data-testid="asst-briefing-body">
          <div className="flex flex-wrap items-center gap-3">
            <Avatar id={b.customer.id} name={b.customer.name} />
            <div className="min-w-0 flex-1">
              <p className={cx('text-[15px] font-semibold', wrapCls)}>
                {b.customer.name} <span className="font-normal text-muted">{b.customer.position}</span>
              </p>
              <p className={cx('text-[13px] text-muted', wrapCls)}>{[b.customer.company, b.customer.department].filter(Boolean).join(' · ') || '소속 없음'}</p>
            </div>
            <div className="asst-no-print flex flex-wrap items-center gap-1.5">
              <RuleBadge />
              <Pill tone="muted">
                <Clock size={11} aria-hidden="true" />
                읽는 시간 약 {b.readSeconds}초
              </Pill>
            </div>
          </div>
          {b.meeting ? (
            <p className="rounded-md bg-brandsoft px-3 py-2 text-[13px] text-ink" data-testid="asst-brief-meeting">
              <b>{b.meeting.type}</b> · {b.meeting.date}
              {b.meeting.time ? ` ${b.meeting.time}` : ''} · {b.meeting.title}
            </p>
          ) : (
            <p className="rounded-md bg-sunken px-3 py-2 text-[13px] text-muted">예정된 미팅 기록이 없어 고객 정보만 정리했습니다.</p>
          )}
          <dl className="divide-y divide-line rounded-lg border border-line">
            {b.lines.map((l, i) => (
              <div key={i} className="grid grid-cols-1 gap-0.5 px-3 py-2 text-[13px] sm:grid-cols-[130px_1fr] sm:gap-3">
                <dt className="font-medium text-muted">{l.label}</dt>
                <dd className={cx(wrapCls, TONE[l.tone])}>{l.value}</dd>
              </div>
            ))}
          </dl>
          {b.checks.length > 0 && (
            <section>
              <h3 className="mb-1.5 text-[13px] font-semibold">이번 미팅 확인사항</h3>
              <ul className="list-disc space-y-1 pl-5 text-[13px]">
                {b.checks.map((c, i) => (
                  <li key={i} className={wrapCls}>
                    {c}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {b.openRequests.length > 0 && (
            <section>
              <h3 className="mb-1.5 text-[13px] font-semibold">미처리 요청사항</h3>
              <ul className="space-y-1 text-[13px]">
                {b.openRequests.map((r, i) => (
                  <li key={i} className="flex flex-wrap items-baseline gap-2">
                    <span className={cx('min-w-0 flex-1', wrapCls)}>{r.content}</span>
                    <Pill tone="muted">{r.status}</Pill>
                    {r.due && <Pill tone={r.overdue ? 'danger' : 'muted'}>{r.due}</Pill>}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <p className="text-2xs text-muted">{b.note}</p>
        </div>
      )}
    </AsstDialog>
  );
}
