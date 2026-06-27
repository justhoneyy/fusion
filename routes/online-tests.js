const express = require('express');
const router = express.Router();
const db = require('../services/storage');
const { verifyToken, checkFeeStatus } = require('../middleware/auth');
const { isAdmin, isTeacher } = require('../middleware/rbac');

// ===== TEACHER / ADMIN: Create Online Test =====
router.post('/create', verifyToken, isTeacher, async (req, res) => {
  try {
    const { title, description, class: cls, section, subject, duration_minutes, total_marks,
            negative_marking, passing_percentage, shuffle_questions, full_screen_required,
            auto_submit, start_time, end_time } = req.body;

    const result = await db.query(`
      INSERT INTO online_tests (title, description, class, section, subject, duration_minutes,
        total_marks, negative_marking, passing_percentage, shuffle_questions,
        full_screen_required, auto_submit, created_by, start_time, end_time)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id
    `, [title, description, cls, section, subject, duration_minutes, total_marks,
        negative_marking || 0, passing_percentage || 33, shuffle_questions !== false,
        full_screen_required !== false, auto_submit !== false,
        req.user.id, start_time, end_time]);

    res.json({ message: 'Test created successfully', testId: result.rows[0].id });
  } catch (err) {
    console.error('Create test error:', err);
    res.status(500).json({ error: 'Failed to create test' });
  }
});

// ===== TEACHER / ADMIN: Add Questions =====
router.post('/:testId/questions', verifyToken, isTeacher, async (req, res) => {
  try {
    const { testId } = req.params;
    const { questions } = req.body; // Array of question objects

    if (!questions?.length) return res.status(400).json({ error: 'No questions provided' });

    let count = 0;
    for (const q of questions) {
      await db.query(`
        INSERT INTO test_questions (test_id, question_type, question_text, options, correct_answer, marks, negative_marks, question_order)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      `, [testId, q.question_type || 'mcq', q.question_text, JSON.stringify(q.options || []),
          q.correct_answer, q.marks, q.negative_marks || 0, q.question_order || count + 1]);
      count++;
    }

    res.json({ message: `${count} questions added successfully` });
  } catch (err) {
    console.error('Add questions error:', err);
    res.status(500).json({ error: 'Failed to add questions' });
  }
});

// ===== STUDENT: Get Test Questions (with security) =====
router.get('/:testId/start', verifyToken, checkFeeStatus, async (req, res) => {
  try {
    if (req.user.role !== 'student') return res.status(403).json({ error: 'Only students can take tests' });

    const test = await db.query(`
      SELECT * FROM online_tests WHERE id = $1 AND is_active = true
    `, [req.params.testId]);

    if (!test.rows.length) return res.status(404).json({ error: 'Test not found' });
    const t = test.rows[0];

    // Check if student already submitted
    const existing = await db.query(`
      SELECT id FROM test_submissions WHERE test_id = $1 AND student_id = (SELECT id FROM students WHERE user_id = $2) AND is_submitted = true
    `, [req.params.testId, req.user.id]);

    if (existing.rows.length > 0) return res.status(400).json({ error: 'You have already submitted this test' });

    // Check time window
    const now = new Date();
    if (t.start_time && new Date(t.start_time) > now) return res.status(400).json({ error: 'Test has not started yet' });
    if (t.end_time && new Date(t.end_time) < now) return res.status(400).json({ error: 'Test has ended' });

    // Get questions (shuffled if enabled)
    let questionsQuery = `SELECT id, question_type, question_text, options, marks, negative_marks, question_order FROM test_questions WHERE test_id = $1`;
    if (t.shuffle_questions) questionsQuery += ` ORDER BY RANDOM()`;
    else questionsQuery += ` ORDER BY question_order`;

    const questions = await db.query(questionsQuery, [req.params.testId]);

    // For MCQs, hide correct answer. For subjective, show question only
    const sanitizedQuestions = questions.rows.map(q => ({
      id: q.id,
      question_type: q.question_type,
      question_text: q.question_text,
      options: q.options, // Options are visible to student
      marks: q.marks,
      negative_marks: q.negative_marks,
      question_order: q.question_order
    }));

    // Create submission record
    const submission = await db.query(`
      INSERT INTO test_submissions (test_id, student_id, start_time)
      VALUES ($1, (SELECT id FROM students WHERE user_id = $2), NOW()) RETURNING id
    `, [req.params.testId, req.user.id]);

    res.json({
      test: {
        id: t.id, title: t.title, description: t.description, subject: t.subject,
        duration_minutes: t.duration_minutes, total_marks: t.total_marks,
        negative_marking: t.negative_marking, passing_percentage: t.passing_percentage,
        full_screen_required: t.full_screen_required, auto_submit: t.auto_submit
      },
      questions: sanitizedQuestions,
      submissionId: submission.rows[0].id
    });
  } catch (err) {
    console.error('Start test error:', err);
    res.status(500).json({ error: 'Failed to start test' });
  }
});

// ===== STUDENT: Submit Test =====
router.post('/:testId/submit', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'student') return res.status(403).json({ error: 'Unauthorized' });

    const { answers, submissionId, time_taken_minutes } = req.body;

    // Get test
    const test = await db.query(`SELECT * FROM online_tests WHERE id = $1`, [req.params.testId]);
    if (!test.rows.length) return res.status(404).json({ error: 'Test not found' });

    const t = test.rows[0];

    // Get all questions with correct answers
    const questions = await db.query(`SELECT * FROM test_questions WHERE test_id = $1`, [req.params.testId]);

    // Auto-evaluate MCQs
    let totalObtained = 0;
    let correctCount = 0;
    let wrongCount = 0;
    let attemptedCount = 0;

    for (const q of questions.rows) {
      const studentAnswer = answers?.[q.id];
      if (studentAnswer && studentAnswer.trim() !== '') {
        attemptedCount++;
        if (q.question_type === 'mcq') {
          if (studentAnswer === q.correct_answer) {
            totalObtained += parseFloat(q.marks);
            correctCount++;
          } else {
            totalObtained -= parseFloat(q.negative_marks || 0);
            wrongCount++;
          }
        } else {
          // Subjective: marks will be added manually by teacher
          // For now, just count as attempted
        }
      }
    }

    // Update submission
    await db.query(`
      UPDATE test_submissions SET
        answers = $1,
        total_obtained = $2,
        total_marks = $3,
        percentage = CASE WHEN $3 > 0 THEN ($2 / $3) * 100 ELSE 0 END,
        attempted_questions = $4,
        correct_answers = $5,
        wrong_answers = $6,
        time_taken_minutes = $7,
        end_time = NOW(),
        is_submitted = true,
        is_evaluated = CASE WHEN $8 = 0 THEN true ELSE false END
      WHERE id = $9 AND student_id = (SELECT id FROM students WHERE user_id = $10)
    `, [JSON.stringify(answers || {}), totalObtained, t.total_marks || questions.rows.reduce((s, q) => s + parseFloat(q.marks), 0),
        attemptedCount, correctCount, wrongCount, time_taken_minutes,
        t.negative_marking, submissionId, req.user.id]);

    res.json({
      message: 'Test submitted successfully',
      result: {
        totalObtained: Math.max(0, totalObtained),
        totalMarks: t.total_marks,
        correctCount,
        wrongCount,
        attemptedCount,
        totalQuestions: questions.rows.length
      }
    });
  } catch (err) {
    console.error('Submit test error:', err);
    res.status(500).json({ error: 'Failed to submit test' });
  }
});

// ===== STUDENT: Get Test Results =====
router.get('/results', verifyToken, async (req, res) => {
  try {
    let query, params;
    if (req.user.role === 'student') {
      query = `
        SELECT ts.*, ot.title, ot.subject, ot.total_marks as exam_total_marks,
               ot.passing_percentage, ot.duration_minutes
        FROM test_submissions ts
        JOIN online_tests ot ON ts.test_id = ot.id
        WHERE ts.student_id = (SELECT id FROM students WHERE user_id = $1) AND ts.is_submitted = true
        ORDER BY ts.end_time DESC
      `;
      params = [req.user.id];
    } else {
      query = `
        SELECT ts.*, ot.title, ot.subject, u.full_name as student_name, s.student_id, s.class
        FROM test_submissions ts
        JOIN online_tests ot ON ts.test_id = ot.id
        JOIN students s ON ts.student_id = s.id
        JOIN users u ON s.user_id = u.id
        WHERE ts.is_submitted = true
        ORDER BY ts.end_time DESC LIMIT 50
      `;
      params = [];
    }
    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Get test results error:', err);
    res.status(500).json({ error: 'Failed to fetch results' });
  }
});

// ===== ADMIN/TEACHER: Get all tests =====
router.get('/', verifyToken, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT ot.*, u.full_name as created_by_name,
        (SELECT COUNT(*) FROM test_questions WHERE test_id = ot.id) as question_count
      FROM online_tests ot JOIN users u ON ot.created_by = u.id
      WHERE ot.is_active = true ORDER BY ot.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch tests' });
  }
});

module.exports = router;
