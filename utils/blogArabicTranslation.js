import { translateEnToAr } from "./translateWithFallback.js"

const FALSE_LIKE = new Set(["false", "0", "off", "no"])

const isArabicText = (value) => /[\u0600-\u06FF]/.test(value) && !/[A-Za-z]/.test(value)

const normalizeText = (value) =>
  String(value || "")
    .replace(/\u00A0/g, " ")
    .trim()

export const shouldAutoTranslateArabic = (value) => {
  if (value === undefined || value === null) return true
  if (typeof value === "boolean") return value
  const normalized = String(value).trim().toLowerCase()
  return !FALSE_LIKE.has(normalized)
}

export const toTagArray = (value) => {
  if (Array.isArray(value)) return value.map((tag) => String(tag).trim()).filter(Boolean)
  if (typeof value === "string") {
    return value
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean)
  }
  return []
}

export const translatePlainTextToArabic = async (value) => {
  const source = normalizeText(value)
  if (!source) return ""
  if (isArabicText(source)) return source

  try {
    const translated = await translateEnToAr(source)
    return translated || source
  } catch {
    return source
  }
}

export const translateHtmlToArabicPreservingTags = async (html) => {
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

  await Promise.all(
    uniqueChunks.map(async (chunk) => {
      const translated = await translatePlainTextToArabic(chunk)
      translatedMap.set(chunk, translated || chunk)
    }),
  )

  const rebuilt = tokens.map((token) => {
    if (!token || token.startsWith("<")) return token

    const match = token.match(/^(\s*)([\s\S]*?)(\s*)$/)
    if (!match) return token

    const leading = match[1] || ""
    const coreRaw = match[2] || ""
    const trailing = match[3] || ""
    const core = coreRaw.trim()
    if (!core) return token

    const translatedCore = translatedMap.get(core) || core
    return `${leading}${translatedCore}${trailing}`
  })

  return rebuilt.join("")
}

export const translateTagListToArabic = async (tags) => {
  const list = toTagArray(tags)
  if (!list.length) return []
  const translated = await Promise.all(list.map((tag) => translatePlainTextToArabic(tag)))
  return translated.map((tag, index) => tag || list[index])
}

export const buildBlogArabicPayload = async (payload) => {
  const tags = toTagArray(payload.tags)
  return {
    blogNameAr: await translatePlainTextToArabic(payload.blogName),
    titleAr: await translatePlainTextToArabic(payload.title),
    postedByAr: await translatePlainTextToArabic(payload.postedBy),
    descriptionAr: await translateHtmlToArabicPreservingTags(payload.description),
    metaTitleAr: await translatePlainTextToArabic(payload.metaTitle),
    metaDescriptionAr: await translatePlainTextToArabic(payload.metaDescription),
    tagsAr: await translateTagListToArabic(tags),
  }
}

export const buildBlogCategoryArabicPayload = async (payload) => ({
  nameAr: await translatePlainTextToArabic(payload.name),
  descriptionAr: await translatePlainTextToArabic(payload.description),
  metaTitleAr: await translatePlainTextToArabic(payload.metaTitle),
  metaDescriptionAr: await translatePlainTextToArabic(payload.metaDescription),
})

export const buildBlogTopicArabicPayload = async (payload) => ({
  nameAr: await translatePlainTextToArabic(payload.name),
  descriptionAr: await translatePlainTextToArabic(payload.description),
})

export const buildBlogBrandArabicPayload = async (payload) => ({
  nameAr: await translatePlainTextToArabic(payload.name),
  descriptionAr: await translatePlainTextToArabic(payload.description),
  metaTitleAr: await translatePlainTextToArabic(payload.metaTitle),
  metaDescriptionAr: await translatePlainTextToArabic(payload.metaDescription),
})
