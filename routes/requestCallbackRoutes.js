import express from 'express';
import asyncHandler from 'express-async-handler';
import RequestCallback from '../models/requestCallbackModel.js';
import { protect, admin } from '../middleware/authMiddleware.js';

const router = express.Router();

// Create a new callback request
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { name, email, phone } = req.body;
    const callback = await RequestCallback.create({ name, email, phone });
    res.status(201).json(callback);
  })
);

// Get all callback requests (admin only)
router.get(
  '/',
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const callbacks = await RequestCallback.find().sort({ createdAt: -1 });
    res.json(callbacks);
  })
);

// Update status (admin only)
router.patch(
  '/:id/status',
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const { status } = req.body;
    const callback = await RequestCallback.findById(req.params.id);
    if (!callback) {
      res.status(404);
      throw new Error('Request not found');
    }
    callback.status = status;
    await callback.save();
    res.json(callback);
  })
);

// Delete a callback request (admin only)
router.delete(
  '/:id',
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const callback = await RequestCallback.findById(req.params.id);
    if (!callback) {
      res.status(404);
      throw new Error('Request not found');
    }
    await callback.deleteOne();
    res.json({ message: 'Request deleted' });
  })
);

export default router;
