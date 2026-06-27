const express = require('express');
const router = express.Router();
const db = require('../services/storage');
const { verifyToken } = require('../middleware/auth');
const { isParent } = require('../middleware/rbac');

router.use(verifyToken, isParent);

// GET children data with marks
router.get('/children', async (req, res) => {
  try {
    const parent = await db.query(`SELECT id FROM parents WHERE user_id = $1`, [req.user.id]);
    if (parent.rows.length === 0) return res.status(404).json({ error: 'Parent not found.' });

    const children = await db.query(`
      SELECT s.id, s.student_id, s.class, s.section, s.roll_number, u.full_name, u.email, u.profile_pic,
        (SELECT json_agg(json_build_object(
          'exam_name', e.exam_name, 'exam_type', e.exam_type,
          'subject', m.subject, 'marks_obtained', m.marks_obtained,
          'max_marks', m.max_marks, 'percentage', m.percentage,
          'grade', m.grade, 'exam_date', e.exam_date
        ) ORDER BY e.exam_date DESC)
        FROM marks m JOIN exams e ON m.exam_id = e.id WHERE m.student_id = s.id
        ) as marks,
        (SELECT json_agg(json_build_object('date', a.date, 'status', a.status) ORDER BY a.date DESC LIMIT 30)
        FROM attendance a WHERE a.student_id = s.id
        ) as attendance,
        (SELECT AVG(percentage) FROM marks WHERE student_id = s.id) as avg_percentage,
        (SELECT COUNT(*) FROM attendance WHERE student_id = s.id AND status = 'present' AND date >= CURRENT_DATE - INTERVAL '30 days') as present_days
      FROM students s
      JOIN users u ON s.user_id = u.id
      JOIN student_parents sp ON s.id = sp.student_id
      WHERE sp.parent_id = $1
    `, [parent.rows[0].id]);

    res.json(children.rows);
  } catch (err) {
    console.error('Get children error:', err);
    res.status(500).json({ error: 'Failed.' });
  }
});

// GET specific child performance data
router.get('/children/:studentId/performance', async (req, res) => {
  try {
    const parent = await db.query(`SELECT id FROM parents WHERE user_id = $1`, [req.user.id]);
    if (parent.rows.length === 0) return res.status(403).json({ error: 'Unauthorized.' });

    // Verify relationship
    const rel = await db.query(
      `SELECT id FROM student_parents WHERE parent_id = $1 AND student_id = $2`,
      [parent.rows[0].id, req.params.studentId]
    );
    if (rel.rows.length === 0) return res.status(403).json({ error: 'Not your child.' });

    const [marks, attendance, homework, fees] = await Promise.all([
      db.query(`SELECT e.exam_name, e.subject, m.marks_obtained, m.max_marks, m.percentage, m.grade, e.exam_date
        FROM marks m JOIN exams e ON m.exam_id = e.id WHERE m.student_id = $1 ORDER BY e.exam_date`, [req.params.studentId]),
      db.query(`SELECT date, status FROM attendance WHERE student_id = $1 ORDER BY date DESC LIMIT 30`, [req.params.studentId]),
      db.query(`SELECT h.title, h.subject, h.due_date, hs.status, hs.submitted_at
        FROM homework h LEFT JOIN homework_submissions hs ON h.id = hs.homework_id AND hs.student_id = $1
        WHERE h.class = (SELECT class FROM students WHERE id = $1) ORDER BY h.due_date DESC LIMIT 10`, [req.params.studentId]),
      db.query(`SELECT * FROM fees WHERE student_id = $1 ORDER BY due_date DESC`, [req.params.studentId])
    ]);

    res.json({ marks: marks.rows, attendance: attendance.rows, homework: homework.rows, fees: fees.rows });
  } catch (err) {
    console.error('Child performance error:', err);
    res.status(500).json({ error: 'Failed.' });
  }
});

module.exports = router;
