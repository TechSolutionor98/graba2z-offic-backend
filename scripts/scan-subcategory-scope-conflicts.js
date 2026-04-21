import dotenv from "dotenv"
import connectDB from "../config/db.js"
import SubCategory from "../models/subCategoryModel.js"

dotenv.config()

const main = async () => {
  await connectDB()

  const duplicateSlugScopes = await SubCategory.aggregate([
    { $match: { isDeleted: { $ne: true } } },
    {
      $group: {
        _id: {
          category: "$category",
          parentSubCategory: "$parentSubCategory",
          level: "$level",
          slug: "$slug",
        },
        count: { $sum: 1 },
        docs: {
          $push: {
            _id: "$_id",
            name: "$name",
            slug: "$slug",
          },
        },
      },
    },
    { $match: { count: { $gt: 1 } } },
    { $sort: { count: -1 } },
  ])

  const duplicateNameScopes = await SubCategory.aggregate([
    { $match: { isDeleted: { $ne: true } } },
    {
      $addFields: {
        normalizedName: { $toLower: { $trim: { input: "$name" } } },
      },
    },
    {
      $group: {
        _id: {
          category: "$category",
          parentSubCategory: "$parentSubCategory",
          level: "$level",
          normalizedName: "$normalizedName",
        },
        count: { $sum: 1 },
        docs: {
          $push: {
            _id: "$_id",
            name: "$name",
            slug: "$slug",
          },
        },
      },
    },
    { $match: { count: { $gt: 1 } } },
    { $sort: { count: -1 } },
  ])

  console.log("Subcategory sibling-scope conflict scan:")
  console.log(
    JSON.stringify(
      {
        duplicateSlugScopeCount: duplicateSlugScopes.length,
        duplicateNameScopeCount: duplicateNameScopes.length,
        duplicateSlugScopes: duplicateSlugScopes.slice(0, 20),
        duplicateNameScopes: duplicateNameScopes.slice(0, 20),
      },
      null,
      2,
    ),
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Failed to scan subcategory scope conflicts:", error)
    process.exit(1)
  })

