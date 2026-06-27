const express = require('express');
const router = express.Router();
const db = require('../services/storage');
const { verifyToken } = require('../middleware/auth');

router.get('/stats', verifyToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const role = req.user.role;
        let data = {};

        if (role === 'student') {
            const [studentInfo] = await Promise.all([
                db.query(`SELECT s.*, u.full_name, u.email, u.phone, u.profile_pic FROM students s JOIN users u ON s.user_id = u.id WHERE s.user_id = $1`, [userId]),
                db.query(`SELECT COUNT(*) FROM attendance WHERE student_id = (SELECT id FROM students WHERE user_id = $1) AND status = 'present' AND date >= CURRENT_DATE - INTERVAL '30 days'`, [userId]),
                db.query(`SELECT COUNT(*) FROM attendance WHERE student_id = (SELECT id FROM students WHERE user_id = $1) AND date >= CURRENT_DATE - INTERVAL '30 days'`, [userId]),
                db.query(`SELECT AVG(percentage) FROM marks WHERE student_id = (SELECT id FROM students WHERE user_id = $1)`, [userId]),
                db.query(`SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND is_read = false`, [userId]),
                db.query(`SELECT * FROM homework WHERE class = (SELECT class FROM students WHERE user_id = $1) AND due_date >= CURRENT_DATE ORDER BY due_date LIMIT 5`, [userId]),
                db.query(`SELECT * FROM doubts WHERE student_id = (SELECT id FROM students WHERE user_id = $1) AND is_resolved = false`, [userId])
            ]);
            data = { studentInfo: studentInfo.rows[0] };
        } else if (role === 'teacher') {
            const [teacherInfo, studentsCount, pendingDoubts, todayAttendance] = await Promise.all([
                db.query(`SELECT * FROM teachers WHERE user_id = $1`, [userId]),
                db.query(`SELECT COUNT(*) FROM students WHERE class = ANY(SELECT unnest(classes) FROM teachers WHERE user_id = $1)`, [userId]),
                db.query(`SELECT COUNT(*) FROM doubts WHERE is_resolved = false`),
                db.query(`SELECT COUNT(*) FROM attendance WHERE date = CURRENT_DATE AND status = 'present'`)
            ]);
            data = { teacherInfo: teacherInfo.rows[0], studentsCount: studentsCount.rows[0].count, pendingDoubts: pendingDoubts.rows[0].count, todayAttendance: todayAttendance.rows[0].count };
        } else if (role === 'parent') {
            const [parentInfo, children] = await Promise.all([
                db.query(`SELECT * FROM parents WHERE user_id = $1`, [userId]),
                db.query(`SELECT s.id, s.student_id, s.class, s.section, s.roll_number, u.full_name, u.profile_pic,
                          (SELECT AVG(percentage) FROM marks WHERE student_id = s.id) as avg_percentage,
                          (SELECT COUNT(*) FROM attendance WHERE student_id = s.id AND status = 'present' AND date >= CURRENT_DATE - INTERVAL '30 days') as present_days
                          FROM students s JOIN users u ON s.user_id = u.id
                          JOIN student_parents sp ON s.id = sp.student_id
                          WHERE sp.parent_id = (SELECT id FROM parents WHERE user_id = $1)`, [userId])
            ]);
            data = { parentInfo: parentInfo.rows[0], children: children.rows };
        } else if (role === 'admin') {
            const [analytics] = await Promise.all([
                db.query(`SELECT 
                    (SELECT COUNT(*) FROM students) as total_students,
                    (SELECT COUNT(*) FROM teachers) as total_teachers,
                    (SELECT COUNT(*) FROM parents) as total_parents,
                    (SELECT COUNT(*) FROM students s JOIN users u ON s.user_id = u.id WHERE u.is_active = true) as active_students,
                    (SELECT COUNT(*) FROM fees WHERE status = 'pending') as pending_fees,
                    (SELECT COALESCE(SUM(amount), 0) FROM fees WHERE status = 'pending') as pending_fees_amount,
                    (SELECT COUNT(*) FROM doubts WHERE is_resolved = false) as pending_doubts,
                    (SELECT COUNT(*) FROM attendance WHERE date = CURRENT_DATE AND status = 'present') as today_present
                `)
            ]);
            data = { analytics: analytics.rows[0] };
        }

        res.json(data);
    } catch (err) {
        console.error('Dashboard stats error:', err);
        res.status(500).json({ error: 'Failed to load dashboard.' });
    }
});

module.exports = router;
