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

// Version 1.3 - PostMessage Bridge

self.addEventListener('notificationclick', (event) => {
  event.notification.close(); 
  
  const notificationData = event.notification.data;
  const eventId = notificationData?.eventId || notificationData?.FCM_MSG?.data?.eventId;
  
  const baseUrl = self.location.origin;
  const targetUrl = new URL(eventId ? `/?openEvent=${eventId}` : '/?tab=events', baseUrl).href;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        // If the app is already open in the background...
        if (client.url.includes('dashboard.createdbyegm.com') && 'focus' in client) {
          client.focus();
          
          // 🟢 THE FIX: Send a direct radio message to the open app instead of changing the URL!
          if (eventId) {
            client.postMessage({ action: 'openEventCard', eventId: eventId });
          }
          return; 
        }
      }
      
      // If the app was completely closed, open a fresh window (this still relies on the URL)
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
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

// Version 1.1 - Deep Link Update
