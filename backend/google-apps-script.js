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
//     - "REGISTRATION" with columns:
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

// ── Column indices (0-based) for REGISTRATION sheet ─────────────
const REG_COL = {
    STUDENT_ID: 0,
    NAME: 1,
    EMAIL: 2,
    HASH: 3,
    SALT: 4,
    STATUS: 5,
    ROLE: 6,
    CREATED_AT: 7,
    LAST_LOGIN: 8,
    SESSION_TOKEN: 9,
    APPROVED_AT: 10,
    APPROVED_BY: 11
};

// ── Column indices (0-based) for RESULTS sheet ──────────────────
const RES_COL = {
    STUDENT_ID: 0,
    NAME: 1,
    SUBJECT: 2,
    LEVEL: 3,
    SET: 4,
    SCORE: 5,
    TOTAL: 6,
    PERCENTAGE: 7,
    TIME_TAKEN: 8,
    DATE: 9,
    TIMESTAMP: 10
};

// ── Execution-level spreadsheet cache ───────────────────────────
let _cachedSS = null;
function _getSS() {
    if (!_cachedSS) _cachedSS = SpreadsheetApp.openById(SHEET_ID);
    return _cachedSS;
}

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
            case 'saveResult':
                return _handleSaveResult(data);
            case 'validateSession':
                return _handleValidateSession(data);
            case 'checkSession':
                return _handleCheckSession(data);
            case 'logout':
                return _handleLogout(data);
            case 'register':
                return _handleRegister(data);
            case 'listStudents':
                return _handleListStudents(data);
            case 'adminAction':
                return _handleAdminAction(data);
            default:
                return _jsonResponse({ success: false, error: 'Unknown action: ' + action, code: 'UNKNOWN_ACTION' });
        }
    } catch (err) {
        return _jsonResponse({ success: false, error: err.toString(), code: 'INTERNAL_ERROR' });
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
                if (!studentId) return _jsonResponse({ success: false, error: 'Missing student ID', code: 'MISSING_ID' });
                return _jsonResponse(_getStudentProgress(studentId));

            case 'getProfile':
                if (!studentId) return _jsonResponse({ success: false, error: 'Missing student ID', code: 'MISSING_ID' });
                return _jsonResponse(_getStudentProfile(studentId));

            default:
                return _jsonResponse({
                    status: 'ok',
                    message: 'EnglishJibi Backend Active',
                    timestamp: new Date().toISOString()
                });
        }
    } catch (err) {
        return _jsonResponse({ success: false, error: err.toString(), code: 'INTERNAL_ERROR' });
    }
}

// ================================================================
// ACTION HANDLERS
// ================================================================

// ── Login Handler ───────────────────────────────────────────────
function _handleLogin(data) {
    if (!data.email || !data.password) {
        return _jsonResponse({ success: false, error: 'Email and password are required.', code: 'MISSING_FIELDS' });
    }

    const email = String(data.email).trim().toLowerCase();
    const password = String(data.password);

    // ── Rate limiting (5 attempts per email per 5 minutes) ──────
    const rateLimitKey = 'login_attempts_' + email;
    const cache = CacheService.getScriptCache();
    const attempts = parseInt(cache.get(rateLimitKey) || '0', 10);
    if (attempts >= 5) {
        return _jsonResponse({
            success: false,
            error: 'Too many login attempts. Please wait 5 minutes.',
            code: 'RATE_LIMITED'
        });
    }

    const ss = _getSS();
    const regSheet = ss.getSheetByName('REGISTRATION');
    if (!regSheet) {
        return _jsonResponse({ success: false, error: 'Registration sheet not found.', code: 'SHEET_NOT_FOUND' });
    }

    // ── Targeted row lookup via TextFinder ──────────────────────
    const rowData = _findRowByColumn(regSheet, REG_COL.EMAIL, email);
    if (!rowData) {
        // Increment failed attempts
        cache.put(rateLimitKey, String(attempts + 1), 300);
        return _jsonResponse({ success: false, error: 'Invalid email or password.', code: 'INVALID_CREDENTIALS' });
    }

    const row = rowData.values;
    const rowIndex = rowData.rowIndex;

    const studentId = row[REG_COL.STUDENT_ID];
    const studentName = row[REG_COL.NAME];
    const storedHash = row[REG_COL.HASH];
    const salt = row[REG_COL.SALT];
    const status = String(row[REG_COL.STATUS] || '').trim().toLowerCase();

    // Check status first
    if (status === 'pending') {
        return _jsonResponse({
            success: false, status: 'pending',
            error: 'Account pending approval. Please contact your teacher.',
            code: 'ACCOUNT_PENDING'
        });
    }
    if (status === 'suspended') {
        return _jsonResponse({
            success: false, status: 'suspended',
            error: 'Account suspended. Contact administrator.',
            code: 'ACCOUNT_SUSPENDED'
        });
    }
    if (status === 'rejected') {
        return _jsonResponse({
            success: false, status: 'rejected',
            error: 'Account rejected. Contact administrator.',
            code: 'ACCOUNT_REJECTED'
        });
    }
    if (status === 'blocked') {
        return _jsonResponse({
            success: false, status: 'blocked',
            error: 'Account blocked. Contact administrator.',
            code: 'ACCOUNT_BLOCKED'
        });
    }
    if (status !== 'approved') {
        return _jsonResponse({ success: false, error: 'Account not approved.', code: 'ACCOUNT_NOT_APPROVED' });
    }

    // Verify password
    const inputHash = _hashPassword(password, salt);
    if (inputHash !== storedHash) {
        cache.put(rateLimitKey, String(attempts + 1), 300);
        return _jsonResponse({ success: false, error: 'Invalid email or password.', code: 'INVALID_CREDENTIALS' });
    }

    // Generate active session token (forces logout on other devices)
    const activeSessionToken = Utilities.getUuid();
    regSheet.getRange(rowIndex, REG_COL.LAST_LOGIN + 1).setValue(new Date().toISOString());
    regSheet.getRange(rowIndex, REG_COL.SESSION_TOKEN + 1).setValue(activeSessionToken);

    // Clear rate limit on success
    cache.remove(rateLimitKey);

    return _jsonResponse({
        success: true,
        studentId: studentId,
        studentName: studentName,
        email: email,
        activeSessionToken: activeSessionToken
    });
}

// ── Save Result Handler ─────────────────────────────────────────
function _handleSaveResult(data) {
    // Validate required fields
    if (!data.subject || !data.level || !data.set ||
        typeof data.score !== 'number' || typeof data.total !== 'number') {
        return _jsonResponse({ success: false, error: 'Missing required fields.', code: 'MISSING_FIELDS' });
    }

    const ss = _getSS();
    const studentId = data.studentId || 'anonymous';
    const studentName = data.studentName || 'Anonymous';

    // ── Verify student exists and is approved (targeted read) ───
    if (studentId !== 'anonymous') {
        const regSheet = ss.getSheetByName('REGISTRATION');
        if (!regSheet) {
            return _jsonResponse({ success: false, error: 'Registration sheet not found.', code: 'SHEET_NOT_FOUND' });
        }
        const studentRow = _findRowByColumn(regSheet, REG_COL.STUDENT_ID, studentId);
        if (!studentRow) {
            return _jsonResponse({ success: false, error: 'Student not found.', code: 'STUDENT_NOT_FOUND' });
        }
        const status = String(studentRow.values[REG_COL.STATUS] || '').trim().toLowerCase();
        if (status !== 'approved') {
            return _jsonResponse({ success: false, error: 'Student not verified.', code: 'NOT_VERIFIED' });
        }
    }

    // ── Check for duplicate + append result ──────────────────────
    const resultsSheet = ss.getSheetByName('RESULTS');
    if (!resultsSheet) {
        return _jsonResponse({ success: false, error: 'RESULTS sheet not found.', code: 'SHEET_NOT_FOUND' });
    }

    // Check duplicate using timestamp (targeted search)
    if (data.timestamp) {
        const tsStr = String(data.timestamp);
        const finder = resultsSheet.createTextFinder(tsStr);
        const found = finder.findNext();
        if (found) {
            // Verify it's actually a matching row (same student + subject + level + set)
            const foundRow = found.getRow();
            const rowVals = resultsSheet.getRange(foundRow, 1, 1, 11).getValues()[0];
            if (rowVals[RES_COL.STUDENT_ID] === studentId &&
                rowVals[RES_COL.SUBJECT] === data.subject &&
                rowVals[RES_COL.LEVEL] === data.level &&
                String(rowVals[RES_COL.SET]) === String(data.set)) {
                return _jsonResponse({ success: true, message: 'Duplicate — already saved.' });
            }
        }
    }

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

    return _jsonResponse({ success: true, message: 'Result saved.' });
}

// ── Validate Session Handler ────────────────────────────────────
function _handleValidateSession(data) {
    if (!data.studentId || !data.token || !data.loginAt) {
        return _jsonResponse({ success: false, error: 'Invalid session data.', code: 'MISSING_FIELDS' });
    }

    const ss = _getSS();
    const regSheet = ss.getSheetByName('REGISTRATION');
    if (!regSheet) return _jsonResponse({ success: false, error: 'Sheet not found.', code: 'SHEET_NOT_FOUND' });

    const row = _findRowByColumn(regSheet, REG_COL.STUDENT_ID, data.studentId);
    if (!row) return _jsonResponse({ success: false, verified: false });

    const status = String(row.values[REG_COL.STATUS] || '').trim().toLowerCase();
    return _jsonResponse({
        success: status === 'approved',
        verified: status === 'approved'
    });
}

// ── Check Session Handler (Server-authoritative) ────────────────
function _handleCheckSession(data) {
    if (!data.studentId || !data.activeSessionToken) {
        return _jsonResponse({ success: false, reason: 'missing_params' });
    }

    const ss = _getSS();
    const sheet = ss.getSheetByName('REGISTRATION');
    if (!sheet) return _jsonResponse({ success: false, reason: 'sheet_not_found' });

    const row = _findRowByColumn(sheet, REG_COL.STUDENT_ID, data.studentId);
    if (!row) return _jsonResponse({ success: false, reason: 'student_not_found' });

    const status = String(row.values[REG_COL.STATUS] || '').trim().toLowerCase();
    if (status !== 'approved') {
        return _jsonResponse({ success: false, reason: 'account_not_approved' });
    }

    const storedToken = String(row.values[REG_COL.SESSION_TOKEN] || '');
    if (storedToken === data.activeSessionToken) {
        return _jsonResponse({ success: true });
    } else {
        return _jsonResponse({ success: false, reason: 'session_invalid' });
    }
}

// ── Logout Handler ──────────────────────────────────────────────
function _handleLogout(data) {
    if (!data.studentId) {
        return _jsonResponse({ success: false, error: 'Missing student ID.', code: 'MISSING_ID' });
    }

    const ss = _getSS();
    const sheet = ss.getSheetByName('REGISTRATION');
    if (!sheet) return _jsonResponse({ success: false, error: 'Sheet not found.', code: 'SHEET_NOT_FOUND' });

    const row = _findRowByColumn(sheet, REG_COL.STUDENT_ID, data.studentId);
    if (!row) return _jsonResponse({ success: false, error: 'Student not found.', code: 'STUDENT_NOT_FOUND' });

    sheet.getRange(row.rowIndex, REG_COL.SESSION_TOKEN + 1).setValue('');
    return _jsonResponse({ success: true });
}

// ── Register Handler ────────────────────────────────────────────
function _handleRegister(data) {
    if (!data.name || !data.email || !data.password) {
        return _jsonResponse({ success: false, error: 'Name, email, and password are required.', code: 'MISSING_FIELDS' });
    }

    const email = String(data.email).trim().toLowerCase();
    const name = String(data.name).trim();
    const password = String(data.password);

    if (password.length < 6) {
        return _jsonResponse({ success: false, error: 'Password must be at least 6 characters.', code: 'WEAK_PASSWORD' });
    }

    const ss = _getSS();
    const sheet = ss.getSheetByName('REGISTRATION');
    if (!sheet) return _jsonResponse({ success: false, error: 'Registration sheet not found.', code: 'SHEET_NOT_FOUND' });

    // Check for duplicate email (targeted search)
    const existing = _findRowByColumn(sheet, REG_COL.EMAIL, email);
    if (existing) {
        return _jsonResponse({ success: false, error: 'This email is already registered.', code: 'EMAIL_EXISTS' });
    }

    // Generate student ID using UUID for unpredictability
    const studentId = 'STU_' + Utilities.getUuid().replace(/-/g, '').substring(0, 12).toUpperCase();

    const salt = _generateSalt();
    const passwordHash = _hashPassword(password, salt);

    sheet.appendRow([
        studentId,
        name,
        email,
        passwordHash,
        salt,
        'pending',     // status — teacher must approve
        'student',     // role
        new Date().toISOString(), // createdAt
        '',            // lastLogin
        ''             // activeSessionToken
    ]);

    return _jsonResponse({ success: true, message: 'Registration submitted. Await teacher approval.' });
}

// ================================================================
// ADMIN HANDLERS
// ================================================================

/**
 * List all students, optionally filtered by status.
 * data.statusFilter: 'pending' | 'approved' | 'suspended' | 'rejected' | 'all' (default: 'all')
 */
function _handleListStudents(data) {
    const ss = _getSS();
    const regSheet = ss.getSheetByName('REGISTRATION');
    if (!regSheet) return _jsonResponse({ success: false, error: 'Sheet not found.', code: 'SHEET_NOT_FOUND' });

    const lastRow = regSheet.getLastRow();
    if (lastRow <= 1) return _jsonResponse({ success: true, students: [] });

    const allData = regSheet.getRange(2, 1, lastRow - 1, regSheet.getLastColumn()).getValues();
    const filter = String(data.statusFilter || 'all').trim().toLowerCase();

    // Also try to get details from STUDENT_DETAILS sheet
    let detailsMap = {};
    try {
        const detSheet = ss.getSheetByName('STUDENT_DETAILS');
        if (detSheet && detSheet.getLastRow() > 1) {
            const detData = detSheet.getRange(2, 1, detSheet.getLastRow() - 1, detSheet.getLastColumn()).getValues();
            detData.forEach(row => {
                detailsMap[row[0]] = {
                    schoolName: row[2] || '',
                    className: row[3] || '',
                    guardianName: row[5] || '',
                    contactNumber: row[6] || ''
                };
            });
        }
    } catch { /* no details sheet */ }

    const students = [];
    for (let i = 0; i < allData.length; i++) {
        const row = allData[i];
        const status = String(row[REG_COL.STATUS] || '').trim().toLowerCase();

        if (filter !== 'all' && status !== filter) continue;

        const sid = row[REG_COL.STUDENT_ID];
        const details = detailsMap[sid] || {};

        students.push({
            studentId: sid,
            studentName: row[REG_COL.NAME] || '',
            email: row[REG_COL.EMAIL] || '',
            status: status,
            role: row[REG_COL.ROLE] || 'student',
            createdAt: row[REG_COL.CREATED_AT] || '',
            lastLogin: row[REG_COL.LAST_LOGIN] || '',
            approvedAt: row[REG_COL.APPROVED_AT] || '',
            approvedBy: row[REG_COL.APPROVED_BY] || '',
            schoolName: details.schoolName || '',
            className: details.className || '',
            guardianName: details.guardianName || '',
            contactNumber: details.contactNumber || ''
        });
    }

    return _jsonResponse({ success: true, students: students });
}

/**
 * Admin action: approve, reject, suspend, or delete a student.
 * data.studentId, data.adminAction ('approve'|'reject'|'suspend'|'delete'), data.adminName
 */
function _handleAdminAction(data) {
    if (!data.studentId || !data.adminAction) {
        return _jsonResponse({ success: false, error: 'Missing studentId or adminAction.', code: 'MISSING_FIELDS' });
    }

    const validActions = ['approve', 'reject', 'suspend', 'delete'];
    const action = String(data.adminAction).trim().toLowerCase();
    if (!validActions.includes(action)) {
        return _jsonResponse({ success: false, error: 'Invalid action. Use: ' + validActions.join(', '), code: 'INVALID_ACTION' });
    }

    const ss = _getSS();
    const sheet = ss.getSheetByName('REGISTRATION');
    if (!sheet) return _jsonResponse({ success: false, error: 'Sheet not found.', code: 'SHEET_NOT_FOUND' });

    const row = _findRowByColumn(sheet, REG_COL.STUDENT_ID, data.studentId);
    if (!row) return _jsonResponse({ success: false, error: 'Student not found.', code: 'STUDENT_NOT_FOUND' });

    const adminName = data.adminName || 'Admin';
    const now = new Date().toISOString();

    if (action === 'delete') {
        sheet.deleteRow(row.rowIndex);
        return _jsonResponse({ success: true, message: 'Student deleted.' });
    }

    // Map action to status
    const statusMap = { approve: 'approved', reject: 'rejected', suspend: 'suspended' };
    const newStatus = statusMap[action];

    // Update status
    sheet.getRange(row.rowIndex, REG_COL.STATUS + 1).setValue(newStatus);

    // Clear session token if suspending/rejecting (force logout)
    if (action === 'suspend' || action === 'reject') {
        sheet.getRange(row.rowIndex, REG_COL.SESSION_TOKEN + 1).setValue('');
    }

    // Set approved_at and approved_by (columns 11, 12)
    if (action === 'approve') {
        sheet.getRange(row.rowIndex, REG_COL.APPROVED_AT + 1).setValue(now);
        sheet.getRange(row.rowIndex, REG_COL.APPROVED_BY + 1).setValue(adminName);
    }

    return _jsonResponse({
        success: true,
        message: 'Student ' + action + 'd successfully.',
        studentId: data.studentId,
        newStatus: newStatus
    });
}

// ================================================================
// DATA RETRIEVAL HELPERS
// ================================================================

/**
 * Get all results for a specific student — structured like localStorage format.
 * Uses TextFinder for targeted reads when possible, falls back to filtered scan.
 */
function _getStudentProgress(studentId) {
    const ss = _getSS();
    const sheet = ss.getSheetByName('RESULTS');
    if (!sheet) return {};

    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) return {};

    // Read all data but only the columns we need
    const data = sheet.getRange(2, 1, lastRow - 1, 11).getValues();
    const progress = {};

    for (let i = 0; i < data.length; i++) {
        const row = data[i];
        if (row[RES_COL.STUDENT_ID] !== studentId) continue;

        const subject = row[RES_COL.SUBJECT];
        const level = row[RES_COL.LEVEL];
        const set = String(row[RES_COL.SET]);
        const score = row[RES_COL.SCORE];
        const total = row[RES_COL.TOTAL];
        const percentage = row[RES_COL.PERCENTAGE];
        const timeTaken = row[RES_COL.TIME_TAKEN];
        const date = row[RES_COL.DATE];
        const timestamp = row[RES_COL.TIMESTAMP];

        if (!progress[subject]) progress[subject] = {};
        if (!progress[subject][level]) progress[subject][level] = {};

        // Keep best score only
        const existing = progress[subject][level][set];
        if (!existing || percentage >= existing.percentage) {
            progress[subject][level][set] = {
                score, total, percentage, timeTaken, date, timestamp
            };
        }
    }

    return progress;
}

/**
 * Get student profile details from STUDENT_DETAILS sheet.
 * Uses targeted row lookup.
 */
function _getStudentProfile(studentId) {
    const ss = _getSS();
    const sheet = ss.getSheetByName('STUDENT_DETAILS');
    if (!sheet) return { success: false, error: 'STUDENT_DETAILS sheet not found.' };

    const row = _findRowByColumn(sheet, 0, studentId);
    if (!row) return { success: false, error: 'Student details not found.' };

    const d = row.values;
    return {
        success: true,
        studentId: d[0],
        studentName: d[1],
        schoolName: d[2],
        className: d[3],
        profileImageURL: d[4],
        guardianName: d[5],
        contactNumber: d[6],
        address: d[7],
        createdAt: d[8]
    };
}

// ================================================================
// TARGETED ROW LOOKUP
// ================================================================

/**
 * Find a single row by searching a specific column for a value.
 * Uses TextFinder for O(1)-like lookup instead of full sheet scan.
 * Returns { rowIndex (1-based), values: [...] } or null.
 */
function _findRowByColumn(sheet, colIndex, searchValue) {
    if (!searchValue) return null;

    const searchStr = String(searchValue).trim();
    if (!searchStr) return null;

    // Use TextFinder on the specific column for fast lookup
    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) return null;

    const colRange = sheet.getRange(2, colIndex + 1, lastRow - 1, 1);
    const finder = colRange.createTextFinder(searchStr)
        .matchCase(colIndex === REG_COL.EMAIL ? false : true)
        .matchEntireCell(true);

    const found = finder.findNext();
    if (!found) return null;

    const rowIndex = found.getRow();
    const totalCols = sheet.getLastColumn();
    const values = sheet.getRange(rowIndex, 1, 1, totalCols).getValues()[0];

    // Double-check exact match (TextFinder may be case-insensitive)
    const cellVal = String(values[colIndex] || '').trim();
    if (colIndex === REG_COL.EMAIL) {
        if (cellVal.toLowerCase() !== searchStr.toLowerCase()) return null;
    } else {
        if (cellVal !== searchStr) return null;
    }

    return { rowIndex, values };
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
 * Uses Utilities.getUuid() for better randomness than Math.random().
 */
function _generateSalt() {
    return Utilities.getUuid().replace(/-/g, '').substring(0, 16);
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
    if (!studentId || !studentName || !email || !plainPassword) {
        throw new Error('All parameters required: createStudent(studentId, studentName, email, plainPassword)');
    }
    email = String(email).trim();
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName('REGISTRATION');
    if (!sheet) throw new Error('REGISTRATION sheet not found');

    // Check for existing email (targeted)
    const existingEmail = _findRowByColumn(sheet, REG_COL.EMAIL, email);
    if (existingEmail) throw new Error('Email already registered: ' + email);

    const existingId = _findRowByColumn(sheet, REG_COL.STUDENT_ID, studentId);
    if (existingId) throw new Error('Student ID already exists: ' + studentId);

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
        ''               // lastLogin
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
/**
 * ADMIN: Run this function from the Script Editor to create a test student.
 * Select "runCreateStudent" from the dropdown and click Run.
 */
function runCreateStudent() {
    const result = createStudent('STU004', 'John Doe', 'john@school.com', 'password123');
    Logger.log(result);
}