const express = require('express');
const router = express.Router();
const db = require('../services/storage');
const { verifyToken } = require('../middleware/auth');

router.use(verifyToken);

// POST ask doubt (student)
router.post('/', async (req, res) => {
  try {
    if (req.user.role !== 'student') return res.status(403).json({ error: 'Only students can ask doubts' });
    const { subject, question_text, image_url } = req.body;
    await db.query(`
      INSERT INTO doubts (student_id, subject, question_text, image_url)
      VALUES ((SELECT id FROM students WHERE user_id = $1), $2, $3, $4)
    `, [req.user.id, subject, question_text, image_url]);
    res.json({ message: 'Doubt submitted' });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// GET doubts
router.get('/', async (req, res) => {
  try {
    let query, params;
    if (req.user.role === 'student') {
      query = `SELECT d.*, u.full_name as teacher_name FROM doubts d LEFT JOIN users u ON d.resolved_by = u.id WHERE d.student_id = (SELECT id FROM students WHERE user_id = $1) ORDER BY d.created_at DESC`;
      params = [req.user.id];
    } else if (req.user.role === 'teacher') {
      query = `SELECT d.*, u.full_name as student_name FROM doubts d JOIN users u ON u.id = (SELECT user_id FROM students WHERE id = d.student_id) WHERE d.is_resolved = false ORDER BY d.created_at DESC`;
      params = [];
    } else {
      query = `SELECT d.*, u1.full_name as student_name, u2.full_name as teacher_name FROM doubts d JOIN users u1 ON u1.id = (SELECT user_id FROM students WHERE id = d.student_id) LEFT JOIN users u2 ON d.resolved_by = u2.id ORDER BY d.created_at DESC LIMIT 50`;
      params = [];
    }
    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// POST reply to doubt
router.post('/:id/reply', async (req, res) => {
  try {
    const { answer_text } = req.body;
    await db.query(`UPDATE doubts SET answer_text = $1, is_resolved = true, resolved_by = $2, answered_at = NOW() WHERE id = $3`,
      [answer_text, req.user.id, req.params.id]);
    res.json({ message: 'Reply sent' });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

module.exports = router;
