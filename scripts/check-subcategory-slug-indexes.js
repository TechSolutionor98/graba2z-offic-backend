import dotenv from "dotenv"
import connectDB from "../config/db.js"
import SubCategory from "../models/subCategoryModel.js"

dotenv.config()

const TARGET_INDEX_NAME = "uniq_subcategory_slug_per_parent_level_scope"

const isLegacyGlobalSlugIndex = (index = {}) => {
  const keys = Object.keys(index.key || {})
  return index.unique && keys.length === 1 && keys[0] === "slug"
}

const isTargetScopedSlugIndex = (index = {}) => {
  const key = index.key || {}
  return (
    index.unique &&
    index.name === TARGET_INDEX_NAME &&
    key.category === 1 &&
    key.parentSubCategory === 1 &&
    key.level === 1 &&
    key.slug === 1 &&
    key.isDeleted === 1
  )
}

const main = async () => {
  await connectDB()

  const indexes = await SubCategory.collection.indexes()
  const legacyGlobalSlugIndexes = indexes.filter(isLegacyGlobalSlugIndex)
  const targetScopedIndex = indexes.find(isTargetScopedSlugIndex)

  const summary = {
    totalIndexes: indexes.length,
    hasLegacyGlobalSlugUniqueIndex: legacyGlobalSlugIndexes.length > 0,
    legacyGlobalSlugUniqueIndexNames: legacyGlobalSlugIndexes.map((index) => index.name),
    hasTargetScopedSlugUniqueIndex: Boolean(targetScopedIndex),
    targetScopedSlugUniqueIndexName: targetScopedIndex?.name || null,
  }

  console.log("Subcategory slug index verification summary:")
  console.log(JSON.stringify(summary, null, 2))

  if (summary.hasLegacyGlobalSlugUniqueIndex) {
    console.log("Action needed: drop legacy global unique slug index via fix:subcategory-slugs script.")
  }

  if (!summary.hasTargetScopedSlugUniqueIndex) {
    console.log("Action needed: create target scoped slug unique index via fix:subcategory-slugs script.")
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Failed to verify subcategory slug indexes:", error)
    process.exit(1)
  })

