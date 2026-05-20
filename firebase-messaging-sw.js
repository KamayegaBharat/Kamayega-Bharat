// ─────────────────────────────────────────────────────────────────────────────
// firebase-messaging-sw.js  v4.0
// Kamayega Bharat — FCM Background Message Handler
//
// WHAT CHANGED FROM v3 → v4  (fixes "No Firebase App '[DEFAULT]'" error):
//
//   The error fires when firebase.messaging() is called at the TOP LEVEL of
//   the script. Chrome evaluates SW scripts multiple times during their
//   lifetime (install, update, browser restart, DevTools "Update" click).
//   On a re-evaluation the compat SDK's messaging constructor calls getApp()
//   internally — but because the script is being re-evaluated from scratch,
//   initializeApp() hasn't run yet in that pass, so getApp() throws.
//
//   THREE-PART FIX applied below:
//     1. importScripts() at the very top  (compat SDK requirement — always first)
//     2. initializeApp() wrapped in a try/catch guard that handles both
//        "first run" and "duplicate app already exists" cases
//     3. firebase.messaging() also wrapped, result stored in `messaging` var
//        which is checked before use (so a failure doesn't break the whole SW)
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// §1  SDK IMPORTS
//
// MUST be the very first executable lines. importScripts() is synchronous
// in a SW context — `firebase` is available on the global scope immediately
// after these two lines complete. Nothing Firebase-related may appear above.
// ─────────────────────────────────────────────────────────────────────────────
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

// ─────────────────────────────────────────────────────────────────────────────
// §2  FIREBASE INIT GUARD
//
// Chrome evaluates this script on:
//   • First SW install
//   • SW byte-change update (GitHub Pages deploy)
//   • Browser restart if a SW was already active
//   • DevTools → Application → Service Workers → "Update"
//
// Calling initializeApp() a second time throws "app/duplicate-app".
// Calling messaging() before initializeApp() throws "app/no-app".
// The IIFE below handles both cases so neither error can crash the SW.
// ─────────────────────────────────────────────────────────────────────────────
var messaging = null;

(function initFirebase() {
    var config = {
        apiKey:            'AIzaSyBjXP4yQWDyCu4p78iA5aKrqICZLt_yxtk',
        authDomain:        'kamayega-bharat.firebaseapp.com',
        projectId:         'kamayega-bharat',
        storageBucket:     'kamayega-bharat.appspot.com',
        messagingSenderId: '595460672260',
        appId:             '1:595460672260:web:6584856313e2d740805e51'
    };

    // Step A — get or create the [DEFAULT] app
    try {
        firebase.initializeApp(config);
        console.log('[SW §2] initializeApp() — new app created.');
    } catch (e) {
        if (e.code === 'app/duplicate-app') {
            // Already initialised from a previous evaluation — safe to continue.
            console.log('[SW §2] initializeApp() — app already exists, continuing with existing instance.');
        } else {
            // Something genuinely unexpected — log and abort so we don't
            // call messaging() on a broken app state.
            console.error('[SW §2] initializeApp() unexpected error:', e.code, e.message);
            return; // messaging stays null; §5 guard will skip onBackgroundMessage
        }
    }

    // Step B — get the messaging instance (always after initializeApp succeeds)
    try {
        messaging = firebase.messaging();
        console.log('[SW §2] firebase.messaging() instance ready.');
    } catch (e) {
        console.error('[SW §2] firebase.messaging() failed:', e.code, e.message);
        // messaging stays null — §4 raw listener will still handle all pushes
    }
}());

// ─────────────────────────────────────────────────────────────────────────────
// §3  SERVICE WORKER LIFECYCLE
// ─────────────────────────────────────────────────────────────────────────────
self.addEventListener('install', function (event) {
    // skipWaiting() forces the new SW version to activate immediately,
    // rather than waiting for all existing tabs to close first.
    // Without this, a stale SW can persist for 24+ hours after a deploy.
    console.log('[SW §3] install event — calling skipWaiting().');
    self.skipWaiting();
});

self.addEventListener('activate', function (event) {
    console.log('[SW §3] activate event — claiming all clients.');
    event.waitUntil(clients.claim());
});

// ─────────────────────────────────────────────────────────────────────────────
// §4  RAW PUSH LISTENER  ← fixes the DevTools simulation showing fallback text
//
// WHY THIS IS NEEDED:
//   DevTools → Application → Service Workers → "Push" sends a raw browser
//   push event. Firebase's onBackgroundMessage() (§5) only runs for pushes
//   that go through Firebase's internal SW router — DevTools bypasses it.
//   This raw listener catches everything DevTools sends.
//
// PRODUCTION SAFETY:
//   For real FCM pushes, Firebase intercepts the push event INTERNALLY before
//   it ever reaches this addEventListener handler. So in production, §5 runs
//   for FCM messages and §4 runs for DevTools tests. No double-notification.
//
// ── DEVTOOLS TEST PAYLOADS ────────────────────────────────────────────────
//   Paste any of these in DevTools → Application → Service Workers → Push:
//
//   Flat JSON (simplest):
//   {"title":"Hello","body":"Testing 1 2 3"}
//
//   FCM notification shape:
//   {"notification":{"title":"Hello","body":"Testing 1 2 3"}}
//
//   FCM data shape:
//   {"data":{"title":"Hello","body":"Testing 1 2 3","click_action":"/profile.html"}}
//
//   Combined:
//   {"notification":{"title":"New Message"},"data":{"body":"You have a chat","click_action":"/profile.html"}}
// ─────────────────────────────────────────────────────────────────────────────
self.addEventListener('push', function (event) {
    console.log('[SW §4] ── raw push event fired ──');
    console.log('[SW §4] event.data present?', !!event.data);

    // §4a — Empty payload guard
    if (!event.data) {
        console.warn('[SW §4a] event.data is null — push sent with no payload body.');
        console.warn('[SW §4a] Fix: ensure your push server sends a JSON body, or type a payload into the DevTools Push text box.');
        event.waitUntil(
            self.registration.showNotification('Kamayega Bharat', {
                body:  'You have a new update on your application.',
                icon:  '/favicon.png',
                badge: '/favicon.png',
                tag:   'kb-empty-payload'
            })
        );
        return;
    }

    // §4b — Read raw string (log BEFORE parse so you can see exactly what arrived)
    var rawText = '';
    try {
        rawText = event.data.text();
    } catch (e) {
        console.error('[SW §4b] event.data.text() threw:', e);
    }
    console.log('[SW §4b] Raw payload string →', rawText);

    // §4c — Parse JSON
    var payload = {};
    try {
        payload = JSON.parse(rawText);
        console.log('[SW §4c] Parsed payload →', JSON.stringify(payload, null, 2));
    } catch (e) {
        console.warn('[SW §4c] JSON.parse() failed — raw text is not valid JSON:', e.message);
        console.warn('[SW §4c] Raw text was:', rawText);
        // payload stays {} — field extraction below falls through to hardcoded defaults
    }

    // §4d — Extract fields from all FCM payload shapes
    //
    // Priority for each field:
    //   payload.notification.X  (FCM notification message)
    //   payload.data.X          (FCM data-only message)
    //   payload.X               (flat JSON — DevTools default shape)
    //   'hardcoded fallback'
    var n = (payload.notification && typeof payload.notification === 'object') ? payload.notification : {};
    var d = (payload.data         && typeof payload.data         === 'object') ? payload.data         : {};

    var title    = n.title        || d.title        || payload.title        || 'Kamayega Bharat';
    var body     = n.body         || d.body         || payload.body         || 'You have a new update on your application.';
    var icon     = n.icon         || d.icon         || payload.icon         || '/favicon.png';
    var clickUrl = n.click_action || d.click_action || payload.click_action || '/profile.html';
    var tag      =                   d.tag          || payload.tag          || 'kb-notification';
    var persist  = (d.requireInteraction === 'true') || (payload.requireInteraction === true) || false;

    console.log('[SW §4d] Resolved values → title:', title, '| body:', body, '| clickUrl:', clickUrl, '| tag:', tag);

    // §4e — Display the notification
    event.waitUntil(
        self.registration.showNotification(title, {
            body:               body,
            icon:               icon,
            badge:              '/favicon.png',
            tag:                tag,
            data:               { url: clickUrl },
            requireInteraction: persist,
            actions: [
                { action: 'open',    title: '📋 Open Dashboard' },
                { action: 'dismiss', title: '✕ Dismiss'         }
            ]
        })
        .then(function () {
            console.log('[SW §4e] showNotification() succeeded.');
        })
        .catch(function (e) {
            console.error('[SW §4e] showNotification() failed:', e);
        })
    );
});

// ─────────────────────────────────────────────────────────────────────────────
// §5  FIREBASE onBackgroundMessage — real FCM production pushes only
//
// Handles pushes sent via:
//   • Firebase Console → Cloud Messaging → "Send test message"
//   • Cloud Functions (your functions/index.js triggers)
//   • Any server using the firebase-admin SDK
//
// Firebase intercepts the raw push event for FCM messages before §4 sees it,
// so there is no execution overlap between §4 and §5 in production.
// ─────────────────────────────────────────────────────────────────────────────
if (messaging) {
    messaging.onBackgroundMessage(function (payload) {
        console.log('[SW §5] onBackgroundMessage() — production FCM payload:', payload);

        var n = payload.notification || {};
        var d = payload.data         || {};

        var title    = n.title        || d.title        || 'Kamayega Bharat';
        var body     = n.body         || d.body         || 'You have a new update on your application.';
        var icon     = n.icon         || d.icon         || '/favicon.png';
        var clickUrl = n.click_action || d.click_action || '/profile.html';
        var tag      =                   d.tag          || 'kb-notification';

        console.log('[SW §5] Resolved → title:', title, '| body:', body, '| url:', clickUrl);

        return self.registration.showNotification(title, {
            body:               body,
            icon:               icon,
            badge:              '/favicon.png',
            tag:                tag,
            data:               { url: clickUrl },
            requireInteraction: d.requireInteraction === 'true',
            actions: [
                { action: 'open',    title: '📋 Open Dashboard' },
                { action: 'dismiss', title: '✕ Dismiss'         }
            ]
        });
    });
} else {
    console.warn('[SW §5] messaging is null — onBackgroundMessage() skipped. Real FCM pushes will fall through to §4 raw listener as a backup.');
}

// ─────────────────────────────────────────────────────────────────────────────
// §6  NOTIFICATION CLICK HANDLER
// ─────────────────────────────────────────────────────────────────────────────
self.addEventListener('notificationclick', function (event) {
    console.log('[SW §6] notificationclick — action:', event.action || '(body tap)');
    event.notification.close();

    if (event.action === 'dismiss') {
        console.log('[SW §6] Dismiss action — no navigation.');
        return;
    }

    var clickUrl = (event.notification.data && event.notification.data.url) || '/profile.html';
    console.log('[SW §6] Navigating to:', clickUrl);

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then(function (clientList) {
                for (var i = 0; i < clientList.length; i++) {
                    var c = clientList[i];
                    if (c.url.indexOf(self.location.origin) === 0 && 'focus' in c) {
                        console.log('[SW §6] Existing tab found — navigating + focusing.');
                        return c.navigate(clickUrl).then(function (tab) { return tab.focus(); });
                    }
                }
                console.log('[SW §6] No existing tab — opening new window.');
                return clients.openWindow ? clients.openWindow(clickUrl) : null;
            })
            .catch(function (e) {
                console.error('[SW §6] Navigation error:', e);
            })
    );
});
