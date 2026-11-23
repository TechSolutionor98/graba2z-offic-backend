import mongoose from "mongoose"

const backInStockSchema = mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
    },
    country: {
      type: String,
      default: "AE",
    },
    countryCode: {
      type: String,
      default: "AE",
    },
    // For electronics: Color, OS/DOS, or Spec variation
    variant: {
      type: String,
      default: "",
      trim: true,
    },
    selectedColor: {
      type: String,
      default: "",
    },
    selectedDos: {
      type: String,
      default: "",
    },
    selectedOption: {
      type: String,
      default: "",
    },
    notified: {
      type: Boolean,
      default: false,
      index: true,
    },
    notifiedAt: {
      type: Date,
      default: null,
    },
    // Backup snapshot of product at time of subscription
    metadata: {
      productName: { type: String, default: "" },
      productNameAr: { type: String, default: "" },
      productPrice: { type: Number, default: 0 },
      productImage: { type: String, default: "" },
      slug: { type: String, default: "" },
      sku: { type: String, default: "" },
    },
  },
  {
    timestamps: true,
  },
)

// Ensure uniqueness per product + email + variant when not yet notified
backInStockSchema.index({ product: 1, email: 1, variant: 1, notified: 1 })

const BackInStock = mongoose.model("BackInStock", backInStockSchema)

export default BackInStock

