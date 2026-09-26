import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { User } from '../models/User.js';
import { Activity } from '../models/Activity.js';
import { Subject, Assignment, Exam } from '../models/Academic.js';
import { CodingProblem, Skill, Project } from '../models/TechnicalGrowth.js';
import { seedStudentData } from '../controllers/seedController.js';

dotenv.config();

const runPhase6Tests = async () => {
  console.log('--- [STUDENTOS PHASE 6: POLISH & DEMO SEED ENGINE TESTS] ---');
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/studentos';
    await mongoose.connect(mongoUri);
    console.log('✓ MongoDB connected');

    const testUser = await User.create({
      name: 'Seed Tester',
      email: `seed.tester.${Date.now()}@engineering.edu`,
      password: 'password123',
    });

    const mockReq = { user: { id: testUser._id } };
    const mockRes = {
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        this.responseData = data;
        return this;
      },
    };

    // Run seed controller
    await seedStudentData(mockReq, mockRes);
    if (mockRes.statusCode !== 200 || !mockRes.responseData.success) {
      throw new Error('Seed execution failed');
    }
    console.log('✓ Demo seeder executed cleanly');

    // Verify seeded entities
    const [acts, subs, asgs, exams, probs, skills, projs] = await Promise.all([
      Activity.find({ user: testUser._id }),
      Subject.find({ user: testUser._id }),
      Assignment.find({ user: testUser._id }),
      Exam.find({ user: testUser._id }),
      CodingProblem.find({ user: testUser._id }),
      Skill.find({ user: testUser._id }),
      Project.find({ user: testUser._id }),
    ]);

    if (acts.length !== 8) throw new Error(`Expected 8 activities, got ${acts.length}`);
    if (subs.length !== 4) throw new Error(`Expected 4 subjects, got ${subs.length}`);
    if (asgs.length !== 3) throw new Error(`Expected 3 assignments, got ${asgs.length}`);
    if (exams.length !== 2) throw new Error(`Expected 2 exams, got ${exams.length}`);
    if (probs.length !== 6) throw new Error(`Expected 6 DSA problems, got ${probs.length}`);
    if (skills.length !== 9) throw new Error(`Expected 9 skills, got ${skills.length}`);
    if (projs.length !== 2) throw new Error(`Expected 2 projects, got ${projs.length}`);

    console.log(`✓ Seeded profile verified: 8 activities, 4 subjects, 3 assignments, 2 exams, 6 DSA problems, 9 skills, 2 projects`);

    // Clean up
    await Promise.all([
      Activity.deleteMany({ user: testUser._id }),
      Subject.deleteMany({ user: testUser._id }),
      Assignment.deleteMany({ user: testUser._id }),
      Exam.deleteMany({ user: testUser._id }),
      CodingProblem.deleteMany({ user: testUser._id }),
      Skill.deleteMany({ user: testUser._id }),
      Project.deleteMany({ user: testUser._id }),
      User.deleteOne({ _id: testUser._id }),
    ]);
    console.log('✓ Test data cleaned up');

    await mongoose.disconnect();
    console.log('=== ALL PHASE 6 POLISH & SEED TESTS PASSED ===');
    process.exit(0);
  } catch (err) {
    console.error('✗ Phase 6 test failed:', err);
    process.exit(1);
  }
};

runPhase6Tests();
