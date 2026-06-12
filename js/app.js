'use strict';
document.addEventListener('DOMContentLoaded', () => {
/* Highlight Current Navigation Link*/
    const currentPage = window.location.pathname.split('/').pop() || 'index.html';
    document.querySelectorAll('a[href]').forEach(link => {
        const href = link.getAttribute('href');
        if (!href) return;
        const normalizedHref = href.replace(/^\//, '');
        if (
            normalizedHref === currentPage ||
            normalizedHref === currentPage.replace('.html', '')
        ) {
            link.classList.add('active-link');
        }
    });
    /*Smooth Scroll for Internal Anchors*/
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            const target = document.querySelector(this.getAttribute('href'));
            if (!target) return;
            e.preventDefault();
            target.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        });
    });


    /* External Links Open Securely*/
    document.querySelectorAll('a[target="_blank"]').forEach(link => {
        if (!link.rel.includes('noopener')) {
            link.rel = `${link.rel} noopener noreferrer`.trim();
        }
    });
     /*Footer Year Auto Update*/
    document.querySelectorAll('.current-year').forEach(el => {
        el.textContent = new Date().getFullYear();
    });
    /*Button Click Animation*/
    document.querySelectorAll('.btn, .login-btn').forEach(button => {
        button.addEventListener('click', () => {
            button.classList.add('clicked');
            setTimeout(() => {
                button.classList.remove('clicked');
            }, 200);
        });
    });
    /*Reveal Elements on Scroll*/
    const revealElements = document.querySelectorAll(
        '.feature-card, .stat-item, .why-item, .step, .policy-card, .terms-card'
    );
    if ('IntersectionObserver' in window) {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('revealed');
                    observer.unobserve(entry.target);
                }
            });
        }, {
            threshold: 0.1
        });
        revealElements.forEach(el => observer.observe(el));
    } else {
        revealElements.forEach(el => el.classList.add('revealed'));
    }
});
