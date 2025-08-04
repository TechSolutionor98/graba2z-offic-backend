import mongoose from "mongoose"

const blogTopicSchema = new mongoose.Schema(
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
    color: {
      type: String,
      default: "#3B82F6",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    blogCount: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  },
)

const BlogTopic = mongoose.model("BlogTopic", blogTopicSchema)

export default BlogTopic
