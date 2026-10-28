import { NEW_WORK, openNewWork } from '../lib/newWork';
import { useEffect } from 'react';
import { ScrollText, CheckCircle2, MinusCircle } from 'lucide-react';
import { useStore, useFocus } from '../lib/store';
import { useRouter } from '../lib/router';
import { Card, CardHead, inputCls, Empty } from '../components/ui';
import { fmtDate, cx, dateKey } from '../lib/util';

export default function Meetings() {
  const { s } = useStore();
  const { nav, query } = useRouter();
  // 선택 업무는 업무 관리·문서함·타임라인과 공유
  const [work, setWork] = useFocus();
  useEffect(() => {
    const qw = query.get('work');
    if (qw) setWork(qw);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const w = s.works.find((x) => x.id === work);
  // 회의록 = 문서함에 '회의록' 유형으로 등록된 문서
  const minutes = s.docs.filter((d) => d.type === '회의록').sort((a, b) => dateKey(b.writtenAt || '0').localeCompare(dateKey(a.writtenAt || '0')));
  const linked = w ? minutes.filter((d) => d.workIds.includes(w.id)) : minutes;
  const excluded = w ? minutes.filter((d) => !d.workIds.includes(w.id) && d.relevance?.some((r) => r.workId === w.id && r.level === 'none')) : [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight">회의록</h1>
          <p className="text-[13px] text-muted">회의록을 업무별로 조회하고, 원문과 AI 분석을 나란히 비교합니다. 문서함에 '회의록' 유형으로 등록한 문서도 함께 표시됩니다.</p>
        </div>
        <select id="mt-work" className={cx(inputCls, '!w-auto min-w-[240px]')} value={work} onChange={(e) => (e.target.value === NEW_WORK ? openNewWork() : setWork(e.target.value))} aria-label="업무 선택">
          <option value="all">전체 회의록 ({minutes.length})</option>
          {s.works.map((x) => (
            <option key={x.id} value={x.id}>
              {x.id} · {x.name} ({minutes.filter((d) => d.workIds.includes(x.id)).length})
            </option>
          ))}
          <option value={NEW_WORK}>＋ 새 업무 등록…</option>
        </select>
      </div>

      {w && linked.length === 0 && (
        <Card>
          <Empty
            icon={<ScrollText size={26} />}
            title={`'${w.name}' 업무에 연결된 회의록이 없습니다`}
            sub={`문서함에서 문서 유형을 '회의록'으로 등록하고 이 업무를 연결하면 여기에 표시됩니다.`}
          />
        </Card>
      )}
      {!w && minutes.length === 0 && (
        <Card>
          <Empty icon={<ScrollText size={26} />} title="볼 수 있는 회의록이 없습니다" />
        </Card>
      )}

      {linked.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {linked.map((d) => {
            const r = w ? d.relevance?.find((x) => x.workId === w.id) : undefined;
            const linkedNames = d.workIds.map((id) => s.works.find((x) => x.id === id)?.name).filter(Boolean);
            return (
              <button key={d.id} onClick={() => nav(`/meetings/${d.id}`)} className="rounded-lg border border-line bg-surface p-4 text-left shadow-card hover:border-brand/50">
                <div className="flex items-center gap-2">
                  <ScrollText size={16} className="shrink-0 text-brand" />
                  <span className="text-[15px] font-semibold">{d.title}</span>
                </div>
                <p className="mt-1 text-xs text-muted tnum">
                  {`${fmtDate(d.writtenAt)} · ${d.source}${d.paragraphs ? ` · 문단 ${d.paragraphs.length}개` : ''}`}
                </p>
                <div className="mt-3 border-t border-line pt-3 text-[13px]">
                  <span className="text-xs text-muted">연결 업무</span>
                  <div className="mt-1">
                    {linkedNames.length ? (
                      <span className="inline-flex items-center gap-1 rounded bg-factsoft px-1.5 py-0.5 text-xs font-semibold text-fact"><CheckCircle2 size={13} />{linkedNames.join(', ')}</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded bg-sunken px-1.5 py-0.5 text-xs font-semibold text-muted"><MinusCircle size={13} />연결 업무 없음</span>
                    )}
                  </div>
                  {r && <p className="mt-1 text-xs text-muted">{r.reason}</p>}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {w && excluded.length > 0 && (
        <Card className="border-dashed">
          <CardHead title="AI가 검토 후 제외한 회의록" sub={`'${w.name}' 업무 기준으로 분석했으나 직접 관련성이 없다고 판단해 연결하지 않은 회의록`} />
          <ul className="divide-y divide-line">
            {excluded.map((d) => {
              const r = d.relevance?.find((x) => x.workId === w.id);
              return (
                <li key={d.id}>
                  <button onClick={() => nav(`/meetings/${d.id}`)} className="flex w-full flex-wrap items-center gap-2 px-4 py-2.5 text-left text-[13px] hover:bg-sunken/60">
                    <ScrollText size={14} className="text-faint" />
                    <span className="font-medium">{d.title}</span>
                    <span className="text-xs text-muted">— {r?.reason}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

    </div>
  );
}
