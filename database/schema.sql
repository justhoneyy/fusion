-- Fusion Coaching - Complete Database Schema
-- Run: psql -U fusion_user -d fusion_coaching -f database/schema.sql

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================
-- USERS TABLE (Base table for all roles)
-- =============================================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id VARCHAR(20) UNIQUE NOT NULL,  -- e.g., STU-2026-0001, TCH-001, PAR-001, ADM-001
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('student', 'teacher', 'parent', 'admin')),
    full_name VARCHAR(255) NOT NULL,
    phone VARCHAR(20),
    profile_pic TEXT DEFAULT '/assets/images/default-avatar.png',
    is_active BOOLEAN DEFAULT true,
    is_locked BOOLEAN DEFAULT false,
    lock_reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP,
    last_login_ip VARCHAR(45),
    failed_attempts INTEGER DEFAULT 0,
    locked_until TIMESTAMP
);

-- =============================================
-- STUDENTS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS students (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    student_id VARCHAR(20) UNIQUE NOT NULL,
    admission_number VARCHAR(30) UNIQUE NOT NULL,
    class VARCHAR(20) NOT NULL,
    section VARCHAR(10),
    roll_number INTEGER,
    date_of_birth DATE,
    gender VARCHAR(10),
    address TEXT,
    father_name VARCHAR(255),
    mother_name VARCHAR(255),
    father_phone VARCHAR(20),
    mother_phone VARCHAR(20),
    parent_id UUID REFERENCES users(id),
    fee_status VARCHAR(20) DEFAULT 'pending' CHECK (fee_status IN ('paid', 'pending', 'overdue', 'locked')),
    fee_due_date DATE,
    fee_amount DECIMAL(10,2) DEFAULT 0,
    fee_grace_end DATE,
    admission_date DATE DEFAULT CURRENT_DATE,
    current_device_id VARCHAR(255),
    current_device_info TEXT,
    last_device_activity TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================
-- TEACHERS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS teachers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    teacher_id VARCHAR(20) UNIQUE NOT NULL,
    qualification TEXT,
    specialization VARCHAR(255),
    subjects TEXT[],  -- Array of subjects
    classes TEXT[],   -- Array of classes they teach
    experience_years INTEGER,
    joining_date DATE,
    phone VARCHAR(20),
    address TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================
-- PARENTS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS parents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    parent_id VARCHAR(20) UNIQUE NOT NULL,
    phone VARCHAR(20),
    alternate_phone VARCHAR(20),
    address TEXT,
    occupation VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================
-- STUDENT-PARENT RELATIONSHIP
-- =============================================
CREATE TABLE IF NOT EXISTS student_parents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id UUID REFERENCES students(id) ON DELETE CASCADE,
    parent_id UUID REFERENCES parents(id) ON DELETE CASCADE,
    relationship VARCHAR(50) DEFAULT 'father',
    UNIQUE(student_id, parent_id)
);

-- =============================================
-- SESSIONS (Device tracking for single-device login)
-- =============================================
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(500) NOT NULL,
    device_id VARCHAR(255),
    device_info TEXT,
    ip_address VARCHAR(45),
    user_agent TEXT,
    is_active BOOLEAN DEFAULT true,
    login_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expiry_time TIMESTAMP
);

-- =============================================
-- ATTENDANCE
-- =============================================
CREATE TABLE IF NOT EXISTS attendance (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id UUID REFERENCES students(id) ON DELETE CASCADE,
    class VARCHAR(20) NOT NULL,
    section VARCHAR(10),
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    status VARCHAR(10) NOT NULL CHECK (status IN ('present', 'absent', 'late', 'holiday', 'leave')),
    marked_by UUID REFERENCES users(id),
    remarks TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(student_id, date)
);

-- =============================================
-- EXAMS
-- =============================================
CREATE TABLE IF NOT EXISTS exams (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    exam_name VARCHAR(255) NOT NULL,
    exam_type VARCHAR(50) NOT NULL CHECK (exam_type IN ('unit_test', 'half_yearly', 'final', 'mock', 'weekly_test')),
    class VARCHAR(20) NOT NULL,
    section VARCHAR(10),
    subject VARCHAR(100),
    max_marks DECIMAL(10,2) NOT NULL,
    passing_marks DECIMAL(10,2),
    exam_date DATE,
    start_time TIME,
    end_time TIME,
    created_by UUID REFERENCES users(id),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================
-- MARKS
-- =============================================
CREATE TABLE IF NOT EXISTS marks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id UUID REFERENCES students(id) ON DELETE CASCADE,
    exam_id UUID REFERENCES exams(id) ON DELETE CASCADE,
    subject VARCHAR(100) NOT NULL,
    marks_obtained DECIMAL(10,2) NOT NULL,
    max_marks DECIMAL(10,2) NOT NULL,
    percentage DECIMAL(5,2) GENERATED ALWAYS AS ((marks_obtained / max_marks) * 100) STORED,
    grade VARCHAR(5),
    remarks TEXT,
    entered_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(student_id, exam_id, subject)
);

-- =============================================
-- ONLINE TESTS
-- =============================================
CREATE TABLE IF NOT EXISTS online_tests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    class VARCHAR(20) NOT NULL,
    section VARCHAR(10),
    subject VARCHAR(100),
    duration_minutes INTEGER NOT NULL,
    total_marks DECIMAL(10,2),
    negative_marking DECIMAL(5,2) DEFAULT 0,
    passing_percentage DECIMAL(5,2) DEFAULT 33,
    shuffle_questions BOOLEAN DEFAULT true,
    full_screen_required BOOLEAN DEFAULT true,
    auto_submit BOOLEAN DEFAULT true,
    is_active BOOLEAN DEFAULT true,
    created_by UUID REFERENCES users(id),
    start_time TIMESTAMP,
    end_time TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================
-- TEST QUESTIONS
-- =============================================
CREATE TABLE IF NOT EXISTS test_questions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    test_id UUID REFERENCES online_tests(id) ON DELETE CASCADE,
    question_type VARCHAR(20) NOT NULL CHECK (question_type IN ('mcq', 'subjective')),
    question_text TEXT NOT NULL,
    options JSONB,  -- For MCQs: [{"option":"A","text":"..."}, {"option":"B","text":"..."}]
    correct_answer TEXT,  -- For MCQs: "A", "B", etc.
    marks DECIMAL(10,2) NOT NULL,
    negative_marks DECIMAL(10,2) DEFAULT 0,
    question_order INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================
-- TEST SUBMISSIONS
-- =============================================
CREATE TABLE IF NOT EXISTS test_submissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    test_id UUID REFERENCES online_tests(id) ON DELETE CASCADE,
    student_id UUID REFERENCES students(id) ON DELETE CASCADE,
    answers JSONB,  -- {"question_id": "answer", ...}
    total_obtained DECIMAL(10,2),
    total_marks DECIMAL(10,2),
    percentage DECIMAL(5,2),
    attempted_questions INTEGER,
    correct_answers INTEGER,
    wrong_answers INTEGER,
    time_taken_minutes INTEGER,
    start_time TIMESTAMP,
    end_time TIMESTAMP,
    is_submitted BOOLEAN DEFAULT false,
    is_evaluated BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(test_id, student_id)
);

-- =============================================
-- STUDY MATERIAL
-- =============================================
CREATE TABLE IF NOT EXISTS study_materials (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    file_type VARCHAR(20) NOT NULL CHECK (file_type IN ('pdf', 'ppt', 'doc', 'image', 'video', 'other')),
    file_path TEXT NOT NULL,
    file_size BIGINT,
    class VARCHAR(20),
    section VARCHAR(10),
    subject VARCHAR(100),
    uploaded_by UUID REFERENCES users(id),
    is_downloadable BOOLEAN DEFAULT false,
    watermark_text TEXT,
    access_token VARCHAR(255) UNIQUE,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================
-- LECTURE VIDEOS
-- =============================================
CREATE TABLE IF NOT EXISTS lecture_videos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    video_url TEXT NOT NULL,
    thumbnail_url TEXT,
    class VARCHAR(20),
    section VARCHAR(10),
    subject VARCHAR(100),
    duration_minutes INTEGER,
    uploaded_by UUID REFERENCES users(id),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================
-- VIDEO PROGRESS
-- =============================================
CREATE TABLE IF NOT EXISTS video_progress (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id UUID REFERENCES students(id) ON DELETE CASCADE,
    video_id UUID REFERENCES lecture_videos(id) ON DELETE CASCADE,
    progress_percentage DECIMAL(5,2) DEFAULT 0,
    last_position_seconds INTEGER DEFAULT 0,
    is_completed BOOLEAN DEFAULT false,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(student_id, video_id)
);

-- =============================================
-- DOUBTS
-- =============================================
CREATE TABLE IF NOT EXISTS doubts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id UUID REFERENCES students(id) ON DELETE CASCADE,
    subject VARCHAR(100) NOT NULL,
    question_text TEXT NOT NULL,
    image_url TEXT,
    is_resolved BOOLEAN DEFAULT false,
    resolved_by UUID REFERENCES users(id),
    answer_text TEXT,
    answered_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================
-- NOTICES
-- =============================================
CREATE TABLE IF NOT EXISTS notices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    target_type VARCHAR(20) NOT NULL CHECK (target_type IN ('all', 'class', 'section', 'specific')),
    target_class VARCHAR(20),
    target_section VARCHAR(10),
    created_by UUID REFERENCES users(id),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================
-- HOMEWORK
-- =============================================
CREATE TABLE IF NOT EXISTS homework (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    class VARCHAR(20) NOT NULL,
    section VARCHAR(10),
    subject VARCHAR(100) NOT NULL,
    due_date DATE NOT NULL,
    attachment_url TEXT,
    created_by UUID REFERENCES users(id),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================
-- HOMEWORK SUBMISSIONS
-- =============================================
CREATE TABLE IF NOT EXISTS homework_submissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    homework_id UUID REFERENCES homework(id) ON DELETE CASCADE,
    student_id UUID REFERENCES students(id) ON DELETE CASCADE,
    submission_text TEXT,
    attachment_url TEXT,
    status VARCHAR(20) DEFAULT 'submitted' CHECK (status IN ('submitted', 'reviewed', 'returned')),
    marks DECIMAL(10,2),
    feedback TEXT,
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(homework_id, student_id)
);

-- =============================================
-- FEES
-- =============================================
CREATE TABLE IF NOT EXISTS fees (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id UUID REFERENCES students(id) ON DELETE CASCADE,
    fee_type VARCHAR(100) NOT NULL,  -- tuition, exam, lab, etc.
    amount DECIMAL(10,2) NOT NULL,
    due_date DATE NOT NULL,
    paid_date DATE,
    payment_method VARCHAR(50),
    payment_reference VARCHAR(255),
    discount_amount DECIMAL(10,2) DEFAULT 0,
    fine_amount DECIMAL(10,2) DEFAULT 0,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'overdue', 'waived')),
    receipt_number VARCHAR(50),
    remarks TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================
-- FEE REMINDERS LOG
-- =============================================
CREATE TABLE IF NOT EXISTS fee_reminders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    fee_id UUID REFERENCES fees(id) ON DELETE CASCADE,
    student_id UUID REFERENCES students(id) ON DELETE CASCADE,
    reminder_type VARCHAR(50) NOT NULL,  -- whatsapp, email, sms
    message TEXT,
    status VARCHAR(20) DEFAULT 'sent' CHECK (status IN ('sent', 'failed', 'delivered')),
    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================
-- NOTIFICATIONS
-- =============================================
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    type VARCHAR(50) NOT NULL CHECK (type IN ('notice', 'homework', 'notes', 'attendance', 'marks', 'fee', 'test', 'doubt', 'general')),
    reference_id VARCHAR(100),
    is_read BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================
-- AUDIT LOGS
-- =============================================
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50),
    resource_id VARCHAR(100),
    details JSONB,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================
-- LOGIN HISTORY
-- =============================================
CREATE TABLE IF NOT EXISTS login_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    login_type VARCHAR(50) NOT NULL,  -- success, failed, locked
    ip_address VARCHAR(45),
    user_agent TEXT,
    device_info TEXT,
    login_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================
-- INDEXES FOR PERFORMANCE
-- =============================================
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_students_class ON students(class);
CREATE INDEX IF NOT EXISTS idx_students_parent ON students(parent_id);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date);
CREATE INDEX IF NOT EXISTS idx_attendance_student ON attendance(student_id);
CREATE INDEX IF NOT EXISTS idx_marks_student ON marks(student_id);
CREATE INDEX IF NOT EXISTS idx_marks_exam ON marks(exam_id);
CREATE INDEX IF NOT EXISTS idx_fees_student ON fees(student_id);
CREATE INDEX IF NOT EXISTS idx_fees_status ON fees(status);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_active ON sessions(is_active);
CREATE INDEX IF NOT EXISTS idx_doubts_status ON doubts(is_resolved);

-- =============================================
-- DEFAULT ADMIN USER (password: Admin@123)
-- =============================================
-- The password hash below is for "Admin@123"
-- You should change this immediately after first login
INSERT INTO users (user_id, email, password_hash, role, full_name, phone)
VALUES ('ADM-001', 'admin@fusioncoaching.in', '$2a$10$8K1p/a0dL1LXMIgoEDFrwOfMQkfAjkMBcGmF3WQmJQ5xYbQzR7z6y', 'admin', 'Fusion Admin', '8700517172')
ON CONFLICT (email) DO NOTHING;

-- Run this to create tables: psql $DATABASE_URL -f database/schema.sql
