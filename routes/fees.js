const express = require('express');
const router = express.Router();
const db = require('../services/storage');
const { verifyToken } = require('../middleware/auth');
const { isAdmin, isStudent } = require('../middleware/rbac');

router.get('/', verifyToken, async (req, res) => {
    try {
        let query, params;
        if (req.user.role === 'student') {
            query = `SELECT f.* FROM fees f JOIN students s ON f.student_id = s.id WHERE s.user_id = $1 ORDER BY f.due_date DESC`;
            params = [req.user.id];
        } else if (req.user.role === 'parent') {
            query = `SELECT f.*, u.full_name as student_name FROM fees f 
                     JOIN students s ON f.student_id = s.id
                     JOIN student_parents sp ON s.id = sp.student_id
                     JOIN users u ON s.user_id = u.id
                     WHERE sp.parent_id = (SELECT id FROM parents WHERE user_id = $1)
                     ORDER BY f.due_date DESC`;
            params = [req.user.id];
        } else {
            const { status, class: className, page = 1, limit = 50 } = req.query;
            query = `SELECT f.*, u.full_name as student_name, s.student_id, s.class, s.section
                     FROM fees f JOIN students s ON f.student_id = s.id
                     JOIN users u ON s.user_id = u.id WHERE 1=1`;
            params = [];
            if (status) { params.push(status); query += ` AND f.status = $${params.length}`; }
            if (className) { params.push(className); query += ` AND s.class = $${params.length}`; }
            query += ` ORDER BY f.due_date DESC`;
        }
        const result = await db.query(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error('Get fees error:', err);
        res.status(500).json({ error: 'Failed to fetch fees.' });
    }
});

// POST mark as paid (admin only)
router.post('/pay', verifyToken, isAdmin, async (req, res) => {
    try {
        const { fee_id, payment_method, payment_reference, discount_amount, fine_amount, remarks } = req.body;
        const result = await db.query(`
            UPDATE fees SET status = 'paid', paid_date = CURRENT_DATE, 
            payment_method = $2, payment_reference = $3,
            discount_amount = COALESCE($4, 0), fine_amount = COALESCE($5, 0),
            remarks = $6, receipt_number = 'RCP-' || to_char(NOW(), 'YYYYMMDD-HH24MISS')
            WHERE id = $1 RETURNING *
        `, [fee_id, payment_method, payment_reference, discount_amount, fine_amount, remarks]);
        
        // Update student fee status
        await db.query(`UPDATE students SET fee_status = 'paid' WHERE id = (SELECT student_id FROM fees WHERE id = $1)`, [fee_id]);

        res.json({ message: 'Fee marked as paid.', receipt: result.rows[0] });
    } catch (err) {
        console.error('Pay fee error:', err);
        res.status(500).json({ error: 'Failed to process payment.' });
    }
});

module.exports = router;
