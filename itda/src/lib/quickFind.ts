// 상단 「바로 찾기」(사용자 결정 2026-10-29): 업무 질문이 아니라 메뉴·기능·업무·문서·사람을 이름으로 바로 찾는다.
// 순수 함수 — DOM·저장소 없음. 업무·문서·사람은 넘겨받은 상태(보기 범위로 걸러진 s)에 있는 것만 찾고, 「나만 보기」 메모는 읽지 않는다.
import type { AppState } from './types';
import { displayName, roleLabel } from './people';
import { effectiveOrgs, orgPathText } from './orgs';

export type QFKind = 'menu' | 'action' | 'work' | 'doc' | 'person';
export type ActionId = 'data' | 'merge' | 'new-work' | 'ai-settings' | 'ai-engine' | 'theme';

export interface QFItem {
  kind: QFKind;
  key: string;
  title: string;
  /** 보조 설명: 업무면 담당·상태, 문서면 유형·작성일·연결 업무, 사람이면 조직·직위 */
  sub: string;
  /** 화면 이동 경로(메뉴·업무·문서·사람, 일부 기능) */
  to?: string;
  /** 창 열기 등 동작(기능) */
  action?: ActionId;
  keywords: string[];
  /** ID로도 찾는다(업무 W-001, 문서 D-101) */
  id?: string;
}

export const KIND_LABEL: Record<QFKind, string> = { menu: '메뉴', action: '기능', work: '업무', doc: '문서', person: '사람' };
export const KIND_ORDER: QFKind[] = ['menu', 'action', 'work', 'doc', 'person'];
export const KIND_LIMIT: Record<QFKind, number> = { menu: 10, action: 9, work: 6, doc: 6, person: 6 };

/** 메뉴: Layout 왼쪽 목록과 같은 화면 */
const MENUS: { to: string; title: string; sub: string; keywords: string[] }[] = [
  { to: '/dashboard', title: '대시보드', sub: '진행 현황과 점검할 일', keywords: ['홈', '현황', '첫 화면'] },
  { to: '/works', title: '업무 관리', sub: '업무 목록과 상세', keywords: ['업무 목록', '업무 상세'] },
  { to: '/docs', title: '문서함', sub: '등록한 문서 모음', keywords: ['문서 목록', '보고서', '자료'] },
  { to: '/timeline', title: '업무 타임라인', sub: '시간 순서로 보는 경과', keywords: ['타임라인', '경과', '이력', '연표'] },
  { to: '/meetings', title: '회의록', sub: '회의록 모음', keywords: ['회의', '미팅'] },
  { to: '/search', title: 'AI 업무 검색', sub: '업무에 대해 질문하기', keywords: ['질문', '물어보기', 'AI 검색', '검색'] },
  { to: '/handover', title: '업무 인계 관리', sub: '인수인계 진행과 확정', keywords: ['인수인계', '인계', '인수'] },
  { to: '/universe', title: '업무 유니버스', sub: '업무 관계 지도', keywords: ['지도', '유니버스', '관계도', '맵'] },
  { to: '/people', title: '사람', sub: '사람과 조직도', keywords: ['사람·조직', '조직', '조직도', '구성원', '팀원', '직원'] },
  { to: '/assistant', title: 'AI 비서', sub: '고객 메모·오늘 할 일·미팅 브리핑', keywords: ['고객', '고객관리', '영업', '영업비서', '미팅 브리핑', '브리핑', '알림', '비서'] },
];

/** 기능: 실제로 여는 방법이 있는 것만. 되돌릴 수 없는 동작(초기화 등)은 넣지 않는다 */
const ACTIONS: { action?: ActionId; to?: string; title: string; sub: string; keywords: string[] }[] = [
  { action: 'data', title: '데이터 옮기기', sub: '백업 내보내기 · 불러오기 창 열기', keywords: ['백업', '내보내기', '불러오기', '가져오기', '옮기기', '저장', '복원'] },
  { action: 'merge', title: '합쳐 불러오기', sub: '동료 백업을 내 지도에 합치기(불러오기 탭)', keywords: ['합치기', '합쳐', '동료 데이터', '팀 지도', '병합', '불러오기'] },
  { action: 'new-work', title: '새 업무 등록', sub: '새 업무 만들기 창 열기', keywords: ['업무 추가', '업무 만들기', '업무 등록', '신규 업무'] },
  { to: '/docs?new=1', title: '문서 등록', sub: '문서함에서 문서 등록 창 열기', keywords: ['문서 추가', '문서 올리기', '업로드', '파일 등록', '문서 분석'] },
  { action: 'ai-settings', title: 'AI 설정', sub: 'Claude API 키·모델', keywords: ['키', 'API 키', '모델', 'claude', '클로드', 'api'] },
  { action: 'ai-engine', title: 'AI 엔진 바꾸기', sub: '상단의 규칙 · Claude · 사내 칸에서 고름', keywords: ['엔진', '규칙', 'claude', '클로드', '사내', '사내 AI', '모드'] },
  { action: 'theme', title: '밝기 바꾸기', sub: '화면 자동 → 밝게 → 어둡게', keywords: ['테마', '다크', '다크모드', '어둡게', '밝게', '야간', '화면 모드', '배경'] },
  { to: '/handover', title: '인계 시작', sub: '업무 인계 관리에서 인계 시작', keywords: ['인수인계 시작', '인계하기', '인계 만들기', '인수인계'] },
  { to: '/assistant/customers?new=1', title: '고객 추가', sub: 'AI 비서에서 고객 등록 창 열기', keywords: ['고객 등록', '고객 만들기', '신규 고객', '고객 입력'] },
];

const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';

/** 공백 제거·소문자 */
export function norm(t: string): string {
  return String(t ?? '').replace(/\s+/g, '').toLowerCase();
}

/** 글자별 초성(한글 음절이 아니면 그대로) */
export function choseong(t: string): string {
  let out = '';
  for (const ch of norm(t)) {
    const c = ch.charCodeAt(0);
    out += c >= 0xac00 && c <= 0xd7a3 ? CHO[Math.floor((c - 0xac00) / 588)] : ch;
  }
  return out;
}

const isJamoOnly = (q: string) => q.length > 0 && [...q].every((ch) => CHO.includes(ch));

/** 질문처럼 보이는지(AI 업무 검색 줄을 보여 줄 때) */
export function looksLikeQuestion(q: string): boolean {
  const t = q.trim();
  if (t.length < 2) return false;
  if (/[?？]\s*$/.test(t)) return true;
  if (/(뭐|무엇|언제|누가|누구|어떻게|어떤|왜|얼마|알려|인가요|입니까|할까|인지|어때|있나|없나|경과|이유|차이)/.test(t)) return true;
  return t.split(/\s+/).length >= 4;
}

/** 낮을수록 먼저. 0 ID 일치, 1 제목 앞부분, 2 제목 포함, 3 별칭, 4 초성. 못 찾으면 null */
export function scoreItem(it: QFItem, query: string): number | null {
  const q = norm(query);
  if (!q) return null;
  const title = norm(it.title);
  if (it.id && norm(it.id).startsWith(q) && q.length >= 2) return 0;
  if (title.startsWith(q)) return 1;
  if (title.includes(q)) return 2;
  if (it.keywords.some((k) => norm(k).includes(q))) return 3;
  if (isJamoOnly(q) && choseong(it.title).includes(q)) return 4;
  return null;
}

/** 찾을 수 있는 전체 항목. s는 보기 범위로 걸러진 상태(useStore().s)를 넘긴다 */
export function buildItems(s: AppState): QFItem[] {
  const items: QFItem[] = [];
  for (const m of MENUS) items.push({ kind: 'menu', key: 'menu:' + m.to, title: m.title, sub: m.sub, to: m.to, keywords: m.keywords });
  for (const a of ACTIONS) items.push({ kind: 'action', key: 'action:' + (a.action ?? a.to), title: a.title, sub: a.sub, to: a.to, action: a.action, keywords: a.keywords });

  const userName = (id: string) => displayName(s.users.find((u) => u.id === id), id);
  for (const w of s.works) {
    items.push({
      kind: 'work',
      key: 'work:' + w.id,
      id: w.id,
      title: w.name,
      sub: `${w.owners.map(userName).join('·') || '담당 미정'} · ${w.status}`,
      to: `/works/${w.id}`,
      keywords: [...w.keywords, w.type, w.dept, ...w.owners.map(userName)],
    });
  }
  for (const d of s.docs) {
    const linked = d.workIds.map((id) => s.works.find((w) => w.id === id)?.name).filter(Boolean) as string[];
    items.push({
      kind: 'doc',
      key: 'doc:' + d.id,
      id: d.id,
      title: d.title,
      sub: [d.type, d.writtenAt ? d.writtenAt.slice(0, 10) : '', linked.length ? `연결 업무: ${linked.slice(0, 2).join(', ')}${linked.length > 2 ? ` 외 ${linked.length - 2}` : ''}` : '연결 업무 없음'].filter(Boolean).join(' · '),
      to: d.type === '회의록' ? `/meetings/${d.id}` : `/docs/${d.id}`,
      keywords: [...d.keywords, d.fileName ?? '', d.source],
    });
  }
  const orgs = effectiveOrgs(s);
  for (const u of s.users) {
    items.push({
      kind: 'person',
      key: 'person:' + u.id,
      title: displayName(u),
      sub: `${orgPathText(orgs, u.dept)} · ${u.title || roleLabel(s, u)}`,
      to: '/people',
      keywords: [u.dept, u.title, roleLabel(s, u)],
    });
  }
  return items;
}

export interface QFResult {
  kind: QFKind;
  items: QFItem[];
}

/** 종류별로 묶은 결과(메뉴 → 기능 → 업무 → 문서 → 사람). 빈 검색어면 메뉴·기능만 */
export function quickFind(s: AppState, query: string, items: QFItem[] = buildItems(s)): QFResult[] {
  const q = norm(query);
  const groups: QFResult[] = [];
  for (const kind of KIND_ORDER) {
    let list: QFItem[];
    if (!q) {
      if (kind !== 'menu' && kind !== 'action') continue;
      list = items.filter((i) => i.kind === kind);
    } else {
      list = items
        .map((it, idx) => ({ it, idx, sc: it.kind === kind ? scoreItem(it, query) : null }))
        .filter((x) => x.sc !== null)
        .sort((a, b) => a.sc! - b.sc! || a.idx - b.idx)
        .map((x) => x.it);
    }
    list = list.slice(0, KIND_LIMIT[kind]);
    if (list.length) groups.push({ kind, items: list });
  }
  return groups;
}

export const flatten = (g: QFResult[]) => g.flatMap((x) => x.items);
