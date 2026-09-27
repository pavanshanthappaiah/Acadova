import express from 'express';
import {
  getTechnicalOverview,
  logCodingProblem,
  deleteCodingProblem,
  createOrUpdateSkill,
  updateSkill,
  deleteSkill,
  createProject,
  analyzeRepoController,
  toggleProjectMilestone,
  addProjectMilestone,
  deleteProjectMilestone,
  logProjectHours,
  deleteProject,
  getPracticeGoal,
  updatePracticeGoal,
} from '../controllers/technicalController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

router.use(protect);

router.get('/overview', getTechnicalOverview);

// DSA Problems
router.post('/problems', logCodingProblem);
router.delete('/problems/:id', deleteCodingProblem);

// Skills
router.post('/skills', createOrUpdateSkill);
router.put('/skills/:id', updateSkill);
router.delete('/skills/:id', deleteSkill);

// Projects — analyze-repo must come before /:id routes to avoid param collision
router.post('/projects/analyze-repo', analyzeRepoController);
router.post('/projects', createProject);
router.post('/projects/:id/milestone', addProjectMilestone);
router.patch('/projects/:id/milestone', toggleProjectMilestone);
router.delete('/projects/:id/milestone/:index', deleteProjectMilestone);
router.patch('/projects/:id/hours', logProjectHours);
router.delete('/projects/:id', deleteProject);

// Daily practice goal
router.get('/goal', getPracticeGoal);
router.put('/goal', updatePracticeGoal);

export default router;
