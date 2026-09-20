import {
  AVAILABILITY_BODY_TIMEOUT_MS,
  MAX_AVAILABILITY_RESPONSE_BYTES,
  AvailabilityConfigurationError,
  AvailabilityTimeoutError,
  AvailabilityUpstreamError,
  sanitizeAvailabilityResult,
  type AvailabilityRepository,
  type AvailabilityResult,
} from "./availability";
import {
  configuredSupabaseKey,
  configuredSupabaseTimeout,
  configuredSupabaseUrl,
  isAbortError,
  type Env,
  type OutboundFetch,
} from "./repository";

const AVAILABILITY_RPC_PATH = "/rest/v1/rpc/check_fanmark_availability";

async function cancelAndRelease(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  void reader.cancel().catch(() => undefined);
  reader.releaseLock();
}

async function readChunkWithDeadline(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  deadline: number,
): Promise<ReadableStreamReadResult<Uint8Array> | null> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return null;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), remaining);
  });
  try {
    return await Promise.race([reader.read(), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function readBoundedJson(
  response: Response,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<unknown> {
  if (!response.body) throw new AvailabilityUpstreamError();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;
  const deadline = Date.now() + Math.min(timeoutMs, AVAILABILITY_BODY_TIMEOUT_MS);
  try {
    while (true) {
      if (signal.aborted) {
        await cancelAndRelease(reader);
        throw new AvailabilityTimeoutError();
      }
      const chunk = await readChunkWithDeadline(reader, deadline);
      if (chunk === null) {
        await cancelAndRelease(reader);
        throw new AvailabilityTimeoutError();
      }
      const { done, value } = chunk;
      if (done) break;
      if (!value) continue;
      totalLength += value.byteLength;
      if (totalLength > MAX_AVAILABILITY_RESPONSE_BYTES) {
        await cancelAndRelease(reader);
        throw new AvailabilityUpstreamError();
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof AvailabilityTimeoutError || error instanceof AvailabilityUpstreamError) {
      throw error;
    }
    await cancelAndRelease(reader);
    if (signal.aborted || isAbortError(error)) throw new AvailabilityTimeoutError();
    throw new AvailabilityUpstreamError();
  }
  reader.releaseLock();

  const bytes = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new AvailabilityUpstreamError();
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new AvailabilityUpstreamError();
  }
}

export function createSupabaseAvailabilityRepository(
  env: Env,
  outboundFetch: OutboundFetch,
): AvailabilityRepository {
  let key: string;
  let baseUrl: URL;
  let timeoutMs: number;
  try {
    key = configuredSupabaseKey(env);
    baseUrl = configuredSupabaseUrl(env);
    timeoutMs = configuredSupabaseTimeout(env);
  } catch {
    throw new AvailabilityConfigurationError();
  }

  return {
    async checkAvailability(emojiIds: string[]): Promise<AvailabilityResult> {
      const endpoint = new URL(AVAILABILITY_RPC_PATH, baseUrl);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;

      try {
        response = await outboundFetch(endpoint.toString(), {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            apikey: key,
          },
          body: JSON.stringify({ input_emoji_ids: emojiIds }),
          signal: controller.signal,
          redirect: "manual",
        });
      } catch (error) {
        clearTimeout(timeoutId);
        if (controller.signal.aborted || isAbortError(error)) {
          throw new AvailabilityTimeoutError();
        }
        throw new AvailabilityUpstreamError();
      }

      try {
        if (response.status >= 300 && response.status < 400) {
          throw new AvailabilityUpstreamError();
        }
        if (!response.ok) throw new AvailabilityUpstreamError();

        const body: unknown = await readBoundedJson(response, controller.signal, timeoutMs);
        if (controller.signal.aborted) throw new AvailabilityTimeoutError();
        return sanitizeAvailabilityResult(body);
      } catch (error) {
        if (
          error instanceof AvailabilityUpstreamError ||
          error instanceof AvailabilityTimeoutError
        ) {
          throw error;
        }
        if (controller.signal.aborted || isAbortError(error)) {
          throw new AvailabilityTimeoutError();
        }
        throw new AvailabilityUpstreamError();
      } finally {
        clearTimeout(timeoutId);
      }
    },
  };
}
