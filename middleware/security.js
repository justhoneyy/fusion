const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const crypto = require('crypto');

// Helmet security headers
exports.securityHeaders = helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://fonts.googleapis.com"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://fonts.googleapis.com"],
            imgSrc: ["'self'", "data:", "https:", "blob:"],
            fontSrc: ["'self'", "https://cdnjs.cloudflare.com", "https://fonts.gstatic.com"],
            connectSrc: ["'self'", "https://maps.google.com"],
            frameSrc: ["'self'", "https://maps.google.com"],
            mediaSrc: ["'self'", "blob:"]
        }
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" }
});

// Rate limiting
exports.loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 attempts per window
    message: { error: 'Too many login attempts. Please try again after 15 minutes.' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.ip + '-' + req.body?.email
});

exports.apiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 100,
    message: { error: 'Too many requests. Please slow down.' },
    standardHeaders: true,
    legacyHeaders: false
});

exports.authLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 20,
    message: { error: 'Too many authentication attempts.' }
});

// CSRF Protection
exports.csrfProtection = (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        return next();
    }

    const csrfCookie = req.cookies?.csrf_token;
    const csrfHeader = req.headers['x-csrf-token'];

    if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
        return res.status(403).json({ error: 'CSRF token validation failed.' });
    }

    next();
};

// Generate CSRF token
exports.generateCsrfToken = (req, res, next) => {
    if (!req.cookies?.csrf_token) {
        const token = crypto.randomBytes(32).toString('hex');
        res.cookie('csrf_token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 24 * 60 * 60 * 1000 // 24 hours
        });
        res.locals.csrfToken = token;
    } else {
        res.locals.csrfToken = req.cookies.csrf_token;
    }
    next();
};

// XSS Protection
exports.xssProtection = (req, res, next) => {
    // Sanitize string inputs
    const sanitize = (value) => {
        if (typeof value === 'string') {
            return value
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#x27;')
                .replace(/\//g, '&#x2F;');
        }
        return value;
    };

    // Sanitize body
    if (req.body) {
        Object.keys(req.body).forEach(key => {
            if (typeof req.body[key] === 'string') {
                req.body[key] = sanitize(req.body[key]);
            }
        });
    }

    // Sanitize query params
    if (req.query) {
        Object.keys(req.query).forEach(key => {
            if (typeof req.query[key] === 'string') {
                req.query[key] = sanitize(req.query[key]);
            }
        });
    }

    next();
};

// SQL Injection protection is handled by parameterized queries in pg library
// File upload validation
exports.validateFileUpload = (req, res, next) => {
    if (!req.file) return next();

    const allowedMimes = {
        'application/pdf': 'pdf',
        'application/vnd.ms-powerpoint': 'ppt',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
        'application/msword': 'doc',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/gif': 'gif',
        'image/webp': 'webp',
        'video/mp4': 'mp4',
        'video/webm': 'webm',
        'video/x-matroska': 'mkv'
    };

    if (!allowedMimes[req.file.mimetype]) {
        return res.status(400).json({ error: 'Invalid file type.' });
    }

    // Max 50MB
    if (req.file.size > 50 * 1024 * 1024) {
        return res.status(400).json({ error: 'File too large. Maximum 50MB.' });
    }

    req.fileType = allowedMimes[req.file.mimetype];
    next();
};

// Brute force protection
exports.bruteForceProtection = async (req, res, next) => {
    try {
        const { email } = req.body;
        if (!email) return next();

        const db = require('../services/storage');
        
        // Check failed attempts
        const result = await db.query(
            `SELECT failed_attempts, locked_until FROM users WHERE email = $1`,
            [email]
        );

        if (result.rows.length > 0) {
            const user = result.rows[0];
            
            if (user.locked_until && new Date(user.locked_until) > new Date()) {
                const minutesLeft = Math.ceil((new Date(user.locked_until) - new Date()) / 60000);
                return res.status(429).json({ 
                    error: `Account locked. Try again in ${minutesLeft} minutes.` 
                });
            }

            if (user.failed_attempts >= 10) {
                // Lock account for 30 minutes
                await db.query(
                    `UPDATE users SET locked_until = NOW() + INTERVAL '30 minutes' WHERE email = $1`,
                    [email]
                );
                return res.status(429).json({ error: 'Account locked for 30 minutes due to too many failed attempts.' });
            }
        }

        next();
    } catch (err) {
        console.error('Brute force check error:', err);
        next();
    }
};
