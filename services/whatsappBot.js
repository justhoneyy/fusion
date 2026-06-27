const axios = require('axios');
const db = require('./storage');

class WhatsAppBot {
    constructor() {
        this.baseUrl = `https://graph.facebook.com/${process.env.WA_API_VERSION}`;
        this.phoneNumberId = process.env.WA_PHONE_NUMBER_ID;
        this.accessToken = process.env.WA_ACCESS_TOKEN;
        this.botName = 'Fusion Coaching';
    }

    async sendMessage(to, message) {
        try {
            const response = await axios({
                method: 'POST',
                url: `${this.baseUrl}/${this.phoneNumberId}/messages`,
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json'
                },
                data: {
                    messaging_product: 'whatsapp',
                    recipient_type: 'individual',
                    to: to.replace('+', '').replace(/\s/g, ''),
                    type: 'template',
                    template: {
                        name: 'fee_reminder',
                        language: { code: 'en' },
                        components: [{
                            type: 'body',
                            parameters: [
                                { type: 'text', text: message }
                            ]
                        }]
                    }
                }
            });

            console.log(`WhatsApp message sent to ${to}:`, response.data);
            
            return {
                success: true,
                messageId: response.data?.messages?.[0]?.id,
                response: response.data
            };
        } catch (error) {
            console.error(`WhatsApp send error to ${to}:`, error.response?.data || error.message);
            
            // Fallback to text message if template fails
            try {
                const fallbackResponse = await axios({
                    method: 'POST',
                    url: `${this.baseUrl}/${this.phoneNumberId}/messages`,
                    headers: {
                        'Authorization': `Bearer ${this.accessToken}`,
                        'Content-Type': 'application/json'
                    },
                    data: {
                        messaging_product: 'whatsapp',
                        to: to.replace('+', '').replace(/\s/g, ''),
                        type: 'text',
                        text: { 
                            preview_url: false,
                            body: `*${this.botName}*\n\n${message}\n\nThank you,\nFusion Coaching Team`
                        }
                    }
                });
                
                return {
                    success: true,
                    messageId: fallbackResponse.data?.messages?.[0]?.id,
                    response: fallbackResponse.data
                };
            } catch (fallbackErr) {
                return {
                    success: false,
                    error: fallbackErr.response?.data || fallbackErr.message
                };
            }
        }
    }

    async sendFeeReminder(studentId, parentPhone, studentName, amount, dueDate, daysOverdue) {
        let urgency = '';
        let message = '';

        if (daysOverdue <= 0) {
            urgency = '📚 *Fee Reminder*';
            message = `Dear Parent,\n\nThis is a friendly reminder that the tuition fee of ₹${amount} for *${studentName}* is due on *${new Date(dueDate).toLocaleDateString('en-IN')}*.\n\nPlease pay before the due date to avoid any late fees.\n\n🔗 Pay Online: https://fusioncoaching.in/dashboard-student.html?page=fees\n\nThank you for your cooperation!`;
        } else if (daysOverdue <= 3) {
            urgency = '⚠️ *Fee Payment Overdue*';
            message = `Dear Parent,\n\nThe fee of ₹${amount} for *${studentName}* is now *${daysOverdue} day(s) overdue*.\n\nPlease pay immediately to avoid service interruption.\n\n🔗 Pay Now: https://fusioncoaching.in/dashboard-student.html?page=fees\n\nLate fee of ₹50/day will apply after the grace period.`;
        } else if (daysOverdue <= 7) {
            urgency = '🚨 *Urgent: Fee Payment Due*';
            message = `Dear Parent,\n\nThis is an *urgent reminder*. The fee for *${studentName}* (₹${amount}) is *${daysOverdue} days overdue*.\n\nYour grace period ends in ${7 - daysOverdue} days. After that, the student account will be temporarily locked.\n\n🔗 Pay Immediately: https://fusioncoaching.in/dashboard-student.html?page=fees`;
        } else {
            urgency = '🔴 *Final Notice: Account Lock Warning*';
            message = `Dear Parent,\n\nThe fee of ₹${amount} for *${studentName}* is *${daysOverdue} days overdue*.\n\n⚠️ *Your child's account will be locked in 24 hours if payment is not made.*\n\nOnly the fee payment page will be accessible until the dues are cleared.\n\n🔗 Pay Now: https://fusioncoaching.in/dashboard-student.html?page=fees\n\nContact us at +91 87005 17172 for any queries.`;
        }

        return await this.sendMessage(parentPhone, message);
    }

    async sendWhatsAppText(to, message) {
        try {
            const response = await axios({
                method: 'POST',
                url: `${this.baseUrl}/${this.phoneNumberId}/messages`,
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json'
                },
                data: {
                    messaging_product: 'whatsapp',
                    to: to.replace('+', '').replace(/\s/g, ''),
                    type: 'text',
                    text: { 
                        preview_url: false,
                        body: `*${this.botName}*\n\n${message}\n\nThank you,\nFusion Coaching Team`
                    }
                }
            });

            return { success: true, messageId: response.data?.messages?.[0]?.id };
        } catch (error) {
            console.error('WhatsApp text send error:', error.response?.data || error.message);
            return { success: false, error: error.message };
        }
    }

    async logReminder(feeId, studentId, type, message, status) {
        try {
            await db.query(
                `INSERT INTO fee_reminders (fee_id, student_id, reminder_type, message, status)
                 VALUES ($1, $2, $3, $4, $5)`,
                [feeId, studentId, type, message, status]
            );
        } catch (err) {
            console.error('Error logging reminder:', err);
        }
    }
}

module.exports = new WhatsAppBot();
