/* =====================================================
   KAMAYEGA BHARAT — app.js
   Add these blocks to your existing js/app.js
   ===================================================== */

'use strict';

/* =====================================================
   UTILITY: Get element(s) safely
   ===================================================== */
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

/* =====================================================
   DASHBOARD: Avatar Dropdown Toggle
   ===================================================== */
function initAvatarDropdown() {
    const btn      = $('#avatarBtn');
    const dropdown = $('#avatarDropdown');
    if (!btn || !dropdown) return;

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = dropdown.classList.toggle('open');
        btn.setAttribute('aria-expanded', isOpen);
    });

    // Close on outside click
    document.addEventListener('click', () => {
        dropdown.classList.remove('open');
        btn.setAttribute('aria-expanded', 'false');
    });

    // Close on Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            dropdown.classList.remove('open');
            btn.setAttribute('aria-expanded', 'false');
            btn.focus();
        }
    });
}

/* =====================================================
   DASHBOARD: Mobile Hamburger Toggle
   ===================================================== */
function initHamburger() {
    const hamburger = $('#hamburger');
    const navLinks  = $('#dashNavLinks');
    if (!hamburger || !navLinks) return;

    hamburger.addEventListener('click', () => {
        const isOpen = navLinks.classList.toggle('open');
        hamburger.setAttribute('aria-expanded', isOpen);
    });
}

/* =====================================================
   DASHBOARD: Save Job Button Toggle
   ===================================================== */
function initSaveJobButtons() {
    $$('.save-job-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const saved = btn.getAttribute('data-saved') === 'true';
            btn.setAttribute('data-saved', !saved);
            btn.setAttribute('aria-label',
                btn.getAttribute('aria-label').replace(
                    saved ? 'Unsave' : 'Save',
                    saved ? 'Save'   : 'Unsave'
                )
            );

            // Update saved count in dashboard card
            const countEl = $('#savedCount');
            if (countEl) {
                let count = parseInt(countEl.textContent, 10);
                countEl.textContent = saved ? count - 1 : count + 1;
            }
        });
    });
}

/* =====================================================
   DASHBOARD: Profile Completion Bar Animation
   ===================================================== */
function animateCompletionBar() {
    const fill = $('#completionFill');
    if (!fill) return;
    // Reset then animate in for visual delight
    const target = fill.style.width;
    fill.style.width = '0%';
    requestAnimationFrame(() => {
        setTimeout(() => { fill.style.width = target; }, 120);
    });
}

/* =====================================================
   DASHBOARD: Populate user name from session/localStorage
   Example: localStorage.setItem('kb_user', JSON.stringify({ name: 'Priya Sharma' }))
   ===================================================== */
function populateUserInfo() {
    try {
        const user = JSON.parse(localStorage.getItem('kb_user') || 'null');
        if (!user) return;

        const nameEl    = $('#userName');
        const initialsEl = $('#avatarInitials');

        if (nameEl && user.name) {
            nameEl.textContent = user.name;
        }
        if (initialsEl && user.name) {
            const parts    = user.name.trim().split(' ');
            const initials = parts.length >= 2
                ? parts[0][0] + parts[parts.length - 1][0]
                : parts[0].slice(0, 2);
            initialsEl.textContent = initials.toUpperCase();
        }
    } catch (e) {
        // Silently fail — sample data in HTML is shown
    }
}

/* =====================================================
   DASHBOARD: Notification dot — hide if zero
   ===================================================== */
function updateNotifDot() {
    const countEl = $('#notifCount');
    const dotEl   = $('#notifDot');
    if (!countEl || !dotEl) return;
    const count = parseInt(countEl.textContent, 10);
    dotEl.style.display = count > 0 ? 'flex' : 'none';
    dotEl.textContent   = count;
}

/* =====================================================
   DASHBOARD: Highlight active nav link by current path
   ===================================================== */
function highlightActiveNavLink() {
    const path = window.location.pathname.split('/').pop() || 'index';
    $$('.dash-nav-link').forEach(link => {
        const href = link.getAttribute('href');
        if (href && (path === href || path.startsWith(href + '?'))) {
            link.classList.add('active');
        }
    });
}

/* =====================================================
   INIT: Run all dashboard logic on DOMContentLoaded
   ===================================================== */
document.addEventListener('DOMContentLoaded', () => {
    initAvatarDropdown();
    initHamburger();
    initSaveJobButtons();
    animateCompletionBar();
    populateUserInfo();
    updateNotifDot();
    highlightActiveNavLink();
});
