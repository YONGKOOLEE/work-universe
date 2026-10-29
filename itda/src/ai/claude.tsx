// AI 엔진 선택(CR-24 D24-9): 본인 API 키가 있으면 Claude, 없으면 규칙 기반.
// 이전의 claude.ai 게시 페이지 방식(window.claude.use('sample'))은 뺐다(사용자 결정 U-6).
import React, { createContext, useContext, useMemo, useState } from 'react';
import { createClient, DEFAULT_MODEL, errorText as llmErrorText, keyStatusOf, loadKey, saveKey, type KeyStatus, type LlmClient } from './llm';
// @ts-expect-error 업무 유니버스 공급자(JS) — 근거 칩 문장 다듬기(refineDraftAsync)에 쓴다
import { createProvider } from '../../../app/src/llm/providers.js';

export type Engine = 'claude' | 'mock';
/** 고르는 엔진: 규칙 / Claude / 사내 AI(업무 유니버스처럼 자리만 — 고르면 규칙으로 동작, 사용자 결정 2026-10-29) */
export type EnginePref = Engine | 'internal';
export const ENGINE_LABELS: Record<EnginePref, string> = { mock: '규칙', claude: 'Claude', internal: '사내 AI' };
export const INTERNAL_NOTICE = '사내 AI는 아직 연결되지 않았습니다. 지금은 규칙으로 동작하며 밖으로 보내는 것이 없습니다.';

interface AICtx {
  engine: Engine; // 실제로 쓸 엔진
  preferred: EnginePref;
  status: KeyStatus; // 키 상태: available(키 있음) / denied(키가 거부됨 — 저장소에는 남아 있어 지울 수 있음) / none(키 없음)
  client: LlmClient | null; // engine이 claude일 때만 값이 있다(L-3) — 키 유무는 status로 본다
  universeProvider: any; // 업무 유니버스 연결부용 Claude 공급자(engine이 claude일 때만)
  model: string;
  setPreferred: (e: EnginePref) => void;
  /** 키 저장(빈 값이면 지움). 키는 이 브라우저 저장소에만 둔다 */
  setKey: (key: string | null, model?: string) => void; // key null = 키는 그대로, 모델만 바꿈
  /** 호출 실패 → 화면 문구. 키가 거부되면 이번 화면에서는 규칙 기반으로 */
  onError: (e: unknown) => string;
}

const Ctx = createContext<AICtx | null>(null);
const PREF_KEY = 'worklink-ai-engine';

export function AIProvider({ children }: { children: React.ReactNode }) {
  const [{ key, model }, setStored] = useState(loadKey);
  const [denied, setDenied] = useState(false);
  const [preferred, setPref] = useState<EnginePref>(() => {
    try {
      const v = localStorage.getItem(PREF_KEY);
      return v === 'mock' || v === 'internal' ? v : 'claude';
    } catch {
      return 'claude';
    }
  });
  const keyClient = useMemo(() => (key && !denied ? createClient(key, model || DEFAULT_MODEL) : null), [key, model, denied]);
  const keyProvider = useMemo(() => (key && !denied ? createProvider('claude_api', { apiKey: key, model: model || DEFAULT_MODEL }) : null), [key, model, denied]);
  const engine: Engine = preferred === 'claude' && keyClient ? 'claude' : 'mock';
  const value = useMemo<AICtx>(
    () => ({
      engine,
      preferred,
      status: keyStatusOf(key, denied),
      // 규칙·사내를 고른 상태에서는 Claude 호출 수단을 내놓지 않는다(호출 지점이 engine 확인을 빠뜨려도 밖으로 나가지 않게)
      client: engine === 'claude' ? keyClient : null,
      universeProvider: engine === 'claude' ? keyProvider : null,
      model: model || DEFAULT_MODEL,
      setPreferred: (e) => {
        setPref(e);
        try {
          localStorage.setItem(PREF_KEY, e);
        } catch {
          /* noop */
        }
      },
      setKey: (k, m) => {
        const next = { key: k === null ? key : k.trim(), model: (m || model || DEFAULT_MODEL).trim() };
        saveKey(next.key, next.model);
        setStored(next);
        setDenied(false);
      },
      onError: (e) => {
        if ((e as { code?: string })?.code === 'auth') setDenied(true);
        return llmErrorText(e);
      },
    }),
    [engine, preferred, keyClient, keyProvider, model, key, denied],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAI() {
  const c = useContext(Ctx);
  if (!c) throw new Error('AIProvider missing');
  return c;
}
