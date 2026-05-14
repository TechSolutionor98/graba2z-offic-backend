import fs from "fs/promises"
import path from "path"
import dotenv from "dotenv"
import mongoose from "mongoose"

import connectDB from "../config/db.js"
import StaticPageTranslation from "../models/staticPageTranslationModel.js"
import {
  STATIC_PAGE_TRANSLATION_SOURCES,
  resolveSourceFilePath,
} from "../constants/staticPageTranslationSources.js"

dotenv.config()

const DEFAULT_BATCH_SIZE = Number(process.env.STATIC_PAGE_TRANSLATION_BATCH_SIZE || 12)
const MAX_RETRIES = Number(process.env.STATIC_PAGE_TRANSLATION_MAX_RETRIES || 2)

const normalizeText = (value) =>
  String(value || "")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim()

const isMeaningfulText = (value) => {
  if (!value) return false
  if (value.length < 2) return false
  if (!/[A-Za-z]/.test(value)) return false
  if (/^(https?:\/\/|www\.)/i.test(value)) return false
  if (/^[{}()[\]|\\/+*=<>~`$^:_-]+$/.test(value)) return false
  if (/^(className|onClick|useState|return|const|function)$/i.test(value)) return false
  return true
}

const extractTextSegments = (sourceCode) => {
  const found = new Set()

  const textNodeRegex = />([^<>{}]+)</g
  let match
  while ((match = textNodeRegex.exec(sourceCode)) !== null) {
    const normalized = normalizeText(match[1])
    if (isMeaningfulText(normalized)) {
      found.add(normalized)
    }
  }

  const attrRegex = /(?:placeholder|title|alt|aria-label)=\{?['"`]([^'"`]+)['"`]\}?/g
  while ((match = attrRegex.exec(sourceCode)) !== null) {
    const normalized = normalizeText(match[1])
    if (isMeaningfulText(normalized)) {
      found.add(normalized)
    }
  }

  return Array.from(found)
}

const parseArgs = () => {
  const args = process.argv.slice(2)
  const options = {
    onlyMissing: args.includes("--only-missing"),
    force: args.includes("--force"),
    page: null,
    batchSize: DEFAULT_BATCH_SIZE,
  }

  args.forEach((arg) => {
    if (arg.startsWith("--page=")) {
      options.page = arg.split("=")[1]?.trim() || null
    }
    if (arg.startsWith("--batch-size=")) {
      const value = Number(arg.split("=")[1])
      if (Number.isFinite(value) && value > 0) {
        options.batchSize = value
      }
    }
  })

  return options
}

const loadBingTranslator = async () => {
  const bingModule = await import("bing-translate-api")
  const translate = bingModule?.translate || bingModule?.default?.translate

  if (!translate) {
    throw new Error("bing-translate-api export `translate` was not found")
  }

  return translate
}

const translateWithRetry = async (translate, sourceText) => {
  let lastError = null

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const result = await translate(sourceText, null, "ar")
      const translated = normalizeText(result?.translation || "")
      if (translated) return translated
    } catch (error) {
      lastError = error
    }
  }

  if (lastError) {
    console.error(`⚠️ Translation failed for: ${sourceText.slice(0, 120)} | ${lastError.message}`)
  }
  return ""
}

const chunkArray = (items, chunkSize) => {
  const chunks = []
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize))
  }
  return chunks
}

const run = async () => {
  const options = parseArgs()
  const sources = options.page
    ? STATIC_PAGE_TRANSLATION_SOURCES.filter((source) => source.pageKey === options.page)
    : STATIC_PAGE_TRANSLATION_SOURCES

  if (!sources.length) {
    throw new Error(`No source page found for --page=${options.page}`)
  }

  console.log("🌱 Seeding static-page Arabic translations")
  console.log(`   onlyMissing=${options.onlyMissing} force=${options.force} page=${options.page || "all"}`)

  await connectDB()
  const translate = await loadBingTranslator()

  const extractedByPage = []

  for (const source of sources) {
    const absolutePath = resolveSourceFilePath(source.sourceFile)
    const sourceCode = await fs.readFile(absolutePath, "utf8")
    const extracted = extractTextSegments(sourceCode)

    extractedByPage.push({
      ...source,
      absolutePath,
      extracted,
    })

    console.log(`📄 ${source.pageKey} -> extracted ${extracted.length} strings from ${path.relative(process.cwd(), absolutePath)}`)
  }

  let totalExtracted = 0
  let totalSkippedExisting = 0
  let totalWritten = 0

  for (const page of extractedByPage) {
    totalExtracted += page.extracted.length

    let existingNormalized = new Set()
    if (options.onlyMissing && !options.force && page.extracted.length > 0) {
      const sourceTexts = page.extracted.map((text) => normalizeText(text))
      const existing = await StaticPageTranslation.find({
        pageKey: page.pageKey,
        sourceText: { $in: sourceTexts },
      })
        .select("sourceText -_id")
        .lean()

      existingNormalized = new Set(existing.map((entry) => normalizeText(entry.sourceText)))
    }

    const toTranslate = page.extracted.filter((text) => {
      if (options.force) return true
      if (!options.onlyMissing) return true
      return !existingNormalized.has(normalizeText(text))
    })

    totalSkippedExisting += page.extracted.length - toTranslate.length

    if (!toTranslate.length) {
      console.log(`⏭️  ${page.pageKey}: nothing to translate`)
      continue
    }

    const operations = []
    const chunks = chunkArray(toTranslate, options.batchSize)

    for (const chunk of chunks) {
      const translatedChunk = await Promise.all(
        chunk.map(async (sourceText) => {
          const translatedText = await translateWithRetry(translate, sourceText)
          return {
            sourceText,
            translatedText: translatedText || sourceText,
          }
        }),
      )

      translatedChunk.forEach((entry) => {
        const normalizedSourceText = normalizeText(entry.sourceText)
        operations.push({
          updateOne: {
            filter: {
              pageKey: page.pageKey,
              sourceText: entry.sourceText,
            },
            update: {
              $set: {
                routePath: page.routePath,
                sourceText: entry.sourceText,
                normalizedSourceText,
                translatedText: entry.translatedText,
                provider: "bing",
                lastTranslatedAt: new Date(),
              },
            },
            upsert: true,
          },
        })
      })
    }

    if (operations.length > 0) {
      const result = await StaticPageTranslation.bulkWrite(operations, { ordered: false })
      const wrote =
        (result?.upsertedCount || 0) +
        (result?.modifiedCount || 0) +
        (result?.matchedCount || 0)

      totalWritten += operations.length
      console.log(`✅ ${page.pageKey}: processed ${operations.length} translations (bulk affected=${wrote})`)
    }
  }

  console.log("\n🎉 Static-page Arabic seed complete")
  console.log(`   Total extracted strings: ${totalExtracted}`)
  console.log(`   Skipped existing (only-missing): ${totalSkippedExisting}`)
  console.log(`   Total write operations: ${totalWritten}`)
}

run()
  .then(async () => {
    await mongoose.disconnect()
    process.exit(0)
  })
  .catch(async (error) => {
    console.error("❌ Seed failed:", error)
    await mongoose.disconnect()
    process.exit(1)
  })
