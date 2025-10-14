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
      maxlength: 60, // Google typically displays 50-60 characters
    },
    metaDescription: {
      type: String,
      default: "",
      trim: true,
      maxlength: 160, // Google typically displays 150-160 characters
    },
    redirectUrl: {
      type: String,
      default: "",
      trim: true,
    },
    image: {
      type: String,
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: true,
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

const SubCategory = mongoose.model("SubCategory", subCategorySchema)

export default SubCategory
