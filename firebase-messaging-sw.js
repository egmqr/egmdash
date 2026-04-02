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

// Version 1.4 - The Payload Hunter

self.addEventListener('notificationclick', (event) => {
  event.notification.close(); 
  
  // Grab the raw data object
  const rawData = event.notification.data || {};
  
  // Hunt for the eventId in all the places Firebase usually hides it
  let eventId = null;
  if (rawData.eventId) {
      eventId = rawData.eventId;
  } else if (rawData.FCM_MSG && rawData.FCM_MSG.data && rawData.FCM_MSG.data.eventId) {
      eventId = rawData.FCM_MSG.data.eventId;
  } else if (rawData.data && rawData.data.eventId) {
      eventId = rawData.data.eventId;
  }
  
  const baseUrl = self.location.origin;
  const targetUrl = new URL(eventId ? `/?openEvent=${eventId}` : '/?tab=events', baseUrl).href;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if (client.url.includes('dashboard.createdbyegm.com') && 'focus' in client) {
          client.focus();
          
          // Send the ID, plus the raw JSON data so our dashboard can alert us if it fails
          client.postMessage({ 
              action: 'openEventCard', 
              eventId: eventId,
              debugPayload: JSON.stringify(rawData)
          });
          return; 
        }
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
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
