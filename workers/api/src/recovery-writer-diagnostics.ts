/** Fixed vocabulary only: never emit arbitrary exception messages or payloads. */
export function recoveryWriterException(error: unknown) {
  const value = error instanceof Error ? error as Error & { retryable?: boolean; remote?: boolean; overloaded?: boolean } : null;
  const message = value?.message ?? '';
  const category = value?.overloaded === true ? 'overloaded'
    : /network connection lost|disconnected/iu.test(message) ? 'connection-lost'
    : /reset because its code was updated|instance is no longer active/iu.test(message) ? 'instance-replaced'
    : /storage operation exceeded timeout/iu.test(message) ? 'storage-timeout'
    : /never generate a response|unresolved promise/iu.test(message) ? 'unresolved-promise'
    : /I\/O.*different request|different request.*I\/O/iu.test(message) ? 'cross-request-io'
    : /internal error/iu.test(message) ? 'internal-error' : 'unclassified';
  return { category, retryable: value?.retryable === true, remote: value?.remote === true,
    overloaded: value?.overloaded === true };
}

export function recoveryWriterTiming(value: string | null): number | null {
  return value !== null && /^(?:0|[1-9][0-9]{0,8})$/u.test(value) ? Number(value) : null;
}
