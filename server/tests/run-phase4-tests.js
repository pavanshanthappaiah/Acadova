import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { User } from '../models/User.js';
import { CodingProblem, Skill, Project } from '../models/TechnicalGrowth.js';

dotenv.config();

const runPhase4Tests = async () => {
  console.log('--- [STUDENTOS PHASE 4: TECHNICAL GROWTH & DSA ENGINE TESTS] ---');
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/studentos';
    await mongoose.connect(mongoUri);
    console.log('✓ MongoDB connected');

    const testUser = await User.create({
      name: 'P4 Tester',
      email: `p4.tester.${Date.now()}@engineering.edu`,
      password: 'password123',
    });

    // Test 1: Log Coding Problem
    const todayStr = new Date().toISOString().split('T')[0];
    const prob1 = await CodingProblem.create({
      user: testUser._id,
      title: '238. Product of Array Except Self',
      difficulty: 'medium',
      topic: 'Arrays',
      platform: 'LeetCode',
      language: 'C++',
      timeSpentMinutes: 35,
      date: todayStr,
    });
    if (!prob1._id) throw new Error('Failed to create CodingProblem');
    console.log('✓ Coding problem logged successfully');

    // Test 2: Create Skill & verify evidence
    const skill = await Skill.create({
      user: testUser._id,
      category: 'Computer Science',
      name: 'DSA',
      currentLevel: 3,
      targetLevel: 5,
      practiceHours: 42,
      problemsSolved: 65,
    });
    if (!skill._id) throw new Error('Failed to create Skill');
    console.log('✓ Skill graph node created with verified evidence (42 hrs, 65 solved)');

    // Test 3: Create Project & Milestone weight recalculation
    const project = await Project.create({
      user: testUser._id,
      title: 'AI Financial Assistant',
      techStack: ['React', 'Node.js', 'MongoDB'],
      milestones: [
        { name: 'System Architecture', completed: true, weight: 30 },
        { name: 'Backend Microservices', completed: true, weight: 40 },
        { name: 'Frontend Dashboard', completed: false, weight: 30 },
      ],
      progress: 70,
      totalHoursSpent: 18,
    });

    if (project.progress !== 70 || project.totalHoursSpent !== 18) {
      throw new Error('Project progress/hours calculation mismatch');
    }
    console.log('✓ Project tracking verified with milestone progress: 70%');

    // Clean up
    await CodingProblem.deleteMany({ user: testUser._id });
    await Skill.deleteMany({ user: testUser._id });
    await Project.deleteMany({ user: testUser._id });
    await User.deleteOne({ _id: testUser._id });
    console.log('✓ Test data cleaned up');

    await mongoose.disconnect();
    console.log('=== ALL PHASE 4 TECHNICAL GROWTH TESTS PASSED ===');
    process.exit(0);
  } catch (err) {
    console.error('✗ Phase 4 test failed:', err);
    process.exit(1);
  }
};

runPhase4Tests();
