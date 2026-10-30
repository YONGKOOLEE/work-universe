// ─────────────────────────────────────────────────────────────
// 시연 초기 데이터 — 모두 가상 (실제 기관·인물·문서 아님)
//  · linked: 시연 상태 — demo-linked.json(업무 1) + demo-org.ts(가상 조직: 팀 2·사용자 7·업무 8)
//  · fresh : 사용자만 있고 데이터가 빈 상태
// demo-linked.json 은 schema 6 형태이며 migrate()가 현재(7) 구조로 변환한다.
// ─────────────────────────────────────────────────────────────
import type { AppState, User } from '../lib/types';
import { clone } from '../lib/util';
import { migrate } from '../lib/migrate';
import { emptyAssistant } from '../assistant/model';
import demoLinked from './demo-linked.json';
import { extendLinked } from './demo-org';

export const SCHEMA = 7;
const DEPT = '디지털신원팀 (시연용 가상 부서)';

export const USERS: User[] = [
  { id: 'U1', name: '김도윤', dept: DEPT, title: '주무관 · 현 담당', empNo: 'V-1001', role: 'member' },
  { id: 'U2', name: '이서연', dept: DEPT, title: '주무관 · 신규 전입', empNo: 'V-1002', role: 'member' },
];

export function createSeed(mode: 'linked' | 'fresh', now = new Date()): AppState {
  if (mode === 'linked') {
    const base = clone(demoLinked) as unknown as AppState;
    return extendLinked(migrate(base, now));
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
      // 빈 상태에는 가상 고객도 채우지 않는다(AI 비서 칸을 비어 있는 채로 둔다 — migrate가 「칸 없음」을 처음 열기로 보고 채우지 않게)
      assistant: emptyAssistant(),
    },
    now,
  );
}
