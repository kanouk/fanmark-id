/** Local synthetic-test bridge only. Streams have an explicit native R2 length. */
export const LOCAL_R2_IMPORT_WORKER = `
      function decode(value) {
        const binary = atob(value);
        const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
        return JSON.parse(new TextDecoder().decode(bytes));
      }
      export default {
        async fetch(request, env) {
          if (request.method !== "POST") return new Response("method", { status: 405 });
          const payload = decode(request.headers.get("x-r2-payload"));
          const length = Number(request.headers.get("content-length"));
          const { readable, writable } = new FixedLengthStream(length);
          const pumpAbort = new AbortController();
          const pump = request.body
            ? request.body.pipeTo(writable, { signal: pumpAbort.signal })
            : writable.close();
          // The provider may return null immediately for a failed conditional
          // create. Keep the pump rejection observed while we decide whether
          // to abort it, but do not wait for it before handling that result.
          void pump.catch(() => {});
          const stopPump = async () => {
            pumpAbort.abort("r2 write stopped");
            try {
              await writable.abort("r2 write stopped");
            } catch {}
            await Promise.race([
              pump.catch(() => {}),
              new Promise((resolve) => setTimeout(resolve, 100)),
            ]);
          };
          let result;
          try {
            const binding = payload.bucketBinding ?? "R2";
            if (!["R2", "AVATARS_BUCKET", "COVER_IMAGES_BUCKET"].includes(binding)) throw new Error("local_binding_invalid");
            result = await env[binding].put(payload.key, readable, {
              onlyIf: payload.onlyIf,
              sha256: payload.sha256,
              httpMetadata: payload.httpMetadata ?? undefined,
              customMetadata: payload.customMetadata,
            });
          } catch {
            await stopPump();
            return new Response("write", { status: 500 });
          }
          if (result === null) {
            await stopPump();
            return new Response(null, { status: 412 });
          }
          try {
            await pump;
          } catch {
            await stopPump();
            return new Response("write", { status: 500 });
          }
          return Response.json({ key: result.key, size: result.size });
        },
      };
    `;

export function createLocalR2ImportTransport({ bucket, loopbackBase, bucketBinding = "R2" }) {
return {
      get: bucket.get.bind(bucket),
      async putWithSize(key, stream, options, size) {
        const payload = Buffer.from(JSON.stringify({
          key, bucketBinding,
          onlyIf: options.onlyIf,
          sha256: options.sha256,
          httpMetadata: options.httpMetadata ?? null,
          customMetadata: options.customMetadata ?? {},
        })).toString("base64");
        const response = await fetch(new URL("/put", loopbackBase), {
          method: "POST",
          headers: {
            "content-length": String(size),
            "x-r2-payload": payload,
          },
          body: stream,
          duplex: "half",
        });
        if (response.status === 412) return null;
        if (!response.ok) throw new Error(`local R2 worker write failed (${response.status})`);
        return response.json();
      },
    };
}
