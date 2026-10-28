// ─────────────────────────────────────────────────────────────
// 시연 초기 데이터 — 모두 가상 (실제 기관·인물·문서 아님)
//  · linked: 제출본 시연 상태 (업무 1, 문서 2, 이벤트 5, 결정 3, 조치 4, 이력 6) — demo-linked.json
//  · fresh : 사용자만 있고 데이터가 빈 상태
// demo-linked.json 은 schema 6 형태이며 migrate()가 현재(7) 구조로 변환한다.
// ─────────────────────────────────────────────────────────────
import type { AppState, User } from '../lib/types';
import { clone } from '../lib/util';
import { migrate } from '../lib/migrate';
import demoLinked from './demo-linked.json';

export const SCHEMA = 7;
const DEPT = '디지털신원팀 (시연용 가상 부서)';

export const USERS: User[] = [
  { id: 'U1', name: '김도윤', dept: DEPT, title: '주무관 · 현 담당', empNo: 'V-1001', role: 'member' },
  { id: 'U2', name: '이서연', dept: DEPT, title: '주무관 · 신규 전입', empNo: 'V-1002', role: 'member' },
];

export function createSeed(mode: 'linked' | 'fresh', now = new Date()): AppState {
  if (mode === 'linked') {
    const base = clone(demoLinked) as unknown as AppState;
    return migrate(base, now);
  }
  return migrate(
    {
      schema: 6,
      seedMode: 'fresh',
      seededAt: now.toISOString(),
      currentUserId: 'U1',
      users: clone(USERS),
      works: [],
      docs: [],
      events: [],
      decisions: [],
      actions: [],
      history: [],
      handovers: [],
      snapshots: [],
      searchLog: [],
      focus: {},
    },
    now,
  );
}
