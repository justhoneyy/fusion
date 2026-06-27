const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../services/storage');
const { verifyToken } = require('../middleware/auth');
const { isAdmin } = require('../middleware/rbac');

// All routes require admin role
router.use(verifyToken, isAdmin);

// === STUDENT MANAGEMENT ===

// GET all students
router.get('/students', async (req, res) => {
    try {
        const { class: className, section, status, search, page = 1, limit = 50 } = req.query;
        let query = `
            SELECT s.*, u.full_name, u.email, u.phone, u.is_active, u.is_locked, u.profile_pic
            FROM students s JOIN users u ON s.user_id = u.id WHERE 1=1`;
        const params = [];
        let countQuery = `SELECT COUNT(*) FROM students s JOIN users u ON s.user_id = u.id WHERE 1=1`;

        if (className) { params.push(className); query += ` AND s.class = $${params.length}`; countQuery += ` AND s.class = '${className}'`; }
        if (section) { params.push(section); query += ` AND s.section = $${params.length}`; countQuery += ` AND s.section = '${section}'`; }
        if (status) { params.push(status); query += ` AND u.is_active = $${params.length}`; countQuery += ` AND u.is_active = ${status === 'active'}`; }
        if (search) { params.push(`%${search}%`); query += ` AND (u.full_name ILIKE $${params.length} OR s.student_id ILIKE $${params.length})`; countQuery += ` AND (u.full_name ILIKE '%${search}%' OR s.student_id ILIKE '%${search}%')`; }

        const offset = (page - 1) * limit;
        params.push(limit); query += ` ORDER BY s.class, s.roll_number LIMIT $${params.length}`;
        params.push(offset); query += ` OFFSET $${params.length}`;

        const [students, countResult] = await Promise.all([
            db.query(query, params),
            db.query(countQuery)
        ]);

        res.json({
            students: students.rows,
            total: parseInt(countResult.rows[0].count),
            page: parseInt(page),
            totalPages: Math.ceil(parseInt(countResult.rows[0].count) / limit)
        });
    } catch (err) {
        console.error('Get students error:', err);
        res.status(500).json({ error: 'Failed to fetch students.' });
    }
});

// POST add student
router.post('/students', async (req, res) => {
    try {
        const { full_name, email, phone, password, class: className, section, roll_number, 
                father_name, mother_name, father_phone, mother_phone, date_of_birth, 
                address, gender, fee_amount } = req.body;

        if (!full_name || !email || !password || !className) {
            return res.status(400).json({ error: 'Name, email, password, and class are required.' });
        }

        const password_hash = await bcrypt.hash(password, 10);
        const student_id = `STU-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 9999)).padStart(4, '0')}`;
        const admission_no = `ADM-${Date.now()}`;

        const result = await db.transaction(async (client) => {
            // Create user
            const user = await client.query(
                `INSERT INTO users (user_id, email, password_hash, role, full_name, phone, is_active)
                 VALUES ($1, $2, $3, 'student', $4, $5, true) RETURNING id`,
                [student_id, email, password_hash, full_name, phone]
            );

            // Create student
            const student = await client.query(
                `INSERT INTO students (user_id, student_id, admission_number, class, section, roll_number,
                    date_of_birth, gender, address, father_name, mother_name, father_phone, mother_phone,
                    fee_amount, admission_date)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, CURRENT_DATE)
                 RETURNING id`,
                [user.rows[0].id, student_id, admission_no, className, section, roll_number,
                 date_of_birth, gender, address, father_name, mother_name, father_phone, mother_phone,
                 fee_amount || 0]
            );

            return { user_id: user.rows[0].id, student_id: student.rows[0].id, student_code: student_id };
        });

        await db.query(
            `INSERT INTO audit_logs (user_id, action, resource_type, resource_id, details, ip_address)
             VALUES ($1, 'add_student', 'student', $2, $3, $4)`,
            [req.user.id, result.student_code, JSON.stringify({ name: full_name, class: className }), req.ip]
        );

        res.json({ message: 'Student added successfully.', ...result });
    } catch (err) {
        console.error('Add student error:', err);
        if (err.constraint === 'users_email_key') {
            return res.status(400).json({ error: 'Email already exists.' });
        }
        res.status(500).json({ error: 'Failed to add student.' });
    }
});

// PUT edit student
router.put('/students/:id', async (req, res) => {
    try {
        const { full_name, phone, class: className, section, roll_number, fee_amount, is_active } = req.body;
        
        await db.transaction(async (client) => {
            if (full_name || phone) {
                await client.query(
                    `UPDATE users SET full_name = COALESCE($1, full_name), phone = COALESCE($2, phone), 
                     is_active = COALESCE($3, is_active) WHERE id = (SELECT user_id FROM students WHERE id = $4)`,
                    [full_name, phone, is_active, req.params.id]
                );
            }
            
            await client.query(
                `UPDATE students SET class = COALESCE($1, class), section = COALESCE($2, section),
                 roll_number = COALESCE($3, roll_number), fee_amount = COALESCE($4, fee_amount)
                 WHERE id = $5`,
                [className, section, roll_number, fee_amount, req.params.id]
            );
        });

        res.json({ message: 'Student updated successfully.' });
    } catch (err) {
        console.error('Update student error:', err);
        res.status(500).json({ error: 'Failed to update student.' });
    }
});

// DELETE student
router.delete('/students/:id', async (req, res) => {
    try {
        const student = await db.query(`SELECT user_id FROM students WHERE id = $1`, [req.params.id]);
        if (student.rows.length === 0) return res.status(404).json({ error: 'Student not found.' });

        await db.query(`UPDATE users SET is_active = false WHERE id = $1`, [student.rows[0].user_id]);

        res.json({ message: 'Student deactivated successfully.' });
    } catch (err) {
        console.error('Delete student error:', err);
        res.status(500).json({ error: 'Failed to deactivate student.' });
    }
});

// POST promote students
router.post('/students/promote', async (req, res) => {
    try {
        const { student_ids, to_class, to_section } = req.body;
        if (!student_ids?.length || !to_class) {
            return res.status(400).json({ error: 'Student IDs and target class required.' });
        }

        await db.query(
            `UPDATE students SET class = $1, section = COALESCE($2, section) WHERE id = ANY($3::uuid[])`,
            [to_class, to_section, student_ids]
        );

        res.json({ message: `${student_ids.length} students promoted to ${to_class}.` });
    } catch (err) {
        console.error('Promote students error:', err);
        res.status(500).json({ error: 'Failed to promote students.' });
    }
});

// === TEACHER MANAGEMENT ===
router.get('/teachers', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT t.*, u.full_name, u.email, u.phone, u.is_active, u.profile_pic
            FROM teachers t JOIN users u ON t.user_id = u.id ORDER BY u.full_name
        `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch teachers.' });
    }
});

router.post('/teachers', async (req, res) => {
    try {
        const { full_name, email, phone, password, qualification, specialization, subjects, classes, experience_years } = req.body;
        const password_hash = await bcrypt.hash(password, 10);
        const teacher_id = `TCH-${String(Math.floor(Math.random() * 999)).padStart(3, '0')}`;

        await db.transaction(async (client) => {
            const user = await client.query(
                `INSERT INTO users (user_id, email, password_hash, role, full_name, phone, is_active)
                 VALUES ($1, $2, $3, 'teacher', $4, $5, true) RETURNING id`,
                [teacher_id, email, password_hash, full_name, phone]
            );
            await client.query(
                `INSERT INTO teachers (user_id, teacher_id, qualification, specialization, subjects, classes, experience_years, joining_date)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_DATE)`,
                [user.rows[0].id, teacher_id, qualification, specialization, subjects, classes, experience_years]
            );
        });

        res.json({ message: 'Teacher added successfully.', teacher_id });
    } catch (err) {
        console.error('Add teacher error:', err);
        res.status(500).json({ error: 'Failed to add teacher.' });
    }
});

// === DASHBOARD ANALYTICS ===
router.get('/analytics', async (req, res) => {
    try {
        const [
            totalStudents, totalTeachers, totalParents,
            activeStudents, pendingFees, overdueFees,
            todayAttendance, monthlyAdmissions
        ] = await Promise.all([
            db.query(`SELECT COUNT(*) FROM students`),
            db.query(`SELECT COUNT(*) FROM teachers`),
            db.query(`SELECT COUNT(*) FROM parents`),
            db.query(`SELECT COUNT(*) FROM students s JOIN users u ON s.user_id = u.id WHERE u.is_active = true`),
            db.query(`SELECT COUNT(*), COALESCE(SUM(amount), 0) as total FROM fees WHERE status = 'pending'`),
            db.query(`SELECT COUNT(*), COALESCE(SUM(amount), 0) as total FROM fees WHERE status = 'overdue'`),
            db.query(`SELECT status, COUNT(*) FROM attendance WHERE date = CURRENT_DATE GROUP BY status`),
            db.query(`SELECT DATE_TRUNC('month', admission_date) as month, COUNT(*) 
                       FROM students WHERE admission_date >= NOW() - INTERVAL '12 months'
                       GROUP BY month ORDER BY month`)
        ]);

        res.json({
            totalStudents: totalStudents.rows[0].count,
            totalTeachers: totalTeachers.rows[0].count,
            totalParents: totalParents.rows[0].count,
            activeStudents: activeStudents.rows[0].count,
            pendingFees: { count: pendingFees.rows[0].count, total: pendingFees.rows[0].total },
            overdueFees: { count: overdueFees.rows[0].count, total: overdueFees.rows[0].total },
            todayAttendance: todayAttendance.rows,
            monthlyAdmissions: monthlyAdmissions.rows
        });
    } catch (err) {
        console.error('Analytics error:', err);
        res.status(500).json({ error: 'Failed to fetch analytics.' });
    }
});

module.exports = router;
