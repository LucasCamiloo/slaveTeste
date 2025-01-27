import mongoose from 'mongoose';

const fileSchema = new mongoose.Schema({
    // ...existing code...
});

const File = mongoose.model('File', fileSchema);

// Changed to a named export
export { File };
