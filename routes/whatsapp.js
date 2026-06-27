const express = require('express');
const router = express.Router();
const whatsappBot = require('../services/whatsappBot');
const { verifyToken } = require('../middleware/auth');
const { isAdmin } = require('../middleware/rbac');

// POST send custom WhatsApp message (admin only)
router.post('/send', verifyToken, isAdmin, async (req, res) => {
  try {
    const { to, message } = req.body;
    if (!to || !message) return res.status(400).json({ error: 'Phone and message required' });
    const formattedPhone = to.startsWith('+') ? to : '+91' + to.replace(/\D/g, '');
    const result = await whatsappBot.sendWhatsAppText(formattedPhone, message);
    res.json(result);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// GET reminder logs
router.get('/logs', verifyToken, isAdmin, async (req, res) => {
  try {
    const db = require('../services/storage');
    const result = await db.query(`
      SELECT fr.*, u.full_name as student_name FROM fee_reminders fr
      JOIN students s ON fr.student_id = s.id
      JOIN users u ON s.user_id = u.id
      ORDER BY fr.sent_at DESC LIMIT 50
    `);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

module.exports = router;
