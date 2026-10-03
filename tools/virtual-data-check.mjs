// R-06 가상 데이터 점검(자동화 가능한 부분). 실명·실제 조직명은 사람이 보고, 여기서는 형식 위반만 잡는다.
// 테스트(tests/data.test.js)와 T-15 제출 점검이 함께 쓴다.
// CLI: node tools/virtual-data-check.mjs  (내장 샘플 전체를 점검)
import { pathToFileURL } from 'node:url';

const PATTERNS = [
  ['이메일 주소', /[\w.+-]+@[\w-]+\.[\w.-]+/],
  ['전화번호', /\b0\d{1,2}-\d{3,4}-\d{4}\b/],
  ['주민등록번호 형식', /\b\d{6}-[1-4]\d{6}\b/],
  ['URL', /https?:\/\//i],
  ['API 키 형식', /\bsk-[A-Za-z0-9_-]{10,}/],
];

// 문서 안의 모든 문자열(키 제외)을 모은다
function* strings(value, path = '') {
  if (typeof value === 'string') yield [path, value];
  else if (Array.isArray(value)) for (let i = 0; i < value.length; i += 1) yield* strings(value[i], `${path}[${i}]`);
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) yield* strings(v, path ? `${path}.${k}` : k);
}

/** 유니버스 문서에서 가상 데이터 규칙 위반을 찾는다. 위반이 없으면 빈 배열. */
export function scanVirtualData(doc) {
  const problems = [];
  const add = (path, rule, value) => problems.push({ path, rule, value });

  for (const [path, text] of strings(doc)) {
    for (const [rule, re] of PATTERNS) if (re.test(text)) add(path, rule, text);
  }
  // 사번은 V- + 숫자 4자리만 쓴다(실제 사번 형식과 구별)
  doc.nodes.forEach((n, i) => {
    if (n.emp_no !== undefined && !/^V-\d{4}$/.test(n.emp_no)) add(`nodes[${i}].emp_no`, '사번 형식(V-####)', n.emp_no);
  });
  // 조직 노드 이름은 "가상"으로 시작한다
  doc.nodes.forEach((n, i) => {
    if (n.core_type === 'org' && !n.label.startsWith('가상')) add(`nodes[${i}].label`, '조직 이름은 "가상"으로 시작', n.label);
  });
  if (doc.universe.is_sample !== true) add('universe.is_sample', '샘플 유니버스는 is_sample=true', doc.universe.is_sample);
  // 작성 주체도 가상 이름이어야 한다(검토5 V-2: 실제 팀 이름이 들어간 적이 있음)
  if (typeof doc.universe.owner === 'string' && !doc.universe.owner.startsWith('가상')) add('universe.owner', '작성 주체는 "가상"으로 시작', doc.universe.owner);
  return problems;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { SAMPLES } = await import('../app/data/index.js');
  let total = 0;
  for (const doc of SAMPLES) {
    const problems = scanVirtualData(doc);
    total += problems.length;
    console.log(`${doc.universe.id} ${doc.universe.name}: ${problems.length ? `${problems.length}건` : '위반 없음'}`);
    for (const p of problems) console.log(`  - ${p.path}: ${p.rule} (${p.value})`);
  }
  console.log(total ? `\n점검 실패 ${total}건` : '\n형식 점검 통과(실명·실제 조직명·실제 업무명은 사람이 확인해야 한다)');
  process.exit(total ? 1 : 0);
}
