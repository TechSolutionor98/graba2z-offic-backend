import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

import Product from '../models/productModel.js';
import connectDB from '../config/db.js';

const fixUrls = async () => {
  try {
    await connectDB();
    console.log('Connected to DB. Finding products with double slashes in image URLs...');

    // Regex to match two or more slashes that are NOT preceded by a colon (so we don't break http://)
    const doubleSlashRegex = /([^:])\/{2,}/;

    const products = await Product.find({
      $or: [
        { image: { $regex: doubleSlashRegex } },
        { galleryImages: { $regex: doubleSlashRegex } }
      ]
    });

    console.log(`Found ${products.length} products to check.`);

    let count = 0;
    for (const product of products) {
      let updated = false;

      if (product.image && typeof product.image === 'string') {
        const newImage = product.image.replace(/([^:])\/{2,}/g, '$1/');
        if (newImage !== product.image) {
          product.image = newImage;
          updated = true;
        }
      }

      if (product.galleryImages && Array.isArray(product.galleryImages)) {
        const newGalleryImages = [...product.galleryImages];
        for (let i = 0; i < newGalleryImages.length; i++) {
          if (typeof newGalleryImages[i] === 'string') {
            const newImg = newGalleryImages[i].replace(/([^:])\/{2,}/g, '$1/');
            if (newImg !== newGalleryImages[i]) {
              newGalleryImages[i] = newImg;
              updated = true;
            }
          }
        }
        if (updated) {
           product.galleryImages = newGalleryImages;
        }
      }

      if (updated) {
        await product.save();
        count++;
      }
    }

    console.log(`Successfully updated ${count} products in the database.`);
    process.exit(0);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
};

fixUrls();
