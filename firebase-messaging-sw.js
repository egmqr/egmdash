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
const bc = new BroadcastChannel('egm_deep_links'); // The dedicated Walkie-Talkie

self.addEventListener('install', (e) => self.skipWaiting());
self.addEventListener('activate', (e) => self.clients.claim());

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.stopImmediatePropagation();

  // --- DEEP SEARCH FOR ID ---
  const data = event.notification.data || {};
  const eventId = data.eventId || 
                  (data.FCM_MSG && data.FCM_MSG.data && data.FCM_MSG.data.eventId) || 
                  (data.data && data.data.eventId);

  if (!eventId) return;

  const targetUrl = self.location.origin + '/?openEvent=' + eventId;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      let matchingClient = null;
      for (let i = 0; i < windowClients.length; i++) {
        if (windowClients[i].url.includes('dashboard.createdbyegm.com')) {
          matchingClient = windowClients[i];
          break;
        }
      }

      if (matchingClient) {
        // App is open! Bring to front and shout the ID over the Walkie-Talkie
        return matchingClient.focus().then(() => {
          bc.postMessage({ action: 'openCard', eventId: eventId });
        });
      } else {
        // App is closed! Open fresh with URL parameter
        return clients.openWindow(targetUrl);
      }
    })
  );
});
