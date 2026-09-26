import { Activity } from '../models/Activity.js';
import { Subject, ClassSession, Assignment, Exam } from '../models/Academic.js';
import { CodingProblem, Skill, Project } from '../models/TechnicalGrowth.js';
import { DailyReview } from '../models/Productivity.js';

export const seedStudentData = async (req, res) => {
  try {
    const userId = req.user.id;
    const todayStr = new Date().toISOString().split('T')[0];

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    const threeDays = new Date();
    threeDays.setDate(threeDays.getDate() + 3);
    const threeDaysStr = threeDays.toISOString().split('T')[0];

    const fiveDays = new Date();
    fiveDays.setDate(fiveDays.getDate() + 5);
    const fiveDaysStr = fiveDays.toISOString().split('T')[0];

    const sixDays = new Date();
    sixDays.setDate(sixDays.getDate() + 6);
    const sixDaysStr = sixDays.toISOString().split('T')[0];

    // 1. Clean existing records for this user
    await Promise.all([
      Activity.deleteMany({ user: userId }),
      Subject.deleteMany({ user: userId }),
      ClassSession.deleteMany({ user: userId }),
      Assignment.deleteMany({ user: userId }),
      Exam.deleteMany({ user: userId }),
      CodingProblem.deleteMany({ user: userId }),
      Skill.deleteMany({ user: userId }),
      Project.deleteMany({ user: userId }),
      DailyReview.deleteMany({ user: userId }),
    ]);

    // 2. Seed Subjects
    const subjects = await Subject.insertMany([
      {
        user: userId,
        name: 'Database Management Systems',
        code: 'CS601',
        faculty: 'Dr. R. Sharma',
        credits: 4,
        totalClasses: 32,
        attendedClasses: 28, // 87.5% -> Safe buffer (5 safe bunks)
        targetAttendance: 75,
        color: '#6366f1',
      },
      {
        user: userId,
        name: 'Operating Systems',
        code: 'CS602',
        faculty: 'Prof. A. Kulkarni',
        credits: 4,
        totalClasses: 30,
        attendedClasses: 23, // 76.7% -> Safe buffer (0 safe bunks)
        targetAttendance: 75,
        color: '#06b6d4',
      },
      {
        user: userId,
        name: 'Computer Networks',
        code: 'CS603',
        faculty: 'Dr. V. Nambiar',
        credits: 4,
        totalClasses: 26,
        attendedClasses: 18, // 69.2% -> In Danger Zone (Needs 6 classes)
        targetAttendance: 75,
        color: '#f43f5e',
      },
      {
        user: userId,
        name: 'Software Engineering & Agile',
        code: 'CS604',
        faculty: 'Prof. M. Verma',
        credits: 3,
        totalClasses: 22,
        attendedClasses: 21, // 95.5% -> Very Safe (6 safe bunks)
        targetAttendance: 75,
        color: '#10b981',
      },
    ]);

    // 3. Seed Student Day Timeline for Today
    await Activity.insertMany([
      {
        user: userId,
        title: 'Morning Workout & Routine',
        category: 'health',
        date: todayStr,
        planned_start: '07:00',
        planned_end: '08:00',
        planned_duration: 60,
        actual_start: '07:05',
        actual_end: '08:00',
        actual_duration: 55,
        status: 'completed',
        academicImportance: 'low',
        notes: 'Cardio & core workout',
      },
      {
        user: userId,
        title: 'DBMS Lecture: B+ Trees & Indexing',
        category: 'academic',
        date: todayStr,
        planned_start: '09:00',
        planned_end: '10:30',
        planned_duration: 90,
        actual_start: '09:00',
        actual_end: '10:25',
        actual_duration: 85,
        status: 'completed',
        academicImportance: 'high',
        notes: 'Room 304, Lecture Hall B',
      },
      {
        user: userId,
        title: 'Operating Systems: Virtual Memory Management',
        category: 'academic',
        date: todayStr,
        planned_start: '10:45',
        planned_end: '12:15',
        planned_duration: 90,
        actual_start: '10:45',
        actual_end: '12:15',
        actual_duration: 90,
        status: 'completed',
        academicImportance: 'high',
        notes: 'Paging algorithms & TLB misses',
      },
      {
        user: userId,
        title: 'Lunch & Campus Walk',
        category: 'health',
        date: todayStr,
        planned_start: '12:30',
        planned_end: '13:30',
        planned_duration: 60,
        actual_start: '12:30',
        actual_end: '13:30',
        actual_duration: 60,
        status: 'completed',
        academicImportance: 'low',
      },
      {
        user: userId,
        title: 'Computer Networks Lab: Socket Programming',
        category: 'academic',
        date: todayStr,
        planned_start: '14:00',
        planned_end: '16:30',
        planned_duration: 150,
        actual_start: '14:00',
        actual_end: '16:30',
        actual_duration: 150,
        status: 'completed',
        academicImportance: 'critical',
        notes: 'TCP Multi-client chat server in C++',
      },
      {
        user: userId,
        title: 'DSA / LeetCode Deep Work',
        category: 'coding',
        date: todayStr,
        planned_start: '17:30',
        planned_end: '19:00',
        planned_duration: 90,
        actual_start: '17:30',
        status: 'in_progress',
        academicImportance: 'high',
        notes: 'Target: 2 Sliding Window + 1 Tree BFS problem',
      },
      {
        user: userId,
        title: 'Engineering Project Sprint (StudentOS)',
        category: 'project',
        date: todayStr,
        planned_start: '19:30',
        planned_end: '21:00',
        planned_duration: 90,
        status: 'scheduled',
        academicImportance: 'medium',
        notes: 'Implement deadline radar and review modal',
      },
      {
        user: userId,
        title: 'Daily Revision & Record Prep',
        category: 'academic',
        date: todayStr,
        planned_start: '21:30',
        planned_end: '22:30',
        planned_duration: 60,
        status: 'scheduled',
        academicImportance: 'medium',
      },
    ]);

    // 4. Seed Assignments
    await Assignment.insertMany([
      {
        user: userId,
        subject: subjects[0]._id, // DBMS
        title: 'B+ Tree Indexing & Query Optimization Record',
        description: 'Implement B+ tree search and calculate I/O cost reduction',
        deadline: tomorrowStr,
        status: 'pending',
        priority: 'high',
        maxMarks: 15,
      },
      {
        user: userId,
        subject: subjects[1]._id, // OS
        title: 'Page Replacement Algorithms Simulation',
        description: 'Simulate FIFO, LRU, and Optimal page replacement in C++',
        deadline: threeDaysStr,
        status: 'in_progress',
        priority: 'medium',
        maxMarks: 10,
      },
      {
        user: userId,
        subject: subjects[2]._id, // CN
        title: 'Wireshark Packet Analysis Lab Report',
        description: 'Analyze TCP 3-way handshake and HTTP/2 multiplexing frames',
        deadline: fiveDaysStr,
        status: 'pending',
        priority: 'high',
        maxMarks: 20,
      },
    ]);

    // 5. Seed Exams
    await Exam.insertMany([
      {
        user: userId,
        subject: subjects[0]._id,
        title: 'DBMS Internal Assessment 1',
        type: 'internal_1',
        date: sixDaysStr,
        weightage: 20,
        syllabus: [
          { topic: 'Relational Model & Constraints', completed: true },
          { topic: 'Relational Algebra & Tuple Calculus', completed: true },
          { topic: 'SQL Joins, Views & Subqueries', completed: true },
          { topic: 'B+ Tree Indexing & Hashing', completed: false },
        ],
      },
      {
        user: userId,
        subject: subjects[1]._id,
        title: 'Operating Systems Internal Assessment 1',
        type: 'internal_1',
        date: '2026-10-02',
        weightage: 20,
        syllabus: [
          { topic: 'Process Management & Fork()', completed: true },
          { topic: 'CPU Scheduling Algorithms', completed: true },
          { topic: 'Semaphores & Mutex Locks', completed: false },
          { topic: 'Deadlock Detection & Banker Algorithm', completed: false },
        ],
      },
    ]);

    // 6. Seed DSA Problems
    await CodingProblem.insertMany([
      {
        user: userId,
        title: '238. Product of Array Except Self',
        difficulty: 'medium',
        topic: 'Arrays',
        platform: 'LeetCode',
        language: 'C++',
        timeSpentMinutes: 35,
        date: todayStr,
      },
      {
        user: userId,
        title: '3. Longest Substring Without Repeating Characters',
        difficulty: 'medium',
        topic: 'Sliding Window',
        platform: 'LeetCode',
        language: 'C++',
        timeSpentMinutes: 40,
        date: todayStr,
      },
      {
        user: userId,
        title: '206. Reverse Linked List',
        difficulty: 'easy',
        topic: 'Linked Lists',
        platform: 'LeetCode',
        language: 'C++',
        timeSpentMinutes: 15,
        date: todayStr,
      },
      {
        user: userId,
        title: '102. Binary Tree Level Order Traversal',
        difficulty: 'medium',
        topic: 'Trees',
        platform: 'LeetCode',
        language: 'C++',
        timeSpentMinutes: 30,
        date: '2026-09-18',
      },
      {
        user: userId,
        title: '200. Number of Islands',
        difficulty: 'medium',
        topic: 'Graphs',
        platform: 'LeetCode',
        language: 'C++',
        timeSpentMinutes: 45,
        date: '2026-09-17',
      },
      {
        user: userId,
        title: '70. Climbing Stairs',
        difficulty: 'easy',
        topic: 'DP',
        platform: 'LeetCode',
        language: 'C++',
        timeSpentMinutes: 20,
        date: '2026-09-16',
      },
    ]);

    // 7. Seed Engineering Skills
    await Skill.insertMany([
      {
        user: userId,
        category: 'Computer Science',
        name: 'DSA',
        currentLevel: 4,
        targetLevel: 5,
        practiceHours: 68,
        problemsSolved: 124,
        projectsCount: 2,
        lastPracticed: todayStr,
      },
      {
        user: userId,
        category: 'Computer Science',
        name: 'DBMS',
        currentLevel: 4,
        targetLevel: 5,
        practiceHours: 45,
        problemsSolved: 28,
        projectsCount: 2,
        lastPracticed: todayStr,
      },
      {
        user: userId,
        category: 'Computer Science',
        name: 'Operating Systems',
        currentLevel: 3,
        targetLevel: 5,
        practiceHours: 35,
        problemsSolved: 16,
        projectsCount: 1,
        lastPracticed: todayStr,
      },
      {
        user: userId,
        category: 'Computer Science',
        name: 'Computer Networks',
        currentLevel: 3,
        targetLevel: 4,
        practiceHours: 30,
        problemsSolved: 12,
        projectsCount: 1,
        lastPracticed: todayStr,
      },
      {
        user: userId,
        category: 'Programming',
        name: 'C++',
        currentLevel: 4,
        targetLevel: 5,
        practiceHours: 85,
        problemsSolved: 95,
        projectsCount: 2,
        lastPracticed: todayStr,
      },
      {
        user: userId,
        category: 'Programming',
        name: 'Python',
        currentLevel: 4,
        targetLevel: 5,
        practiceHours: 60,
        problemsSolved: 40,
        projectsCount: 3,
        lastPracticed: '2026-09-18',
      },
      {
        user: userId,
        category: 'Development',
        name: 'React 18 & Frontend',
        currentLevel: 4,
        targetLevel: 5,
        practiceHours: 90,
        problemsSolved: 15,
        projectsCount: 3,
        lastPracticed: todayStr,
      },
      {
        user: userId,
        category: 'Development',
        name: 'Node.js & Express',
        currentLevel: 4,
        targetLevel: 5,
        practiceHours: 75,
        problemsSolved: 20,
        projectsCount: 3,
        lastPracticed: todayStr,
      },
      {
        user: userId,
        category: 'AI/ML',
        name: 'Machine Learning',
        currentLevel: 2,
        targetLevel: 4,
        practiceHours: 25,
        problemsSolved: 8,
        projectsCount: 1,
        lastPracticed: '2026-09-15',
      },
    ]);

    // 8. Seed Engineering Projects
    await Project.insertMany([
      {
        user: userId,
        title: 'StudentOS (Daily Routine Tracker)',
        goal: 'Specialized Student Life Operating System with planned-vs-actual tracking, attendance safety heuristics, and DSA streak engine.',
        techStack: ['React 18', 'Tailwind CSS', 'Node.js', 'Express', 'MongoDB'],
        githubUrl: 'https://github.com/pavans/studentos',
        progress: 80,
        totalHoursSpent: 34,
        deadline: '2026-10-15',
        milestones: [
          { name: 'System Architecture & Data Modeling', completed: true, weight: 20 },
          { name: 'Student Day 24h Timeline Engine', completed: true, weight: 25 },
          { name: 'Academic Attendance Safety Calculator', completed: true, weight: 25 },
          { name: 'DSA Pattern Matrix & Deadline Radar', completed: true, weight: 20 },
          { name: 'Automated Testing & Production Bundle', completed: false, weight: 10 },
        ],
        status: 'in_progress',
      },
      {
        user: userId,
        title: 'AI Financial Portfolio Assistant',
        goal: 'Personal finance and asset allocation engine analyzing student budgets and recurring micro-savings.',
        techStack: ['Python', 'FastAPI', 'React', 'PostgreSQL'],
        githubUrl: 'https://github.com/pavans/ai-finance',
        progress: 60,
        totalHoursSpent: 22,
        deadline: '2026-11-01',
        milestones: [
          { name: 'API Design & OAuth2 Setup', completed: true, weight: 30 },
          { name: 'Transaction Parsing & Categorizer', completed: true, weight: 30 },
          { name: 'Forecasting Model & UI Dashboard', completed: false, weight: 40 },
        ],
        status: 'in_progress',
      },
    ]);

    return res.status(200).json({
      success: true,
      message: 'Demo engineering profile seeded successfully!',
    });
  } catch (error) {
    console.error('Seed error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};
