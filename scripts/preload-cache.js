import dotenv from "dotenv"
import warmServerCache from "../services/cacheWarmService.js"

dotenv.config()

const args = process.argv.slice(2)

const readArg = (name, fallbackValue) => {
  const directPrefix = `--${name}=`
  const directValue = args.find((arg) => arg.startsWith(directPrefix))
  if (directValue) {
    return directValue.slice(directPrefix.length)
  }

  const index = args.indexOf(`--${name}`)
  if (index !== -1 && args[index + 1]) {
    return args[index + 1]
  }

  return fallbackValue
}

const toNumber = (value, fallbackValue) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallbackValue
}

const toBoolean = (value, fallbackValue = false) => {
  if (typeof value === "boolean") return value
  if (typeof value !== "string") return fallbackValue
  return ["1", "true", "yes", "y"].includes(value.toLowerCase())
}

const defaultBaseUrl = `http://127.0.0.1:${process.env.PORT || 5000}`
const baseUrl = readArg("base-url", process.env.CACHE_WARM_BASE_URL || defaultBaseUrl)
const productListLimit = toNumber(
  readArg("product-limit", process.env.CACHE_WARM_PRODUCT_LIMIT || 120),
  120,
)
const productSampleSize = toNumber(
  readArg("sample-size", process.env.CACHE_WARM_SAMPLE_SIZE || 12),
  12,
)
const timeoutMs = toNumber(
  readArg("timeout-ms", process.env.CACHE_WARM_TIMEOUT_MS || 15000),
  15000,
)
const verifyHits = toBoolean(readArg("verify-hits", "false"), false)
const includeBuyerProtection = !toBoolean(readArg("skip-buyer-protection", "false"), false)
const warmAllProducts = toBoolean(
  readArg("all-products", process.env.CACHE_WARM_ALL_PRODUCTS === "false" ? "false" : "true"),
  true,
)
const includeCategoryFanout = !toBoolean(readArg("skip-category-fanout", "false"), false)
const includeProductsByCategory = !toBoolean(readArg("skip-products-by-category", "false"), false)
const includeSubcategoriesByCategory = !toBoolean(readArg("skip-subcategories-by-category", "false"), false)
const perCategoryProductLimit = toNumber(
  readArg("per-category-product-limit", process.env.CACHE_WARM_PER_CATEGORY_PRODUCT_LIMIT || 12),
  12,
)
const includeBannerPositions = !toBoolean(readArg("skip-banner-positions", "false"), false)
const bannerPositions = String(
  readArg("banner-positions", process.env.CACHE_WARM_BANNER_POSITIONS || "hero,promotional,mobile"),
)
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean)
const verifyBuyerProtection = toBoolean(readArg("verify-buyer-protection", "true"), true)

console.log("Starting cache warmup...")
console.log(`Base URL: ${baseUrl}`)
console.log(`Warm all products: ${warmAllProducts ? "yes" : "no"}`)
if (!warmAllProducts) {
  console.log(`Product list limit: ${productListLimit}`)
}
console.log(`Buyer protection sample size: ${productSampleSize}`)
console.log(`Category fanout: ${includeCategoryFanout ? "yes" : "no"}`)
if (includeCategoryFanout) {
  console.log(`Products by category: ${includeProductsByCategory ? "yes" : "no"}`)
  if (includeProductsByCategory) {
    console.log(`Per-category product limit: ${perCategoryProductLimit}`)
  }
  console.log(`Subcategories by category: ${includeSubcategoriesByCategory ? "yes" : "no"}`)
}
console.log(`Banner positions fanout: ${includeBannerPositions ? "yes" : "no"}`)
if (includeBannerPositions) {
  console.log(`Banner positions: ${bannerPositions.join(", ") || "none"}`)
}
console.log(`Request timeout: ${timeoutMs}ms`)
console.log(`Verify second pass hits: ${verifyHits ? "yes" : "no"}`)
if (verifyHits) {
  console.log(`Verify buyer protection requests: ${verifyBuyerProtection ? "yes" : "no"}`)
}
console.log(`Warm buyer protection: ${includeBuyerProtection ? "yes" : "no"}`)

const progressLabel = (phase) => {
  if (phase === "warm") return "Warm"
  if (phase === "fanout") return "Fanout"
  if (phase === "buyer-protection") return "BuyerProtection"
  if (phase === "verify") return "Verify"
  return "Step"
}

try {
  const result = await warmServerCache({
    baseUrl,
    warmAllProducts,
    productListLimit,
    productSampleSize,
    includeCategoryFanout,
    includeProductsByCategory,
    includeSubcategoriesByCategory,
    perCategoryProductLimit,
    includeBannerPositions,
    bannerPositions,
    timeoutMs,
    verifyHits,
    verifyBuyerProtection,
    includeBuyerProtection,
    onProgress: (event) => {
      if (event.step === "start") {
        console.log(`[${progressLabel(event.phase)} ${event.index}/${event.total}] ${event.label} -> ${event.path}`)
        return
      }

      const statusText = event.ok ? `OK ${event.status}` : `ERR ${event.status || "0"}`
      const cacheText = event.cache ? ` | X-Cache=${event.cache}` : ""
      const errorText = event.error ? ` | ${event.error}` : ""
      console.log(
        `[${progressLabel(event.phase)} ${event.index}/${event.total}] ${statusText} in ${event.durationMs}ms${cacheText}${errorText}`,
      )
    },
  })

  console.log("\nWarmup summary")
  console.log(`Total requests: ${result.summary.total}`)
  console.log(`Successful: ${result.summary.ok}`)
  console.log(`Failed: ${result.summary.failed}`)
  console.log(`Avg duration: ${result.summary.avgDurationMs}ms`)
  console.log(`X-Cache HITs: ${result.summary.cacheHits}`)
  console.log(`X-Cache MISSes: ${result.summary.cacheMisses}`)

  if (result.summary.failed > 0) {
    console.log("\nFailed requests")
    result.results
      .filter((item) => !item.ok)
      .forEach((item) => {
        console.log(`- ${item.label} -> ${item.status || "ERR"} (${item.error || "Unknown error"})`)
      })
  }

  if (verifyHits && result.verification) {
    console.log("\nVerification pass summary")
    console.log(`Total requests: ${result.verification.summary.total}`)
    console.log(`Successful: ${result.verification.summary.ok}`)
    console.log(`Failed: ${result.verification.summary.failed}`)
    console.log(`X-Cache HITs: ${result.verification.summary.cacheHits}`)
    console.log(`X-Cache MISSes: ${result.verification.summary.cacheMisses}`)
  }

  process.exit(result.summary.failed > 0 ? 1 : 0)
} catch (error) {
  console.error("Cache warmup failed:", error.message)
  process.exit(1)
}
