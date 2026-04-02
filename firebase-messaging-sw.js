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

let pendingEventId = null; // 🟢 The SW Memory Bank

self.addEventListener('install', (e) => self.skipWaiting());
self.addEventListener('activate', (e) => self.clients.claim());

self.addEventListener('notificationclick', (event) => {
  event.stopImmediatePropagation(); 
  event.notification.close();

  const notifData = event.notification.data || {};
  const fcmData = notifData.FCM_MSG ? notifData.FCM_MSG.data : notifData;
  const eventId = fcmData.eventId || notifData.eventId;
  
  if (!eventId) return;

  // Store it in memory safely!
  pendingEventId = eventId; 

  const targetUrl = self.location.origin + '/?openEvent=' + eventId;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (let i = 0; i < clientList.length; i++) {
        const client = clientList[i];
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus(); // Wake up the app!
        }
      }
      if (clients.openWindow) return clients.openWindow(targetUrl); // Cold start
    })
  );
});

// 🟢 NEW: When the app wakes up, it will ask us if we have an ID waiting!
self.addEventListener('message', (event) => {
  if (event.data && event.data.action === 'checkPendingClick') {
    if (pendingEventId) {
      // Send it back to the app!
      event.source.postMessage({ action: 'openCard', eventId: pendingEventId });
      pendingEventId = null; // Clear it so it only opens once
    }
  }
});
