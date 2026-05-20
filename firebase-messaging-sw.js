// ─────────────────────────────────────────────────────────────────────────────
// firebase-messaging-sw.js  v3.0
// Kamayega Bharat — FCM Background Message Handler
//
// ROOT CAUSE OF THE DEVTOOLS SIMULATION BUG (and why this file fixes it):
//
//   Chrome DevTools → Application → Service Workers → "Push" simulation
//   sends a RAW browser push event. Firebase's onBackgroundMessage() only
//   intercepts pushes that go through Firebase's own internal SW router.
//   When DevTools simulates a push directly, Firebase's router never sees it,
//   so onBackgroundMessage() is never called — and you get the fallback text.
//
//   FIX: Add a raw self.addEventListener('push', ...) block BEFORE the
//   Firebase SDK import. The raw listener handles DevTools simulations and
//   any non-Firebase push servers. Firebase's onBackgroundMessage() continues
//   to handle real FCM production pushes automatically (it intercepts the push
//   event internally before your raw listener would fire for FCM messages).
//
// DEPLOYMENT CHECKLIST:
//   ✅ File must be at the ROOT of your domain — /firebase-messaging-sw.js
//   ✅ Must be served over HTTPS (GitHub Pages = fine)
//   ✅ SDK version below must match the version used in your HTML pages (10.8.0)
//   ✅ After any edit: DevTools → Application → Service Workers → "Update"
//      OR open a new incognito tab to force-reload the SW.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// §1. SERVICE WORKER LIFECYCLE
//
// skipWaiting() + clients.claim() make the NEW version of this file take
// control immediately on every deploy, rather than waiting for the user
// to close all tabs. Without these, a stale SW can persist for 24+ hours
// and your push handler changes won't take effect.
// ─────────────────────────────────────────────────────────────────────────────
self.addEventListener('install', function (event) {
    console.log('[SW] install — skipWaiting() called. New SW will activate immediately.');
    self.skipWaiting();
});

self.addEventListener('activate', function (event) {
    console.log('[SW] activate — claiming all clients.');
    event.waitUntil(clients.claim());
});

// ─────────────────────────────────────────────────────────────────────────────
// §2. RAW PUSH EVENT LISTENER  ← THE FIX FOR YOUR DEVTOOLS SIMULATION BUG
//
// This block runs for:
//   • Chrome DevTools "simulate push" (the exact scenario you described)
//   • Any Web Push server that sends pushes WITHOUT going through Firebase
//   • Fallback when Firebase SDK fails to parse the payload
//
// For real FCM pushes in production, Firebase intercepts the push event
// internally before it reaches this listener (when the SDK is loaded below),
// so there is NO double-notification risk in production.
//
// HOW TO TEST IN DEVTOOLS:
//   Application → Service Workers → Push
//   Paste ANY of these payload shapes:
//
//   Shape A — flat:
//   {"title": "Alert!", "body": "Lalalalaalaaaa"}
//
//   Shape B — FCM notification:
//   {"notification": {"title": "Alert!", "body": "Lalalalaalaaaa"}}
//
//   Shape C — FCM data:
//   {"data": {"title": "Alert!", "body": "Lalalalaalaaaa", "click_action": "/profile.html"}}
//
//   Shape D — combined:
//   {"notification": {"title": "New Message"}, "data": {"body": "You have a new update", "click_action": "/profile.html"}}
// ─────────────────────────────────────────────────────────────────────────────
self.addEventListener('push', function (event) {
    console.log('[SW §2] ── RAW push event fired ──');
    console.log('[SW §2] event.data present?', !!event.data);

    // ── §2a. Check for empty payload ──────────────────────────────────────────
    // DevTools "Push" with an empty text box, or a push server sending
    // a ping-only notification, will have a null event.data.
    if (!event.data) {
        console.warn('[SW §2a] event.data is NULL — push was sent with no payload.');
        console.warn('[SW §2a] Showing fallback notification.');
        event.waitUntil(
            self.registration.showNotification('Kamayega Bharat', {
                body:  'You have a new update on your application.',
                icon:  '/favicon.png',
                badge: '/favicon.png',
                tag:   'kb-fallback-empty'
            })
        );
        return; // nothing more we can do — bail out early
    }

    // ── §2b. Log the raw string BEFORE attempting to parse ───────────────────
    // If this log shows your JSON but the notification still shows fallback
    // text, the bug is in §2c parse logic. If this log shows garbage or an
    // empty string, the push server is not encoding the payload correctly.
    var rawText = event.data.text();
    console.log('[SW §2b] Raw event.data.text() →', rawText);

    // ── §2c. Parse the payload — handles all known FCM shapes ────────────────
    var payload    = {};
    var parseError = null;

    try {
        payload = JSON.parse(rawText);
        console.log('[SW §2c] Parsed payload object →', JSON.stringify(payload, null, 2));
    } catch (err) {
        parseError = err;
        console.warn('[SW §2c] JSON.parse() failed. Raw text was not valid JSON:', rawText);
        console.warn('[SW §2c] Parse error →', err.message);
        // payload stays as {} — the field extraction below will use fallbacks.
    }

    // ── §2d. Extract fields — works for ALL four payload shapes ──────────────
    //
    // Priority order for each field:
    //   1. payload.notification.X  (Firebase notification message)
    //   2. payload.data.X          (Firebase data message / custom)
    //   3. payload.X               (flat JSON — the DevTools simulation shape)
    //   4. hard fallback string
    //
    var notif = payload.notification || {};
    var data  = payload.data         || {};

    var title    = notif.title    || data.title    || payload.title    || 'Kamayega Bharat';
    var body     = notif.body     || data.body     || payload.body     || 'You have a new update on your application.';
    var icon     = notif.icon     || data.icon     || payload.icon     || '/favicon.png';
    var clickUrl = notif.click_action
                || data.click_action
                || payload.click_action
                || '/profile.html';
    var tag      = data.tag       || payload.tag   || 'kb-notification';
    var requireInteraction = (data.requireInteraction === 'true') || (payload.requireInteraction === true) || false;

    console.log('[SW §2d] Resolved display values →', { title, body, icon, clickUrl, tag });

    // ── §2e. Show the notification ────────────────────────────────────────────
    var notificationOptions = {
        body:  body,
        icon:  icon,
        badge: '/favicon.png',
        tag:   tag,
        data:  { url: clickUrl },
        actions: [
            { action: 'open',    title: '📋 Open Dashboard' },
            { action: 'dismiss', title: '✕ Dismiss'         }
        ],
        requireInteraction: requireInteraction
    };

    console.log('[SW §2e] Calling showNotification() with →', JSON.stringify(notificationOptions, null, 2));

    event.waitUntil(
        self.registration.showNotification(title, notificationOptions)
            .then(function () {
                console.log('[SW §2e] showNotification() resolved successfully.');
            })
            .catch(function (err) {
                console.error('[SW §2e] showNotification() REJECTED →', err);
            })
    );
});

// ─────────────────────────────────────────────────────────────────────────────
// §3. FIREBASE SDK IMPORT
//
// These MUST come AFTER the raw push listener (§2) so that the listener
// is registered synchronously before the SW enters its evaluation phase.
//
// Do NOT move these to the top of the file — in some Chrome versions, calling
// importScripts() first can cause the SW to miss the 'install' event because
// the synchronous script evaluation hasn't returned yet.
// ─────────────────────────────────────────────────────────────────────────────
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

// ─────────────────────────────────────────────────────────────────────────────
// §4. FIREBASE APP INIT
// ─────────────────────────────────────────────────────────────────────────────
firebase.initializeApp({
    apiKey:            'AIzaSyBjXP4yQWDyCu4p78iA5aKrqICZLt_yxtk',
    authDomain:        'kamayega-bharat.firebaseapp.com',
    projectId:         'kamayega-bharat',
    storageBucket:     'kamayega-bharat.appspot.com',
    messagingSenderId: '595460672260',
    appId:             '1:595460672260:web:6584856313e2d740805e51'
});

var messaging = firebase.messaging();

// ─────────────────────────────────────────────────────────────────────────────
// §5. FIREBASE onBackgroundMessage — PRODUCTION FCM HANDLER
//
// This handles real FCM pushes sent from:
//   • Firebase Console → Cloud Messaging → Send test message
//   • Your Cloud Functions (functions/index.js)
//   • Any server using the Firebase Admin SDK
//
// Firebase's internal SW router intercepts the raw push event BEFORE §2
// for genuine FCM messages, so this block handles production and §2 handles
// DevTools simulations. There is NO overlap in normal operation.
//
// If you want to also capture detailed logs in production, this is where
// to add them.
// ─────────────────────────────────────────────────────────────────────────────
messaging.onBackgroundMessage(function (payload) {
    console.log('[SW §5] Firebase onBackgroundMessage() fired — production FCM payload →', payload);

    var notification = payload.notification || {};
    var data         = payload.data         || {};

    var title    = notification.title    || data.title    || 'Kamayega Bharat';
    var body     = notification.body     || data.body     || 'You have a new update on your application.';
    var icon     = notification.icon     || data.icon     || '/favicon.png';
    var clickUrl = notification.click_action
                || data.click_action
                || '/profile.html';
    var tag      = data.tag || 'kb-notification';

    console.log('[SW §5] Resolved values →', { title, body, clickUrl, tag });

    return self.registration.showNotification(title, {
        body:  body,
        icon:  icon,
        badge: '/favicon.png',
        tag:   tag,
        data:  { url: clickUrl },
        actions: [
            { action: 'open',    title: '📋 Open Dashboard' },
            { action: 'dismiss', title: '✕ Dismiss'         }
        ],
        requireInteraction: data.requireInteraction === 'true'
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6. NOTIFICATION CLICK HANDLER
//
// Fires when the user taps the notification or one of its action buttons.
// Focuses an existing tab if the app is already open, opens a new one if not.
// ─────────────────────────────────────────────────────────────────────────────
self.addEventListener('notificationclick', function (event) {
    console.log('[SW §6] notificationclick — action:', event.action || '(body tap)');

    event.notification.close();

    if (event.action === 'dismiss') {
        console.log('[SW §6] Dismissed — no navigation.');
        return;
    }

    var clickUrl = (event.notification.data && event.notification.data.url)
                 || '/profile.html';

    console.log('[SW §6] Navigating to:', clickUrl);

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then(function (clientList) {
                for (var i = 0; i < clientList.length; i++) {
                    var client = clientList[i];
                    if (client.url.indexOf(self.location.origin) === 0 && 'focus' in client) {
                        console.log('[SW §6] Found existing tab — navigating + focusing.');
                        return client.navigate(clickUrl).then(function (c) { return c.focus(); });
                    }
                }
                console.log('[SW §6] No existing tab — opening new window.');
                if (clients.openWindow) {
                    return clients.openWindow(clickUrl);
                }
            })
            .catch(function (err) {
                console.error('[SW §6] notificationclick handler error →', err);
            })
    );
});
