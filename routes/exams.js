const express = require('express');
const router = express.Router();
const db = require('../services/storage');
const { verifyToken } = require('../middleware/auth');
const { isAdmin, isTeacher } = require('../middleware/rbac');

router.use(verifyToken);

// GET all exams
router.get('/', async (req, res) => {
  try {
    const { class: cls } = req.query;
    let query = `SELECT * FROM exams WHERE 1=1`;
    const params = [];
    if (cls) { params.push(cls); query += ` AND class = $1`; }
    query += ` ORDER BY exam_date DESC`;
    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// POST create exam
router.post('/', isAdmin, async (req, res) => {
  try {
    const { exam_name, exam_type, class: cls, section, subject, max_marks, passing_marks, exam_date } = req.body;
    const result = await db.query(`
      INSERT INTO exams (exam_name, exam_type, class, section, subject, max_marks, passing_marks, exam_date, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id
    `, [exam_name, exam_type, cls, section, subject, max_marks, passing_marks, exam_date, req.user.id]);
    res.json({ message: 'Exam created', id: result.rows[0].id });
  } catch (err) { res.status(500).json({ error: 'Failed to create exam' }); }
});

module.exports = router;
