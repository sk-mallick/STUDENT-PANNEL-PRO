// ================================================================
// student-panel/js/profile.js
// Drives profile.html — student dashboard with performance metrics.
// ================================================================

import { Progress } from './progress.js';
import { checkAuth, logout } from './auth-guard.js';
import { SUBJECTS, LEVEL_ORDER as LEVELS, escapeHTML } from './app.js';

// ── Authentication guard ────────────────────────────────────────
await checkAuth();

// ── Tailwind extension ──────────────────────────────────────────
if (typeof tailwind !== 'undefined') {
    tailwind.config = {
        theme: {
            extend: {
                fontFamily: { sans: ['Inter', 'sans-serif'] },
                colors: {
                    gold: { 400: '#FACC15', 500: '#EAB308', 600: '#CA8A04' },
                    slate: { 850: '#1a2234', 900: '#0f172a', 950: '#020617' }
                }
            }
        }
    };
}

// ── Known levels (imported from app.js) ─────────────────────────
// SUBJECTS and LEVELS imported above

// ── Helpers ─────────────────────────────────────────────────────
const esc = escapeHTML;

function formatTime(totalSeconds) {
    if (!totalSeconds || totalSeconds <= 0) return '0m';
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    if (m === 0) return '<1m';
    return `${m}m`;
}

function _set(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}

// ── Init ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {

    // ── Logout button ───────────────────────────────────────────
    const logoutBtn = document.getElementById('btn-logout');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => logout());
    }

    // ── Render from local data FIRST (non-blocking) ──────────────
    _renderProfile();

    // ── Then sync from backend in background ─────────────────────
    Progress.syncFromBackend().then(synced => {
        if (synced) {
            // Re-render with merged data
            _renderProfile();
        }
    }).catch(() => { /* non-blocking */ });
});

async function _renderProfile() {
    const data = Progress.getAll();
    const globalStats = Progress.getGlobalStats();
    const meta = data._meta || {};

    // ── Student identity ────────────────────────────────────────
    const studentName = meta.studentName || 'Student';
    const studentId = meta.studentId || localStorage.getItem('grammarhub_student_id') || '—';
    const schoolName = meta.schoolName || '—';
    const className = meta.className || '—';
    const initial = studentName.charAt(0).toUpperCase();

    _set('profile-name', studentName);
    _set('profile-id', studentId);
    _set('profile-school', schoolName);
    _set('profile-class', className);

    // ── Profile Photo ───────────────────────────────────────────
    const photoContainer = document.getElementById('profile-photo-container');
    const photoUrl = meta.profilePhoto;

    if (photoUrl && photoContainer) {
        const img = new Image();
        img.onload = () => {
            photoContainer.innerHTML = '';
            img.className = 'w-full h-full object-cover rounded-full';
            img.alt = studentName;
            photoContainer.appendChild(img);
        };
        img.onerror = () => {
            // Keep the initial-based fallback — do nothing
        };
        img.src = photoUrl;
    } else if (photoContainer) {
        // Fallback: show initial
        const initEl = document.getElementById('profile-photo-initial');
        if (initEl) initEl.textContent = initial;
    }

    // ── Member Since ────────────────────────────────────────────
    let earliest = Infinity;
    _walkResults(data, (entry) => {
        if (entry.timestamp && entry.timestamp < earliest) earliest = entry.timestamp;
    });
    if (earliest < Infinity) {
        _set('profile-joined', new Date(earliest).toLocaleDateString('en-US', {
            year: 'numeric', month: 'short', day: 'numeric'
        }));
    }

    // ── Overall Performance ─────────────────────────────────────
    _set('perf-score', globalStats.overallPercentage + '%');
    _set('perf-sets', String(globalStats.totalSetsAttempted));
    const bestName = globalStats.bestSubject.id === 'None'
        ? 'None'
        : globalStats.bestSubject.id.replace(/-/g, ' ');
    _set('perf-best', bestName);
    _set('perf-time', formatTime(Progress.getTimeTotals()));

    // ── Subject Breakdown ───────────────────────────────────────
    const breakdown = document.getElementById('subject-breakdown');
    if (!breakdown) return;

    const subjectCards = [];
    for (const sub of SUBJECTS) {
        let config = null;
        try {
            const mod = await import(`../data/${sub}/std-config.js`);
            config = mod.default;
        } catch { continue; }

        const subData = data[sub];
        if (!subData) continue;

        let totalDone = 0, totalScoreSum = 0, subTimeTaken = 0;
        for (const lvl of LEVELS) {
            const lvlData = subData[lvl];
            if (!lvlData) continue;
            for (const s of Object.keys(lvlData)) {
                if (s === '_meta') continue;
                const entry = lvlData[s];
                totalDone++;
                totalScoreSum += entry.percentage || 0;
                subTimeTaken += entry.timeTaken || 0;
            }
        }
        if (totalDone === 0) continue;

        const avgScore = Math.round(totalScoreSum / totalDone);
        const scoreColor = avgScore >= 80 ? 'text-emerald-400' : avgScore >= 50 ? 'text-orange-400' : 'text-red-400';
        const barGradient = avgScore >= 80
            ? 'from-emerald-600 to-emerald-400'
            : 'from-yellow-600 to-yellow-400';

        subjectCards.push(`
        <div class="stat-card bg-slate-900 border border-slate-800/80 rounded-2xl p-4 sm:p-5
                    shadow-md shadow-black/10 animate-enter"
             style="animation-delay:${subjectCards.length * 50}ms">
            <div class="flex items-center justify-between mb-3">
                <h3 class="text-sm font-black text-white uppercase tracking-tight truncate mr-2">
                    ${esc(config.title || sub)}
                </h3>
                <span class="text-xl font-black ${scoreColor} shrink-0">${avgScore}%</span>
            </div>
            <div class="space-y-2">
                <div class="flex items-center justify-between text-[9px] font-bold uppercase tracking-widest">
                    <span class="text-slate-500">Sets Done</span>
                    <span class="text-slate-300">${totalDone}</span>
                </div>
                <div class="flex items-center justify-between text-[9px] font-bold uppercase tracking-widest">
                    <span class="text-slate-500">Time Spent</span>
                    <span class="text-slate-300">${formatTime(subTimeTaken)}</span>
                </div>
                <div class="h-[3px] bg-slate-800 rounded-full overflow-hidden mt-1">
                    <div class="h-full rounded-full bg-gradient-to-r ${barGradient} transition-all duration-700"
                         style="width:${Math.min(avgScore, 100)}%"></div>
                </div>
            </div>
        </div>`);
    }

    breakdown.innerHTML = subjectCards.length > 0
        ? subjectCards.join('')
        : `<div class="col-span-full text-center py-10 bg-slate-900/50 rounded-2xl border border-slate-800/60">
               <p class="text-slate-600 font-bold text-[10px] uppercase tracking-widest">
                   No practice data yet — start practicing to see progress here.
               </p>
           </div>`;

    // ── Recent Activity ─────────────────────────────────────────
    const activityEl = document.getElementById('recent-activity');
    if (!activityEl) return;

    const recentEntries = [];
    _walkResults(data, (entry, subject, level, set) => {
        recentEntries.push({ ...entry, subject, level, set });
    });
    recentEntries.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    const recent = recentEntries.slice(0, 8);

    if (recent.length > 0) {
        activityEl.innerHTML = recent.map((r, i) => {
            const passed = r.percentage >= 80;
            const scoreColor = passed ? 'text-emerald-400' : 'text-orange-400';
            const statusLabel = passed ? 'Passed' : 'Review';
            const statusClasses = passed
                ? 'bg-emerald-950/50 text-emerald-400 border-emerald-900/50'
                : 'bg-orange-950/50 text-orange-400 border-orange-900/50';
            return `
            <div class="flex items-center gap-3 sm:gap-4 p-3 sm:p-4 bg-slate-900 border border-slate-800
                        rounded-xl shadow-sm animate-enter hover:border-slate-700/80 transition-all"
                 style="animation-delay:${i * 40}ms">
                <div class="shrink-0 w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-slate-950 border border-slate-800
                            flex items-center justify-center">
                    <span class="text-xs sm:text-sm font-black ${scoreColor}">${r.percentage}%</span>
                </div>
                <div class="flex-1 min-w-0">
                    <div class="text-xs sm:text-sm font-black text-white uppercase tracking-tight truncate">
                        ${esc(r.subject.replace(/-/g, ' '))}
                    </div>
                    <div class="flex flex-wrap items-center gap-1 mt-0.5 text-[9px] sm:text-[10px] font-bold
                                text-slate-500 uppercase tracking-widest">
                        <span class="text-slate-400">${esc(r.level)}</span>
                        <span class="opacity-30">•</span>
                        <span>Set ${esc(r.set)}</span>
                        ${r.date ? `<span class="opacity-30">•</span><span>${esc(r.date)}</span>` : ''}
                    </div>
                </div>
                <span class="shrink-0 px-2 py-0.5 rounded text-[8px] sm:text-[9px] font-black uppercase
                             tracking-widest border ${statusClasses}">
                    ${statusLabel}
                </span>
            </div>`;
        }).join('');
    }
}

// ── Walk all results ─────────────────────────────────────────────
function _walkResults(data, callback) {
    for (const sub of Object.keys(data)) {
        if (sub === '_meta') continue;
        for (const lvl of Object.keys(data[sub])) {
            if (lvl === '_meta') continue;
            for (const s of Object.keys(data[sub][lvl])) {
                if (s === '_meta') continue;
                callback(data[sub][lvl][s], sub, lvl, s);
            }
        }
    }
}
