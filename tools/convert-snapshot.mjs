// 변환기 경계 사례 스냅숏 갱신(2026-10-04). 변환 규칙을 일부러 바꿨을 때만 돌린다:
//   node tools/convert-snapshot.mjs          → 지금 결과와 저장된 스냅숏의 차이만 보여 준다(파일은 그대로)
//   node tools/convert-snapshot.mjs --write  → 스냅숏을 지금 결과로 덮어쓴다(차이를 확인한 뒤에만)
// 차이를 보지 않고 --write 하지 않는다. 바뀐 사례마다 "의도한 개선 / 회귀"를 판정해 기록한다(tech-record 35.2·36.1 교훈).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { ALL_CASES, dump } from '../tests/fixtures/convert-cases/dump.mjs';

const file = new URL('../tests/fixtures/convert-cases/snapshot.json', import.meta.url);
const now = Object.fromEntries(ALL_CASES.map(([name, text]) => [name, dump(text)]));
const saved = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
let changed = 0;
for (const [name, lines] of Object.entries(now)) {
  const before = saved[name] || [];
  const A = new Set(before);
  const B = new Set(lines);
  const minus = before.filter((x) => !B.has(x));
  const plus = lines.filter((x) => !A.has(x));
  if (!minus.length && !plus.length) continue;
  changed += 1;
  console.log(name);
  for (const x of minus) console.log('  - ' + x);
  for (const x of plus) console.log('  + ' + x);
}
console.log(`사례 ${ALL_CASES.length}개, 바뀐 사례 ${changed}개`);
if (process.argv.includes('--write')) {
  writeFileSync(file, JSON.stringify(now, null, 1) + '\n');
  console.log('스냅숏을 덮어썼습니다.');
}
