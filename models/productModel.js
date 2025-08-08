
import mongoose from "mongoose"

const productSchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    sku: {
      type: String,
      unique: true,
      sparse: true,
    },
    slug: {
      type: String,
      unique: true,
      sparse: true,
    },
    barcode: {
      type: String,
      unique: true,
      sparse: true,
    },
    stockStatus: {
      type: String,
      required: true,
      default: "Available Product",
      enum: ["Available Product", "Out of Stock", "PreOrder"],
    },
    brand: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Brand",
      required: true,
    },
    // Main category (shown in navbar)
    parentCategory: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: true,
    },
    // Subcategory (shown in dropdown)
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SubCategory",
    },
    // Keep old category field for backward compatibility
    subCategory: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SubCategory",
    },
    description: {
      type: String,
      required: true,
    },
    shortDescription: {
      type: String,
    },
    buyingPrice: {
      type: Number,
      required: true,
      default: 0,
    },
    price: {
      type: Number,
      required: true,
      default: 0,
    },
    offerPrice: {
      type: Number,
      default: 0,
    },
    discount: {
      type: Number,
      default: 0,
    },
    oldPrice: {
      type: Number,
    },
    image: {
      type: String,
    },
    galleryImages: [
      {
        type: String,
      },
    ],
    countInStock: {
      type: Number,
      required: true,
      default: 0,
    },
    lowStockWarning: {
      type: Number,
      default: 5,
    },
    maxPurchaseQty: {
      type: Number,
      default: 10,
    },
    weight: {
      type: Number,
      default: 0,
    },
    unit: {
      type: String,
      default: "piece",
    },
    tax: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tax",
    },
    deliveryCharge: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DeliveryCharge",
    },
    tags: [
      {
        type: String,
      },
    ],
    isActive: {
      type: Boolean,
      default: true,
    },
    canPurchase: {
      type: Boolean,
      default: true,
    },
    showStockOut: {
      type: Boolean,
      default: true,
    },
    refundable: {
      type: Boolean,
      default: true,
    },
    featured: {
      type: Boolean,
      default: false,
    },
    rating: {
      type: Number,
      default: 0,
    },
    numReviews: {
      type: Number,
      default: 0,
    },
    specifications: [
      {
        key: { type: String },
        value: { type: String },
      },
    ],
    reviews: [
      {
        name: { type: String, required: true },
        rating: { type: Number, required: true },
        comment: { type: String, required: true },
        user: {
          type: mongoose.Schema.Types.ObjectId,
          required: true,
          ref: "User",
        },
      },
      {
        timestamps: true,
      },
    ],
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
  },
)

const Product = mongoose.model("Product", productSchema)

export default Product
