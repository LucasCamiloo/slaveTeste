import mongoose from 'mongoose';
import config from './config.js';

const connectDB = async () => {
    try {
        mongoose.set('strictQuery', false);
        const conn = await mongoose.connect(config.mongoUri, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            serverSelectionTimeoutMS: 5000,
            heartbeatFrequencyMS: 2000
        });
        
        // Monitor connection events
        mongoose.connection.on('connected', () => {
            console.log('Mongoose connected to DB');
        });

        mongoose.connection.on('error', (err) => {
            console.error('Mongoose connection error:', err);
        });

        mongoose.connection.on('disconnected', () => {
            console.log('Mongoose disconnected');
        });

        console.log('MongoDB Connected');
        return conn;
    } catch (error) {
        console.error('MongoDB connection error:', error);
        process.exit(1);
    }
};

export default connectDB;
