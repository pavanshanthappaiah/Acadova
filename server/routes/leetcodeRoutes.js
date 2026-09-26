import express from 'express';
import { protect } from '../middleware/auth.js';
import { listProblems, getAnalytics, getDashboard } from '../controllers/leetcodeController.js';

const router = express.Router();

router.use(protect);

router.get('/dashboard', getDashboard);
router.get('/problems', listProblems);
router.get('/analytics', getAnalytics);

export default router;
