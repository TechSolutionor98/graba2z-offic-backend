import mongoose from "mongoose"

const subCategorySchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
    },
    description: {
      type: String,
      trim: true,
    },
    seoContent: {
      type: String,
      default: "",
    },
    metaTitle: {
      type: String,
      default: "",
      trim: true,
      maxlength: 100, // Increased limit for better SEO flexibility
    },
    metaDescription: {
      type: String,
      default: "",
      trim: true,
      maxlength: 300, // Increased limit for better SEO flexibility
    },
    redirectUrl: {
      type: String,
      default: "",
      trim: true,
    },
    image: {
      type: String,
    },
    // Whether this subcategory should appear in the Home page category slider
    showInSlider: {
      type: Boolean,
      default: false,
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: true,
    },
    // Parent subcategory for nested subcategories (optional)
    parentSubCategory: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SubCategory",
      default: null,
    },
    // Level indicator (1, 2, 3, or 4)
    level: {
      type: Number,
      default: 1,
      min: 1,
      max: 4,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
    deletedAt: {
      type: Date,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
  },
)

// Add index for better performance
subCategorySchema.index({ isDeleted: 1, isActive: 1, category: 1 })
subCategorySchema.index({ parentSubCategory: 1, level: 1 })

const SubCategory = mongoose.model("SubCategory", subCategorySchema)

export default SubCategory
