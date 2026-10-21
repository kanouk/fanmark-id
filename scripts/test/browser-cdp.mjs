// CDP transport shared by local browser regression tests.
export function cdpConnection(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  const pending = new Map();
  const listeners = new Map();
  let nextId = 0;
  const opened = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("browser_cdp_connect_timeout")), 15_000);
    socket.addEventListener("open", () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("browser_cdp_connect_failed"));
    }, { once: true });
  });
  socket.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (Number.isInteger(message.id)) {
      const operation = pending.get(message.id);
      if (!operation) return;
      pending.delete(message.id);
      clearTimeout(operation.timeout);
      if (message.error) {
        // Keep protocol diagnostics useful without copying request parameters,
        // URLs, cookies or arbitrary provider messages into CI output.
        const code = Number.isInteger(message.error.code) ? message.error.code : "unknown";
        const kind = /invalid\s+(?:interceptionid|interception id)/iu.test(String(message.error.message))
          ? "invalid_interception_id" : "other";
        operation.reject(new Error(`browser_cdp_command_failed:${operation.method}:${code}:${kind}`));
      }
      else operation.resolve(message.result ?? {});
      return;
    }
    for (const listener of listeners.get(message.method) ?? []) listener(message.params ?? {});
  });
  socket.addEventListener("close", () => {
    for (const operation of pending.values()) {
      clearTimeout(operation.timeout);
      operation.reject(new Error("browser_cdp_closed"));
    }
    pending.clear();
  });

  return {
    opened,
    on(method, listener) {
      const entries = listeners.get(method) ?? new Set();
      entries.add(listener);
      listeners.set(method, entries);
      return () => entries.delete(listener);
    },
    send(method, params = {}) {
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(new Error("browser_cdp_timeout"));
        }, 15_000);
        pending.set(id, { resolve, reject, timeout, method });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
    },
  };
}

