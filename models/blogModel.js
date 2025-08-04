import mongoose from "mongoose"

const blogSchema = new mongoose.Schema(
  {
    blogName: {
      type: String,
      required: true,
      trim: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ["draft", "published", "archived"],
      default: "draft",
    },
    mainCategory: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category", // Changed from BlogCategory to Category
      required: true,
    },
    subCategory: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SubCategory", // Changed from BlogCategory to SubCategory
    },
    topic: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BlogTopic",
    },
    brand: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Brand", // Added Brand reference
    },
    mainImage: {
      type: String,
    },
    additionalImage: {
      type: String,
    },
    readMinutes: {
      type: Number,
      default: 5,
    },
    postedBy: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      required: true,
    },
    metaTitle: {
      type: String,
    },
    metaDescription: {
      type: String,
    },
    tags: [
      {
        type: String,
        trim: true,
      },
    ],
    views: {
      type: Number,
      default: 0,
    },
    likes: {
      type: Number,
      default: 0,
    },
    shares: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  },
)

// Index for search functionality
blogSchema.index({ title: "text", description: "text", tags: "text" })

const Blog = mongoose.model("Blog", blogSchema)

export default Blog
