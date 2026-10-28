// 인계 당시 지도 ↔ 지금 지도(CR-24 D24-6 b): 스냅샷의 업무·결정·조치·이벤트로 그때의 업무 지도를 다시 그려 지금과 나란히 본다.
import { useMemo, useState } from 'react';
import type { AppState, Snapshot } from '../lib/types';
import { deriveMap, type MapScope } from './derive';
import { MapLegend, MapView, useMapView } from './MapView';

function SideMap({ title, sub, data, workId, testid }: { title: string; sub: string; data: AppState; workId: string; testid: string }) {
  const scope: MapScope = useMemo(() => ({ kind: 'work', workId }), [workId]);
  const derived = useMemo(() => deriveMap(data, scope), [data, scope]);
  const view = useMapView(derived);
  const [selected, setSelected] = useState<string | null>(null);
  const people = view.nodes.filter((n: any) => n.core_type === 'person' && !n.hidden).length;
  const todo = view.nodes.filter((n: any) => n.core_type === 'work' && n.subtype === '할 일').length;
  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-[13px] font-semibold">{title}</h4>
        <span className="text-2xs text-faint">
          {sub} · 사람 {people} · 남은 할 일 {todo}
        </span>
      </div>
      <MapView derived={derived} view={view} expanded={new Set()} selected={selected} onSelect={setSelected} height={340} testid={testid} />
      <MapLegend view={view} />
    </div>
  );
}

export function SnapshotMaps({ snap, s }: { snap: Snapshot; s: AppState }) {
  // 인계 당시: 스냅샷의 업무(그때 담당 기간 포함)와 그때의 결정·조치·이벤트·문서. 인계 기록은 아직 확정 전이었으므로 넣지 않는다
  const then = useMemo<AppState>(() => {
    const docIds = new Set(snap.docs.map((d) => d.id));
    return {
      ...s,
      works: [snap.work],
      decisions: snap.decisions,
      actions: snap.actions,
      events: snap.events,
      docs: s.docs.filter((d) => docIds.has(d.id)).map((d) => ({ ...d, workIds: [snap.workId] })),
      handovers: [],
      mapHidden: [],
    };
  }, [snap, s]);
  const now = useMemo<AppState>(() => ({ ...s, mapHidden: [] }), [s]);
  return (
    <div className="grid gap-4 lg:grid-cols-2" data-testid="snapshot-maps">
      <SideMap title="인계 당시 지도" sub={`v${snap.version}`} data={then} workId={snap.workId} testid="snapshot-map-then" />
      <SideMap title="지금 지도" sub={`v${s.works.find((w) => w.id === snap.workId)?.version ?? '-'}`} data={now} workId={snap.workId} testid="snapshot-map-now" />
    </div>
  );
}
