const express = require('express');
const router = express.Router();
const db = require('../services/storage');
const { verifyToken } = require('../middleware/auth');
const { isAdmin, isTeacher } = require('../middleware/rbac');

// GET /api/marks/students/:class - Get all students in a class (for bulk marks entry)
router.get('/students/:class', verifyToken, isAdmin, async (req, res) => {
    try {
        const { class: className } = req.params;
        const { section, exam_id } = req.query;

        let query = `
            SELECT s.id, s.student_id, s.roll_number, s.class, s.section, u.full_name,
                   COALESCE(m.marks_obtained, NULL) as marks_obtained,
                   COALESCE(m.max_marks, NULL) as max_marks,
                   COALESCE(m.grade, NULL) as grade,
                   COALESCE(m.remarks, '') as remarks,
                   m.id as mark_id
            FROM students s
            JOIN users u ON s.user_id = u.id
            LEFT JOIN marks m ON m.student_id = s.id AND m.exam_id = $3
            WHERE s.class = $1
        `;
        const params = [className];

        if (section) {
            params.push(section);
            query += ` AND s.section = $${params.length}`;
        }
        
        params.push(exam_id || 'none');
        query += ` ORDER BY s.roll_number ASC`;

        const result = await db.query(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error('Get students for marks error:', err);
        res.status(500).json({ error: 'Failed to fetch students.' });
    }
});

// POST /api/marks/bulk - Bulk add/update marks (ONE SLIDE - all students at once)
router.post('/bulk', verifyToken, isAdmin, async (req, res) => {
    const client = await db.query('BEGIN'); // We won't actually use this transaction pattern here
    try {
        const { exam_id, subject, max_marks, marks_data } = req.body;
        // marks_data = [{student_id, marks_obtained, grade, remarks}, ...]

        if (!exam_id || !subject || !max_marks || !marks_data?.length) {
            return res.status(400).json({ error: 'Missing required fields.' });
        }

        const results = [];
        for (const entry of marks_data) {
            // Upsert: insert or update
            const result = await db.query(`
                INSERT INTO marks (student_id, exam_id, subject, marks_obtained, max_marks, grade, remarks, entered_by)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                ON CONFLICT (student_id, exam_id, subject) 
                DO UPDATE SET marks_obtained = $4, max_marks = $5, grade = $6, remarks = $7, entered_by = $8
                RETURNING id, student_id, marks_obtained, grade
            `, [entry.student_id, exam_id, subject, entry.marks_obtained, max_marks, entry.grade || null, entry.remarks || null, req.user.id]);

            results.push(result.rows[0]);
        }

        // Log audit
        await db.query(`
            INSERT INTO audit_logs (user_id, action, resource_type, resource_id, details, ip_address)
            VALUES ($1, 'bulk_marks_entry', 'marks', $2, $3, $4)
        `, [req.user.id, exam_id, JSON.stringify({ subject, count: marks_data.length }), req.ip]);

        res.json({ message: `Marks saved for ${results.length} students.`, results });
    } catch (err) {
        console.error('Bulk marks error:', err);
        res.status(500).json({ error: 'Failed to save marks.' });
    }
});

// GET /api/marks/student/:studentId - Get marks for a specific student
router.get('/student/:studentId', verifyToken, async (req, res) => {
    try {
        const result = await db.query(`
            SELECT e.exam_name, e.exam_type, e.subject, m.marks_obtained, m.max_marks, 
                   m.percentage, m.grade, m.remarks, e.exam_date
            FROM marks m
            JOIN exams e ON m.exam_id = e.id
            WHERE m.student_id = $1
            ORDER BY e.exam_date DESC, e.exam_name, m.subject
        `, [req.params.studentId]);

        res.json(result.rows);
    } catch (err) {
        console.error('Get student marks error:', err);
        res.status(500).json({ error: 'Failed to fetch marks.' });
    }
});

module.exports = router;
