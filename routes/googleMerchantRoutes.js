
import express from "express"
import asyncHandler from "express-async-handler"
import Product from "../models/productModel.js"

const router = express.Router()

// Helper function to properly escape XML characters
const escapeXml = (unsafe) => {
  if (!unsafe) return ""
  return unsafe
    .toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "") // Remove control characters
}

// Helper function to clean text for CDATA
const cleanForCDATA = (text) => {
  if (!text) return ""
  return text
    .toString()
    .replace(/]]>/g, "]]&gt;") // Escape CDATA end sequence
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "") // Remove control characters
}

// Helper function to determine availability
const determineAvailability = (product) => {
  // Check stock status first
  if (product.stockStatus === "Out of Stock") {
    return "out of stock"
  }

  if (product.stockStatus === "PreOrder") {
    return "preorder"
  }

  // If stockStatus is "Available Product" or any other value, check actual stock count
  if (product.countInStock && product.countInStock > 0) {
    return "in stock"
  }

  // If no stock count or zero stock, but stockStatus is not explicitly "Out of Stock"
  if (product.stockStatus === "Available Product") {
    return "in stock" // Trust the stockStatus over countInStock
  }

  // Default to out of stock
  return "out of stock"
}

// Helper function to determine Google product category
function determineGoogleCategory(parentCategory, subCategory) {
  const categoryMappings = {
    Electronics: "Electronics",
    Computers: "Electronics > Computers",
    Mobile: "Electronics > Communications > Telephony > Mobile Phones",
    Laptops: "Electronics > Computers > Laptops",
    Gaming: "Electronics > Video Game Console Accessories",
    Audio: "Electronics > Audio",
    Cameras: "Electronics > Cameras & Optics",
    Home: "Home & Garden",
    Kitchen: "Home & Garden > Kitchen & Dining",
    Furniture: "Home & Garden > Furniture",
    Clothing: "Apparel & Accessories",
    Fashion: "Apparel & Accessories",
    Shoes: "Apparel & Accessories > Shoes",
    Bags: "Apparel & Accessories > Handbags, Wallets & Cases",
    Beauty: "Health & Beauty > Personal Care",
    Health: "Health & Beauty",
    Sports: "Sporting Goods",
    Fitness: "Sporting Goods > Exercise & Fitness",
    Toys: "Toys & Games",
    Books: "Media > Books",
    Automotive: "Vehicles & Parts > Vehicle Parts & Accessories",
    Tools: "Hardware > Tools",
    Garden: "Home & Garden > Lawn & Garden",
    Pet: "Animals & Pet Supplies",
    Baby: "Baby & Toddler > Baby Care",
    Office: "Business & Industrial > Office Supplies",
  }

  const searchKey = subCategory || parentCategory || ""

  if (categoryMappings[searchKey]) {
    return categoryMappings[searchKey]
  }

  for (const [key, value] of Object.entries(categoryMappings)) {
    if (searchKey.toLowerCase().includes(key.toLowerCase()) || key.toLowerCase().includes(searchKey.toLowerCase())) {
      return value
    }
  }

  return "Electronics"
}

// @desc    Get product count for debugging
// @route   GET /api/google-merchant/count
// @access  Public
router.get(
  "/count",
  asyncHandler(async (req, res) => {
    try {
      const totalProducts = await Product.countDocuments()
      const activeProducts = await Product.countDocuments({ isActive: true })
      const inactiveProducts = await Product.countDocuments({ isActive: false })
      const productsWithoutIsActive = await Product.countDocuments({ isActive: { $exists: false } })
      const productsWithPrice = await Product.countDocuments({ price: { $gt: 0 } })
      const productsWithZeroPrice = await Product.countDocuments({ price: 0 })
      const productsWithOfferPrice = await Product.countDocuments({ offerPrice: { $gt: 0 } })
      const productsWithName = await Product.countDocuments({ name: { $exists: true, $ne: "" } })
      const productsWithoutName = await Product.countDocuments({ $or: [{ name: { $exists: false } }, { name: "" }] })

      // Stock status analysis
      const availableProducts = await Product.countDocuments({ stockStatus: "Available Product" })
      const outOfStockProducts = await Product.countDocuments({ stockStatus: "Out of Stock" })
      const preOrderProducts = await Product.countDocuments({ stockStatus: "PreOrder" })
      const productsWithStock = await Product.countDocuments({ countInStock: { $gt: 0 } })
      const productsWithZeroStock = await Product.countDocuments({ countInStock: 0 })

      // Test the same query we use in the feed
      const feedQuery = {
        $or: [{ isActive: true }, { isActive: { $exists: false } }],
      }
      const feedProducts = await Product.countDocuments(feedQuery)

      // Test products that would be skipped in old logic
      const productsWithValidName = await Product.countDocuments({
        ...feedQuery,
        name: { $exists: true, $ne: "" },
      })

      res.json({
        total: totalProducts,
        active: activeProducts,
        inactive: inactiveProducts,
        withoutIsActiveField: productsWithoutIsActive,
        withPrice: productsWithPrice,
        withZeroPrice: productsWithZeroPrice,
        withOfferPrice: productsWithOfferPrice,
        withName: productsWithName,
        withoutName: productsWithoutName,
        stockStatus: {
          available: availableProducts,
          outOfStock: outOfStockProducts,
          preOrder: preOrderProducts,
          withStock: productsWithStock,
          withZeroStock: productsWithZeroStock,
        },
        feedQuery: feedProducts,
        feedQueryWithValidName: productsWithValidName,
        query: req.query,
      })
    } catch (error) {
      console.error("Product count error:", error)
      res.status(500).json({ error: error.message })
    }
  }),
)

// @desc    Generate Google Merchant JSON Feed with pagination support
// @route   GET /api/google-merchant/feed.json
// @access  Public
router.get(
  "/feed.json",
  asyncHandler(async (req, res) => {
    try {
      // Parse pagination parameters
      const page = Number.parseInt(req.query.page) || 1
      const limit = Number.parseInt(req.query.limit) || 0 // 0 means no limit
      const skip = limit > 0 ? (page - 1) * limit : 0

      // More flexible query - include products that don't have isActive field or where it's true
      const query = {
        $or: [{ isActive: true }, { isActive: { $exists: false } }],
      }

      console.log("Fetching products with query:", JSON.stringify(query))
      console.log(`Pagination: page=${page}, limit=${limit}, skip=${skip}`)

      // Get total count first
      const totalCount = await Product.countDocuments(query)
      console.log(`Total products matching query: ${totalCount}`)

      // Build the aggregation pipeline to fetch ALL products without any default limits
      const aggregationPipeline = [
        { $match: query },
        {
          $lookup: {
            from: "brands",
            localField: "brand",
            foreignField: "_id",
            as: "brand",
          },
        },
        {
          $lookup: {
            from: "categories",
            localField: "category",
            foreignField: "_id",
            as: "category",
          },
        },
        {
          $lookup: {
            from: "categories",
            localField: "parentCategory",
            foreignField: "_id",
            as: "parentCategory",
          },
        },
        {
          $unwind: {
            path: "$brand",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $unwind: {
            path: "$category",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $unwind: {
            path: "$parentCategory",
            preserveNullAndEmptyArrays: true,
          },
        },
      ]

      // Add pagination only if limit is specified
      if (limit > 0) {
        aggregationPipeline.push({ $skip: skip })
        aggregationPipeline.push({ $limit: limit })
      }

      const products = await Product.aggregate(aggregationPipeline)

      console.log(`Found ${products.length} products`)

      res.set({
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      })

      const feed = {
        title: "GrabA2Z Products",
        link: "https://www.grabatoz.ae",
        description: "GrabA2Z Product Feed for Google Merchant Center",
        language: "en",
        lastBuildDate: new Date().toISOString(),
        totalProducts: totalCount,
        returnedProducts: products.length,
        pagination: {
          page: page,
          limit: limit,
          skip: skip,
          hasNextPage: limit > 0 ? skip + products.length < totalCount : false,
          totalPages: limit > 0 ? Math.ceil(totalCount / limit) : 1,
        },
        products: [],
      }

      let processedCount = 0
      let skippedCount = 0
      const availabilityStats = {
        inStock: 0,
        outOfStock: 0,
        preOrder: 0,
      }

      for (const product of products) {
        try {
          // Only skip products without a name - allow zero prices
          if (!product.name || product.name.trim() === "") {
            console.log(`Skipping product ${product._id} - missing name`)
            skippedCount++
            continue
          }

          const productUrl = `https://www.grabatoz.ae/product/${product.slug || product._id}`
          const imageUrl = product.image
            ? product.image.startsWith("http")
              ? product.image
              : `https://www.grabatoz.ae${product.image}`
            : "https://www.grabatoz.ae/placeholder.jpg"

          // Use the improved availability logic
          const availability = determineAvailability(product)
          availabilityStats[availability.replace(" ", "").replace("of", "Of")]++

          // Handle pricing - allow zero prices but default to 0.01 for Google Merchant
          let price = 0
          if (product.offerPrice && product.offerPrice > 0) {
            price = product.offerPrice
          } else if (product.price && product.price > 0) {
            price = product.price
          } else {
            // For zero-priced items, set a minimal price for Google Merchant
            price = 0.01
          }

          const salePrice =
            product.offerPrice && product.offerPrice > 0 && product.price && product.offerPrice < product.price
              ? product.offerPrice
              : null

          const cleanDescription = product.description
            ? product.description.replace(/<[^>]*>/g, "").substring(0, 5000)
            : product.shortDescription || product.name || "No description available"

          const googleProductCategory = determineGoogleCategory(product.parentCategory?.name, product.category?.name)
          const productType =
            (product.parentCategory?.name || "Uncategorized") +
            (product.category?.name ? ` > ${product.category.name}` : "")

          const additionalImages = []
          if (product.galleryImages && product.galleryImages.length > 0) {
            product.galleryImages.slice(0, 10).forEach((img) => {
              if (img) {
                const additionalImageUrl = img.startsWith("http") ? img : `https://www.grabatoz.ae${img}`
                additionalImages.push(additionalImageUrl)
              }
            })
          }

          const productData = {
            id: product._id.toString(),
            title: product.name,
            description: cleanDescription,
            link: productUrl,
            image_link: imageUrl,
            additional_image_links: additionalImages,
            price: `${price.toFixed(2)} AED`,
            availability: availability,
            condition: "new",
            google_product_category: googleProductCategory,
            product_type: productType,
            item_group_id: product._id.toString(),
            brand: product.brand?.name || "Generic",
            gtin: product.barcode || "",
            mpn: product.sku || product._id.toString(),
            shipping_weight: product.weight ? `${product.weight} kg` : "",
            custom_labels: {
              custom_label_0: product.featured ? "Featured" : "",
              custom_label_1: product.tags && product.tags.length > 0 ? product.tags.slice(0, 3).join(", ") : "",
            },
            stock_quantity: product.countInStock || 0,
            stock_status: product.stockStatus || "Unknown",
            created_at: product.createdAt,
            updated_at: product.updatedAt,
            is_active: product.isActive !== undefined ? product.isActive : true,
            original_price: product.price || 0,
            original_offer_price: product.offerPrice || 0,
          }

          if (salePrice) {
            productData.sale_price = `${salePrice.toFixed(2)} AED`
          }

          feed.products.push(productData)
          processedCount++
        } catch (productError) {
          console.error(`Error processing product ${product._id}:`, productError)
          skippedCount++
          continue
        }
      }

      feed.processedProducts = processedCount
      feed.skippedProducts = skippedCount
      feed.availabilityStats = availabilityStats

      console.log(`Feed generated: ${processedCount} products processed, ${skippedCount} skipped`)
      console.log(`Availability stats:`, availabilityStats)

      res.json(feed)
    } catch (error) {
      console.error("Google Merchant JSON feed error:", error)
      res.status(500).json({
        error: "Error generating product feed",
        message: error.message,
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      })
    }
  }),
)

// @desc    Generate Google Merchant XML Feed
// @route   GET /api/google-merchant/feed.xml
// @access  Public
router.get(
  "/feed.xml",
  asyncHandler(async (req, res) => {
    try {
      // Parse pagination parameters
      const page = Number.parseInt(req.query.page) || 1
      const limit = Number.parseInt(req.query.limit) || 0 // 0 means no limit
      const skip = limit > 0 ? (page - 1) * limit : 0

      // More flexible query - include products that don't have isActive field or where it's true
      const query = {
        $or: [{ isActive: true }, { isActive: { $exists: false } }],
      }

      console.log("Fetching products for XML with query:", JSON.stringify(query))
      console.log(`XML Pagination: page=${page}, limit=${limit}, skip=${skip}`)

      // Get total count first
      const totalCount = await Product.countDocuments(query)
      console.log(`Total products for XML: ${totalCount}`)

      // Build the aggregation pipeline to fetch ALL products without any default limits
      const aggregationPipeline = [
        { $match: query },
        {
          $lookup: {
            from: "brands",
            localField: "brand",
            foreignField: "_id",
            as: "brand",
          },
        },
        {
          $lookup: {
            from: "categories",
            localField: "category",
            foreignField: "_id",
            as: "category",
          },
        },
        {
          $lookup: {
            from: "categories",
            localField: "parentCategory",
            foreignField: "_id",
            as: "parentCategory",
          },
        },
        {
          $unwind: {
            path: "$brand",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $unwind: {
            path: "$category",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $unwind: {
            path: "$parentCategory",
            preserveNullAndEmptyArrays: true,
          },
        },
      ]

      // Add pagination only if limit is specified
      if (limit > 0) {
        aggregationPipeline.push({ $skip: skip })
        aggregationPipeline.push({ $limit: limit })
      }

      const products = await Product.aggregate(aggregationPipeline)

      console.log(`Found ${products.length} products for XML`)

      res.set({
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      })

      let xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title><![CDATA[GrabA2Z Products]]></title>
    <link>https://www.grabatoz.ae</link>
    <description><![CDATA[GrabA2Z Product Feed for Google Merchant Center - Total: ${totalCount} products]]></description>
    <language>en</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
`

      let processedCount = 0
      const availabilityStats = {
        inStock: 0,
        outOfStock: 0,
        preOrder: 0,
      }

      for (const product of products) {
        try {
          // Only skip products without a name - allow zero prices
          if (!product.name || product.name.trim() === "") {
            console.warn(`Skipping product ${product._id} - missing name`)
            continue
          }

          const productUrl = `https://www.grabatoz.ae/product/${product.slug || product._id}`
          const imageUrl = product.image
            ? product.image.startsWith("http")
              ? product.image
              : `https://www.grabatoz.ae${product.image}`
            : "https://www.grabatoz.ae/placeholder.jpg"

          // Use the improved availability logic
          const availability = determineAvailability(product)
          availabilityStats[availability.replace(" ", "").replace("of", "Of")]++

          // Handle pricing - allow zero prices but default to 0.01 for Google Merchant
          let price = 0
          if (product.offerPrice && product.offerPrice > 0) {
            price = product.offerPrice
          } else if (product.price && product.price > 0) {
            price = product.price
          } else {
            // For zero-priced items, set a minimal price for Google Merchant
            price = 0.01
          }

          const salePrice =
            product.offerPrice && product.offerPrice > 0 && product.price && product.offerPrice < product.price
              ? product.offerPrice
              : null

          // Clean and limit description
          let cleanDescription = ""
          if (product.description) {
            cleanDescription = product.description
              .replace(/<[^>]*>/g, "") // Remove HTML tags
              .replace(/&nbsp;/g, " ") // Replace &nbsp; with space
              .replace(/\s+/g, " ") // Replace multiple spaces with single space
              .trim()
              .substring(0, 5000)
          } else {
            cleanDescription = product.shortDescription || product.name || "No description available"
          }

          const googleProductCategory = determineGoogleCategory(product.parentCategory?.name, product.category?.name)
          const productType =
            (product.parentCategory?.name || "Uncategorized") +
            (product.category?.name ? ` > ${product.category.name}` : "")

          xml += `    <item>
      <g:id>${escapeXml(product._id.toString())}</g:id>
      <g:title><![CDATA[${cleanForCDATA(product.name)}]]></g:title>
      <g:description><![CDATA[${cleanForCDATA(cleanDescription)}]]></g:description>
      <g:link>${productUrl}</g:link>
      <g:image_link>${imageUrl}</g:image_link>
      <g:price>${price.toFixed(2)} AED</g:price>`

          if (salePrice) {
            xml += `
      <g:sale_price>${salePrice.toFixed(2)} AED</g:sale_price>`
          }

          xml += `
      <g:availability>${availability}</g:availability>
      <g:condition>new</g:condition>`

          if (product.brand?.name) {
            xml += `
      <g:brand><![CDATA[${cleanForCDATA(product.brand.name)}]]></g:brand>`
          } else {
            xml += `
      <g:brand><![CDATA[Generic]]></g:brand>`
          }

          if (product.barcode) {
            xml += `
      <g:gtin>${escapeXml(product.barcode)}</g:gtin>`
          }

          if (product.sku) {
            xml += `
      <g:mpn><![CDATA[${cleanForCDATA(product.sku)}]]></g:mpn>`
          } else {
            xml += `
      <g:mpn><![CDATA[${cleanForCDATA(product._id.toString())}]]></g:mpn>`
          }

          xml += `
      <g:google_product_category><![CDATA[${googleProductCategory}]]></g:google_product_category>
      <g:product_type><![CDATA[${cleanForCDATA(productType)}]]></g:product_type>
      <g:item_group_id>${escapeXml(product._id.toString())}</g:item_group_id>`

          // Add additional images if available
          if (product.galleryImages && product.galleryImages.length > 0) {
            product.galleryImages.slice(0, 10).forEach((img) => {
              if (img) {
                const additionalImageUrl = img.startsWith("http") ? img : `https://www.grabatoz.ae${img}`
                xml += `
      <g:additional_image_link>${additionalImageUrl}</g:additional_image_link>`
              }
            })
          }

          // Add weight if available
          if (product.weight && product.weight > 0) {
            xml += `
      <g:shipping_weight>${product.weight} kg</g:shipping_weight>`
          }

          // Add custom labels for filtering
          if (product.featured) {
            xml += `
      <g:custom_label_0>Featured</g:custom_label_0>`
          }

          if (product.tags && product.tags.length > 0) {
            const tagsString = product.tags.slice(0, 3).join(", ")
            xml += `
      <g:custom_label_1><![CDATA[${cleanForCDATA(tagsString)}]]></g:custom_label_1>`
          }

          xml += `
    </item>
`
          processedCount++
        } catch (productError) {
          console.error(`Error processing product ${product._id} for XML:`, productError)
          continue
        }
      }

      xml += `  </channel>
</rss>`

      console.log(`XML feed generated with ${processedCount} products out of ${totalCount} total`)
      console.log(`XML Availability stats:`, availabilityStats)
      res.send(xml)
    } catch (error) {
      console.error("Google Merchant XML feed error:", error)
      res.status(500).send(`<?xml version="1.0" encoding="UTF-8"?>
<error>
  <message><![CDATA[Error generating product feed: ${error.message}]]></message>
</error>`)
    }
  }),
)

// @desc    Generate paginated feed for large datasets
// @route   GET /api/google-merchant/feed-paginated.json
// @access  Public
router.get(
  "/feed-paginated.json",
  asyncHandler(async (req, res) => {
    try {
      const page = Number.parseInt(req.query.page) || 1
      const limit = Number.parseInt(req.query.limit) || 500 // Default 500 products per page
      const skip = (page - 1) * limit

      const query = {
        $or: [{ isActive: true }, { isActive: { $exists: false } }],
      }

      const totalCount = await Product.countDocuments(query)
      const totalPages = Math.ceil(totalCount / limit)

      const products = await Product.find(query)
        .populate("brand", "name")
        .populate("category", "name")
        .populate("parentCategory", "name")
        .skip(skip)
        .limit(limit)
        .lean()

      res.json({
        pagination: {
          currentPage: page,
          totalPages: totalPages,
          totalProducts: totalCount,
          productsPerPage: limit,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
          nextPage: page < totalPages ? page + 1 : null,
          prevPage: page > 1 ? page - 1 : null,
        },
        products: products.map((product) => ({
          id: product._id.toString(),
          name: product.name,
          price: product.price,
          offerPrice: product.offerPrice,
          brand: product.brand?.name,
          category: product.category?.name,
          parentCategory: product.parentCategory?.name,
          stockStatus: product.stockStatus,
          countInStock: product.countInStock,
          isActive: product.isActive,
          availability: determineAvailability(product),
        })),
      })
    } catch (error) {
      console.error("Paginated feed error:", error)
      res.status(500).json({ error: error.message })
    }
  }),
)

export default router






