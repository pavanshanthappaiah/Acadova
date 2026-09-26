import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { User } from '../models/User.js';

dotenv.config();

const runAuthTests = async () => {
  console.log('--- [STUDENTOS PHASE 1: FOUNDATION TESTS] ---');
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/studentos';
    await mongoose.connect(mongoUri);
    console.log('✓ MongoDB connection established');

    const testEmail = `test.student.${Date.now()}@engineering.edu`;
    const testPassword = 'securePassword123';

    // Test 1: User model password hashing
    const user = await User.create({
      name: 'Test Student',
      email: testEmail,
      password: testPassword,
      branch: 'Computer Science & Engineering',
      semester: 6,
      targetAttendance: 75,
    });

    if (!user._id) throw new Error('User creation failed');
    if (user.password === testPassword) throw new Error('Password was not hashed!');
    console.log('✓ User model created with hashed password');

    // Test 2: Password matching method
    const isCorrect = await user.matchPassword(testPassword);
    const isWrong = await user.matchPassword('wrongPassword');
    if (!isCorrect || isWrong) throw new Error('matchPassword validation failed');
    console.log('✓ Password match validation verified');

    // Test 3: JWT token generation and verification
    const secret = process.env.JWT_SECRET || 'test_secret';
    const token = jwt.sign({ id: user._id }, secret, { expiresIn: '7d' });
    const decoded = jwt.verify(token, secret);
    if (decoded.id !== user._id.toString()) throw new Error('JWT token payload mismatch');
    console.log('✓ JWT token signing and verification verified');

    // Cleanup test user
    await User.deleteOne({ _id: user._id });
    console.log('✓ Test user cleaned up');

    await mongoose.disconnect();
    console.log('=== ALL PHASE 1 FOUNDATION TESTS PASSED ===');
    process.exit(0);
  } catch (err) {
    console.error('✗ Phase 1 test failed:', err);
    process.exit(1);
  }
};

runAuthTests();
