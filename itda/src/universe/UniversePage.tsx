// 메뉴 「업무 유니버스」(CR-24 D24-3 ②③): 내 지도 / 팀·부서 지도(전체 보기 사용자).
import { useEffect, useMemo, useState } from 'react';
import { Orbit, Lock } from 'lucide-react';
import { useStore } from '../lib/store';
import { Chips } from '../components/ui';
import type { MapScope } from './derive';
import { MapPanel } from './MapPanel';

type Scope = 'mine' | 'all';

export default function UniversePage() {
  const { s, raw, me } = useStore();
  const lead = me.role === 'lead';
  const [scope, setScope] = useState<Scope>(lead ? 'all' : 'mine');
  // 사용자를 바꾸면 그 사람의 기본 범위로(팀장 = 팀·부서 지도, 그 외 = 내 지도)
  useEffect(() => setScope(lead ? 'all' : 'mine'), [me.id, lead]);
  const leads = raw.users.filter((u) => u.role === 'lead');
  const orgName = useMemo(() => {
    const depts = [...new Set(s.works.map((w) => w.dept.replace(/\s*\((?:시연용 )?가상[^)]*\)\s*$/, '').trim()).filter(Boolean))];
    return depts.length === 1 ? depts[0] : '전체 업무';
  }, [s.works]);
  const mapScope: MapScope = useMemo(() => (scope === 'all' && lead ? { kind: 'all', title: orgName } : { kind: 'mine', userId: me.id }), [scope, lead, me.id, orgName]);
  const mineCount = s.works.filter((w) => w.owners.includes(me.id)).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-[22px] font-bold tracking-tight">
            <Orbit size={22} className="text-brand" /> 업무 유니버스
          </h1>
          <p className="text-[13px] text-muted">업무잇다에 쌓인 업무·사람·문서·조직의 관계를 지도로 넓게 봅니다. 지도에서 고친 내용은 업무 화면에 바로 반영됩니다.</p>
        </div>
        <Chips<Scope>
          items={[
            { id: 'mine', label: `내 지도 · 업무 ${mineCount}` },
            { id: 'all', label: lead ? '팀·부서 지도' : '팀·부서 지도 (팀장)' },
          ]}
          value={scope}
          onChange={setScope}
        />
      </div>
      {scope === 'all' && !lead ? (
        <div className="flex items-start gap-3 rounded-lg border border-line bg-surface p-5 text-[13px]" data-testid="map-lead-only">
          <Lock size={18} className="mt-0.5 text-faint" />
          <div>
            <p className="font-semibold">팀·부서 지도는 「전체 보기」 사용자(팀장 역할)만 볼 수 있습니다.</p>
            <p className="mt-1 text-muted">
              업무잇다는 본인이 담당하는 업무만 보이는 것이 원칙입니다. 여러 사람의 업무를 묶어 보는 지도는 전체 보기 사용자에게만 열립니다.
              {leads.length > 0 ? ` 상단 「사용자」에서 ${leads.map((u) => u.name).join('·')}(으)로 바꿔 보세요.` : ' 시연 데이터에는 전체 보기 사용자가 없습니다.'}
            </p>
          </div>
        </div>
      ) : mapScope.kind === 'mine' && mineCount === 0 ? (
        <div className="rounded-lg border border-dashed border-line2 bg-surface p-6 text-center text-[13px] text-muted" data-testid="map-empty">
          담당하는 업무가 아직 없습니다. 업무 관리에서 업무를 등록하면 지도가 생깁니다.
        </div>
      ) : (
        <>
          {mapScope.kind === 'all' && <p className="rounded-md bg-brandsoft/60 px-3 py-2 text-[12.5px] text-ink" data-testid="map-expand-hint"><b>팀 도형(큰 원, ＋숫자)을 두 번 누르면</b> 그 팀의 업무·사람이 펼쳐집니다. 다시 두 번 누르면 접힙니다.</p>}
          <MapPanel key={scope + me.id} data={s} scope={mapScope} height={640} />
        </>
      )}
    </div>
  );
}
