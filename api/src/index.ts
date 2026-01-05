import express from 'express';
import cors from 'cors';
import path from 'path';
import ingestRoutes from './routes/ingest';
import queryRoutes from './routes/query';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));


const publicPath = path.join(__dirname, '../public');
app.use(express.static(publicPath));

// Routes
app.use('/xray', ingestRoutes);
app.use('/xray', queryRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`Dashboard is running on http://localhost:${PORT}`);
  console.log(`X-Ray API server is running, check health staus on http://localhost:${PORT}/health`);
});

