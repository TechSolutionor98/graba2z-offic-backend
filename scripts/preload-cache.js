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

console.log("Starting cache warmup...")
console.log(`Base URL: ${baseUrl}`)
console.log(`Product list limit: ${productListLimit}`)
console.log(`Buyer protection sample size: ${productSampleSize}`)
console.log(`Request timeout: ${timeoutMs}ms`)
console.log(`Verify second pass hits: ${verifyHits ? "yes" : "no"}`)

try {
  const result = await warmServerCache({
    baseUrl,
    productListLimit,
    productSampleSize,
    timeoutMs,
    verifyHits,
    includeBuyerProtection: true,
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
