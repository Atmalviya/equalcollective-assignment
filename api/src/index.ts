import express from 'express';
import cors from 'cors';
import ingestRoutes from './routes/ingest';
import queryRoutes from './routes/query';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));


// Routes
app.use('/xray', ingestRoutes);
app.use('/xray', queryRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Start server
app.listen(PORT, () => {
  console.log(`X-Ray API server is running, check health staus on http://localhost:${PORT}/health`);
});

