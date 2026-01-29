import mongoose from "mongoose"
import { getBlogConnection } from "../config/db.js"

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
    featured: {
      type: Boolean,
      default: false,
    },
    trending: {
      type: Boolean,
      default: false,
    },
    blogCategory: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BlogCategory",
    },
    // Keep old fields for backward compatibility
    mainCategory: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
    },
    subCategory1: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SubCategory",
    },
    subCategory2: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SubCategory",
    },
    subCategory3: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SubCategory",
    },
    subCategory4: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SubCategory",
    },
    topic: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BlogTopic",
    },
    brand: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BlogBrand",
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

// Lazy initialization - model created on first use
let Blog = null

function getModel() {
  if (!Blog) {
    const connection = getBlogConnection()
    Blog = connection.model("Blog", blogSchema)
  }
  return Blog
}

const BlogProxy = new Proxy(function() {}, {
  get(target, prop) {
    return getModel()[prop]
  },
  construct(target, args) {
    const Model = getModel()
    return new Model(...args)
  },
  apply(target, thisArg, args) {
    return getModel()(...args)
  }
})

export default BlogProxy

