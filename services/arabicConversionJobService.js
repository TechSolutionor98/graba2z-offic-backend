import { translate as bingTranslate } from "bing-translate-api"
import Product from "../models/productModel.js"
import Category from "../models/categoryModel.js"
import SubCategory from "../models/subCategoryModel.js"
import Brand from "../models/brandModel.js"
import BannerCard from "../models/bannerCardModel.js"
import HomeSection from "../models/homeSectionModel.js"
import CustomSliderItem from "../models/customSliderItemModel.js"
import Blog from "../models/blogModel.js"
import BlogCategory from "../models/blogCategoryModel.js"
import BlogTopic from "../models/blogTopicModel.js"
import BlogBrand from "../models/blogBrandModel.js"

const TRANSLATION_RETRIES = Number(process.env.ARABIC_CONVERSION_RETRIES || 4)
const TRANSLATION_TIMEOUT_MS = Number(process.env.ARABIC_CONVERSION_TIMEOUT_MS || 16000)
const TRANSLATION_RETRY_DELAY_MS = Number(process.env.ARABIC_CONVERSION_RETRY_DELAY_MS || 900)
const TRANSLATION_CONCURRENCY = Number(process.env.ARABIC_CONVERSION_CONCURRENCY || 4)

const hasArabic = (value) => /[\u0600-\u06FF]/.test(String(value || ""))
const normalizeText = (value) => String(value || "").replace(/\u00A0/g, " ").trim()
const toTagArray = (value) => {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean)
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  }
  return []
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const withTimeout = (promise, ms) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("Translation timeout")), ms)),
  ])

const mapWithConcurrency = async (items, limit, iteratee) => {
  if (!items.length) return []

  const results = new Array(items.length)
  let cursor = 0

  const worker = async () => {
    while (cursor < items.length) {
      const currentIndex = cursor
      cursor += 1
      results[currentIndex] = await iteratee(items[currentIndex], currentIndex)
    }
  }

  const workerCount = Math.max(1, Math.min(limit, items.length))
  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return results
}

const textCache = new Map()

const translatePlainTextToArabic = async (value) => {
  const source = normalizeText(value)
  if (!source) return ""
  if (hasArabic(source)) return source

  const cacheHit = textCache.get(source)
  if (cacheHit) return cacheHit

  for (let attempt = 1; attempt <= TRANSLATION_RETRIES; attempt += 1) {
    try {
      const result = await withTimeout(bingTranslate(source, null, "ar"), TRANSLATION_TIMEOUT_MS)
      const translated = normalizeText(result?.translation)
      if (translated) {
        textCache.set(source, translated)
        return translated
      }
    } catch {
      if (attempt < TRANSLATION_RETRIES) {
        await sleep(TRANSLATION_RETRY_DELAY_MS * attempt)
      }
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
    const core = match?.[2]?.trim()
    if (!core) return
    textChunks.push(core)
  })

  const uniqueChunks = [...new Set(textChunks)]
  const translatedMap = new Map()

  await mapWithConcurrency(uniqueChunks, TRANSLATION_CONCURRENCY, async (chunk) => {
    const translated = await translatePlainTextToArabic(chunk)
    translatedMap.set(chunk, translated || chunk)
  })

  return tokens
    .map((token) => {
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
    .join("")
}

const toSerializable = (value) => JSON.parse(JSON.stringify(value))

const createIdleJob = (scope) => ({
  scope,
  status: "idle",
  message: "Not started",
  startedAt: null,
  finishedAt: null,
  requestedBy: null,
  total: 0,
  processed: 0,
  updated: 0,
  failed: 0,
  percentage: 0,
  currentEntity: "",
  currentItem: "",
  entities: [],
  logs: [],
})

const jobStore = {
  blog: createIdleJob("blog"),
  grab: createIdleJob("grab"),
}

const getEntityState = (job, key) => job.entities.find((entry) => entry.key === key)

const recomputeJobPercentage = (job) => {
  if (!job.total) {
    job.percentage = 0
    return
  }
  job.percentage = Math.max(0, Math.min(100, Math.round((job.processed / job.total) * 100)))
}

const pushJobLog = (job, type, message) => {
  job.logs.unshift({
    type,
    message,
    at: new Date().toISOString(),
  })
  if (job.logs.length > 150) {
    job.logs.length = 150
  }
}

const getDocumentLabel = (doc) =>
  normalizeText(doc?.slug) ||
  normalizeText(doc?.name) ||
  normalizeText(doc?.title) ||
  normalizeText(doc?.key) ||
  normalizeText(doc?._id)

const applyTranslatedField = async (doc, arField, sourceValue, { html = false, force = false } = {}) => {
  const source = normalizeText(sourceValue)
  if (!source) return false

  const current = normalizeText(doc[arField])
  // Missing-only mode: if Arabic field already has any value, skip it unless forced.
  if (!force && current) return false

  const translated = html
    ? await translateHtmlToArabicPreservingTags(String(sourceValue || ""))
    : await translatePlainTextToArabic(source)

  if (!translated || normalizeText(translated) === current) return false
  doc[arField] = translated
  return true
}

const applyTranslatedTags = async (doc, sourceField, arField, { force = false } = {}) => {
  const sourceTags = toTagArray(doc[sourceField])
  if (!sourceTags.length) return false

  const currentTags = Array.isArray(doc[arField]) ? doc[arField] : []
  const hasCompleteArValues =
    currentTags.length >= sourceTags.length &&
    sourceTags.every((_, index) => Boolean(normalizeText(currentTags[index])))

  if (!force && hasCompleteArValues) return false

  const translatedTags = await mapWithConcurrency(sourceTags, Math.min(TRANSLATION_CONCURRENCY, 6), (tag) =>
    translatePlainTextToArabic(tag),
  )

  doc[arField] = translatedTags.map((tag, index) => normalizeText(tag) || sourceTags[index])
  return true
}

const translateProductDocument = async (doc, { force }) => {
  let changed = false

  const fieldMap = [
    ["nameAr", "name", false],
    ["stockStatusAr", "stockStatus", false],
    ["descriptionAr", "description", true],
    ["shortDescriptionAr", "shortDescription", true],
    ["reverseVariationTextAr", "reverseVariationText", false],
    ["selfVariationTextAr", "selfVariationText", false],
    ["selfAvailableModelTextAr", "selfAvailableModelText", false],
  ]

  for (const [arField, sourceField, html] of fieldMap) {
    const fieldChanged = await applyTranslatedField(doc, arField, doc[sourceField], { html, force })
    changed = changed || fieldChanged
  }

  const tagsChanged = await applyTranslatedTags(doc, "tags", "tagsAr", { force })
  changed = changed || tagsChanged

  if (Array.isArray(doc.specifications) && doc.specifications.length) {
    let specsChanged = false
    for (const spec of doc.specifications) {
      if (normalizeText(spec?.key) && (force || !normalizeText(spec?.keyAr))) {
        spec.keyAr = await translatePlainTextToArabic(spec.key)
        specsChanged = true
      }
      if (normalizeText(spec?.value) && (force || !normalizeText(spec?.valueAr))) {
        spec.valueAr = await translatePlainTextToArabic(spec.value)
        specsChanged = true
      }
    }
    if (specsChanged) {
      doc.markModified("specifications")
      changed = true
    }
  }

  if (Array.isArray(doc.variations) && doc.variations.length) {
    let variationsChanged = false
    for (const item of doc.variations) {
      if (normalizeText(item?.variationText) && (force || !normalizeText(item?.variationTextAr))) {
        item.variationTextAr = await translatePlainTextToArabic(item.variationText)
        variationsChanged = true
      }
    }
    if (variationsChanged) {
      doc.markModified("variations")
      changed = true
    }
  }

  if (Array.isArray(doc.availableModels) && doc.availableModels.length) {
    let modelsChanged = false
    for (const item of doc.availableModels) {
      if (normalizeText(item?.variationText) && (force || !normalizeText(item?.variationTextAr))) {
        item.variationTextAr = await translatePlainTextToArabic(item.variationText)
        modelsChanged = true
      }
    }
    if (modelsChanged) {
      doc.markModified("availableModels")
      changed = true
    }
  }

  return changed
}

const translateCategoryDocument = async (doc, { force }) => {
  let changed = false
  changed = (await applyTranslatedField(doc, "nameAr", doc.name, { force })) || changed
  changed = (await applyTranslatedField(doc, "descriptionAr", doc.description, { html: true, force })) || changed
  changed = (await applyTranslatedField(doc, "seoContentAr", doc.seoContent, { html: true, force })) || changed
  changed = (await applyTranslatedField(doc, "metaTitleAr", doc.metaTitle, { force })) || changed
  changed = (await applyTranslatedField(doc, "metaDescriptionAr", doc.metaDescription, { force })) || changed
  return changed
}

const translateSubCategoryDocument = async (doc, { force }) => {
  let changed = false
  changed = (await applyTranslatedField(doc, "nameAr", doc.name, { force })) || changed
  changed = (await applyTranslatedField(doc, "descriptionAr", doc.description, { html: true, force })) || changed
  changed = (await applyTranslatedField(doc, "seoContentAr", doc.seoContent, { html: true, force })) || changed
  changed = (await applyTranslatedField(doc, "metaTitleAr", doc.metaTitle, { force })) || changed
  changed = (await applyTranslatedField(doc, "metaDescriptionAr", doc.metaDescription, { force })) || changed
  return changed
}

const translateBrandDocument = async (doc, { force }) => {
  let changed = false
  changed = (await applyTranslatedField(doc, "nameAr", doc.name, { force })) || changed
  changed = (await applyTranslatedField(doc, "descriptionAr", doc.description, { html: true, force })) || changed
  return changed
}

const translateBannerCardDocument = async (doc, { force }) => {
  let changed = false
  changed = (await applyTranslatedField(doc, "nameAr", doc.name, { force })) || changed
  changed = (await applyTranslatedField(doc, "detailsAr", doc.details, { html: true, force })) || changed
  return changed
}

const translateHomeSectionDocument = async (doc, { force }) => {
  let changed = false
  changed = (await applyTranslatedField(doc, "nameAr", doc.name, { force })) || changed
  changed = (await applyTranslatedField(doc, "descriptionAr", doc.description, { html: true, force })) || changed
  return changed
}

const translateCustomSliderItemDocument = async (doc, { force }) => {
  return applyTranslatedField(doc, "nameAr", doc.name, { force })
}

const translateBlogDocument = async (doc, { force }) => {
  let changed = false
  changed = (await applyTranslatedField(doc, "blogNameAr", doc.blogName, { force })) || changed
  changed = (await applyTranslatedField(doc, "titleAr", doc.title, { force })) || changed
  changed = (await applyTranslatedField(doc, "postedByAr", doc.postedBy, { force })) || changed
  changed = (await applyTranslatedField(doc, "descriptionAr", doc.description, { html: true, force })) || changed
  changed = (await applyTranslatedField(doc, "metaTitleAr", doc.metaTitle, { force })) || changed
  changed = (await applyTranslatedField(doc, "metaDescriptionAr", doc.metaDescription, { force })) || changed
  changed = (await applyTranslatedTags(doc, "tags", "tagsAr", { force })) || changed
  return changed
}

const translateBlogCategoryDocument = async (doc, { force }) => {
  let changed = false
  changed = (await applyTranslatedField(doc, "nameAr", doc.name, { force })) || changed
  changed = (await applyTranslatedField(doc, "descriptionAr", doc.description, { html: true, force })) || changed
  changed = (await applyTranslatedField(doc, "metaTitleAr", doc.metaTitle, { force })) || changed
  changed = (await applyTranslatedField(doc, "metaDescriptionAr", doc.metaDescription, { force })) || changed
  return changed
}

const translateBlogTopicDocument = async (doc, { force }) => {
  let changed = false
  changed = (await applyTranslatedField(doc, "nameAr", doc.name, { force })) || changed
  changed = (await applyTranslatedField(doc, "descriptionAr", doc.description, { html: true, force })) || changed
  return changed
}

const translateBlogBrandDocument = async (doc, { force }) => {
  let changed = false
  changed = (await applyTranslatedField(doc, "nameAr", doc.name, { force })) || changed
  changed = (await applyTranslatedField(doc, "descriptionAr", doc.description, { html: true, force })) || changed
  changed = (await applyTranslatedField(doc, "metaTitleAr", doc.metaTitle, { force })) || changed
  changed = (await applyTranslatedField(doc, "metaDescriptionAr", doc.metaDescription, { force })) || changed
  return changed
}

const buildGrabEntityPlans = () => [
  { key: "categories", label: "Categories", model: Category, transform: translateCategoryDocument },
  { key: "subcategories", label: "Sub Categories", model: SubCategory, transform: translateSubCategoryDocument },
  { key: "brands", label: "Brands", model: Brand, transform: translateBrandDocument },
  { key: "products", label: "Products", model: Product, transform: translateProductDocument },
  { key: "bannerCards", label: "Banner Cards", model: BannerCard, transform: translateBannerCardDocument },
  { key: "homeSections", label: "Home Sections", model: HomeSection, transform: translateHomeSectionDocument },
  { key: "customSliderItems", label: "Custom Slider Items", model: CustomSliderItem, transform: translateCustomSliderItemDocument },
]

const buildBlogEntityPlans = () => [
  { key: "blogCategories", label: "Blog Categories", model: BlogCategory, transform: translateBlogCategoryDocument },
  { key: "blogTopics", label: "Blog Topics", model: BlogTopic, transform: translateBlogTopicDocument },
  { key: "blogBrands", label: "Blog Brands", model: BlogBrand, transform: translateBlogBrandDocument },
  { key: "blogs", label: "Blogs", model: Blog, transform: translateBlogDocument },
]

const runEntityPlan = async (job, entityConfig, { force }) => {
  const entityState = getEntityState(job, entityConfig.key)
  if (!entityState) return

  entityState.status = "running"
  job.currentEntity = entityConfig.label

  const cursor = entityConfig.model.find({}).cursor()
  for await (const doc of cursor) {
    const label = getDocumentLabel(doc)
    entityState.currentItem = label
    job.currentItem = label

    try {
      const changed = await entityConfig.transform(doc, { force })
      if (changed) {
        await doc.save()
        entityState.updated += 1
        job.updated += 1
      }
    } catch (error) {
      entityState.failed += 1
      job.failed += 1
      pushJobLog(job, "error", `${entityConfig.label}: ${label} -> ${error.message}`)
    }

    entityState.processed += 1
    job.processed += 1
    recomputeJobPercentage(job)
  }

  entityState.status = "completed"
  entityState.currentItem = ""
}

const runJobInternal = async (scope, job, { force }) => {
  const plans = scope === "grab" ? buildGrabEntityPlans() : buildBlogEntityPlans()

  job.entities = []
  job.total = 0

  for (const plan of plans) {
    const total = await plan.model.countDocuments({})
    job.total += total
    job.entities.push({
      key: plan.key,
      label: plan.label,
      total,
      processed: 0,
      updated: 0,
      failed: 0,
      status: "pending",
      currentItem: "",
    })
  }

  recomputeJobPercentage(job)
  job.message = `Running ${scope === "grab" ? "Grab-Conversion" : "Blog Conversion"}...`

  for (const plan of plans) {
    await runEntityPlan(job, plan, { force })
  }

  job.status = "completed"
  job.currentEntity = ""
  job.currentItem = ""
  job.finishedAt = new Date().toISOString()
  job.percentage = 100
  job.message = "Conversion completed"
  pushJobLog(job, "success", `Completed: updated ${job.updated}/${job.total}, failed ${job.failed}`)
}

export const startArabicConversionJob = ({ scope, force = false, requestedBy = null } = {}) => {
  if (!scope || !jobStore[scope]) {
    throw new Error("Invalid conversion scope. Use 'blog' or 'grab'.")
  }

  const currentJob = jobStore[scope]
  if (currentJob.status === "running") {
    return {
      started: false,
      message: "Conversion is already running for this scope",
      job: toSerializable(currentJob),
    }
  }

  jobStore[scope] = {
    ...createIdleJob(scope),
    status: "running",
    message: "Preparing conversion...",
    startedAt: new Date().toISOString(),
    requestedBy,
  }

  const job = jobStore[scope]
  pushJobLog(job, "info", `Started ${scope} conversion`) 

  setImmediate(async () => {
    try {
      await runJobInternal(scope, job, { force })
    } catch (error) {
      job.status = "failed"
      job.finishedAt = new Date().toISOString()
      job.message = error.message || "Conversion failed"
      pushJobLog(job, "error", error.message || "Conversion failed")
    }
  })

  return {
    started: true,
    message: "Conversion started",
    job: toSerializable(job),
  }
}

export const getArabicConversionStatus = (scope) => {
  if (scope) {
    if (!jobStore[scope]) {
      throw new Error("Invalid conversion scope")
    }
    return { job: toSerializable(jobStore[scope]) }
  }

  return {
    jobs: {
      blog: toSerializable(jobStore.blog),
      grab: toSerializable(jobStore.grab),
    },
  }
}
