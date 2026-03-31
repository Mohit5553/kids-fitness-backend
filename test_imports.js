console.log('Testing imports...');
try {
  console.log('Importing Invoice model...');
  await import('./models/Invoice.js');
  console.log('Importing bookingController...');
  await import('./controllers/bookingController.js');
  console.log('Importing invoiceRoutes...');
  await import('./routes/invoiceRoutes.js');
  console.log('Importing server setup...');
  // No await import for server.js since it's an entry point
  console.log('All imports successful!');
} catch (err) {
  console.error('Import failed:', err);
  process.exit(1);
}
