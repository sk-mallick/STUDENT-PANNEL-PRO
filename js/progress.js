// ================================================================
// student-panel/js/progress.js
// All localStorage read/write. Single source of truth.
// Session cache layer for instant dashboard rendering.
// ================================================================

const STORAGE_KEY = 'grammarhub_progress_v2';
const CACHE_KEY = 'grammarhub_dashboard_cache';
const PREFETCH_TIMEOUT_MS = 5000;

// In-flight sync guard — prevents parallel syncFromBackend calls
let _inflightSync = null;

export const Progress = {

    getAll() {
        try {
            const raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
            if (!raw || typeof raw !== 'object') return {};
            for (const key of Object.keys(raw)) {
                if (key === '_meta') continue;
                if (typeof raw[key] !== 'object' || raw[key] === null) {
                    delete raw[key];
                }
            }
            return raw;
        }
        catch { return {}; }
    },

    saveResult(subject, level, set, score, total, timeTaken = 0) {
        const data = this.getAll();
        const pct = Math.round((score / total) * 100);
        const best = data[subject]?.[level]?.[set]?.percentage || 0;
        const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
        const ts = Date.now();

        data._meta = {
            ...(data._meta || {}),
            lastAttempted: { subject, level, set, percentage: pct, date, timestamp: ts }
        };

        if (pct >= best) {
            if (!data[subject]) data[subject] = {};
            if (!data[subject][level]) data[subject][level] = {};
            data[subject][level][set] = { score, total, percentage: pct, date, timestamp: ts, timeTaken };
        }

        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        } catch (e) {
            console.warn('[Progress] localStorage save failed (quota?):', e.message);
        }
        return pct;
    },

    getSetResult(subject, level, set) {
        return this.getAll()[subject]?.[level]?.[set] || null;
    },

    getLevelStats(subject, level) {
        const lvl = this.getAll()[subject]?.[level] || {};
        const keys = Object.keys(lvl).filter(k => k !== '_meta');
        if (!keys.length) return { completed: 0, avgScore: 0 };
        const total = keys.reduce((sum, k) => sum + (lvl[k].percentage || 0), 0);
        return { completed: keys.length, avgScore: Math.round(total / keys.length) };
    },

    getSubjectStats(subject) {
        const sub = this.getAll()[subject] || {};
        let completed = 0;
        Object.keys(sub).forEach(lvl => {
            if (lvl === '_meta') return;
            completed += Object.keys(sub[lvl]).filter(k => k !== '_meta').length;
        });
        return { completed };
    },

    getGlobalStats() {
        const data = this.getAll();
        let totalSets = 0, totalScore = 0;
        const subjectsActive = new Set();
        let bestSubject = { id: 'None', score: 0 };

        Object.keys(data).forEach(sub => {
            if (sub === '_meta') return;
            let subSets = 0, subScore = 0;
            Object.keys(data[sub]).forEach(lvl => {
                if (lvl === '_meta') return;
                Object.keys(data[sub][lvl]).forEach(s => {
                    if (s === '_meta') return;
                    const p = data[sub][lvl][s].percentage || 0;
                    subSets++; subScore += p; totalScore += p;
                    subjectsActive.add(sub);
                });
            });
            totalSets += subSets;
            if (subSets > 0 && Math.round(subScore / subSets) > bestSubject.score) {
                bestSubject = { id: sub, score: Math.round(subScore / subSets) };
            }
        });

        return {
            totalSetsAttempted: totalSets,
            overallPercentage: totalSets > 0 ? Math.round(totalScore / totalSets) : 0,
            subjectsActive: subjectsActive.size,
            bestSubject,
            lastAttempted: data._meta?.lastAttempted || null
        };
    },

    /** Get total time spent across all sets (in seconds) */
    getTimeTotals() {
        const data = this.getAll();
        let totalTime = 0;
        Object.keys(data).forEach(sub => {
            if (sub === '_meta') return;
            Object.keys(data[sub]).forEach(lvl => {
                if (lvl === '_meta') return;
                Object.keys(data[sub][lvl]).forEach(s => {
                    if (s === '_meta') return;
                    totalTime += data[sub][lvl][s].timeTaken || 0;
                });
            });
        });
        return totalTime;
    },

    // ================================================================
    // SESSION CACHE — Login-initiated prefetch stored in sessionStorage
    // ================================================================

    /**
     * Prefetch dashboard data at login time.
     * Fetches progress + profile in parallel, merges into localStorage,
     * and caches in sessionStorage for instant rendering on all pages.
     * Returns true on success.
     */
    async prefetchDashboardData(studentId) {
        try {
            const { API, getStudentId } = await import('../backend/api.js');
            const backendUrl = API._getBackendUrl?.();
            if (!backendUrl) return false;

            const sid = studentId || getStudentId();
            if (!sid) return false;

            console.log('[Progress] Prefetching dashboard data...');

            // Fetch both in parallel with timeout for speed
            const withTimeout = (promise) => Promise.race([
                promise,
                new Promise(resolve => setTimeout(() => resolve(null), PREFETCH_TIMEOUT_MS))
            ]);

            const [remote, profile] = await Promise.all([
                withTimeout(API.fetchProgress(sid)).catch(() => null),
                withTimeout(API.getStudentDetails(sid)).catch(() => null)
            ]);

            // Merge progress into localStorage
            if (remote && typeof remote === 'object' && Object.keys(remote).length > 0) {
                this._mergeBackendData(remote);
            }

            // Merge profile into localStorage
            if (profile && profile.success) {
                const data = this.getAll();
                data._meta = {
                    ...(data._meta || {}),
                    studentId: profile.studentId,
                    studentName: profile.studentName,
                    schoolName: profile.schoolName || '',
                    className: profile.className || '',
                    profilePhoto: profile.profileImageURL || '',
                    guardianName: profile.guardianName || '',
                    contactNumber: profile.contactNumber || ''
                };
                try {
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
                } catch { /* silently fail */ }
            }

            // Store cache marker in sessionStorage
            try {
                sessionStorage.setItem(CACHE_KEY, JSON.stringify({
                    cachedAt: Date.now(),
                    studentId: sid,
                    valid: true
                }));
            } catch { /* sessionStorage not available */ }

            console.log('[Progress] Dashboard data prefetch complete.');
            return true;
        } catch (err) {
            console.warn('[Progress] Prefetch failed:', err.message);
            return false;
        }
    },

    /**
     * Check if valid dashboard cache exists in sessionStorage.
     */
    _hasValidCache() {
        try {
            const raw = sessionStorage.getItem(CACHE_KEY);
            if (!raw) return false;
            const cache = JSON.parse(raw);
            if (!cache || !cache.valid) return false;
            // Cache is valid for this browser session
            return true;
        } catch {
            return false;
        }
    },

    /**
     * Mark the session cache as invalid (stale).
     * Called after completing a new set so the next navigation re-fetches.
     */
    invalidateCache() {
        try {
            const raw = sessionStorage.getItem(CACHE_KEY);
            if (raw) {
                const cache = JSON.parse(raw);
                cache.valid = false;
                sessionStorage.setItem(CACHE_KEY, JSON.stringify(cache));
            }
        } catch { /* ignore */ }
        console.log('[Progress] Dashboard cache invalidated.');
    },

    /**
     * Clear ALL session and cached data. Called on logout.
     * Wipes: sessionStorage cache, localStorage progress, student ID, sync queue.
     */
    clearAllSessionData() {
        try { sessionStorage.removeItem(CACHE_KEY); } catch { /* ignore */ }
        try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
        try { localStorage.removeItem('grammarhub_student_id'); } catch { /* ignore */ }
        try { localStorage.removeItem('grammarhub_sync_queue'); } catch { /* ignore */ }
        console.log('[Progress] All session data cleared.');
    },

    // ================================================================
    // BACKEND SYNC — Cache-first strategy
    // ================================================================

    /**
     * Sync from backend using CACHE-FIRST strategy.
     * If valid cache exists in sessionStorage, skip backend call entirely.
     * Otherwise fetch fresh data from Google Sheets.
     * Returns true if data was synced/available, false if skipped/failed.
     */
    async syncFromBackend() {
        // ── Deduplicate: return existing in-flight promise if one is running ──
        if (_inflightSync) {
            console.log('[Progress] Sync already in-flight — reusing existing promise.');
            return _inflightSync;
        }

        // ── Cache check — skip backend if we have valid prefetched data ──
        if (this._hasValidCache()) {
            console.log('[Progress] Using cached dashboard data — skipping backend fetch.');
            return true;
        }

        // ── No cache — full backend fetch ───────────────────────────
        _inflightSync = (async () => {
            try {
                const { API, getStudentId } = await import('../backend/api.js');
                const backendUrl = API._getBackendUrl?.();
                if (!backendUrl) {
                    console.log('[Progress] No backend configured — skipping sync.');
                    return false;
                }

                const studentId = getStudentId();
                if (!studentId) {
                    console.log('[Progress] No student ID — skipping sync.');
                    return false;
                }

                console.log('[Progress] No cache — fetching from backend...');
                return await this.prefetchDashboardData(studentId);
            } catch (err) {
                console.warn('[Progress] Backend sync failed:', err.message);
                return false;
            } finally {
                _inflightSync = null;
            }
        })();

        return _inflightSync;
    },

    /**
     * Merge remote progress data into localStorage.
     * Keeps the BEST score for each subject/level/set.
     */
    _mergeBackendData(remote) {
        const local = this.getAll();
        let latestAttempt = local._meta?.lastAttempted || null;

        for (const subject of Object.keys(remote)) {
            if (subject === '_meta' || subject === 'success') continue;
            if (!remote[subject] || typeof remote[subject] !== 'object') continue;

            if (!local[subject]) local[subject] = {};

            for (const level of Object.keys(remote[subject])) {
                if (level === '_meta') continue;
                if (!remote[subject][level] || typeof remote[subject][level] !== 'object') continue;

                if (!local[subject][level]) local[subject][level] = {};

                for (const set of Object.keys(remote[subject][level])) {
                    if (set === '_meta') continue;
                    const remoteEntry = remote[subject][level][set];
                    const localEntry = local[subject][level][set];

                    const remotePct = remoteEntry?.percentage || 0;
                    const localPct = localEntry?.percentage || 0;

                    if (!localEntry || remotePct > localPct ||
                        (remotePct === localPct && (remoteEntry?.timestamp || 0) > (localEntry?.timestamp || 0))) {
                        local[subject][level][set] = {
                            score: remoteEntry.score,
                            total: remoteEntry.total,
                            percentage: remotePct,
                            date: remoteEntry.date || '',
                            timestamp: remoteEntry.timestamp || 0,
                            timeTaken: remoteEntry.timeTaken || 0
                        };
                    }

                    const entryTs = remoteEntry?.timestamp || 0;
                    if (!latestAttempt || entryTs > (latestAttempt.timestamp || 0)) {
                        latestAttempt = {
                            subject, level, set,
                            percentage: remotePct,
                            date: remoteEntry.date || '',
                            timestamp: entryTs
                        };
                    }
                }
            }
        }

        local._meta = {
            ...(local._meta || {}),
            lastAttempted: latestAttempt
        };

        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(local));
        } catch (e) {
            console.warn('[Progress] localStorage save failed during merge:', e.message);
        }
    }
};

