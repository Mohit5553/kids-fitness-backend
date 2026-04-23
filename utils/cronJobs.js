import cron from 'node-cron';
import Booking from '../models/Booking.js';
import Session from '../models/Session.js';
import Membership from '../models/Membership.js';
import { sendSessionReminderEmail, sendTrainerSessionReminderEmail } from './mailer.js';

export const initCronJobs = () => {
    // Run every hour at the top of the hour
    cron.schedule('0 * * * *', async () => {
        console.log('[Cron] Checking for upcoming sessions to send reminders...');
        
        try {
            const now = new Date();
            const tomorrowStart = new Date(now.getTime() + 23 * 60 * 60 * 1000); // 23 hours from now
            const tomorrowEnd = new Date(now.getTime() + 25 * 60 * 60 * 1000);   // 25 hours from now

            // 1. CUSTOMER REMINDERS (Based on Bookings)
            // Find confirmed bookings for sessions starting in ~24 hours that haven't been reminded
            const pendingCustomerReminders = await Booking.find({
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

            console.log(`[Cron] Found ${pendingCustomerReminders.length} pending customer reminders.`);

            for (const booking of pendingCustomerReminders) {
                try {
                    const classData = booking.classId || booking.sessionId?.classId;
                    const sessionData = booking.sessionId;
                    const userData = booking.userId || booking.guestDetails;

                    if (!classData || !sessionData || !userData || (!userData.email && !booking.guestDetails?.email)) {
                        continue;
                    }

                    const sent = await sendSessionReminderEmail(booking, classData, sessionData, userData);
                    if (sent) {
                        booking.reminderSent = true;
                        await booking.save();
                    }
                } catch (err) {
                    console.error(`[Cron] Failed customer reminder for booking ${booking._id}:`, err.message);
                }
            }

            // 2. TRAINER REMINDERS (Based on Sessions)
            // Find scheduled sessions starting in ~24 hours that haven't sent trainer reminders
            const pendingTrainerReminders = await Session.find({
                status: 'scheduled',
                trainerReminderSent: false,
                startTime: { $gte: tomorrowStart, $lte: tomorrowEnd },
                trainerId: { $ne: null }
            })
            .populate('trainerId', 'name email')
            .populate('classId', 'title name'); // title for Class, name for Plan

            console.log(`[Cron] Found ${pendingTrainerReminders.length} pending trainer reminders.`);

            for (const session of pendingTrainerReminders) {
                try {
                    if (!session.trainerId || !session.trainerId.email) {
                        continue;
                    }

                    // Count confirmed bookings for this session
                    const bookingsCount = await Booking.countDocuments({
                        sessionId: session._id,
                        status: 'confirmed'
                    });

                    const sent = await sendTrainerSessionReminderEmail(session, session.classId, session.trainerId, bookingsCount);
                    if (sent) {
                        session.trainerReminderSent = true;
                        await session.save();
                        console.log(`[Cron] Trainer reminder sent for session ${session._id} to ${session.trainerId.email}`);
                    }
                } catch (err) {
                    console.error(`[Cron] Failed trainer reminder for session ${session._id}:`, err.message);
                }
            }

            // 3. MEMBERSHIP CUSTOMER REMINDERS (For fixed-schedule plans)
            // Find all sessions starting in the window
            const upcomingSessions = await Session.find({
                startTime: { $gte: tomorrowStart, $lte: tomorrowEnd },
                status: 'scheduled'
            }).populate('classId', 'title name');

            for (const session of upcomingSessions) {
                // Find active memberships that include this session and haven't been reminded yet
                const pendingMemberships = await Membership.find({
                    status: 'active',
                    generatedSessions: session._id,
                    remindedSessions: { $ne: session._id }
                }).populate('userId', 'name email firstName')
                  .populate('childId', 'name')
                  .populate('planId', 'name');

                for (const membership of pendingMemberships) {
                    try {
                        if (!membership.userId || !membership.userId.email) continue;
                        
                        const classData = membership.planId || session.classId;
                        const sent = await sendSessionReminderEmail(membership, classData, session, membership.userId);
                        
                        if (sent) {
                            membership.remindedSessions.push(session._id);
                            await membership.save();
                        }
                    } catch (err) {
                        console.error(`[Cron] Failed membership reminder for membership ${membership._id}:`, err.message);
                    }
                }
            }

        } catch (err) {
            console.error('[Cron] Error in reminder job:', err.message);
        }
    });

    console.log('[Cron] Automated Session Reminder job initialized.');
};
