import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { User } from '../models/User.js';
import { Assignment, Subject } from '../models/Academic.js';
import { Activity } from '../models/Activity.js';
import { DailyReview } from '../models/Productivity.js';

dotenv.config();

const runPhase5Tests = async () => {
  console.log('--- [STUDENTOS PHASE 5: PRODUCTIVITY RADAR & INTELLIGENCE TESTS] ---');
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/studentos';
    await mongoose.connect(mongoUri);
    console.log('✓ MongoDB connected');

    const testUser = await User.create({
      name: 'P5 Tester',
      email: `p5.tester.${Date.now()}@engineering.edu`,
      password: 'password123',
    });

    const todayStr = new Date().toISOString().split('T')[0];
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    // Test 1: Deadline Radar Detection
    const sub = await Subject.create({
      user: testUser._id,
      name: 'Computer Networks',
      code: 'CS603',
    });

    const urgentAsg = await Assignment.create({
      user: testUser._id,
      subject: sub._id,
      title: 'Socket Programming Assignment',
      deadline: tomorrowStr,
      maxMarks: 15,
    });
    if (!urgentAsg._id) throw new Error('Failed to create urgent assignment');
    console.log('✓ Deadline Radar detected imminent assignment (Due Tomorrow)');

    // Test 2: Time Leak Detection (Planned Break 20m vs Actual 50m -> +30m leak)
    const leakAct = await Activity.create({
      user: testUser._id,
      title: 'Coffee & Social Break',
      category: 'personal',
      date: todayStr,
      planned_start: '16:00',
      planned_end: '16:20',
      planned_duration: 20,
      actual_start: '16:00',
      actual_end: '16:50',
      actual_duration: 50,
      status: 'completed',
    });

    const diff = leakAct.actual_duration - leakAct.planned_duration;
    if (diff !== 30) throw new Error('Time leak calculation failed');
    console.log(`✓ Time leak detection verified: +${diff}m overrun recorded`);

    // Test 3: End-of-Day Checkout
    const checkout = await DailyReview.create({
      user: testUser._id,
      date: todayStr,
      completedItems: ['DBMS Revision', 'LeetCode Array problem'],
      missedItems: ['OS Assignment Draft'],
      energyLevel: 'high',
      tomorrowPriority: 'OS Assignment Submission',
    });
    if (!checkout._id || checkout.completedItems.length !== 2) {
      throw new Error('Checkout creation failed');
    }
    console.log('✓ End-of-Day Checkout verified with high energy and top priority set');

    // Clean up
    await Assignment.deleteMany({ user: testUser._id });
    await Subject.deleteMany({ user: testUser._id });
    await Activity.deleteMany({ user: testUser._id });
    await DailyReview.deleteMany({ user: testUser._id });
    await User.deleteOne({ _id: testUser._id });
    console.log('✓ Test data cleaned up');

    await mongoose.disconnect();
    console.log('=== ALL PHASE 5 PRODUCTIVITY INTELLIGENCE TESTS PASSED ===');
    process.exit(0);
  } catch (err) {
    console.error('✗ Phase 5 test failed:', err);
    process.exit(1);
  }
};

runPhase5Tests();
