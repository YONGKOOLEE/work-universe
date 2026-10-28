// 업무 상세 「업무 지도」 탭(CR-24 D24-3 ①): 이 업무를 지도 중심으로 담당자(기간)·문서·할 일·주제·관계 기관·이어진 업무를 그린다.
import { useMemo } from 'react';
import { useStore } from '../lib/store';
import { MapPanel } from './MapPanel';
import type { MapScope } from './derive';

export function WorkMap({ workId }: { workId: string }) {
  const { s } = useStore();
  const scope: MapScope = useMemo(() => ({ kind: 'work', workId }), [workId]);
  return (
    <div className="space-y-2">
      <p className="text-[12.5px] text-muted">이 업무를 중심으로 담당자(담당 기간)·문서·남은 조치·주제·관계 기관·이어진 업무를 지도로 봅니다. 여러 업무를 함께 보려면 메뉴 「업무 유니버스」로 가세요.</p>
      <MapPanel data={s} scope={scope} height={520} showRisk={false} testid="itda-workmap" />
    </div>
  );
}
