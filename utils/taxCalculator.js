/**
 * Calculates tax amount based on base price and tax object
 * @param {Number} price - Base price before tax
 * @param {Object} tax - Tax object from database
 * @returns {Number} - Calculated tax amount
 */
export const calculateTax = (price, tax) => {
  if (!tax || !tax.value || tax.status === 'inactive') return 0;

  const now = new Date();
  if (tax.validityStart && now < new Date(tax.validityStart)) return 0;
  if (tax.validityEnd && now > new Date(tax.validityEnd)) return 0;

  let taxAmount = 0;
  const isInclusive = tax.calculationMethod === 'inclusive';

  if (tax.type === 'percentage') {
    if (isInclusive) {
      // Extraction formula: Price - (Price / (1 + Rate))
      taxAmount = price - (price / (1 + (tax.value / 100)));
    } else {
      // Addition formula: Price * Rate
      taxAmount = price * (tax.value / 100);
    }
  } else {
    // Flat tax
    taxAmount = tax.value;
  }

  return Math.round(taxAmount * 100) / 100;
};
