export function safeWranglerDiagnostics(output) {
  return String(output).split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-20)
    .map((line) => line
      .replace(/\u001b\[[0-9;]*m/gu, "")
      .replace(/Bearer\s+\S+/giu, "Bearer [redacted]")
      .replace(/(password|token|secret|api[_-]?key)(\s*[:=]\s*)\S+/giu, "$1$2[redacted]")
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, "[redacted-email]")
      .replace(/\b[A-Za-z0-9_-]{64,}\b/gu, "[redacted]")
      .slice(0, 500));
}

export function safeErrorSummary(error) {
  const message = error instanceof Error ? error.message : String(error ?? "unknown");
  return safeWranglerDiagnostics(message).join(" ").slice(0, 1_500);
}
