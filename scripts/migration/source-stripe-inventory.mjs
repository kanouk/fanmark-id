/** GET-only provider inventory. No fulfillment, retry, expiration, or readiness decision. */
const ACCOUNTS = {live: 'acct_1SFjhvJk0VCfiKUp', test: 'acct_1SFjnMJ9Sc4J9g7E'};
const ID = /^[A-Za-z][A-Za-z0-9_]{1,199}$/u;
const requireValue = (ok, code) => { if (!ok) throw new Error(code); };
const integer = value => Number.isSafeInteger(value) && value >= 0;
const reference = value => {
  const id = typeof value === 'object' && value !== null ? value.id : value;
  requireValue(id === null || (typeof id === 'string' && ID.test(id)), 'stripe_inventory_reference_invalid');
  return id;
};
const status = (value, allowed) => {
  requireValue(allowed.includes(value), 'stripe_inventory_status_unknown');
  return value;
};
const definitions = [
  ['checkoutSessions', '/v1/checkout/sessions', {}, 'checkout.session'],
  ['subscriptions', '/v1/subscriptions', {status: 'all'}, 'subscription'],
  ['invoices', '/v1/invoices', {}, 'invoice'],
  ['paymentIntents', '/v1/payment_intents', {}, 'payment_intent'],
  ['paymentLinks', '/v1/payment_links', {}, 'payment_link'],
  ['recentEvents', '/v1/events', {}, 'event'],
];

function project(row, name, livemode, object) {
  requireValue(row && row.object === object && typeof row.id === 'string' && ID.test(row.id) && row.livemode === livemode,
    'stripe_inventory_row_identity_invalid');
  const out = {id: row.id, livemode};
  if (name !== 'paymentLinks') {
    requireValue(integer(row.created), 'stripe_inventory_created_invalid');
    out.created = row.created;
  }
  if (name === 'checkoutSessions') {
    out.status = status(row.status, ['open', 'complete', 'expired']);
    out.paymentStatus = status(row.payment_status, ['paid', 'unpaid', 'no_payment_required']);
    out.mode = status(row.mode, ['payment', 'subscription', 'setup']);
    requireValue(integer(row.expires_at), 'stripe_inventory_expiry_invalid');
    out.expiresAt = row.expires_at;
    out.paymentIntent = reference(row.payment_intent);
    out.subscription = reference(row.subscription);
    out.metadata = {};
    requireValue(row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata),
      'stripe_inventory_metadata_invalid');
    // Only correlation fields used by the old application, never arbitrary customer data.
    for (const key of ['type', 'user_id', 'fanmark_id', 'license_id', 'months']) {
      if (!(key in row.metadata)) continue;
      requireValue(typeof row.metadata[key] === 'string' && row.metadata[key].length <= 200,
        'stripe_inventory_metadata_invalid');
      out.metadata[key] = row.metadata[key];
    }
  } else if (name === 'subscriptions') {
    out.status = status(row.status, ['incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused']);
    out.customer = reference(row.customer);
  } else if (name === 'invoices') {
    out.status = status(row.status, [null, 'draft', 'open', 'paid', 'uncollectible', 'void']);
    out.customer = reference(row.customer);
  } else if (name === 'paymentIntents') {
    out.status = status(row.status, ['requires_payment_method', 'requires_confirmation', 'requires_action', 'processing', 'requires_capture', 'canceled', 'succeeded']);
  } else if (name === 'paymentLinks') {
    requireValue(typeof row.active === 'boolean', 'stripe_inventory_active_invalid');
    out.active = row.active;
  } else {
    requireValue(typeof row.type === 'string' && /^[a-z][a-z0-9_.]{1,199}$/u.test(row.type) && integer(row.pending_webhooks),
      'stripe_inventory_event_invalid');
    out.type = row.type;
    out.pendingWebhooks = row.pending_webhooks;
    out.objectId = reference(row.data?.object?.id);
  }
  return out;
}

export async function collectSourceStripeInventory({secret, mode, fetchImpl = globalThis.fetch, maxPages = 20}) {
  requireValue(Object.hasOwn(ACCOUNTS, mode) && typeof secret === 'string' &&
    new RegExp(`^(sk|rk)_${mode}_[A-Za-z0-9]+$`, 'u').test(secret), 'stripe_inventory_credential_mode_invalid');
  requireValue(typeof fetchImpl === 'function' && Number.isInteger(maxPages) && maxPages > 0 && maxPages <= 100,
    'stripe_inventory_options_invalid');
  const startedAt = new Date().toISOString();
  let requests = 0;
  async function get(path, query = {}) {
    const url = new URL(path, 'https://api.stripe.com');
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    let response;
    try {
      requests++;
      response = await fetchImpl(url.href, {method: 'GET', headers: {authorization: `Bearer ${secret}`},
        redirect: 'error', signal: AbortSignal.timeout(15000)});
    } catch { throw new Error('stripe_inventory_transport_failed'); }
    if (response?.ok !== true) {
      try { await response?.body?.cancel(); } catch { /* Never echo provider errors. */ }
      throw new Error('stripe_inventory_http_failed');
    }
    try { return await response.json(); }
    catch { throw new Error('stripe_inventory_json_invalid'); }
  }
  const account = await get('/v1/account');
  requireValue(account?.object === 'account' && account.id === ACCOUNTS[mode], 'stripe_inventory_account_mismatch');
  const inventory = {};
  for (const [name, path, filters, object] of definitions) {
    const rows = [], ids = new Set();
    let cursor, complete = false, pages = 0;
    while (!complete && pages < maxPages) {
      const page = await get(path, {...filters, limit: '100', ...(cursor ? {starting_after: cursor} : {})});
      pages++;
      requireValue(page?.object === 'list' && Array.isArray(page.data) && page.data.length <= 100 &&
        typeof page.has_more === 'boolean' && (!page.has_more || page.data.length > 0), 'stripe_inventory_page_invalid');
      for (const row of page.data) {
        const value = project(row, name, mode === 'live', object);
        requireValue(!ids.has(value.id), 'stripe_inventory_duplicate_row');
        ids.add(value.id); rows.push(value); cursor = value.id;
      }
      complete = !page.has_more;
    }
    requireValue(complete, 'stripe_inventory_page_limit');
    inventory[name] = {pages, rows};
  }
  const counts = {
    openCheckouts: inventory.checkoutSessions.rows.filter(r => r.status === 'open').length,
    completedUnpaidCheckouts: inventory.checkoutSessions.rows.filter(r => r.status === 'complete' && r.paymentStatus === 'unpaid').length,
    paidCheckoutsNeedingSourceCorrelation: inventory.checkoutSessions.rows.filter(r => r.paymentStatus === 'paid').length,
    nonterminalSubscriptions: inventory.subscriptions.rows.filter(r => !['canceled', 'incomplete_expired'].includes(r.status)).length,
    nonterminalInvoices: inventory.invoices.rows.filter(r => !['paid', 'void', 'uncollectible'].includes(r.status)).length,
    nonterminalPaymentIntents: inventory.paymentIntents.rows.filter(r => !['canceled', 'succeeded'].includes(r.status)).length,
    activePaymentLinks: inventory.paymentLinks.rows.filter(r => r.active).length,
    pendingWebhookDeliveries: inventory.recentEvents.rows.reduce((sum, r) => sum + r.pendingWebhooks, 0),
  };
  return {format: 'fanmark-source-stripe-inventory-v1', accountId: account.id, mode, startedAt,
    finishedAt: new Date().toISOString(), requests, financialWrites: 0, listedCollectionsComplete: true,
    atomicSnapshot: false, sourceEffectsReconciled: false, eventDestinationsInventoried: false,
    productionReady: false, counts, inventory};
}
