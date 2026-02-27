// ================================================================
// student-panel/js/auth-guard.js
// Session management + authentication guard for all protected pages.
// Uses server-authoritative activeSessionToken for single-device enforcement.
// Import and call checkAuth() at the top of each page's JS module.
// ================================================================

import { API } from '../backend/api.js';

const SESSION_KEY = 'grammarhub_session';
const SESSION_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours
const CHECK_INTERVAL_MS = 2 * 60 * 1000;     // Check server every 2 minutes
const LOGIN_PAGE = 'login.html';

// ── Exported API ────────────────────────────────────────────────

/**
 * Get the current session from localStorage.
 * Returns null if no session exists.
 */
export function getSession() {
    try {
        const raw = localStorage.getItem(SESSION_KEY);
        if (!raw) return null;
        const session = JSON.parse(raw);
        if (!session || typeof session !== 'object') return null;
        if (!session.studentId || !session.activeSessionToken || !session.loginAt) return null;
        return session;
    } catch {
        return null;
    }
}

/**
 * Save a session after successful login.
 * Now stores the server-issued activeSessionToken.
 */
export async function createSession(studentId, studentName, email, activeSessionToken) {
    const loginAt = Date.now();
    const session = {
        studentId,
        studentName,
        email,
        activeSessionToken,
        loginAt,
        expiresAt: loginAt + SESSION_MAX_AGE,
        lastChecked: loginAt
    };
    try {
        localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch {
        console.warn('[Auth] Failed to save session');
    }
    // Also set student ID/name in progress meta for compatibility
    localStorage.setItem('grammarhub_student_id', studentId);
    try {
        const data = JSON.parse(localStorage.getItem('grammarhub_progress_v2')) || {};
        data._meta = { ...(data._meta || {}), studentName, studentId, profilePhoto: data._meta?.profilePhoto };
        localStorage.setItem('grammarhub_progress_v2', JSON.stringify(data));
    } catch { /* skip */ }
    return session;
}

/**
 * Check if the user is authenticated (local check only — fast).
 * Returns boolean.
 */
export function isAuthenticated() {
    const session = getSession();
    if (!session) return false;
    if (Date.now() > session.expiresAt) return false;
    return true;
}

/**
 * Authentication guard. Call at the top of each protected page's JS.
 * 1. Validates local session exists + not expired
 * 2. Validates server-side activeSessionToken (throttled to avoid spamming)
 * 3. Redirects to login if invalid
 * Returns the session object if valid.
 */
export async function checkAuth() {
    const session = getSession();

    // No session → redirect
    if (!session) {
        _redirectToLogin();
        return null;
    }

    // Session expired → clear and redirect
    if (Date.now() > session.expiresAt) {
        logout();
        return null;
    }

    // Server-side session check (throttled)
    const now = Date.now();
    if (!session.lastChecked || (now - session.lastChecked) > CHECK_INTERVAL_MS) {
        try {
            const result = await API.checkSession(session.studentId, session.activeSessionToken);
            if (!result.success) {
                // Token mismatch — another device logged in
                _clearLocalSession();
                _redirectToLogin('session_revoked');
                return null;
            }
            // Update last checked timestamp
            session.lastChecked = now;
            session._verified = true;
            try {
                localStorage.setItem(SESSION_KEY, JSON.stringify(session));
            } catch { /* ignore */ }
        } catch {
            // Network error — allow offline usage but mark unverified
            console.warn('[Auth] Session check failed (network error) — allowing offline.');
            session._verified = false;
        }
    }

    return session;
}

/**
 * Log out: clear server token, clear ALL local/session data, redirect.
 */
export async function logout() {
    const session = getSession();
    if (session) {
        // Fire-and-forget server logout
        try {
            API.logoutSession(session.studentId, session.activeSessionToken);
        } catch { /* ignore */ }
    }
    // Clear all cached data (sessionStorage + localStorage)
    try {
        const { Progress } = await import('./progress.js');
        Progress.clearAllSessionData();
    } catch { /* fallback manual clear below */ }
    _clearLocalSession();
    _redirectToLogin();
}

// ── Internal helpers ────────────────────────────────────────────

function _clearLocalSession() {
    try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
    // Belt-and-suspenders: also clear any remaining keys
    try { localStorage.removeItem('grammarhub_progress_v2'); } catch { /* ignore */ }
    try { localStorage.removeItem('grammarhub_student_id'); } catch { /* ignore */ }
    try { localStorage.removeItem('grammarhub_sync_queue'); } catch { /* ignore */ }
    try { sessionStorage.removeItem('grammarhub_dashboard_cache'); } catch { /* ignore */ }
}

function _redirectToLogin(reason) {
    const currentPath = window.location.pathname;
    // Don't redirect if already on login page
    if (currentPath.includes(LOGIN_PAGE)) return;
    const url = reason ? `${LOGIN_PAGE}?reason=${reason}` : LOGIN_PAGE;
    window.location.href = url;
}
