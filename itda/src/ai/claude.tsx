// AI 엔진 선택(CR-24 D24-9): 본인 API 키가 있으면 Claude, 없으면 규칙 기반.
// 이전의 claude.ai 게시 페이지 방식(window.claude.use('sample'))은 뺐다(사용자 결정 U-6).
import React, { createContext, useContext, useMemo, useState } from 'react';
import { createClient, DEFAULT_MODEL, errorText as llmErrorText, loadKey, saveKey, type LlmClient } from './llm';

export type Engine = 'claude' | 'mock';
type Status = 'available' | 'unavailable';

interface AICtx {
  engine: Engine; // 실제로 쓸 엔진
  preferred: Engine;
  status: Status; // 키가 있으면 available
  client: LlmClient | null;
  model: string;
  setPreferred: (e: Engine) => void;
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
  const [preferred, setPref] = useState<Engine>(() => {
    try {
      return (localStorage.getItem(PREF_KEY) as Engine) || 'claude';
    } catch {
      return 'claude';
    }
  });
  const client = useMemo(() => (key && !denied ? createClient(key, model || DEFAULT_MODEL) : null), [key, model, denied]);
  const value = useMemo<AICtx>(
    () => ({
      engine: preferred === 'claude' && client ? 'claude' : 'mock',
      preferred,
      status: client ? 'available' : 'unavailable',
      client,
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
    [preferred, client, model, key],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAI() {
  const c = useContext(Ctx);
  if (!c) throw new Error('AIProvider missing');
  return c;
}
