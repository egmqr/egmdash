

// Import Firebase scripts (Must match the version in your index.html) GlkXHxNfhcrp6mzG7J2gYPlTNBqkz08V1m9UZpNnBbg
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

// Initialize Firebase in the Service Worker
firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

// Handle background messages
messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message: ', payload);
  
  const notificationTitle = payload.notification.title || "New Update";
  const notificationOptions = {
    body: payload.notification.body,
    icon: '/icon-192.png', // Uses your app icon
    badge: '/icon-192.png',
    data: payload.data // We will pass the eventId in this data object!
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

// Handle what happens when the user TAPS the notification
self.addEventListener('notificationclick', (event) => {
  event.notification.close(); // Close the banner

  // Get the event ID from the payload data
  const eventId = event.notification.data ? event.notification.data.eventId : null;
  const urlToOpen = eventId ? `/?openEvent=${eventId}` : '/?tab=events';

  // Check if the dashboard is already open in the background
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if (client.url.includes('dashboard.createdbyegm.com') && 'focus' in client) {
          client.navigate(urlToOpen); // Force it to the deep link
          return client.focus(); // Bring the app to the front
        }
      }
      // If the app is completely closed, open it fresh
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});
