// 메뉴 「업무 유니버스」(CR-24 D24-3 ②③): 내 지도 / 팀·부서 지도. 팀·부서 지도는 모두가 본다(사용자 결정 2026-10-29) — 남의 업무는 카드에서 읽기 전용.
// 화면 시안(2026-10-29): 기본 · 가 우주 · 나 정돈 — 앱 틀은 그대로, 이 공간만 바뀐다(mapStyle.ts).
import { useEffect, useMemo, useState } from 'react';
import { Orbit, Briefcase, Users, AlertTriangle, FileText } from 'lucide-react';
import { useStore } from '../lib/store';
import { Chips } from '../components/ui';
import { cx, today } from '../lib/util';
import type { MapScope } from './derive';
import { MapPanel } from './MapPanel';
import { handoverInsights } from './insights';
import { MAP_STYLES, scopeClass, useMapStyle } from './mapStyle';

type Scope = 'mine' | 'all';

export default function UniversePage() {
  const { s, me } = useStore();
  const lead = me.role === 'lead';
  const [style, setStyle] = useMapStyle();
  const [scope, setScope] = useState<Scope>(lead ? 'all' : 'mine');
  // 사용자를 바꾸면 그 사람의 기본 범위로(팀장 = 팀·부서 지도, 그 외 = 내 지도)
  useEffect(() => setScope(lead ? 'all' : 'mine'), [me.id, lead]);
  const orgName = useMemo(() => {
    const depts = [...new Set(s.works.map((w) => w.dept.replace(/\s*\((?:시연용 )?가상[^)]*\)\s*$/, '').trim()).filter(Boolean))];
    return depts.length === 1 ? depts[0] : '팀·부서 전체';
  }, [s.works]);
  const mapScope: MapScope = useMemo(() => (scope === 'all' ? { kind: 'all', title: orgName } : { kind: 'mine', userId: me.id }), [scope, me.id, orgName]);
  const mineCount = s.works.filter((w) => w.owners.includes(me.id)).length;

  // 시안의 숫자 띠: 이 지도에 든 업무·사람·문서와 인계 위험
  const stats = useMemo(() => {
    if (style === 'basic') return null;
    const works = mapScope.kind === 'all' ? s.works : s.works.filter((w) => w.owners.includes(me.id));
    const ids = new Set(works.map((w) => w.id));
    const people = new Set(works.flatMap((w) => [...w.owners, ...w.ownerHistory.map((p) => p.userId)]));
    const docs = s.docs.filter((d) => d.workIds.some((x) => ids.has(x))).length;
    const r = handoverInsights(s, mapScope, today());
    const high = r.items.filter((x) => x.level === 'high').length;
    return [
      { k: '업무', v: works.length, Icon: Briefcase },
      { k: '사람', v: people.size, Icon: Users },
      { k: '문서', v: docs, Icon: FileText },
      { k: '인계 위험', v: r.items.length, sub: high ? `높음 ${high}` : undefined, Icon: AlertTriangle, warn: high > 0 },
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
              { id: 'all', label: `팀·부서 지도 · 업무 ${s.works.length}` },
            ]}
            value={scope}
            onChange={setScope}
          />
          <div className="flex items-center gap-1 rounded-full border border-line bg-surface p-0.5 text-2xs" role="radiogroup" aria-label="화면 시안" data-testid="map-style">
            <span className="px-1.5 font-semibold text-faint">시안</span>
            {MAP_STYLES.map((x) => (
              <button
                key={x.id}
                role="radio"
                aria-checked={style === x.id}
                onClick={() => setStyle(x.id)}
                className={cx('rounded-full px-2 py-0.5 font-medium', style === x.id ? 'bg-brand text-onbrand' : 'text-muted hover:text-ink')}
                data-testid={`map-style-${x.id}`}
              >
                {x.label}
              </button>
            ))}
          </div>
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
          {mapScope.kind === 'all' && (
            <p className={cx('px-3 py-2 text-[12.5px] text-ink', style === 'basic' ? 'rounded-md bg-brandsoft/60' : 'glass rounded-xl border')} data-testid="map-expand-hint">
              <b>팀 도형(큰 원, ＋숫자)을 두 번 누르면</b> 그 팀의 업무·사람이 펼쳐집니다. 다시 두 번 누르면 접힙니다. 내 업무가 아닌 것은 보기와 「나만 보기」 메모만 할 수 있습니다.
            </p>
          )}
          <MapPanel key={scope + me.id} data={s} scope={mapScope} height={640} framed={false} />
        </>
      )}
    </div>
  );
}
