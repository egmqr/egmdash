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

// --- SMART CLICK HANDLER ---
self.addEventListener('notificationclick', (event) => {
  event.notification.close(); 
  
  // 🟢 CRITICAL: This stops Firebase's default code from overriding our custom click logic!
  event.stopImmediatePropagation(); 

  // 1. Hunt down the Event ID
  const rawData = event.notification.data || {};
  let eventId = rawData.eventId || (rawData.FCM_MSG && rawData.FCM_MSG.data && rawData.FCM_MSG.data.eventId) || (rawData.data && rawData.data.eventId);
  
  if (!eventId) return; 

  // 2. Write the Event ID to a temporary Cache file
  event.waitUntil(
    caches.open('egm-pwa-data').then(cache => {
      return cache.put('/pending-event', new Response(eventId));
    }).then(() => {
      
      const baseUrl = self.location.origin;
      const targetUrl = baseUrl + '/?openEvent=' + eventId;
      
      return clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
        for (let i = 0; i < windowClients.length; i++) {
          const client = windowClients[i];
          if (client.url.includes('dashboard.createdbyegm.com') && 'focus' in client) {
            // Backup Radio Message
            client.postMessage({ action: 'openEventCard', eventId: eventId });
            return client.focus(); 
          }
        }
        // If app is fully closed, open it to the specific URL
        if (clients.openWindow) return clients.openWindow(targetUrl);
      });
      
    })
  );
});
