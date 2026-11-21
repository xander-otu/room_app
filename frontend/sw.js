// ---------------------------------------------------------
// sw.js: the service worker. It's what lets phones INSTALL RoomFund
// as an app. It only looks after the page's own files (html, css, js,
// images): it always asks the server first (so you never get old code),
// and only uses its saved copy when there's no internet.
// It never touches your data (items, savings...): those always go to the server.
// ---------------------------------------------------------
const CACHE = "roomfund-v1";
const SHELL = /^\/($|index\.html|manifest\.json|css\/|js\/|img\/)/;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== location.origin || !SHELL.test(url.pathname)) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {                      // online: use the fresh file, and keep a copy
        const copy = response.clone();
        caches.open(CACHE).then((c) => c.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))  // offline: use the saved copy
  );
});
