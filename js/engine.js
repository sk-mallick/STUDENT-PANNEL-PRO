// ================================================================
// student-panel/js/engine.js
// Drives practice.html — handles MCQ + Fill engines in student mode.
// Imported by practice.html via <script type="module">
// ================================================================

import {
    getParams, startTimer, stopTimer,
    updateHeaderProgress, fireConfetti, stagger, escapeHTML
} from './app.js';
import { Progress } from './progress.js';
import { API } from '../backend/api.js';

// ── Utilities ────────────────────────────────────────────────────

/** Fisher-Yates (Knuth) shuffle — unbiased, in-place */
function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

/**
 * Validate a raw questions array from JSON.
 * Filters out malformed entries and returns only valid questions.
 */
function validateQuestions(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.filter(q =>
        q &&
        typeof q.q === 'string' && q.q.trim().length > 0 &&
        Array.isArray(q.options) && q.options.length >= 2 &&
        typeof q.answer === 'number' &&
        Number.isInteger(q.answer) &&
        q.answer >= 0 &&
        q.answer < q.options.length
    );
}

// ── State ────────────────────────────────────────────────────────
let questions = [];
let answers = {};   // MCQ: { idx: optBtnIndex }   Fill: { idx: { text, isCorrect } }
let engineType = 'mcq';
let submitted = false;   // re-submission guard

// ================================================================
// INIT
// ================================================================
async function init() {
    const { subject, level, set } = getParams();

    /* ── Load engine type + subject title from config ─────── */
    let subjectTitle = subject.replace(/-/g, ' ');
    try {
        const mod = await import(`../data/${subject}/std-config.js`);
        engineType = mod.default.engine || 'mcq';
        subjectTitle = mod.default.title || subjectTitle;
    } catch { /* default mcq */ }

    const LEVEL_ABBR = { preprimary: 'PP', primary: 'P', middle: 'M', high: 'H' };
    const levelAbbr = LEVEL_ABBR[level] || level.charAt(0).toUpperCase();
    const levelLabel = level.charAt(0).toUpperCase() + level.slice(1);

    /* ── Inject custom practice header ─────────────────────── */
    const mount = document.getElementById('header-mount');
    if (mount) {
        const now = new Date();
        const dayName = now.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
        const dateStr = now.toLocaleDateString('en-US', {
            day: 'numeric', month: 'short', year: 'numeric'
        }).toUpperCase();

        const setPad = String(set).padStart(2, '0');

        mount.innerHTML = `
        <header class="w-full bg-[#0b1120]
                       border-b border-slate-700/40
                       shadow-[0_1px_0_rgba(255,255,255,0.03)]">

            <div class="hdr-inner w-full px-4 md:px-8 xl:px-16 py-3
                        flex items-center justify-between gap-3">

                <!-- ── LEFT: back + two-line identity ──────────── -->
                <div class="flex items-center gap-3 min-w-0">

                    <!-- Back button -->
                    <a href="level.html?subject=${encodeURIComponent(subject)}&level=${encodeURIComponent(level)}"
                       class="hdr-back shrink-0 w-9 h-9 flex items-center justify-center
                              bg-slate-900 border border-slate-800 rounded-xl
                              hover:border-yellow-500/40 hover:bg-slate-800/80
                              text-slate-400 hover:text-yellow-400
                              transition-all duration-200 group">
                        <svg class="w-4 h-4 group-hover:-translate-x-0.5 transition-transform duration-200"
                             fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round"
                                  stroke-width="2.5" d="M15 19l-7-7 7-7"/>
                        </svg>
                    </a>

                    <!-- Identity -->
                    <div class="min-w-0">
                        <h1 class="hdr-title text-xl md:text-2xl font-black text-white
                                   uppercase tracking-tight leading-none truncate">
                            <span class="hdr-title-full">${escapeHTML(subjectTitle)}</span>
                            <span class="hdr-title-compact hidden">${escapeHTML(subjectTitle)} <span class="text-slate-500">•</span> ${escapeHTML(levelAbbr)} <span class="text-slate-500">•</span> ${setPad}</span>
                        </h1>
                        <p class="hdr-sub text-[11px] font-bold text-slate-500
                                  uppercase tracking-[.15em] mt-1 leading-none truncate">
                            ${escapeHTML(levelLabel)}
                            <span class="text-slate-700 mx-1">·</span>
                            Set&nbsp;${setPad}
                        </p>
                    </div>
                </div>

                <!-- ── RIGHT: date (desktop only) + timer ──────── -->
                <div class="shrink-0 flex items-center gap-2.5">

                    <!-- Date block — desktop only -->
                    <div class="hdr-date hidden md:flex flex-col items-end leading-none gap-1">
                        <span class="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                            ${dayName}
                        </span>
                        <span class="text-[10px] font-bold text-slate-600 uppercase tracking-widest">
                            ${dateStr}
                        </span>
                    </div>

                    <!-- Divider — desktop only -->
                    <div class="hdr-divider hidden md:block w-px h-7 bg-slate-800 rounded-full"></div>

                    <!-- Timer pill -->
                    <div class="hdr-timer-pill flex items-center gap-2
                                px-3 py-2 bg-slate-900
                                border border-slate-800 rounded-xl">
                        <svg class="w-3.5 h-3.5 text-emerald-500/70 shrink-0"
                             fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round"
                                  stroke-width="2"
                                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
                        </svg>
                        <span id="engine-timer"
                              class="hdr-timer-text text-sm font-mono font-black text-white tracking-widest tabular-nums">
                            00:00
                        </span>
                    </div>

                </div>
            </div>

            <!-- Progress bar — hidden until questions load -->
            <div id="header-progress-wrap" class="h-[3px] bg-slate-900 w-full hidden">
                <div id="header-progress-fill"
                     class="h-full bg-gradient-to-r from-emerald-600 to-emerald-400
                            transition-all duration-300 w-0">
                </div>
            </div>

        </header>`;

        startTimer('engine-timer');

        // ── Compact header on scroll (mobile only) ──────────
        const stickyWrap = document.getElementById('sticky-header-wrap');
        if (stickyWrap) {
            const THRESHOLD = 50;
            let isCompact = false;

            const onScroll = () => {
                const scrolled = window.scrollY > THRESHOLD;
                if (scrolled !== isCompact) {
                    isCompact = scrolled;
                    stickyWrap.classList.toggle('compact', isCompact);
                }
            };

            window.addEventListener('scroll', onScroll, { passive: true });
        }
    }

    /* ── Skeleton loading ────────────────────────────────────── */
    const container = document.getElementById('quiz-container');
    container.innerHTML = Array(5).fill(`
        <div class="bg-slate-900 rounded-xl border border-slate-800 mb-5 overflow-hidden">
            <div class="px-6 py-5 border-b border-slate-800">
                <div class="h-5 w-2/3 bg-slate-800 rounded animate-pulse"></div>
            </div>
            <div class="p-5 grid grid-cols-2 gap-3">
                <div class="h-12 bg-slate-800 rounded-lg animate-pulse"></div>
                <div class="h-12 bg-slate-800 rounded-lg animate-pulse"></div>
                <div class="h-12 bg-slate-800 rounded-lg animate-pulse"></div>
                <div class="h-12 bg-slate-800 rounded-lg animate-pulse"></div>
            </div>
        </div>`).join('');

    /* ── Fetch question set ──────────────────────────────────── */
    try {
        const res = await fetch(`data/${encodeURIComponent(subject)}/${encodeURIComponent(level)}/set${encodeURIComponent(set)}.json`);
        if (!res.ok) throw new Error(`Set ${set} not found (HTTP ${res.status})`);
        const raw = await res.json();
        questions = validateQuestions(raw);

        if (questions.length === 0) {
            throw new Error('No valid questions found in this set.');
        }

        submitted = false;
        answers = {};
        _render();
    } catch (e) {
        container.innerHTML = `
        <div class="text-center py-20 bg-slate-900 rounded-xl border border-slate-800">
            <p class="text-slate-500 font-bold text-sm uppercase tracking-widest mb-2">
                Failed to load practice set
            </p>
            <p class="text-slate-600 text-xs font-mono">${escapeHTML(e.message)}</p>
            <a href="javascript:history.back()"
               class="inline-block mt-6 px-5 py-2 bg-slate-800 text-white rounded-lg
                      text-xs font-bold uppercase tracking-widest hover:bg-slate-700 transition-all">
                ← Go Back
            </a>
        </div>`;
    }
}

// ================================================================
// RENDER QUESTIONS
// ================================================================
function _render() {
    const container = document.getElementById('quiz-container');
    container.innerHTML = '';

    if (engineType === 'mcq') _renderMCQ(container);
    else _renderFill(container);

    // Bottom action bar
    const bar = document.getElementById('bottom-bar');
    if (bar) {
        bar.classList.remove('hidden');
        bar.innerHTML = `
        <div class="max-w-7xl mx-auto px-4 md:px-8 flex items-center justify-between gap-4">
            <span class="text-slate-500 text-xs font-bold tracking-widest uppercase hidden sm:block">
                Answer all questions to submit
            </span>
            <button id="btn-submit"
                    class="w-full sm:w-auto px-8 py-3 bg-emerald-600 hover:bg-emerald-500
                           text-white font-bold text-xs uppercase tracking-widest rounded-lg
                           transition-all active:scale-95 flex items-center justify-center
                           gap-2 opacity-50 cursor-not-allowed grayscale">
                Submit Test
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                          d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
                </svg>
            </button>
        </div>`;
        // Bind submit handler via event listener (avoid window global)
        document.getElementById('btn-submit')?.addEventListener('click', _submitQuiz);
    }

    stagger('.q-card', 45);
    _updateProgress();
}

// ── MCQ render ───────────────────────────────────────────────────
function _renderMCQ(container) {
    const LETTERS = ['A', 'B', 'C', 'D', 'E'];

    questions.forEach((item, qIdx) => {
        // Track correct answer by original index (immune to duplicate text)
        let opts = item.options.map((t, origI) => ({ text: t, origIdx: origI }));
        shuffle(opts);
        const newCorrectIdx = opts.findIndex(o => o.origIdx === item.answer);

        const card = document.createElement('div');
        card.className = 'q-card opacity-0 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden mb-5 shadow-sm transition-all duration-300';
        card.id = `qcard-${qIdx}`;

        // Question header
        const hdr = document.createElement('div');
        hdr.className = 'px-5 py-4 border-b border-slate-800 flex gap-4 items-start';
        hdr.innerHTML = `
            <span class="font-bold text-blue-400 text-xs bg-blue-950/50 border border-blue-900/50
                         px-2.5 py-1 rounded shadow-inner shrink-0 mt-0.5">
                Q${String(qIdx + 1).padStart(2, '0')}
            </span>
            <p class="text-white font-bold text-base leading-relaxed">
                ${escapeHTML(item.q).replace(/_{2,}/g,
            '<span class="inline-block w-14 border-b-2 border-slate-600 mx-1 align-bottom"></span>')}
            </p>`;

        // Options grid
        const grid = document.createElement('div');
        grid.className = 'p-5 grid grid-cols-1 md:grid-cols-2 gap-3';
        grid.id = `opts-${qIdx}`;

        opts.forEach((opt, i) => {
            const btn = document.createElement('button');
            btn.className = 'q-opt w-full text-left px-4 py-3 rounded-lg border ' +
                'border-slate-800 bg-slate-950 text-slate-300 ' +
                'hover:border-yellow-500/50 hover:bg-slate-900 ' +
                'font-medium text-sm transition-all duration-200 flex items-center gap-3 group';
            btn.dataset.correct = String(i === newCorrectIdx);
            btn.dataset.optIdx = i;
            btn.innerHTML = `
                <span class="letter-badge w-7 h-7 rounded-md flex items-center justify-center
                             text-xs font-bold border border-slate-700 text-slate-500
                             bg-slate-900 shrink-0 transition-colors">
                    ${LETTERS[i]}
                </span>
                <span>${escapeHTML(opt.text)}</span>`;
            btn.onclick = () => _selectMCQ(qIdx, i, grid, card);
            grid.appendChild(btn);
        });

        card.appendChild(hdr);
        card.appendChild(grid);
        container.appendChild(card);
    });
}

function _selectMCQ(qIdx, selectedI, grid, card) {
    if (submitted) return;   // lock after submission
    answers[qIdx] = selectedI;

    grid.querySelectorAll('button').forEach((btn, i) => {
        const badge = btn.querySelector('.letter-badge');
        if (i === selectedI) {
            btn.className = 'q-opt w-full text-left px-4 py-3 rounded-lg border border-yellow-500 ' +
                'bg-yellow-950/30 text-yellow-400 font-medium text-sm transition-all duration-200 flex items-center gap-3';
            badge.className = 'letter-badge w-7 h-7 rounded-md flex items-center justify-center ' +
                'text-xs font-bold border border-yellow-500 text-yellow-500 bg-yellow-900/20 shrink-0';
        } else {
            btn.className = 'q-opt w-full text-left px-4 py-3 rounded-lg border border-slate-800 ' +
                'bg-slate-950 text-slate-300 hover:border-yellow-500/50 hover:bg-slate-900 ' +
                'font-medium text-sm transition-all duration-200 flex items-center gap-3 group';
            badge.className = 'letter-badge w-7 h-7 rounded-md flex items-center justify-center ' +
                'text-xs font-bold border border-slate-700 text-slate-500 bg-slate-900 shrink-0';
        }
    });

    card.classList.remove('border-red-500', 'shadow-red-500/20');
    _updateProgress();
}

// ── Fill render ──────────────────────────────────────────────────
function _renderFill(container) {
    questions.forEach((item, qIdx) => {
        // Track correct answer by original index (immune to duplicate text)
        let opts = item.options.map((t, origI) => ({
            text: t,
            origIdx: origI,
            isCorrect: origI === item.answer
        }));
        shuffle(opts);

        const blankId = `blank-${qIdx}`;
        const qHtml = escapeHTML(item.q).replace(/_{2,}|\.{3,}|…/g,
            `<span id="${blankId}"
                   class="inline-block min-w-[90px] border-b-2 border-slate-700
                          text-slate-500 text-center px-2 mx-1 font-mono transition-all align-bottom">
                _______
             </span>`);

        const card = document.createElement('div');
        card.className = 'q-card opacity-0 bg-slate-900 border border-slate-800 rounded-xl p-5 mb-5 shadow-sm transition-all duration-300';
        card.id = `qcard-${qIdx}`;
        card.innerHTML = `
            <div class="flex gap-4 items-start">
                <span class="font-bold text-blue-400 text-xs bg-blue-950/50 border border-blue-900/50
                             px-2.5 py-1 rounded shadow-inner shrink-0 mt-0.5">
                    Q${String(qIdx + 1).padStart(2, '0')}
                </span>
                <div class="flex-1">
                    <p class="text-white font-bold text-base leading-relaxed">${qHtml}</p>
                    <div class="flex flex-wrap gap-2 mt-5" id="fill-opts-${qIdx}"></div>
                </div>
            </div>`;

        const optsWrap = card.querySelector(`#fill-opts-${qIdx}`);
        opts.forEach(opt => {
            const btn = document.createElement('button');
            btn.className = 'px-4 py-2.5 rounded-lg border border-slate-800 bg-slate-950 ' +
                'text-slate-300 hover:border-yellow-500/50 hover:bg-slate-900 ' +
                'font-medium text-sm transition-all';
            btn.textContent = opt.text;
            btn.dataset.correct = String(opt.isCorrect);
            btn.dataset.text = opt.text;
            btn.onclick = () => _selectFill(qIdx, opt, blankId, optsWrap, card);
            optsWrap.appendChild(btn);
        });

        container.appendChild(card);
    });
}

function _selectFill(qIdx, opt, blankId, optsWrap, card) {
    if (submitted) return;   // lock after submission
    answers[qIdx] = opt;

    const blank = document.getElementById(blankId);
    if (blank) {
        blank.textContent = opt.text;
        blank.className = 'inline-block min-w-[90px] border-b-2 border-yellow-500 ' +
            'text-yellow-400 text-center px-2 mx-1 font-bold transition-all align-bottom';
    }

    optsWrap.querySelectorAll('button').forEach(btn => {
        btn.className = btn.dataset.text === opt.text
            ? 'px-4 py-2.5 rounded-lg border border-yellow-500 bg-yellow-950/30 text-yellow-400 font-medium text-sm transition-all'
            : 'px-4 py-2.5 rounded-lg border border-slate-800 bg-slate-950 text-slate-300 hover:border-yellow-500/50 hover:bg-slate-900 font-medium text-sm transition-all';
    });

    card.classList.remove('border-red-500');
    _updateProgress();
}

// ================================================================
// PROGRESS INDICATOR
// ================================================================
function _updateProgress() {
    const answered = Object.keys(answers).length;
    const total = questions.length;

    updateHeaderProgress(answered, total);

    const btn = document.getElementById('btn-submit');
    if (!btn) return;
    if (answered === total && total > 0) {
        btn.classList.remove('opacity-50', 'cursor-not-allowed', 'grayscale');
    } else {
        btn.classList.add('opacity-50', 'cursor-not-allowed', 'grayscale');
    }
}

// ================================================================
// SUBMIT
// ================================================================
function _submitQuiz() {
    // Re-submission guard
    if (submitted) return;

    // Guard: must answer all
    if (Object.keys(answers).length < questions.length) {
        const firstMissed = questions.findIndex((_, i) => answers[i] === undefined);
        if (firstMissed !== -1) {
            const card = document.getElementById(`qcard-${firstMissed}`);
            if (card) {
                // Ensure card stays visible — remove entrance animation classes
                // that would conflict with shake and cause a flash to opacity:0
                card.classList.remove('opacity-0', 'animate-enter');
                card.classList.add('border-red-500', 'animate-shake');
                card.style.boxShadow = '0 0 20px rgba(239,68,68,0.2)';
                setTimeout(() => {
                    card.classList.remove('animate-shake');
                    card.style.boxShadow = '';
                }, 600);

                // Scroll to the first unanswered card.
                // #quiz-scroller is only an actual scroll container on md+ (md:overflow-y-auto).
                // On mobile the window itself scrolls, so we must detect which is active.
                const scroller = document.getElementById('quiz-scroller');
                const header = document.getElementById('header-mount');
                const headerH = header ? header.offsetHeight : 0;
                const cardRect = card.getBoundingClientRect();

                // Check if scroller is the actual overflow container (desktop)
                const scrollerIsActive = scroller && scroller.scrollHeight > scroller.clientHeight;

                if (scrollerIsActive) {
                    const scrollerRect = scroller.getBoundingClientRect();
                    const target = scroller.scrollTop + (cardRect.top - scrollerRect.top) - headerH - 16;
                    scroller.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
                } else {
                    const target = window.scrollY + cardRect.top - headerH - 16;
                    window.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
                }
            }
        }
        return;
    }

    submitted = true;   // lock submissions
    const timeTaken = stopTimer();
    let score = 0;

    // Reveal + score
    questions.forEach((item, qIdx) => {
        const card = document.getElementById(`qcard-${qIdx}`);
        if (engineType === 'mcq') {
            score += _revealMCQ(card, qIdx, item);
        } else {
            score += _revealFill(card, qIdx, item);
        }
    });

    // Replace bottom bar
    const { subject, level, set } = getParams();
    document.getElementById('bottom-bar').innerHTML = `
    <div class="max-w-7xl mx-auto px-4 md:px-8 flex items-center justify-between gap-4">
        <span class="text-white text-xs font-bold tracking-widest uppercase">Test Completed</span>
        <a href="level.html?subject=${encodeURIComponent(subject)}&level=${encodeURIComponent(level)}"
           class="px-6 py-2.5 bg-slate-800 hover:bg-slate-700 text-white font-bold
                  text-xs uppercase tracking-widest rounded-lg transition-all border border-slate-700">
            Continue Learning →
        </a>
    </div>`;

    // Scroll to top
    document.getElementById('quiz-scroller')?.scrollTo({ top: 0, behavior: 'smooth' });

    // Save + sync
    const percent = Progress.saveResult(subject, level, set, score, questions.length, timeTaken);
    API.syncResult(subject, level, set, score, questions.length, timeTaken);

    _showResultModal(score, questions.length, percent, subject, level);
}

// ── MCQ reveal ───────────────────────────────────────────────────
function _revealMCQ(card, qIdx, item) {
    const grid = card?.querySelector(`#opts-${qIdx}`);
    const selectedI = answers[qIdx];
    let scored = 0;

    grid?.querySelectorAll('button').forEach((btn, i) => {
        btn.disabled = true;
        const isCorrect = btn.dataset.correct === 'true';
        const isSelected = i === selectedI;

        btn.classList.remove('hover:bg-slate-900', 'hover:border-yellow-500/50', 'cursor-pointer');

        if (isCorrect) {
            if (isSelected) scored = 1;
            btn.className = 'w-full text-left px-4 py-3 rounded-lg border border-emerald-500 ' +
                'bg-emerald-950/50 text-emerald-400 font-medium text-sm flex items-center gap-3';
            btn.querySelector('.letter-badge').className =
                'letter-badge w-7 h-7 rounded-md flex items-center justify-center text-xs ' +
                'font-bold border border-emerald-500 text-emerald-400 bg-emerald-900/30 shrink-0';
            btn.innerHTML += `<span class="ml-auto text-[9px] uppercase tracking-widest font-bold
                                          text-emerald-400 bg-emerald-900/60 px-2 py-0.5 rounded
                                          border border-emerald-500/40 shrink-0">✓ Correct</span>`;
        } else if (isSelected) {
            btn.className = 'w-full text-left px-4 py-3 rounded-lg border border-red-500 ' +
                'bg-red-950/30 text-red-400 font-medium text-sm flex items-center gap-3';
            btn.querySelector('.letter-badge').className =
                'letter-badge w-7 h-7 rounded-md flex items-center justify-center text-xs ' +
                'font-bold border border-red-500 text-red-400 bg-red-900/20 shrink-0';
            btn.innerHTML += `<span class="ml-auto text-[9px] uppercase tracking-widest font-bold
                                          text-red-400 bg-red-900/40 px-2 py-0.5 rounded
                                          border border-red-500/40 shrink-0">✗ Yours</span>`;
        } else {
            btn.className = 'w-full text-left px-4 py-3 rounded-lg border border-slate-800 ' +
                'bg-slate-950 text-slate-600 font-medium text-sm flex items-center gap-3 opacity-40';
        }
    });

    return scored;
}

// ── Fill reveal ──────────────────────────────────────────────────
function _revealFill(card, qIdx, item) {
    const userAns = answers[qIdx];
    const correctText = item.options[item.answer];
    const blank = card?.querySelector(`#blank-${qIdx}`);
    let scored = 0;

    if (blank && userAns) {
        blank.textContent = userAns.text;
        if (userAns.isCorrect) {
            scored = 1;
            blank.className = 'inline-block min-w-[90px] border-b-2 border-emerald-500 ' +
                'text-emerald-400 text-center px-2 mx-1 font-bold align-bottom';
            blank.innerHTML += ' <span class="text-emerald-500 font-black">✓</span>';
        } else {
            blank.className = 'inline-block min-w-[90px] border-b-2 border-red-500 ' +
                'text-red-400 text-center px-2 mx-1 font-bold line-through opacity-70 align-bottom';
            blank.innerHTML += ` <span class="text-emerald-400 no-underline ml-2
                                             bg-emerald-950/80 border border-emerald-500/40
                                             px-2 py-0.5 rounded text-[9px] font-bold
                                             uppercase tracking-widest not-italic">
                                     ${escapeHTML(correctText)}
                                 </span>`;
        }
    }

    // Option pills
    card?.querySelector(`#fill-opts-${qIdx}`)
        ?.querySelectorAll('button').forEach(btn => {
            btn.disabled = true;
            const text = btn.dataset.text;
            if (text === correctText) {
                btn.className = 'px-4 py-2.5 rounded-lg border border-emerald-500 ' +
                    'bg-emerald-950/50 text-emerald-400 font-medium text-sm';
                btn.innerHTML += ' <span class="text-[9px] font-bold uppercase tracking-widest ' +
                    'bg-emerald-900/60 px-1.5 py-0.5 rounded border border-emerald-500/40 ml-1">✓</span>';
            } else if (userAns && text === userAns.text) {
                btn.className = 'px-4 py-2.5 rounded-lg border border-red-500 ' +
                    'bg-red-950/30 text-red-400 font-medium text-sm';
            } else {
                btn.className = 'px-4 py-2.5 rounded-lg border border-slate-800 ' +
                    'bg-slate-950 text-slate-600 font-medium text-sm opacity-40';
            }
        });

    return scored;
}

// ================================================================
// RESULT MODAL
// ================================================================
function _showResultModal(score, total, percent, subject, level) {
    const passed = percent >= 80;
    if (passed) fireConfetti();

    const modal = document.createElement('div');
    modal.id = 'result-modal';
    modal.className = 'fixed inset-0 z-[200] flex items-center justify-center p-4 ' +
        'bg-black/90 backdrop-blur-md animate-enter';
    modal.innerHTML = `
    <div class="bg-slate-950 border border-slate-800 rounded-2xl p-8 max-w-sm w-full
                text-center shadow-2xl relative overflow-hidden">

        <!-- Glow -->
        <div class="absolute top-0 left-1/2 -translate-x-1/2 w-72 h-32
                    ${passed ? 'bg-emerald-500/10' : 'bg-orange-500/10'}
                    blur-3xl rounded-full pointer-events-none"></div>

        <div class="relative z-10">

            <!-- Score circle -->
            <div class="w-28 h-28 mx-auto mb-5 rounded-2xl border
                        ${passed
            ? 'border-emerald-500/40 bg-emerald-950/50 text-emerald-400'
            : 'border-orange-500/40 bg-orange-950/50 text-orange-400'}
                        flex items-center justify-center shadow-inner">
                <span class="text-2xl font-black leading-none">${percent}%</span>
            </div>

            <h2 class="text-2xl font-black text-white uppercase tracking-tight mb-2">
                ${passed ? '🎉 Outstanding!' : 'Keep Going!'}
            </h2>
            <p class="text-slate-400 text-xs font-medium mb-6 leading-relaxed">
                ${passed
            ? 'You have unlocked the Question PDF for this practice set!'
            : 'Score 80% or higher to unlock the downloadable Question PDF.'}
            </p>

            <!-- Score breakdown -->
            <div class="grid grid-cols-3 gap-3 bg-slate-900 border border-slate-800
                        p-4 rounded-xl mb-5">
                <div>
                    <div class="text-[9px] text-slate-500 uppercase tracking-widest font-bold mb-1">Correct</div>
                    <div class="text-2xl font-black text-white">${score}</div>
                </div>
                <div>
                    <div class="text-[9px] text-slate-500 uppercase tracking-widest font-bold mb-1">Total</div>
                    <div class="text-2xl font-black text-white">${total}</div>
                </div>
                <div>
                    <div class="text-[9px] text-slate-500 uppercase tracking-widest font-bold mb-1">Score</div>
                    <div class="text-2xl font-black
                                ${passed ? 'text-emerald-400' : 'text-orange-400'}">${percent}%</div>
                </div>
            </div>

            <!-- Buttons -->
            <div class="flex flex-col gap-2">
                <button id="btn-review"
                        class="w-full py-3 rounded-xl bg-yellow-500 hover:bg-yellow-400
                               text-black font-bold text-xs uppercase tracking-widest
                               transition-all active:scale-95">
                    Review Answers
                </button>
                ${!passed
            ? `<button onclick="location.reload()"
                              class="w-full py-3 rounded-xl border border-slate-800
                                     hover:bg-slate-900 text-slate-300 font-bold
                                     text-xs uppercase tracking-widest transition-all">
                           Retry Set
                       </button>` : ''}
            </div>
        </div>
    </div>`;

    document.body.appendChild(modal);

    document.getElementById('btn-review')?.addEventListener('click', () => {
        modal.classList.add('opacity-0');
        setTimeout(() => modal.remove(), 300);
        document.getElementById('quiz-scroller')
            ?.scrollTo({ top: 0, behavior: 'smooth' });
    });
}

// ── Boot ─────────────────────────────────────────────────────────
init();