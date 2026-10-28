import { NEW_WORK, openNewWork } from '../lib/newWork';
import { useEffect } from 'react';
import { useStore, useFocus } from '../lib/store';
import { useRouter } from '../lib/router';
import { Card, inputCls } from '../components/ui';
import { Timeline } from '../components/Timeline';
import { cx } from '../lib/util';

export default function TimelinePage() {
  const { s } = useStore();
  const { query } = useRouter();
  // 선택 업무는 업무 관리·문서함·회의록과 공유
  const [work, setWork] = useFocus();
  useEffect(() => {
    const qw = query.get('work');
    if (qw) setWork(qw);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight">업무 타임라인</h1>
          <p className="text-[13px] text-muted">최초 검토부터 현재까지의 사건을 시간순으로 보여주고, 사건 간 계기·후속 관계를 함께 표시합니다.</p>
        </div>
        <select id="tl-work" className={cx(inputCls, '!w-auto min-w-[240px]')} value={work} onChange={(e) => (e.target.value === NEW_WORK ? openNewWork() : setWork(e.target.value))} aria-label="업무 선택">
          <option value="all">전체 업무</option>
          {s.works.map((w) => (
            <option key={w.id} value={w.id}>
              {w.id} · {w.name}
            </option>
          ))}
          <option value={NEW_WORK}>＋ 새 업무 등록…</option>
        </select>
      </div>
      <Card className="p-4 sm:p-5">
        <Timeline key={work} workId={work} initialEvent={query.get('event') ?? undefined} />
      </Card>
    </div>
  );
}
