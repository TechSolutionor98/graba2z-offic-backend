import SubCategory from "../models/subCategoryModel.js"

const TARGET_INDEX_NAME = "uniq_subcategory_slug_per_parent_level_scope"

// Keeps subcategory slug uniqueness scoped to sibling nodes only.
export const ensureSubCategorySlugIndexes = async () => {
  try {
    const indexes = await SubCategory.collection.indexes()

    const legacyGlobalSlugUnique = indexes.find((index) => {
      const keys = Object.keys(index.key || {})
      return index.unique && keys.length === 1 && keys[0] === "slug"
    })

    const legacyScopedSlugUnique = indexes.find(
      (index) => index.unique && index.name === "uniq_subcategory_slug_per_parent_scope",
    )

    if (legacyGlobalSlugUnique) {
      console.log(`Dropping legacy global subcategory slug index: ${legacyGlobalSlugUnique.name}`)
      await SubCategory.collection.dropIndex(legacyGlobalSlugUnique.name)
    }

    if (legacyScopedSlugUnique) {
      console.log(`Dropping legacy subcategory scoped slug index: ${legacyScopedSlugUnique.name}`)
      await SubCategory.collection.dropIndex(legacyScopedSlugUnique.name)
    }

    await SubCategory.collection.createIndex(
      { category: 1, parentSubCategory: 1, level: 1, slug: 1, isDeleted: 1 },
      { unique: true, name: TARGET_INDEX_NAME },
    )

    console.log(`Ensured subcategory slug index: ${TARGET_INDEX_NAME}`)
  } catch (error) {
    // Do not block server boot; log and allow API to continue.
    if (error?.code === 11000) {
      console.error(
        "Failed to ensure subcategory slug indexes due duplicate sibling-scope slug values. Run `npm run fix:subcategory-slugs:rebuild`.",
      )
    }
    console.error("Failed to ensure subcategory slug indexes:", error.message)
  }
}
