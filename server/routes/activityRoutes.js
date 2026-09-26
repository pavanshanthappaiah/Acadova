import express from 'express';
import {
  getActivities,
  createActivity,
  updateActivity,
  updateActivityStatus,
  deleteActivity,
  getDailySummary,
} from '../controllers/activityController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

router.use(protect); // All activity routes are protected

router.get('/', getActivities);
router.post('/', createActivity);
router.get('/summary', getDailySummary);
router.put('/:id', updateActivity);
router.patch('/:id/status', updateActivityStatus);
router.delete('/:id', deleteActivity);

export default router;
