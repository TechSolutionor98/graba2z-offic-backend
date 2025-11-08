 import express from 'express'
import asyncHandler from 'express-async-handler'
import Product from '../models/productModel.js'
import Category from '../models/categoryModel.js'
import SubCategory from '../models/subCategoryModel.js'
import Brand from '../models/brandModel.js'
import Blog from '../models/blogModel.js'
import BlogCategory from '../models/blogCategoryModel.js'

const router = express.Router()

// Helper function to format date for sitemap
const formatDate = (date) => {
  return new Date(date).toISOString()
}

// Helper function to escape XML characters
const escapeXml = (unsafe) => {
  if (!unsafe) return ''
  return unsafe
    .toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
}

// @desc    Generate sitemap.xml
// @route   GET /sitemap.xml
// @access  Public
router.get('/sitemap.xml', asyncHandler(async (req, res) => {
  try {
    const baseUrl = 'https://www.grabatoz.ae'
    
    // Fetch all data
    const [products, categories, subCategories, brands, blogs, blogCategories] = await Promise.all([
      Product.find({ isActive: true }).select('slug updatedAt').lean(),
      Category.find({ isActive: true }).select('slug updatedAt').lean(),
      SubCategory.find({ isActive: true }).select('slug updatedAt').lean(),
      Brand.find({ isActive: true }).select('slug updatedAt').lean(),
      Blog.find({ isActive: true }).select('slug updatedAt').lean(),
      BlogCategory.find({ isActive: true }).select('slug updatedAt').lean()
    ])

    // Start building XML
    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
        xsi:schemaLocation="http://www.sitemaps.org/schemas/sitemap/0.9
        http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd">
`

    // Static pages
    const staticPages = [
      { url: '', priority: '1.0', changefreq: 'daily' },
      { url: '/about', priority: '0.8', changefreq: 'monthly' },
      { url: '/contact', priority: '0.8', changefreq: 'monthly' },
      { url: '/cart', priority: '0.6', changefreq: 'weekly' },
      { url: '/checkout', priority: '0.6', changefreq: 'weekly' },
      { url: '/blogs', priority: '0.8', changefreq: 'weekly' },
      { url: '/products', priority: '0.9', changefreq: 'daily' },
      { url: '/brands', priority: '0.8', changefreq: 'weekly' },
      { url: '/categories', priority: '0.8', changefreq: 'weekly' },
      { url: '/privacy-policy', priority: '0.5', changefreq: 'yearly' },
      { url: '/terms-of-service', priority: '0.5', changefreq: 'yearly' },
      { url: '/delivery-terms', priority: '0.6', changefreq: 'monthly' },
      { url: '/disclaimer-policy', priority: '0.5', changefreq: 'yearly' },
      { url: '/cookies-policy', priority: '0.5', changefreq: 'yearly' },
      { url: '/back-to-school-gaming', priority: '0.7', changefreq: 'weekly' },
      { url: '/back-to-school-professional', priority: '0.7', changefreq: 'weekly' }
    ]

    // Add static pages
    staticPages.forEach(page => {
      xml += `  <url>
    <loc>${escapeXml(baseUrl + page.url)}</loc>
    <lastmod>${formatDate(new Date())}</lastmod>
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>
  </url>
`
    })

    // Add product pages
    products.forEach(product => {
      if (product.slug) {
        xml += `  <url>
    <loc>${escapeXml(baseUrl + '/product/' + product.slug)}</loc>
    <lastmod>${formatDate(product.updatedAt)}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
`
      }
    })

    // Add category pages
    categories.forEach(category => {
      if (category.slug) {
        xml += `  <url>
    <loc>${escapeXml(baseUrl + '/category/' + category.slug)}</loc>
    <lastmod>${formatDate(category.updatedAt)}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>
`
      }
    })

    // Add subcategory pages
    subCategories.forEach(subCategory => {
      if (subCategory.slug) {
        xml += `  <url>
    <loc>${escapeXml(baseUrl + '/subcategory/' + subCategory.slug)}</loc>
    <lastmod>${formatDate(subCategory.updatedAt)}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
  </url>
`
      }
    })

    // Add brand pages
    brands.forEach(brand => {
      if (brand.slug) {
        xml += `  <url>
    <loc>${escapeXml(baseUrl + '/brand/' + brand.slug)}</loc>
    <lastmod>${formatDate(brand.updatedAt)}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>
`
      }
    })

    // Add blog category pages
    blogCategories.forEach(blogCategory => {
      if (blogCategory.slug) {
        xml += `  <url>
    <loc>${escapeXml(baseUrl + '/blog-category/' + blogCategory.slug)}</loc>
    <lastmod>${formatDate(blogCategory.updatedAt)}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
  </url>
`
      }
    })

    // Add blog pages
    blogs.forEach(blog => {
      if (blog.slug) {
        xml += `  <url>
    <loc>${escapeXml(baseUrl + '/blog/' + blog.slug)}</loc>
    <lastmod>${formatDate(blog.updatedAt)}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>
`
      }
    })

    // Close XML
    xml += '</urlset>'

    // Set headers
    res.set({
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=3600' // Cache for 1 hour
    })

    res.send(xml)

  } catch (error) {
    console.error('Sitemap generation error:', error)
    res.status(500).send('Error generating sitemap')
  }
}))

export default router