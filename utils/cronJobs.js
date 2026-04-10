import cron from 'node-cron';
import Booking from '../models/Booking.js';
import { sendSessionReminderEmail } from './mailer.js';

export const initCronJobs = () => {
    // Run every hour at the top of the hour
    cron.schedule('0 * * * *', async () => {
        console.log('[Cron] Checking for upcoming sessions to send reminders...');
        
        try {
            const now = new Date();
            const tomorrowStart = new Date(now.getTime() + 23 * 60 * 60 * 1000); // 23 hours from now
            const tomorrowEnd = new Date(now.getTime() + 25 * 60 * 60 * 1000);   // 25 hours from now

            // Find confirmed bookings for sessions starting in ~24 hours that haven't been reminded
            const pendingReminders = await Booking.find({
                status: 'confirmed',
                reminderSent: false,
                date: { $gte: tomorrowStart, $lte: tomorrowEnd }
            })
            .populate('userId', 'name email firstName')
            .populate('classId', 'title')
            .populate({
                path: 'sessionId',
                select: 'startTime location classId',
                populate: { path: 'classId', select: 'title' }
            });

            console.log(`[Cron] Found ${pendingReminders.length} pending reminders.`);

            for (const booking of pendingReminders) {
                try {
                    const classData = booking.classId || booking.sessionId?.classId;
                    const sessionData = booking.sessionId;
                    const userData = booking.userId || booking.guestDetails;

                    if (!classData || !sessionData || !userData || (!userData.email && !booking.guestDetails?.email)) {
                        console.warn(`[Cron] Skipping booking ${booking._id}: Missing data or contact info.`);
                        continue;
                    }

                    const sent = await sendSessionReminderEmail(booking, classData, sessionData, userData);
                    
                    if (sent) {
                        booking.reminderSent = true;
                        await booking.save();
                        console.log(`[Cron] Reminder sent for booking ${booking.bookingNumber} to ${userData.email}`);
                    }
                } catch (err) {
                    console.error(`[Cron] Failed to process reminder for booking ${booking._id}:`, err.message);
                }
            }
        } catch (err) {
            console.error('[Cron] Error in reminder job:', err.message);
        }
    });

    console.log('[Cron] Automated Session Reminder job initialized.');
};
