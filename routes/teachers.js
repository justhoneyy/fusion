const express = require('express');
const router = express.Router();
const db = require('../services/storage');
const { verifyToken } = require('../middleware/auth');
const { isTeacher } = require('../middleware/rbac');

router.use(verifyToken, isTeacher);

// GET teacher dashboard data
router.get('/dashboard', async (req, res) => {
  try {
    const teacher = await db.query(`SELECT * FROM teachers WHERE user_id = $1`, [req.user.id]);
    if (teacher.rows.length === 0) return res.status(404).json({ error: 'Teacher not found.' });
    
    const t = teacher.rows[0];
    const classes = t.classes || [];
    const subjects = t.subjects || [];

    const [students, pendingDoubts, todayAtt, upcomingTests] = await Promise.all([
      db.query(`SELECT COUNT(*) FROM students WHERE class = ANY($1)`, [classes]),
      db.query(`SELECT COUNT(*) FROM doubts WHERE is_resolved = false AND subject = ANY($1)`, [subjects]),
      db.query(`SELECT COUNT(*) FROM attendance WHERE date = CURRENT_DATE AND class = ANY($1) AND status = 'present'`, [classes]),
      db.query(`SELECT * FROM online_tests WHERE class = ANY($1) AND start_time > NOW() ORDER BY start_time LIMIT 5`, [classes])
    ]);

    res.json({
      teacher: t,
      studentsCount: students.rows[0].count,
      pendingDoubts: pendingDoubts.rows[0].count,
      todayAttendance: todayAtt.rows[0].count,
      upcomingTests: upcomingTests.rows
    });
  } catch (err) {
    console.error('Teacher dashboard error:', err);
    res.status(500).json({ error: 'Failed to load dashboard.' });
  }
});

// POST mark attendance
router.post('/attendance', async (req, res) => {
  try {
    const { records, date } = req.body;
    if (!records?.length) return res.status(400).json({ error: 'No records.' });
    
    let count = 0;
    for (const r of records) {
      await db.query(`
        INSERT INTO attendance (student_id, class, section, date, status, marked_by)
        VALUES ($1, (SELECT class FROM students WHERE id = $1), (SELECT section FROM students WHERE id = $1), $2, $3, $4)
        ON CONFLICT (student_id, date) DO UPDATE SET status = $3, marked_by = $4
      `, [r.student_id, date || new Date().toISOString().split('T')[0], r.status, req.user.id]);
      count++;
    }
    res.json({ message: `Attendance marked for ${count} students.` });
  } catch (err) {
    console.error('Mark attendance error:', err);
    res.status(500).json({ error: 'Failed.' });
  }
});

module.exports = router;
