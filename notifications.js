// ─────────────────────────────────────────────────────────────────────────────
// notifications.js
// Kamayega Bharat — Client-Side FCM Helper
//
// HOW TO USE:
//   Add this ONE script tag to the <body> of every page that needs notifications
//   (index.html, profile.html, employer.html — NOT login.html until after login):
//
//     <script src="/notifications.js"></script>
//
//   Then call initNotifications() after the user is confirmed logged in:
//
//     firebase.auth().onAuthStateChanged(user => {
//       if (user) initNotifications(user.uid);
//     });
//
// REQUIREMENTS (must already be on the page before this script):
//   - Firebase App compat SDK    (firebase-app-compat.js)
//   - Firebase Auth compat SDK   (firebase-auth-compat.js)
//   - Firebase Messaging compat  (firebase-messaging-compat.js)
//   - Firebase Firestore compat  (firebase-firestore-compat.js)
//   - Firebase must already be initialized (firebase.initializeApp called)
// ─────────────────────────────────────────────────────────────────────────────

(function () {
    'use strict';

    // ── VAPID key — get this from Firebase Console ────────────────────────────
    // Console → Project Settings → Cloud Messaging → Web Push certificates
    // Click "Generate key pair" if you haven't already, then paste the key below.
    var VAPID_KEY = 'BMUZXGCttN0MKdOP1qhQw8mHR07ym5LihceUUTc5qYbXvx3VvJQKOpS8vkI5UApgOKQVbrOo9DeyPg7ChNkpzwk';

    // ── Firestore collection where FCM tokens are stored ──────────────────────
    // Document path: users/{uid}  →  field: fcmTokens (array)
    var USERS_COLLECTION = 'users';

    // ─────────────────────────────────────────────────────────────────────────
    // initNotifications(uid)
    //
    // Call this once after confirming the user is logged in.
    // It:
    //   1. Checks / requests Notification permission
    //   2. Registers the service worker
    //   3. Gets the FCM token
    //   4. Saves it to Firestore under the user's document
    //   5. Sets up the foreground message handler (toast)
    // ─────────────────────────────────────────────────────────────────────────
    window.initNotifications = async function (uid) {
        if (!uid) {
            console.warn('[notifications.js] initNotifications called without uid');
            return;
        }

        // FCM requires Notification API support
        if (!('Notification' in window)) {
            console.warn('[notifications.js] This browser does not support notifications.');
            return;
        }

        // ── Step 1: Request permission ────────────────────────────────────────
        var permission = Notification.permission;
        if (permission === 'default') {
            permission = await Notification.requestPermission();
        }

        if (permission !== 'granted') {
            console.log('[notifications.js] Notification permission denied or dismissed.');
            return;
        }

        // ── Step 2: Register the service worker ───────────────────────────────
        // The SW file MUST be at the root of your domain.
        var swRegistration;
        try {
            swRegistration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
            console.log('[notifications.js] Service Worker registered:', swRegistration.scope);
        } catch (err) {
            console.error('[notifications.js] SW registration failed:', err);
            return;
        }

        // ── Step 3: Get FCM token ─────────────────────────────────────────────
        var messaging = firebase.messaging();
        var token;
        try {
            token = await messaging.getToken({
                vapidKey:            VAPID_KEY,
                serviceWorkerRegistration: swRegistration
            });
            if (!token) {
                console.warn('[notifications.js] No FCM token received. Check VAPID key and SW registration.');
                return;
            }
            console.log('[notifications.js] FCM Token:', token);
        } catch (err) {
            console.error('[notifications.js] Error getting FCM token:', err);
            return;
        }

        // ── Step 4: Save token to Firestore ──────────────────────────────────
        // arrayUnion ensures no duplicate tokens and is safe to call repeatedly.
        try {
            var db = firebase.firestore();
            await db.collection(USERS_COLLECTION).doc(uid).set({
                fcmTokens:      firebase.firestore.FieldValue.arrayUnion(token),
                notifyNewJobs:  true,    // opt-in to new job alerts by default
                lastTokenSaved: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            console.log('[notifications.js] FCM token saved to Firestore.');
        } catch (err) {
            console.error('[notifications.js] Error saving token to Firestore:', err);
        }

        // ── Step 5: Foreground message handler ───────────────────────────────
        // When the page IS open and focused, show a styled toast instead of
        // a system notification (avoids double-notifying the user).
        messaging.onMessage(function (payload) {
            console.log('[notifications.js] Foreground message:', payload);
            var notification = payload.notification || {};
            var data         = payload.data         || {};
            var title        = notification.title || data.title || 'Kamayega Bharat';
            var body         = notification.body  || data.body  || 'You have a new update.';
            var clickUrl     = data.click_action  || '/profile.html';
            showToast(title, body, clickUrl);
        });
    };

    // ─────────────────────────────────────────────────────────────────────────
    // showToast(title, body, clickUrl)
    //
    // Displays a non-blocking notification toast in the bottom-right corner.
    // Auto-dismisses after 6 seconds. Clicking opens clickUrl.
    // Injects its own styles once on first call.
    // ─────────────────────────────────────────────────────────────────────────
    var toastStylesInjected = false;

    function injectToastStyles() {
        if (toastStylesInjected) return;
        toastStylesInjected = true;
        var style = document.createElement('style');
        style.textContent = [
            '#kb-toast-container {',
            '  position: fixed; bottom: 24px; right: 24px; z-index: 99999;',
            '  display: flex; flex-direction: column; gap: 10px;',
            '  pointer-events: none;',
            '}',
            '.kb-toast {',
            '  background: #1a1a2e; color: #fff;',
            '  border-left: 4px solid #f97316;',  /* orange accent */
            '  border-radius: 8px;',
            '  padding: 14px 18px;',
            '  max-width: 340px; min-width: 260px;',
            '  box-shadow: 0 8px 24px rgba(0,0,0,0.35);',
            '  cursor: pointer; pointer-events: all;',
            '  animation: kb-slide-in 0.3s ease;',
            '  font-family: system-ui, sans-serif;',
            '}',
            '.kb-toast-title {',
            '  font-weight: 700; font-size: 14px; margin-bottom: 4px;',
            '}',
            '.kb-toast-body {',
            '  font-size: 13px; line-height: 1.45; color: #d1d5db;',
            '}',
            '.kb-toast-dismiss {',
            '  position: absolute; top: 8px; right: 10px;',
            '  background: none; border: none; color: #9ca3af;',
            '  font-size: 16px; cursor: pointer; line-height: 1;',
            '}',
            '@keyframes kb-slide-in {',
            '  from { opacity: 0; transform: translateX(40px); }',
            '  to   { opacity: 1; transform: translateX(0);    }',
            '}'
        ].join('\n');
        document.head.appendChild(style);
    }

    function showToast(title, body, clickUrl) {
        injectToastStyles();

        var container = document.getElementById('kb-toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'kb-toast-container';
            document.body.appendChild(container);
        }

        var toast = document.createElement('div');
        toast.className = 'kb-toast';
        toast.style.position = 'relative';
        toast.innerHTML = [
            '<button class="kb-toast-dismiss" aria-label="Dismiss">✕</button>',
            '<div class="kb-toast-title">' + escapeHtml(title) + '</div>',
            '<div class="kb-toast-body">'  + escapeHtml(body)  + '</div>'
        ].join('');

        // Click anywhere on toast → navigate
        toast.addEventListener('click', function (e) {
            if (e.target.classList.contains('kb-toast-dismiss')) {
                removeToast(toast);
                return;
            }
            window.location.href = clickUrl;
        });

        container.appendChild(toast);

        // Auto-remove after 6 seconds
        setTimeout(function () { removeToast(toast); }, 6000);
    }

    function removeToast(toast) {
        if (!toast || !toast.parentNode) return;
        toast.style.transition = 'opacity 0.3s';
        toast.style.opacity    = '0';
        setTimeout(function () {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 300);
    }

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // optOutNotifications(uid)
    //
    // Call this if the user toggles off notifications in their settings.
    // Removes the current token from Firestore and relinquishes the FCM token.
    // ─────────────────────────────────────────────────────────────────────────
    window.optOutNotifications = async function (uid) {
        if (!uid) return;
        var messaging = firebase.messaging();
        try {
            var token = await messaging.getToken();
            if (token) {
                await messaging.deleteToken();
                var db = firebase.firestore();
                await db.collection(USERS_COLLECTION).doc(uid).update({
                    fcmTokens:     firebase.firestore.FieldValue.arrayRemove(token),
                    notifyNewJobs: false
                });
                console.log('[notifications.js] Opted out. Token removed.');
            }
        } catch (err) {
            console.error('[notifications.js] Error opting out:', err);
        }
    };

})();
