import mongoose from 'mongoose';

const requestCallbackSchema = mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true },
    phone: { type: String, required: true },
    status: {
      type: String,
      enum: ['pending', 'done', 'spam'],
      default: 'pending',
    },
  },
  { timestamps: true }
);

const RequestCallback = mongoose.model('RequestCallback', requestCallbackSchema);
export default RequestCallback;
