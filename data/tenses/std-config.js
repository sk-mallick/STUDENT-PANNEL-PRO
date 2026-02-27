// ================================================================
// student-panel/data/tenses/std-config.js
// Subject configuration file — one per subject inside /data/
// Drives: index.html cards, subject.html header,
//         level sidebar, video preview card, engine type.
// ================================================================

export default {

    // ── Identity ────────────────────────────────────────────────
    id: 'tenses',          // must match folder name
    order: 1,                 // sort order on dashboard (01, 02, 03…)
    title: 'Tenses',
    description: '',
    icon: 'clock',           // key from SUBJECT_ICONS in app.js

    // ── Availability ────────────────────────────────────────────
    // 'online'  → normal clickable card
    // 'offline' → muted card, click disabled, shows "Offline" badge
    status: 'online',

    // ── Engine ──────────────────────────────────────────────────
    // 'mcq'  → multiple-choice option buttons (A B C D)
    // 'fill' → sentence-with-blank + pill options
    engine: 'mcq',

    // ── Unlock threshold ────────────────────────────────────────
    // Student must score this % or higher to unlock the PDF solution.
    unlockAt: 80,

    // ── Set counts per level (avoids network scanning) ───────────
    // Must match the actual number of setN.json files in each folder.
    setCounts: {
        preprimary: 4,
        primary: 4,
        middle: 9,
        high: 3
    },

    // ================================================================
    // ── VIDEO PREVIEW CARD ──────────────────────────────────────────
    // ================================================================
    // Controls the clickable YouTube card shown on subject.html.
    // Clicking the card opens the playlist in a new tab (no iframe).
    //
    // ── HOW TO CONFIGURE ────────────────────────────────────────────
    //
    //  STEP 1 — Get your YouTube Playlist ID
    //    Open your playlist on YouTube.
    //    Copy the ID from the URL:
    //    youtube.com/playlist?list=PLxxxxxxxxxxxxxx
    //                               ^^^^^^^^^^^^^^^^
    //    Paste it into playlistId below.
    //
    //  STEP 2 — Thumbnail (choose one option)
    //
    //    OPTION A — Auto YouTube Thumbnail (Recommended)
    //      Leave thumbnail: null
    //      The system will auto-fetch the playlist thumbnail from YouTube.
    //      ✅ No extra work needed.
    //
    //    OPTION B — Custom Local Image
    //      Place your image in: student-panel/assets/
    //      Set thumbnail to the relative path from this config file.
    //      e.g. thumbnail: '../../assets/tenses-banner.jpg'
    //      Supported formats: jpg, png, webp
    //      Recommended size: 1280×720px (16:9)
    //
    //    OPTION C — External Image URL
    //      Set thumbnail to any public image URL.
    //      e.g. thumbnail: 'https://example.com/tenses-banner.jpg'
    //
    //  STEP 3 — playlistUrl (optional)
    //    Leave as null — it is auto-built from playlistId.
    //    Only set this if you need a non-standard URL
    //    (e.g. a specific video start point or channel page).
    //
    // ── SHOW / HIDE THE VIDEO CARD ───────────────────────────────────
    //
    //    Show card  → fill in playlistId (and optionally thumbnail)
    //    Hide card  → set video: null
    //
    // ── PRIORITY ORDER (handled automatically by app.js) ────────────
    //
    //    1. video.playlistUrl         (explicit full URL override)
    //    2. video.playlistId          (auto-builds playlist URL)
    //    3. levels[x].playlistId      (legacy per-level fallback)
    //    4. No video → "No Video Available" state shown
    //
    // ── EXAMPLES ────────────────────────────────────────────────────
    //
    //  ✅ Playlist + auto YouTube thumbnail:
    //    video: {
    //        playlistId:  'PLxxxxxxxxxxxxxxxxxxxxxx',
    //        playlistUrl: null,
    //        title:       'Tenses Complete Course',
    //        thumbnail:   null,
    //    }
    //
    //  ✅ Playlist + custom local banner:
    //    video: {
    //        playlistId:  'PLxxxxxxxxxxxxxxxxxxxxxx',
    //        playlistUrl: null,
    //        title:       'Tenses Complete Course',
    //        thumbnail:   '../../assets/tenses-banner.jpg',
    //    }
    //
    //  ✅ Playlist + external image URL:
    //    video: {
    //        playlistId:  'PLxxxxxxxxxxxxxxxxxxxxxx',
    //        playlistUrl: null,
    //        title:       'Tenses Complete Course',
    //        thumbnail:   'https://img.youtube.com/vi/VIDEO_ID/maxresdefault.jpg',
    //    }
    //
    //  ❌ No video card at all:
    //    video: null
    //
    // ════════════════════════════════════════════════════════════════
    video: {
        playlistId: null,        // ← PASTE YOUR PLAYLIST ID HERE
        //   e.g. 'PLxxxxxxxxxxxxxxxxxxxxxx'

        playlistUrl: 'https://youtu.be/db-fpyGiZLA?si=pFPX_WugLs7LBqxD',        // ← Leave null (auto-built from playlistId)
        //   Only set if you need a custom URL override

        title: 'Tenses Video Lectures',
        // ← Display title on the card

        thumbnail: null,             // No dedicated thumbnail — shows gradient background
        //   OPTION B: '../../assets/tenses-banner.jpg'
        //   OPTION C: 'https://example.com/image.jpg'
    },

    // ── YouTube playlists per level (legacy — still supported) ──────
    // These are used as a fallback ONLY if video.playlistId above is null.
    // For new subjects, use the video block above instead.
    // playlistId: the part after "list=" in a YouTube playlist URL.
    levels: {

        preprimary: {
            label: 'Pre-Primary',
            order: 1,
            playlistId: null,
            videoTitle: null
        },

        primary: {
            label: 'Primary',
            order: 2,
            playlistId: null,        // legacy fallback only
            videoTitle: 'Primary Tenses Course'
        },

        middle: {
            label: 'Middle',
            order: 3,
            playlistId: null,
            videoTitle: 'Middle School Tenses'
        },

        high: {
            label: 'High',
            order: 4,
            playlistId: null,
            videoTitle: 'Advanced Tenses Practice'
        }
    },

    // ── PDF storage paths ────────────────────────────────────────────
    // Relative path from student-panel root, or a direct URL.
    pdfs: {
        primary: './pdfs/tenses/primary/',
        middle: './pdfs/tenses/middle/',
        high: './pdfs/tenses/high/'
    }
};