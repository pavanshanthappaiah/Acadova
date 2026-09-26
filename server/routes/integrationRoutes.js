import express from 'express';
import { protect } from '../middleware/auth.js';
import { getConnection, connect, syncNow, getSyncStatus } from '../controllers/leetcodeController.js';

const router = express.Router();

// All routes are authenticated and scoped to req.user.id (Phase 29).
router.use(protect);

router.get('/leetcode', getConnection);
router.post('/leetcode/connect', connect);
router.post('/leetcode/sync', syncNow);
router.get('/leetcode/sync/status', getSyncStatus);

export default router;
