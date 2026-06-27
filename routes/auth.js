const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../services/storage');
const { verifyToken, createSession, destroySession } = require('../middleware/auth');
const { loginLimiter, bruteForceProtection } = require('../middleware/security');

// POST /api/auth/login
router.post('/login', loginLimiter, bruteForceProtection, async (req, res) => {
    try {
        const { email, password, role, deviceInfo, rememberMe } = req.body;

        if (!email || !password || !role) {
            return res.status(400).json({ error: 'Email, password, and role are required.' });
        }

        // Get user
        const result = await db.query(
            `SELECT id, user_id, email, password_hash, role, full_name, is_active, is_locked, lock_reason, 
                    failed_attempts, profile_pic, phone
             FROM users WHERE email = $1 AND role = $2`,
            [email, role]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid email, password, or role.' });
        }

        const user = result.rows[0];

        // Check if locked
        if (user.is_locked) {
            return res.status(403).json({ 
                error: user.lock_reason || 'Account is locked. Please contact admin.',
                code: 'ACCOUNT_LOCKED'
            });
        }

        // Check if active
        if (!user.is_active) {
            return res.status(403).json({ error: 'Account is deactivated. Contact admin.' });
        }

        // Verify password
        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) {
            // Increment failed attempts
            await db.query(
                `UPDATE users SET failed_attempts = failed_attempts + 1 WHERE id = $1`,
                [user.id]
            );
            
            // Log failed attempt
            await db.query(
                `INSERT INTO login_history (user_id, login_type, ip_address, user_agent, device_info)
                 VALUES ($1, 'failed', $2, $3, $4)`,
                [user.id, req.ip, req.headers['user-agent'], JSON.stringify(deviceInfo)]
            );

            return res.status(401).json({ error: 'Invalid email or password.' });
        }

        // Reset failed attempts
        await db.query(
            `UPDATE users SET failed_attempts = 0, locked_until = NULL, 
             last_login = NOW(), last_login_ip = $1 WHERE id = $2`,
            [req.ip, user.id]
        );

        // Generate JWT
        const tokenPayload = {
            id: user.id,
            userId: user.user_id,
            email: user.email,
            role: user.role,
            name: user.full_name,
            profilePic: user.profile_pic,
            phone: user.phone
        };

        const token = jwt.sign(
            tokenPayload,
            process.env.JWT_SECRET,
            { expiresIn: rememberMe ? '30d' : (process.env.JWT_EXPIRES_IN || '7d') }
        );

        // Create session for device tracking
        await createSession(user.id, token, deviceInfo, req.ip, req.headers['user-agent']);

        // Log successful login
        await db.query(
            `INSERT INTO login_history (user_id, login_type, ip_address, user_agent, device_info)
             VALUES ($1, 'success', $2, $3, $4)`,
            [user.id, req.ip, req.headers['user-agent'], JSON.stringify(deviceInfo)]
        );

        // Set cookie
        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: rememberMe ? 30 * 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000
        });

        // Return CSRF token
        res.json({
            token,
            user: tokenPayload,
            csrfToken: res.locals.csrfToken,
            redirect: getDashboardUrl(user.role)
        });

    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Login failed. Please try again.' });
    }
});

// POST /api/auth/logout
router.post('/logout', verifyToken, async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1] || req.cookies?.token;
        
        await destroySession(token);
        
        await db.query(
            `INSERT INTO audit_logs (user_id, action, resource_type, details, ip_address)
             VALUES ($1, 'logout', 'auth', $2, $3)`,
            [req.user.id, JSON.stringify({ method: 'manual' }), req.ip]
        );

        res.clearCookie('token');
        res.json({ message: 'Logged out successfully.' });
    } catch (err) {
        console.error('Logout error:', err);
        res.status(500).json({ error: 'Logout failed.' });
    }
});

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
    try {
        const { email, role } = req.body;
        
        const result = await db.query(
            `SELECT id, full_name FROM users WHERE email = $1 AND role = $2 AND is_active = true`,
            [email, role]
        );

        // Always return success to prevent email enumeration
        if (result.rows.length > 0) {
            // In production, send actual email here
            console.log(`Password reset requested for: ${email}`);
            
            await db.query(
                `INSERT INTO audit_logs (user_id, action, resource_type, details, ip_address)
                 VALUES ($1, 'password_reset_request', 'auth', $2, $3)`,
                [result.rows[0].id, JSON.stringify({ email }), req.ip]
            );
        }

        res.json({ 
            message: 'If an account exists with this email, you will receive password reset instructions.' 
        });
    } catch (err) {
        console.error('Forgot password error:', err);
        res.status(500).json({ error: 'Failed to process request.' });
    }
});

// GET /api/auth/me - Get current user
router.get('/me', verifyToken, async (req, res) => {
    try {
        const result = await db.query(
            `SELECT id, user_id, email, role, full_name, phone, profile_pic, is_active, 
                    is_locked, lock_reason, last_login, created_at
             FROM users WHERE id = $1`,
            [req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found.' });
        }

        let additionalData = {};
        const user = result.rows[0];

        if (user.role === 'student') {
            const studentData = await db.query(
                `SELECT * FROM students WHERE user_id = $1`,
                [user.id]
            );
            if (studentData.rows.length > 0) {
                additionalData = studentData.rows[0];
            }
        } else if (user.role === 'teacher') {
            const teacherData = await db.query(
                `SELECT * FROM teachers WHERE user_id = $1`,
                [user.id]
            );
            if (teacherData.rows.length > 0) {
                additionalData = teacherData.rows[0];
            }
        } else if (user.role === 'parent') {
            const parentData = await db.query(
                `SELECT * FROM parents WHERE user_id = $1`,
                [user.id]
            );
            if (parentData.rows.length > 0) {
                additionalData = parentData.rows[0];
                // Get children
                const children = await db.query(
                    `SELECT s.student_id, s.class, s.section, s.roll_number, u.full_name
                     FROM students s
                     JOIN student_parents sp ON s.id = sp.student_id
                     JOIN users u ON s.user_id = u.id
                     WHERE sp.parent_id = $1`,
                    [parentData.rows[0].id]
                );
                additionalData.children = children.rows;
            }
        }

        res.json({ user, ...additionalData });
    } catch (err) {
        console.error('Get user error:', err);
        res.status(500).json({ error: 'Failed to get user data.' });
    }
});

function getDashboardUrl(role) {
    const urls = {
        'student': '/dashboard-student.html',
        'teacher': '/dashboard-teacher.html',
        'parent': '/dashboard-parent.html',
        'admin': '/dashboard-admin.html'
    };
    return urls[role] || '/';
}

module.exports = router;
