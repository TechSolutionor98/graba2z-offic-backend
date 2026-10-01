import mongoose from "mongoose"

const seoPageSchema = new mongoose.Schema(
  {
    pageKey: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    // Which country this SEO record is for, e.g. "AE", "SA". An empty string is the
    // default record used by every country that has no record of its own. Uniqueness is
    // therefore on the pair (pageKey + countryCode), not on pageKey alone.
    countryCode: {
      type: String,
      default: "",
      trim: true,
      uppercase: true,
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
    seoContent: {
      type: String,
      default: "",
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

// One record per page per country. The legacy single-field unique index on pageKey is
// dropped at startup (see ensureStaticPages in routes/seoPageRoutes.js), otherwise it
// would reject the second country for a page.
seoPageSchema.index({ pageKey: 1, countryCode: 1 }, { unique: true })

const SeoPage = mongoose.model("SeoPage", seoPageSchema)

export default SeoPage
