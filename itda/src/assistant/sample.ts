// AI 미사용 「예시 분석 결과」(체험용) — API 키가 없어도 승인 화면 흐름을 체험할 수 있도록, 예시 통화기록에 대해 미리 써 둔 고정 결과를 돌려준다.
// 실제 AI 분석이 아니며 화면·변경 이력에 「예시 분석(AI 미사용)」으로 표시된다. 원본: ClientMemory app/ai_sample.py + samples/sample_call_kimdohyun.txt(가상 데이터).
// 근거 문장은 AI 분석과 같은 방식으로 예시 원문과 대조한다(통과하지 못하면 기본 해제).
import { addDays, weekday, ymd } from './dates';
import { verifyItems, type Draft, type DraftItem } from './claude';
import type { AssistantData } from './types';
import type { Err } from './model';

export const SAMPLE_LABEL = '예시 분석(AI 미사용)';
export const SAMPLE_FILE = 'sample_call_kimdohyun.txt';

export const SAMPLE_TEXT = `[통화기록] 가온은행 김도현 부장 (가상 데모 고객)
일시: 최근 통화

나: 부장님, 안녕하세요. 지난번 말씀하신 거래실적 자료 건으로 연락드렸습니다.
김도현: 아, 네. 안 그래도 기다리고 있었어요. 그 자료에 출금 실패 건수도 같이 넣어줄 수 있어요? 다음 주 수요일 내부 보고가 있어서 화요일까지는 받아야 할 것 같아요.
나: 네, 실패 사유별로 나눠서 화요일까지 보내드리겠습니다.
김도현: 고마워요. 그리고 요즘 저희 쪽에서는 운영시간 확대보다 출금 재시도 기능에 관심이 더 많아요. 그것도 설명 자료 있으면 좋겠네요.
나: 네, 재시도 기능 안내자료도 같이 준비하겠습니다. 다음에 뵐 때 점심 같이 하시죠. 저는 요즘 회를 좋아해서요.
김도현: 하하, 저는 회는 별로고 고기가 좋아요. 요즘 주말마다 테니스 배우느라 정신이 없어요.
나: 테니스 시작하셨군요. 그럼 다음 달 초에 한번 찾아뵙겠습니다.
김도현: 그래요, 연락 줘요. 메일보다는 전화가 편해요.
(통화 분위기로 보아 연말 인사 이동이 있을 수도 있어 보임)
`;

/** 다음 주 특정 요일(0=월) */
function nextWeekday(today: string, wd: number, weeksAhead = 1): string {
  const start = addDays(today, 7 * weeksAhead - weekday(today));
  return addDays(start, wd);
}

/** 예시 분석 초안. 고객은 아무나 고를 수 있다(예시 내용은 항상 같다) */
export function sampleDraft(a: AssistantData, customerId: string, now: Date): Draft | Err {
  if (!a.customers.some((c) => c.id === customerId)) return { error: '고객을 찾을 수 없습니다.' };
  const today = ymd(now);
  const tue = nextWeekday(today, 1);
  const p = (field: NonNullable<DraftItem['field']>, fieldLabel: string, value: string, evidence: string, confidence: DraftItem['confidence'], extra: Partial<DraftItem> = {}): DraftItem => ({
    kind: 'profile', field, fieldLabel, value, evidence, speaker: 'customer', confidence, isSpeculation: false, quoteVerified: false, ...extra,
  });
  const items: DraftItem[] = [
    p('foodLikes', '선호 음식', '고기', '저는 회는 별로고 고기가 좋아요.', 'high'),
    p('foodDislikes', '기피 음식', '회', '저는 회는 별로고 고기가 좋아요.', 'medium'),
    p('hobbies', '취미·관심사', '테니스', '요즘 주말마다 테니스 배우느라 정신이 없어요.', 'high'),
    p('recentInterests', '최근 관심 주제', '출금 재시도 기능', '요즘 저희 쪽에서는 운영시간 확대보다 출금 재시도 기능에 관심이 더 많아요.', 'high'),
    p('contactPreference', '선호 연락 방식', '전화 (메일보다 선호)', '메일보다는 전화가 편해요.', 'high'),
    p('salesNotes', '영업 시 참고사항', '연말 인사 이동 가능성', '(통화 분위기로 보아 연말 인사 이동이 있을 수도 있어 보임)', 'low', { speaker: 'unclear', isSpeculation: true }),
    { kind: 'request', content: '거래실적 자료에 출금 실패 사유별 건수 추가 제공', dueDate: tue, assignee: '', evidence: '그 자료에 출금 실패 건수도 같이 넣어줄 수 있어요? ... 화요일까지는 받아야 할 것 같아요.', confidence: 'high', speaker: 'customer', isSpeculation: false, quoteVerified: false },
    { kind: 'request', content: '출금 재시도 기능 설명 자료 제공', dueDate: '', assignee: '', evidence: '그것도 설명 자료 있으면 좋겠네요.', confidence: 'high', speaker: 'customer', isSpeculation: false, quoteVerified: false },
    { kind: 'followup', content: '다음 달 초 방문 미팅 및 점심 일정 잡기', evidence: '그럼 다음 달 초에 한번 찾아뵙겠습니다.', confidence: 'medium', speaker: 'salesperson', isSpeculation: false, quoteVerified: false },
  ];
  return {
    kind: 'sample',
    customerId,
    filename: SAMPLE_FILE,
    original: SAMPLE_TEXT,
    sentText: SAMPLE_TEXT,
    createdAt: today,
    title: '거래실적 자료 및 재시도 기능 문의',
    interactionType: '통화',
    interactionDate: today,
    summary: '거래실적 자료에 출금 실패 건수를 추가해 달라는 요청을 받음. 다음 주 수요일 내부 보고로 화요일까지 필요. 운영시간 확대보다 출금 재시도 기능에 관심이 높아 안내자료도 요청함.',
    speakerNote: "'회를 좋아한다'는 발언은 영업사원(나)의 발언이므로 고객 정보에서 제외함. 마지막 괄호 문장은 작성자의 추측으로 판단함.",
    items: verifyItems(items, SAMPLE_TEXT),
  };
}
