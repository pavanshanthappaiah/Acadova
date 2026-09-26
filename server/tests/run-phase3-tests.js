import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { User } from '../models/User.js';
import { Subject, Assignment, Exam } from '../models/Academic.js';
import { computeSubjectAttendance } from '../controllers/academicController.js';

dotenv.config();

const runPhase3Tests = async () => {
  console.log('--- [STUDENTOS PHASE 3: ACADEMIC & ATTENDANCE ENGINE TESTS] ---');
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/studentos';
    await mongoose.connect(mongoUri);
    console.log('✓ MongoDB connected');

    const testUser = await User.create({
      name: 'P3 Tester',
      email: `p3.tester.${Date.now()}@engineering.edu`,
      password: 'password123',
    });

    // Test 1: Safe buffer calculation (DBMS: 28/32 = 87.5% vs 75% target)
    const subSafe = await Subject.create({
      user: testUser._id,
      name: 'Database Management Systems',
      code: 'CS601',
      credits: 4,
      totalClasses: 32,
      attendedClasses: 28,
      targetAttendance: 75,
    });

    const safeMetrics = computeSubjectAttendance(subSafe);
    if (!safeMetrics.isSafe) throw new Error('Expected subject to be safe');
    if (safeMetrics.percentage !== 87.5) throw new Error(`Expected 87.5%, got ${safeMetrics.percentage}%`);
    if (safeMetrics.safeBunks !== 5) throw new Error(`Expected 5 safe bunks, got ${safeMetrics.safeBunks}`);
    console.log(`✓ Safe attendance verified: ${safeMetrics.percentage}% (Can safely miss ${safeMetrics.safeBunks} classes)`);

    // Test 2: Deficit calculation (OS: 10/20 = 50% vs 75% target)
    const subDeficit = await Subject.create({
      user: testUser._id,
      name: 'Operating Systems',
      code: 'CS602',
      credits: 4,
      totalClasses: 20,
      attendedClasses: 10,
      targetAttendance: 75,
    });

    const deficitMetrics = computeSubjectAttendance(subDeficit);
    if (deficitMetrics.isSafe) throw new Error('Expected subject to be at risk');
    if (deficitMetrics.classesNeeded !== 20) throw new Error(`Expected 20 classes needed, got ${deficitMetrics.classesNeeded}`);
    console.log(`✓ Deficit calculation verified: ${deficitMetrics.percentage}% (Must attend ${deficitMetrics.classesNeeded} consecutive classes to recover 75%)`);

    // Test 3: Create Assignment and Exam
    const asg = await Assignment.create({
      user: testUser._id,
      subject: subSafe._id,
      title: 'ER Modeling and Normalization Record',
      deadline: '2026-09-25',
      maxMarks: 10,
    });
    if (!asg._id) throw new Error('Assignment creation failed');
    console.log('✓ Coursework assignment record created');

    const exam = await Exam.create({
      user: testUser._id,
      subject: subSafe._id,
      title: 'Internal Assessment 1',
      type: 'internal_1',
      date: '2026-10-05',
      syllabus: [
        { topic: 'Relational Algebra', completed: true },
        { topic: 'SQL & Joins', completed: false },
      ],
    });
    if (!exam._id || exam.syllabus.length !== 2) throw new Error('Exam creation failed');
    console.log('✓ Exam schedule and syllabus checklist created');

    // Clean up
    await Subject.deleteMany({ user: testUser._id });
    await Assignment.deleteMany({ user: testUser._id });
    await Exam.deleteMany({ user: testUser._id });
    await User.deleteOne({ _id: testUser._id });
    console.log('✓ Test data cleaned up');

    await mongoose.disconnect();
    console.log('=== ALL PHASE 3 ACADEMIC & ATTENDANCE TESTS PASSED ===');
    process.exit(0);
  } catch (err) {
    console.error('✗ Phase 3 test failed:', err);
    process.exit(1);
  }
};

runPhase3Tests();
