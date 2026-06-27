const express = require('express');
const router = express.Router();
const db = require('../services/storage');
const { verifyToken, checkFeeStatus } = require('../middleware/auth');
const { isStudent } = require('../middleware/rbac');

router.use(verifyToken, isStudent, checkFeeStatus);

// GET student dashboard
router.get('/dashboard', async (req, res) => {
  try {
    const [student] = await Promise.all([
      db.query(`SELECT s.*, u.full_name, u.email, u.phone, u.profile_pic FROM students s JOIN users u ON s.user_id = u.id WHERE s.user_id = $1`, [req.user.id])
    ]);
    if (!student.rows[0]) return res.status(404).json({ error: 'Student not found' });
    res.json(student.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// GET marks
router.get('/marks', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT e.exam_name, e.exam_type, e.subject, m.marks_obtained, m.max_marks, 
             ROUND(m.percentage, 2) as percentage, m.grade, e.exam_date
      FROM marks m JOIN exams e ON m.exam_id = e.id
      WHERE m.student_id = (SELECT id FROM students WHERE user_id = $1)
      ORDER BY e.exam_date DESC
    `, [req.user.id]);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// GET attendance
router.get('/attendance', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT date, status FROM attendance 
      WHERE student_id = (SELECT id FROM students WHERE user_id = $1)
      ORDER BY date DESC LIMIT 60
    `, [req.user.id]);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

module.exports = router;
