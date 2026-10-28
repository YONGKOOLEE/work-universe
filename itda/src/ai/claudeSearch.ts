// Claude 기반 AI 업무 검색 — 등록 자료에서 관련 문단을 골라 Claude에 보내고,
// 돌아온 인용문을 원문과 대조해 '원문 확인' 여부를 플랫폼이 직접 판정한다.
import type { AppState, DocParagraph, Prov } from '../lib/types';
import type { Answer, AnswerLine } from './engine';
import { locate } from './reflect';
import { dice } from './concepts';
import type { SampleFn } from './claude';
import { fmtDate } from '../lib/util';
import { findTargetWork } from './workAnswer';

function paragraphsOf(s: AppState) {
  const out: { docId: string; title: string; p: DocParagraph }[] = [];
  for (const d of s.docs) {
    const ps = d.paragraphs ?? [];
    for (const p of ps) out.push({ docId: d.id, title: d.title, p });
  }
  return out;
}

const terms = (q: string) =>
  q
    .replace(/[?？.,!]/g, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/(은|는|이|가|을|를|의|에|에서|으로|로|와|과|했어|했나|인가|이야|는가)$/, ''))
    .filter((t) => t.length >= 2);

function rank(s: AppState, q: string, limit = 28) {
  const ts = terms(q);
  return paragraphsOf(s)
    .map((x) => {
      const hit = ts.filter((t) => x.p.text.includes(t)).length;
      return { ...x, sc: hit * 2 + dice(q, x.p.text.slice(0, 400)) + (x.p.id === 'meta' ? 0.5 : 0) };
    })
    .filter((x) => x.sc > 0.6)
    .sort((a, b) => b.sc - a.sc)
    .slice(0, limit);
}

interface Raw {
  lines?: { text?: string; basis?: string; cites?: { docId?: string; paraId?: string; quote?: string }[] }[];
  eventIds?: string[];
  workIds?: string[];
  followups?: string[];
}

export async function claudeAsk(sample: SampleFn, s0: AppState, q: string, signal?: AbortSignal): Promise<Answer & { verify: { checked: number; passed: number } }> {
  // 질문이 특정 업무를 가리키면 그 업무 자료만 보냄 (다른 업무 내용과 섞이지 않도록)
  const target = findTargetWork(s0, q);
  const s: AppState = target
    ? {
        ...s0,
        works: s0.works.filter((w) => w.id === target.id),
        docs: s0.docs.filter((d) => d.workIds.includes(target.id)),
        decisions: s0.decisions.filter((d) => d.workId === target.id),
        events: s0.events.filter((e) => e.workIds.includes(target.id)),
        actions: s0.actions.filter((a) => a.workId === target.id),
      }
    : s0;
  const ctxParas = rank(s, q);
  const byDoc = new Map<string, DocParagraph[]>();
  for (const d of s.docs) byDoc.set(d.id, d.paragraphs ?? []);

  const works = s.works
    .map((w) => `- ${w.id} ${w.name}: ${w.summary}\n  목적: ${w.purpose.map((x) => x.text).join(' / ') || '없음'}\n  배경: ${w.background.map((x) => `${x.text}(${x.prov === 'fact' ? '원문' : x.prov === 'unverified' ? '확인 필요' : '담당자'})`).join(' / ') || '없음'}\n  현재: ${w.current.map((x) => x.text).join(' / ') || '없음'}`)
    .join('\n');
  const decs = s.decisions.map((d) => `- ${d.id} ${fmtDate(d.date)} ${d.title} [${d.prov === 'fact' ? '원문 확인' : '확인 필요'}]`).join('\n');
  const evs = s.events.map((e) => `- ${e.id} ${fmtDate(e.date)} ${e.title} [${e.source}] (업무 ${e.workIds.join(',')})`).join('\n');
  const acts = s.actions.filter((a) => a.status !== '완료').map((a) => `- ${a.workId} ${a.title} (기한 ${a.due ?? '미지정'})`).join('\n');
  const docs = s.docs.map((d) => `- ${d.id} ${d.title} (${d.type}, 작성일 ${d.writtenAt || '미상'})`).join('\n');
  const paras = ctxParas.map((x) => `[${x.docId}#${x.p.id}] ${x.p.text.slice(0, 1600)}`).join('\n');

  const prompt = `당신은 업무 인수인계 플랫폼의 AI 업무 검색입니다. 아래 '등록 자료'만 근거로 질문에 답합니다.

## 절대 규칙
1. 등록 자료에 없는 내용을 사실처럼 쓰지 않습니다. 일반 상식이나 추측으로 빈칸을 채우지 않습니다.
2. 문장마다 근거 유형 "basis"를 붙입니다: "source"(원문 문단에 직접 기재), "inference"(여러 자료를 종합한 해석), "unknown"(등록 자료로 확인 불가).
3. "source" 문장에는 근거 "cites"를 1개 이상 붙이고, quote는 원문 문단에서 **글자 그대로** 복사합니다(120자 이내). docId와 paraId는 [docId#paraId] 표기에서 가져옵니다.
4. 이유·배경이 자료에 없으면 "현재 등록된 문서에서는 ~을 확인할 수 없습니다"라고 "unknown"으로 답합니다.
5. 질문이 특정 업무를 가리키면 그 업무 자료로만 답하고, 다른 업무 내용을 섞지 않습니다.
6. 답변 문장은 3~6개, 한국어 존댓말. 출력은 JSON 객체 하나만.

## 출력 형식
{ "lines": [ { "text": "...", "basis": "source"|"inference"|"unknown", "cites": [ { "docId": "D-001", "paraId": "p1-3", "quote": "..." } ] } ],
  "eventIds": [관련 타임라인 이벤트 ID], "workIds": [관련 업무 ID], "followups": [추가로 물어볼 질문 2~3개] }

## 질문
${q}

## 등록 자료
### 업무
${works}
### 결정사항
${decs}
### 타임라인 이벤트
${evs}
### 미완료 조치사항
${acts}
### 문서 목록
${docs}
### 관련 원문 문단 (검색 상위 ${ctxParas.length}개)
${paras || '(질문과 일치하는 원문 문단 없음)'}`;

  const raw = await sample.json<Raw>(prompt, { modelTier: 'default', signal });
  let checked = 0;
  let passed = 0;
  const evidence = new Map<string, { docId: string; anchor?: string; why: string; quote?: string }>();
  const lines: AnswerLine[] = (raw.lines ?? [])
    .filter((l) => l && typeof l.text === 'string' && l.text.trim())
    .slice(0, 8)
    .map((l) => {
      const basis = l.basis === 'source' ? 'source' : l.basis === 'inference' ? 'inference' : 'unknown';
      const ok: { docId: string; anchor?: string; label?: string }[] = [];
      for (const c of l.cites ?? []) {
        if (!c?.docId || !c.quote) continue;
        checked++;
        const ps = byDoc.get(c.docId);
        const hit = ps ? locate(ps, c.quote, c.paraId) : null;
        if (hit) {
          passed++;
          const anchor = hit.id === 'meta' ? undefined : hit.id;
          const d = s.docs.find((x) => x.id === c.docId)!;
          ok.push({ docId: c.docId, anchor, label: `${d.title}${anchor ? ` · ${anchor.startsWith('item-') ? anchor.slice(5) + '번 안건' : anchor}` : ''}` });
          const k = `${c.docId}#${anchor ?? ''}`;
          if (!evidence.has(k)) evidence.set(k, { docId: c.docId, anchor, why: '인용 검증 통과', quote: c.quote });
        }
      }
      let prov: Prov = basis === 'source' ? 'fact' : basis === 'inference' ? 'inference' : 'unverified';
      let text = l.text!.trim();
      if (basis === 'source' && !ok.length) {
        prov = 'unverified';
        text += ' (근거 인용이 원문과 일치하지 않아 확정하지 않음)';
      }
      return { text, prov, cite: ok.length ? ok : undefined };
    });
  if (!lines.length) lines.push({ text: '현재 등록된 문서에서는 해당 내용을 확인할 수 없습니다.', prov: 'unverified' });
  return {
    query: q,
    intent: 'claude',
    lines,
    evidence: [...evidence.values()],
    events: (raw.eventIds ?? []).filter((id) => s.events.some((e) => e.id === id)).slice(0, 8),
    works: (raw.workIds ?? []).filter((id) => s.works.some((w) => w.id === id)).slice(0, 5),
    followups: (raw.followups ?? []).map(String).slice(0, 3),
    verify: { checked, passed },
  };
}
