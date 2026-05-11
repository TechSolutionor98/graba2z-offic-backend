import mongoose from "mongoose"

const seoPageSchema = new mongoose.Schema(
  {
    pageKey: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    pageName: {
      type: String,
      required: true,
      trim: true,
    },
    routePath: {
      type: String,
      required: true,
      trim: true,
    },
    seoTitle: {
      type: String,
      default: "",
      trim: true,
    },
    seoDescription: {
      type: String,
      default: "",
      trim: true,
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
      default: "index, follow",
      enum: ["index, follow", "noindex, follow", "index, nofollow", "noindex, nofollow"],
    },
    customSchema: {
      type: String,
      default: "",
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
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
  },
)

const SeoPage = mongoose.model("SeoPage", seoPageSchema)

export default SeoPage
