import mongoose from "mongoose"

const staticPageTranslationSchema = new mongoose.Schema(
  {
    pageKey: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    routePath: {
      type: String,
      required: true,
      trim: true,
    },
    sourceText: {
      type: String,
      required: true,
      trim: true,
    },
    normalizedSourceText: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    translatedText: {
      type: String,
      required: true,
      trim: true,
    },
    provider: {
      type: String,
      default: "bing",
      trim: true,
    },
    lastTranslatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  },
)

staticPageTranslationSchema.index(
  { pageKey: 1, sourceText: 1 },
  { unique: true, name: "uniq_page_source_text" },
)
staticPageTranslationSchema.index({ pageKey: 1, normalizedSourceText: 1 }, { name: "idx_page_normalized_text" })

const StaticPageTranslation = mongoose.model("StaticPageTranslation", staticPageTranslationSchema)

export default StaticPageTranslation
