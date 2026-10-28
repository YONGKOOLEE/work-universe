// Claude 연결 (claude.ai 게시 페이지의 sample 기능).
// 페이지를 여는 사람의 Claude 계정으로 호출되며, 첫 호출 시 사용 동의 창이 뜬다.
// claude.ai 밖(로컬 실행 등)에서는 연결되지 않으므로 규칙 기반 Mock 엔진으로 동작한다.
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

type SampleOpts = { modelTier?: 'quick' | 'default' | 'complex'; cache?: boolean; signal?: AbortSignal; onText?: (u: { text: string; delta: string }) => void };
export interface SampleFn {
  (input: string, opts?: SampleOpts): Promise<{ text: string; truncated: boolean }>;
  json<T = unknown>(input: string, opts?: SampleOpts): Promise<T>;
}
export interface SampleError {
  code: string;
  message: string;
  text?: string;
}

export type Engine = 'claude' | 'mock';
type Status = 'checking' | 'available' | 'unavailable' | 'denied';

interface AICtx {
  engine: Engine; // 실제로 사용할 엔진
  preferred: Engine;
  status: Status;
  setPreferred: (e: Engine) => void;
  sample: SampleFn | null;
  /** 호출 실패 처리: 권한 거부류면 Claude를 끄고 Mock으로 전환 */
  onError: (e: unknown) => string;
}

const Ctx = createContext<AICtx | null>(null);
const PREF_KEY = 'worklink-ai-engine';

const PERMANENT = ['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed', 'session_expired'];

export function errorText(code: string) {
  switch (code) {
    case 'not_granted':
      return 'Claude 사용이 허용되지 않았습니다. 이번 화면에서는 Mock 엔진으로 전환합니다.';
    case 'sampling_disabled':
      return '이 계정 또는 조직에서 Claude 호출을 사용할 수 없습니다. Mock 엔진으로 전환합니다.';
    case 'session_expired':
      return 'Claude 로그인이 만료되었습니다. 다시 로그인한 뒤 새로고침하세요.';
    case 'rate_limited':
      return 'Claude 호출이 너무 잦거나 사용량 한도에 도달했습니다. 잠시 후 다시 시도하세요.';
    case 'prompt_too_large':
      return '문서가 너무 깁니다. 본문 일부만 보내도록 줄이거나 Mock 엔진을 사용하세요.';
    case 'invalid_json':
      return 'Claude 응답을 해석하지 못했습니다. 다시 시도하세요.';
    case 'refused':
      return 'Claude가 이 요청에 답하지 않았습니다. 내용을 바꿔 다시 시도하세요.';
    case 'cancelled':
      return '요청을 취소했습니다.';
    default:
      return 'Claude 호출 중 오류가 발생했습니다. 다시 시도하거나 Mock 엔진을 사용하세요.';
  }
}

export function AIProvider({ children }: { children: React.ReactNode }) {
  const [sample, setSample] = useState<SampleFn | null>(null);
  const [status, setStatus] = useState<Status>('checking');
  const [preferred, setPref] = useState<Engine>(() => {
    try {
      return (localStorage.getItem(PREF_KEY) as Engine) || 'claude';
    } catch {
      return 'claude';
    }
  });

  useEffect(() => {
    let alive = true;
    const w = window as unknown as { claude?: { use?: (n: string) => Promise<unknown> } };
    if (!w.claude?.use) {
      setStatus('unavailable');
      return;
    }
    w.claude
      .use('sample')
      .then((fn) => {
        if (!alive) return;
        if (fn) {
          setSample(() => fn as SampleFn);
          setStatus('available');
        } else setStatus('unavailable');
      })
      .catch(() => alive && setStatus('unavailable'));
    return () => {
      alive = false;
    };
  }, []);

  const value = useMemo<AICtx>(
    () => ({
      engine: preferred === 'claude' && status === 'available' && sample ? 'claude' : 'mock',
      preferred,
      status,
      sample,
      setPreferred: (e) => {
        setPref(e);
        try {
          localStorage.setItem(PREF_KEY, e);
        } catch {
          /* noop */
        }
      },
      onError: (e) => {
        const code = (e as SampleError)?.code ?? 'upstream_error';
        if (PERMANENT.includes(code)) setStatus('denied');
        return errorText(code);
      },
    }),
    [preferred, status, sample],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAI() {
  const c = useContext(Ctx);
  if (!c) throw new Error('AIProvider missing');
  return c;
}
