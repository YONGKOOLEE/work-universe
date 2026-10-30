import { StoreProvider } from './lib/store';
import { AIProvider } from './ai/claude';
import { RouterProvider, useRouter } from './lib/router';
import { Layout } from './components/Layout';
import Dashboard from './pages/Dashboard';
import Works from './pages/Works';
import WorkDetail from './pages/WorkDetail';
import Docs from './pages/Docs';
import DocDetail from './pages/DocDetail';
import TimelinePage from './pages/TimelinePage';
import Meetings from './pages/Meetings';
import MeetingDetail from './pages/MeetingDetail';
import SearchPage from './pages/SearchPage';
import Handover from './pages/Handover';
import HandoverDetail from './pages/HandoverDetail';
import SnapshotView from './pages/SnapshotView';
import People from './pages/People';
import UniversePage from './universe/UniversePage';
import AssistantPage from './assistant/ui/AssistantPage';

function Routes() {
  const { path } = useRouter();
  const seg = path.split('/').filter(Boolean);
  switch (seg[0]) {
    case 'works':
      return seg[1] ? <WorkDetail id={seg[1]} /> : <Works />;
    case 'docs':
      return seg[1] ? <DocDetail id={seg[1]} /> : <Docs />;
    case 'timeline':
      return <TimelinePage />;
    case 'meetings':
      return seg[1] ? <MeetingDetail id={seg[1]} /> : <Meetings />;
    case 'search':
      return <SearchPage />;
    case 'handover':
      return seg[1] ? <HandoverDetail id={seg[1]} /> : <Handover />;
    case 'universe':
      return <UniversePage />;
    case 'people':
      return <People />;
    case 'assistant':
      return <AssistantPage />;
    case 'snapshots':
      return <SnapshotView id={seg[1]} />;
    default:
      return <Dashboard />;
  }
}

export default function App() {
  return (
    <StoreProvider>
      <AIProvider>
      <RouterProvider>
        <Layout>
          <Routes />
        </Layout>
      </RouterProvider>
      </AIProvider>
    </StoreProvider>
  );
}
