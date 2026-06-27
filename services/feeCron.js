const cron = require('node-cron');
const db = require('./storage');
const whatsappBot = require('./whatsappBot');

class FeeCronService {
    constructor() {
        this.isRunning = false;
    }

    start() {
        // Run every day at 9:00 AM and 6:00 PM
        cron.schedule('0 9,18 * * *', () => {
            this.processFeeReminders();
        });

        // Also run every 2 hours during the day
        cron.schedule('0 */2 * * *', () => {
            this.checkFeeLocks();
        });

        console.log('Fee reminder cron jobs started.');
    }

    async processFeeReminders() {
        if (this.isRunning) {
            console.log('Fee processing already running, skipping...');
            return;
        }

        this.isRunning = true;
        console.log('Processing fee reminders...');

        try {
            // Get all pending fees with student and parent info
            const result = await db.query(`
                SELECT 
                    f.id as fee_id,
                    f.amount,
                    f.due_date,
                    s.id as student_id,
                    s.student_id as student_code,
                    s.fee_status,
                    s.fee_grace_end,
                    u.full_name as student_name,
                    u.phone as student_phone,
                    p.id as parent_id,
                    pu.phone as parent_phone,
                    pu.full_name as parent_name
                FROM fees f
                JOIN students s ON f.student_id = s.id
                JOIN users u ON s.user_id = u.id
                LEFT JOIN student_parents sp ON s.id = sp.student_id
                LEFT JOIN parents p ON sp.parent_id = p.id
                LEFT JOIN users pu ON p.user_id = pu.id
                WHERE f.status = 'pending' 
                AND f.due_date <= CURRENT_DATE
                AND u.is_active = true
                AND u.is_locked = false
            `);

            for (const row of result.rows) {
                try {
                    const today = new Date();
                    const dueDate = new Date(row.due_date);
                    const daysOverdue = Math.floor((today - dueDate) / (1000 * 60 * 60 * 24));
                    
                    // Check if already sent today
                    const alreadySent = await db.query(
                        `SELECT id FROM fee_reminders 
                         WHERE fee_id = $1 AND student_id = $2 
                         AND DATE(sent_at) = CURRENT_DATE`,
                        [row.fee_id, row.student_id]
                    );

                    if (alreadySent.rows.length > 0) {
                        continue; // Skip if already sent today
                    }

                    const parentPhone = row.parent_phone;
                    if (!parentPhone) {
                        console.log(`No parent phone for student ${row.student_name}`);
                        continue;
                    }

                    // Format phone number
                    const formattedPhone = parentPhone.startsWith('+') ? parentPhone : `+91${parentPhone}`;

                    // Send WhatsApp reminder
                    const result = await whatsappBot.sendFeeReminder(
                        row.student_id,
                        formattedPhone,
                        row.student_name,
                        row.amount,
                        row.due_date,
                        daysOverdue
                    );

                    // Log the reminder
                    await whatsappBot.logReminder(
                        row.fee_id,
                        row.student_id,
                        'whatsapp',
                        `Fee reminder for ${row.student_name} - ₹${row.amount} - ${daysOverdue} days overdue`,
                        result.success ? 'sent' : 'failed'
                    );

                    // Update fee status to overdue if past due date
                    if (daysOverdue > 0 && row.fee_status === 'pending') {
                        await db.query(
                            `UPDATE students SET fee_status = 'overdue' WHERE id = $1`,
                            [row.student_id]
                        );
                    }

                    // Lock account if past grace period
                    if (daysOverdue > parseInt(process.env.FEE_GRACE_PERIOD_DAYS || '7')) {
                        await db.query(
                            `UPDATE users SET is_locked = true, lock_reason = 'Fee overdue by ${daysOverdue} days' 
                             WHERE id = (SELECT user_id FROM students WHERE id = $1)`,
                            [row.student_id]
                        );
                        
                        await db.query(
                            `UPDATE students SET fee_status = 'locked' WHERE id = $1`,
                            [row.student_id]
                        );

                        // Send lock notification
                        await whatsappBot.sendWhatsAppText(
                            formattedPhone,
                            `🔴 *URGENT: Account Locked*\n\nDear Parent,\n\nThe account of *${row.student_name}* has been temporarily locked due to unpaid fees (₹${row.amount}, ${daysOverdue} days overdue).\n\nPlease pay immediately to restore access.\n\n🔗 https://fusioncoaching.in/dashboard-student.html?page=fees\n\nContact: +91 87005 17172`
                        );
                    }

                    // Create in-app notification
                    await db.query(
                        `INSERT INTO notifications (user_id, title, message, type, reference_id)
                         VALUES (
                             (SELECT user_id FROM students WHERE id = $1),
                             'Fee Reminder',
                             $2,
                             'fee',
                             $3
                         )`,
                        [row.student_id, 
                         `Your fee of ₹${row.amount} is due. Please pay to avoid account lock.`,
                         row.fee_id]
                    );

                } catch (err) {
                    console.error(`Error processing fee for student ${row.student_name}:`, err);
                    continue;
                }
            }

            console.log(`Fee reminders processed: ${result.rows.length} students`);
        } catch (err) {
            console.error('Fee reminder processing error:', err);
        } finally {
            this.isRunning = false;
        }
    }

    async checkFeeLocks() {
        try {
            // Unlock accounts that have been paid
            const result = await db.query(`
                UPDATE users SET is_locked = false, lock_reason = NULL
                WHERE id IN (
                    SELECT s.user_id FROM students s
                    JOIN fees f ON f.student_id = s.id
                    WHERE s.is_locked = true
                    AND f.status = 'paid'
                    AND f.paid_date >= CURRENT_DATE - INTERVAL '30 days'
                )
                RETURNING id
            `);

            if (result.rows.length > 0) {
                console.log(`Unlocked ${result.rows.length} student accounts.`);
            }
        } catch (err) {
            console.error('Fee lock check error:', err);
        }
    }
}

module.exports = new FeeCronService();
