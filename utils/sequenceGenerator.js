import Counter from '../models/Counter.js';

/**
 * Atomic helper to get the next invoice number in sequence
 * Format: INV-{YEAR}-{SEQUENCE} (e.g., INV-2026-1001)
 */
export const getNextInvoiceNumber = async () => {
  const year = new Date().getFullYear();
  const counter = await Counter.findOneAndUpdate(
    { name: 'invoice' },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );

  return `INV-${year}-${counter.seq}`;
};
