import dotenv from "dotenv"
import mongoose from "mongoose"
import { translate as bingTranslate } from "bing-translate-api"
import connectDB, { connectBlogDB } from "../config/db.js"
import Blog from "../models/blogModel.js"
import BlogCategory from "../models/blogCategoryModel.js"
import BlogTopic from "../models/blogTopicModel.js"
import BlogBrand from "../models/blogBrandModel.js"

dotenv.config()

const args = process.argv.slice(2)
const force = args.includes("--force")
const typeArg = args.find((arg) => arg.startsWith("--type="))
const targetType = typeArg ? typeArg.split("=")[1] : "all"

const shouldProcess = (entityType) => targetType === "all" || targetType === entityType

const MAX_RETRIES = Number(process.env.BLOG_ARABIC_RETRIES || 4)
const RETRY_DELAY_MS = Number(process.env.BLOG_ARABIC_RETRY_DELAY_MS || 700)
const TRANSLATE_TIMEOUT_MS = Number(process.env.BLOG_ARABIC_TIMEOUT_MS || 12000)
const CHUNK_CONCURRENCY = Number(process.env.BLOG_ARABIC_CONCURRENCY || 8)

const isArabicText = (value) => /[\u0600-\u06FF]/.test(String(value || ""))
const normalizeText = (value) => String(value || "").replace(/\u00A0/g, " ").trim()
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const hasArabicValue = (value) => isArabicText(normalizeText(value))
const hasArabicInTagList = (value) => toTagArray(value).some((tag) => hasArabicValue(tag))

const withTimeout = (promise, ms) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("Translation timeout")), ms)),
  ])

const mapWithConcurrency = async (items, limit, iteratee) => {
  const results = new Array(items.length)
  let index = 0

  const worker = async () => {
    while (index < items.length) {
      const current = index
      index += 1
      results[current] = await iteratee(items[current], current)
    }
  }

  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => worker())
  await Promise.all(workers)
  return results
}

const translatePlainTextToArabic = async (value) => {
  const source = normalizeText(value)
  if (!source) return ""
  if (isArabicText(source)) return source

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const result = await withTimeout(bingTranslate(source, null, "ar"), TRANSLATE_TIMEOUT_MS)
      const translated = normalizeText(result?.translation)
      if (translated) return translated
    } catch (error) {
      if (attempt === MAX_RETRIES) {
        console.error(`Bing translation failed after ${MAX_RETRIES} attempts:`, error.message)
        break
      }
      await sleep(RETRY_DELAY_MS * attempt)
    }
  }

  return source
}

const translateHtmlToArabicPreservingTags = async (html) => {
  const source = typeof html === "string" ? html : ""
  if (!source.trim()) return ""
  if (!source.includes("<")) return translatePlainTextToArabic(source)

  const tokens = source.split(/(<[^>]+>)/g)
  const textChunks = []

  tokens.forEach((token) => {
    if (!token || token.startsWith("<")) return
    const match = token.match(/^(\s*)([\s\S]*?)(\s*)$/)
    if (!match) return
    const core = match[2]?.trim()
    if (!core) return
    textChunks.push(core)
  })

  const uniqueChunks = [...new Set(textChunks)]
  const translatedMap = new Map()

  await mapWithConcurrency(uniqueChunks, CHUNK_CONCURRENCY, async (chunk) => {
    const translated = await translatePlainTextToArabic(chunk)
    translatedMap.set(chunk, translated || chunk)
  })

  const rebuilt = tokens.map((token) => {
    if (!token || token.startsWith("<")) return token
    const match = token.match(/^(\s*)([\s\S]*?)(\s*)$/)
    if (!match) return token

    const leading = match[1] || ""
    const coreRaw = match[2] || ""
    const trailing = match[3] || ""
    const core = coreRaw.trim()
    if (!core) return token

    return `${leading}${translatedMap.get(core) || core}${trailing}`
  })

  return rebuilt.join("")
}

const toTagArray = (value) => {
  if (Array.isArray(value)) return value.map((tag) => String(tag).trim()).filter(Boolean)
  if (typeof value === "string") {
    return value
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean)
  }
  return []
}

const translateTagListToArabic = async (tags) => {
  const list = toTagArray(tags)
  if (!list.length) return []
  const translated = await mapWithConcurrency(list, Math.min(CHUNK_CONCURRENCY, 6), (tag) =>
    translatePlainTextToArabic(tag),
  )
  return translated.map((item, index) => item || list[index])
}

const buildBlogArabicPayload = async (payload) => ({
  blogNameAr: await translatePlainTextToArabic(payload.blogName),
  titleAr: await translatePlainTextToArabic(payload.title),
  postedByAr: await translatePlainTextToArabic(payload.postedBy),
  descriptionAr: await translateHtmlToArabicPreservingTags(payload.description),
  metaTitleAr: await translatePlainTextToArabic(payload.metaTitle),
  metaDescriptionAr: await translatePlainTextToArabic(payload.metaDescription),
  tagsAr: await translateTagListToArabic(payload.tags),
})

const buildBlogCategoryArabicPayload = async (payload) => ({
  nameAr: await translatePlainTextToArabic(payload.name),
  descriptionAr: await translatePlainTextToArabic(payload.description),
  metaTitleAr: await translatePlainTextToArabic(payload.metaTitle),
  metaDescriptionAr: await translatePlainTextToArabic(payload.metaDescription),
})

const buildBlogTopicArabicPayload = async (payload) => ({
  nameAr: await translatePlainTextToArabic(payload.name),
  descriptionAr: await translatePlainTextToArabic(payload.description),
})

const buildBlogBrandArabicPayload = async (payload) => ({
  nameAr: await translatePlainTextToArabic(payload.name),
  descriptionAr: await translatePlainTextToArabic(payload.description),
  metaTitleAr: await translatePlainTextToArabic(payload.metaTitle),
  metaDescriptionAr: await translatePlainTextToArabic(payload.metaDescription),
})

const runBlogs = async () => {
  if (!shouldProcess("blogs")) return { total: 0, updated: 0 }

  const blogs = await Blog.find({})
  let updated = 0

  for (let i = 0; i < blogs.length; i += 1) {
    const blog = blogs[i]
    const needs =
      force ||
      !hasArabicValue(blog.titleAr) ||
      !hasArabicValue(blog.descriptionAr) ||
      !hasArabicValue(blog.blogNameAr) ||
      !hasArabicValue(blog.postedByAr) ||
      !Array.isArray(blog.tagsAr) ||
      blog.tagsAr.length === 0 ||
      !hasArabicInTagList(blog.tagsAr)

    if (!needs) continue
    console.log(`[blogs] ${i + 1}/${blogs.length} translating ${blog.slug}`)

    const arPayload = await buildBlogArabicPayload({
      blogName: blog.blogName,
      title: blog.title,
      postedBy: blog.postedBy,
      description: blog.description,
      metaTitle: blog.metaTitle,
      metaDescription: blog.metaDescription,
      tags: blog.tags,
    })

    Object.assign(blog, arPayload)
    await blog.save()
    updated += 1
    console.log(`[blogs] ${i + 1}/${blogs.length} saved ${blog.slug}`)
  }

  return { total: blogs.length, updated }
}

const runCategories = async () => {
  if (!shouldProcess("categories")) return { total: 0, updated: 0 }

  const categories = await BlogCategory.find({})
  let updated = 0

  for (const category of categories) {
    const needs =
      force ||
      !hasArabicValue(category.nameAr) ||
      (category.description && !hasArabicValue(category.descriptionAr))
    if (!needs) continue

    const arPayload = await buildBlogCategoryArabicPayload({
      name: category.name,
      description: category.description,
      metaTitle: category.metaTitle,
      metaDescription: category.metaDescription,
    })

    Object.assign(category, arPayload)
    await category.save()
    updated += 1
  }

  return { total: categories.length, updated }
}

const runTopics = async () => {
  if (!shouldProcess("topics")) return { total: 0, updated: 0 }

  const topics = await BlogTopic.find({})
  let updated = 0

  for (const topic of topics) {
    const needs =
      force ||
      !hasArabicValue(topic.nameAr) ||
      (topic.description && !hasArabicValue(topic.descriptionAr))
    if (!needs) continue

    const arPayload = await buildBlogTopicArabicPayload({
      name: topic.name,
      description: topic.description,
    })

    Object.assign(topic, arPayload)
    await topic.save()
    updated += 1
  }

  return { total: topics.length, updated }
}

const runBrands = async () => {
  if (!shouldProcess("brands")) return { total: 0, updated: 0 }

  const brands = await BlogBrand.find({})
  let updated = 0

  for (const brand of brands) {
    const needs =
      force ||
      !hasArabicValue(brand.nameAr) ||
      (brand.description && !hasArabicValue(brand.descriptionAr))
    if (!needs) continue

    const arPayload = await buildBlogBrandArabicPayload({
      name: brand.name,
      description: brand.description,
      metaTitle: brand.metaTitle,
      metaDescription: brand.metaDescription,
    })

    Object.assign(brand, arPayload)
    await brand.save()
    updated += 1
  }

  return { total: brands.length, updated }
}

const run = async () => {
  await connectDB()
  await connectBlogDB()

  const [blogs, categories, topics, brands] = await Promise.all([
    runBlogs(),
    runCategories(),
    runTopics(),
    runBrands(),
  ])

  console.log("✅ Blog Arabic backfill complete (direct Bing mode)")
  console.log(`blogs: updated ${blogs.updated} / ${blogs.total}`)
  console.log(`categories: updated ${categories.updated} / ${categories.total}`)
  console.log(`topics: updated ${topics.updated} / ${topics.total}`)
  console.log(`brands: updated ${brands.updated} / ${brands.total}`)
}

run()
  .then(async () => {
    await mongoose.disconnect()
    process.exit(0)
  })
  .catch(async (error) => {
    console.error("❌ Blog Arabic backfill failed:", error)
    await mongoose.disconnect()
    process.exit(1)
  })
