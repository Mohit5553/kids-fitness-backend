import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Membership from './models/Membership.js';
import Booking from './models/Booking.js';
import Invoice from './models/Invoice.js';
import Plan from './models/Plan.js';
import Child from './models/Child.js';
import Payment from './models/Payment.js';
import { getNextInvoiceNumber, getNextBookingNumber } from './utils/sequenceGenerator.js';

dotenv.config();

const repair = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB');

        const memberships = await Membership.find({
            $or: [
                { bookingId: { $exists: false } },
                { bookingId: null }
            ]
        });

        console.log(`Found ${memberships.length} memberships checking for booking/invoice sync issues.`);
        
        // --- PHASE 1: Fix Existing Broken Memberships ---
        for (const m of memberships) {
            console.log(`\nRepairing membership: ${m._id} (${m.createdAt})`);
            
            // 1. Try to find matching booking by paymentId
            let booking = null;
            if (m.paymentId) {
                booking = await Booking.findOne({ paymentId: m.paymentId });
            }

            // 2. Fallback to broad match
            if (!booking) {
                console.log('No direct payment link. Searching by Plan/Child criteria...');
                booking = await Booking.findOne({
                    userId: m.userId,
                    planId: m.planId,
                    createdAt: {
                        $gte: new Date(m.createdAt.getTime() - 120000), // Within 2 mins
                        $lte: new Date(m.createdAt.getTime() + 120000)
                    }
                });
            }

            if (booking) {
                console.log(`Found matching booking: ${booking.bookingNumber}.`);
                
                // If the booking has an old temporary prefix, officialize it
                if (booking.bookingNumber.includes('REPAIR') || 
                    booking.bookingNumber.includes('HEAL') || 
                    booking.bookingNumber.includes('BK-PKG')) {
                    const oldNum = booking.bookingNumber;
                    booking.bookingNumber = await getNextBookingNumber();
                    await booking.save();
                    console.log(`--- Officialized booking number: ${oldNum} -> ${booking.bookingNumber}`);
                }

                if (!m.bookingId || m.bookingId.toString() !== booking._id.toString()) {
                    m.bookingId = booking._id;
                    await m.save();
                    console.log(`--- Linked membership to booking`);
                }
            } else {
                console.log('Could not find existing booking. Re-creating safe record...');
                // Get necessary data
                const plan = await Plan.findById(m.planId);
                const child = await Child.findById(m.childId);
                const payRec = m.paymentId ? await Payment.findById(m.paymentId) : null;

                if (!plan) {
                    console.log('Skipping: Plan not found');
                    continue;
                }

                const bookingNumber = await getNextBookingNumber();

                const bookingData = {
                    userId: m.userId,
                    bookingNumber,
                    bookingType: 'package',
                    planId: plan._id,
                    date: m.startDate || m.createdAt,
                    totalAmount: payRec ? payRec.amount : plan.price,
                    status: 'confirmed',
                    paymentStatus: 'completed',
                    paymentMethod: payRec ? payRec.paymentMethod : 'center',
                    paymentId: m.paymentId,
                    locationId: m.locationId,
                    participants: child ? [{
                        name: child.name,
                        age: child.age,
                        gender: child.gender,
                        relation: 'Child',
                        childId: child._id
                    }] : []
                };

                booking = await Booking.create(bookingData);
                m.bookingId = booking._id;
                await m.save();
                console.log(`Re-created booking: ${bookingNumber}`);
            }

            // 3. Ensure Invoice exists
            const invoice = await Invoice.findOne({ bookingId: booking._id });
            if (!invoice) {
                console.log('Creating missing invoice...');
                const plan = await Plan.findById(m.planId);
                const invoiceNumber = await getNextInvoiceNumber();
                await Invoice.create({
                    invoiceNumber,
                    bookingId: booking._id,
                    userId: m.userId,
                    amount: booking.totalAmount,
                    status: 'paid',
                    locationId: m.locationId,
                    items: [{
                        description: `${plan ? plan.name : 'Package'} - Enrollment (Restored)`,
                        quantity: 1,
                        unitPrice: booking.totalAmount,
                        total: booking.totalAmount
                    }]
                });
                console.log(`Created invoice: ${invoiceNumber}`);
            }
        }

        // --- PHASE 2: Fix Missing Memberships from Payment Records (The "Aniket" Fix) ---
        console.log('\n--- PHASE 2: Checking for payments missing memberships ---');
        const payments = await Payment.find().sort({ createdAt: -1 }).limit(50);
        for (const p of payments) {
            // Skip non-package payments (if they have classId they are regular bookings)
            if (!p.planId && !p.amount) continue; 
            
            const exists = await Membership.findOne({ paymentId: p._id });
            if (!exists) {
                console.log(`\nFound Orphaned Payment: ${p._id} (${p.createdAt}) for User: ${p.userId}`);
                const plan = await Plan.findById(p.planId);
                if (!plan) {
                    console.log('Skipping: Linked Plan not found for payment');
                    continue;
                }

                console.log(`Re-creating missing membership for Plan: ${plan.name}...`);
                
                // Calculate dates
                const startDate = p.createdAt;
                let endDate = new Date(startDate);
                if (plan.durationWeeks) {
                    endDate.setDate(endDate.getDate() + (plan.durationWeeks * 7));
                } else {
                    endDate.setMonth(endDate.getMonth() + 1);
                }

                const bNum = await getNextBookingNumber();
                const user = await User.findById(p.userId);

                // Create Booking first
                const booking = await Booking.create({
                    userId: p.userId,
                    bookingNumber: bNum,
                    bookingType: 'package',
                    planId: plan._id,
                    date: startDate,
                    totalAmount: p.amount,
                    status: 'confirmed',
                    paymentStatus: 'completed',
                    paymentMethod: p.paymentMethod,
                    paymentId: p._id,
                    locationId: plan.locationId,
                    promotionId: p.promotionId,
                    discountAmount: p.discountAmount || 0,
                    participants: [{
                        name: user?.name || 'Account Holder',
                        age: 18,
                        relation: 'Self'
                    }]
                });

                // Create Membership
                const mRec = await Membership.create({
                    userId: p.userId,
                    planId: plan._id,
                    startDate,
                    endDate,
                    classesRemaining: plan.classesIncluded || 8,
                    bookingId: booking._id,
                    paymentId: p._id,
                    locationId: plan.locationId
                });

                // Create Invoice
                const iNum = await getNextInvoiceNumber();
                await Invoice.create({
                    invoiceNumber: iNum,
                    bookingId: booking._id,
                    userId: p.userId,
                    amount: p.amount,
                    status: 'paid',
                    locationId: plan.locationId,
                    items: [{
                        description: `${plan.name} - Recovered Enrollment`,
                        quantity: 1,
                        unitPrice: plan.price,
                        total: plan.price
                    }]
                });

                console.log(`Successfully recovered Membership: ${mRec._id} and Booking: ${bNum}`);
            }
        }

        console.log('\nGlobal Repair complete!');
        process.exit(0);
    } catch (err) {
        console.error('Repair failed:', err);
        process.exit(1);
    }
};

repair();
