import express from 'express';
import {
  getDeadlineRadar,
  getTimeLeaks,
  getConsistencyStreaks,
  getAttentionRequired,
  submitDailyCheckout,
  getWeeklyReview,
} from '../controllers/productivityController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

router.use(protect);

router.get('/radar', getDeadlineRadar);
router.get('/time-leaks', getTimeLeaks);
router.get('/consistency', getConsistencyStreaks);
router.get('/attention', getAttentionRequired);
router.post('/checkout', submitDailyCheckout);
router.get('/weekly-review', getWeeklyReview);

export default router;
