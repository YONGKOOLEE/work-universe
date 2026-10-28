// Claude 호출(CR-24 D24-9): 본인 API 키 + 공식 SDK(번들에 묶음). 업무 유니버스 llm/providers.js와 같은 방식 —
// 구조화된 JSON 응답(output_config.format), 시간 제한, 거절·잘림·형식 오류 구분. 네트워크는 SDK만 부르고 api.anthropic.com으로만 간다.
// 키는 이 브라우저 저장소(KEY_STORE)에만 두고 업무 데이터(AppState)·내보내기에는 넣지 않는다.
import Anthropic from '@anthropic-ai/sdk';
import { jsonSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/json-schema';

export const DEFAULT_MODEL = 'claude-opus-5-5';
export const KEY_STORE = 'itda-anthropic-key';
export const MODEL_STORE = 'itda-anthropic-model';
export const LLM_EFFORT = 'medium';

/** 호출 종류별 상한(화면 대기 문구와 같은 값) */
export const LIMITS = {
  extract: { maxTokens: 32000, timeoutMs: 120000 }, // 문서 분석(긴 문서)
  review: { maxTokens: 16000, timeoutMs: 90000 }, // 꼼꼼히 읽기(두 번째 대조 호출)
  ask: { maxTokens: 8000, timeoutMs: 60000 }, // AI 업무 검색
  check: { maxTokens: 16000, timeoutMs: 90000 }, // 사전 점검·업무 점검(Claude)
  explain: { maxTokens: 4000, timeoutMs: 45000 }, // 지도 요약 문장
} as const;

export type LlmErrorCode = 'auth' | 'rate' | 'timeout' | 'network' | 'refusal' | 'format' | 'too_large' | 'cancelled' | 'server';
export class LlmError extends Error {
  constructor(
    readonly code: LlmErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export function errorText(e: unknown): string {
  const code = e instanceof LlmError ? e.code : 'server';
  switch (code) {
    case 'auth':
      return 'API 키가 거부되었습니다. 설정에서 키를 확인하세요.';
    case 'rate':
      return '호출이 너무 잦거나 사용량 한도에 도달했습니다. 잠시 후 다시 시도하세요.';
    case 'timeout':
      return '응답 시간이 초과되었습니다. 문서를 나눠 다시 시도하거나 규칙 기반으로 분석하세요.';
    case 'network':
      return '인터넷 연결이 없거나 api.anthropic.com에 닿지 못했습니다. 규칙 기반으로 분석합니다.';
    case 'refusal':
      return 'Claude가 이 요청에 답하지 않았습니다. 내용을 바꿔 다시 시도하세요.';
    case 'format':
      return 'Claude 응답을 해석하지 못했습니다(형식 오류 또는 길이 초과). 다시 시도하세요.';
    case 'too_large':
      return '문서가 너무 깁니다. 일부만 넣어 다시 시도하세요.';
    case 'cancelled':
      return '요청을 취소했습니다.';
    default:
      return 'Claude 호출 중 오류가 발생했습니다. 다시 시도하거나 규칙 기반으로 분석하세요.';
  }
}

function classify(err: any): LlmError {
  if (err instanceof LlmError) return err;
  const status = err?.status;
  const name = err?.name || err?.constructor?.name || '';
  if (err instanceof Anthropic.APIUserAbortError || name === 'APIUserAbortError' || err?.name === 'AbortError' || /request was aborted/i.test(String(err?.message || ''))) return new LlmError('cancelled', '취소');
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new LlmError('timeout', '시간 초과');
  if (err instanceof Anthropic.APIConnectionError) return new LlmError('network', '연결 실패');
  if (status === 401 || status === 403) return new LlmError('auth', '키 거부');
  if (status === 429) return new LlmError('rate', '한도');
  if (status === 413) return new LlmError('too_large', '너무 김');
  // 번들에서는 클래스 이름이 줄어들 수 있어 SDK 오류 문구로도 가른다
  const msg = String(err?.message || '');
  if (name === 'APIConnectionTimeoutError' || /timed out|timeout/i.test(msg)) return new LlmError('timeout', '시간 초과');
  if (name === 'APIConnectionError' || /connection error|failed to fetch|network/i.test(msg)) return new LlmError('network', '연결 실패');
  if (status && status >= 500) return new LlmError('server', `서버 오류 ${status}`);
  return new LlmError('server', String(err?.message || err).slice(0, 200));
}

export interface JsonRequest {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  limit: keyof typeof LIMITS;
}

export interface LlmClient {
  model: string;
  json<T>(req: JsonRequest, signal?: AbortSignal): Promise<T>;
}

const parseJsonOrNull = (content: string) => {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
};

/** 시험용으로 SDK 대신 가짜 클라이언트를 넣을 수 있다(sdk.messages.parse만 쓴다) */
export function createClient(apiKey: string, model = DEFAULT_MODEL, sdk: any = null): LlmClient {
  const cli = sdk ?? new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 0 });
  return {
    model,
    async json<T>({ system, user, schema, limit }: JsonRequest, signal?: AbortSignal): Promise<T> {
      const lim = LIMITS[limit];
      let msg: any;
      try {
        msg = await cli.messages.parse(
          {
            model,
            max_tokens: lim.maxTokens,
            system,
            messages: [{ role: 'user', content: user }],
            output_config: { effort: LLM_EFFORT, format: { ...jsonSchemaOutputFormat(schema as any), parse: parseJsonOrNull } },
          },
          { timeout: lim.timeoutMs, maxRetries: 0, signal },
        );
      } catch (err) {
        throw classify(err);
      }
      if (msg?.stop_reason === 'refusal') throw new LlmError('refusal', '거절');
      if (msg?.stop_reason === 'max_tokens') throw new LlmError('format', '응답이 길어 도중에 끊김');
      let out = msg?.parsed_output ?? null;
      if (!out && Array.isArray(msg?.content)) {
        const block = msg.content.find((b: any) => b?.type === 'text' && typeof b.text === 'string');
        out = block ? parseJsonOrNull(block.text) : null;
      }
      if (!out || typeof out !== 'object' || Array.isArray(out)) throw new LlmError('format', '응답 형식 오류');
      return out as T;
    },
  };
}

// JSON 스키마 도우미(구조화된 응답은 모든 칸 required + additionalProperties false)
export const S = {
  str: { type: 'string' },
  strOrNull: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  bool: { type: 'boolean' },
  num: { type: 'number' },
  arr: (items: object) => ({ type: 'array', items }),
  enumOf: (values: string[]) => ({ type: 'string', enum: values }),
  obj: (props: Record<string, object>) => ({ type: 'object', properties: props, required: Object.keys(props), additionalProperties: false }),
};

/** 키 보관(이 브라우저만). 저장소를 못 쓰면 빈 값 */
export function loadKey(): { key: string; model: string } {
  try {
    return { key: localStorage.getItem(KEY_STORE) || '', model: localStorage.getItem(MODEL_STORE) || DEFAULT_MODEL };
  } catch {
    return { key: '', model: DEFAULT_MODEL };
  }
}
export function saveKey(key: string, model: string) {
  try {
    if (key) localStorage.setItem(KEY_STORE, key);
    else localStorage.removeItem(KEY_STORE);
    localStorage.setItem(MODEL_STORE, model || DEFAULT_MODEL);
  } catch {
    /* 저장소를 못 쓰면 이번 화면에서만 쓴다 */
  }
}
