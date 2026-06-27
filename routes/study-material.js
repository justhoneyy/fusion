const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const db = require('../services/storage');
const { verifyToken } = require('../middleware/auth');
const { isTeacher, isAdmin } = require('../middleware/rbac');
const { validateFileUpload } = require('../middleware/security');

const storage = multer.diskStorage({
  destination: './uploads/',
  filename: (req, file, cb) => {
    const unique = crypto.randomBytes(16).toString('hex');
    cb(null, unique + path.extname(file.originalname));
  }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// POST upload material
router.post('/upload', verifyToken, isTeacher, upload.single('file'), validateFileUpload, async (req, res) => {
  try {
    const { title, description, class: cls, section, subject, is_downloadable } = req.body;
    const token = crypto.randomBytes(32).toString('hex');
    
    await db.query(`
      INSERT INTO study_materials (title, description, file_type, file_path, file_size, class, section, subject, uploaded_by, is_downloadable, access_token)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    `, [title, description, req.fileType || 'other', req.file.path, req.file.size, cls, section, subject, req.user.id, is_downloadable === 'true', token]);

    res.json({ message: 'Uploaded successfully', token });
  } catch (err) { res.status(500).json({ error: 'Upload failed' }); }
});

// GET materials
router.get('/', verifyToken, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT id, title, description, file_type, class, section, subject, created_at,
             u.full_name as uploaded_by_name
      FROM study_materials sm JOIN users u ON sm.uploaded_by = u.id
      WHERE sm.is_active = true ORDER BY sm.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// GET download with token protection
router.get('/download/:token', verifyToken, async (req, res) => {
  try {
    const result = await db.query(`SELECT * FROM study_materials WHERE access_token = $1 AND is_active = true`, [req.params.token]);
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    const file = result.rows[0];
    if (!file.is_downloadable && req.user.role !== 'admin') return res.status(403).json({ error: 'Download not allowed' });
    res.download(file.file_path, file.title + path.extname(file.file_path));
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

module.exports = router;
