// 받침에 맞는 조사 고르기. 순수 함수(DOM·저장소 없음)라 rules·view 어디서든 쓴다(검토9 R-2).
// ui/messages.js에도 같은 이름의 josa가 있다 — 그쪽은 ui라 rules가 가져올 수 없어 따로 두었다(고치면 양쪽을 함께 본다).

/**
 * josa('작성 주체', '이/가') → '가'. 쓰는 곳: `${w}${josa(w, '이/가')}`
 * 끝의 따옴표·괄호·공백은 건너뛴다. 마지막 글자가 한글이 아니면 받침을 알 수 없으므로 「이(가)」처럼 둘 다 적는다.
 */
export function josa(word, pair) {
  const [withFinal, without] = pair.split('/');
  const w = String(word == null ? '' : word).replace(/[」』"')\]\s]+$/u, '');
  const code = w.charCodeAt(w.length - 1);
  if (!(code >= 0xac00 && code <= 0xd7a3)) return `${withFinal}(${without})`;
  return (code - 0xac00) % 28 === 0 ? without : withFinal;
}
