import { setTimeout as delay } from 'node:timers/promises';

export function recordCanceledNetworkRequest(canceledRequests, event) {
  if (event.canceled === true && typeof event.requestId === 'string' && event.requestId) {
    canceledRequests.add(event.requestId);
  }
}

/** A page can cancel a paused request before Chrome processes continueRequest. */
export async function continuePausedRequest(cdp, event, canceledRequests, receiptTimeoutMs = 250) {
  try {
    await cdp.send('Fetch.continueRequest', { requestId: event.requestId });
    return { canceled: false };
  } catch (error) {
    // An invalid ID alone is not proof of cancellation. Require Chrome's
    // loadingFailed(canceled=true) receipt for this exact Network request.
    if (error?.message !== 'browser_cdp_command_failed:Fetch.continueRequest:-32602:invalid_interception_id' ||
        typeof event.networkId !== 'string' || !event.networkId) throw error;
    const deadline = Date.now() + receiptTimeoutMs;
    while (!canceledRequests.has(event.networkId) && Date.now() < deadline) await delay(10);
    if (!canceledRequests.has(event.networkId)) throw error;
    return { canceled: true };
  }
}
