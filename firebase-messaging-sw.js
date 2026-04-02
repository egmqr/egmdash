// Import Firebase scripts
importScripts('https://www.gstatic.com/firebasejs/10.8.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.1/firebase-messaging-compat.js');

// Your exact Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyADWnFhu2xZwGQERFsxP-Xl_OlEaJ6N3NM",
  authDomain: "event-database-78db0.firebaseapp.com",
  projectId: "event-database-78db0",
  storageBucket: "event-database-78db0.appspot.com",
  messagingSenderId: "130288942287",
  appId: "1:130288942287:web:68d24ee8d0ef1ae9408bba"
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

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

// --- 2. NOTIFICATION LOGIC ---

// Handle background messages
messaging.onBackgroundMessage((payload) => {
  console.log('[SW] Background message received ', payload);
  // 💡 DO NOT call showNotification here. 
  // Firebase will show the banner automatically because the payload has a 'notification' property.
  // This prevents the "2 notifs" problem.
});

// Handle what happens when the user TAPS the notification
self.addEventListener('notificationclick', (event) => {
  event.notification.close(); 

  // Look for the Event ID in different possible locations in the payload
  const notificationData = event.notification.data;
  const eventId = notificationData?.eventId || notificationData?.FCM_MSG?.data?.eventId;
  
  const urlToOpen = eventId ? `/?openEvent=${eventId}` : '/?tab=events';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Check if dashboard is already open
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if (client.url.includes('dashboard.createdbyegm.com') && 'focus' in client) {
          // Navigate existing tab to the specific event and focus it
          client.navigate(urlToOpen);
          return client.focus();
        }
      }
      // If closed, open a fresh window
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});
