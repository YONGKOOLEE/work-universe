// AI 비서 — 왼쪽 메뉴 「AI 비서」 한 곳. 안쪽 탭: 오늘 · 고객 · 활동·요청 · 대화 분석 · 묻기, 설정은 머리글의 작은 대화상자.
import { useState } from 'react';
import { Settings } from 'lucide-react';
import { Button } from '../../components/ui';
import { useRouter } from '../../lib/router';
import ActivitiesView from './ActivitiesView';
import AnalyzeView from './AnalyzeView';
import AskView from './AskView';
import CustomerDetail from './CustomerDetail';
import CustomersView from './CustomersView';
import FollowupView from './FollowupView';
import { useAssistant, useUnreadCount } from './hooks';
import { SettingsDialog } from './SettingsDialog';
import { TabsBar } from './shared';
import TodayView from './TodayView';

type TabId = 'today' | 'customers' | 'activities' | 'analyze' | 'ask';
const TO: Record<TabId, string> = { today: '/assistant', customers: '/assistant/customers', activities: '/assistant/activities', analyze: '/assistant/analyze', ask: '/assistant/ask' };

export default function AssistantPage() {
  const { path, nav } = useRouter();
  const { a } = useAssistant();
  const unread = useUnreadCount();
  const [settings, setSettings] = useState(false);
  const seg = path.split('/').filter(Boolean); // ['assistant', sub?, id?]
  const sub = seg[1] ?? '';
  const tab: TabId = sub === 'customers' || sub === 'followup' ? 'customers' : sub === 'activities' ? 'activities' : sub === 'analyze' ? 'analyze' : sub === 'ask' ? 'ask' : 'today';

  return (
    <div className="space-y-5" data-testid="asst-page">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[22px] font-bold tracking-tight">AI 비서</h1>
          <p className="max-w-3xl text-[13px] text-muted">
            고객 메모를 모아 미팅 준비와 안부 연락을 돕습니다. 오늘 할 일·브리핑·검색은 규칙으로 계산하며 밖으로 보내지 않습니다. 대화 분석과 질문 해석에서만 Claude를 쓸 수 있고(선택), 저장은 승인한 항목만 합니다.
          </p>
        </div>
        <Button onClick={() => setSettings(true)} data-testid="asst-settings-open">
          <Settings size={14} />
          설정
        </Button>
      </div>

      <TabsBar
        tabs={[
          { id: 'today' as TabId, label: '오늘', count: unread || undefined },
          { id: 'customers' as TabId, label: '고객', count: a.customers.length },
          { id: 'activities' as TabId, label: '활동·요청' },
          { id: 'analyze' as TabId, label: '대화 분석' },
          { id: 'ask' as TabId, label: '묻기' },
        ]}
        value={tab}
        onChange={(t) => nav(TO[t])}
      />

      {sub === '' && <TodayView />}
      {sub === 'customers' && (seg[2] ? <CustomerDetail id={seg[2]} /> : <CustomersView />)}
      {sub === 'followup' && seg[2] && <FollowupView interactionId={seg[2]} />}
      {sub === 'activities' && <ActivitiesView />}
      {sub === 'analyze' && <AnalyzeView />}
      {sub === 'ask' && <AskView />}
      {!['', 'customers', 'followup', 'activities', 'analyze', 'ask'].includes(sub) && <TodayView />}
      <SettingsDialog open={settings} onClose={() => setSettings(false)} />
    </div>
  );
}
