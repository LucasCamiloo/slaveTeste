import mongoose from 'mongoose';

const productSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    description: { type: String },
    price: { type: String, required: true },
    fileId: { type: mongoose.Schema.Types.ObjectId, ref: 'File' }
});

const Product = mongoose.model('Product', productSchema);

// Changed to a named export
export { Product };
