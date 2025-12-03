import express from 'express';
import { protect, admin } from '../middleware/authMiddleware.js';
import OfferCategory from '../models/offerCategoryModel.js';

const router = express.Router();

// Get all categories for a specific offer page
router.get('/page/:slug', async (req, res) => {
  try {
    const offerCategories = await OfferCategory.find({ offerPageSlug: req.params.slug })
      .populate('category')
      .sort({ order: 1 });
    res.json(offerCategories);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get all offer categories (admin)
router.get('/', protect, admin, async (req, res) => {
  try {
    const offerCategories = await OfferCategory.find()
      .populate('category')
      .sort({ offerPageSlug: 1, order: 1 });
    res.json(offerCategories);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get single offer category
router.get('/:id', async (req, res) => {
  try {
    const offerCategory = await OfferCategory.findById(req.params.id).populate('category');
    if (offerCategory) {
      res.json(offerCategory);
    } else {
      res.status(404).json({ message: 'Offer category not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Create offer category
router.post('/', protect, admin, async (req, res) => {
  try {
    const offerCategory = new OfferCategory(req.body);
    const createdOfferCategory = await offerCategory.save();
    const populatedOfferCategory = await OfferCategory.findById(createdOfferCategory._id).populate('category');
    res.status(201).json(populatedOfferCategory);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Update offer category
router.put('/:id', protect, admin, async (req, res) => {
  try {
    const offerCategory = await OfferCategory.findById(req.params.id);
    
    if (offerCategory) {
      offerCategory.offerPageSlug = req.body.offerPageSlug || offerCategory.offerPageSlug;
      offerCategory.category = req.body.category || offerCategory.category;
      offerCategory.isActive = req.body.isActive !== undefined ? req.body.isActive : offerCategory.isActive;
      offerCategory.order = req.body.order !== undefined ? req.body.order : offerCategory.order;
      
      const updatedOfferCategory = await offerCategory.save();
      const populatedOfferCategory = await OfferCategory.findById(updatedOfferCategory._id).populate('category');
      res.json(populatedOfferCategory);
    } else {
      res.status(404).json({ message: 'Offer category not found' });
    }
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Delete offer category
router.delete('/:id', protect, admin, async (req, res) => {
  try {
    const offerCategory = await OfferCategory.findById(req.params.id);
    
    if (offerCategory) {
      await offerCategory.deleteOne();
      res.json({ message: 'Offer category deleted' });
    } else {
      res.status(404).json({ message: 'Offer category not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Delete all categories for a specific offer page
router.delete('/page/:slug', protect, admin, async (req, res) => {
  try {
    await OfferCategory.deleteMany({ offerPageSlug: req.params.slug });
    res.json({ message: 'All categories deleted for this offer page' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
