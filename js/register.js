// ================================================================
// student-panel/js/register.js
// Drives register.html — handles form validation, password strength,
// field-level errors, submission, and success/error display.
// ================================================================

import { isAuthenticated } from './auth-guard.js';
import { API } from '../backend/api.js';

// ── Redirect if already logged in ────────────────────────────────
if (isAuthenticated()) {
    window.location.href = 'index.html';
}

// ── DOM Elements ─────────────────────────────────────────────────
const form = document.getElementById('register-form');
const nameInput = document.getElementById('reg-name');
const emailInput = document.getElementById('reg-email');
const passwordInput = document.getElementById('reg-password');
const confirmInput = document.getElementById('reg-confirm');
const registerBtn = document.getElementById('register-btn');
const errorDiv = document.getElementById('register-error');
const successDiv = document.getElementById('register-success');
const pwStrengthFill = document.getElementById('pw-strength-fill');
const togglePasswordBtn = document.getElementById('toggle-password');
const eyeIcon = document.getElementById('eye-icon');
const eyeOffIcon = document.getElementById('eye-off-icon');

// Field error hints
const errName = document.getElementById('err-name');
const errEmail = document.getElementById('err-email');
const errPassword = document.getElementById('err-password');
const errConfirm = document.getElementById('err-confirm');

// ── Password toggle ──────────────────────────────────────────────
if (togglePasswordBtn) {
    togglePasswordBtn.addEventListener('click', () => {
        const isPassword = passwordInput.type === 'password';
        passwordInput.type = isPassword ? 'text' : 'password';
        eyeIcon.classList.toggle('hidden', !isPassword);
        eyeOffIcon.classList.toggle('hidden', isPassword);
    });
}

// ── Password strength meter ──────────────────────────────────────
if (passwordInput && pwStrengthFill) {
    passwordInput.addEventListener('input', () => {
        const val = passwordInput.value;
        let strength = 0;
        if (val.length >= 4) strength++;
        if (val.length >= 6) strength++;
        if (val.length >= 8) strength++;
        if (/[A-Z]/.test(val)) strength++;
        if (/[0-9]/.test(val)) strength++;
        if (/[^A-Za-z0-9]/.test(val)) strength++;

        const percent = Math.min((strength / 6) * 100, 100);
        pwStrengthFill.style.width = percent + '%';

        if (strength <= 2) {
            pwStrengthFill.style.background = '#ef4444';
        } else if (strength <= 4) {
            pwStrengthFill.style.background = '#f59e0b';
        } else {
            pwStrengthFill.style.background = '#10b981';
        }
    });
}

// ── Field error helpers ──────────────────────────────────────────
function _showFieldError(el, input, msg) {
    if (el) {
        el.textContent = msg;
        el.classList.add('show');
    }
    if (input) input.classList.add('has-error');
}

function _clearFieldError(el, input) {
    if (el) {
        el.textContent = '';
        el.classList.remove('show');
    }
    if (input) input.classList.remove('has-error');
}

function _clearAllFieldErrors() {
    _clearFieldError(errName, nameInput);
    _clearFieldError(errEmail, emailInput);
    _clearFieldError(errPassword, passwordInput);
    _clearFieldError(errConfirm, confirmInput);
}

// ── Form submission ──────────────────────────────────────────────
form.addEventListener('submit', async (e) => {
    e.preventDefault();
    _hideError();
    _clearAllFieldErrors();

    const name = nameInput.value.trim();
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    const confirm = confirmInput.value;

    // ── Client-side validation (field-level) ─────────────────────
    let hasError = false;

    if (!name || name.length < 2) {
        _showFieldError(errName, nameInput, 'Please enter your full name.');
        if (!hasError) nameInput.focus();
        hasError = true;
    }

    if (!email) {
        _showFieldError(errEmail, emailInput, 'Please enter your email address.');
        if (!hasError) emailInput.focus();
        hasError = true;
    } else if (!_isValidEmail(email)) {
        _showFieldError(errEmail, emailInput, 'Please enter a valid email address.');
        if (!hasError) emailInput.focus();
        hasError = true;
    }

    if (!password) {
        _showFieldError(errPassword, passwordInput, 'Please enter a password.');
        if (!hasError) passwordInput.focus();
        hasError = true;
    } else if (password.length < 6) {
        _showFieldError(errPassword, passwordInput, 'Password must be at least 6 characters.');
        if (!hasError) passwordInput.focus();
        hasError = true;
    }

    if (!confirm) {
        _showFieldError(errConfirm, confirmInput, 'Please confirm your password.');
        if (!hasError) confirmInput.focus();
        hasError = true;
    } else if (password && password !== confirm) {
        _showFieldError(errConfirm, confirmInput, 'Passwords do not match.');
        if (!hasError) confirmInput.focus();
        hasError = true;
    }

    if (hasError) return;

    // ── Submit to backend ────────────────────────────────────────
    _setLoading(true);

    try {
        const result = await API.register(name, email, password);

        if (result.success) {
            // Show success panel, hide form
            form.classList.add('hidden');
            successDiv.classList.remove('hidden');
            // Also hide the footer link
            const footer = form.parentElement.querySelector('.border-t');
            if (footer) footer.classList.add('hidden');
        } else {
            _showError(result.error || 'Registration failed. Please try again.');
        }
    } catch (err) {
        console.warn('[Register] Error:', err.message);
        if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
            _showError('Unable to connect to the server. Please check your internet connection.');
        } else {
            _showError(err.message || 'Registration failed. Please try again.');
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

function _setLoading(loading) {
    if (!registerBtn) return;
    if (loading) {
        registerBtn.classList.add('btn-loading');
        registerBtn.disabled = true;
    } else {
        registerBtn.classList.remove('btn-loading');
        registerBtn.disabled = false;
    }
}

function _isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
