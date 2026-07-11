import axios from "axios"
import IndexNowLog from "../models/indexNowLogModel.js"
import Product from "../models/productModel.js"
import Category from "../models/categoryModel.js"
import SubCategory from "../models/subCategoryModel.js"
import Brand from "../models/brandModel.js"
import Blog from "../models/blogModel.js"
import BlogCategory from "../models/blogCategoryModel.js"
import OfferPage from "../models/offerPageModel.js"
import GamingZonePage from "../models/gamingZonePageModel.js"
import config from "../config/config.js"

const getApiKey = () => config.INDEXNOW_KEY

const getClientUrl = () => {
  const url = process.env.CLIENT_URL || "https://www.grabatoz.ae"
  return url.replace(/\/+$/, "")
}

const getHostName = () => {
  const url = getClientUrl()
  return url.replace(/^https?:\/\//i, "")
}

const localePrefixes = ["/ae-en", "/ae-ar"]

const normalizePath = (path = "") => {
  if (!path) return ""
  return path.startsWith("/") ? path : `/${path}`
}

const withLocales = (path = "") => {
  const normalizedPath = normalizePath(path)
  return localePrefixes.map((prefix) => `${prefix}${normalizedPath}`)
}

const createRouteSlug = (value = "") => {
  return value
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
}

const toId = (value) => {
  if (!value) return null
  if (typeof value === "object" && value._id) return String(value._id)
  return String(value)
}

const buildSubcategoryPath = (subCategory, categorySlugById, subById) => {
  const categoryId = toId(subCategory.category)
  const categorySlug = categorySlugById.get(categoryId)
  if (!categorySlug) return null

  const segments = []
  const seen = new Set()
  let current = subCategory

  while (current) {
    const currentId = toId(current._id)
    if (!currentId || seen.has(currentId)) return null
    seen.add(currentId)

    const routeSlug = createRouteSlug(current.name) || createRouteSlug(current.slug)
    if (!routeSlug) return null
    segments.unshift(routeSlug)

    const parentId = toId(current.parentSubCategory)
    if (!parentId) break
    current = subById.get(parentId)
  }

  if (segments.length === 0) return null
  return `/product-category/${categorySlug}/${segments.join("/")}`
}

export const submitUrls = async (urls, triggerType, userId = null) => {
  if (!urls || (Array.isArray(urls) && urls.length === 0)) {
    return { success: false, message: "No URLs provided" }
  }

  const urlList = Array.isArray(urls) ? urls : [urls]
  const apiKey = getApiKey()
  const clientUrl = getClientUrl()
  const host = getHostName()
  const keyLocation = `${clientUrl}/${apiKey}.txt`

  // Format URLs to ensure they start with the clientUrl prefix and don't duplicate it
  const formattedUrls = urlList.map(u => {
    let urlStr = u.trim()
    if (!urlStr.startsWith("http://") && !urlStr.startsWith("https://")) {
      urlStr = `${clientUrl}${urlStr.startsWith("/") ? "" : "/"}${urlStr}`
    }
    return urlStr
  })

  // IndexNow allows bulk submit, up to 10,000 URLs. We will chunk them in groups of 10,000 just in case.
  const chunkSize = 10000
  const chunks = []
  for (let i = 0; i < formattedUrls.length; i += chunkSize) {
    chunks.push(formattedUrls.slice(i, i + chunkSize))
  }

  let finalStatus = 200
  let finalMessage = "OK"
  let successCount = 0

  for (const chunk of chunks) {
    try {
      const payload = {
        host,
        key: apiKey,
        keyLocation,
        urlList: chunk,
      }

      console.log(`[IndexNow] Submitting ${chunk.length} URLs to api.indexnow.org...`)
      const response = await axios.post("https://api.indexnow.org/IndexNow", payload, {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
        },
        timeout: 15000,
      })

      finalStatus = response.status
      finalMessage = response.statusText || "OK"
      successCount += chunk.length

      // Save submission log
      await IndexNowLog.create({
        urls: chunk,
        responseStatus: response.status,
        responseMessage: response.statusText || "OK",
        triggerType,
        initiatedBy: userId,
      })
    } catch (error) {
      const responseStatus = error.response?.status || 500
      const responseMessage = error.response?.data?.message || error.message || "Unknown Error"

      console.error(`[IndexNow] Error submitting batch: ${responseStatus} - ${responseMessage}`)
      
      finalStatus = responseStatus
      finalMessage = responseMessage

      // Save failure log
      await IndexNowLog.create({
        urls: chunk,
        responseStatus,
        responseMessage,
        triggerType,
        initiatedBy: userId,
      })
    }
  }

  return {
    success: successCount > 0,
    status: finalStatus,
    message: finalMessage,
    submittedCount: successCount,
  }
}

export const submitProduct = async (product, action, userId = null) => {
  try {
    if (!product || !product.slug) return
    // Only submit if product is active or is being deleted
    if (action !== "delete" && product.isActive === false) return
    const paths = withLocales(`/product/${product.slug}`)
    await submitUrls(paths, "auto_product", userId)
  } catch (err) {
    console.error(`[IndexNow] Auto-submit product failed:`, err)
  }
}

export const submitBlog = async (blog, action, userId = null) => {
  try {
    if (!blog || !blog.slug || blog.status !== "published") return
    const paths = withLocales(`/blogs/${blog.slug}`)
    await submitUrls(paths, "auto_blog", userId)
  } catch (err) {
    console.error(`[IndexNow] Auto-submit blog failed:`, err)
  }
}

export const submitCategory = async (category, action, userId = null) => {
  try {
    if (!category) return
    const slug = category.slug || category.name
    if (!slug) return
    const paths = withLocales(`/product-category/${createRouteSlug(slug)}`)
    await submitUrls(paths, "auto_category", userId)
  } catch (err) {
    console.error(`[IndexNow] Auto-submit category failed:`, err)
  }
}

export const submitSubCategory = async (subCategory, categorySlug, action, userId = null) => {
  try {
    if (!subCategory || !categorySlug) return
    const slug = subCategory.slug || subCategory.name
    if (!slug) return
    const paths = withLocales(`/product-category/${createRouteSlug(categorySlug)}/${createRouteSlug(slug)}`)
    await submitUrls(paths, "auto_subcategory", userId)
  } catch (err) {
    console.error(`[IndexNow] Auto-submit subcategory failed:`, err)
  }
}

export const submitBrand = async (brand, action, userId = null) => {
  try {
    if (!brand) return
    const token = brand.slug || brand.name
    if (!token) return
    const paths = withLocales(`/shop?brand=${encodeURIComponent(token)}`)
    await submitUrls(paths, "auto_brand", userId)
  } catch (err) {
    console.error(`[IndexNow] Auto-submit brand failed:`, err)
  }
}

export const submitSitemap = async (userId = null) => {
  try {
    console.log("[IndexNow] Building URLs from database...")
    const [products, categories, subCategories, brands, blogs, blogCategories, offerPages, gamingZonePages] =
      await Promise.all([
        Product.find({ isActive: true, isDeleted: { $ne: true } }).select("slug").lean(),
        Category.find({ isActive: true, isDeleted: { $ne: true } }).select("_id slug name").lean(),
        SubCategory.find({ isActive: true, isDeleted: { $ne: true } })
          .select("_id slug name category parentSubCategory")
          .lean(),
        Brand.find({ isActive: true, isDeleted: { $ne: true } }).select("slug name").lean(),
        Blog.find({ status: "published" }).select("slug").lean(),
        BlogCategory.find({ isActive: true }).select("_id slug").lean(),
        OfferPage.find({ isActive: true }).select("slug").lean(),
        GamingZonePage.find({ isActive: true }).select("slug").lean(),
      ])

    const emitted = new Set()
    const addEntry = (path, includeLocales = true) => {
      const localizedPaths = includeLocales ? withLocales(path) : [normalizePath(path)]
      for (const localizedPath of localizedPaths) {
        emitted.add(localizedPath)
      }
    }

    // Static pages
    const staticPages = [
      "",
      "/shop",
      "/product-category",
      "/about",
      "/contact",
      "/cart",
      "/track-order",
      "/blogs",
      "/privacy-policy",
      "/terms-conditions",
      "/delivery-terms",
      "/disclaimer-policy",
      "/cookies-policy",
      "/refund-return",
      "/voucher-terms",
      "/bulk-purchase",
      "/green-friday-promotional",
      "/backtoschool-acer-professional",
    ]

    for (const page of staticPages) {
      addEntry(page)
    }

    // Products
    for (const product of products) {
      if (product.slug) {
        addEntry(`/product/${product.slug}`)
      }
    }

    // Categories
    const categorySlugById = new Map(
      categories
        .map((category) => [toId(category._id), createRouteSlug(category.slug) || createRouteSlug(category.name)])
        .filter(([, slug]) => Boolean(slug)),
    )
    const subById = new Map(subCategories.map((s) => [toId(s._id), s]))

    for (const category of categories) {
      const categoryPathSlug = createRouteSlug(category.slug) || createRouteSlug(category.name)
      if (categoryPathSlug) {
        addEntry(`/product-category/${categoryPathSlug}`)
      }
    }

    // Subcategories
    for (const subCategory of subCategories) {
      const subPath = buildSubcategoryPath(subCategory, categorySlugById, subById)
      if (subPath) {
        addEntry(subPath)
      }
    }

    // Brands
    for (const brand of brands) {
      const brandToken = brand.slug || brand.name
      if (brandToken) {
        addEntry(`/shop?brand=${encodeURIComponent(brandToken)}`)
      }
    }

    // Blogs
    for (const blog of blogs) {
      if (blog.slug) {
        addEntry(`/blogs/${blog.slug}`)
      }
    }

    // Blog Categories
    for (const blogCategory of blogCategories) {
      if (blogCategory._id) {
        addEntry(`/blogs?category=${encodeURIComponent(String(blogCategory._id))}`)
      }
    }

    // Offers
    for (const offerPage of offerPages) {
      if (offerPage.slug) {
        addEntry(`/offers/${offerPage.slug}`)
      }
    }

    // Gaming Zones
    for (const gamingZonePage of gamingZonePages) {
      if (gamingZonePage.slug) {
        addEntry(`/gaming-zone/${gamingZonePage.slug}`)
      }
    }

    const allUrls = Array.from(emitted)
    console.log(`[IndexNow] Sitemap compiled. Found ${allUrls.length} total localized URLs.`)

    return await submitUrls(allUrls, "manual_sitemap", userId)
  } catch (err) {
    console.error("[IndexNow] Sitemap bulk submission failed:", err)
    return { success: false, message: err.message || "Failed to submit sitemap" }
  }
}
