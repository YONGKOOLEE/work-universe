// 메뉴 「업무 유니버스」(CR-24 D24-3 ②③): 내 지도 / 우리 팀 · 우리 부 · 본부 · 회사(조직 계층, 사용자 결정 2026-10-29).
// 조직 지도는 모두가 본다 — 남의 업무는 카드에서 읽기 전용. 위 조직을 고르면 아래 조직은 접힌 도형으로 시작한다.
// 화면 시안(2026-10-29): 가+나로 고정 — 밝기를 따라 밝으면 흰 판, 어두우면 우주 판(mapStyle.ts). 시안 고르기 단추 줄은 화면에서 숨겼다(코드는 남김).
// 첫 범위(사용자 결정 2026-10-29 「역할별 조직 범위로 시작」): 팀원·조직장 모두 자기 소속 조직. 소속이 없으면 내 지도.
import { useEffect, useMemo, useState } from 'react';
import { Orbit, Briefcase, Users, AlertTriangle, FileText } from 'lucide-react';
import { useStore } from '../lib/store';
import { Chips } from '../components/ui';
import { cx, today } from '../lib/util';
import { worksInScope, type MapScope } from './derive';
import { effectiveOrgs, myOrgChain, orgShort, worksOfOrg } from '../lib/orgs';
import { MapPanel } from './MapPanel';
import { handoverInsights } from './insights';
import { scopeClass, useEffectiveMapStyle } from './mapStyle';

type Scope = string; // 'mine' | 'org:<조직 ID>' | 'all'

export default function UniversePage() {
  const { s, me } = useStore();
  const style = useEffectiveMapStyle(); // 가+나: 밝으면 흰 판, 어두우면 우주 판
  // 범위 칩: 내 지도 → 내 조직부터 위로(팀 → 부 → 본부 → 회사). 업무가 없는 윗 조직은 뺀다(내 소속 조직은 업무가 없어도 둔다 — 첫 범위이므로). 맨 위 조직이 전체가 아니면 「전체」를 더한다
  const chain = useMemo(() => myOrgChain(s, me.id).map((o) => ({ o, n: worksOfOrg(s, o.id).length })).filter((x, i) => i === 0 || x.n > 0), [s, me.id]);
  const topAll = chain.length > 0 && chain[chain.length - 1].n === s.works.length;
  // 기본 범위: 자기 소속 조직(팀원은 팀, 부장은 부). 소속 조직이 없으면 내 지도
  const defaultScope = chain.length ? `org:${chain[0].o.id}` : 'mine';
  const [scope, setScope] = useState<Scope>(defaultScope);
  useEffect(() => setScope(defaultScope), [me.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // 조직 명령으로 자동 팀(auto: ID)이 저장된 조직(O-###)으로 바뀌면 고른 범위가 없는 ID가 된다 — 「전체」로 되돌린다
  useEffect(() => {
    if (scope.startsWith('org:') && !effectiveOrgs(s).some((o) => o.id === scope.slice(4))) setScope(topAll ? `org:${chain[chain.length - 1].o.id}` : 'all');
  }, [scope, s, topAll, chain]);
  const mapScope: MapScope = useMemo(() => {
    if (scope === 'mine') return { kind: 'mine', userId: me.id };
    if (scope.startsWith('org:') && effectiveOrgs(s).some((o) => o.id === scope.slice(4))) return { kind: 'org', orgId: scope.slice(4) };
    return { kind: 'all', title: '전체 조직' };
  }, [scope, me.id, s]);
  const mineCount = s.works.filter((w) => w.owners.includes(me.id)).length;

  // 시안의 숫자 띠: 이 지도에 든 업무·사람·문서와 인계 위험
  const stats = useMemo(() => {
    if (style === 'basic') return null;
    const works = worksInScope(s, mapScope);
    const ids = new Set(works.map((w) => w.id));
    const people = new Set(works.flatMap((w) => [...w.owners, ...w.ownerHistory.map((p) => p.userId)]));
    const docs = s.docs.filter((d) => d.workIds.some((x) => ids.has(x))).length;
    const r = handoverInsights(s, mapScope, today());
    const high = r.items.filter((x) => x.level === 'high').length;
    return [
      { k: '업무', v: works.length, Icon: Briefcase },
      { k: '사람', v: people.size, Icon: Users },
      { k: '문서', v: docs, Icon: FileText },
      { k: '인계 위험 항목', v: r.items.length, sub: high ? `높음 ${high}` : undefined, Icon: AlertTriangle, warn: high > 0 },
    ];
  }, [style, s, mapScope, me.id]);

  return (
    <div className={cx('space-y-4', scopeClass(style), style === 'clean' && 'space-y-5')} data-map-style={style}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className={cx('flex items-center gap-2 font-bold tracking-tight', style === 'basic' ? 'text-[22px]' : 'text-[24px]')}>
            <Orbit size={22} className="text-brand" /> 업무 유니버스
          </h1>
          <p className="text-[13px] text-muted">업무잇다에 쌓인 업무·사람·문서·조직의 관계를 지도로 넓게 봅니다. 지도에서 고친 내용은 업무 화면에 바로 반영됩니다.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Chips<Scope>
            items={[
              { id: 'mine', label: `내 지도 · 업무 ${mineCount}` },
              ...chain.map(({ o, n }) => ({ id: `org:${o.id}`, label: `${orgShort(o.name)} · 업무 ${n}` })),
              ...(topAll ? [] : [{ id: 'all', label: `전체 · 업무 ${s.works.length}` }]),
            ]}
            value={scope}
            onChange={setScope}
          />
        </div>
      </div>
      {stats && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="map-stats">
          {stats.map((x) => (
            <div key={x.k} className={cx('glass flex items-center gap-3 border px-4 py-3', style === 'clean' ? 'rounded-2xl bg-surface' : 'rounded-xl')}>
              <span className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-full', x.warn ? 'bg-dangersoft text-danger' : 'bg-brandsoft text-brand')}>
                <x.Icon size={17} />
              </span>
              <span className="min-w-0">
                <span className="block text-2xs font-medium text-muted">{x.k}</span>
                <span className="block text-[20px] font-bold leading-tight tnum">
                  {x.v}
                  {x.sub && <span className="ml-1.5 text-2xs font-semibold text-danger">{x.sub}</span>}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
      {mapScope.kind === 'mine' && mineCount === 0 ? (
        <div className="rounded-lg border border-dashed border-line2 bg-surface p-6 text-center text-[13px] text-muted" data-testid="map-empty">
          담당하는 업무가 아직 없습니다. 업무 관리에서 업무를 등록하면 지도가 생깁니다.
        </div>
      ) : (
        <>
          {mapScope.kind !== 'mine' && (
            <p className={cx('px-3 py-2 text-[12.5px] text-ink', style === 'basic' ? 'rounded-md bg-brandsoft/60' : 'glass rounded-xl border')} data-testid="map-expand-hint">
              <b>조직 도형(큰 원, 업무 수)을 두 번 누르면</b> 그 조직의 업무·사람과 아래 조직이 펼쳐집니다. 다시 두 번 누르면 접힙니다. 팀끼리 이어진 업무는 접힌 도형 사이의 선으로 보입니다. 고칠 수 있는 것은 내 담당 업무(조직장은 소속 조직 업무까지)이고, 나머지는 보기와 「나만 보기」 메모만 할 수 있습니다.
            </p>
          )}
          <MapPanel key={scope + me.id} data={s} scope={mapScope} height={640} framed={false} />
        </>
      )}
    </div>
  );
}
