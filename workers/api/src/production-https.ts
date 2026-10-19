/** The production apex must never run Auth, receipt or business code over HTTP.
 * This runs before writer tracking, including in closed/restore modes. */
export function productionHttpsResponse(request: Request, canonicalOrigin?: string): Response | null {
  if (canonicalOrigin !== "https://fanmark.id") return null;
  const url = new URL(request.url);
  if (url.protocol !== "http:" || url.hostname !== "fanmark.id") return null;
  const headers = {"cache-control":"no-store", "referrer-policy":"no-referrer", "x-content-type-options":"nosniff"};
  if (url.port || !["GET","HEAD"].includes(request.method) || request.headers.has("authorization")) {
    return Response.json({error:"https_required"},{status:400,headers});
  }
  url.protocol = "https:";
  url.hash = "";
  // Prevent a legacy fragment token being inherited by the HTTPS destination.
  return new Response(null,{status:307,headers:{...headers,location:url.href+"#"}});
}
