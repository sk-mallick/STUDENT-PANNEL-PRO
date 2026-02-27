// ================================================================
// student-panel/js/login.js
// Drives login.html — handles form submission, authentication,
// session creation, and redirect.
// ================================================================

import { createSession, isAuthenticated } from './auth-guard.js';
import { API } from '../backend/api.js';

// ── DOM Elements ─────────────────────────────────────────────────
const form = document.getElementById('login-form');
const emailInput = document.getElementById('login-email');
const passwordInput = document.getElementById('login-password');
const loginBtn = document.getElementById('login-btn');
const errorDiv = document.getElementById('login-error');
const statusDiv = document.getElementById('login-status');
const togglePasswordBtn = document.getElementById('toggle-password');
const eyeIcon = document.getElementById('eye-icon');
const eyeOffIcon = document.getElementById('eye-off-icon');

// ── Check: already logged in → redirect to dashboard ─────────────
if (isAuthenticated()) {
    window.location.href = 'index.html';
}

// ── Show session-revoked message if redirected ───────────────────
(function _checkSessionRevoked() {
    const params = new URLSearchParams(window.location.search);
    const reason = params.get('reason');
    if (reason === 'session_revoked') {
        _showStatus('blocked',
            'You were logged out because another device signed in with your account.');
        // Clean the URL
        window.history.replaceState({}, '', window.location.pathname);
    }
})();

// ── Password toggle ──────────────────────────────────────────────
if (togglePasswordBtn) {
    togglePasswordBtn.addEventListener('click', () => {
        const isPassword = passwordInput.type === 'password';
        passwordInput.type = isPassword ? 'text' : 'password';
        eyeIcon.classList.toggle('hidden', !isPassword);
        eyeOffIcon.classList.toggle('hidden', isPassword);
    });
}

// ── Form submission ──────────────────────────────────────────────
form.addEventListener('submit', async (e) => {
    e.preventDefault();
    _hideError();
    _hideStatus();

    const email = emailInput.value.trim();
    const password = passwordInput.value;

    // Client-side validation
    if (!email) {
        _showError('Please enter your email address.');
        emailInput.focus();
        return;
    }

    if (!_isValidEmail(email)) {
        _showError('Please enter a valid email address.');
        emailInput.focus();
        return;
    }

    if (!password) {
        _showError('Please enter your password.');
        passwordInput.focus();
        return;
    }

    if (password.length < 4) {
        _showError('Password must be at least 4 characters.');
        passwordInput.focus();
        return;
    }

    // Submit using centralized API module
    _setLoading(true);

    try {
        const result = await API.login(email, password);

        if (!result) {
            throw new Error('No response from server.');
        }

        if (result.reason === 'no_backend_configured') {
            _showError('Backend not configured. Please contact your teacher.');
            return;
        }

        if (result.success) {
            // Login successful — create session with server-issued token
            await createSession(result.studentId, result.studentName, email, result.activeSessionToken);

            // Prefetch dashboard data while showing loading state
            loginBtn.textContent = 'Preparing dashboard…';

            // Import Progress and prefetch with 3s timeout
            try {
                const { Progress } = await import('./progress.js');
                await Promise.race([
                    Progress.prefetchDashboardData(result.studentId),
                    new Promise(resolve => setTimeout(resolve, 3000))
                ]);
            } catch { /* prefetch failure is non-blocking */ }

            window.location.href = 'index.html';
        } else {
            // Handle specific error states
            const status = result.status || '';
            if (status === 'pending') {
                _showStatus('pending',
                    'Your account is pending approval. Please wait for your teacher to approve your registration.');
            } else if (status === 'suspended') {
                _showStatus('blocked',
                    'Your account has been suspended. Please contact your teacher for assistance.');
            } else if (status === 'rejected') {
                _showStatus('blocked',
                    'Your account registration was rejected. Please contact your teacher.');
            } else if (status === 'blocked') {
                _showStatus('blocked',
                    'Your account has been blocked. Please contact your teacher for assistance.');
            } else if (result.code === 'RATE_LIMITED') {
                _showError('Too many login attempts. Please wait a few minutes and try again.');
            } else {
                _showError(result.error || 'Invalid email or password. Please try again.');
            }
        }
    } catch (err) {
        console.warn('[Login] Authentication failed:', err.message);
        if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
            _showError('Unable to connect to the server. Please check your internet connection.');
        } else {
            _showError(err.message || 'Login failed. Please try again.');
        }
    } finally {
        _setLoading(false);
    }
});

// ── UI Helpers ───────────────────────────────────────────────────

function _showError(message) {
    if (!errorDiv) return;
    errorDiv.textContent = message;
    errorDiv.classList.remove('hidden');
}

function _hideError() {
    if (!errorDiv) return;
    errorDiv.classList.add('hidden');
    errorDiv.textContent = '';
}

function _showStatus(type, message) {
    if (!statusDiv) return;
    const colors = {
        pending: {
            bg: 'rgba(234, 179, 8, 0.08)',
            border: 'rgba(234, 179, 8, 0.15)',
            text: '#fbbf24',
            icon: '⏳'
        },
        blocked: {
            bg: 'rgba(239, 68, 68, 0.08)',
            border: 'rgba(239, 68, 68, 0.15)',
            text: '#f87171',
            icon: '🚫'
        }
    };
    const c = colors[type] || colors.pending;
    statusDiv.innerHTML = `
        <div style="padding:12px 16px; font-size:13px; font-weight:600; color:${c.text};
                    background:${c.bg}; border:1px solid ${c.border}; border-radius:10px;
                    display:flex; align-items:flex-start; gap:10px; line-height:1.5;">
            <span style="font-size:16px; line-height:1.3;">${c.icon}</span>
            <span>${message}</span>
        </div>`;
    statusDiv.classList.remove('hidden');
}

function _hideStatus() {
    if (!statusDiv) return;
    statusDiv.classList.add('hidden');
    statusDiv.innerHTML = '';
}

function _setLoading(loading) {
    if (!loginBtn) return;
    if (loading) {
        loginBtn.classList.add('btn-loading');
        loginBtn.disabled = true;
    } else {
        loginBtn.classList.remove('btn-loading');
        loginBtn.disabled = false;
    }
}

function _isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
