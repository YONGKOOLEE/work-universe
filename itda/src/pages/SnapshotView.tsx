import { Camera, GitCompare, Lock } from 'lucide-react';
import { useStore, userName, ownerNames } from '../lib/store';
import { useRouter } from '../lib/router';
import { Button, Card, CardHead, Empty, StmtList, StatusBadge, Mono, ProvChip } from '../components/ui';
import { fmtDate, fmtDateTime, dateKey, cx } from '../lib/util';
import { SnapshotMaps } from '../universe/SnapshotMaps';

export default function SnapshotView({ id }: { id: string }) {
  const { s } = useStore();
  const { nav } = useRouter();
  const snap = s.snapshots.find((x) => x.id === id);
  if (!snap) return <Empty title="스냅샷을 찾을 수 없습니다" action={<Button onClick={() => nav('/handover')}>인계 관리</Button>} />;
  const h = s.handovers.find((x) => x.id === snap.handoverId);
  // 인계 후 담당에서 빠진 경우 현재 업무는 볼 수 없으므로 비교를 생략
  const curOrNull = s.works.find((w) => w.id === snap.workId);
  const cur = curOrNull ?? snap.work;
  const w = snap.work;
  const sec = (k: keyof typeof w) => JSON.stringify(w[k]) !== JSON.stringify(cur[k]);
  const diffs = [
    sec('summary') && '업무 요약',
    sec('purpose') && '업무 목적',
    sec('background') && '추진 배경',
    sec('current') && '현재 진행 사항',
    sec('cautions') && '유의사항',
    sec('partners') && '관계부서',
    sec('status') && `진행상태 (${w.status} → ${cur.status})`,
    sec('owners') && `담당자 (${ownerNames(s, w.owners)} → ${ownerNames(s, cur.owners)})`,
    JSON.stringify(snap.decisions.map((d) => d.id)) !== JSON.stringify(s.decisions.filter((d) => d.workId === cur.id).map((d) => d.id)) && '결정사항',
    JSON.stringify(snap.actions.map((a) => [a.id, a.status, a.due])) !== JSON.stringify(s.actions.filter((a) => a.workId === cur.id).map((a) => [a.id, a.status, a.due])) && '조치사항',
    snap.docs.length !== s.docs.filter((d) => d.workIds.includes(cur.id)).length && '관련 문서',
  ].filter(Boolean) as string[];
  const events = [...snap.events].filter((e) => e.source !== 'record').sort((a, b) => dateKey(a.date).localeCompare(dateKey(b.date)));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-navy/30 bg-navy px-4 py-3 text-surface">
        <Camera size={18} />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold">인계 당시 스냅샷 · 읽기 전용</p>
          <p className="text-xs opacity-80">
            {h?.id} · {fmtDateTime(snap.takenAt)} 보존 · 업무정보 v{snap.version} · {h && `${userName(s, h.fromId)} → ${userName(s, h.toId)}`}
          </p>
        </div>
        <Lock size={16} className="opacity-70" />
      </div>

      {!curOrNull && <Card className="px-4 py-3 text-[13px] text-muted">현재 이 업무의 담당자가 아니어서 현재 업무정보와의 비교는 표시하지 않습니다.</Card>}
      {curOrNull && (
      <Card className={cx('px-4 py-3', diffs.length ? 'border-warn/40' : 'border-ok/40')}>
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <GitCompare size={16} className={diffs.length ? 'text-warn' : 'text-ok'} />
          <b>현재 업무정보(v{cur.version})와 비교:</b>
          {diffs.length ? (
            <>
              <span>인계 이후 {diffs.length}개 영역 변경</span>
              {diffs.map((d) => (
                <span key={d} className="rounded bg-warnsoft px-1.5 text-2xs font-semibold text-warn">
                  {d}
                </span>
              ))}
            </>
          ) : (
            <span className="text-muted">변경 없음</span>
          )}
          <Button size="sm" className="ml-auto" onClick={() => nav(`/works/${cur.id}`)}>
            현재 업무 보기
          </Button>
        </div>
      </Card>
      )}

      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-[22px] font-bold tracking-tight">{w.name}</h1>
          <StatusBadge status={w.status} />
          <Mono>{w.id}</Mono>
        </div>
        <p className="mt-1 text-[13px] text-muted">
          {w.summary} · 당시 담당 {ownerNames(s, w.owners)}
        </p>
      </div>

      {curOrNull && (
        <Card className="p-4">
          <CardHead title="업무 지도로 비교 — 인계 당시 ↔ 지금" sub="담당 선의 점선은 끝난 담당(전 담당)입니다. 인계 뒤 늘거나 끝난 할 일·문서를 한눈에 봅니다." />
          <div className="pt-3">
            <SnapshotMaps snap={snap} s={s} />
          </div>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHead title="업무 목적" />
          <div className="px-4 py-3"><StmtList items={w.purpose} /></div>
          <CardHead title="추진 배경" />
          <div className="px-4 py-3"><StmtList items={w.background} /></div>
          <CardHead title="현재 진행 사항 (인계 당시)" />
          <div className="px-4 py-3"><StmtList items={w.current} /></div>
        </Card>
        <div className="space-y-5">
          <Card>
            <CardHead title="결정사항 (인계 당시)" sub={`${snap.decisions.length}건`} />
            <ul className="divide-y divide-line">
              {snap.decisions.map((d) => (
                <li key={d.id} className="px-4 py-2.5 text-[13px]">
                  <span className="mr-2 font-mono text-xs text-muted">{fmtDate(d.date)}</span>
                  {d.title} <ProvChip prov={d.prov} compact />
                </li>
              ))}
              {!snap.decisions.length && <li className="px-4 py-3 text-xs text-muted">없음</li>}
            </ul>
          </Card>
          <Card>
            <CardHead title="조치사항 (인계 당시)" />
            <ul className="divide-y divide-line">
              {snap.actions.map((a) => (
                <li key={a.id} className="flex gap-2 px-4 py-2 text-[13px]">
                  <span className={cx('rounded px-1 text-2xs font-semibold', a.status === '완료' ? 'bg-oksoft text-ok' : 'bg-sunken text-muted')}>{a.status}</span>
                  <span className="flex-1">{a.title}</span>
                  <span className="text-2xs text-muted tnum">{a.due ? fmtDate(a.due) : '기한 미지정'}</span>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <CardHead title="유의사항 (인계 당시)" />
            <div className="px-4 py-3"><StmtList items={w.cautions} /></div>
          </Card>
          <Card>
            <CardHead title="관련 문서 · 추진 경과 (인계 당시)" />
            <ul className="divide-y divide-line">
              {snap.docs.map((d) => (
                <li key={d.id} className="flex items-center gap-2 px-4 py-2 text-[13px]">
                  <span className="flex-1">{d.title}</span>
                  <span className="text-2xs text-muted">{d.type}</span>
                </li>
              ))}
              {events.map((e) => (
                <li key={e.id} className="flex items-center gap-2 px-4 py-2 text-[13px]">
                  <span className="w-[100px] whitespace-nowrap font-mono text-xs text-muted">{fmtDate(e.date)}</span>
                  <span className="flex-1">{e.title}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
