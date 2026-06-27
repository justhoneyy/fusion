const express = require('express');
const router = express.Router();
const db = require('../services/storage');
const { verifyToken } = require('../middleware/auth');
const { isAdmin, isTeacher, checkParentStudent } = require('../middleware/rbac');

// GET /api/marks/exams - Get exams for a class (for admin dropdown)
router.get('/exams', verifyToken, isAdmin, async (req, res) => {
    try {
        const { class: className, section } = req.query;
        let query = `SELECT * FROM exams WHERE is_active = true`;
        const params = [];

        if (className) {
            params.push(className);
            query += ` AND class = $${params.length}`;
        }
        if (section) {
            params.push
