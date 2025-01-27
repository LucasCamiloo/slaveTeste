import mongoose from 'mongoose';

const screenSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    name: { type: String },
    content: { type: [String], default: [] },
    registered: { type: Boolean, default: false },
    masterUrl: { type: String },
    slaveUrl: { type: String },
    currentAd: { type: String },
    dateRegistered: { type: Date },
    lastUpdate: { type: Date, default: Date.now }
});

const Screen = mongoose.model('Screen', screenSchema);

// Changed to a named export
export { Screen };
