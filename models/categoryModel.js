// import mongoose from "mongoose"

// const categorySchema = mongoose.Schema(
//   {
//     name: {
//       type: String,
//       required: true,
//       trim: true,
//     },
//     slug: {
//       type: String,
//       required: true,
//       unique: true,
//       lowercase: true,
//     },
//     description: {
//       type: String,
//       trim: true,
//     },
//     image: {
//       type: String,
//     },
//     isActive: {
//       type: Boolean,
//       default: true,
//     },
//     sortOrder: {
//       type: Number,
//       default: 0,
//     },
//     isDeleted: {
//       type: Boolean,
//       default: false,
//     },
//     deletedAt: {
//       type: Date,
//     },
//     createdBy: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: "User",
//     },
//   },
//   {
//     timestamps: true,
//   },
// )

// // Add index for better performance
// categorySchema.index({ isDeleted: 1, isActive: 1 })

// const Category = mongoose.model("Category", categorySchema)

// export default Category


import mongoose from "mongoose"

const categorySchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      unique: true,
      sparse: true,
    },
    description: {
      type: String,
      default: "",
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
      default: "",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    isDeleted: {
      type: Boolean,
      default: false,
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

// Index for better performance
categorySchema.index({ name: 1 })
categorySchema.index({ slug: 1 })
categorySchema.index({ isActive: 1 })

const Category = mongoose.model("Category", categorySchema)

export default Category
