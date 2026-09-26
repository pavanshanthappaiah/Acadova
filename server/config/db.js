import mongoose from 'mongoose';

export const connectDB = async () => {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/studentos';
  try {
    const conn = await mongoose.connect(uri);
    console.log(`[Database] MongoDB connected: ${conn.connection.host}`);
    return conn;
  } catch (error) {
    console.error(`\n[Database] ❌ MongoDB connection failed!`);
    console.error(`  URI: ${uri.replace(/:([^@]+)@/, ':****@')}`);
    console.error(`  Error: ${error.message}`);
    if (error.message.includes('ECONNREFUSED')) {
      console.error(`  Fix: MongoDB is not running. Start it with: brew services start mongodb-community`);
    } else if (error.message.includes('Authentication failed')) {
      console.error(`  Fix: Wrong username/password in MONGODB_URI inside server/.env`);
    } else if (error.message.includes('ETIMEDOUT')) {
      console.error(`  Fix: Cannot reach MongoDB host. Check your MONGODB_URI.`);
    }
    console.error('');
    process.exit(1);
  }
};

