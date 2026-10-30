// 가상(데모) 고객 18명 — ClientMemory app/seed.py를 그대로 옮긴 것(인물·기관·연락처 모두 가상: 전화 010-0000-xxxx, 이메일 *.example).
// 날짜는 기준일에서의 상대값이라 언제 불러와도 알림·오늘 화면을 확인할 수 있다. 고객마다 비어 있는 정도가 달라 미팅 후 질문 시험에 쓴다.
// 데모 등록 이력은 저장하지 않는다(CR-25 2.3-8: 원본은 이력 273행이 저장량의 3분의 2였다).
import { addDays, ymd, stamp } from './dates';
import { createCustomer, emptyAssistant } from './model';
import type { AssistantData, CustomerFields } from './types';
import { nextId } from '../lib/util';

type Info = Partial<CustomerFields>;
/** 활동: [유형, 날짜 오프셋, 제목, 요약, 시각?] */
type Act = [string, number, string, string, string?];
/** 요청: [내용, 접수 오프셋, 기한 오프셋|null, 상태, 담당자, 처리 결과] */
type Req = [string, number, number | null, string, string, string];
/** 기념일: [종류, 이름, 날짜(YYYY-MM-DD), 매년 반복 여부] */
type Ann = [string, string, string, boolean];

/** 오늘로부터 offset일 뒤가 생일이 되는 생년월일(2/29는 28일로) */
function bday(base: string, offset: number, year: number): string {
  const t = addDays(base, offset);
  const m = Number(t.slice(5, 7));
  let dd = Number(t.slice(8, 10));
  if (m === 2 && dd === 29) dd = 28;
  return `${String(year).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

function demo(base: string): [Info, Act[], Req[], Ann[]][] {
  const d = (n: number) => addDays(base, n);
  const b = (off: number, year: number) => bday(base, off, year);
  return [
    [
      { name: '김도현', birthDate: b(5, 1972), mobile: '010-0000-1001', email: 'dh.kim@gaon-bank.example', company: '가온은행', department: '자금결제부', position: '부장', duties: 'CMS 출금이체 참가기관 업무 총괄', customerType: '참가기관', companyAddress: '서울특별시 중구 가상로 100', firstMetDate: d(-420), relationshipOrigin: 'CMS 참가기관 실무협의회에서 첫 인사', personality: '꼼꼼하고 수치 근거를 중시, 결론부터 듣는 것을 선호', foodLikes: '한식', foodDislikes: '해산물', hobbies: '골프, 등산', recentInterests: 'CMS 운영시간 확대', contactPreference: '오전 중 전화', salesNotes: '보고서는 1장 요약본을 먼저 전달할 것', nextContactDate: d(2), orgRelationship: 'CMS 출금이체 주요 참가기관, 연간 거래건수 상위' },
      [['미팅', -13, 'CMS 운영시간 확대 논의', '운영시간 확대 시 은행 측 인력 운영 부담에 대해 의견 청취'], ['통화', -6, '거래실적 자료 요청 통화', '최근 6개월 거래실적 자료를 다음 주까지 요청함'], ['미팅', 2, '정기 업무협의 (예정)', '운영시간 확대 관련 후속 의견 청취 예정']],
      [['최근 6개월 CMS 거래실적 자료 제공', -6, 0, '진행 중', '납기팀', '']],
      [],
    ],
    [
      { name: '이서연', birthDate: b(40, 1980), mobile: '010-0000-1002', email: 'sy.lee@nuri-bank.example', company: '누리은행', department: '디지털채널부', position: '차장', duties: '펌뱅킹·CMS 연계 시스템 담당', customerType: '참가기관', firstMetDate: d(-300), personality: '온화하고 경청형, 메신저보다 이메일 선호', hobbies: '요가, 독서', recentInterests: '오픈뱅킹 연계, 자녀 진학', contactPreference: '이메일', nextContactDate: d(9) },
      [['이메일', -20, '연계 테스트 일정 회신', '11월 셋째 주 연계 테스트 가능하다는 회신'], ['통화', -45, '시스템 변경 사전 공유', '차세대 시스템 전환 일정 공유받음']],
      [['연계 테스트 시나리오 문서 송부', -20, 6, '미착수', '납기팀', '']],
      [['결혼기념일', '', '2009-' + d(14).slice(5), true]],
    ],
    [
      { name: '박준혁', mobile: '010-0000-1003', email: 'jh.park@dasom-bank.example', company: '다솜은행', department: '수신업무부', position: '과장', duties: '자동이체 민원 처리', customerType: '참가기관', firstMetDate: d(-150), relationshipOrigin: '자동이체 민원 공동 대응 건으로 연락 시작' },
      [['통화', -95, '민원 공동대응 협의', '중복출금 민원 처리 절차 협의']],
      [],
      [],
    ],
    [
      { name: '최유진', birthDate: b(18, 1985), mobile: '010-0000-1004', email: 'yj.choi@raon-sb.example', company: '라온저축은행', department: '영업기획팀', position: '팀장', duties: 'CMS 신규 참가 검토', customerType: '참가기관', firstMetDate: d(-60), personality: '추진력 있고 빠른 의사결정', foodLikes: '양식, 파스타', recentInterests: 'CMS 참가 절차, 수수료 체계', contactPreference: '휴대전화 문자', nextContactDate: d(4), orgRelationship: 'CMS 신규 참가 검토 기관' },
      [['미팅', -30, 'CMS 참가 절차 설명회', '참가 절차·소요 기간·수수료 체계 설명'], ['이메일', -3, '참가 신청서 양식 문의', '참가 신청서 최신 양식 요청']],
      [['CMS 참가 신청서 최신 양식 및 작성 예시 전달', -3, 2, '미착수', '납기팀', '']],
      [],
    ],
    [
      { name: '정민수', birthDate: b(-3, 1968), mobile: '010-0000-1005', email: 'ms.jung@hangyeol-edu.example', company: '한결교육재단', department: '재무팀', position: '실장', duties: '등록금 CMS 자동이체 운영', customerType: '이용기관·가맹점', firstMetDate: d(-700), personality: '원칙 중시, 문서로 근거 남기는 것을 선호', foodLikes: '한식, 국밥', foodDislikes: '매운 음식', hobbies: '바둑', contactPreference: '유선전화(사무실)', salesNotes: '분기 말에는 업무가 몰려 연락 자제' },
      [['미팅', -110, '연간 이용현황 점검', '등록금 출금 실패율 개선 방안 논의'], ['통화', -100, '출금 실패 사유 자료 요청', '실패 사유별 통계 요청']],
      [['출금 실패 사유별 통계 자료 제공', -100, -85, '완료', '납기팀', '통계 자료 이메일 송부 완료']],
      [],
    ],
    [
      { name: '강하은', mobile: '010-0000-1006', email: 'he.kang@neulbom.example', company: '늘봄요양원', department: '원무과', position: '주임', duties: '입소비 자동이체 관리', customerType: '이용기관·가맹점', firstMetDate: d(-200), recentInterests: '모바일 출금동의 도입' },
      [['통화', -75, '모바일 출금동의 문의', 'ARS·모바일 동의 방식 차이 문의']],
      [['모바일 출금동의 도입 안내자료 송부', -75, -60, '보류', '납기팀', '기관 내부 검토 후 재요청 예정']],
      [],
    ],
    [
      { name: '조성훈', birthDate: b(25, 1977), mobile: '010-0000-1007', email: 'sh.cho@saebit-academy.example', company: '새빛학원', department: '경영지원팀', position: '팀장', duties: '수강료 CMS 수납', customerType: '이용기관·가맹점', firstMetDate: d(-500), personality: '유머 있고 친근함', foodLikes: '일식, 초밥', hobbies: '골프, 낚시', recentInterests: '수납 수수료 절감', contactPreference: '휴대전화', nextContactDate: d(-5) },
      [['미팅', -40, '수수료 체계 상담', '건별 수수료 구간 조정 가능 여부 문의'], ['통화', -38, '후속 통화', '내부 보고 후 회신 예정이라고 함']],
      [['수수료 구간별 비교표 작성 전달', -38, -2, '진행 중', '납기팀', '']],
      [['자녀 수능일', '자녀 수능 (가상)', d(22), false]],
    ],
    [
      { name: '윤지아', mobile: '010-0000-1008', email: 'ja.yoon@dodam.example', company: '도담관리', department: '관리팀', position: '대리', duties: '관리비 자동이체', customerType: '이용기관·가맹점', firstMetDate: d(-30) },
      [['미팅', -30, '첫 미팅 및 명함 교환', '관리비 CMS 이용 신청 관련 기본 안내'], ['미팅', -1, '관리비 CMS 신청 상담', '신청 서류와 일정 안내 (미팅 후 질문 시험용)', '15:00']],
      [],
      [],
    ],
    [
      { name: '장태우', birthDate: b(60, 1975), mobile: '010-0000-1009', email: 'tw.jang@a1system.example', company: '에이원시스템', department: '금융사업본부', position: '이사', duties: 'CMS 중계 시스템 유지보수', customerType: '협력사', firstMetDate: d(-900), personality: '기술적 디테일에 강함, 직설적', foodLikes: '중식', foodDislikes: '날음식', hobbies: '자전거', recentInterests: '클라우드 전환', contactPreference: '메신저', orgRelationship: 'CMS 중계 시스템 유지보수 계약 협력사', nextContactDate: d(1) },
      [['미팅', -8, '유지보수 월간 점검', '장애 이력 0건, 성능 개선 과제 2건 공유'], ['미팅', 1, '클라우드 전환 사전 협의 (예정)', '']],
      [['성능 개선 과제 우선순위 회신', -8, 3, '진행 중', '납기팀', '']],
      [],
    ],
    [
      { name: '한소희', mobile: '010-0000-1010', email: 'sh.han@codebridge.example', company: '코드브릿지', department: 'UX팀', position: '책임', duties: 'CMS 이용기관 포털 화면 개선', customerType: '협력사', firstMetDate: d(-120), personality: '아이디어가 많고 시각자료로 설명하는 것을 선호', hobbies: '전시 관람', recentInterests: '접근성 개선' },
      [['미팅', -50, '포털 개선안 리뷰', '화면 시안 1차 검토']],
      [],
      [],
    ],
    [
      { name: '오정석', birthDate: b(1, 1970), mobile: '010-0000-1011', email: 'js.oh@dataon.example', company: '데이터온', department: '대표이사실', position: '대표', duties: '데이터 분석 협력', customerType: '협력사', firstMetDate: d(-1000), foodLikes: '한식, 막걸리', hobbies: '등산', contactPreference: '휴대전화', salesNotes: '연락 시 비서실 경유 필요' },
      [['미팅', -130, '협력과제 성과 공유', 'CMS 거래 데이터 분석 시범과제 결과 공유']],
      [],
      [],
    ],
    [
      { name: '서민재', mobile: '010-0000-1012', email: 'mj.seo@digifin.example', company: '디지털금융청(가상)', department: '지급결제과', position: '사무관', duties: '지급결제 제도 정책', customerType: '정부기관', firstMetDate: d(-250), personality: '공식 절차와 문서 중시', contactPreference: '공문·이메일', recentInterests: 'CMS 운영시간 확대, 이용자 보호', orgRelationship: '지급결제 관련 정책 협의 기관', nextContactDate: d(12) },
      [['미팅', -25, '운영시간 확대 정책 협의', '이용자 보호 측면 검토의견 요청받음'], ['이메일', -10, '검토의견 제출 일정 확인', '']],
      [['CMS 운영시간 확대 관련 이용자 보호 검토의견 제출', -25, 7, '진행 중', '납기팀', '']],
      [],
    ],
    [
      { name: '임가영', birthDate: b(3, 1988), mobile: '010-0000-1013', email: 'gy.lim@digifin.example', company: '디지털금융청(가상)', department: '지급결제과', position: '주무관', duties: '실무 자료 취합', customerType: '정부기관', firstMetDate: d(-250), foodLikes: '샐러드', foodDislikes: '고기류', hobbies: '필라테스' },
      [['통화', -12, '자료 취합 일정 문의', '']],
      [],
      [],
    ],
    [
      { name: '배동욱', mobile: '010-0000-1014', email: 'dw.bae@gov-city.example', company: '가상시 세정과', department: '세무행정팀', position: '팀장', duties: '지방세 자동이체', customerType: '정부기관', firstMetDate: d(-400), recentInterests: '지방세 납부 편의성' },
      [['미팅', -200, '지방세 자동이체 협의', '자동이체 신청 경로 다양화 논의']],
      [],
      [],
    ],
    [
      { name: '신예린', birthDate: b(10, 1983), mobile: '010-0000-1015', email: 'yr.shin@mirae-acct.example', company: '미래회계법인(가상)', department: 'IT감사본부', position: '이사', duties: '결제 시스템 IT 감사', customerType: '기타', firstMetDate: d(-180), personality: '논리적이고 질문이 많음', foodLikes: '일식', hobbies: '와인', contactPreference: '이메일', nextContactDate: d(20) },
      [['미팅', -70, 'IT 감사 사전 인터뷰', '접근통제 관련 증빙 목록 수령']],
      [['접근통제 증빙자료 제출', -70, -40, '완료', '납기팀', '증빙 12종 제출 완료']],
      [],
    ],
    [
      { name: '문승호', mobile: '010-0000-1016', email: 'sh.moon@hanbit-ins.example', company: '한빛손해보험(가상)', department: '수납팀', position: '차장', duties: '보험료 CMS 출금', customerType: '이용기관·가맹점', firstMetDate: d(-350), foodDislikes: '오이', hobbies: '야구 관람', recentInterests: '출금 재시도 기능' },
      [['통화', -150, '출금 재시도 기능 문의', '']],
      [['출금 재시도 기능 개선 요청 내부 전달', -150, null, '미착수', '납기팀', '']],
      [],
    ],
    [
      { name: '노은지', birthDate: b(33, 1990), mobile: '010-0000-1017', email: 'ej.noh@bareun-sec.example', company: '바른증권(가상)', department: '고객자산부', position: '대리', duties: '증권계좌 자동이체', customerType: '참가기관', firstMetDate: d(-90), personality: '밝고 적극적', foodLikes: '베트남 음식', recentInterests: '재테크, 자격증 공부', contactPreference: '메신저' },
      [['미팅', -55, '증권계좌 CMS 연계 설명', '연계 절차 설명, 추가 질의 이메일로 받기로 함']],
      [],
      [],
    ],
    [
      { name: '구본석', mobile: '010-0000-1018', email: 'bs.koo@saerom-ngo.example', company: '새롬복지재단(가상)', department: '후원관리팀', position: '과장', duties: '정기후원금 자동이체', customerType: '기타', firstMetDate: d(-600) },
      [],
      [],
      [['기타 기념일', '재단 창립기념일', '2001-' + d(45).slice(5), true]],
    ],
  ];
}

/**
 * 가상 고객 18명이 든 비서 데이터. now를 기준일로 상대 날짜를 만든다. ownerId는 모든 고객의 담당 영업자(보통 지금 사용자).
 * 이력은 저장하지 않으므로 JSON 크기는 대략 2만 자 안팎이다.
 */
export function createAssistantSeed(now: Date, ownerId: string): AssistantData {
  const a = emptyAssistant();
  const base = ymd(now);
  const ts = stamp(now);
  for (const [info, acts, reqs, anns] of demo(base)) {
    const r = createCustomer(a, info, { now, ownerId, source: 'manual', isDemo: true, force: true });
    if (!('id' in r)) throw new Error('시드 고객 등록 실패'); // 시험이 잡는다
    const cid = r.id;
    const cust = a.customers.find((c) => c.id === cid)!;
    const inter: { id: string; off: number }[] = [];
    let lastContact = '';
    let lastMeet = '';
    for (const [type, off, title, summary, time] of acts) {
      const date = addDays(base, off);
      const id = nextId('IA', a.interactions.map((x) => x.id));
      a.interactions.push({ id, customerId: cid, type, date, time: time ?? '', endTime: '', title, summary, details: '', source: 'demo', sourceFile: '', isDemo: true, createdAt: ts });
      inter.push({ id, off });
      if (off <= 0 && ['미팅', '통화', '이메일'].includes(type)) {
        if (date > lastContact) lastContact = date;
        if (type === '미팅' && date > lastMeet) lastMeet = date;
      }
    }
    if (lastContact) {
      cust.lastContactDate = lastContact;
      cust.lastMeetingDate = lastMeet;
    }
    for (const [content, roff, doff, status, assignee, result] of reqs) {
      a.requests.push({
        id: nextId('RQ', a.requests.map((x) => x.id)),
        customerId: cid,
        content,
        receivedDate: addDays(base, roff),
        dueDate: doff == null ? '' : addDays(base, doff),
        status,
        assignee,
        interactionId: inter.find((i) => i.off === roff)?.id ?? null,
        result,
        source: 'demo',
        isDemo: true,
        createdAt: ts,
        updatedAt: ts,
      });
    }
    for (const [kind, label, date, repeat] of anns) {
      a.anniversaries.push({ id: nextId('AN', a.anniversaries.map((x) => x.id)), customerId: cid, kind, label, date, repeatYearly: repeat, remindDays: '7,2,0', notes: '', isDemo: true, createdAt: ts });
    }
  }
  return a;
}
