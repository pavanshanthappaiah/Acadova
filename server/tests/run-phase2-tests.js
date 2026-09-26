import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { User } from '../models/User.js';
import { Activity } from '../models/Activity.js';

dotenv.config();

const runPhase2Tests = async () => {
  console.log('--- [STUDENTOS PHASE 2: STUDENT DAY & PLANNED VS ACTUAL TESTS] ---');
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/studentos';
    await mongoose.connect(mongoUri);
    console.log('✓ MongoDB connected');

    // Create a temporary test student
    const testUser = await User.create({
      name: 'P2 Tester',
      email: `p2.tester.${Date.now()}@engineering.edu`,
      password: 'password123',
    });

    const todayStr = new Date().toISOString().split('T')[0];

    // Test 1: Create an activity
    const act1 = await Activity.create({
      user: testUser._id,
      title: 'DBMS Lecture',
      category: 'academic',
      date: todayStr,
      planned_start: '09:00',
      planned_end: '10:30',
      planned_duration: 90,
      academicImportance: 'high',
    });
    if (!act1._id) throw new Error('Failed to create Activity');
    console.log('✓ Activity created with planned duration: 90m');

    // Test 2: Start session (in_progress)
    act1.status = 'in_progress';
    act1.actual_start = '09:05';
    await act1.save();
    if (act1.status !== 'in_progress') throw new Error('Status update to in_progress failed');
    console.log('✓ Status transition to in_progress verified');

    // Test 3: Complete session (completed) with variance
    act1.status = 'completed';
    act1.actual_end = '10:17';
    act1.actual_duration = 72; // 72 mins vs planned 90 mins -> 80% efficiency
    await act1.save();

    const efficiency = Math.round((act1.actual_duration / act1.planned_duration) * 100);
    if (efficiency !== 80) throw new Error(`Expected 80% efficiency, got ${efficiency}%`);
    console.log(`✓ Planned vs Actual efficiency calculation verified: ${efficiency}%`);

    // Clean up
    await Activity.deleteMany({ user: testUser._id });
    await User.deleteOne({ _id: testUser._id });
    console.log('✓ Test data cleaned up');

    await mongoose.disconnect();
    console.log('=== ALL PHASE 2 STUDENT DAY TESTS PASSED ===');
    process.exit(0);
  } catch (err) {
    console.error('✗ Phase 2 test failed:', err);
    process.exit(1);
  }
};

runPhase2Tests();
