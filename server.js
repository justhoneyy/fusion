require('dotenv').config();
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const cors = require('cors');
const { securityHeaders, apiLimiter, generateCsrfToken } = require('./middleware/security');
const db = require('./services/storage');
const feeCron = require('./services/feeCron');

const app = express();
const PORT = process.env.PORT || 3000;

// ========== MIDDLEWARE ==========
app.use(securityHeaders);
app.use(cors({
    origin: process.env.NODE_ENV === 'production' ? 'https://fusioncoaching.in' : '*',
    credentials: true
}));
app.use(morgan('combined'));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());
app.use(generateCsrfToken);

// Static files
app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0,
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache');
        }
    }
}));

// Uploads directory
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ========== API ROUTES ==========
const authRoutes = require('./routes/auth');
const studentRoutes = require('./routes/students');
const teacherRoutes = require('./routes/teachers');
const parentRoutes = require('./routes/parents');
const adminRoutes = require('./routes/admin');
const marksRoutes = require('./routes/marks');
const attendanceRoutes = require('./routes/attendance');
const feesRoutes = require('./routes/fees');
const examsRoutes = require('./routes/exams');
const studyMaterialRoutes = require('./routes/study-material');
const doubtsRoutes = require('./routes/doubts');
const noticesRoutes = require('./routes/notices');
const homeworkRoutes = require('./routes/homework');
const dashboardRoutes = require('./routes/dashboard');
const whatsappRoutes = require('./routes/whatsapp');

// API routes
app.use('/api/auth', apiLimiter, authRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/teachers', teacherRoutes);
app.use('/api/parents', parentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/marks', marksRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/fees', feesRoutes);
app.use('/api/exams', examsRoutes);
app.use('/api/study-material', studyMaterialRoutes);
app.use('/api/doubts', doubtsRoutes);
app.use('/api/notices', noticesRoutes);
app.use('/api/homework', homeworkRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/whatsapp', whatsappRoutes);

// ========== SPA FALLBACK ==========
app.get('*', (req, res) => {
    // For API routes that don't exist
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'API endpoint not found.' });
    }
    // Serve index.html for all other routes
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ========== ERROR HANDLER ==========
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    
    // Log to audit
    db.query(
        `INSERT INTO audit_logs (user_id, action, resource_type, details)
         VALUES (NULL, 'server_error', 'system', $1)`,
        [JSON.stringify({ message: err.message, stack: err.stack, path: req.path })]
    ).catch(e => console.error('Audit log error:', e));

    res.status(err.status || 500).json({
        error: process.env.NODE_ENV === 'production' 
            ? 'Internal server error. Please try again later.' 
            : err.message
    });
});

// ========== START SERVER ==========
async function startServer() {
    try {
        // Initialize database
        await db.initDatabase();
        console.log('✓ Database initialized');

        // Start fee reminder cron
        if (process.env.FEE_REMINDER_ENABLED === 'true') {
            feeCron.start();
            console.log('✓ Fee reminder cron started');
        }

        // Start server
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`✓ Fusion Coaching Server running on port ${PORT}`);
            console.log(`✓ Environment: ${process.env.NODE_ENV || 'development'}`);
            console.log(`✓ Dashboard: http://localhost:${PORT}/dashboard-admin.html`);
        });

    } catch (err) {
        console.error('Failed to start server:', err);
        process.exit(1);
    }
}

startServer();

module.exports = app;
