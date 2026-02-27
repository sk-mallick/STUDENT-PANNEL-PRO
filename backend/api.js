// ================================================================
// student-panel/backend/api.js
// Backend connector — supports localStorage-only, Google Apps Script,
// or custom backend endpoints.
// ================================================================

// ── Configuration ────────────────────────────────────────────────
// Set this URL to connect a real backend. Leave null for localStorage-only mode.
const BACKEND_URL = 'https://script.google.com/macros/s/AKfycbwaKHhwriV6EXea2zvkf6lIJPA14Q4uHLcui2v-o9ynvfSJYm572t-WVfXfd7vuLoGxhQ/exec';
// Example: 'https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec'
// Example: 'https://yoursite.com/api/save-score.php'

// ── Offline Queue ────────────────────────────────────────────────
const QUEUE_KEY = 'grammarhub_sync_queue';
const MAX_RETRIES = 3;

// ── In-flight request deduplication ──────────────────────────────
const _inflight = new Map();

function _getQueue() {
    try { return JSON.parse(localStorage.getItem(QUEUE_KEY)) || []; }
    catch { return []; }
}

function _saveQueue(queue) {
    try { localStorage.setItem(QUEUE_KEY, JSON.stringify(queue)); }
    catch { /* quota exceeded — silently skip */ }
}

// ── Student Identity ─────────────────────────────────────────────

/**
 * Get or generate a unique student ID.
 * Stored in localStorage for persistence across sessions.
 */
export function getStudentId() {
    let id = localStorage.getItem('grammarhub_student_id');
    if (!id) {
        // Auto-generate a unique ID: STU_YYYYMMDD_xxxxx
        const d = new Date();
        const dateStr = d.getFullYear().toString() +
            String(d.getMonth() + 1).padStart(2, '0') +
            String(d.getDate()).padStart(2, '0');
        const rand = Math.random().toString(36).substring(2, 7);
        id = `STU_${dateStr}_${rand}`;
        localStorage.setItem('grammarhub_student_id', id);
    }
    return id;
}

/**
 * Set a specific student ID (e.g. after login or manual entry).
 */
export function setStudentId(id) {
    if (typeof id === 'string' && id.trim().length > 0) {
        localStorage.setItem('grammarhub_student_id', id.trim());
    }
}

/**
 * Get student name from localStorage meta.
 */
export function getStudentName() {
    try {
        const data = JSON.parse(localStorage.getItem('grammarhub_progress_v2'));
        return data?._meta?.studentName || null;
    } catch { return null; }
}

/**
 * Set student name in localStorage meta.
 */
export function setStudentName(name) {
    try {
        const data = JSON.parse(localStorage.getItem('grammarhub_progress_v2')) || {};
        data._meta = { ...(data._meta || {}), studentName: name, studentId: getStudentId() };
        localStorage.setItem('grammarhub_progress_v2', JSON.stringify(data));
    } catch { /* silently fail */ }
}

// ── Main API ─────────────────────────────────────────────────────

export const API = {

    /**
     * Get the current backend URL (used by login.js for dynamic import).
     */
    _getBackendUrl() {
        return BACKEND_URL;
    },

    /**
     * Authenticate a student via the backend.
     * Returns { success, studentId, studentName, email } on success.
     */
    async login(email, password) {
        if (!BACKEND_URL) {
            return { success: false, reason: 'no_backend_configured' };
        }

        try {
            const res = await fetch(BACKEND_URL, {
                method: 'POST',
                redirect: 'follow',
                body: JSON.stringify({
                    action: 'login',
                    email: email,
                    password: password
                })
            });

            if (!res.ok) {
                return { success: false, reason: `http_${res.status}` };
            }

            return await res.json();
        } catch (err) {
            console.warn('[API] Login failed:', err.message);
            return { success: false, reason: err.message };
        }
    },

    /**
     * Validate a session token with the backend.
     */
    async validateSession(studentId, token, loginAt) {
        if (!BACKEND_URL) return { success: true, verified: true }; // skip if no backend

        try {
            const res = await fetch(BACKEND_URL, {
                method: 'POST',
                redirect: 'follow',
                body: JSON.stringify({
                    action: 'validateSession',
                    studentId: studentId,
                    token: token,
                    loginAt: loginAt
                })
            });

            if (!res.ok) return { success: false };
            return await res.json();
        } catch {
            // Network error — allow offline. Don't block the user.
            return { success: true, verified: true };
        }
    },

    /**
     * Fetch student profile details from the backend.
     */
    async getStudentDetails(studentId) {
        if (!BACKEND_URL) return null;
        try {
            const res = await fetch(
                `${BACKEND_URL}?action=getProfile&id=${encodeURIComponent(studentId || getStudentId())}`,
                { method: 'GET' }
            );
            if (!res.ok) return null;
            return await res.json();
        } catch {
            return null;
        }
    },

    /**
     * Sync a completed set result to the backend.
     * Called by engine.js after Progress.saveResult().
     * If backend is unreachable, queues the result for retry.
     */
    async syncResult(subject, level, set, score, total, timeTaken) {
        if (!BACKEND_URL) {
            return { success: false, reason: 'no_backend_configured' };
        }

        const payload = {
            action: 'saveResult',
            studentId: getStudentId(),
            studentName: getStudentName() || 'Anonymous',
            subject,
            level,
            set,
            score,
            total,
            timeTaken,
            percentage: Math.round((score / total) * 100),
            timestamp: Date.now(),
            date: new Date().toISOString()
        };

        const result = await this._sendPayload(payload);

        if (result.success) {
            // Invalidate session cache so next navigation re-fetches fresh data
            try {
                const { Progress } = await import('../js/progress.js');
                Progress.invalidateCache();
            } catch { /* non-blocking */ }
        }

        if (!result.success) {
            // Queue for retry
            const queue = _getQueue();
            queue.push({ ...payload, retries: 0 });
            _saveQueue(queue);
        }

        return result;
    },

    /**
     * Retry sending any queued (offline) results.
     * Call this on page load or when connectivity is restored.
     */
    async retryQueue() {
        if (!BACKEND_URL) return;
        const queue = _getQueue();
        if (queue.length === 0) return;

        const remaining = [];
        for (const item of queue) {
            const result = await this._sendPayload(item);
            if (!result.success) {
                item.retries = (item.retries || 0) + 1;
                if (item.retries < MAX_RETRIES) {
                    remaining.push(item);
                }
                // Drop items that exceeded MAX_RETRIES
            }
        }
        _saveQueue(remaining);
    },

    /**
     * Fetch student progress from backend (for multi-device sync).
     */
    async fetchProgress(studentId) {
        if (!BACKEND_URL) return null;
        const key = 'fetchProgress_' + (studentId || getStudentId());
        if (_inflight.has(key)) return _inflight.get(key);
        const promise = (async () => {
            try {
                const res = await fetch(
                    `${BACKEND_URL}?action=getProgress&id=${encodeURIComponent(studentId || getStudentId())}`,
                    { method: 'GET' }
                );
                if (!res.ok) return null;
                return await res.json();
            } catch {
                return null;
            } finally {
                _inflight.delete(key);
            }
        })();
        _inflight.set(key, promise);
        return promise;
    },

    /**
     * Server-authoritative session check.
     * Returns { success: true } if the token is still the active session.
     */
    async checkSession(studentId, activeSessionToken) {
        if (!BACKEND_URL) return { success: true };
        try {
            const res = await fetch(BACKEND_URL, {
                method: 'POST',
                redirect: 'follow',
                body: JSON.stringify({
                    action: 'checkSession',
                    studentId: studentId,
                    activeSessionToken: activeSessionToken
                })
            });
            if (!res.ok) return { success: false };
            return await res.json();
        } catch {
            // Network error — allow offline, don't block the user
            return { success: true };
        }
    },

    /**
     * Clear the active session token on the server (logout).
     */
    async logoutSession(studentId, activeSessionToken) {
        if (!BACKEND_URL) return { success: true };
        try {
            const res = await fetch(BACKEND_URL, {
                method: 'POST',
                redirect: 'follow',
                body: JSON.stringify({
                    action: 'logout',
                    studentId: studentId,
                    activeSessionToken: activeSessionToken
                })
            });
            if (!res.ok) return { success: false };
            return await res.json();
        } catch {
            return { success: true }; // still clear local session
        }
    },

    /**
     * Register a new student account.
     * Returns { success: true } on success, with status set to 'pending'.
     */
    async register(name, email, password) {
        if (!BACKEND_URL) {
            return { success: false, error: 'Backend not configured.' };
        }
        try {
            const res = await fetch(BACKEND_URL, {
                method: 'POST',
                redirect: 'follow',
                body: JSON.stringify({
                    action: 'register',
                    name: name,
                    email: email,
                    password: password
                })
            });
            if (!res.ok) return { success: false, error: `Server error (HTTP ${res.status})` };
            return await res.json();
        } catch (err) {
            return { success: false, error: err.message };
        }
    },

    /**
     * Internal: send a payload to the backend.
     */
    async _sendPayload(payload) {
        try {
            const res = await fetch(BACKEND_URL, {
                method: 'POST',
                redirect: 'follow',
                body: JSON.stringify(payload)
            });

            if (!res.ok) {
                console.warn(`[API] Backend returned HTTP ${res.status}`);
                return { success: false, reason: `http_${res.status}` };
            }

            let responseData = null;
            try { responseData = await res.json(); } catch { /* empty body is OK */ }

            return { success: true, data: responseData };
        } catch (err) {
            console.warn('[API] Backend sync failed:', err.message);
            return { success: false, reason: err.message };
        }
    }
};

// ── Auto-retry queue on load ─────────────────────────────────────
if (BACKEND_URL) {
    // Retry queued items when the page loads
    window.addEventListener('load', () => API.retryQueue(), { once: true });
    // Also retry when connectivity is restored
    window.addEventListener('online', () => API.retryQueue());
}
