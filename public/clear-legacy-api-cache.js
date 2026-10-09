// Imported by the generated service worker. Retire the old backend-response
// cache when this version activates; leave static precache and other caches alone.
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.delete("supabase-cache"));
});
