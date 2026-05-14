// ─────────────────────────────────────────────────────────────────────────────
// firebase-messaging-sw.js
// Kamayega Bharat — FCM Background Message Handler
//
// DEPLOYMENT RULES (these are hard requirements, not suggestions):
//
//   1. This file MUST be served from the ROOT of your domain.
//      e.g. https://kamayegabharat.com/firebase-messaging-sw.js
//      A sub-path like /js/firebase-messaging-sw.js will NOT work.
//      The browser's Service Worker scope is determined by the file's URL path,
//      and FCM requires the scope to cover the entire origin.
//
//   2. This file MUST be served over HTTPS (or localhost for development).
//      Service workers are blocked on plain HTTP.
//
//   3. VERSION MUST MATCH the compat SDK version in your HTML (currently 10.8.0).
//      Mismatched versions cause silent token generation failures.
//
//   4. After deploying any update to this file, users' browsers will pick up
//      the new version automatically within 24 hours, or immediately if they
//      visit the page and the file content has changed (byte-for-byte check).
// ─────────────────────────────────────────────────────────────────────────────

// Import the Firebase compat scripts — must use importScripts() in a SW context,
// NOT ES module import syntax, because service workers predate ES modules.
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

// ── Firebase config — must match your main app exactly ───────────────────────
// Copy these values from Firebase Console → Project Settings → Your apps.
firebase.initializeApp({
    apiKey:            "AIzaSyBjXP4yQWDyCu4p78iA5aKrqICZLt_yxtk",
    authDomain:        "kamayega-bharat.firebaseapp.com",
    projectId:         "kamayega-bharat",
    storageBucket:     "kamayega-bharat.appspot.com",
    messagingSenderId: "595460672260",
    appId:             "1:595460672260:web:6584856313e2d740805e51"
});

const messaging = firebase.messaging();

// ─────────────────────────────────────────────────────────────────────────────
// BACKGROUND MESSAGE HANDLER
//
// This fires when a push message arrives while the page is:
//   - Closed entirely
//   - In a background tab
//   - The screen is off (on Android Chrome)
//
// When the page IS open and focused, firebase.messaging().onMessage() in the
// main app script handles the notification instead (shows a toast, not a
// system notification, so the user isn't double-notified).
// ─────────────────────────────────────────────────────────────────────────────
messaging.onBackgroundMessage(function(payload) {
    console.log('[firebase-messaging-sw.js] Background message received:', payload);

    // FCM payloads have two shapes:
    //   1. Notification message  → payload.notification contains title/body/icon
    //   2. Data-only message     → payload.data contains your custom key/value pairs
    //      (used when you want full control over what the notification says)
    //
    // We handle both shapes below.

    var notification = payload.notification || {};
    var data         = payload.data         || {};

    // Build the notification title and body, falling back to data fields
    // so your Cloud Function can send either shape.
    var title = notification.title
             || data.title
             || 'Kamayega Bharat';

    var body  = notification.body
             || data.body
             || 'You have a new update on your application.';

    // Icon: use a dedicated notification icon if you have one,
    // otherwise fall back to the app favicon.
    // The icon must be an absolute URL (relative paths don't work in SW context).
    var icon  = notification.icon
             || data.icon
             || '/favicon.png';

    // click_action determines which URL opens when the user taps the notification.
    // Default to the seeker console so they land on the right page.
    var clickUrl = notification.click_action
                || data.click_action
                || '/seeker-console.html';

    var notificationOptions = {
        body:  body,
        icon:  icon,
        badge: '/favicon.png',   // small monochrome icon shown in the Android status bar
        tag:   data.tag || 'kb-notification', // grouping tag — same tag replaces previous notification
        data:  { url: clickUrl },             // passed to the click handler below
        // Actions appear as buttons on the notification on supported platforms
        actions: [
            { action: 'open',    title: '📋 Open Dashboard' },
            { action: 'dismiss', title: '✕ Dismiss'         }
        ],
        requireInteraction: data.requireInteraction === 'true' // keep on screen until tapped
    };

    // self.registration.showNotification() is the standard SW API for
    // displaying a system notification. Returns a Promise.
    return self.registration.showNotification(title, notificationOptions);
});

// ─────────────────────────────────────────────────────────────────────────────
// NOTIFICATION CLICK HANDLER
//
// Fires when the user taps the notification or one of its action buttons.
// Opens (or focuses) the correct page without opening a duplicate tab.
// ─────────────────────────────────────────────────────────────────────────────
self.addEventListener('notificationclick', function(event) {
    event.notification.close(); // dismiss the notification from the tray

    var action   = event.action;  // 'open', 'dismiss', or '' (body tap)
    var clickUrl = (event.notification.data && event.notification.data.url)
                 || '/seeker-console.html';

    // If user explicitly dismissed, do nothing more
    if (action === 'dismiss') return;

    // For 'open' action or a direct tap on the notification body:
    // Use clients.matchAll() to check if the app is already open in a tab.
    // If it is, focus that tab. If not, open a new one.
    // This prevents the common problem of stacking up duplicate tabs every
    // time the user taps a notification.
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then(function(clientList) {
                // Look for an existing tab that is already on our domain
                for (var i = 0; i < clientList.length; i++) {
                    var client = clientList[i];
                    // Check if this client's URL starts with our origin
                    if (client.url.indexOf(self.location.origin) === 0 && 'focus' in client) {
                        // Navigate the existing tab to the target URL, then focus it
                        return client.navigate(clickUrl).then(function(c) { return c.focus(); });
                    }
                }
                // No existing tab found — open a new one
                if (clients.openWindow) {
                    return clients.openWindow(clickUrl);
                }
            })
    );
});

// ─────────────────────────────────────────────────────────────────────────────
// SERVICE WORKER LIFECYCLE
//
// skipWaiting() + clients.claim() ensure that when you deploy an update to
// this file, the new version takes control immediately without waiting for the
// user to close all tabs. Without this, a stale SW version can persist for days.
// ─────────────────────────────────────────────────────────────────────────────
self.addEventListener('install', function(event) {
    self.skipWaiting();
});

self.addEventListener('activate', function(event) {
    event.waitUntil(clients.claim());
});
