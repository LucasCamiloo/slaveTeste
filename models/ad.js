import mongoose from 'mongoose';

const adSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    title: { type: String, required: true },
    content: { type: [String], required: true },
    dateCreated: { type: Date, default: Date.now },
    fileId: { type: mongoose.Schema.Types.ObjectId, ref: 'File' }
});

export default mongoose.model('Ad', adSchema);
