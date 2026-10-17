// 점검 도구 공용: 브라우저 고르기와 "이 도구가 띄운 것만" 정리하기.
// 이 PC에서는 사용자가 다른 프로그램(자기 Chrome·Edge, 다른 프로젝트의 python·node)도 돌린다.
// 그래서 실행 파일 이름으로 전부 끄지 않고(taskkill /IM 금지), 점검용 임시 프로필 경로로 띄운 프로세스만 끈다.
import { spawnSync } from 'node:child_process';

/**
 * --only=chrome / --only=edge / --only=chrome,edge 로 점검할 브라우저를 고른다. 없으면 전부.
 * @param {{name:string}[]} list
 */
export function pickBrowsers(list) {
  const arg = process.argv.find((a) => a.startsWith('--only='));
  if (!arg) return list;
  const want = arg.slice('--only='.length).toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
  const picked = list.filter((b) => want.includes(b.name.toLowerCase()));
  if (!picked.length) {
    console.error(`--only 값이 맞지 않습니다: ${want.join(',')} (가능: ${list.map((b) => b.name.toLowerCase()).join(', ')})`);
    process.exit(2);
  }
  return picked;
}

/**
 * 명령줄에 이 프로필 폴더가 들어 있는 chrome·msedge 프로세스만 끈다(앞선 점검이 멈춰 남긴 것).
 * 사용자의 평소 브라우저는 이 임시 경로를 쓰지 않으므로 건드리지 않는다. 끈 개수를 돌려준다.
 * @param {string} profileDir
 */
export function killOwnBrowsers(profileDir) {
  if (process.platform !== 'win32') return 0;
  const ps = [
    "$p = $env:WU_PROFILE.ToLower();",
    "$n = 0;",
    "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe' OR Name='msedge.exe'\" |",
    " Where-Object { $_.CommandLine -and $_.CommandLine.ToLower().Contains($p) } |",
    " ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop; $n++ } catch {} };",
    "$n",
  ].join(' ');
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
    env: { ...process.env, WU_PROFILE: profileDir }, encoding: 'utf8', timeout: 30000,
  });
  const n = Number.parseInt((r.stdout || '').trim(), 10) || 0;
  if (n) console.log(`(앞선 점검이 남긴 브라우저 프로세스 ${n}개 정리: ${profileDir})`);
  return n;
}
