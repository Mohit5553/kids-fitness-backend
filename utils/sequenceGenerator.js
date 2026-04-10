import Counter from '../models/Counter.js';
import Invoice from '../models/Invoice.js';
import Booking from '../models/Booking.js';

/**
 * Atomic helper to get the next invoice number in sequence
 * Format: INV-{YEAR}-{SEQUENCE} (e.g., INV-2026-1001)
 * Includes collision protection against manual/stale records.
 */
export const getNextInvoiceNumber = async () => {
  const year = new Date().getFullYear();
  
  let attempts = 0;
  while (attempts < 20) {
    const counter = await Counter.findOneAndUpdate(
      { name: 'invoice' },
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );

    const invoiceNumber = `INV-${year}-${counter.seq}`;
    
    // Safety check: ensure this sequence hasn't been used manually/before
    const exists = await Invoice.findOne({ invoiceNumber });
    if (!exists) return invoiceNumber;
    
    attempts++;
    console.warn(`[sequenceGenerator] Invoice collision detected for ${invoiceNumber}, incrementing again...`);
  }
  
  // Fallback to timestamp if counter is truly stuck after 10 attempts
  return `INV-${year}-${Date.now().toString().slice(-6)}`;
};

/**
 * Atomic helper to get the next official booking number in sequence
 * Format: BK-{SEQUENCE} (e.g., BK-1050)
 */
export const getNextBookingNumber = async () => {
  let attempts = 0;
  while (attempts < 20) {
    const counter = await Counter.findOneAndUpdate(
      { name: 'booking' },
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );

    const bookingNumber = `BK-${counter.seq}`;
    
    // Safety check: ensure this sequence hasn't been used manually/before
    const exists = await Booking.findOne({ bookingNumber });
    if (!exists) return bookingNumber;
    
    attempts++;
    console.warn(`[sequenceGenerator] Booking collision detected for ${bookingNumber}, incrementing again...`);
  }
  
  return `BK-${Date.now().toString().slice(-8)}`;
};
