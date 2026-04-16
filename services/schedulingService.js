import Session from '../models/Session.js';

/**
 * Generates sessions for a membership based on user preferences.
 * @param {Object} membership - The membership document
 * @param {Object} plan - The plan document
 * @param {Object} [dbSession] - Optional Mongoose session for atomic transactions
 * @returns {Array} List of created session IDs
 */
export const generateMembershipSessions = async (membership, plan, dbSession = null) => {
  const { startDate, endDate, preferredDays, preferredSlots, sessionsPerWeek, childId, locationId } = membership;
  const { classesIncluded, sessionType } = plan;

  const sessions = [];
  let currentDate = new Date(startDate);
  let sessionsCreated = 0;
  // Prioritize membership.classesRemaining for 'Boosted' memberships, fallback to plan default
  const maxSessions = membership.classesRemaining || classesIncluded || 999; 

  // Map day names to numbers (0=Sun, 1=Mon, ...)
  const dayMap = {
    'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6,
    'Sunday': 0, 'Monday': 1, 'Tuesday': 2, 'Wednesday': 3, 'Thursday': 4, 'Friday': 5, 'Saturday': 6
  };
  const targetDays = preferredDays.map(d => dayMap[d]).filter(d => d !== undefined);

  if (targetDays.length === 0) return []; // Safety check

  // Ensure we have at least one slot if days are selected (Part 17 Fallback)
  const finalSlots = (preferredSlots && preferredSlots.length > 0) ? preferredSlots : ['10:00 AM'];

  // Loop until we reach the end date or the max sessions count
  while (currentDate <= endDate && sessionsCreated < maxSessions) {
    const dayOfWeek = currentDate.getDay();

    if (targetDays.includes(dayOfWeek)) {
      // For each preferred slot on this day
      // Robust Time Parsing
      for (const slot of finalSlots) {
        if (sessionsCreated >= maxSessions) break;

        // Use regex for robust extraction: handles "10Am", "9:00am", "10:30 PM", etc.
        const timeMatch = slot.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM|am|pm)?$/i);
        
        if (!timeMatch) {
          console.warn(`[schedulingService] Skipping invalid time slot format: "${slot}"`);
          continue;
        }

        let [_, hoursStr, minutesStr, modifier] = timeMatch;
        let hours = parseInt(hoursStr, 10);
        const minutes = parseInt(minutesStr || '0', 10);

        if (modifier) {
          modifier = modifier.toUpperCase();
          if (hours === 12 && modifier === 'AM') hours = 0;
          if (hours !== 12 && modifier === 'PM') hours += 12;
        }

        const sessionDate = new Date(currentDate);
        sessionDate.setHours(hours, minutes, 0, 0);

        // Final check for Invalid Date
        if (isNaN(sessionDate.getTime())) {
            console.warn(`[schedulingService] Generated Invalid Date for slot: "${slot}"`);
            continue;
        }

        // Avoid creating sessions in the past if startDate is today
        if (sessionDate < new Date()) {
           // Skip if already passed today
        } else {
            const effectiveLocationId = locationId || plan.locationId || membership.locationId;

            // DE-DUPLICATION LOGIC: Find any existing session at this time/location
            // Priority:
            // 1. Session linked to this specific Plan
            // 2. Session linked to the parent Class (if plan.classId is set)
            let targetSessionId;
            const sessionMatchQuery = {
                classId: plan._id, // Group by Package/Plan
                startTime: sessionDate,
                status: 'scheduled',
                $and: [
                    {
                        $or: [
                            { locationId: effectiveLocationId },
                            { locationId: null },
                            { locationId: { $exists: false } }
                        ]
                    },
                    {
                        $or: [
                            { sessionType: sessionType || 'group' },
                            { sessionType: { $exists: false } }
                        ]
                    }
                ]
            };

            // Refined search: Look for ANY session at this exact slot
            const existingSession = await Session.findOne(sessionMatchQuery).session(dbSession);

            if (existingSession) {
                // Normalize legacy/old shared sessions so all future lookups hit the same record.
                const needsNormalization =
                  existingSession.classType !== 'Plan' ||
                  !existingSession.endTime ||
                  !existingSession.locationId ||
                  (plan.trainerAllocation === 'fixed' && plan.trainerId && !existingSession.trainerId);

                if (needsNormalization) {
                    existingSession.classType = 'Plan';
                    if (!existingSession.endTime) {
                        existingSession.endTime = new Date(sessionDate.getTime() + 60 * 60 * 1000);
                    }
                    if (!existingSession.locationId && effectiveLocationId) {
                        existingSession.locationId = effectiveLocationId;
                    }
                    if (plan.trainerAllocation === 'fixed' && plan.trainerId && !existingSession.trainerId) {
                        existingSession.trainerId = plan.trainerId;
                        existingSession.trainerStatus = 'accepted';
                    }
                    await existingSession.save({ session: dbSession });
                }
                targetSessionId = existingSession._id;
            } else {
                // Create new shared session (no membershipId assigned directly to Session)
                const sessionData = {
                    classId: plan._id,
                    classType: 'Plan',
                    sessionType: sessionType || 'group',
                    startTime: sessionDate,
                    endTime: new Date(sessionDate.getTime() + 60 * 60 * 1000), // Default 1 hour
                    locationId: effectiveLocationId,
                    status: 'scheduled'
                };

                // Assign fixed trainer if specified in the plan
                if (plan.trainerAllocation === 'fixed' && plan.trainerId) {
                    sessionData.trainerId = plan.trainerId;
                    sessionData.trainerStatus = 'accepted'; 
                }

                const newSessions = await Session.create([sessionData], { session: dbSession });
                targetSessionId = newSessions[0]._id;

                // Sync trainer to class/plan availableTrainers
                if (sessionData.trainerId) {
                    const TargetModel = Session.model(sessionData.classType);
                    await TargetModel.findByIdAndUpdate(plan._id, {
                        $addToSet: { availableTrainers: sessionData.trainerId }
                    }).catch(() => {}); // Silent fail if model/ID doesn't support availableTrainers
                }
            }

            sessions.push(targetSessionId);
            sessionsCreated++;
        }
      }
    }

    // Move to next day
    currentDate.setDate(currentDate.getDate() + 1);
  }

  return sessions;
};
