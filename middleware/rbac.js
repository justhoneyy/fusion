// Role-Based Access Control Middleware
exports.allowRoles = (...roles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Authentication required.' });
        }

        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ 
                error: 'Access denied. Insufficient permissions.',
                required: roles,
                yourRole: req.user.role
            });
        }

        next();
    };
};

// Specific role checks
exports.isAdmin = (req, res, next) => {
    if (req.user?.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required.' });
    }
    next();
};

exports.isTeacher = (req, res, next) => {
    if (!['teacher', 'admin'].includes(req.user?.role)) {
        return res.status(403).json({ error: 'Teacher or Admin access required.' });
    }
    next();
};

exports.isStudent = (req, res, next) => {
    if (!['student', 'admin'].includes(req.user?.role)) {
        return res.status(403).json({ error: 'Student access required.' });
    }
    next();
};

exports.isParent = (req, res, next) => {
    if (!['parent', 'admin'].includes(req.user?.role)) {
        return res.status(403).json({ error: 'Parent access required.' });
    }
    next();
};

// Check if parent owns this student
exports.checkParentStudent = async (req, res, next) => {
    try {
        if (req.user.role === 'admin') return next();

        const studentId = req.params.studentId || req.body.studentId;
        
        if (req.user.role === 'parent') {
            const result = await db.query(
                `SELECT * FROM student_parents WHERE parent_id = 
                 (SELECT id FROM parents WHERE user_id = $1) AND student_id = $2`,
                [req.user.id, studentId]
            );
            
            if (result.rows.length === 0) {
                return res.status(403).json({ error: 'You can only view your own child\'s data.' });
            }
        }
        
        if (req.user.role === 'student') {
            const result = await db.query(
                `SELECT id FROM students WHERE user_id = $1 AND id = $2`,
                [req.user.id, studentId]
            );
            
            if (result.rows.length === 0) {
                return res.status(403).json({ error: 'You can only view your own data.' });
            }
        }

        next();
    } catch (err) {
        console.error('Parent-student check error:', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
};
