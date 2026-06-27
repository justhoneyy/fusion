const express = require('express');
const router = express.Router();
const db = require('../services/storage');
const { verifyToken } = require('../middleware/auth');
const { isTeacher } = require('../middleware/rbac');

router.use(verifyToken);

// GET homework
router.get('/', async (req, res) => {
  try {
    let query, params;
    if (req.user.role === 'student') {
      query = `SELECT h.*, COALESCE(hs.status, 'pending') as submission_status, hs.submitted_at
               FROM homework h LEFT JOIN homework_submissions hs ON h.id = hs.homework_id AND hs.student_id = (SELECT id FROM students WHERE user_id = $1)
               WHERE h.class = (SELECT class FROM students WHERE user_id = $1)
               ORDER BY h.due_date DESC`;
      params = [req.user.id];
    } else {
      query = `SELECT h.*, u.full_name as created_by_name FROM homework h JOIN users u ON h.created_by = u.id ORDER BY h.due_date DESC`;
      params = [];
    }
    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// POST create homework
router.post('/', isTeacher, async (req, res) => {
  try {
    const { title, description, class: cls, section, subject, due_date } = req.body;
    await db.query(`
      INSERT INTO homework (title, description, class, section, subject, due_date, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
    `, [title, description, cls, section, subject, due_date, req.user.id]);
    res.json({ message: 'Homework created' });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

module.exports = router;
