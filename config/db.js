/**
 * MongoDB connection — legacy, only needed for the GoogleUser model.
 * The rest of the app runs on DynamoDB, so a failed Atlas connection must
 * NOT kill the process — log, keep serving, and retry in the background.
 */

import mongoose from 'mongoose';

const MONGO_URI =
  process.env.MONGO_URI ||
  'mongodb+srv://dhanush:Dhanush123@caasdiglobal.yahxc.mongodb.net/?retryWrites=true&w=majority&appName=CaasdiGlobal';

const RETRY_DELAY_MS = 10000;
let retryTimer = null;

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 10000,
    });
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`⚠️ MongoDB connection failed: ${error.message}`);
    console.error(`   Retrying in ${RETRY_DELAY_MS / 1000}s — server stays up (Mongo only needed for GoogleUser)`);
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = setTimeout(connectDB, RETRY_DELAY_MS);
  }
};

mongoose.connection.on('disconnected', () => {
  console.warn('⚠️ MongoDB disconnected — driver will auto-reconnect when the cluster is reachable');
});

mongoose.connection.on('error', (err) => {
  console.error('⚠️ MongoDB connection error:', err.message);
});

export default connectDB;
