import express from 'express';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
const PORT = 5001; // Use a different port to avoid conflicts

app.get('/test', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`Debug server listening on port ${PORT}`);
});
