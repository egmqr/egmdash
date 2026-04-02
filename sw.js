// A minimal Service Worker just to pass PWA install requirements
self.addEventListener('install', (e) => {
    console.log('[Service Worker] Installed');
    self.skipWaiting();
});

self.addEventListener('activate', (e) => {
    console.log('[Service Worker] Activated');
    return self.clients.claim();
});

self.addEventListener('fetch', (e) => {
    // Just pass the request through to the network
    e.respondWith(fetch(e.request));
});
