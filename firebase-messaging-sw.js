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

self.addEventListener('install', (e) => self.skipWaiting());
self.addEventListener('activate', (e) => self.clients.claim());
self.addEventListener('fetch', (e) => e.respondWith(fetch(e.request)));

// Version 3.0 - Perfected Warm/Cold Start Handler
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.stopImmediatePropagation(); // Crucial: Stop Firebase SDK from stealing the click

  const rawData = event.notification.data || {};
  let eventId = rawData.eventId || (rawData.FCM_MSG && rawData.FCM_MSG.data && rawData.FCM_MSG.data.eventId) || (rawData.data && rawData.data.eventId);
  
  if (!eventId) return;

  const targetUrl = self.location.origin + '/?openEvent=' + eventId;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if (client.url.includes('dashboard.createdbyegm.com')) {
          // WARM START: App is already open. Bring to front and send radio message!
          client.focus();
          client.postMessage({ action: 'openEventCard', eventId: eventId });
          return;
        }
      }
      // COLD START: App is fully closed. Open new window with URL parameter.
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});
