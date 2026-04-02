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

// 🟢 CUSTOM NOTIFICATION CLICK HANDLER 🟢
self.addEventListener('notificationclick', function(event) {
    event.notification.close(); // Dismiss the notification

    // Extract eventId. Firebase sometimes nests this inside FCM_MSG
    const dataPayload = event.notification.data || {};
    const fcmData = dataPayload.FCM_MSG ? dataPayload.FCM_MSG.data : dataPayload;
    const eventId = fcmData.eventId;
    
    const targetUrl = eventId 
        ? 'https://dashboard.createdbyegm.com/?openEvent=' + eventId 
        : 'https://dashboard.createdbyegm.com/';

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            // Check if the dashboard is already open in a tab/PWA window
            for (let i = 0; i < clientList.length; i++) {
                let client = clientList[i];
                if (client.url.includes('dashboard.createdbyegm.com') && 'focus' in client) {
                    return client.focus().then(() => {
                        if (eventId) {
                            // The app is already open. Send a message to trigger the modal instantly.
                            client.postMessage({
                                type: 'OPEN_EVENT',
                                eventId: eventId
                            });
                        }
                    });
                }
            }
            
            // If the app is completely closed, open a new window with the URL parameter
            if (clients.openWindow) {
                return clients.openWindow(targetUrl);
            }
        })
    );
});
