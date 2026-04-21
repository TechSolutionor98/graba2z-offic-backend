import dotenv from "dotenv"
import connectDB from "../config/db.js"
import SubCategory from "../models/subCategoryModel.js"

dotenv.config()

const normalizeSlug = (value = "") =>
  String(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

const buildScopeQuery = ({ category, parentSubCategory, level, excludeId = null }) => ({
  category,
  parentSubCategory: parentSubCategory || null,
  level,
  isDeleted: { $ne: true },
  ...(excludeId ? { _id: { $ne: excludeId } } : {}),
})

const buildUniqueSlugInScope = async (baseSlug, { category, parentSubCategory, level, excludeId = null }) => {
  let nextSlug = baseSlug
  let counter = 1

  while (
    await SubCategory.findOne({
      ...buildScopeQuery({ category, parentSubCategory, level, excludeId }),
      slug: nextSlug,
    })
  ) {
    nextSlug = `${baseSlug}-${counter}`
    counter += 1
  }

  return nextSlug
}

const dropLegacySlugIndexes = async () => {
  const indexes = await SubCategory.collection.indexes()
  const legacyGlobalSlugUnique = indexes.find(
    (index) => index.unique && index.key && Object.keys(index.key).length === 1 && index.key.slug === 1,
  )
  const legacyScopedSlugUnique = indexes.find(
    (index) => index.unique && index.name === "uniq_subcategory_slug_per_parent_scope",
  )

  if (legacyGlobalSlugUnique) {
    console.log(`Dropping legacy global unique slug index: ${legacyGlobalSlugUnique.name}`)
    await SubCategory.collection.dropIndex(legacyGlobalSlugUnique.name)
  }

  if (legacyScopedSlugUnique) {
    console.log(`Dropping legacy scoped slug index: ${legacyScopedSlugUnique.name}`)
    await SubCategory.collection.dropIndex(legacyScopedSlugUnique.name)
  }
}

const createScopedSlugIndex = async () => {
  await SubCategory.collection.createIndex(
    { category: 1, parentSubCategory: 1, level: 1, slug: 1, isDeleted: 1 },
    { unique: true, name: "uniq_subcategory_slug_per_parent_level_scope" },
  )
  console.log("Ensured scoped slug index: uniq_subcategory_slug_per_parent_level_scope")
}

const rebuildSlugsFromNames = async () => {
  const docs = await SubCategory.find({ isDeleted: { $ne: true } })
    .select("_id name slug level category parentSubCategory")
    .sort({ level: 1, createdAt: 1 })

  let updated = 0

  for (const doc of docs) {
    const baseSlug =
      normalizeSlug(doc.name) || normalizeSlug(doc.slug) || `subcategory-${String(doc._id).slice(-6)}`

    const nextSlug = await buildUniqueSlugInScope(baseSlug, {
      category: doc.category,
      parentSubCategory: doc.parentSubCategory,
      level: doc.level || 1,
      excludeId: doc._id,
    })

    if (nextSlug !== doc.slug) {
      await SubCategory.updateOne({ _id: doc._id }, { $set: { slug: nextSlug } })
      updated += 1
      console.log(`Updated slug: ${doc.name} | ${doc.slug} -> ${nextSlug}`)
    }
  }

  return updated
}

const main = async () => {
  const shouldRebuild = process.argv.includes("--rebuild")

  await connectDB()
  await dropLegacySlugIndexes()

  if (shouldRebuild) {
    const updatedCount = await rebuildSlugsFromNames()
    console.log(`Rebuilt ${updatedCount} subcategory slug(s) from names with parent-scoped uniqueness.`)
  }

  try {
    await createScopedSlugIndex()
  } catch (error) {
    if (!shouldRebuild && error?.code === 11000) {
      console.error("Scoped slug index creation failed due existing duplicate slug values in sibling scope.")
      console.error("Re-run with --rebuild to normalize conflicting slug values before index creation.")
    }
    throw error
  }

  if (!shouldRebuild) {
    console.log("Done. Index migration complete. Use --rebuild to normalize existing slug values.")
  } else {
    console.log("Done. Rebuild + index migration complete.")
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Failed to fix subcategory slug parent scope:", error)
    process.exit(1)
  })
