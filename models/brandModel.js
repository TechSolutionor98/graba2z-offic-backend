import mongoose from "mongoose"

const brandSchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    nameAr: {
      type: String,
      default: "",
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
    descriptionAr: {
      type: String,
      default: "",
    },
    logo: {
      type: String,
    },
    website: {
      type: String,
    },
    metaTitle: {
      type: String,
      default: "",
      trim: true,
      maxlength: 180,
    },
    metaDescription: {
      type: String,
      default: "",
      trim: true,
      maxlength: 300,
    },
    seoTitle: {
      type: String,
      default: "",
      trim: true,
      maxlength: 180,
    },
    seoDescription: {
      type: String,
      default: "",
      trim: true,
      maxlength: 300,
    },
    seoKeywords: {
      type: String,
      default: "",
      trim: true,
    },
    seoCanonicalUrl: {
      type: String,
      default: "",
      trim: true,
    },
    seoRobots: {
      type: String,
      enum: ["index, follow", "noindex, follow", "index, nofollow", "noindex, nofollow"],
      default: "index, follow",
    },
    customSchema: {
      type: String,
      default: "",
      trim: true,
    },
    ogTitle: {
      type: String,
      default: "",
      trim: true,
    },
    ogDescription: {
      type: String,
      default: "",
      trim: true,
    },
    ogImage: {
      type: String,
      default: "",
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  {
    timestamps: true,
  },
)

const Brand = mongoose.model("Brand", brandSchema)

export default Brand
