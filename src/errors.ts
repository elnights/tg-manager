export function describeError(error: unknown): string {
  if (error && typeof error === 'object' && ('seconds' in error || 'errorMessage' in error)) {
    const text = 'errorMessage' in error ? String(error.errorMessage) : String(error);
    if (/FLOOD|SLOWMODE/i.test(text)) {
      const seconds = 'seconds' in error && typeof error.seconds === 'number' ? error.seconds : undefined;
      return `Telegram rate limit${seconds === undefined ? '' : `: server requested ${seconds} seconds`}. Retry later; no live countdown is available. ${String(error)}`;
    }
  }
  return String(error);
}
