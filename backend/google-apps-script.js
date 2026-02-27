// ================================================================
// Google Apps Script — EnglishJibi Student Panel Backend
// ================================================================
//
// ── DEPLOYMENT INSTRUCTIONS ─────────────────────────────────────
//
//  1. Go to https://script.google.com and create a new project.
//
//  2. Your Google Sheet ID: 1PcgVZrGEwjuJa0lhnptAtI-e1_33jZ97Gpwt-3OFC0Y
//
//  3. In your Google Sheet, create THREE sheets (tabs):
//     - "REGISTRATION" with columns (10 columns):
//       studentId | studentName | email | passwordHash | salt |
//       status | role | createdAt | lastLogin | activeSessionToken
//
//     - "RESULTS" with columns:
//       studentId | studentName | subject | level | set | score |
//       total | percentage | timeTaken | date | timestamp
//
//     - "STUDENT_DETAILS" with columns:
//       studentId | studentName | schoolName | className |
//       profileImageURL | guardianName | contactNumber | address | createdAt
//
//  4. Copy this entire file content into the Apps Script editor.
//
//  5. Deploy:
//     - Click Deploy → New deployment
//     - Type: Web app
//     - Execute as: Me
//     - Who has access: Anyone
//     - Click Deploy
//     - Copy the Web App URL
//
//  6. Paste the Web App URL into backend/api.js as BACKEND_URL:
//     const BACKEND_URL = 'https://script.google.com/macros/s/YOUR_ID/exec';
//
//  7. Done! Authentication + Result sync is now active.
//
// ── IMPORTANT NOTES ─────────────────────────────────────────────
//
//  - Google Apps Script handles CORS automatically for deployed web apps.
//  - The doPost function handles: login, saveResult, validateSession.
//  - The doGet function handles: getProgress, getProfile.
//  - Each redeployment generates a new URL — update BACKEND_URL.
//  - Passwords are hashed with SHA-256 + random salt. Not plain text.
//
// ================================================================

// ── CONFIGURATION ───────────────────────────────────────────────
const SHEET_ID = '1PcgVZrGEwjuJa0lhnptAtI-e1_33jZ97Gpwt-3OFC0Y';
const SESSION_SECRET = 'englishjibi_session_v1_secret';

// ================================================================
// doPost — Handle incoming POST requests
// ================================================================
function doPost(e) {
    try {
        const data = JSON.parse(e.postData.contents);
        const action = data.action || 'saveResult';

        switch (action) {
            case 'login':
                return _handleLogin(data);
            case 'register':
                return _handleRegister(data);
            case 'checkSession':
                return _handleCheckSession(data);
            case 'logout':
                return _handleLogout(data);
            case 'saveResult':
                return _handleSaveResult(data);
            case 'validateSession':
                return _handleValidateSession(data);
            default:
                return _jsonResponse({ success: false, error: 'Unknown action: ' + action });
        }
    } catch (err) {
        return _jsonResponse({ success: false, error: err.toString() });
    }
}

// ================================================================
// doGet — Handle incoming GET requests
// ================================================================
function doGet(e) {
    try {
        const action = e.parameter.action || '';
        const studentId = e.parameter.id || '';

        switch (action) {
            case 'getProgress':
                if (!studentId) return _jsonResponse({ success: false, error: 'Missing student ID' });
                return _jsonResponse(_getStudentProgress(studentId));

            case 'getProfile':
                if (!studentId) return _jsonResponse({ success: false, error: 'Missing student ID' });
                return _jsonResponse(_getStudentProfile(studentId));

            default:
                return _jsonResponse({
                    status: 'ok',
                    message: 'EnglishJibi Backend Active',
                    timestamp: new Date().toISOString()
                });
        }
    } catch (err) {
        return _jsonResponse({ success: false, error: err.toString() });
    }
}

// ================================================================
// ACTION HANDLERS
// ================================================================

// ── Login Handler ───────────────────────────────────────────────
function _handleLogin(data) {
    if (!data.email || !data.password) {
        return _jsonResponse({ success: false, error: 'Email and password are required.' });
    }

    const email = String(data.email).trim().toLowerCase();
    const password = String(data.password);

    const ss = SpreadsheetApp.openById(SHEET_ID);
    const regSheet = ss.getSheetByName('REGISTRATION');
    if (!regSheet) {
        return _jsonResponse({ success: false, error: 'Registration sheet not found.' });
    }

    const rows = regSheet.getDataRange().getValues();
    // Row 0 = headers. Find by email (column index 2).
    for (let i = 1; i < rows.length; i++) {
        const rowEmail = String(rows[i][2] || '').trim().toLowerCase();
        if (rowEmail !== email) continue;

        // Found the student row
        const studentId = rows[i][0];
        const studentName = rows[i][1];
        const storedHash = rows[i][3];
        const salt = rows[i][4];
        const status = String(rows[i][5] || '').trim().toLowerCase();

        // Check status first
        if (status === 'pending') {
            return _jsonResponse({ success: false, status: 'pending' });
        }
        if (status === 'blocked') {
            return _jsonResponse({ success: false, status: 'blocked' });
        }
        if (status !== 'approved') {
            return _jsonResponse({ success: false, error: 'Account not approved.' });
        }

        // Verify password
        const inputHash = _hashPassword(password, salt);
        if (inputHash !== storedHash) {
            return _jsonResponse({ success: false, error: 'Invalid email or password.' });
        }

        // Generate a unique session token for single-device enforcement
        const sessionToken = _generateSessionToken();

        // Update lastLogin (col I) and activeSessionToken (col J)
        regSheet.getRange(i + 1, 9).setValue(new Date().toISOString());
        regSheet.getRange(i + 1, 10).setValue(sessionToken);

        return _jsonResponse({
            success: true,
            studentId: studentId,
            studentName: studentName,
            email: rowEmail,
            sessionToken: sessionToken
        });
    }

    // No matching email found
    return _jsonResponse({ success: false, error: 'Invalid email or password.' });
}

// ── Save Result Handler ─────────────────────────────────────────
function _handleSaveResult(data) {
    // Validate required fields
    if (!data.subject || !data.level || !data.set ||
        typeof data.score !== 'number' || typeof data.total !== 'number') {
        return _jsonResponse({ success: false, error: 'Missing required fields.' });
    }

    const ss = SpreadsheetApp.openById(SHEET_ID);
    const studentId = data.studentId || 'anonymous';
    const studentName = data.studentName || 'Anonymous';

    // ── Verify student exists and is approved ────────────────────
    if (studentId !== 'anonymous') {
        const verified = _verifyStudent(ss, studentId);
        if (!verified) {
            return _jsonResponse({ success: false, error: 'Student not verified.' });
        }
    }

    // ── Check for duplicate submission ───────────────────────────
    const resultsSheet = ss.getSheetByName('RESULTS');
    if (!resultsSheet) {
        return _jsonResponse({ success: false, error: 'RESULTS sheet not found.' });
    }

    const isDupe = _checkDuplicate(resultsSheet, studentId,
        data.subject, data.level, String(data.set), data.timestamp);
    if (isDupe) {
        return _jsonResponse({ success: true, message: 'Duplicate — already saved.' });
    }

    // ── Ensure student row exists ────────────────────────────────
    _ensureStudent(ss, studentId, studentName);

    // ── Append result ────────────────────────────────────────────
    resultsSheet.appendRow([
        studentId,
        studentName,
        data.subject,
        data.level,
        String(data.set),
        data.score,
        data.total,
        data.percentage || Math.round((data.score / data.total) * 100),
        data.timeTaken || 0,
        data.date || new Date().toISOString(),
        data.timestamp || Date.now()
    ]);

    // ── Invalidate cached progress for this student ──────────────
    try {
        var cache = CacheService.getScriptCache();
        cache.remove('progress_' + studentId);
    } catch (ce) { /* cache miss is fine */ }

    return _jsonResponse({ success: true, message: 'Result saved.' });
}

// ── Validate Session Handler ────────────────────────────────────
function _handleValidateSession(data) {
    if (!data.studentId || !data.token || !data.loginAt) {
        return _jsonResponse({ success: false, error: 'Invalid session data.' });
    }

    // Verify the student still exists and is approved
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const verified = _verifyStudent(ss, data.studentId);

    return _jsonResponse({
        success: verified,
        verified: verified
    });
}

// ── Check Session (Single-Device Enforcement) ───────────────────
function _handleCheckSession(data) {
    if (!data.studentId || !data.sessionToken) {
        return _jsonResponse({ success: false, error: 'Missing session data.' });
    }

    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName('REGISTRATION');
    if (!sheet) return _jsonResponse({ success: false, error: 'Sheet not found.' });

    const rows = sheet.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
        if (rows[i][0] === data.studentId) {
            const status = String(rows[i][5] || '').trim().toLowerCase();
            if (status !== 'approved') {
                return _jsonResponse({ success: false, reason: 'account_' + status });
            }

            const storedToken = String(rows[i][9] || '');
            if (storedToken !== data.sessionToken) {
                return _jsonResponse({ success: false, reason: 'another_device' });
            }

            return _jsonResponse({ success: true });
        }
    }

    return _jsonResponse({ success: false, reason: 'not_found' });
}

// ── Logout Handler (clears activeSessionToken) ─────────────────
function _handleLogout(data) {
    if (!data.studentId || !data.sessionToken) {
        return _jsonResponse({ success: false, error: 'Missing session data.' });
    }

    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName('REGISTRATION');
    if (!sheet) return _jsonResponse({ success: false, error: 'Sheet not found.' });

    const rows = sheet.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
        if (rows[i][0] === data.studentId) {
            const storedToken = String(rows[i][9] || '');
            // Only clear if the requesting token matches (prevent abuse)
            if (storedToken === data.sessionToken) {
                sheet.getRange(i + 1, 10).setValue('');
            }
            return _jsonResponse({ success: true });
        }
    }

    return _jsonResponse({ success: true });
}

// ── Self-Registration Handler ───────────────────────────────────
function _handleRegister(data) {
    if (!data.name || !data.email || !data.password) {
        return _jsonResponse({ success: false, error: 'Name, email, and password are required.' });
    }

    const name = String(data.name).trim();
    const email = String(data.email).trim().toLowerCase();
    const password = String(data.password);

    if (name.length < 2) {
        return _jsonResponse({ success: false, error: 'Name must be at least 2 characters.' });
    }
    if (password.length < 4) {
        return _jsonResponse({ success: false, error: 'Password must be at least 4 characters.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return _jsonResponse({ success: false, error: 'Invalid email format.' });
    }

    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName('REGISTRATION');
    if (!sheet) return _jsonResponse({ success: false, error: 'Registration sheet not found.' });

    // Check for duplicate email
    const rows = sheet.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][2] || '').trim().toLowerCase() === email) {
            return _jsonResponse({ success: false, error: 'This email is already registered.' });
        }
    }

    // Generate student ID (auto-increment)
    const lastId = rows.length > 1 ? String(rows[rows.length - 1][0]) : 'STU000';
    const numPart = parseInt(lastId.replace(/\D/g, ''), 10) || 0;
    const newId = 'STU' + String(numPart + 1).padStart(3, '0');

    const salt = _generateSalt();
    const passwordHash = _hashPassword(password, salt);

    sheet.appendRow([
        newId,
        name,
        email,
        passwordHash,
        salt,
        'pending',       // status — teacher must approve
        'student',
        new Date().toISOString(),
        '',              // lastLogin
        ''               // activeSessionToken
    ]);

    return _jsonResponse({
        success: true,
        studentId: newId,
        message: 'Registration successful! Your account is pending teacher approval.'
    });
}

// ================================================================
// DATA RETRIEVAL HELPERS
// ================================================================

/**
 * Get all results for a specific student — returns authoritative dashboard JSON.
 * Computes overview stats, recent activities, and subject breakdown server-side.
 * Uses CacheService (90s TTL) to avoid repeated full-sheet scans.
 */
function _getStudentProgress(studentId) {
    // ── Check cache first ────────────────────────────────────────
    var cache = CacheService.getScriptCache();
    var cacheKey = 'progress_' + studentId;
    try {
        var cached = cache.get(cacheKey);
        if (cached) return JSON.parse(cached);
    } catch (e) { /* cache miss — compute fresh */ }

    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName('RESULTS');
    if (!sheet) return { success: false, error: 'RESULTS sheet not found.' };

    var data = sheet.getDataRange().getValues();

    // Collect all results for this student (keep best per set)
    const bestBySet = {};    // key: subject|level|set
    const allEntries = [];   // every row for recentActivities

    for (var i = 1; i < data.length; i++) {
        var row = data[i];
        if (row[0] !== studentId) continue;

        var subject = row[2];
        var level = row[3];
        var set = String(row[4]);
        var score = Number(row[5]) || 0;
        var total = Number(row[6]) || 0;
        var percentage = Number(row[7]) || 0;
        var timeTaken = Number(row[8]) || 0;
        var date = row[9] || '';
        var timestamp = Number(row[10]) || 0;

        var entry = { subject: subject, level: level, set: set, score: score, total: total, percentage: percentage, timeTaken: timeTaken, date: date, timestamp: timestamp };
        allEntries.push(entry);

        var key = subject + '|' + level + '|' + set;
        var existing = bestBySet[key];
        if (!existing || percentage >= existing.percentage) {
            bestBySet[key] = entry;
        }
    }

    // Compute overview from best-per-set
    var bestEntries = [];
    for (var k in bestBySet) {
        if (bestBySet.hasOwnProperty(k)) bestEntries.push(bestBySet[k]);
    }

    var totalSets = bestEntries.length;
    var totalScoreSum = 0;
    var totalTimeSpent = 0;
    var activeSubjectsMap = {};
    var subjectScoreMap = {};   // subject -> { totalPct, count, totalTime }

    for (var j = 0; j < bestEntries.length; j++) {
        var e = bestEntries[j];
        totalScoreSum += e.percentage;
        totalTimeSpent += e.timeTaken;
        activeSubjectsMap[e.subject] = true;

        if (!subjectScoreMap[e.subject]) {
            subjectScoreMap[e.subject] = { totalPct: 0, count: 0, totalTime: 0 };
        }
        subjectScoreMap[e.subject].totalPct += e.percentage;
        subjectScoreMap[e.subject].count += 1;
        subjectScoreMap[e.subject].totalTime += e.timeTaken;
    }

    var averageScore = totalSets > 0 ? Math.round(totalScoreSum / totalSets) : 0;
    var activeSubjects = Object.keys(activeSubjectsMap).length;

    // Find top subject (highest avg)
    var topSubject = 'None';
    var topSubjectScore = 0;
    for (var sub in subjectScoreMap) {
        if (subjectScoreMap.hasOwnProperty(sub)) {
            var avg = Math.round(subjectScoreMap[sub].totalPct / subjectScoreMap[sub].count);
            if (avg > topSubjectScore) {
                topSubjectScore = avg;
                topSubject = sub;
            }
        }
    }

    // Recent activities (last 5, sorted by timestamp desc)
    allEntries.sort(function (a, b) { return (b.timestamp || 0) - (a.timestamp || 0); });
    var recentActivities = allEntries.slice(0, 5);

    // Subject breakdown
    var subjectBreakdown = [];
    for (var s in subjectScoreMap) {
        if (subjectScoreMap.hasOwnProperty(s)) {
            var info = subjectScoreMap[s];
            subjectBreakdown.push({
                subject: s,
                setsCompleted: info.count,
                avgScore: Math.round(info.totalPct / info.count),
                totalTime: info.totalTime
            });
        }
    }
    subjectBreakdown.sort(function (a, b) { return b.avgScore - a.avgScore; });

    var result = {
        success: true,
        data: {
            overview: {
                averageScore: averageScore,
                totalSets: totalSets,
                overallScore: averageScore,
                totalTimeSpent: totalTimeSpent,
                activeSubjects: activeSubjects,
                topSubject: topSubject
            },
            recentActivities: recentActivities,
            subjectBreakdown: subjectBreakdown
        }
    };

    // ── Store in cache (90s TTL) ─────────────────────────────────
    try {
        cache.put(cacheKey, JSON.stringify(result), 90);
    } catch (e) { /* cache full — still return result */ }

    return result;
}

/**
 * Get student profile details from STUDENT_DETAILS sheet.
 * Uses CacheService (90s TTL) to avoid repeated reads.
 */
function _getStudentProfile(studentId) {
    var cache = CacheService.getScriptCache();
    var cacheKey = 'profile_' + studentId;
    try {
        var cached = cache.get(cacheKey);
        if (cached) return JSON.parse(cached);
    } catch (e) { /* cache miss */ }

    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName('STUDENT_DETAILS');
    if (!sheet) return { success: false, error: 'STUDENT_DETAILS sheet not found.' };

    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
        if (data[i][0] === studentId) {
            var result = {
                success: true,
                studentId: data[i][0],
                studentName: data[i][1],
                schoolName: data[i][2],
                className: data[i][3],
                profileImageURL: data[i][4],
                guardianName: data[i][5],
                contactNumber: data[i][6],
                address: data[i][7],
                createdAt: data[i][8]
            };
            try { cache.put(cacheKey, JSON.stringify(result), 90); } catch (e) { /* skip */ }
            return result;
        }
    }

    return { success: false, error: 'Student details not found.' };
}

// ================================================================
// SECURITY + VALIDATION HELPERS
// ================================================================

/**
 * Hash a password with SHA-256 + salt.
 * Returns hex string.
 */
function _hashPassword(password, salt) {
    const input = salt + ':' + password;
    const rawHash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, input);
    return rawHash.map(function (byte) {
        return ('0' + (byte & 0xFF).toString(16)).slice(-2);
    }).join('');
}

/**
 * Generate a random salt string (16 characters).
 */
function _generateSalt() {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let salt = '';
    for (let i = 0; i < 16; i++) {
        salt += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return salt;
}

/**
 * Generate a cryptographically strong session token using SHA-256.
 * Returns a 64-character hex string.
 */
function _generateSessionToken() {
    var seed = Utilities.getUuid() + new Date().getTime();
    var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, seed);
    return digest.map(function (b) { return ((b + 256) % 256).toString(16).padStart(2, '0'); }).join('');
}

/**
 * Verify that a student exists in REGISTRATION and has 'approved' status.
 */
function _verifyStudent(ss, studentId) {
    const sheet = ss.getSheetByName('REGISTRATION');
    if (!sheet) return false;

    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
        if (data[i][0] === studentId) {
            const status = String(data[i][5] || '').trim().toLowerCase();
            return status === 'approved';
        }
    }
    return false;
}

/**
 * Check for duplicate result submissions.
 * A result is duplicate if same studentId + subject + level + set + timestamp exists.
 */
function _checkDuplicate(sheet, studentId, subject, level, set, timestamp) {
    if (!timestamp) return false;

    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
        if (data[i][0] === studentId &&
            data[i][2] === subject &&
            data[i][3] === level &&
            String(data[i][4]) === set &&
            data[i][10] === timestamp) {
            return true;
        }
    }
    return false;
}

/**
 * Ensure a student row exists in the STUDENTS sheet (legacy compatibility).
 */
function _ensureStudent(ss, studentId, studentName) {
    const sheet = ss.getSheetByName('STUDENTS');
    if (!sheet) return;

    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
        if (data[i][0] === studentId) return;
    }

    sheet.appendRow([
        studentId,
        studentName,
        new Date().toISOString()
    ]);
}

/**
 * Return a JSON response with proper CORS headers.
 */
function _jsonResponse(data) {
    return ContentService
        .createTextOutput(JSON.stringify(data))
        .setMimeType(ContentService.MimeType.JSON);
}

// ================================================================
// ADMIN UTILITY FUNCTIONS (Run manually from Script Editor)
// ================================================================

/**
 * ADMIN: Create a new student registration with hashed password.
 * Run this from Script Editor to add students.
 *
 * Usage: createStudent('STU001', 'John Doe', 'john@school.com', 'password123')
 */
function createStudent(studentId, studentName, email, plainPassword) {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName('REGISTRATION');
    if (!sheet) throw new Error('REGISTRATION sheet not found');

    // Check for existing email
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
        if (String(data[i][2]).toLowerCase() === email.toLowerCase()) {
            throw new Error('Email already registered: ' + email);
        }
        if (data[i][0] === studentId) {
            throw new Error('Student ID already exists: ' + studentId);
        }
    }

    const salt = _generateSalt();
    const passwordHash = _hashPassword(plainPassword, salt);

    sheet.appendRow([
        studentId,
        studentName,
        email.toLowerCase(),
        passwordHash,
        salt,
        'approved',      // status
        'student',       // role
        new Date().toISOString(),   // createdAt
        '',              // lastLogin
        ''               // activeSessionToken
    ]);

    Logger.log('Student created: ' + studentId + ' (' + email + ')');
    return { success: true, studentId: studentId };
}

/**
 * ADMIN: Create student details entry.
 *
 * Usage: createStudentDetails('STU001', 'John Doe', 'ABC School', '10th', '', 'Jane Doe', '9876543210', 'City')
 */
function createStudentDetails(studentId, studentName, schoolName, className,
    profileImageURL, guardianName, contactNumber, address) {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName('STUDENT_DETAILS');
    if (!sheet) throw new Error('STUDENT_DETAILS sheet not found');

    sheet.appendRow([
        studentId,
        studentName,
        schoolName || '',
        className || '',
        profileImageURL || '',
        guardianName || '',
        contactNumber || '',
        address || '',
        new Date().toISOString()
    ]);

    Logger.log('Student details created for: ' + studentId);
    return { success: true };
}

function addTestStudent() {
    createStudent(
        'STU001',
        'subham',
        'subhammallick454@gmail.com',
        'Subham@454'
    );
}

function debugLogin() {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName('REGISTRATION');
    const rows = sheet.getDataRange().getValues();

    Logger.log('Total rows: ' + rows.length);

    for (let i = 1; i < rows.length; i++) {
        Logger.log('--- Row ' + (i + 1) + ' ---');
        Logger.log('studentId: ' + rows[i][0]);
        Logger.log('email: ' + rows[i][2]);
        Logger.log('storedHash: ' + rows[i][3]);
        Logger.log('salt: ' + rows[i][4]);
        Logger.log('status: ' + rows[i][5]);

        // Re-hash the password to compare
        const testHash = _hashPassword('Subham@454', rows[i][4]);
        Logger.log('testHash: ' + testHash);
        Logger.log('Match: ' + (testHash === rows[i][3]));
    }
}

