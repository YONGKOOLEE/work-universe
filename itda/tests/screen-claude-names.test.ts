// 화면 문구에 「Claude」가 남는 곳은 정해진 셋뿐이다: ① 상단 엔진 칸(이름·설명·안내) ② AI 설정 창의 키 안내 ③ 대화 분석 전송처 표시.
// 주석을 뺀 소스 줄 중 Claude·클로드가 든 줄을 모아, 파일별 허용 문구 목록에 없으면 실패한다.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SRC = join(__dirname, '..', 'src');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

/** 파일별로 허용하는 화면 문구 조각. 줄마다 이 조각 중 하나가 있어야 한다 */
const ALLOWED: Record<string, string[]> = {
  // ① 엔진 칸
  'ai/claude.tsx': ["claude: 'Claude'"],
  'components/Layout.tsx': ['Claude(본인 키로 실시간 분석)', "'Claude(본인 키)로 분석'", '상단에서 Claude를 고르면', '엔진을 Claude로 바꿨습니다', '「규칙 · Claude · 사내」', 'AI 설정 — Claude API 키', '본인 Claude API 키', '저장된 키를 Claude가', '          Claude'],
  'lib/quickFind.ts': ['Claude API 키·모델', '규칙 · Claude · 사내', "'claude', '클로드'"],
  // 엔진 칸 이름을 가리키는 안내
  'assistant/ui/AskView.tsx': ['상단에서 키를 넣고 Claude를 고르면'],
  'assistant/ui/AnalyzeView.tsx': ['상단에서 키를 넣고 Claude를 고르면', '전송처', '<dd>Claude · 모델', 'Claude(api.anthropic.com)'],
  'universe/ClaudeInsights.tsx': ['상단 AI 엔진에서 Claude를 고르면', '본인 Claude API 키'],
  'pages/SearchPage.tsx': ['상단 엔진에서 Claude를 고르면'],
};

describe('화면에 보이는 Claude 이름', () => {
  it('허용한 곳(엔진 칸·AI 설정 키 안내·전송처 표시) 밖에는 없다', () => {
    const bad: string[] = [];
    for (const f of walk(SRC)) {
      const rel = relative(SRC, f).split(sep).join('/');
      let inBlock = false;
      readFileSync(f, 'utf8').split(/\r?\n/).forEach((line, i) => {
        const t = line.trim();
        if (inBlock) { if (t.includes('*/')) inBlock = false; return; }
        if (t.startsWith('/*')) { if (!t.includes('*/')) inBlock = true; return; }
        if (t.startsWith('//') || t.startsWith('*')) return;
        if (!/Claude|클로드/.test(line)) return;
        const code = line.replace(/\s\/\/\s.*$/, '');
        if (!/(Claude|클로드)/.test(code)) return;
        // 식별자(ClaudeInsights, useClaudeCheck, ClaudeRaw …)와 import 줄은 화면 문구가 아니다
        const text = code.replace(/\b[A-Za-z_]*Claude[A-Za-z_]*\b(?=[\s(<>.,;:)={}\]]|$)/g, (m) => (m === 'Claude' ? m : ''));
        if (!/(Claude|클로드)/.test(text)) return;
        if (/^\s*import\b/.test(text)) return;
        if ((ALLOWED[rel] ?? []).some((a) => line.includes(a))) return;
        bad.push(`${rel}:${i + 1}: ${t.slice(0, 100)}`);
      });
    }
    expect(bad).toEqual([]);
  });
});
