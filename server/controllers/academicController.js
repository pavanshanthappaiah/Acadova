import {
  Semester,
  Subject,
  ClassSession,
  Assignment,
  Exam,
  Assessment,
  TimetableSlot,
  SemesterException,
} from '../models/Academic.js';
import { syncUserReminders } from '../services/notificationEngine.js';
import {
  studentNow,
  toMinutes,
  evaluateLock,
  lockMessage,
} from '../utils/time.js';

/**
 * When a session actually ends. A multi-slot lab is stored against its first
 * slot, so its real end is the end of the last reserved slot.
 */
export const effectiveSlotEndTime = (slot, semester) => {
  const span = slot.colSpan || 1;
  if (span > 1 && Array.isArray(semester?.timeSlots)) {
    const last = semester.timeSlots.find((ts) => ts.slotIndex === slot.slotIndex + span - 1);
    if (last?.endTime) return last.endTime;
  }
  return slot.end_time;
};

// Helper to compute comprehensive attendance metrics for Theory, Lab, and Overall
export const computeSubjectAttendance = (subject) => {
  const subjObj = subject.toObject ? subject.toObject() : { ...subject };

  // Theory counts
  const theoryTotal = subjObj.totalClasses || 0;
  const theoryAttended = subjObj.attendedClasses || 0;
  const theoryPercentage = theoryTotal > 0 ? Math.round((theoryAttended / theoryTotal) * 1000) / 10 : 100;

  // Lab counts
  const labTotal = subjObj.labTotalClasses || 0;
  const labAttended = subjObj.labAttendedClasses || 0;
  const labPercentage = labTotal > 0 ? Math.round((labAttended / labTotal) * 1000) / 10 : 100;

  // Combined Overall counts
  const overallTotal = theoryTotal + labTotal;
  const overallAttended = theoryAttended + labAttended;
  const target = subjObj.targetAttendance || 75;
  const targetDecimal = target / 100;

  const percentage = overallTotal > 0 ? Math.round((overallAttended / overallTotal) * 1000) / 10 : 100;

  let classesNeeded = 0;
  let safeBunks = 0;
  let isSafe = true;

  if (overallTotal > 0) {
    if (percentage < target) {
      isSafe = false;
      classesNeeded = Math.max(
        1,
        Math.ceil((targetDecimal * overallTotal - overallAttended) / (1 - targetDecimal))
      );
    } else {
      isSafe = true;
      safeBunks = Math.max(
        0,
        Math.floor((overallAttended - targetDecimal * overallTotal) / targetDecimal)
      );
    }
  }

  // Ensure labSection code is strictly equal to subject code
  if (subjObj.labSection) {
    subjObj.labSection.code = subjObj.code;
  }

  return {
    ...subjObj,
    theoryTotal,
    theoryAttended,
    theoryPercentage,
    labTotal,
    labAttended,
    labPercentage,
    overallTotal,
    overallAttended,
    percentage,
    target,
    isSafe,
    classesNeeded,
    safeBunks,
  };
};

// Helper: Ensure active semester exists for user or initialize default
export const getOrCreateActiveSemester = async (userId) => {
  // Returns the active semester, or promotes the most recent one.
  // NEVER fabricates a semester: new accounts genuinely have none until the
  // student creates their own (no seeded semesters, no fixed college timings).
  let active = await Semester.findOne({ user: userId, isActive: true });
  if (active) return active;

  active = await Semester.findOne({ user: userId }).sort({ createdAt: -1 });
  if (active) {
    active.isActive = true;
    await active.save();
  }
  return active || null;
};

// ==========================================
// 1. SEMESTER MANAGEMENT
// ==========================================

// @desc    Get all semesters for the student with active semester indicator
// @route   GET /api/academics/semesters
export const getSemesters = async (req, res) => {
  try {
    const activeSemester = await getOrCreateActiveSemester(req.user.id);
    const semesters = await Semester.find({ user: req.user.id }).sort({ semesterNumber: 1 });

    return res.status(200).json({
      success: true,
      semesters,
      activeSemester,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Create a new semester
// @route   POST /api/academics/semesters
export const createSemester = async (req, res) => {
  try {
    const {
      semesterNumber,
      academicYear,
      semesterName,
      startDate,
      endDate,
      workingDays,
      timeSlots,
      isActive,
    } = req.body;

    if (!semesterNumber || !academicYear || !semesterName || !startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'Semester number, academic year, name, start date, and end date are required',
      });
    }

    if (isActive) {
      await Semester.updateMany({ user: req.user.id }, { isActive: false });
    }

    // No default time slots: the student configures their own college timings.
    // Working days default to Mon–Sat only when the request omits them entirely;
    // an explicitly provided array (even empty) is respected so students can
    // intentionally start with no selected days.
    const semester = await Semester.create({
      user: req.user.id,
      semesterNumber: Number(semesterNumber),
      academicYear: academicYear.trim(),
      semesterName: semesterName.trim(),
      startDate,
      endDate,
      isActive: isActive !== undefined ? !!isActive : true,
      workingDays: Array.isArray(workingDays) && workingDays.length > 0
        ? workingDays
        : ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
      timeSlots: Array.isArray(timeSlots) ? timeSlots : [],
    });

    return res.status(201).json({
      success: true,
      message: 'Semester created successfully',
      semester,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Set active semester
// @route   POST /api/academics/semesters/:id/activate
export const setActiveSemester = async (req, res) => {
  try {
    const semester = await Semester.findOne({ _id: req.params.id, user: req.user.id });
    if (!semester) {
      return res.status(404).json({ success: false, message: 'Semester not found' });
    }

    await Semester.updateMany({ user: req.user.id }, { isActive: false });
    semester.isActive = true;
    await semester.save();

    return res.status(200).json({
      success: true,
      message: `Active semester changed to ${semester.semesterName}`,
      semester,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Update semester configuration (working days and time slots)
// @route   PUT /api/academics/semesters/:id/config
export const updateSemesterConfig = async (req, res) => {
  try {
    const semester = await Semester.findOne({ _id: req.params.id, user: req.user.id });
    if (!semester) {
      return res.status(404).json({ success: false, message: 'Semester not found' });
    }

    const { semesterNumber, workingDays, timeSlots, semesterName, academicYear, startDate, endDate } = req.body;
    if (semesterNumber) semester.semesterNumber = Number(semesterNumber);
    if (workingDays) semester.workingDays = workingDays;
    if (timeSlots) semester.timeSlots = timeSlots;
    if (semesterName) semester.semesterName = semesterName.trim();
    if (academicYear) semester.academicYear = academicYear.trim();
    if (startDate) semester.startDate = startDate;
    if (endDate) semester.endDate = endDate;

    await semester.save();

    return res.status(200).json({
      success: true,
      message: 'Semester configuration updated successfully',
      semester,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Delete a semester
// @route   DELETE /api/academics/semesters/:id
export const deleteSemester = async (req, res) => {
  try {
    const semester = await Semester.findOne({ _id: req.params.id, user: req.user.id });
    if (!semester) {
      return res.status(404).json({ success: false, message: 'Semester not found' });
    }

    // Check for associated data
    const subjectCount = await Subject.countDocuments({ semester: semester._id });
    const timetableCount = await TimetableSlot.countDocuments({ semester: semester._id });
    
    // Deleting the semester and cascade
    await Subject.deleteMany({ semester: semester._id });
    await TimetableSlot.deleteMany({ semester: semester._id });
    await ClassSession.deleteMany({ semester: semester._id });
    await SemesterException.deleteMany({ semester: semester._id });
    
    await Semester.findByIdAndDelete(semester._id);

    // If active semester was deleted, maybe set another as active
    if (semester.isActive) {
      const remainingSemester = await Semester.findOne({ user: req.user.id }).sort({ createdAt: -1 });
      if (remainingSemester) {
        remainingSemester.isActive = true;
        await remainingSemester.save();
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Semester and its associated data deleted successfully',
      deletedSubjects: subjectCount,
      deletedTimetableSlots: timetableCount
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==========================================
// 2. SUBJECT REGISTRATION & 4-CREDIT LAB LOGIC
// ==========================================

// @desc    Get all subjects for the active semester
// @route   GET /api/academics/subjects
export const getSubjects = async (req, res) => {
  try {
    const activeSemester = await getOrCreateActiveSemester(req.user.id);
    if (!activeSemester) {
      return res.status(200).json({ success: true, activeSemester: null, subjects: [] });
    }
    const semesterId = req.query.semesterId || activeSemester._id;

    // Support both active semester scoping and fallback legacy subjects
    const subjects = await Subject.find({
      user: req.user.id,
      $or: [{ semester: semesterId }, { semester: null }],
    }).sort({ code: 1 });

    const metrics = subjects.map(computeSubjectAttendance);
    return res.status(200).json({
      success: true,
      activeSemester,
      subjects: metrics,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Create subject with 4-credit lab logic and duplicate code check
// @route   POST /api/academics/subjects
export const createSubject = async (req, res) => {
  try {
    const {
      name,
      code,
      faculty,
      credits,
      type,
      color,
      targetAttendance,
      theorySessionsPerWeek,
      theoryDuration,
      hasLab,
      labSection,
    } = req.body;

    if (!name || !code) {
      return res.status(400).json({ success: false, message: 'Subject name and code are required' });
    }

    const cleanCode = code.trim().toUpperCase();

    const activeSemester = await getOrCreateActiveSemester(req.user.id);
    if (!activeSemester) {
      return res.status(400).json({
        success: false,
        message: 'Create a semester before registering subjects.',
      });
    }
    const targetSemesterId = req.body.semester || activeSemester._id;

    // Prevent duplicate subject codes within the same semester
    const existingSubject = await Subject.findOne({
      user: req.user.id,
      semester: targetSemesterId,
      code: cleanCode,
    });

    if (existingSubject) {
      return res.status(400).json({
        success: false,
        message: `Subject code '${cleanCode}' is already registered in this semester.`,
      });
    }

    const creditNum = Number(credits) || 4;

    // 4-Credit Subject Lab Logic:
    // If credit is 4, determine lab section presence.
    // The lab code strictly inherits the parent subject code.
    let labData = {
      hasLab: false,
      labName: '',
      duration: 2,
      sessionsPerWeek: 1,
    };

    if (creditNum === 4 && (hasLab || labSection?.hasLab)) {
      labData = {
        hasLab: true,
        labName: (labSection?.labName || `${name.trim()} Lab`).trim(),
        duration: Number(labSection?.duration) || 2,
        sessionsPerWeek: Number(labSection?.sessionsPerWeek) || 1,
      };
    } else if (creditNum !== 4 && labSection?.hasLab) {
      labData = {
        hasLab: true,
        labName: (labSection.labName || `${name.trim()} Lab`).trim(),
        duration: Number(labSection.duration) || 2,
        sessionsPerWeek: Number(labSection.sessionsPerWeek) || 1,
      };
    }

    const subject = await Subject.create({
      user: req.user.id,
      semester: targetSemesterId,
      semesterNumber: activeSemester.semesterNumber,
      name: name.trim(),
      code: cleanCode,
      faculty: faculty ? faculty.trim() : '',
      credits: creditNum,
      type: type || 'Theory',
      color: color || '#6366f1',
      targetAttendance: Number(targetAttendance) || 75,
      theorySessionsPerWeek: Number(theorySessionsPerWeek) || 3,
      theoryDuration: Number(theoryDuration) || 1,
      labSection: labData,
      totalClasses: 0,
      attendedClasses: 0,
      labTotalClasses: 0,
      labAttendedClasses: 0,
    });

    return res.status(201).json({
      success: true,
      message: 'Subject registered successfully',
      subject: computeSubjectAttendance(subject),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Update subject & automatically synchronize inherited lab code
// @route   PUT /api/academics/subjects/:id
export const updateSubject = async (req, res) => {
  try {
    const subject = await Subject.findOne({ _id: req.params.id, user: req.user.id });
    if (!subject) return res.status(404).json({ success: false, message: 'Subject not found' });

    const {
      name,
      code,
      faculty,
      credits,
      type,
      color,
      targetAttendance,
      theorySessionsPerWeek,
      theoryDuration,
      hasLab,
      labSection,
    } = req.body;

    if (code && code.trim().toUpperCase() !== subject.code) {
      const cleanCode = code.trim().toUpperCase();
      const existing = await Subject.findOne({
        user: req.user.id,
        semester: subject.semester,
        code: cleanCode,
        _id: { $ne: subject._id },
      });
      if (existing) {
        return res.status(400).json({
          success: false,
          message: `Subject code '${cleanCode}' is already registered in this semester.`,
        });
      }
      subject.code = cleanCode;
      // Rule 5: Lab code automatically inherits parent subject code!
    }

    if (name) subject.name = name.trim();
    if (faculty !== undefined) subject.faculty = faculty.trim();
    if (credits !== undefined) subject.credits = Number(credits);
    if (type) subject.type = type;
    if (color) subject.color = color;
    if (targetAttendance !== undefined) subject.targetAttendance = Number(targetAttendance);
    if (theorySessionsPerWeek !== undefined) subject.theorySessionsPerWeek = Number(theorySessionsPerWeek);
    if (theoryDuration !== undefined) subject.theoryDuration = Number(theoryDuration);

    // Update Lab Section
    if (subject.credits === 4) {
      if (hasLab !== undefined || labSection !== undefined) {
        const isLabActive = hasLab !== undefined ? !!hasLab : !!labSection?.hasLab;
        subject.labSection = {
          hasLab: isLabActive,
          labName: isLabActive ? (labSection?.labName || `${subject.name} Lab`).trim() : '',
          duration: Number(labSection?.duration) || 2,
          sessionsPerWeek: Number(labSection?.sessionsPerWeek) || 1,
        };
      }
    } else if (labSection !== undefined) {
      subject.labSection = {
        hasLab: !!labSection.hasLab,
        labName: labSection.hasLab ? (labSection.labName || `${subject.name} Lab`).trim() : '',
        duration: Number(labSection.duration) || 2,
        sessionsPerWeek: Number(labSection.sessionsPerWeek) || 1,
      };
    }

    const saved = await subject.save();

    return res.status(200).json({
      success: true,
      message: 'Subject updated successfully',
      subject: computeSubjectAttendance(saved),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Delete subject and associated timetable slots and attendance
// @route   DELETE /api/academics/subjects/:id
export const deleteSubject = async (req, res) => {
  try {
    const subject = await Subject.findOneAndDelete({ _id: req.params.id, user: req.user.id });
    if (!subject) return res.status(404).json({ success: false, message: 'Subject not found' });

    await ClassSession.deleteMany({ subject: req.params.id });
    await Assignment.deleteMany({ subject: req.params.id });
    await Exam.deleteMany({ subject: req.params.id });
    await TimetableSlot.deleteMany({ subject: req.params.id });

    return res.status(200).json({ success: true, message: 'Subject and associated records deleted' });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==========================================
// 3. COLLEGE-STYLE TIMETABLE GRID & VALIDATION
// ==========================================

// @desc    Get College-Style Timetable Grid for active semester
// @route   GET /api/academics/timetable/grid
export const getTimetableGrid = async (req, res) => {
  try {
    const activeSemester = await getOrCreateActiveSemester(req.user.id);
    if (!activeSemester) {
      return res.status(200).json({
        success: true,
        semester: null,
        workingDays: [],
        timeSlots: [],
        grid: {},
        validation: { isValid: false, summary: [], conflicts: [], canActivate: false },
      });
    }
    const semesterId = req.query.semesterId || activeSemester._id;
    const semester = await Semester.findById(semesterId);

    if (!semester) {
      return res.status(404).json({ success: false, message: 'Semester not found' });
    }

    const workingDays = semester.workingDays || [
      'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'
    ];
    const timeSlots = semester.timeSlots || [];

    // Fetch all slots populated with subject
    const rawSlots = await TimetableSlot.find({
      user: req.user.id,
      $or: [{ semester: semester._id }, { semester: null }],
    }).populate('subject', 'name code color faculty credits theorySessionsPerWeek labSection');

    // Build the 2D grid: [day][slotIndex] -> slot object or null
    const grid = {};
    workingDays.forEach((day) => {
      grid[day] = {};
      timeSlots.forEach((ts) => {
        grid[day][ts.slotIndex] = null;
      });
    });

    rawSlots.forEach((slot) => {
      if (grid[slot.day] && slot.slotIndex !== undefined) {
        grid[slot.day][slot.slotIndex] = {
          _id: slot._id,
          day: slot.day,
          slotIndex: slot.slotIndex,
          start_time: slot.start_time,
          end_time: slot.end_time,
          entryType: slot.entryType || 'theory',
          subject: slot.subject,
          room: slot.room,
          colSpan: slot.colSpan || 1,
          isConsecutiveContinuation: !!slot.isConsecutiveContinuation,
        };
      }
    });

    // Compute Weekly Requirements Validation
    const subjects = await Subject.find({
      user: req.user.id,
      $or: [{ semester: semester._id }, { semester: null }],
    });

    const summary = [];
    const conflicts = [];
    let allValid = true;

    // Check counts per subject
    subjects.forEach((subj) => {
      const subjSlots = rawSlots.filter(
        (s) => s.subject && s.subject._id.toString() === subj._id.toString()
      );

      // Theory sessions (count only primary slots, not continuation)
      const theoryAssigned = subjSlots.filter(
        (s) => s.entryType === 'theory' && !s.isConsecutiveContinuation
      ).length;
      const theoryRequired = subj.theorySessionsPerWeek || 3;

      // Lab sessions
      const hasLab = !!subj.labSection?.hasLab;
      const labAssigned = subjSlots.filter(
        (s) => s.entryType === 'lab' && !s.isConsecutiveContinuation
      ).length;
      const labRequired = hasLab ? subj.labSection.sessionsPerWeek || 1 : 0;

      const isTheoryComplete = theoryAssigned === theoryRequired;
      const isLabComplete = !hasLab || labAssigned === labRequired;

      if (!isTheoryComplete || !isLabComplete) {
        allValid = false;
      }

      summary.push({
        subjectId: subj._id,
        name: subj.name,
        code: subj.code,
        theoryAssigned,
        theoryRequired,
        isTheoryComplete,
        hasLab,
        labAssigned,
        labRequired,
        isLabComplete,
      });
    });

    // Check for overlapping/conflicting slots on any day
    workingDays.forEach((day) => {
      const daySlots = rawSlots.filter((s) => s.day === day);
      const slotIndexCounts = {};
      daySlots.forEach((s) => {
        slotIndexCounts[s.slotIndex] = (slotIndexCounts[s.slotIndex] || 0) + 1;
        if (slotIndexCounts[s.slotIndex] > 1) {
          conflicts.push(`Duplicate/overlapping session on ${day} at slot #${s.slotIndex}`);
          allValid = false;
        }
      });
    });

    return res.status(200).json({
      success: true,
      semester,
      workingDays,
      timeSlots,
      grid,
      validation: {
        isValid: allValid && conflicts.length === 0,
        canActivate: allValid && conflicts.length === 0,
        summary,
        conflicts,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Assign or edit a timetable cell
// @route   POST /api/academics/timetable/cell
export const saveTimetableCell = async (req, res) => {
  try {
    const { day, slotIndex, entryType, subjectId, room } = req.body;
    const activeSemester = await getOrCreateActiveSemester(req.user.id);
    if (!activeSemester) {
      return res.status(400).json({ success: false, message: 'Create a semester before building the timetable.' });
    }
    const semesterId = req.body.semesterId || activeSemester._id;
    const semester = await Semester.findById(semesterId);

    if (!semester) return res.status(404).json({ success: false, message: 'Semester not found' });

    const timeSlots = semester.timeSlots || [];
    const currentSlot = timeSlots.find((ts) => ts.slotIndex === Number(slotIndex));
    if (!currentSlot) {
      return res.status(400).json({ success: false, message: 'Invalid slotIndex for semester' });
    }

    // 1. Clear any existing slot at this cell and its subsequent continuation
    const existing = await TimetableSlot.findOne({
      user: req.user.id,
      semester: semester._id,
      day,
      slotIndex: Number(slotIndex),
    });

    if (existing && existing.colSpan > 1) {
      // Also remove consecutive continuation slot
      await TimetableSlot.deleteMany({
        user: req.user.id,
        semester: semester._id,
        day,
        slotIndex: { $gt: Number(slotIndex), $lt: Number(slotIndex) + existing.colSpan },
        isConsecutiveContinuation: true,
      });
    }

    await TimetableSlot.deleteMany({
      user: req.user.id,
      semester: semester._id,
      day,
      slotIndex: Number(slotIndex),
    });

    // If entryType is 'free', cell is cleared
    if (entryType === 'free') {
      return res.status(200).json({ success: true, message: 'Cell cleared as Free Period' });
    }

    // Handle Break or Lunch
    if (entryType === 'break' || entryType === 'lunch') {
      await TimetableSlot.create({
        user: req.user.id,
        semester: semester._id,
        day,
        slotIndex: Number(slotIndex),
        start_time: currentSlot.startTime,
        end_time: currentSlot.endTime,
        entryType,
        subject: null,
        room: '',
        colSpan: 1,
        isConsecutiveContinuation: false,
      });
      return res.status(200).json({ success: true, message: `Cell marked as ${entryType.toUpperCase()}` });
    }

    // Theory or Lab
    const subject = await Subject.findOne({ _id: subjectId, user: req.user.id });
    if (!subject) {
      return res.status(404).json({ success: false, message: 'Subject not found' });
    }

    let colSpan = 1;

    // Multi-slot Lab Logic (Section 14 & 15: consecutive slot reservation)
    if (entryType === 'lab') {
      const labDurationHours = subject.labSection?.duration || 2;
      // Reserve consecutive slots if duration >= 2
      colSpan = Math.max(1, labDurationHours);

      const nextSlotIndex = Number(slotIndex) + 1;
      const nextSlot = timeSlots.find((ts) => ts.slotIndex === nextSlotIndex);

      if (colSpan > 1 && nextSlot) {
        // Clear any existing slot at nextSlotIndex
        await TimetableSlot.deleteMany({
          user: req.user.id,
          semester: semester._id,
          day,
          slotIndex: nextSlotIndex,
        });

        // Create consecutive continuation slot
        await TimetableSlot.create({
          user: req.user.id,
          semester: semester._id,
          day,
          slotIndex: nextSlotIndex,
          start_time: nextSlot.startTime,
          end_time: nextSlot.endTime,
          entryType: 'lab',
          subject: subject._id,
          room: room || '',
          colSpan: 1,
          isConsecutiveContinuation: true,
        });
      }
    }

    // Create primary slot
    const primarySlot = await TimetableSlot.create({
      user: req.user.id,
      semester: semester._id,
      day,
      slotIndex: Number(slotIndex),
      start_time: currentSlot.startTime,
      end_time: currentSlot.endTime,
      entryType,
      subject: subject._id,
      room: room || '',
      colSpan,
      isConsecutiveContinuation: false,
    });

    return res.status(200).json({
      success: true,
      message: `Assigned ${subject.name} (${entryType.toUpperCase()}) to ${day}`,
      slot: primarySlot,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Activate Timetable after validation
// @route   POST /api/academics/timetable/activate
export const activateTimetable = async (req, res) => {
  try {
    const activeSemester = await getOrCreateActiveSemester(req.user.id);
    if (!activeSemester) {
      return res.status(400).json({ success: false, message: 'Create a semester before activating a timetable.' });
    }
    activeSemester.isTimetableActivated = true;
    await activeSemester.save();

    return res.status(200).json({
      success: true,
      message: 'Weekly timetable has been validated and activated!',
      semester: activeSemester,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==========================================
// 4. SEMESTER SCHEDULE & EXCEPTIONS (HOLIDAYS)
// ==========================================

// @desc    Get all holidays / exceptions for the semester
// @route   GET /api/academics/exceptions
export const getSemesterExceptions = async (req, res) => {
  try {
    const activeSemester = await getOrCreateActiveSemester(req.user.id);
    if (!activeSemester) {
      return res.status(200).json({ success: true, exceptions: [] });
    }
    const exceptions = await SemesterException.find({
      user: req.user.id,
      semester: activeSemester._id,
    }).sort({ date: 1 });

    return res.status(200).json({ success: true, exceptions });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Add a holiday / exception (Holiday, Event, Exam, Cancelled)
// @route   POST /api/academics/exceptions
export const createSemesterException = async (req, res) => {
  try {
    const { date, type, title, notes } = req.body;
    if (!date || !title) {
      return res.status(400).json({ success: false, message: 'Date and Title are required' });
    }

    const activeSemester = await getOrCreateActiveSemester(req.user.id);
    if (!activeSemester) {
      return res.status(400).json({ success: false, message: 'Create a semester before adding exceptions.' });
    }

    const exception = await SemesterException.findOneAndUpdate(
      { user: req.user.id, semester: activeSemester._id, date },
      { type: type || 'holiday', title: title.trim(), notes: notes || '' },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return res.status(201).json({
      success: true,
      message: `Added ${type}: ${title}`,
      exception,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Delete a semester exception
// @route   DELETE /api/academics/exceptions/:id
export const deleteSemesterException = async (req, res) => {
  try {
    await SemesterException.findOneAndDelete({ _id: req.params.id, user: req.user.id });
    return res.status(200).json({ success: true, message: 'Exception removed' });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Helper: derive Day Name from YYYY-MM-DD
const getDayName = (dateStr) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[dt.getDay()];
};

// @desc    Get scheduled classes dynamically for any date with attendance status
// @route   GET /api/academics/today?date=YYYY-MM-DD
export const getTodaysClasses = async (req, res) => {
  try {
    // The browser's own day/now, not the server's (Render runs UTC).
    const { today: serverToday, nowMinutes } = studentNow(req.query.tzOffsetMinutes);
    const targetDate = req.query.date || serverToday;
    const dayName = getDayName(targetDate);
    const activeSemester = await getOrCreateActiveSemester(req.user.id);
    const isWithinSemester = !!activeSemester &&
      targetDate >= activeSemester.startDate && targetDate <= activeSemester.endDate;

    // No semester yet: honest empty response, nothing is derived or fabricated
    if (!activeSemester) {
      return res.status(200).json({
        success: true,
        date: targetDate,
        day: dayName,
        isWithinSemester: false,
        isHoliday: false,
        exception: null,
        classes: [],
      });
    }

    // 2. Check if date is a holiday or exception
    const exception = await SemesterException.findOne({
      user: req.user.id,
      semester: activeSemester._id,
      date: targetDate,
    });

    const isHoliday = exception && ['holiday', 'no_class', 'cancelled'].includes(exception.type);

    if (isHoliday) {
      return res.status(200).json({
        success: true,
        date: targetDate,
        day: dayName,
        isWithinSemester,
        isHoliday: true,
        exception,
        classes: [],
      });
    }

    // 3. Fetch scheduled timetable slots for this day of the week
    const slots = await TimetableSlot.find({
      user: req.user.id,
      $or: [{ semester: activeSemester._id }, { semester: null }],
      day: dayName,
      entryType: { $in: ['theory', 'lab'] },
      isConsecutiveContinuation: false, // Primary slots only
    })
      .populate('subject', 'name code color faculty attendedClasses totalClasses labAttendedClasses labTotalClasses targetAttendance credits')
      .sort({ slotIndex: 1, start_time: 1 });

    // 4. Fetch attendance records for this date
    const sessionRecords = await ClassSession.find({
      user: req.user.id,
      date: targetDate,
    });

    const sessionMap = new Map();
    sessionRecords.forEach((sess) => {
      if (sess.notes && sess.notes.startsWith('timetable:')) {
        const slotId = sess.notes.replace('timetable:', '');
        sessionMap.set(slotId, sess.status);
      } else if (sess.subject) {
        sessionMap.set(sess.subject.toString(), sess.status);
      }
    });

    // Attendance can only be recorded once the session has finished; the lock
    // state travels with each class so the UI matches what the API enforces.
    const todayLocal = serverToday;

    const classesWithStatus = slots
      .filter((s) => s.subject)
      .map((slot) => {
        const status = sessionMap.get(slot._id.toString()) || null;
        const endTime = effectiveSlotEndTime(slot, activeSemester);
        const lock = evaluateLock({
          date: targetDate,
          threshold: toMinutes(endTime),
          today: todayLocal,
          nowMinutes,
        });
        return {
          _id: slot._id,
          day: slot.day,
          start_time: slot.start_time,
          end_time: endTime,
          entryType: slot.entryType,
          room: slot.room,
          colSpan: slot.colSpan || 1,
          subject: slot.subject,
          markedStatus: status, // 'attended'/'present', 'missed'/'absent', 'cancelled'
          lockAt: lock.lockAt,
          locked: lock.locked && status !== 'cancelled',
          lockMessage: lock.locked && status !== 'cancelled' ? lockMessage(lock.lockAt, 'Attendance') : null,
        };
      });

    return res.status(200).json({
      success: true,
      date: targetDate,
      day: dayName,
      isWithinSemester,
      isHoliday: false,
      exception: exception || null,
      classes: classesWithStatus,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Mark attendance for a timetable slot (with Theory vs Lab separation)
// @route   POST /api/academics/timetable/:slotId/mark
export const markTimetableAttendance = async (req, res) => {
  try {
    const { status, date } = req.body; // status: 'present'/'attended', 'absent'/'missed', 'cancelled'
    const cleanStatus = status === 'present' ? 'attended' : status === 'absent' ? 'missed' : status;

    if (!['attended', 'missed', 'cancelled'].includes(cleanStatus)) {
      return res.status(400).json({
        success: false,
        message: 'status must be present/attended, absent/missed, or cancelled',
      });
    }

    // The student's own "today" — a browser-supplied timezone offset keeps
    // late-evening IST marking from counting against the UTC day.
    const serverToday = studentNow(req.body.tzOffsetMinutes).today;

    const todayStr = date || serverToday;

    // Strictly disallow future date marking
    if (todayStr > serverToday) {
      return res.status(400).json({
        success: false,
        message: 'Attendance cannot be marked for future dates.',
      });
    }

    const slot = await TimetableSlot.findOne({ _id: req.params.slotId, user: req.user.id })
      .populate('subject');

    if (!slot || !slot.subject) {
      return res.status(404).json({ success: false, message: 'Timetable slot or subject not found' });
    }

    // A class can only be marked once the session has finished. A 2-hour lab
    // ends with its last reserved slot, not with its first one. Marking a slot
    // as cancelled is never time-locked: it records that the class did not
    // happen, which can be known at any point.
    if (cleanStatus !== 'cancelled') {
      const semester = slot.semester
        ? await Semester.findById(slot.semester)
        : await Semester.findOne({ user: req.user.id, isActive: true });
      const endTime = effectiveSlotEndTime(slot, semester);
      const lock = evaluateLock({
        date: todayStr,
        threshold: toMinutes(endTime),
        today: serverToday,
        nowMinutes: studentNow(req.body.tzOffsetMinutes).nowMinutes,
      });

      if (lock.locked) {
        return res.status(400).json({
          success: false,
          code: 'TOO_EARLY',
          locked: true,
          lockAt: lock.lockAt,
          message: lockMessage(lock.lockAt, 'Attendance'),
        });
      }
    }

    const noteTag = `timetable:${slot._id}`;
    const sessionType = slot.entryType === 'lab' ? 'lab' : 'theory';

    const existing = await ClassSession.findOne({
      user: req.user.id,
      subject: slot.subject._id,
      date: todayStr,
      notes: noteTag,
    });

    const subject = await Subject.findById(slot.subject._id);

    if (existing) {
      const prevStatus = existing.status;
      existing.status = cleanStatus;
      existing.sessionType = sessionType;
      await existing.save();

      // Reverse previous counts based on sessionType (Theory vs Lab)
      if (sessionType === 'lab') {
        if (prevStatus === 'attended') subject.labAttendedClasses = Math.max(0, subject.labAttendedClasses - 1);
        if (prevStatus !== 'cancelled') subject.labTotalClasses = Math.max(0, subject.labTotalClasses - 1);

        if (cleanStatus === 'attended') {
          subject.labTotalClasses += 1;
          subject.labAttendedClasses += 1;
        } else if (cleanStatus === 'missed') {
          subject.labTotalClasses += 1;
        }
      } else {
        // Theory
        if (prevStatus === 'attended') subject.attendedClasses = Math.max(0, subject.attendedClasses - 1);
        if (prevStatus !== 'cancelled') subject.totalClasses = Math.max(0, subject.totalClasses - 1);

        if (cleanStatus === 'attended') {
          subject.totalClasses += 1;
          subject.attendedClasses += 1;
        } else if (cleanStatus === 'missed') {
          subject.totalClasses += 1;
        }
      }
    } else {
      await ClassSession.create({
        user: req.user.id,
        semester: slot.semester || subject.semester,
        subject: slot.subject._id,
        sessionType,
        date: todayStr,
        status: cleanStatus,
        notes: noteTag,
      });

      if (sessionType === 'lab') {
        if (cleanStatus === 'attended') {
          subject.labTotalClasses += 1;
          subject.labAttendedClasses += 1;
        } else if (cleanStatus === 'missed') {
          subject.labTotalClasses += 1;
        }
      } else {
        if (cleanStatus === 'attended') {
          subject.totalClasses += 1;
          subject.attendedClasses += 1;
        } else if (cleanStatus === 'missed') {
          subject.totalClasses += 1;
        }
      }
    }

    await subject.save();

    // Absence recorded → optional in-app notification (only if the student
    // enabled the attendance category with the in-app channel).
    if (cleanStatus === 'missed') {
      const { pushImmediateNotification } = await import('../services/notificationEngine.js');
      await pushImmediateNotification({
        userId: req.user.id,
        category: 'attendance',
        title: 'Absence recorded',
        body: `An absence was recorded for ${subject.name} — review it in Attendance → History.`,
        link: '/academics?tab=attendance',
        // Best effort: a notification failure must not fail the attendance
        // update, but it must not disappear silently either.
      }).catch((err) => console.warn('[notifications] absence notify failed:', err.message));
    }

    return res.status(200).json({
      success: true,
      message: `Marked as ${cleanStatus === 'attended' ? 'Present' : cleanStatus === 'missed' ? 'Absent' : 'Cancelled'}`,
      subject: computeSubjectAttendance(subject),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get detailed subject-wise and lab-wise attendance history
// @route   GET /api/academics/attendance/history
export const getAttendanceHistory = async (req, res) => {
  try {
    const filter = { user: req.user.id };
    if (req.query.subjectId) filter.subject = req.query.subjectId;
    if (req.query.sessionType) filter.sessionType = req.query.sessionType;

    const sessions = await ClassSession.find(filter)
      .populate('subject', 'name code color')
      .sort({ date: -1 });

    return res.status(200).json({
      success: true,
      count: sessions.length,
      history: sessions,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==========================================
// 5. LEGACY & COMPATIBILITY HELPERS
// ==========================================

export const getAcademicOverview = async (req, res) => {
  try {
    const activeSemester = await getOrCreateActiveSemester(req.user.id);
    const subjects = activeSemester
      ? await Subject.find({
          user: req.user.id,
          $or: [{ semester: activeSemester._id }, { semester: null }],
        })
      : [];

    const assignments = await Assignment.find({ user: req.user.id })
      .populate('subject', 'name code color')
      .sort({ deadline: 1 });

    const exams = await Exam.find({ user: req.user.id })
      .populate('subject', 'name code color')
      .sort({ date: 1 });

    const subjectsWithMetrics = subjects.map(computeSubjectAttendance);

    // Attach the recorded ABL/quiz/internal dates so Today can surface real
    // academic reminders (only subjects with a saved Assessment doc have any).
    const assessmentDocs = await Assessment.find({ user: req.user.id, semester: activeSemester?._id })
      .select(
        'subject internals.internal_1 internals.internal_2 internals.internalDates abls.number abls.submissionDate abls.status quizzes.number quizzes.quizDate quizzes.attendance labInternal'
      )
      .lean();
    const assessmentBySubject = new Map(assessmentDocs.map((d) => [String(d.subject), d]));
    subjectsWithMetrics.forEach((s) => {
      const a = assessmentBySubject.get(String(s._id));
      s.abls = a?.abls || [];
      s.quizzes = a?.quizzes || [];
      s.labInternal = a?.labInternal || null;
    });

    const totalClassesAll = subjectsWithMetrics.reduce((acc, s) => acc + s.overallTotal, 0);
    const totalAttendedAll = subjectsWithMetrics.reduce((acc, s) => acc + s.overallAttended, 0);
    // No recorded classes => no aggregate percentage (never fabricate 100%)
    const aggregateAttendance =
      totalClassesAll > 0 ? Math.round((totalAttendedAll / totalClassesAll) * 1000) / 10 : 0;

    const atRiskSubjects = subjectsWithMetrics.filter((s) => !s.isSafe);
    const pendingAssignments = assignments.filter(
      (a) => a.status !== 'submitted' && a.status !== 'graded'
    );

    return res.status(200).json({
      success: true,
      activeSemester,
      aggregateAttendance,
      totalClasses: totalClassesAll,
      totalAttended: totalAttendedAll,
      subjects: subjectsWithMetrics,
      atRiskCount: atRiskSubjects.length,
      atRiskSubjects,
      pendingAssignments,
      upcomingExams: exams,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ==========================================
// ASSESSMENTS — fixed academic structure
//
// Every subject carries exactly: Internal 1 & 2 (/50), ABL 1 & 2 (/20 with a
// required submission date), Quiz 1 & 2 (/20 with a required date and
// explicit attendance). One Assessment document per subject per semester;
// reads normalise it to exactly that shape, writes validate the fixed bounds.
// ==========================================

const ABL_MAX = 20;
const QUIZ_MAX = 20;
const INTERNAL_MAX = 50;
const LAB_INTERNAL_MAX = 20; // mirrors the existing lab_exam weightage default

const cleanInt = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
};

const upsertAbl = (list, number, patch) => {
  let entry = list.find((a) => a.number === number);
  if (!entry) {
    entry = { number, submissionDate: null, marks: null, status: 'pending', notes: '' };
    list.push(entry);
  }
  Object.assign(entry, patch);
};

const upsertQuiz = (list, number, patch) => {
  let entry = list.find((q) => q.number === number);
  if (!entry) {
    entry = { number, quizDate: null, attendance: 'not_recorded', marks: null };
    list.push(entry);
  }
  Object.assign(entry, patch);
};

export const getAssessment = async (req, res) => {
  try {
    const { subjectId } = req.params;
    const subject = await Subject.findOne({ _id: subjectId, user: req.user.id });
    if (!subject) return res.status(404).json({ success: false, message: 'Subject not found.' });

    const activeSemester = await getOrCreateActiveSemester(req.user.id);
    let doc = await Assessment.findOne({ user: req.user.id, subject: subject._id });
    if (!doc) {
      // Shape-only scaffold — nothing is stored until the student records data.
      return res.json({
        success: true,
        assessment: {
          _id: null,
          subject: subject._id,
          semester: activeSemester?._id || null,
          internals: {
            internal_1: null,
            internal_2: null,
            internalDates: { internal_1: null, internal_2: null },
          },
          labInternal: { date: null, marks: null, notes: '' },
          abls: [
            { number: 1, submissionDate: null, marks: null, status: 'pending', notes: '' },
            { number: 2, submissionDate: null, marks: null, status: 'pending', notes: '' },
          ],
          quizzes: [
            { number: 1, quizDate: null, attendance: 'not_recorded', marks: null },
            { number: 2, quizDate: null, attendance: 'not_recorded', marks: null },
          ],
        },
        subject: { _id: subject._id, name: subject.name, code: subject.code, hasLab: !!subject.labSection?.hasLab },
      });
    }
    return res.json({ success: true, assessment: doc });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const saveAssessment = async (req, res) => {
  try {
    const { subjectId } = req.params;
    const subject = await Subject.findOne({ _id: subjectId, user: req.user.id });
    if (!subject) return res.status(404).json({ success: false, message: 'Subject not found.' });

    const activeSemester = await getOrCreateActiveSemester(req.user.id);
    if (!activeSemester) {
      return res.status(400).json({ success: false, message: 'Activate a semester first.' });
    }

    const body = req.body || {};
    const errors = [];
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    let touchesDate = false;

    /* ------------------------------------------------------------------
     * Merge semantics: only the fields the student actually edited are
     * applied. Every assessment (Internal 1/2, ABL 1/2, Quiz 1/2, Lab
     * internal) is updated on its own — an omitted field keeps its stored
     * value, an explicit null clears it, and nothing is ever replaced with
     * a default because it was left out of the payload. Validation runs only
     * on the values being written, so an empty unrelated assessment can never
     * block a save.
     * ------------------------------------------------------------------ */

    const existing = await Assessment.findOne({
      user: req.user.id,
      semester: activeSemester._id,
      subject: subject._id,
    }).lean();

    const baseInternals = existing?.internals || {};
    const internals = {
      internal_1: baseInternals.internal_1 ?? null,
      internal_2: baseInternals.internal_2 ?? null,
      internalDates: {
        internal_1: baseInternals.internalDates?.internal_1 ?? null,
        internal_2: baseInternals.internalDates?.internal_2 ?? null,
      },
    };

    const has = (obj, key) => obj && Object.prototype.hasOwnProperty.call(obj, key);
    const normDate = (raw) => (raw === null || raw === undefined || raw === '' ? null : String(raw).slice(0, 10));

    // --- Internals: marks (0–50) and assessment date, each independent ---
    if (body.internals && typeof body.internals === 'object') {
      const inc = body.internals;
      for (const key of ['internal_1', 'internal_2']) {
        const label = key === 'internal_1' ? 'Internal 1' : 'Internal 2';

        if (has(inc, key)) {
          const v = cleanInt(inc[key]);
          if (v !== null && (v < 0 || v > INTERNAL_MAX)) {
            errors.push(`${label} marks must be between 0 and ${INTERNAL_MAX}.`);
          }
          internals[key] = v; // null stays null — never 0
        }

        // The date is the actual scheduled assessment date entered by the
        // student — never a record-creation timestamp.
        const dateKey = key;
        const legacyKey = `${key}Date`;
        const fromNested = has(inc.internalDates, dateKey);
        if (fromNested || has(inc, legacyKey)) {
          const raw = fromNested ? inc.internalDates[dateKey] : inc[legacyKey];
          const d = normDate(raw);
          if (d !== null && !dateRe.test(d)) {
            errors.push(`${label} date must be a valid date.`);
          }
          internals.internalDates[key] = d;
          touchesDate = true;
        }
      }
    }

    // --- ABLs: 1 & 2, marks /20, due date and status all independent ---
    const baseAbl = (n) => existing?.abls?.find((a) => Number(a.number) === n) || {};
    const abls = [1, 2].map((n) => {
      const stored = baseAbl(n);
      const entry = {
        number: n,
        submissionDate: stored.submissionDate ?? null,
        marks: stored.marks ?? null,
        status: stored.status === 'submitted' ? 'submitted' : 'pending',
        notes: stored.notes || '',
      };
      const incoming = Array.isArray(body.abls) ? body.abls.find((a) => Number(a?.number) === n) : null;
      if (incoming) {
        if (has(incoming, 'marks')) {
          const m = cleanInt(incoming.marks);
          if (m !== null && (m < 0 || m > ABL_MAX)) {
            errors.push(`ABL ${n} marks must be between 0 and ${ABL_MAX}.`);
          }
          entry.marks = m;
        }
        if (has(incoming, 'submissionDate')) {
          const d = normDate(incoming.submissionDate);
          if (d !== null && !dateRe.test(d)) errors.push(`ABL ${n} date must be a valid date.`);
          entry.submissionDate = d;
          touchesDate = true;
        }
        if (has(incoming, 'status')) {
          entry.status = incoming.status === 'submitted' ? 'submitted' : 'pending';
        }
        if (has(incoming, 'notes')) {
          entry.notes = typeof incoming.notes === 'string' ? incoming.notes.slice(0, 500) : '';
        }
      }
      return entry;
    });

    // --- Quizzes: 1 & 2, date / attendance / marks each independent ---
    const baseQuiz = (n) => existing?.quizzes?.find((q) => Number(q.number) === n) || {};
    const quizzes = [1, 2].map((n) => {
      const stored = baseQuiz(n);
      const entry = {
        number: n,
        quizDate: stored.quizDate ?? null,
        attendance: ['not_recorded', 'attended', 'not_attended'].includes(stored.attendance)
          ? stored.attendance
          : 'not_recorded',
        marks: stored.marks ?? null,
      };
      const incoming = Array.isArray(body.quizzes) ? body.quizzes.find((q) => Number(q?.number) === n) : null;
      if (incoming) {
        if (has(incoming, 'quizDate')) {
          const d = normDate(incoming.quizDate);
          if (d !== null && !dateRe.test(d)) errors.push(`Quiz ${n} date must be a valid date.`);
          entry.quizDate = d;
          touchesDate = true;
        }
        if (has(incoming, 'attendance')) {
          entry.attendance = ['not_recorded', 'attended', 'not_attended'].includes(incoming.attendance)
            ? incoming.attendance
            : 'not_recorded';
        }
        if (has(incoming, 'marks')) {
          const m = cleanInt(incoming.marks);
          if (m !== null && (m < 0 || m > QUIZ_MAX)) {
            errors.push(`Quiz ${n} marks must be between 0 and ${QUIZ_MAX}.`);
          }
          entry.marks = m; // stored as entered; attendance never rewrites it
        }
      }
      return entry;
    });

    // --- Lab internal: date / marks / notes, never coupled ---
    const storedLab = existing?.labInternal || {};
    const labInternal = {
      date: storedLab.date ?? null, // the reminder source — independent of marks
      marks: storedLab.marks ?? null, // academic record only; null stays null, never 0
      notes: storedLab.notes || '',
    };
    if (body.labInternal && typeof body.labInternal === 'object') {
      const inc = body.labInternal;
      if (has(inc, 'date')) {
        const d = normDate(inc.date);
        if (d !== null && !dateRe.test(d)) errors.push('Lab internal date must be a valid date.');
        labInternal.date = d;
        touchesDate = true;
      }
      if (has(inc, 'marks')) {
        const m = cleanInt(inc.marks);
        if (m !== null && (m < 0 || m > LAB_INTERNAL_MAX)) {
          errors.push(`Lab internal marks must be between 0 and ${LAB_INTERNAL_MAX}.`);
        }
        labInternal.marks = m;
      }
      if (has(inc, 'notes')) {
        labInternal.notes = typeof inc.notes === 'string' ? inc.notes.slice(0, 500) : '';
      }
    }

    if (errors.length) {
      return res.status(400).json({ success: false, message: errors.join(' '), errors });
    }

    const doc = await Assessment.findOneAndUpdate(
      { user: req.user.id, semester: activeSemester._id, subject: subject._id },
      { $set: { internals, abls, quizzes, labInternal } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    // Marks are academic records only: they never create, move or cancel a
    // reminder, so the reminder graph is only recomputed when a date changed.
    if (touchesDate) {
      syncUserReminders(req.user.id).catch(() => {});
    }

    return res.json({ success: true, assessment: doc });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Semester-wide assessment table for the Internals / ABL / Quizzes tabs.
export const getAssessmentsSummary = async (req, res) => {
  try {
    const activeSemester = await getOrCreateActiveSemester(req.user.id);
    if (!activeSemester) {
      return res.json({ success: true, subjects: [], assessments: [] });
    }
    const subjects = await Subject.find({
      user: req.user.id,
      $or: [{ semester: activeSemester._id }, { semester: null }],
    }).sort({ name: 1 });
    const docs = await Assessment.find({ user: req.user.id, semester: activeSemester._id });
    return res.json({ success: true, subjects, assessments: docs });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getTimetable = async (req, res) => {
  try {
    const activeSemester = await getOrCreateActiveSemester(req.user.id);
    if (!activeSemester) {
      return res.status(200).json({ success: true, slots: [] });
    }
    const slots = await TimetableSlot.find({
      user: req.user.id,
      $or: [{ semester: activeSemester._id }, { semester: null }],
    }).populate('subject', 'name code color faculty attendedClasses totalClasses targetAttendance');

    return res.status(200).json({ success: true, slots });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createTimetableSlot = async (req, res) => {
  try {
    const activeSemester = await getOrCreateActiveSemester(req.user.id);
    if (!activeSemester) {
      return res.status(400).json({ success: false, message: 'Create a semester before adding timetable slots.' });
    }
    const { subject, day, start_time, end_time, room, effective_from } = req.body;

    const slot = await TimetableSlot.create({
      user: req.user.id,
      semester: activeSemester._id,
      subject,
      day,
      start_time,
      end_time,
      room: room || '',
      effective_from: effective_from || activeSemester.startDate,
    });

    const populated = await TimetableSlot.findById(slot._id).populate('subject');
    syncUserReminders(req.user.id).catch(() => {}); // schedule changed → class/lab reminders recalc
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteTimetableSlot = async (req, res) => {
  try {
    await TimetableSlot.findOneAndDelete({ _id: req.params.id, user: req.user.id });
    syncUserReminders(req.user.id).catch(() => {}); // schedule changed → class/lab reminders recalc
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getWeekAttendance = async (req, res) => {
  try {
    let monday;
    if (req.query.startDate) {
      const [y, m, d] = req.query.startDate.split('-').map(Number);
      monday = new Date(y, m - 1, d);
    } else {
      monday = new Date();
      const dow = monday.getDay();
      const diff = dow === 0 ? -6 : 1 - dow;
      monday.setDate(monday.getDate() + diff);
    }

    const weekDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dates = weekDays.map((dayName, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const y = d.getFullYear();
      const mo = String(d.getMonth() + 1).padStart(2, '0');
      const dy = String(d.getDate()).padStart(2, '0');
      return { dayName, dateStr: `${y}-${mo}-${dy}` };
    });

    const activeSemester = await getOrCreateActiveSemester(req.user.id);
    if (!activeSemester) {
      return res.status(200).json({ success: true, week: [] });
    }
    const allSlots = await TimetableSlot.find({
      user: req.user.id,
      $or: [{ semester: activeSemester._id }, { semester: null }],
    })
      .populate('subject', 'name code color faculty attendedClasses totalClasses targetAttendance')
      .sort({ slotIndex: 1, start_time: 1 });

    const week = await Promise.all(
      dates.map(async ({ dayName, dateStr }) => {
        const daySlots = allSlots.filter((s) => s.day === dayName && !s.isConsecutiveContinuation);
        const slotsWithStatus = await Promise.all(
          daySlots.map(async (slot) => {
            const session = await ClassSession.findOne({
              user: req.user.id,
              subject: slot.subject?._id,
              date: dateStr,
              notes: `timetable:${slot._id}`,
            });
            return {
              ...slot.toObject(),
              markedStatus: session ? session.status : null,
              sessionId: session ? session._id : null,
            };
          })
        );
        return { dayName, dateStr, slots: slotsWithStatus };
      })
    );

    const mondayY = monday.getFullYear();
    const mondayM = String(monday.getMonth() + 1).padStart(2, '0');
    const mondayD = String(monday.getDate()).padStart(2, '0');

    return res.status(200).json({
      success: true,
      weekStart: `${mondayY}-${mondayM}-${mondayD}`,
      week,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const logAttendance = async (req, res) => {
  try {
    const { status, date, notes } = req.body;
    const subject = await Subject.findOne({ _id: req.params.id, user: req.user.id });
    if (!subject) return res.status(404).json({ success: false, message: 'Subject not found' });

    const todayStr = date || new Date().toISOString().split('T')[0];

    await ClassSession.create({
      user: req.user.id,
      subject: subject._id,
      date: todayStr,
      status: status || 'attended',
      notes: notes || '',
    });

    if (status === 'attended') {
      subject.totalClasses += 1;
      subject.attendedClasses += 1;
    } else if (status === 'missed') {
      subject.totalClasses += 1;
    }

    const saved = await subject.save();

    return res.status(200).json({
      success: true,
      message: `Attendance marked as ${status}`,
      subject: computeSubjectAttendance(saved),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getAssignments = async (req, res) => {
  try {
    const assignments = await Assignment.find({ user: req.user.id })
      .populate('subject', 'name code color')
      .sort({ deadline: 1 });
    return res.status(200).json({ success: true, assignments });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createAssignment = async (req, res) => {
  try {
    const assignment = await Assignment.create({ ...req.body, user: req.user.id });
    syncUserReminders(req.user.id).catch(() => {}); // refresh scheduled reminders (non-blocking)
    const populated = await Assignment.findById(assignment._id).populate('subject', 'name code color');
    return res.status(201).json({ success: true, assignment: populated });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateAssignmentStatus = async (req, res) => {
  try {
    const assignment = await Assignment.findOneAndUpdate(
      { _id: req.params.id, user: req.user.id },
      { status: req.body.status },
      { new: true }
    ).populate('subject', 'name code color');
    syncUserReminders(req.user.id).catch(() => {}); // submitted/graded = reminders recalculated away
    return res.status(200).json({ success: true, assignment });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getExams = async (req, res) => {
  try {
    const exams = await Exam.find({ user: req.user.id })
      .populate('subject', 'name code color')
      .sort({ date: 1 });
    return res.status(200).json({ success: true, exams });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createExam = async (req, res) => {
  try {
    const exam = await Exam.create({ ...req.body, user: req.user.id });
    syncUserReminders(req.user.id).catch(() => {}); // refresh scheduled reminders (non-blocking)
    const populated = await Exam.findById(exam._id).populate('subject', 'name code color');
    return res.status(201).json({ success: true, exam: populated });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const toggleExamTopic = async (req, res) => {
  try {
    const { topicIndex } = req.body;
    const exam = await Exam.findOne({ _id: req.params.id, user: req.user.id });
    if (!exam) return res.status(404).json({ success: false, message: 'Exam not found' });

    if (exam.syllabus[topicIndex]) {
      exam.syllabus[topicIndex].completed = !exam.syllabus[topicIndex].completed;
      await exam.save();
    }
    return res.status(200).json({ success: true, exam });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
