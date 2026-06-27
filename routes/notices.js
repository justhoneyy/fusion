const express = require('express');
const router = express.Router();
const db = require('../services/storage');
const { verifyToken } = require('../middleware/auth');
const { isAdmin, isTeacher } = require('../middleware/rbac');

router.use(verifyToken);

// GET notices
router.get('/', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT n.*, u.full_name as created_by_name 
      FROM notices n JOIN users u ON n.created_by = u.id 
      WHERE n.is_active = true 
      ORDER BY n.created_at DESC LIMIT 50
    `);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// POST create notice
router.post('/', isAdmin, async (req, res) => {
  try {
    const { title, content, target_type, target_class, target_section } = req.body;
    await db.query(`
      INSERT INTO notices (title, content, target_type, target_class, target_section, created_by)
      VALUES ($1,$2,$3,$4,$5,$6)
    `, [title, content, target_type || 'all', target_class, target_section, req.user.id]);
    res.json({ message: 'Notice created' });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

module.exports = router;
