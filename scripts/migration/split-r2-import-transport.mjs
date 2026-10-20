/** Keep importer logical bucket/key identities over separate physical buckets. */
export function createSplitR2ImportTransport({ avatars, covers } = {}) {
  if ([avatars, covers].some(bucket => !bucket || typeof bucket.get !== 'function' ||
      typeof bucket.putWithSize !== 'function')) throw new Error('split_r2_transport_missing');
  function route(logicalKey) {
    if (typeof logicalKey !== 'string') throw new Error('split_r2_key_invalid');
    const match = /^(avatars|cover-images)\/(.+)$/u.exec(logicalKey);
    if (!match) throw new Error('split_r2_key_invalid');
    return { bucket: match[1] === 'avatars' ? avatars : covers, physicalKey: match[2] };
  }
  return {
    async get(logicalKey) {
      const { bucket, physicalKey } = route(logicalKey);
      const object = await bucket.get(physicalKey);
      if (object === null) return null;
      if (!object || object.key !== physicalKey) throw new Error('split_r2_read_identity_mismatch');
      const body = object.body;
      // The core reconciles its logical source bucket/key. The app binding
      // reads the unprefixed physical key from the already-selected bucket.
      return { key: logicalKey, size: object.size, httpMetadata: object.httpMetadata,
        customMetadata: object.customMetadata, body,
        arrayBuffer: () => new Response(body).arrayBuffer() };
    },
    async putWithSize(logicalKey, stream, options, size) {
      const { bucket, physicalKey } = route(logicalKey);
      const result = await bucket.putWithSize(physicalKey, stream, options, size);
      if (result === null) return null;
      if (!result || result.key !== physicalKey) throw new Error('split_r2_write_identity_mismatch');
      return { ...result, key: logicalKey };
    },
  };
}
