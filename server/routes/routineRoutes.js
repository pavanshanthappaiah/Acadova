import express from 'express';
import {
  getRoutinesForDate,
  createRoutine,
  updateRoutine,
  deleteRoutine,
  toggleRoutineCompletion,
  getCombinedDailyTimeline,
  getRoutineAnalytics,
  getRoutineCategories,
  createRoutineCategory,
  updateRoutineCategory,
  deleteRoutineCategory,
} from '../controllers/routineController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

router.use(protect);

router.get('/', getRoutinesForDate);
router.post('/', createRoutine);
router.get('/categories', getRoutineCategories);
router.post('/categories', createRoutineCategory);
router.put('/categories/:id', updateRoutineCategory);
router.delete('/categories/:id', deleteRoutineCategory);
router.put('/:id', updateRoutine);
router.delete('/:id', deleteRoutine);
router.post('/:id/toggle', toggleRoutineCompletion);
router.get('/combined-daily', getCombinedDailyTimeline);
router.get('/analytics', getRoutineAnalytics);

export default router;
