const express = require('express');
const router = express.Router();
const db = require('../services/storage');
const { verifyToken } = require('../middleware/auth');
const { isAdmin, isTeacher } = require('../middleware/rbac');

router.post('/mark', verifyToken, isTeacher, async (req, res) => {
    try {
        const { date, records } = req.body; // records = [{student_id, status, remarks}, ...]
        if (!records?.length) return res.status(400).json({ error: 'No attendance records.' });

        let count = 0;
        for (const record of records) {
            await db.query(`
                INSERT INTO attendance (student_id, class, section, date, status, marked_by, remarks)
                VALUES ($1, (SELECT class FROM students WHERE id = $1), (SELECT section FROM students WHERE id = $1), $2, $3, $4, $5)
                ON CONFLICT (student_id, date) DO UPDATE SET status = $3, marked_by = $4, remarks = $5
            `, [record.student_id, date || new Date(), record.status, req.user.id, record.remarks || null]);
            count++;
        }

        res.json({ message: `Attendance marked for ${count} students.` });
    } catch (err) {
        console.error('Mark attendance error:', err);
        res.status(500).json({ error: 'Failed to mark attendance.' });
    }
});

router.get('/:studentId', verifyToken, async (req, res) => {
    try {
        const { month, year } = req.query;
        const targetMonth = month || new Date().getMonth() + 1;
        const targetYear = year || new Date().getFullYear();

        const result = await db.query(`
            SELECT date, status, remarks FROM attendance 
            WHERE student_id = $1 
            AND EXTRACT(MONTH FROM date) = $2 
            AND EXTRACT(YEAR FROM date) = $3
            ORDER BY date
        `, [req.params.studentId, targetMonth, targetYear]);
        
        const stats = await db.query(`
            SELECT status, COUNT(*) as count FROM attendance 
            WHERE student_id = $1 
            AND EXTRACT(MONTH FROM date) = $2 
            AND EXTRACT(YEAR FROM date) = $3
            GROUP BY status
        `, [req.params.studentId, targetMonth, targetYear]);

        res.json({ attendance: result.rows, stats: stats.rows });
    } catch (err) {
        console.error('Get attendance error:', err);
        res.status(500).json({ error: 'Failed to fetch attendance.' });
    }
});

module.exports = router;
