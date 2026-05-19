// ─────────────────────────────────────────────────────────────────────────────
// functions/index.js
// Kamayega Bharat — Firebase Cloud Functions: Notification Triggers
//
// WHAT THIS FILE DOES:
//   - Listens to Firestore document changes and sends FCM push notifications
//   - Provides an HTTP endpoint for manually sending notifications (admin use)
//   - Handles 4 notification types:
//       1. Application status update  (employer updates seeker's application)
//       2. New job posted             (notify seekers with matching profile)
//       3. Profile viewed             (notify seeker when employer views them)
//       4. Manual broadcast           (admin HTTP trigger)
//
// SETUP STEPS:
//   1. Run: firebase login
//   2. Run: firebase use --add   (select your kamayega-bharat project)
//   3. Run: cd functions && npm install
//   4. Run: firebase deploy --only functions
// ─────────────────────────────────────────────────────────────────────────────

const functions  = require('firebase-functions');
const admin      = require('firebase-admin');

admin.initializeApp();

const db        = admin.firestore();
const messaging = admin.messaging();

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: Send notification to a single FCM token
// Returns true on success, false on failure (bad token etc.)
// ─────────────────────────────────────────────────────────────────────────────
async function sendToToken(token, title, body, data = {}, clickUrl = '/profile.html') {
    const message = {
        token,
        notification: { title, body },
        data: {
            ...data,
            click_action:        clickUrl,
            requireInteraction:  'false',
            tag:                 data.tag || 'kb-notification',
        },
        webpush: {
            notification: {
                title,
                body,
                icon:   '/favicon.png',
                badge:  '/favicon.png',
                click_action: clickUrl,
                actions: [
                    { action: 'open',    title: '📋 Open Dashboard' },
                    { action: 'dismiss', title: '✕ Dismiss'         }
                ]
            },
            fcm_options: { link: clickUrl }
        }
    };

    try {
        const response = await messaging.send(message);
        console.log('Notification sent successfully:', response);
        return true;
    } catch (error) {
        console.error('Error sending notification to token:', token, error.message);
        // If the token is invalid/expired, remove it from Firestore
        if (
            error.code === 'messaging/invalid-registration-token' ||
            error.code === 'messaging/registration-token-not-registered'
        ) {
            await removeStaleToken(token);
        }
        return false;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: Remove a stale/invalid FCM token from Firestore
// Tokens are stored in users/{uid}/fcmTokens (array field)
// ─────────────────────────────────────────────────────────────────────────────
async function removeStaleToken(staleToken) {
    try {
        const usersSnap = await db.collection('users')
            .where('fcmTokens', 'array-contains', staleToken)
            .get();

        const batch = db.batch();
        usersSnap.forEach(doc => {
            batch.update(doc.ref, {
                fcmTokens: admin.firestore.FieldValue.arrayRemove(staleToken)
            });
        });
        await batch.commit();
        console.log('Removed stale token:', staleToken);
    } catch (err) {
        console.error('Failed to remove stale token:', err.message);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: Get all FCM tokens for a user by their UID
// ─────────────────────────────────────────────────────────────────────────────
async function getTokensForUser(uid) {
    const userDoc = await db.collection('users').doc(uid).get();
    if (!userDoc.exists) return [];
    const data = userDoc.data();
    return Array.isArray(data.fcmTokens) ? data.fcmTokens : [];
}

// ─────────────────────────────────────────────────────────────────────────────
// TRIGGER 1: Application Status Updated
//
// Firestore path: applications/{applicationId}
// Fires when an employer changes the `status` field on an application doc.
// Sends a notification to the seeker (stored in applications.seekerUid).
//
// Expected application document shape:
// {
//   seekerUid:   "uid_of_job_seeker",
//   employerUid: "uid_of_employer",
//   jobTitle:    "Software Engineer",
//   companyName: "Acme Corp",
//   status:      "Shortlisted" | "Rejected" | "Interview Scheduled" | ...
// }
// ─────────────────────────────────────────────────────────────────────────────
exports.onApplicationStatusChange = functions
    .region('asia-south1')          // Mumbai — lowest latency for India
    .firestore
    .document('applications/{applicationId}')
    .onUpdate(async (change, context) => {
        const before = change.before.data();
        const after  = change.after.data();

        // Only fire when the status field actually changed
        if (before.status === after.status) return null;

        const { seekerUid, jobTitle, companyName, status } = after;
        if (!seekerUid) {
            console.warn('Application doc missing seekerUid:', context.params.applicationId);
            return null;
        }

        // Build a human-friendly message based on the new status
        const statusMessages = {
            'Shortlisted':          `🎉 Great news! You've been shortlisted for ${jobTitle} at ${companyName}.`,
            'Interview Scheduled':  `📅 Interview scheduled for ${jobTitle} at ${companyName}. Check your profile for details.`,
            'Rejected':             `Your application for ${jobTitle} at ${companyName} was not selected this time. Keep applying!`,
            'Hired':                `🥳 Congratulations! You've been hired for ${jobTitle} at ${companyName}!`,
            'On Hold':              `Your application for ${jobTitle} at ${companyName} is currently on hold.`,
        };

        const body = statusMessages[status]
                  || `Your application for ${jobTitle} at ${companyName} has been updated to: ${status}`;

        const tokens = await getTokensForUser(seekerUid);
        if (tokens.length === 0) {
            console.log('No FCM tokens for seeker:', seekerUid);
            return null;
        }

        const sendPromises = tokens.map(token =>
            sendToToken(
                token,
                'Application Update — Kamayega Bharat',
                body,
                { tag: 'application-update', applicationId: context.params.applicationId },
                '/profile.html'
            )
        );

        return Promise.all(sendPromises);
    });

// ─────────────────────────────────────────────────────────────────────────────
// TRIGGER 2: New Job Posted
//
// Firestore path: jobs/{jobId}
// Fires when a new job document is created.
// Sends a notification to ALL seekers who have notifications enabled.
//
// NOTE: For large user bases, consider using a "topic" subscription instead
// of iterating all users. See the TOPIC MESSAGING section at the bottom.
//
// Expected job document shape:
// {
//   title:       "React Developer",
//   companyName: "Acme Corp",
//   location:    "Remote",
//   employerUid: "uid_of_employer"
// }
// ─────────────────────────────────────────────────────────────────────────────
exports.onNewJobPosted = functions
    .region('asia-south1')
    .firestore
    .document('jobs/{jobId}')
    .onCreate(async (snap, context) => {
        const job = snap.data();
        const { title, companyName, location } = job;

        const body = `New job: ${title} at ${companyName}${location ? ' · ' + location : ''}. Apply now!`;

        // Query seekers who have opted in to job alerts
        // (set notifyNewJobs: true in their user doc when they subscribe)
        const seekersSnap = await db.collection('users')
            .where('role', '==', 'seeker')
            .where('notifyNewJobs', '==', true)
            .get();

        if (seekersSnap.empty) {
            console.log('No seekers opted in for job alerts.');
            return null;
        }

        const sendPromises = [];
        seekersSnap.forEach(doc => {
            const tokens = Array.isArray(doc.data().fcmTokens) ? doc.data().fcmTokens : [];
            tokens.forEach(token => {
                sendPromises.push(
                    sendToToken(
                        token,
                        '🆕 New Job Alert — Kamayega Bharat',
                        body,
                        { tag: 'new-job', jobId: context.params.jobId },
                        '/index.html'
                    )
                );
            });
        });

        console.log(`Sending new-job notifications to ${sendPromises.length} tokens.`);
        return Promise.all(sendPromises);
    });

// ─────────────────────────────────────────────────────────────────────────────
// TRIGGER 3: Profile Viewed by Employer
//
// Firestore path: profileViews/{viewId}
// Fires when an employer views a seeker's profile (your app should write a doc
// here when that happens).
//
// Expected profileViews document shape:
// {
//   seekerUid:   "uid_of_seeker",
//   employerUid: "uid_of_employer",
//   companyName: "Acme Corp",
//   viewedAt:    Timestamp
// }
// ─────────────────────────────────────────────────────────────────────────────
exports.onProfileViewed = functions
    .region('asia-south1')
    .firestore
    .document('profileViews/{viewId}')
    .onCreate(async (snap, context) => {
        const { seekerUid, companyName } = snap.data();
        if (!seekerUid) return null;

        const tokens = await getTokensForUser(seekerUid);
        if (tokens.length === 0) return null;

        const sendPromises = tokens.map(token =>
            sendToToken(
                token,
                '👀 Profile Viewed — Kamayega Bharat',
                `${companyName || 'An employer'} viewed your profile. Make sure it's up to date!`,
                { tag: 'profile-view' },
                '/profile.html'
            )
        );

        return Promise.all(sendPromises);
    });

// ─────────────────────────────────────────────────────────────────────────────
// TRIGGER 4: HTTP endpoint — Send notification manually (admin use)
//
// POST https://asia-south1-kamayega-bharat.cloudfunctions.net/sendNotification
// Headers: { "Content-Type": "application/json" }
// Body:
// {
//   "uid":      "target_user_uid",       ← send to specific user (optional)
//   "topic":    "all-seekers",           ← OR send to a topic (optional)
//   "title":    "Announcement",
//   "body":     "Important update...",
//   "clickUrl": "/profile.html"          ← optional, defaults to /profile.html
// }
//
// SECURITY: Protect this endpoint — only call from your admin panel or
// backend using a secret header check or Firebase Auth verification.
// ─────────────────────────────────────────────────────────────────────────────
exports.sendNotification = functions
    .region('asia-south1')
    .https
    .onRequest(async (req, res) => {
        // Basic method guard
        if (req.method !== 'POST') {
            return res.status(405).json({ error: 'Method not allowed. Use POST.' });
        }

        // ── Simple shared-secret auth ────────────────────────────────────────
        // Set this in Firebase environment config:
        //   firebase functions:config:set admin.secret="YOUR_SECRET_HERE"
        // Then redeploy. Call the endpoint with header: x-admin-secret: YOUR_SECRET
        const secret = functions.config().admin && functions.config().admin.secret;
        if (secret && req.headers['x-admin-secret'] !== secret) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const { uid, topic, title, body, clickUrl } = req.body;

        if (!title || !body) {
            return res.status(400).json({ error: 'title and body are required.' });
        }

        try {
            // ── Send to a specific user by UID ───────────────────────────────
            if (uid) {
                const tokens = await getTokensForUser(uid);
                if (tokens.length === 0) {
                    return res.status(404).json({ error: 'No FCM tokens found for this user.' });
                }
                const results = await Promise.all(
                    tokens.map(token => sendToToken(token, title, body, {}, clickUrl || '/profile.html'))
                );
                return res.status(200).json({ success: true, sent: results.filter(Boolean).length });
            }

            // ── Send to a topic (e.g. "all-seekers") ─────────────────────────
            if (topic) {
                const message = {
                    topic,
                    notification: { title, body },
                    data: { click_action: clickUrl || '/profile.html' },
                    webpush: {
                        notification: { title, body, icon: '/favicon.png' },
                        fcm_options:  { link: clickUrl || '/profile.html' }
                    }
                };
                const response = await messaging.send(message);
                return res.status(200).json({ success: true, messageId: response });
            }

            return res.status(400).json({ error: 'Provide either uid or topic.' });

        } catch (error) {
            console.error('sendNotification error:', error);
            return res.status(500).json({ error: error.message });
        }
    });

// ─────────────────────────────────────────────────────────────────────────────
// TOPIC MESSAGING (optional, for large-scale broadcasts)
//
// Instead of iterating all users, subscribe tokens to a topic once:
//
//   await messaging.subscribeToTopic(token, 'all-seekers');
//   await messaging.subscribeToTopic(token, 'all-employers');
//
// Then send to the entire group with one call:
//
//   messaging.send({ topic: 'all-seekers', notification: { title, body } })
//
// Call subscribeToTopic from a Cloud Function triggered on user token save,
// or call it client-side via your backend.
// ─────────────────────────────────────────────────────────────────────────────
