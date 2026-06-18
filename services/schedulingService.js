import Session from '../models/Session.js';

/**
 * Generates sessions for a membership based on user preferences.
 * @param {Object} membership - The membership document
 * @param {Object} plan - The plan document
 * @param {Object} [dbSession] - Optional Mongoose session for atomic transactions
 * @returns {Array} List of created session IDs
 */
export const generateMembershipSessions = async (membership, plan, dbSession = null, forcePast = false) => {
    const { startDate, endDate, preferredDays, preferredSlots, sessionsPerWeek, childId, locationId } = membership;
    const { classesIncluded, sessionType } = plan;

    const sessions = [];
    let currentDate = new Date(startDate);
    let sessionsCreated = 0;
    // Handle 'Unlimited' memberships where classesRemaining is -1
    const isUnlimited = membership.classesRemaining === -1 || plan.type === 'unlimited';
    const maxSessions = isUnlimited ? 999 : (membership.classesRemaining || classesIncluded || 999);

    // Map day names to numbers (0=Sun, 1=Mon, ...) - Case Insensitive
    const dayMap = {
        'sun': 0, 'mon': 1, 'tue': 2, 'wed': 3, 'thu': 4, 'fri': 5, 'sat': 6,
        'sunday': 0, 'monday': 1, 'tuesday': 2, 'wednesday': 3, 'thursday': 4, 'friday': 5, 'saturday': 6
    };
    const targetDays = preferredDays
        .map(d => d ? dayMap[d.toLowerCase().trim()] : undefined)
        .filter(d => d !== undefined);

    if (targetDays.length === 0) {
        console.warn(`[schedulingService] No valid target days found in: ${JSON.stringify(preferredDays)}`);
        return [];
    }

    // Ensure we have at least one slot if days are selected (Part 17 Fallback)
    const finalSlots = (preferredSlots && preferredSlots.length > 0) ? preferredSlots : ['10:00 AM'];

    // Loop until we reach the end date or the max sessions count
    const normalizedEndDate = new Date(endDate);

    let currentWeekStart = new Date(currentDate);
    currentWeekStart.setDate(currentWeekStart.getDate() - currentWeekStart.getDay()); // Sunday
    currentWeekStart.setHours(0, 0, 0, 0);
    let currentWeekKey = currentWeekStart.getTime();
    let sessionsThisWeek = 0;

    while (currentDate <= normalizedEndDate && sessionsCreated < maxSessions) {
        let loopWeekStart = new Date(currentDate);
        loopWeekStart.setDate(loopWeekStart.getDate() - loopWeekStart.getDay());
        loopWeekStart.setHours(0, 0, 0, 0);
        let loopWeekKey = loopWeekStart.getTime();

        if (loopWeekKey !== currentWeekKey) {
            currentWeekKey = loopWeekKey;
            sessionsThisWeek = 0;
        }

        const dayOfWeek = currentDate.getDay();

        if (targetDays.includes(dayOfWeek)) {
            // Check weekly limit
            if (sessionsPerWeek > 0 && sessionsThisWeek >= sessionsPerWeek) {
                // Skip creating sessions if weekly limit is reached
            } else {
                // For each preferred slot on this day, try to create ONE session
                let sessionCreatedForToday = false;
                for (const slot of finalSlots) {
                    if (sessionsCreated >= maxSessions || sessionCreatedForToday) break;

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

                // Grace period logic
                const isInitialToday = currentDate.toDateString() === new Date().toDateString() && currentDate.toDateString() === new Date(startDate).toDateString();
                const gracePeriodMs = isInitialToday ? 24 * 60 * 60 * 1000 : 2 * 60 * 60 * 1000; 

                if (!forcePast && (sessionDate.getTime() + gracePeriodMs < new Date().getTime())) {
                    // Skip if already passed significantly (unless forced)
                } else {
                    const effectiveLocationId = locationId || plan.locationId || membership.locationId;

                    // DE-DUPLICATION LOGIC: Find any existing session for this EXACT plan at this time/location
                    let targetSessionId;
                    const sessionMatchQuery = {
                        classId: plan._id,
                        startTime: sessionDate,
                        status: 'scheduled',
                        isUAT: membership.isUAT || false,
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

                    // If plan has a fixed trainer, we must find a session with that trainer or no trainer
                    if (plan.trainerAllocation === 'fixed' && plan.trainerId) {
                        sessionMatchQuery.$or = [
                            { trainerId: plan.trainerId },
                            { trainerId: null }
                        ];
                    }

                    const existingSession = await Session.findOne(sessionMatchQuery).session(dbSession);

                    if (existingSession) {
                        // Increment booked participants count
                        existingSession.bookedParticipants = (existingSession.bookedParticipants || 0) + 1;

                        // Normalize legacy/old shared sessions
                        const needsNormalization =
                            existingSession.classType !== 'Plan' ||
                            !existingSession.endTime ||
                            !existingSession.locationId ||
                            (plan.trainerAllocation === 'fixed' && plan.trainerId && !existingSession.trainerId);

                        if (needsNormalization) {
                            if (existingSession.classType !== 'Plan' && !existingSession.membershipId) {
                                // Only take over if it's not a specific membership session already
                                existingSession.classType = 'Plan';
                            }
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
                        }
                        await existingSession.save({ session: dbSession });
                        targetSessionId = existingSession._id;
                    } else {
                        // Create new shared session
                        const sessionData = {
                            classId: plan._id,
                            classType: 'Plan',
                            sessionType: sessionType || 'group',
                            startTime: sessionDate,
                            endTime: new Date(sessionDate.getTime() + 60 * 60 * 1000), // Default 1 hour
                            locationId: effectiveLocationId,
                            bookedParticipants: 1, // Start with 1 for the first person
                            status: 'scheduled',
                            isUAT: membership.isUAT || false
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
                            }).catch(() => { }); // Silent fail if model/ID doesn't support availableTrainers
                        }
                    }

                    sessions.push(targetSessionId);
                    sessionsCreated++;
                    sessionsThisWeek++;
                    sessionCreatedForToday = true;
                }
            }
            }
        }

        // Move to next day
        currentDate.setDate(currentDate.getDate() + 1);
    }

    return sessions;
};
