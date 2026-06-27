const jwt = require('jsonwebtoken');
const db = require('../services/storage');

// Verify JWT token
exports.verifyToken = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1] || req.cookies?.token;
    
    if (!token) {
        return res.status(401).json({ error: 'Access denied. No token provided.' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token.' });
    }
};

// Single device login check
exports.checkDeviceSession = async (req, res, next) => {
    try {
        const deviceId = req.headers['x-device-id'] || req.body.deviceId;
        const token = req.headers.authorization?.split(' ')[1] || req.cookies?.token;
        
        if (!deviceId || req.user.role !== 'student') {
            return next();
        }

        // Check if there's an active session for this user with a different device
        const result = await db.query(
            `SELECT * FROM sessions WHERE user_id = $1 AND is_active = true AND token != $2`,
            [req.user.id, token]
        );

        if (result.rows.length > 0) {
            // Deactivate old sessions
            await db.query(
                `UPDATE sessions SET is_active = false WHERE user_id = $1 AND token != $2`,
                [req.user.id, token]
            );
            
            // Log the old session out
            return res.status(409).json({ 
                error: 'New device login detected. Previous session terminated.',
                code: 'NEW_DEVICE_LOGIN'
            });
        }

        // Update current session activity
        await db.query(
            `UPDATE sessions SET last_activity = NOW() WHERE user_id = $1 AND token = $2`,
            [req.user.id, token]
        );

        next();
    } catch (err) {
        console.error('Device session check error:', err);
        next();
    }
};

// Check if student fee is locked
exports.checkFeeStatus = async (req, res, next) => {
    try {
        if (req.user.role !== 'student') return next();

        const result = await db.query(
            `SELECT is_locked, lock_reason FROM users WHERE id = $1`,
            [req.user.id]
        );

        if (result.rows.length > 0 && result.rows[0].is_locked) {
            // Allow only fee payment page access
            if (!req.path.includes('/fees') && !req.path.includes('/payment')) {
                return res.status(403).json({ 
                    error: 'Account locked due to pending fees. Please pay your fees.',
                    code: 'FEE_LOCKED',
                    redirect: '/dashboard-student.html?page=fees'
                });
            }
        }

        next();
    } catch (err) {
        console.error('Fee status check error:', err);
        next();
    }
};

// Session management - create session
exports.createSession = async (userId, token, deviceInfo, ip, userAgent) => {
    try {
        // Deactivate all previous sessions for this user
        await db.query(
            `UPDATE sessions SET is_active = false WHERE user_id = $1`,
            [userId]
        );

        // Create new session
        await db.query(
            `INSERT INTO sessions (user_id, token, device_id, device_info, ip_address, user_agent, expiry_time)
             VALUES ($1, $2, $3, $4, $5, $6, NOW() + INTERVAL '7 days')`,
            [userId, token, deviceInfo?.deviceId, JSON.stringify(deviceInfo), ip, userAgent]
        );

        // Update student device info
        if (deviceInfo) {
            await db.query(
                `UPDATE students SET current_device_id = $1, current_device_info = $2, last_device_activity = NOW()
                 WHERE user_id = $3`,
                [deviceInfo.deviceId, JSON.stringify(deviceInfo), userId]
            );
        }
    } catch (err) {
        console.error('Session creation error:', err);
    }
};

// Logout - destroy session
exports.destroySession = async (token) => {
    try {
        await db.query(
            `UPDATE sessions SET is_active = false WHERE token = $1`,
            [token]
        );
    } catch (err) {
        console.error('Session destroy error:', err);
    }
};
