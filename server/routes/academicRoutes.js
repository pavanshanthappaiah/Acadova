import express from 'express';
import {
  getAcademicOverview,
  getSemesters,
  createSemester,
  setActiveSemester,
  updateSemesterConfig,
  deleteSemester,
  getSubjects,
  createSubject,
  updateSubject,
  deleteSubject,
  logAttendance,
  getAssignments,
  createAssignment,
  updateAssignmentStatus,
  getExams,
  createExam,
  toggleExamTopic,
  getTimetable,
  createTimetableSlot,
  deleteTimetableSlot,
  getTimetableGrid,
  saveTimetableCell,
  activateTimetable,
  getSemesterExceptions,
  createSemesterException,
  deleteSemesterException,
  getTodaysClasses,
  markTimetableAttendance,
  getWeekAttendance,
  getAttendanceHistory,
  getAssessment,
  saveAssessment,
  getAssessmentsSummary,
} from '../controllers/academicController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

router.use(protect);

router.get('/overview', getAcademicOverview);

// Semester management routes
router.get('/semesters', getSemesters);
router.post('/semesters', createSemester);
router.post('/semesters/:id/activate', setActiveSemester);
router.put('/semesters/:id', updateSemesterConfig);
router.delete('/semesters/:id', deleteSemester);
// Subject registration & 4-credit lab routes
router.get('/subjects', getSubjects);
router.post('/subjects', createSubject);
router.put('/subjects/:id', updateSubject);
router.delete('/subjects/:id', deleteSubject);
router.post('/subjects/:id/attendance', logAttendance);

// College-Style Timetable Grid routes
router.get('/timetable/grid', getTimetableGrid);
router.post('/timetable/cell', saveTimetableCell);
router.post('/timetable/activate', activateTimetable);

// Legacy Timetable routes (preserved for backwards compatibility)
router.get('/timetable', getTimetable);
router.post('/timetable', createTimetableSlot);
router.delete('/timetable/:id', deleteTimetableSlot);
router.get('/week', getWeekAttendance);

// Semester Exceptions / Holidays
router.get('/exceptions', getSemesterExceptions);
router.post('/exceptions', createSemesterException);
router.delete('/exceptions/:id', deleteSemesterException);

// Today's classes & Attendance tracking
router.get('/today', getTodaysClasses);
router.post('/timetable/:slotId/mark', markTimetableAttendance);
router.get('/attendance/history', getAttendanceHistory);

// Assignments & Exams
router.get('/assignments', getAssignments);
router.post('/assignments', createAssignment);
router.patch('/assignments/:id/status', updateAssignmentStatus);
router.get('/exams', getExams);
router.post('/exams', createExam);
router.patch('/exams/:id/topic', toggleExamTopic);

// Assessments — fixed structure: Internals 2×/50, ABLs 2×/20 (due date),
// Quizzes 2×/20 (date + attendance). One record per subject per semester.
router.get('/assessments', getAssessmentsSummary);
router.get('/assessments/subject/:subjectId', getAssessment);
router.put('/assessments/subject/:subjectId', saveAssessment);

export default router;
