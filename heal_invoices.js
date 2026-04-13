import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Booking from './models/Booking.js';
import Invoice from './models/Invoice.js';

dotenv.config();

const healInvoices = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB');

        const invoices = await Invoice.find({});
        console.log(`Checking ${invoices.length} invoices...`);

        for (const invoice of invoices) {
            const booking = await Booking.findById(invoice.bookingId);
            if (booking) {
                let updated = false;
                if ((booking.discountAmount || 0) > 0 && (invoice.discountAmount || 0) === 0) {
                    invoice.discountAmount = booking.discountAmount;
                    updated = true;
                }
                if ((booking.couponAmount || 0) > 0 && (invoice.couponAmount || 0) === 0) {
                    invoice.couponAmount = booking.couponAmount;
                    invoice.couponCode = booking.couponCode;
                    updated = true;
                }
                
                // Also update amount if it doesn't match the discounted price
                const expectedAmount = booking.totalAmount - (booking.discountAmount || 0) - (booking.couponAmount || 0);
                if (Math.abs(invoice.amount - expectedAmount) > 0.01) {
                    invoice.amount = expectedAmount;
                    updated = true;
                }

                if (updated) {
                    await invoice.save();
                    console.log(`Healed Invoice ${invoice.invoiceNumber}`);
                }
            }
        }

        console.log('Healing complete');
        process.exit(0);
    } catch (err) {
        console.error('Error during healing:', err);
        process.exit(1);
    }
};

healInvoices();
