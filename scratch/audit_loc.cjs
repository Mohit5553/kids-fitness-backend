const mongoose = require('mongoose');
require('dotenv').config();

// Define schema manually to avoid import issues
const paymentSchema = new mongoose.Schema({
  locationId: mongoose.Schema.Types.ObjectId,
  createdAt: Date
});
const Payment = mongoose.model('Payment', paymentSchema);

async function audit() {
  await mongoose.connect(process.env.MONGODB_URI);
  
  const start = new Date('2026-04-20');
  const end = new Date('2026-05-01');
  
  const total = await Payment.countDocuments({
    createdAt: { $gte: start, $lte: end }
  });
  
  const missingLoc = await Payment.countDocuments({
    createdAt: { $gte: start, $lte: end },
    locationId: null
  });
  
  console.log(`Range 20-30 April: Total=${total}, Missing LocationId=${missingLoc}`);
  
  if (missingLoc > 0) {
    console.log('Found payments missing locationId. They are hidden from the UI.');
  }

  process.exit(0);
}

audit();
