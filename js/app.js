// ================================================================
// student-panel/js/app.js
// Central brain. Drives: index.html, subject.html, level.html
// practice.html is driven by engine.js (which imports from here)
// ================================================================

import { Progress } from './progress.js';
import { checkAuth, isAuthenticated } from './auth-guard.js';

// ── Authentication guard (non-blocking) ─────────────────────────
// 1. Immediate local session check — redirects instantly if expired/missing
if (!isAuthenticated()) {
    window.location.href = 'login.html';
    // Halt module evaluation: throw prevents any page rendering
    throw new Error('[Auth] No valid local session — redirecting.');
}
// 2. Server-side token validation runs in background (does NOT block render).
//    If the server says the token is invalid (another device logged in),
//    checkAuth() will redirect to login.html automatically.
checkAuth().catch(() => { /* handled internally via redirect */ });

// ── Tailwind extension ──────────────────────────────────────────
if (typeof tailwind !== 'undefined') {
    tailwind.config = {
        theme: {
            extend: {
                fontFamily: { sans: ['Inter', 'sans-serif'] },
                colors: {
                    gold: { 400: '#FACC15', 500: '#EAB308', 600: '#CA8A04' },
                    slate: { 850: '#1a2234', 900: '#0f172a', 950: '#020617' }
                },
                letterSpacing: { widest: '.25em' }
            }
        }
    };
}

// ── Injected global styles ──────────────────────────────────────
const _s = document.createElement('style');
_s.textContent = `
    @keyframes slideUpFade {
        from { opacity:0; transform:translateY(12px); }
        to   { opacity:1; transform:translateY(0);    }
    }
    @keyframes shake {
        10%,90%    { transform:translate3d(-1px,0,0); }
        20%,80%    { transform:translate3d(2px,0,0);  }
        30%,50%,70%{ transform:translate3d(-4px,0,0); }
        40%,60%    { transform:translate3d(4px,0,0);  }
    }
    .animate-enter { animation: slideUpFade 0.45s cubic-bezier(0.16,1,0.3,1) forwards; opacity:0; }
    .animate-shake { animation: shake 0.5s cubic-bezier(.36,.07,.19,.97) both; }
    .no-scrollbar::-webkit-scrollbar { display:none; }
    .no-scrollbar { -ms-overflow-style:none; scrollbar-width:none; }
    @keyframes spin { to { transform:rotate(360deg); } }
    .spin { animation: spin 1s linear infinite; }
`;
document.head.appendChild(_s);

// ================================================================
// EXPORTED UTILITIES  (used by engine.js too)
// ================================================================

/** Escape HTML to prevent XSS when injecting into innerHTML */
export function escapeHTML(str) {
    if (typeof str !== 'string') return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ── Param validation constants ──────────────────────────────────
const VALID_LEVELS = ['preprimary', 'primary', 'middle', 'high'];
const VALID_PARAM_RE = /^[a-zA-Z0-9_-]+$/;

/** Parse URL query params → { subject, level, set, mode } with validation */
export function getParams() {
    const p = new URLSearchParams(window.location.search);

    let subject = p.get('subject') || 'tenses';
    let level = p.get('level') || 'high';
    let set = p.get('set') || '1';
    let mode = p.get('mode') || 'student';

    // Validate subject — only alphanumeric, hyphens, underscores
    if (!VALID_PARAM_RE.test(subject)) subject = 'tenses';
    // Validate level — must be from known list
    if (!VALID_LEVELS.includes(level)) level = 'high';
    // Validate set — must be a positive integer
    if (!/^\d+$/.test(set) || parseInt(set, 10) < 1) set = '1';
    // Validate mode
    if (!VALID_PARAM_RE.test(mode)) mode = 'student';

    return { subject, level, set, mode };
}

/**
 * Get sets from config (zero network requests).
 * Returns [1, 2, …, N] based on setCounts in std-config.js.
 * Returns null if config doesn't have setCounts for this level.
 */
export function getSetsFromConfig(config, level) {
    const count = config?.setCounts?.[level];
    if (typeof count !== 'number' || count <= 0) return null;
    return Array.from({ length: count }, (_, i) => i + 1);
}

/** Auto-discover sets by fetching set1.json, set2.json … using parallel batches.
 *  FALLBACK ONLY — use getSetsFromConfig() first for instant results. */
export async function discoverSets(subject, level) {
    const sets = [];
    const BATCH_SIZE = 10;

    for (let start = 1; start <= 60; start += BATCH_SIZE) {
        const promises = [];
        for (let n = start; n < start + BATCH_SIZE && n <= 60; n++) {
            promises.push(
                fetch(`data/${encodeURIComponent(subject)}/${encodeURIComponent(level)}/set${n}.json`, { method: 'HEAD' })
                    .then(r => r.ok ? n : null)
                    .catch(() => null)
            );
        }
        const results = await Promise.all(promises);
        const found = results.filter(n => n !== null).sort((a, b) => a - b);
        sets.push(...found);
        if (found.length === 0) break;
    }
    return sets;
}

/** Stagger-animate elements matching selector */
export function stagger(selector, delay = 50) {
    document.querySelectorAll(selector).forEach((el, i) => {
        el.style.animationDelay = `${i * delay}ms`;
        el.classList.add('animate-enter');
    });
}

/** Inject sticky header into #header-mount */
export function injectHeader(title, crumb, backUrl) {
    const mount = document.getElementById('header-mount');
    if (!mount) return;
    // Sanitise backUrl — only allow relative paths and http/https
    const safeUrl = /^(https?:\/\/|[a-zA-Z0-9_./?&=%-]+)$/.test(backUrl) ? backUrl : 'index.html';
    mount.innerHTML = `
    <header class="sticky top-0 z-50 bg-[#020617]/95 backdrop-blur-xl border-b border-slate-800 shadow-sm">
        <div class="max-w-7xl mx-auto px-4 md:px-8 py-3 flex items-center justify-between gap-4">
            <div class="flex items-center gap-3 min-w-0">
                <a href="${safeUrl}"
                   class="shrink-0 w-9 h-9 flex items-center justify-center bg-slate-900 border
                          border-slate-800 rounded-xl hover:border-gold-500 hover:bg-slate-800
                          text-slate-400 hover:text-white transition-all group">
                    <svg class="w-4 h-4 group-hover:-translate-x-0.5 transition-transform"
                         fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M15 19l-7-7 7-7"/>
                    </svg>
                </a>
                <div class="min-w-0">
                    <div class="text-[10px] text-emerald-500 font-bold tracking-widest uppercase truncate">${escapeHTML(crumb)}</div>
                    <h1 class="text-lg font-black text-white uppercase tracking-tight truncate leading-none mt-0.5">
                        ${escapeHTML(title)}
                    </h1>
                </div>
            </div>
            <div id="header-right" class="shrink-0 flex items-center gap-3"></div>
        </div>
        <!-- engine progress bar (hidden by default) -->
        <div id="header-progress-wrap" class="h-[3px] bg-slate-900 w-full hidden">
            <div id="header-progress-fill"
                 class="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all duration-300 w-0">
            </div>
        </div>
    </header>`;
}

/** Update the header progress bar (used by engine.js) */
export function updateHeaderProgress(answered, total) {
    const wrap = document.getElementById('header-progress-wrap');
    const fill = document.getElementById('header-progress-fill');
    if (!wrap || !fill) return;
    wrap.classList.remove('hidden');
    fill.style.width = total > 0 ? `${(answered / total) * 100}%` : '0%';
}

/** Timer helpers (used by engine.js) — uses Date.now() delta to avoid drift */
let _timerHandle = null;
let _timerStart = 0;

export function startTimer(targetId = 'engine-timer') {
    _timerStart = Date.now();
    clearInterval(_timerHandle);
    _timerHandle = setInterval(() => {
        const elapsed = Math.floor((Date.now() - _timerStart) / 1000);
        const el = document.getElementById(targetId);
        if (!el) return;
        const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
        const s = String(elapsed % 60).padStart(2, '0');
        el.textContent = `${m}:${s}`;
    }, 1000);
}

export function stopTimer() {
    clearInterval(_timerHandle);
    return Math.floor((Date.now() - _timerStart) / 1000);
}

/** Canvas-confetti helper */
export function fireConfetti() {
    if (window.confetti) {
        confetti({
            particleCount: 130, spread: 80, origin: { y: 0.6 },
            colors: ['#FACC15', '#10B981', '#3B82F6', '#F97316']
        });
    }
}

// ================================================================
// PAGE: index.html  (Student Dashboard)
// ================================================================
// ── Shared constants (exported for profile.js) ──────────────────
export const SUBJECTS = [
    'tenses', 'sva', 'narration', 'voice', 'articles', 'prepositions',
    'modals', 'nouns', 'pronouns', 'adjectives', 'adverbs', 'conjunctions'
];

// ================================================================
// PAGE ROUTER — runs after DOM is ready to avoid TDZ issues
// ================================================================
document.addEventListener('DOMContentLoaded', () => {
    const _path = window.location.pathname;
    if (_path.includes('subject.html')) _initSubject();
    else if (_path.includes('level.html')) _initLevel();
    else _initIndex();  // index.html + fallback
});

async function _initIndex() {

    // ── Helper: render stats from current localStorage data ─────
    function _renderStats(available) {
        const stats = Progress.getGlobalStats();
        _set('stat-score', stats.overallPercentage + '%');
        _set('stat-best', stats.bestSubject.id.replace(/-/g, ' '));

        const LEVEL_SCAN = ['preprimary', 'primary', 'middle', 'high'];
        let totalSetsAvailable = 0;
        let totalSubjectsFound = available.length;
        let activeSubjectCount = 0;

        for (const sub of available) {
            let subHasProgress = false;
            for (const lvl of LEVEL_SCAN) {
                const configSets = getSetsFromConfig(sub, lvl);
                const setCount = configSets ? configSets.length : 0;
                totalSetsAvailable += setCount;
                if (!subHasProgress) {
                    const lvlStats = Progress.getLevelStats(sub.id, lvl);
                    if (lvlStats.completed > 0) subHasProgress = true;
                }
            }
            if (subHasProgress) activeSubjectCount++;
        }

        _setHTML('stat-sets',
            `${stats.totalSetsAttempted}<span class="text-base font-bold text-slate-600 ml-1">/ ${totalSetsAvailable}</span>`);
        _setHTML('stat-subjects',
            `${activeSubjectCount}<span class="text-base font-bold text-slate-600 ml-1">/ ${totalSubjectsFound}</span>`);

        return stats;
    }

    // ── Step 1: Show local stats immediately (fast) ─────────────
    let stats = Progress.getGlobalStats();
    _set('stat-score', stats.overallPercentage + '%');
    _set('stat-best', stats.bestSubject.id.replace(/-/g, ' '));

    // ── Step 2: Build subject grid (discover configs — PARALLEL) ────
    const grid = document.getElementById('subject-grid');
    if (!grid) return;

    // Load all subject configs in parallel instead of sequential await
    const configResults = await Promise.allSettled(
        SUBJECTS.map(sub =>
            import(`../data/${sub}/std-config.js`)
                .then(mod => ({ id: sub, ...mod.default }))
        )
    );
    const available = configResults
        .filter(r => r.status === 'fulfilled')
        .map(r => r.value);
    available.sort((a, b) => (a.order || 99) - (b.order || 99));

    // ── Step 3: Render stats with config-based totals ────────────
    stats = _renderStats(available);

    // ── Step 4: Sync from backend (non-blocking) and refresh ────
    // This fetches all results from Google Sheets, merges into
    // localStorage, then re-renders stats with the combined data.
    Progress.syncFromBackend().then(synced => {
        if (synced) {
            // Re-render stats with merged backend data
            const updatedStats = _renderStats(available);
            // Also refresh the resume card with backend data
            _renderResumeCard(updatedStats);
        }
    });

    // ── Step 5: Resume card ──────────────────────────────────────
    _renderResumeCard(stats);

    function _renderResumeCard(st) {
        const la = st.lastAttempted;
        const resumeWrap = document.getElementById('resume-wrap');
        if (!la || !resumeWrap) return;

        resumeWrap.classList.remove('hidden');
        const scoreColor = la.percentage >= 80 ? 'text-emerald-400' : 'text-orange-400';
        const subjectDisplay = escapeHTML(la.subject.replace(/-/g, ' '));
        resumeWrap.innerHTML = `
        <div class="bg-slate-900 border border-slate-800/80 hover:border-gold-500/40 rounded-xl
                    transition-all duration-300 overflow-hidden">
            <div class="flex items-center justify-between px-5 py-3 border-b border-slate-800/60">
                <div class="flex items-center gap-2">
                    <span class="w-1.5 h-1.5 rounded-full bg-gold-500
                                 shadow-[0_0_6px_rgba(234,179,8,0.6)]"></span>
                    <span class="text-[10px] font-black tracking-widest text-gold-500 uppercase">
                        Last Practiced Set
                    </span>
                </div>
                <span class="text-[10px] text-slate-600 font-medium">${escapeHTML(la.date || '')}</span>
            </div>
            <div class="flex flex-col sm:flex-row sm:items-center justify-between px-5 py-4 gap-3">
                <div class="flex items-center gap-4 min-w-0">
                    <div class="min-w-[52px] px-2 py-2.5 bg-slate-950 rounded-xl border border-slate-800
                                flex items-center justify-center shrink-0">
                        <span class="text-sm font-black ${scoreColor} whitespace-nowrap">${la.percentage}%</span>
                    </div>
                    <div class="min-w-0">
                        <div class="text-base font-black text-white uppercase tracking-tight truncate">
                            ${subjectDisplay}
                        </div>
                        <div class="flex flex-wrap items-center gap-1.5 mt-0.5 text-[10px] font-bold
                                    text-slate-500 uppercase tracking-widest">
                            <span class="text-slate-400">${escapeHTML(la.level)}</span>
                            <span class="opacity-30">•</span>
                            <span>Set ${escapeHTML(la.set)}</span>
                            <span class="opacity-30">•</span>
                            <span class="${scoreColor}">${la.percentage >= 80 ? 'Passed' : 'Review'}</span>
                        </div>
                    </div>
                </div>
                <a href="practice.html?subject=${encodeURIComponent(la.subject)}&level=${encodeURIComponent(la.level)}&set=${encodeURIComponent(la.set)}"
                   class="shrink-0 self-start sm:self-auto px-5 py-2.5 bg-gold-500 hover:bg-gold-400 text-black font-black
                          text-xs uppercase tracking-widest rounded-lg transition-all active:scale-95
                          flex items-center gap-1.5">
                    Practice Again
                    <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                              d="M14 5l7 7m0 0l-7 7m7-7H3"/>
                    </svg>
                </a>
            </div>
        </div>`;
    }

    // ── Step 5: Render subject cards ─────────────────────────────
    grid.innerHTML = '';

    available.forEach((sub, i) => {
        const subStats = Progress.getSubjectStats(sub.id);
        const hasProgress = subStats.completed > 0;
        const isOffline = sub.status === 'offline';

        // Icon SVG (book by default — extend with sub.icon later)
        const iconSVG = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3
                 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5
                 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477
                 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746
                 0-3.332.477-4.5 1.253"/>`;

        // Status badge
        const statusBadge = isOffline
            ? `<span title="This subject is currently unavailable"
                     class="px-2 py-0.5 bg-slate-800 border border-slate-700 text-slate-500
                            text-[9px] uppercase tracking-widest font-bold rounded flex items-center gap-1">
                   <span class="w-1.5 h-1.5 rounded-full bg-slate-600 inline-block"></span>Offline
               </span>`
            : hasProgress
                ? `<span class="px-2 py-0.5 rounded flex items-center gap-1
                               bg-emerald-950/80 border border-emerald-900/80 text-emerald-400
                               text-[9px] uppercase tracking-widest font-bold">
                       <span class="w-1.5 h-1.5 rounded-full bg-emerald-500
                                    shadow-[0_0_4px_rgba(52,211,153,0.6)] inline-block"></span>Active
                   </span>`
                : '';

        const subTitle = escapeHTML(sub.title || sub.id);
        const subDesc = escapeHTML(sub.description || 'Practice sets for structured learning.');

        // Card element — <div> if offline (non-clickable), <a> if online
        const card = document.createElement(isOffline ? 'div' : 'a');
        if (!isOffline) card.href = `subject.html?subject=${encodeURIComponent(sub.id)}`;
        card.className = [
            'subject-card opacity-0 flex flex-col h-full relative overflow-hidden',
            'rounded-xl p-6 border transition-all duration-300',
            isOffline
                ? 'bg-slate-900/50 border-slate-800/50 cursor-not-allowed opacity-60'
                : 'bg-slate-900 border-slate-800 hover:border-gold-500/60 group cursor-pointer',
            'shadow-sm'
        ].join(' ');
        card.style.animationDelay = `${i * 45}ms`;
        if (isOffline) card.title = 'This subject is currently unavailable';

        card.innerHTML = `
            <!-- Large background number — more visible -->
            <div class="absolute -right-2 -top-1 font-black select-none pointer-events-none
                        text-[72px] leading-none
                        ${isOffline ? 'text-slate-800/60' : 'text-slate-800/80 group-hover:text-slate-700/80'}
                        transition-colors duration-300">
                ${String(sub.order || i + 1).padStart(2, '0')}
            </div>

            <!-- Top row: icon + badge -->
            <div class="flex items-start justify-between mb-6 relative z-10">
                <div class="w-12 h-12 rounded-xl border flex items-center justify-center transition-all
                            ${isOffline
                ? 'bg-slate-900 border-slate-800 text-slate-600'
                : 'bg-slate-950 border-slate-800 text-blue-400 group-hover:text-gold-400 group-hover:border-gold-500/40 group-hover:bg-gold-950/20 group-hover:shadow-[0_0_12px_rgba(234,179,8,0.1)]'}">
                    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        ${iconSVG}
                    </svg>
                </div>
                ${statusBadge}
            </div>

            <!-- Content -->
            <div class="mt-auto relative z-10">
                <h3 class="text-xl font-black uppercase tracking-tight leading-tight mb-2
                           ${isOffline ? 'text-slate-600' : 'text-white'}">
                    ${subTitle}
                </h3>
                <p class="text-xs font-medium mb-4 leading-relaxed line-clamp-2
                          ${isOffline ? 'text-slate-700' : 'text-slate-500'}">
                    ${subDesc}
                </p>

                <!-- Footer row -->
                <div class="flex items-center justify-between border-t pt-3
                            ${isOffline ? 'border-slate-800/50' : 'border-slate-800'}">
                    <span class="text-[10px] font-black tracking-widest uppercase
                                 ${isOffline ? 'text-slate-700' : hasProgress ? 'text-emerald-400' : 'text-slate-500'}">
                        ${isOffline
                ? 'Unavailable'
                : hasProgress
                    ? `${subStats.completed} Sets Done`
                    : 'Start Learning'}
                    </span>
                    ${!isOffline ? `
                    <svg class="w-4 h-4 text-slate-600 group-hover:text-gold-500
                                group-hover:translate-x-1 transition-all duration-200"
                         fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                              d="M17 8l4 4m0 0l-4 4m4-4H3"/>
                    </svg>` : ''}
                </div>
            </div>`;

        grid.appendChild(card);
    });

    stagger('.subject-card', 45);
}

// ================================================================
// PAGE: subject.html  (Subject overview — levels + video card)
// ================================================================
export const LEVEL_ORDER = ['preprimary', 'primary', 'middle', 'high'];
export const LEVEL_LABEL = { preprimary: 'Pre-Primary', primary: 'Primary', middle: 'Middle', high: 'High' };

// Icon SVG paths keyed by std-config icon field
const SUBJECT_ICONS = {
    clock: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
    book: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253',
    lightning: 'M13 10V3L4 14h7v7l9-11h-7z',
    chat: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z',
    pencil: 'M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z',
    star: 'M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z',
};

// ================================================================
// VIDEO HELPERS
// ================================================================

function _resolveVideoMeta(config, subjectTitle) {
    const vc = config.video || {};
    const levels = config.levels || {};

    if (config.video === null) return null;

    const firstLegacyLvl = LEVEL_ORDER.find(k => levels[k]?.playlistId);
    const playlistId = vc.playlistId
        || (firstLegacyLvl ? levels[firstLegacyLvl].playlistId : null);
    const playlistUrl = vc.playlistUrl
        || (playlistId
            ? `https://www.youtube.com/playlist?list=${playlistId}`
            : null);

    let thumbnail = vc.thumbnail || null;

    if (thumbnail && !thumbnail.startsWith('http') && !thumbnail.startsWith('data:')) {
        if (thumbnail.startsWith('/')) {
            // Root-relative path: strip leading '/' and use from webserver root
            thumbnail = thumbnail.replace(/^\/+/, '');
        } else if (!thumbnail.startsWith('./') && !thumbnail.startsWith('../')) {
            // Bare filename (e.g. '46.png'): resolve relative to subject data dir
            const subjectId = config?.id || '';
            thumbnail = subjectId ? `data/${subjectId}/${thumbnail}` : thumbnail;
        }
        // Paths starting with './' or '../' are used as-is
    }

    if (!thumbnail && playlistId) {
        thumbnail = `https://img.youtube.com/vi/${playlistId}/hqdefault.jpg`;
    }

    const videoTitle = vc.title
        || (firstLegacyLvl ? levels[firstLegacyLvl].videoTitle : null)
        || `${subjectTitle} Video Lectures`;

    if (!playlistUrl && !thumbnail) return null;

    return { playlistUrl, playlistId, thumbnail, videoTitle };
}

function _renderVideoCard(container, config, subjectTitle) {
    const meta = _resolveVideoMeta(config, subjectTitle);

    if (!meta) {
        container.innerHTML = `
        <div class="w-full rounded-2xl border border-slate-800/60 bg-slate-900/50
                    flex flex-col items-center justify-center text-center p-8">
            <div class="w-14 h-14 bg-slate-950 rounded-2xl border border-slate-800
                        flex items-center justify-center text-slate-700 mb-4 shadow-inner">
                <svg class="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                          d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0
                             01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0
                             00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>
                </svg>
            </div>
            <p class="text-slate-600 font-bold text-xs uppercase tracking-widest">
                No Video Available
            </p>
            <p class="text-slate-700 text-xs mt-2 max-w-[200px] leading-relaxed">
                Practice sets are ready below whenever you are.
            </p>
        </div>`;
        return;
    }

    const { playlistUrl, thumbnail, videoTitle } = meta;
    const safeVideoTitle = escapeHTML(videoTitle);

    const thumbLayer = thumbnail
        ? `<img src="${escapeHTML(thumbnail)}"
                alt=""
                loading="lazy"
                class="absolute inset-0 w-full h-full object-cover transition-transform
                       duration-500 group-hover:scale-105"
                onerror="this.style.display='none'">`
        : `<div class="absolute inset-0 bg-gradient-to-br
                       from-slate-900 via-[#0d1829] to-[#070f1e]"></div>`;

    const _tag = playlistUrl ? 'a' : 'div';
    const _href = playlistUrl
        ? `href="${escapeHTML(playlistUrl)}" target="_blank" rel="noopener"`
        : '';

    container.innerHTML = `
    <div class="relative w-full" style="padding-top:56.25%">
    <${_tag} ${_href}
       class="video-card absolute inset-0 rounded-2xl overflow-hidden border border-slate-800
              ${playlistUrl ? 'hover:border-blue-500/50 cursor-pointer' : ''} group">

        <div class="absolute inset-0 bg-gradient-to-br
                    from-slate-900 via-[#0d1829] to-[#070f1e]"></div>

        ${thumbLayer}

        <div class="absolute inset-0 bg-gradient-to-t
                    from-black/92 via-black/55 to-black/25
                    group-hover:from-black/95 transition-all duration-300"></div>

        <div class="absolute inset-0 bg-gradient-to-br from-blue-500/0 to-transparent
                    group-hover:from-blue-500/10 transition-all duration-400"></div>

        <div class="absolute inset-0 opacity-[0.035]"
             style="background-image:
                        linear-gradient(rgba(255,255,255,1) 1px, transparent 1px),
                        linear-gradient(90deg, rgba(255,255,255,1) 1px, transparent 1px);
                    background-size: 28px 28px;"></div>

        <div class="absolute inset-0 z-10 flex flex-col justify-between p-6">

            <div class="flex items-center gap-2">
                <div class="flex items-center gap-2 px-2.5 py-1 rounded-lg
                            bg-red-600/90 border border-red-500/40 shadow-sm">
                    <svg class="w-3.5 h-3.5 text-white shrink-0"
                         fill="currentColor" viewBox="0 0 24 24">
                        <path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545
                                 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07
                                 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505
                                 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24
                                 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                    </svg>
                    <span class="text-[9px] font-black text-white uppercase tracking-widest">YouTube</span>
                </div>
                <div class="flex items-center gap-1.5 px-2.5 py-1 rounded-lg
                            bg-slate-900/80 border border-slate-700/50 shadow-sm">
                    <svg class="w-3 h-3 text-slate-400 shrink-0"
                         fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                              d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0
                                 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2
                                 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/>
                    </svg>
                    <span class="text-[9px] font-black text-slate-400 uppercase tracking-widest">Playlist</span>
                </div>
            </div>

            <div class="flex items-end gap-4">
                <div class="shrink-0 w-14 h-14 rounded-2xl bg-white/10 border border-white/20
                            backdrop-blur-sm flex items-center justify-center shadow-lg
                            group-hover:bg-blue-500/80 group-hover:border-blue-400/60
                            group-hover:scale-105 transition-all duration-300">
                    <svg class="w-6 h-6 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M8 5v14l11-7z"/>
                    </svg>
                </div>
                <div class="min-w-0">
                    <p class="text-white font-black text-base leading-tight uppercase
                              tracking-tight truncate">${safeVideoTitle}</p>
                    <p class="text-slate-400 text-xs font-medium mt-1.5 flex items-center gap-1.5">
                        <span>Click to open in YouTube</span>
                        <svg class="w-3 h-3 shrink-0 group-hover:translate-x-0.5 transition-transform duration-200"
                             fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                  d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0
                                     002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
                        </svg>
                    </p>
                </div>
            </div>
        </div>
    </${_tag}>
    </div>`;
}

async function _initSubject() {
    const { subject } = getParams();

    let config = {};
    try {
        const mod = await import(`../data/${subject}/std-config.js`);
        config = mod.default;
    } catch (e) {
        console.error('[subject] Config load failed:', e);
    }

    const title = config.title || subject.replace(/-/g, ' ');
    const iconKey = config.icon || 'book';
    const iconPath = SUBJECT_ICONS[iconKey] || SUBJECT_ICONS.book;

    _set('subject-title', title);
    _set('subject-desc', config.description || '');
    _set('bc-subject', title);
    _set('bc-subject-mobile', title);

    _setHTML('hdr-icon', `
        <svg class="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round"
                  stroke-width="2" d="${iconPath}"/>
        </svg>`);

    const vidEl = document.getElementById('video-container');
    if (vidEl) {
        _renderVideoCard(vidEl, config, title);
    }

    const levelList = document.getElementById('level-list');
    if (!levelList) return;

    levelList.innerHTML = '';
    let totalSets = 0, totalDone = 0, totalAvgSum = 0, levelsWithProgress = 0;
    let discoveredLevelCount = 0;

    for (const lvl of LEVEL_ORDER) {
        const sets = getSetsFromConfig(config, lvl) || await discoverSets(subject, lvl);
        if (!sets.length) continue;

        discoveredLevelCount++;
        const stats = Progress.getLevelStats(subject, lvl);
        totalSets += sets.length;
        totalDone += stats.completed;
        if (stats.completed > 0) {
            totalAvgSum += stats.avgScore;
            levelsWithProgress++;
        }
        const pct = Math.round((stats.completed / sets.length) * 100);

        const card = document.createElement('a');
        card.href = `level.html?subject=${encodeURIComponent(subject)}&level=${encodeURIComponent(lvl)}`;
        card.className = 'level-card enter block relative overflow-hidden rounded-xl ' +
            'bg-slate-900 border border-slate-800 hover:border-yellow-500/50 ' +
            'p-5 transition-all duration-300 group shadow-sm';

        card.innerHTML = `
            <div class="absolute bottom-0 left-0 h-[2px]
                        bg-gradient-to-r from-yellow-600 to-yellow-400 rounded-b-xl"
                 style="width:${pct}%"></div>

            ${pct > 0 ? `
            <div class="absolute -right-1 -top-1 text-[52px] font-black leading-none
                        select-none pointer-events-none text-slate-800/70
                        group-hover:text-slate-700/70 transition-colors duration-300">
                ${pct}%
            </div>` : ''}

            <div class="relative z-10 flex items-center justify-between">
                <div>
                    <div class="flex items-center gap-2.5 mb-1.5">
                        <span class="w-2 h-2 rounded-full
                            ${pct === 100
                ? 'bg-yellow-400 shadow-[0_0_8px_rgba(234,179,8,0.6)]'
                : pct > 0
                    ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]'
                    : 'bg-slate-700'}"></span>
                        <h3 class="text-base font-black text-white uppercase tracking-tight">
                            ${LEVEL_LABEL[lvl] || lvl}
                        </h3>
                        ${pct === 100
                ? `<span class="px-2 py-0.5 rounded text-[9px] font-black uppercase
                                           tracking-widest bg-yellow-500 text-black">Mastered</span>`
                : pct >= 50
                    ? `<span class="px-2 py-0.5 rounded text-[9px] font-black uppercase
                                               tracking-widest bg-emerald-950 text-emerald-400
                                               border border-emerald-900">In Progress</span>`
                    : ''}
                    </div>
                    <div class="flex flex-wrap items-center gap-x-3 gap-y-1
                                text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                        <span>${sets.length} Set${sets.length !== 1 ? 's' : ''}</span>
                        <span class="opacity-30">•</span>
                        <span class="${stats.completed > 0 ? 'text-emerald-400' : ''}">
                            ${stats.completed} Done
                        </span>
                        ${stats.avgScore > 0 ? `
                        <span class="opacity-30">•</span>
                        <span class="text-slate-400">${stats.avgScore}% avg</span>` : ''}
                    </div>
                </div>
                <div class="shrink-0 w-9 h-9 rounded-xl bg-slate-950 border border-slate-800
                            flex items-center justify-center text-slate-500
                            group-hover:bg-yellow-500 group-hover:text-black
                            group-hover:border-yellow-500 transition-all duration-200 shadow-inner">
                    <svg class="w-4 h-4 group-hover:translate-x-0.5 transition-transform duration-200"
                         fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round"
                              stroke-width="2" d="M9 5l7 7-7 7"/>
                    </svg>
                </div>
            </div>`;

        levelList.appendChild(card);
    }

    stagger('.level-card', 70);

    if (discoveredLevelCount > 0) {
        const hdrLevels = document.getElementById('hdr-levels');
        if (hdrLevels) {
            hdrLevels.classList.remove('hidden');
            hdrLevels.classList.add('flex');
            _set('hdr-levels-val',
                `${discoveredLevelCount} Level${discoveredLevelCount !== 1 ? 's' : ''}`);
        }
    }

    const mastery = totalSets > 0 ? Math.round((totalDone / totalSets) * 100) : 0;
    const avgAccuracy = levelsWithProgress > 0
        ? Math.round(totalAvgSum / levelsWithProgress) : 0;

    _set('stat-mastery', mastery + '%');
    _setHTML('stat-sets',
        `${totalDone}<span class="text-base font-bold text-slate-600 ml-1">/ ${totalSets}</span>`);
    _set('stat-avg', (totalDone > 0 ? avgAccuracy : 0) + '%');

    requestAnimationFrame(() => {
        const bar = document.getElementById('stat-mastery-bar');
        if (bar) bar.style.width = mastery + '%';
    });

    if (mastery > 0) {
        const mastEl = document.getElementById('hdr-mastery');
        if (mastEl) {
            mastEl.classList.remove('hidden');
            mastEl.classList.add('flex');
            _set('hdr-mastery-val', mastery + '% Mastery');
        }
    }
}

// ================================================================
// PAGE: level.html  (Set listing)
// ================================================================
async function _initLevel() {
    const { subject, level } = getParams();

    let config = { engine: 'mcq', unlockAt: 80 };
    try {
        const mod = await import(`../data/${subject}/std-config.js`);
        config = mod.default;
    } catch { }

    const UNLOCK_AT = config.unlockAt || 80;
    const subjectLabel = (config.title || subject).replace(/-/g, ' ');
    const levelLabel = level.charAt(0).toUpperCase() + level.slice(1);

    const bcLink = document.getElementById('bc-subject-link');
    if (bcLink) {
        bcLink.textContent = subjectLabel;
        bcLink.href = `subject.html?subject=${encodeURIComponent(subject)}`;
    }
    _set('bc-level', levelLabel);
    _set('level-subject', subjectLabel);
    _set('level-title', levelLabel + ' Level');

    _set('bc-mobile-label', `${subjectLabel} › ${levelLabel}`);

    const subjectHref = `subject.html?subject=${encodeURIComponent(subject)}`;
    const backBtn = document.getElementById('back-btn');
    const backBtnMob = document.getElementById('back-btn-mobile');
    if (backBtn) backBtn.href = subjectHref;
    if (backBtnMob) backBtnMob.href = subjectHref;

    const sets = getSetsFromConfig(config, level) || await discoverSets(subject, level);
    const container = document.getElementById('sets-container');
    if (!container) return;

    const hdrSets = document.getElementById('hdr-sets');
    const hdrSetsVal = document.getElementById('hdr-sets-val');
    if (hdrSets && sets.length > 0) {
        hdrSets.classList.remove('hidden');
        hdrSets.classList.add('flex');
        if (hdrSetsVal) hdrSetsVal.textContent = `${sets.length} Set${sets.length !== 1 ? 's' : ''}`;
    }

    const chip = document.getElementById('sets-count-chip');
    if (chip && sets.length > 0) {
        chip.classList.remove('hidden');
        chip.textContent = `${sets.length} Sets`;
    }

    container.innerHTML = '';

    if (!sets.length) {
        container.innerHTML = `
        <div class="text-center py-20 bg-slate-900/50 rounded-2xl border border-slate-800/60">
            <p class="text-slate-500 font-bold text-xs uppercase tracking-widest">
                No practice sets available yet.
            </p>
        </div>`;
        return;
    }

    let completed = 0;
    let totalScore = 0;

    sets.forEach((setNum, idx) => {
        const result = Progress.getSetResult(subject, level, String(setNum));
        const pct = result?.percentage ?? null;
        const isPassed = pct !== null && pct >= UNLOCK_AT;
        const isAttempted = pct !== null;
        const isUnlocked = isPassed;

        if (result) { completed++; totalScore += pct; }

        const accentBar = isPassed
            ? 'bg-emerald-500'
            : isAttempted
                ? 'bg-orange-400'
                : 'bg-slate-700';

        const scoreText = isPassed
            ? 'text-emerald-400'
            : isAttempted
                ? 'text-orange-400'
                : 'text-slate-600';

        const statusPill = isPassed
            ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md
                            text-[9px] font-black uppercase tracking-widest
                            bg-emerald-950/70 text-emerald-400 border border-emerald-900/70">
                   <span class="w-1.5 h-1.5 rounded-full bg-emerald-500
                                shadow-[0_0_4px_rgba(52,211,153,0.6)]"></span>Passed
               </span>`
            : isAttempted
                ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md
                                text-[9px] font-black uppercase tracking-widest
                                bg-orange-950/70 text-orange-400 border border-orange-900/70">
                       <span class="w-1.5 h-1.5 rounded-full bg-orange-400"></span>Review
                   </span>`
                : `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md
                                text-[9px] font-black uppercase tracking-widest
                                bg-slate-800 text-slate-500 border border-slate-700">
                       New
                   </span>`;

        const card = document.createElement('div');
        card.className = 'set-card opacity-0 flex items-stretch rounded-2xl overflow-hidden ' +
            'border transition-all duration-200 shadow-sm relative group ' +
            (isPassed
                ? 'bg-slate-900 border-slate-800 hover:border-emerald-900/60'
                : isAttempted
                    ? 'bg-slate-900 border-slate-800 hover:border-orange-900/50'
                    : 'bg-slate-900 border-slate-800 hover:border-yellow-500/30');
        card.style.animationDelay = `${idx * 45}ms`;

        const safeDate = isAttempted ? escapeHTML(result.date) : 'Not attempted';

        card.innerHTML = `
        ${isAttempted ? `
            <div class="absolute -right-1 -top-1 text-[40px] sm:text-[52px] font-black leading-none
                        select-none pointer-events-none transition-colors duration-300
                        md:hidden
                        ${isPassed
                    ? 'text-emerald-900/40 group-hover:text-emerald-800/50'
                    : 'text-slate-800/60 group-hover:text-slate-700/70'}">
                ${pct}%
            </div>` : ''}

        <div class="w-1 shrink-0 ${accentBar}"></div>

        <div class="flex-1 flex flex-col sm:flex-row sm:items-center gap-4 px-5 py-4 relative z-10">

            <div class="flex items-center gap-4 flex-1 min-w-0">

                <div class="shrink-0 text-center">
                    <div class="text-[10px] font-black text-slate-600 uppercase tracking-widest leading-none mb-0.5">
                        SET
                    </div>
                    <div class="text-2xl font-black text-white leading-none">
                        ${String(setNum).padStart(2, '0')}
                    </div>
                </div>

                <div class="w-px h-10 bg-slate-800 shrink-0"></div>

                <div class="flex-1 min-w-0">
                    <div class="flex flex-wrap items-center gap-2 mb-1.5">
                        <h4 class="font-black text-white text-base uppercase tracking-tight leading-none">
                            Practice Set ${String(setNum).padStart(2, '0')}
                        </h4>
                        ${statusPill}
                    </div>
                    <div class="flex flex-wrap items-center gap-x-3 gap-y-0.5
                                text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                        <span>${safeDate}</span>
                        ${isAttempted
                ? `<span class="opacity-30">·</span>
                               <span>${result.score} / ${result.total} correct</span>`
                : ''}
                    </div>
                </div>
            </div>

            <div class="shrink-0 text-right hidden sm:block">
                ${isAttempted
                ? `<div class="text-[10px] font-black text-slate-600 uppercase tracking-widest leading-none mb-0.5">
                           Score
                       </div>
                       <div class="text-3xl font-black ${scoreText} leading-none">${pct}%</div>`
                : `<div class="text-[10px] font-black text-slate-700 uppercase tracking-widest">
                           — —
                       </div>`}
            </div>

            <div class="flex items-center gap-2 sm:pl-4 sm:border-l border-slate-800">

                <button
                    class="px-3 py-2.5 rounded-xl border flex items-center gap-1.5
                           text-[10px] uppercase tracking-widest font-black transition-all duration-200
                           ${isUnlocked
                ? 'border-blue-900/60 bg-blue-950/40 text-blue-400 hover:bg-blue-900/60 hover:text-white cursor-pointer'
                : 'border-slate-800/60 bg-transparent text-slate-700 cursor-not-allowed'}"
                    ${!isUnlocked ? 'disabled' : ''}
                    title="${isUnlocked ? 'Download Question PDF' : 'Score ' + UNLOCK_AT + '%+ to unlock'}"
                    onclick="${isUnlocked ? `window.open('../data/${encodeURIComponent(subject)}/${encodeURIComponent(level)}/set${setNum}.pdf')` : ''}">
                    <svg class="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                              d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0
                                 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0
                                 01.293.707V19a2 2 0 01-2 2z"/>
                    </svg>
                    ${isUnlocked ? 'PDF' : '🔒'}
                </button>

                <a href="practice.html?subject=${encodeURIComponent(subject)}&level=${encodeURIComponent(level)}&set=${setNum}"
                   class="px-5 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest
                          transition-all duration-200 active:scale-95
                          flex items-center gap-1.5 whitespace-nowrap
                          ${isAttempted
                ? 'bg-slate-800 hover:bg-slate-700 text-white border border-slate-700'
                : 'bg-yellow-500 hover:bg-yellow-400 text-black'}">
                    ${isAttempted ? 'Retake' : 'Start'}
                    <svg class="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                              d="M14 5l7 7m0 0l-7 7m7-7H3"/>
                    </svg>
                </a>
            </div>
        </div>`;

        container.appendChild(card);
    });

    const lvlPct = sets.length > 0 ? Math.round((completed / sets.length) * 100) : 0;
    const avgScore = completed > 0 ? Math.round(totalScore / completed) : 0;

    const analyticsEl = document.getElementById('level-analytics');
    if (analyticsEl) {
        analyticsEl.innerHTML = `

        <div class="bg-slate-900 border border-slate-800/80 rounded-2xl overflow-hidden shadow-sm">

            <div class="h-[3px] bg-slate-800">
                <div class="h-full bg-gradient-to-r from-yellow-600 to-yellow-400
                            transition-all duration-1000 ease-out" style="width:${lvlPct}%"></div>
            </div>

            <div class="p-5 space-y-5">

                <div>
                    <div class="text-[10px] text-slate-500 font-black tracking-widest uppercase mb-2">
                        Completion
                    </div>
                    <div class="flex items-baseline gap-2">
                        <span class="text-4xl font-black text-white leading-none">${lvlPct}%</span>
                        <span class="text-[10px] font-bold text-slate-500 uppercase tracking-widest pb-0.5">
                            ${completed} / ${sets.length} sets
                        </span>
                    </div>
                </div>

                <div class="border-t border-slate-800/60"></div>

                <div>
                    <div class="text-[10px] text-slate-500 font-black tracking-widest uppercase mb-2">
                        Avg Accuracy
                    </div>
                    <div class="text-3xl font-black leading-none
                                ${avgScore >= 80 ? 'text-emerald-400' : avgScore > 0 ? 'text-orange-400' : 'text-slate-600'}">
                        ${completed > 0 ? avgScore + '%' : '—'}
                    </div>
                </div>
            </div>
        </div>

        <div class="flex items-center gap-3 px-4 py-3 rounded-xl
                    bg-slate-900/40 border border-slate-800/40">
            <svg class="w-4 h-4 text-yellow-500/60 shrink-0" fill="none"
                 viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                      d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2
                         2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
            </svg>
            <p class="text-[11px] text-slate-500 font-medium leading-relaxed">
                Score <span class="text-yellow-400 font-black">${UNLOCK_AT}%</span> or higher
                to unlock the Question PDF.
            </p>
        </div>`;
    }

    stagger('.set-card', 45);

    if (completed > 0) {
        const hdrDone = document.getElementById('hdr-done');
        const hdrDoneVal = document.getElementById('hdr-done-val');
        if (hdrDone) {
            hdrDone.classList.remove('hidden');
            hdrDone.classList.add('flex');
            if (hdrDoneVal) hdrDoneVal.textContent = `${completed} Done`;
        }
    }
}

// ── tiny helpers ─────────────────────────────────────────────────
function _set(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}
function _setHTML(id, html) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
}