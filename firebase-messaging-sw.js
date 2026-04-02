importScripts('https://www.gstatic.com/firebasejs/10.8.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyADWnFhu2xZwGQERFsxP-Xl_OlEaJ6N3NM",
  authDomain: "event-database-78db0.firebaseapp.com",
  projectId: "event-database-78db0",
  storageBucket: "event-database-78db0.appspot.com",
  messagingSenderId: "130288942287",
  appId: "1:130288942287:web:68d24ee8d0ef1ae9408bba"
});

const messaging = firebase.messaging();

// --- PWA LIFECYCLE (Forces the phone to update instantly) ---
self.addEventListener('install', (e) => {
    self.skipWaiting(); 
});
self.addEventListener('activate', (e) => {
    return self.clients.claim(); 
});
self.addEventListener('fetch', (e) => {
    e.respondWith(fetch(e.request));
});

// --- SMART CLICK HANDLER (Deep Linking) ---
self.addEventListener('notificationclick', (event) => {
  event.notification.close(); 
  
  // Find the event ID in the payload
  const notificationData = event.notification.data;
  const eventId = notificationData?.eventId || notificationData?.FCM_MSG?.data?.eventId;
  const urlToOpen = eventId ? `/?openEvent=${eventId}` : '/?tab=events';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if (client.url.includes('dashboard.createdbyegm.com') && 'focus' in client) {
          client.navigate(urlToOpen); 
          return client.focus(); 
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});

// --- 1. PWA LIFECYCLE HANDLERS (Merged from sw.js) ---
self.addEventListener('install', (e) => {
    self.skipWaiting();
});

self.addEventListener('activate', (e) => {
    return self.clients.claim();
});

self.addEventListener('fetch', (e) => {
    // Standard fetch pass-through
    e.respondWith(fetch(e.request));
});

