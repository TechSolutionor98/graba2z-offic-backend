import express from 'express';
import { protect, admin } from '../middleware/authMiddleware.js';
import OfferPage from '../models/offerPageModel.js';

const router = express.Router();

// Get all offer pages
router.get('/', async (req, res) => {
  try {
    const offerPages = await OfferPage.find().sort({ order: 1 });
    res.json(offerPages);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get active offer pages
router.get('/active', async (req, res) => {
  try {
    const offerPages = await OfferPage.find({ isActive: true }).sort({ order: 1 });
    res.json(offerPages);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get single offer page by ID
router.get('/:id', async (req, res) => {
  try {
    const offerPage = await OfferPage.findById(req.params.id);
    if (offerPage) {
      res.json(offerPage);
    } else {
      res.status(404).json({ message: 'Offer page not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get offer page by slug
router.get('/slug/:slug', async (req, res) => {
  try {
    const offerPage = await OfferPage.findOne({ slug: req.params.slug });
    if (offerPage) {
      res.json(offerPage);
    } else {
      res.status(404).json({ message: 'Offer page not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Create offer page
router.post('/', protect, admin, async (req, res) => {
  try {
    const offerPage = new OfferPage(req.body);
    const createdOfferPage = await offerPage.save();
    res.status(201).json(createdOfferPage);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Update offer page
router.put('/:id', protect, admin, async (req, res) => {
  try {
    const offerPage = await OfferPage.findById(req.params.id);
    
    if (offerPage) {
      offerPage.name = req.body.name || offerPage.name;
      offerPage.slug = req.body.slug || offerPage.slug;
      offerPage.heroImage = req.body.heroImage !== undefined ? req.body.heroImage : offerPage.heroImage;
      offerPage.cardImages = req.body.cardImages !== undefined ? req.body.cardImages : offerPage.cardImages;
      offerPage.isActive = req.body.isActive !== undefined ? req.body.isActive : offerPage.isActive;
      offerPage.order = req.body.order !== undefined ? req.body.order : offerPage.order;
      
      const updatedOfferPage = await offerPage.save();
      res.json(updatedOfferPage);
    } else {
      res.status(404).json({ message: 'Offer page not found' });
    }
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Delete offer page
router.delete('/:id', protect, admin, async (req, res) => {
  try {
    const offerPage = await OfferPage.findById(req.params.id);
    
    if (offerPage) {
      await offerPage.deleteOne();
      res.json({ message: 'Offer page deleted' });
    } else {
      res.status(404).json({ message: 'Offer page not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
