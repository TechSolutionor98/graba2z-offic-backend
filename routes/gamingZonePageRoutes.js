import express from 'express';
import { protect, admin } from '../middleware/authMiddleware.js';
import GamingZonePage from '../models/gamingZonePageModel.js';
import GamingZoneCategory from '../models/gamingZoneCategoryModel.js';
import Product from '../models/productModel.js';
import SubCategory from '../models/subCategoryModel.js';
import { deleteLocalFile, isCloudinaryUrl } from '../config/multer.js';

const router = express.Router();

// Get all gaming zone pages
router.get('/', async (req, res) => {
  try {
    const gamingZonePages = await GamingZonePage.find().sort({ order: 1 });
    res.json(gamingZonePages);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get active gaming zone pages
router.get('/active', async (req, res) => {
  try {
    const gamingZonePages = await GamingZonePage.find({ isActive: true }).sort({ order: 1 });
    res.json(gamingZonePages);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get single gaming zone page by ID
router.get('/:id', async (req, res) => {
  try {
    const gamingZonePage = await GamingZonePage.findById(req.params.id);
    if (gamingZonePage) {
      res.json(gamingZonePage);
    } else {
      res.status(404).json({ message: 'Gaming zone page not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get gaming zone page by slug
router.get('/slug/:slug', async (req, res) => {
  try {
    const gamingZonePage = await GamingZonePage.findOne({ slug: req.params.slug });
    if (gamingZonePage) {
      res.json(gamingZonePage);
    } else {
      res.status(404).json({ message: 'Gaming zone page not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get products for a gaming zone page (auto-fetched based on selected categories)
router.get('/slug/:slug/products', async (req, res) => {
  try {
    // Get all categories for this gaming zone page
    const gamingZoneCategories = await GamingZoneCategory.find({ 
      gamingZonePageSlug: req.params.slug,
      isActive: true 
    });

    if (!gamingZoneCategories || gamingZoneCategories.length === 0) {
      return res.json([]);
    }

    // Extract category IDs
    const categoryIds = gamingZoneCategories.map(gc => gc.category);

    // Build query to find all products that match the selected categories
    let productQuery = {
      isDeleted: { $ne: true },
      isActive: true
    };

    // We need to check:
    // 1. Products with parentCategory matching (for main categories)
    // 2. Products with category matching (for subcategories level 1)
    // 3. Products with subCategory2 matching (for subcategories level 2)
    
    const categoryTypeMap = {};
    gamingZoneCategories.forEach(gc => {
      categoryTypeMap[gc.category.toString()] = gc.categoryType;
    });

    // Separate category and subcategory IDs
    const mainCategoryIds = [];
    const subCategoryIds = [];
    
    for (const gc of gamingZoneCategories) {
      if (gc.categoryType === 'Category') {
        mainCategoryIds.push(gc.category);
        
        // Also get all subcategories under this main category
        const subCats = await SubCategory.find({ parentCategory: gc.category });
        subCategoryIds.push(...subCats.map(sc => sc._id));
      } else if (gc.categoryType === 'SubCategory') {
        subCategoryIds.push(gc.category);
        
        // Also get all sub-subcategories under this subcategory
        const subSubCats = await SubCategory.find({ parentCategory: gc.category });
        subCategoryIds.push(...subSubCats.map(sc => sc._id));
      }
    }

    // Build the OR condition to match any of the category levels
    const orConditions = [];
    
    if (mainCategoryIds.length > 0) {
      orConditions.push({ parentCategory: { $in: mainCategoryIds } });
    }
    
    if (subCategoryIds.length > 0) {
      orConditions.push({ category: { $in: subCategoryIds } });
      orConditions.push({ subCategory2: { $in: subCategoryIds } });
    }

    if (orConditions.length > 0) {
      productQuery.$or = orConditions;
    }

    // Fetch products with pagination support
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const products = await Product.find(productQuery)
      .populate('brand')
      .populate('parentCategory')
      .populate('category')
      .populate('subCategory2')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const totalProducts = await Product.countDocuments(productQuery);

    res.json({
      products,
      currentPage: page,
      totalPages: Math.ceil(totalProducts / limit),
      totalProducts,
    });
  } catch (error) {
    console.error('Error fetching gaming zone products:', error);
    res.status(500).json({ message: error.message });
  }
});

// Create gaming zone page
router.post('/', protect, admin, async (req, res) => {
  try {
    const gamingZonePage = new GamingZonePage(req.body);
    const createdGamingZonePage = await gamingZonePage.save();
    res.status(201).json(createdGamingZonePage);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Update gaming zone page
router.put('/:id', protect, admin, async (req, res) => {
  try {
    const gamingZonePage = await GamingZonePage.findById(req.params.id);
    
    if (gamingZonePage) {
      gamingZonePage.name = req.body.name || gamingZonePage.name;
      gamingZonePage.slug = req.body.slug || gamingZonePage.slug;
      gamingZonePage.heroImage = req.body.heroImage !== undefined ? req.body.heroImage : gamingZonePage.heroImage;
      gamingZonePage.cardImages = req.body.cardImages !== undefined ? req.body.cardImages : gamingZonePage.cardImages;
      gamingZonePage.isActive = req.body.isActive !== undefined ? req.body.isActive : gamingZonePage.isActive;
      gamingZonePage.order = req.body.order !== undefined ? req.body.order : gamingZonePage.order;
      
      const updatedGamingZonePage = await gamingZonePage.save();
      res.json(updatedGamingZonePage);
    } else {
      res.status(404).json({ message: 'Gaming zone page not found' });
    }
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Delete gaming zone page
router.delete('/:id', protect, admin, async (req, res) => {
  try {
    const gamingZonePage = await GamingZonePage.findById(req.params.id);
    
    if (gamingZonePage) {
      // Delete hero image
      if (gamingZonePage.heroImage && !isCloudinaryUrl(gamingZonePage.heroImage)) {
        try {
          await deleteLocalFile(gamingZonePage.heroImage);
        } catch (err) {
          console.error("Error deleting hero image:", err);
        }
      }

      // Delete card images
      if (gamingZonePage.cardImages && gamingZonePage.cardImages.length > 0) {
        for (const card of gamingZonePage.cardImages) {
          if (card.image && !isCloudinaryUrl(card.image)) {
            try {
              await deleteLocalFile(card.image);
            } catch (err) {
              console.error("Error deleting card image:", err);
            }
          }
        }
      }

      await gamingZonePage.deleteOne();
      res.json({ message: 'Gaming zone page deleted' });
    } else {
      res.status(404).json({ message: 'Gaming zone page not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
