const cacheName = "cbi-high-performance-v3";
const appFiles = ["./", "./index.html", "./styles.css", "./app.js", "./api.js", "./manifest.webmanifest", "./assets/icon.svg", "./assets/maskable-icon.svg", "./assets/cairns-basketball-logo.png"];
self.addEventListener("install", (event) => event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll(appFiles))));
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== location.origin) return;
  event.respondWith(fetch(event.request).then((response) => {
    const copy = response.clone();
    caches.open(cacheName).then((cache) => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match(event.request)));
});
