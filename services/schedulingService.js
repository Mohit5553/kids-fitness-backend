import Session from '../models/Session.js';

/**
 * Generates sessions for a membership based on user preferences.
 * @param {Object} membership - The membership document
 * @param {Object} plan - The plan document
 * @returns {Array} List of created session IDs
 */
export const generateMembershipSessions = async (membership, plan) => {
  const { startDate, endDate, preferredDays, preferredSlots, sessionsPerWeek, childId, locationId } = membership;
  const { classesIncluded, sessionType } = plan;

  const sessions = [];
  let currentDate = new Date(startDate);
  let sessionsCreated = 0;
  const maxSessions = classesIncluded || 999; // Fallback if unlimited

  // Map day names to numbers (0=Sun, 1=Mon, ...)
  const dayMap = {
    'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6,
    'Sunday': 0, 'Monday': 1, 'Tuesday': 2, 'Wednesday': 3, 'Thursday': 4, 'Friday': 5, 'Saturday': 6
  };
  const targetDays = preferredDays.map(d => dayMap[d]).filter(d => d !== undefined);

  if (targetDays.length === 0) return []; // Safety check

  // Loop until we reach the end date or the max sessions count
  while (currentDate <= endDate && sessionsCreated < maxSessions) {
    const dayOfWeek = currentDate.getDay();

    if (targetDays.includes(dayOfWeek)) {
      // For each preferred slot on this day
      for (const slot of preferredSlots) {
        if (sessionsCreated >= maxSessions) break;

        // Parse slot (e.g. "10:00 AM") to set time
        const [time, modifier] = slot.split(' ');
        let [hours, minutes] = time.split(':');
        if (hours === '12') hours = '0';
        if (modifier === 'PM') hours = parseInt(hours, 10) + 12;

        const sessionDate = new Date(currentDate);
        sessionDate.setHours(parseInt(hours, 10), parseInt(minutes, 10), 0, 0);

        // Avoid creating sessions in the past if startDate is today
        if (sessionDate < new Date()) {
           // Skip if already passed today
        } else {
            const sessionData = {
                classId: plan._id, // Using planId as classId for membership sessions if no specific class assigned
                startTime: sessionDate,
                endTime: new Date(sessionDate.getTime() + 60 * 60 * 1000), // Default 1 hour
                membershipId: membership._id,
                locationId: locationId,
                status: 'scheduled',
                attendanceStatus: 'booked'
            };

            // Assign fixed trainer if specified in the plan
            if (plan.trainerAllocation === 'fixed' && plan.trainerId) {
                sessionData.trainerId = plan.trainerId;
                sessionData.trainerStatus = 'accepted'; // Auto-accept since it's a fixed assignment
            }

            const session = await Session.create(sessionData);
            sessions.push(session._id);
            sessionsCreated++;
        }
      }
    }

    // Move to next day
    currentDate.setDate(currentDate.getDate() + 1);
  }

  return sessions;
};
