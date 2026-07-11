import mongoose from "mongoose"

const indexNowLogSchema = new mongoose.Schema(
  {
    urls: [
      {
        type: String,
        required: true,
        trim: true,
      },
    ],
    responseStatus: {
      type: Number,
      required: true,
    },
    responseMessage: {
      type: String,
      trim: true,
    },
    triggerType: {
      type: String,
      required: true,
      enum: [
        "manual_single",
        "manual_sitemap",
        "auto_product",
        "auto_blog",
        "auto_category",
        "auto_subcategory",
        "auto_brand",
      ],
    },
    initiatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
  },
)

// Index for query performance
indexNowLogSchema.index({ createdAt: -1 })
indexNowLogSchema.index({ triggerType: 1 })

const IndexNowLog = mongoose.model("IndexNowLog", indexNowLogSchema)

export default IndexNowLog
