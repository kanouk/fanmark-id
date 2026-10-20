// Kept free of filesystem and credentials so generic importers can reject a
// production transport without loading the production configuration or journal.
const bindings = new WeakSet();
export const registerProductionRemoteD1 = binding => bindings.add(binding);
export const isProductionRemoteD1 = binding => bindings.has(binding);
