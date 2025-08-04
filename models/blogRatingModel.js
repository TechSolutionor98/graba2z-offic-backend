import mongoose from "mongoose"

const blogRatingSchema = new mongoose.Schema(
  {
    blog: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Blog",
      required: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    comment: {
      type: String,
      trim: true,
    },
    isApproved: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  },
)

// Ensure one rating per user per blog
blogRatingSchema.index({ blog: 1, user: 1 }, { unique: true })

const BlogRating = mongoose.model("BlogRating", blogRatingSchema)

export default BlogRating
