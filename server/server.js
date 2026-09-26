import 'dotenv/config.js';
import express from 'express';
import cors from 'cors';
import { connectDB } from './config/db.js';
import authRoutes from './routes/authRoutes.js';
import activityRoutes from './routes/activityRoutes.js';
import academicRoutes from './routes/academicRoutes.js';
import technicalRoutes from './routes/technicalRoutes.js';
import productivityRoutes from './routes/productivityRoutes.js';
import routineRoutes from './routes/routineRoutes.js';
import { seedStudentData } from './controllers/seedController.js';
import notificationRoutes from './routes/notificationRoutes.js';
import integrationRoutes from './routes/integrationRoutes.js';
import leetcodeDataRoutes from './routes/leetcodeRoutes.js';
import { dispatchDueReminders, syncAllUsers } from './services/notificationEngine.js';
import {
  leetcodeSyncTick,
  recoverStaleLeetCodeSyncs,
  leetcodeConfig,
} from './services/leetcodeSyncService.js';
import { protect } from './middleware/auth.js';

const app = express();
const PORT = process.env.PORT || 5001;
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  process.env.CLIENT_URL,
].filter(Boolean);

// Connect to MongoDB
connectDB();

// Middleware
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging in development
if (process.env.NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
    next();
  });
}

// Root route for direct browser access to backend port
app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'StudentOS API is running.',
    frontend: 'http://localhost:5173 or http://localhost:5174',
    health: 'http://localhost:5001/api/health',
    timestamp: new Date().toISOString(),
  });
});

// Base Health Check
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'online',
    system: 'StudentOS API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// Mount Routes
app.use('/api/auth', authRoutes);
app.use('/api/activities', activityRoutes);
app.use('/api/academics', academicRoutes);
app.use('/api/technical', technicalRoutes);
app.use('/api/productivity', productivityRoutes);
app.use('/api/routines', routineRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/integrations', integrationRoutes);
app.use('/api/leetcode', leetcodeDataRoutes);
app.post('/api/seed', protect, seedStudentData);

// 404 Handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `API route not found: ${req.method} ${req.originalUrl}`,
  });
});

// Centralized Error Handler
app.use((err, req, res, next) => {
  console.error('[Server Error]', err);
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    message: err.message || 'Internal Server Error',
    stack: process.env.NODE_ENV === 'production' ? null : err.stack,
  });
});

const server = app.listen(PORT, () => {
  console.log(`[StudentOS Server] Running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);

  // Notification scheduler: 60-second dispatcher + boot-time resync so
  // reminders always reflect current preferences and entities.
  const notificationTimer = setInterval(() => {
    dispatchDueReminders().catch((err) =>
      console.error('[Notifications] dispatch error:', err.message)
    );
  }, 60_000);
  notificationTimer.unref?.(); // never keep the process alive just for this
  syncAllUsers().catch((err) => console.error('[Notifications] boot sync failed:', err.message));

  // LeetCode near-real-time auto-sync: boot recovery (releases locks orphaned
  // by a restart) plus a background tick every LEETCODE_SYNC_INTERVAL_SECONDS
  // (default 8s, clamped to the configured 5–10s window by the service).
  // Auto-sync always targets the CURRENT month; other months remain strictly
  // student-initiated via month-targeted Sync Now. Server-side: a closed
  // browser never stops it.
  recoverStaleLeetCodeSyncs({ force: true }).catch((err) =>
    console.error('[LeetCode] boot recovery failed:', err.message)
  );
  const lcCfg = leetcodeConfig();
  const tickMs = Math.max(
    lcCfg.minIntervalSeconds * 1000,
    Math.min(lcCfg.intervalSeconds * 1000, lcCfg.maxIntervalSeconds * 1000)
  );
  const leetcodeTimer = setInterval(() => {
    leetcodeSyncTick().catch((err) =>
      console.error('[LeetCode] sync tick error:', err.message)
    );
  }, tickMs);
  leetcodeTimer.unref?.();
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n[StudentOS Server] ❌ Port ${PORT} is already in use!`);
    console.error(`  Fix: Run this command to free the port, then restart the server:`);
    console.error(`       lsof -ti :${PORT} | xargs kill -9\n`);
  } else {
    console.error('[StudentOS Server] Unexpected error:', err.message);
  }
  process.exit(1);
});

process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
process.on('SIGINT',  () => { server.close(() => process.exit(0)); });

export default app;
