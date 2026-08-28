import mongoose from "mongoose"
import dotenv from "dotenv"
import path from "path"
import { fileURLToPath } from "url"
import Product from "../models/productModel.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

dotenv.config({ path: path.join(__dirname, "../.env") })

const connectDB = async () => {
  try {
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI_2
    if (!mongoUri) {
      throw new Error("MONGO_URI is not defined in .env file")
    }
    const conn = await mongoose.connect(mongoUri)
    console.log(`[Script] MongoDB Connected: ${conn.connection.host}`)
  } catch (error) {
    console.error(`[Script Error] Database connection failed:`, error.message)
    process.exit(1)
  }
}

const updateProductQuantities = async () => {
  try {
    await connectDB()

    console.log("\n=======================================================")
    console.log("Starting Product Quantity Update Script...")
    console.log("Criteria: Products in stock ('In Stock') with no quantity (countInStock <= 0 or missing)")
    console.log("Target Quantity: 100")
    console.log("=======================================================\n")

    // Find products where stockStatus is 'In Stock' (or missing/null/empty) and countInStock is <= 0 or missing
    const filter = {
      $and: [
        {
          $or: [
            { stockStatus: "In Stock" },
            { stockStatus: { $exists: false } },
            { stockStatus: null },
            { stockStatus: "" },
          ],
        },
        {
          $or: [
            { countInStock: { $lte: 0 } },
            { countInStock: { $exists: false } },
            { countInStock: null },
          ],
        },
      ],
    }

    const matchingProducts = await Product.find(filter)
    console.log(`[Script] Found ${matchingProducts.length} product(s) matching criteria.\n`)

    if (matchingProducts.length === 0) {
      console.log("[Script] No products require quantity update.")
      process.exit(0)
    }

    let updatedCount = 0

    for (const product of matchingProducts) {
      const oldQty = product.countInStock ?? 0
      product.countInStock = 100

      // If stockStatus was missing/null/empty, set it explicitly to "In Stock"
      if (!product.stockStatus || product.stockStatus === "") {
        product.stockStatus = "In Stock"
      }

      // Also update variations if they have countInStock <= 0
      let updatedVariations = false
      if (Array.isArray(product.colorVariations) && product.colorVariations.length > 0) {
        product.colorVariations.forEach((v) => {
          if (!v.countInStock || v.countInStock <= 0) {
            v.countInStock = 100
            updatedVariations = true
          }
        })
      }

      if (Array.isArray(product.dosVariations) && product.dosVariations.length > 0) {
        product.dosVariations.forEach((v) => {
          if (!v.countInStock || v.countInStock <= 0) {
            v.countInStock = 100
            updatedVariations = true
          }
        })
      }

      await product.save()
      updatedCount++

      console.log(
        `✓ Updated Product: "${product.name}" (ID: ${product._id}) | SKU: ${product.sku || "N/A"} | Old Qty: ${oldQty} -> New Qty: 100${
          updatedVariations ? " (including variations)" : ""
        }`
      )
    }

    console.log("\n=======================================================")
    console.log(`[Script Completed Successfully]`)
    console.log(`Total Products Updated: ${updatedCount}`)
    console.log("=======================================================\n")

    process.exit(0)
  } catch (error) {
    console.error("[Script Error] Failed to update products:", error)
    process.exit(1)
  }
}

updateProductQuantities()
