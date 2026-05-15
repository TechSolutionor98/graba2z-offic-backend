import express from "express"
import asyncHandler from "express-async-handler"
import { protect, admin } from "../middleware/authMiddleware.js"
import { checkPermission, logActivity } from "../middleware/permissionMiddleware.js"
import { requireSeoUnlock } from "../middleware/seoUnlockMiddleware.js"
import SeoPage from "../models/seoPageModel.js"
import Product from "../models/productModel.js"
import Category from "../models/categoryModel.js"
import SubCategory from "../models/subCategoryModel.js"
import Blog from "../models/blogModel.js"
import BlogCategory from "../models/blogCategoryModel.js"
import BlogBrand from "../models/blogBrandModel.js"
import OfferPage from "../models/offerPageModel.js"
import GamingZonePage from "../models/gamingZonePageModel.js"

const router = express.Router()

const STATIC_PAGE_DEFINITIONS = [
  {
    pageKey: "home",
    pageName: "Home",
    routePath: "/",
    defaultSeoTitle: "Buy Laptops, Mobiles & Electronics Online in UAE | Grabatoz",
    defaultSeoDescription:
      "Discover the best deals on laptops, desktops, mobiles, and gaming products in UAE. Grabatoz is your trusted electronics shop in Dubai.",
    defaultSeoKeywords: "",
  },
  {
    pageKey: "blogs",
    pageName: "Blogs List",
    routePath: "/blogs",
    defaultSeoTitle: "Blogs - GrabA2Z | Tech Insights, Reviews & Guides",
    defaultSeoDescription:
      "Explore our blog for the latest tech news, product reviews, buying guides, and expert insights on laptops, computers, and technology.",
    defaultSeoKeywords: "tech blog, laptop reviews, computer guides, technology news, product reviews, tech insights",
  },
  { pageKey: "about", pageName: "About", routePath: "/about", defaultSeoTitle: "", defaultSeoDescription: "", defaultSeoKeywords: "" },
  { pageKey: "contact", pageName: "Contact", routePath: "/contact", defaultSeoTitle: "", defaultSeoDescription: "", defaultSeoKeywords: "" },
  { pageKey: "privacy-policy", pageName: "Privacy Policy", routePath: "/privacy-policy", defaultSeoTitle: "", defaultSeoDescription: "", defaultSeoKeywords: "" },
  { pageKey: "privacy-policy-arabic", pageName: "Privacy Policy Arabic", routePath: "/privacy-policy-arabic", defaultSeoTitle: "", defaultSeoDescription: "", defaultSeoKeywords: "" },
  { pageKey: "disclaimer-policy", pageName: "Disclaimer Policy", routePath: "/disclaimer-policy", defaultSeoTitle: "", defaultSeoDescription: "", defaultSeoKeywords: "" },
  { pageKey: "terms-conditions", pageName: "Terms & Conditions", routePath: "/terms-conditions", defaultSeoTitle: "", defaultSeoDescription: "", defaultSeoKeywords: "" },
  { pageKey: "refund-return", pageName: "Refund & Return", routePath: "/refund-return", defaultSeoTitle: "", defaultSeoDescription: "", defaultSeoKeywords: "" },
  { pageKey: "cookies-policy", pageName: "Cookies Policy", routePath: "/cookies-policy", defaultSeoTitle: "", defaultSeoDescription: "", defaultSeoKeywords: "" },
  { pageKey: "bulk-purchase", pageName: "Bulk Purchase", routePath: "/bulk-purchase", defaultSeoTitle: "", defaultSeoDescription: "", defaultSeoKeywords: "" },
  { pageKey: "voucher-terms", pageName: "Voucher Terms", routePath: "/voucher-terms", defaultSeoTitle: "", defaultSeoDescription: "", defaultSeoKeywords: "" },
  { pageKey: "delivery-terms", pageName: "Delivery Terms", routePath: "/delivery-terms", defaultSeoTitle: "", defaultSeoDescription: "", defaultSeoKeywords: "" },
  { pageKey: "guest", pageName: "Guest", routePath: "/guest", defaultSeoTitle: "", defaultSeoDescription: "", defaultSeoKeywords: "" },
  { pageKey: "guest-order", pageName: "Guest Order", routePath: "/guest-order", defaultSeoTitle: "", defaultSeoDescription: "", defaultSeoKeywords: "" },
  { pageKey: "cart", pageName: "Cart", routePath: "/cart", defaultSeoTitle: "", defaultSeoDescription: "", defaultSeoKeywords: "" },
  { pageKey: "login", pageName: "Login", routePath: "/login", defaultSeoTitle: "", defaultSeoDescription: "", defaultSeoKeywords: "" },
  { pageKey: "register", pageName: "Register", routePath: "/register", defaultSeoTitle: "", defaultSeoDescription: "", defaultSeoKeywords: "" },
  { pageKey: "forgot-password", pageName: "Forgot Password", routePath: "/forgot-password", defaultSeoTitle: "", defaultSeoDescription: "", defaultSeoKeywords: "" },
  { pageKey: "reset-password", pageName: "Reset Password", routePath: "/reset-password", defaultSeoTitle: "", defaultSeoDescription: "", defaultSeoKeywords: "" },
  { pageKey: "green-friday-promotional", pageName: "Green Friday Promotional", routePath: "/green-friday-promotional", defaultSeoTitle: "", defaultSeoDescription: "", defaultSeoKeywords: "" },
  { pageKey: "backtoschool-acer-professional", pageName: "Back To School Acer Professional", routePath: "/backtoschool-acer-professional", defaultSeoTitle: "", defaultSeoDescription: "", defaultSeoKeywords: "" },
  { pageKey: "track-order", pageName: "Track Order", routePath: "/track-order", defaultSeoTitle: "", defaultSeoDescription: "", defaultSeoKeywords: "" },
]

const ROBOTS_OPTIONS = ["index, follow", "noindex, follow", "index, nofollow", "noindex, nofollow"]

const ENTITY_CONFIG = {
  product: {
    model: Product,
    label: "Product",
    nameField: "name",
    slugField: "slug",
    routePrefix: "/product/",
    supports: {
      title: true,
      description: true,
      keywords: true,
      canonicalUrl: true,
      robots: true,
      customSchema: true,
      ogTitle: true,
      ogDescription: true,
      ogImage: true,
      seoContent: false,
    },
    readSeo: (doc) => ({
      title: doc.seoTitle || "",
      description: doc.seoDescription || "",
      keywords: doc.seoKeywords || "",
      canonicalUrl: doc.seoCanonicalUrl || "",
      robots: doc.seoRobots || "index, follow",
      customSchema: doc.customSchema || "",
      ogTitle: doc.ogTitle || "",
      ogDescription: doc.ogDescription || "",
      ogImage: doc.ogImage || "",
      seoContent: "",
    }),
    writeSeo: (doc, payload) => {
      if (payload.title !== undefined) doc.seoTitle = payload.title
      if (payload.description !== undefined) doc.seoDescription = payload.description
      if (payload.keywords !== undefined) doc.seoKeywords = payload.keywords
      if (payload.canonicalUrl !== undefined) doc.seoCanonicalUrl = payload.canonicalUrl
      if (payload.robots !== undefined) doc.seoRobots = payload.robots
      if (payload.customSchema !== undefined) doc.customSchema = payload.customSchema
      if (payload.ogTitle !== undefined) doc.ogTitle = payload.ogTitle
      if (payload.ogDescription !== undefined) doc.ogDescription = payload.ogDescription
      if (payload.ogImage !== undefined) doc.ogImage = payload.ogImage
    },
  },
  category: {
    model: Category,
    label: "Category",
    nameField: "name",
    slugField: "slug",
    routePrefix: "/product-category/",
    supports: {
      title: true,
      description: true,
      keywords: false,
      canonicalUrl: false,
      robots: false,
      customSchema: true,
      ogTitle: false,
      ogDescription: false,
      ogImage: false,
      seoContent: true,
    },
    readSeo: (doc) => ({
      title: doc.metaTitle || "",
      description: doc.metaDescription || "",
      keywords: "",
      canonicalUrl: "",
      robots: "",
      customSchema: doc.customSchema || "",
      ogTitle: "",
      ogDescription: "",
      ogImage: "",
      seoContent: doc.seoContent || "",
    }),
    writeSeo: (doc, payload) => {
      if (payload.title !== undefined) doc.metaTitle = payload.title
      if (payload.description !== undefined) doc.metaDescription = payload.description
      if (payload.customSchema !== undefined) doc.customSchema = payload.customSchema
      if (payload.seoContent !== undefined) doc.seoContent = payload.seoContent
    },
  },
  subcategory: {
    model: SubCategory,
    label: "Sub Category",
    nameField: "name",
    slugField: "slug",
    routePrefix: "/product-category/",
    supports: {
      title: true,
      description: true,
      keywords: false,
      canonicalUrl: false,
      robots: false,
      customSchema: true,
      ogTitle: false,
      ogDescription: false,
      ogImage: false,
      seoContent: true,
    },
    readSeo: (doc) => ({
      title: doc.metaTitle || "",
      description: doc.metaDescription || "",
      keywords: "",
      canonicalUrl: "",
      robots: "",
      customSchema: doc.customSchema || "",
      ogTitle: "",
      ogDescription: "",
      ogImage: "",
      seoContent: doc.seoContent || "",
    }),
    writeSeo: (doc, payload) => {
      if (payload.title !== undefined) doc.metaTitle = payload.title
      if (payload.description !== undefined) doc.metaDescription = payload.description
      if (payload.customSchema !== undefined) doc.customSchema = payload.customSchema
      if (payload.seoContent !== undefined) doc.seoContent = payload.seoContent
    },
  },
  blog: {
    model: Blog,
    label: "Blog Post",
    nameField: "title",
    slugField: "slug",
    routePrefix: "/blogs/",
    supports: {
      title: true,
      description: true,
      keywords: false,
      canonicalUrl: false,
      robots: false,
      customSchema: true,
      ogTitle: false,
      ogDescription: false,
      ogImage: false,
      seoContent: false,
    },
    readSeo: (doc) => ({
      title: doc.metaTitle || "",
      description: doc.metaDescription || "",
      keywords: "",
      canonicalUrl: "",
      robots: "",
      customSchema: doc.schema || "",
      ogTitle: "",
      ogDescription: "",
      ogImage: "",
      seoContent: "",
    }),
    writeSeo: (doc, payload) => {
      if (payload.title !== undefined) doc.metaTitle = payload.title
      if (payload.description !== undefined) doc.metaDescription = payload.description
      if (payload.customSchema !== undefined) doc.schema = payload.customSchema
    },
  },
  "blog-category": {
    model: BlogCategory,
    label: "Blog Category",
    nameField: "name",
    slugField: "slug",
    routePrefix: "",
    supports: {
      title: true,
      description: true,
      keywords: false,
      canonicalUrl: false,
      robots: false,
      customSchema: false,
      ogTitle: false,
      ogDescription: false,
      ogImage: false,
      seoContent: false,
    },
    readSeo: (doc) => ({
      title: doc.metaTitle || "",
      description: doc.metaDescription || "",
      keywords: "",
      canonicalUrl: "",
      robots: "",
      customSchema: "",
      ogTitle: "",
      ogDescription: "",
      ogImage: "",
      seoContent: "",
    }),
    writeSeo: (doc, payload) => {
      if (payload.title !== undefined) doc.metaTitle = payload.title
      if (payload.description !== undefined) doc.metaDescription = payload.description
    },
  },
  "blog-brand": {
    model: BlogBrand,
    label: "Blog Brand",
    nameField: "name",
    slugField: "slug",
    routePrefix: "",
    supports: {
      title: true,
      description: true,
      keywords: false,
      canonicalUrl: false,
      robots: false,
      customSchema: false,
      ogTitle: false,
      ogDescription: false,
      ogImage: false,
      seoContent: false,
    },
    readSeo: (doc) => ({
      title: doc.metaTitle || "",
      description: doc.metaDescription || "",
      keywords: "",
      canonicalUrl: "",
      robots: "",
      customSchema: "",
      ogTitle: "",
      ogDescription: "",
      ogImage: "",
      seoContent: "",
    }),
    writeSeo: (doc, payload) => {
      if (payload.title !== undefined) doc.metaTitle = payload.title
      if (payload.description !== undefined) doc.metaDescription = payload.description
    },
  },
  "offer-page": {
    model: OfferPage,
    label: "Offer Page",
    nameField: "name",
    slugField: "slug",
    routePrefix: "/offers/",
    supports: {
      title: true,
      description: true,
      keywords: true,
      canonicalUrl: true,
      robots: true,
      customSchema: true,
      ogTitle: true,
      ogDescription: true,
      ogImage: true,
      seoContent: false,
    },
    readSeo: (doc) => ({
      title: doc.seoTitle || doc.metaTitle || "",
      description: doc.seoDescription || doc.metaDescription || "",
      keywords: doc.seoKeywords || "",
      canonicalUrl: doc.seoCanonicalUrl || doc.canonicalUrl || "",
      robots: doc.seoRobots || "index, follow",
      customSchema: doc.customSchema || "",
      ogTitle: doc.ogTitle || "",
      ogDescription: doc.ogDescription || "",
      ogImage: doc.ogImage || "",
      seoContent: "",
    }),
    writeSeo: (doc, payload) => {
      if (payload.title !== undefined) {
        doc.seoTitle = payload.title
        doc.metaTitle = payload.title
      }
      if (payload.description !== undefined) {
        doc.seoDescription = payload.description
        doc.metaDescription = payload.description
      }
      if (payload.keywords !== undefined) doc.seoKeywords = payload.keywords
      if (payload.canonicalUrl !== undefined) {
        doc.seoCanonicalUrl = payload.canonicalUrl
        doc.canonicalUrl = payload.canonicalUrl
      }
      if (payload.robots !== undefined) doc.seoRobots = payload.robots
      if (payload.customSchema !== undefined) doc.customSchema = payload.customSchema
      if (payload.ogTitle !== undefined) doc.ogTitle = payload.ogTitle
      if (payload.ogDescription !== undefined) doc.ogDescription = payload.ogDescription
      if (payload.ogImage !== undefined) doc.ogImage = payload.ogImage
    },
  },
  "gaming-zone-page": {
    model: GamingZonePage,
    label: "Gaming Zone Page",
    nameField: "name",
    slugField: "slug",
    routePrefix: "/gaming-zone/",
    supports: {
      title: true,
      description: true,
      keywords: true,
      canonicalUrl: true,
      robots: true,
      customSchema: true,
      ogTitle: true,
      ogDescription: true,
      ogImage: true,
      seoContent: false,
    },
    readSeo: (doc) => ({
      title: doc.seoTitle || doc.metaTitle || "",
      description: doc.seoDescription || doc.metaDescription || "",
      keywords: doc.seoKeywords || "",
      canonicalUrl: doc.seoCanonicalUrl || doc.canonicalUrl || "",
      robots: doc.seoRobots || "index, follow",
      customSchema: doc.customSchema || "",
      ogTitle: doc.ogTitle || "",
      ogDescription: doc.ogDescription || "",
      ogImage: doc.ogImage || "",
      seoContent: "",
    }),
    writeSeo: (doc, payload) => {
      if (payload.title !== undefined) {
        doc.seoTitle = payload.title
        doc.metaTitle = payload.title
      }
      if (payload.description !== undefined) {
        doc.seoDescription = payload.description
        doc.metaDescription = payload.description
      }
      if (payload.keywords !== undefined) doc.seoKeywords = payload.keywords
      if (payload.canonicalUrl !== undefined) {
        doc.seoCanonicalUrl = payload.canonicalUrl
        doc.canonicalUrl = payload.canonicalUrl
      }
      if (payload.robots !== undefined) doc.seoRobots = payload.robots
      if (payload.customSchema !== undefined) doc.customSchema = payload.customSchema
      if (payload.ogTitle !== undefined) doc.ogTitle = payload.ogTitle
      if (payload.ogDescription !== undefined) doc.ogDescription = payload.ogDescription
      if (payload.ogImage !== undefined) doc.ogImage = payload.ogImage
    },
  },
}

const sanitizeText = (value = "") => String(value || "").trim()

const normalizePath = (path = "") => {
  const normalized = String(path || "").trim().toLowerCase().split("?")[0].split("#")[0]
  if (!normalized) return "/"

  const withLeadingSlash = normalized.startsWith("/") ? normalized : `/${normalized}`
  const withoutLangPrefix = withLeadingSlash.replace(/^\/(ae-en|ae-ar)(?=\/|$)/i, "") || "/"
  const withoutTrailingSlash = withoutLangPrefix.length > 1 ? withoutLangPrefix.replace(/\/+$/, "") : withoutLangPrefix
  return withoutTrailingSlash || "/"
}

const getStaticDefaultsByKey = () => {
  return STATIC_PAGE_DEFINITIONS.reduce((acc, page) => {
    acc[page.pageKey] = page
    return acc
  }, {})
}

const ensureStaticPages = async () => {
  const existing = await SeoPage.find({}, { pageKey: 1 }).lean()
  const existingKeys = new Set(existing.map((item) => item.pageKey))

  const inserts = STATIC_PAGE_DEFINITIONS.filter((page) => !existingKeys.has(page.pageKey)).map((page) => ({
    pageKey: page.pageKey,
    pageName: page.pageName,
    routePath: page.routePath,
    seoTitle: page.defaultSeoTitle || "",
    seoDescription: page.defaultSeoDescription || "",
    seoKeywords: page.defaultSeoKeywords || "",
    seoCanonicalUrl: page.routePath,
  }))

  if (inserts.length > 0) {
    await SeoPage.insertMany(inserts)
  }
}

const buildDynamicPageRecord = (entityType, config, doc) => {
  const name = sanitizeText(doc[config.nameField] || doc.name || doc.title || doc.blogName || "Untitled")
  const slug = sanitizeText(doc[config.slugField] || "")
  const seo = config.readSeo(doc)

  return {
    id: String(doc._id),
    entityType,
    entityLabel: config.label,
    pageName: name,
    slug,
    routePath: slug && config.routePrefix ? `${config.routePrefix}${slug}` : "",
    supports: config.supports,
    seo,
    updatedAt: doc.updatedAt,
  }
}

const normalizeSeoPayload = (body = {}) => {
  const payload = {
    title: body.title !== undefined ? sanitizeText(body.title) : undefined,
    description: body.description !== undefined ? sanitizeText(body.description) : undefined,
    keywords: body.keywords !== undefined ? sanitizeText(body.keywords) : undefined,
    canonicalUrl: body.canonicalUrl !== undefined ? sanitizeText(body.canonicalUrl) : undefined,
    robots: body.robots !== undefined ? sanitizeText(body.robots) : undefined,
    customSchema: body.customSchema !== undefined ? String(body.customSchema || "") : undefined,
    ogTitle: body.ogTitle !== undefined ? sanitizeText(body.ogTitle) : undefined,
    ogDescription: body.ogDescription !== undefined ? sanitizeText(body.ogDescription) : undefined,
    ogImage: body.ogImage !== undefined ? sanitizeText(body.ogImage) : undefined,
    seoContent: body.seoContent !== undefined ? String(body.seoContent || "") : undefined,
  }

  if (payload.robots !== undefined && payload.robots && !ROBOTS_OPTIONS.includes(payload.robots)) {
    throw new Error("Invalid robots value")
  }

  return payload
}

// @desc    Public static SEO lookup by page key
// @route   GET /api/seo-pages/public/:pageKey
// @access  Public
router.get(
  "/public/:pageKey",
  asyncHandler(async (req, res) => {
    await ensureStaticPages()

    const pageKey = sanitizeText(req.params.pageKey).toLowerCase()
    const defaults = getStaticDefaultsByKey()

    if (!defaults[pageKey]) {
      res.status(404)
      throw new Error("Static page key not found")
    }

    const record = await SeoPage.findOne({ pageKey }).lean()
    const fallback = defaults[pageKey]

    res.json({
      pageKey,
      pageName: record?.pageName || fallback.pageName,
      routePath: record?.routePath || fallback.routePath,
      seo: {
        title: record?.seoTitle || fallback.defaultSeoTitle || "",
        description: record?.seoDescription || fallback.defaultSeoDescription || "",
        keywords: record?.seoKeywords || fallback.defaultSeoKeywords || "",
        canonicalUrl: record?.seoCanonicalUrl || fallback.routePath,
        robots: record?.seoRobots || "index, follow",
        customSchema: record?.customSchema || "",
        ogTitle: record?.ogTitle || "",
        ogDescription: record?.ogDescription || "",
        ogImage: record?.ogImage || "",
      },
    })
  }),
)

// @desc    Public static SEO lookup by URL path
// @route   GET /api/seo-pages/public-by-path?path=/about
// @access  Public
router.get(
  "/public-by-path",
  asyncHandler(async (req, res) => {
    await ensureStaticPages()

    const normalizedPath = normalizePath(req.query.path)

    const defaultMatch = STATIC_PAGE_DEFINITIONS.find((page) => page.routePath === normalizedPath)
    if (!defaultMatch) {
      return res.json({
        found: false,
      })
    }

    const record = await SeoPage.findOne({ pageKey: defaultMatch.pageKey }).lean()

    return res.json({
      found: true,
      pageKey: defaultMatch.pageKey,
      pageName: record?.pageName || defaultMatch.pageName,
      routePath: defaultMatch.routePath,
      seo: {
        title: record?.seoTitle || defaultMatch.defaultSeoTitle || "",
        description: record?.seoDescription || defaultMatch.defaultSeoDescription || "",
        keywords: record?.seoKeywords || defaultMatch.defaultSeoKeywords || "",
        canonicalUrl: record?.seoCanonicalUrl || defaultMatch.routePath,
        robots: record?.seoRobots || "index, follow",
        customSchema: record?.customSchema || "",
        ogTitle: record?.ogTitle || "",
        ogDescription: record?.ogDescription || "",
        ogImage: record?.ogImage || "",
      },
    })
  }),
)

// @desc    List static page SEO records
// @route   GET /api/seo-pages/static
// @access  Private/Admin (seoSettings permission)
router.get(
  "/static",
  protect,
  admin,
  checkPermission("seoSettings"),
  asyncHandler(async (req, res) => {
    await ensureStaticPages()

    const records = await SeoPage.find({}).sort({ pageName: 1 }).lean()
    const byKey = records.reduce((acc, item) => {
      acc[item.pageKey] = item
      return acc
    }, {})

    const data = STATIC_PAGE_DEFINITIONS.map((page) => {
      const record = byKey[page.pageKey]
      return {
        pageKey: page.pageKey,
        pageName: record?.pageName || page.pageName,
        routePath: record?.routePath || page.routePath,
        supports: {
          title: true,
          description: true,
          keywords: true,
          canonicalUrl: true,
          robots: true,
          customSchema: true,
          ogTitle: true,
          ogDescription: true,
          ogImage: true,
          seoContent: false,
        },
        seo: {
          title: record?.seoTitle || page.defaultSeoTitle || "",
          description: record?.seoDescription || page.defaultSeoDescription || "",
          keywords: record?.seoKeywords || page.defaultSeoKeywords || "",
          canonicalUrl: record?.seoCanonicalUrl || page.routePath,
          robots: record?.seoRobots || "index, follow",
          customSchema: record?.customSchema || "",
          ogTitle: record?.ogTitle || "",
          ogDescription: record?.ogDescription || "",
          ogImage: record?.ogImage || "",
        },
        updatedAt: record?.updatedAt || null,
      }
    })

    res.json({
      staticPages: data,
    })
  }),
)

// @desc    Update static page SEO
// @route   PUT /api/seo-pages/static/:pageKey
// @access  Private/Admin (seoSettings permission)
router.put(
  "/static/:pageKey",
  protect,
  admin,
  checkPermission("seoSettings"),
  requireSeoUnlock,
  asyncHandler(async (req, res) => {
    await ensureStaticPages()

    const pageKey = sanitizeText(req.params.pageKey).toLowerCase()
    const defaults = getStaticDefaultsByKey()

    if (!defaults[pageKey]) {
      res.status(404)
      throw new Error("Static page key not found")
    }

    const payload = normalizeSeoPayload(req.body)

    let page = await SeoPage.findOne({ pageKey })
    if (!page) {
      page = new SeoPage({
        pageKey,
        pageName: defaults[pageKey].pageName,
        routePath: defaults[pageKey].routePath,
      })
    }

    if (payload.title !== undefined) page.seoTitle = payload.title
    if (payload.description !== undefined) page.seoDescription = payload.description
    if (payload.keywords !== undefined) page.seoKeywords = payload.keywords
    if (payload.canonicalUrl !== undefined) page.seoCanonicalUrl = payload.canonicalUrl
    if (payload.robots !== undefined) page.seoRobots = payload.robots || "index, follow"
    if (payload.customSchema !== undefined) page.customSchema = payload.customSchema
    if (payload.ogTitle !== undefined) page.ogTitle = payload.ogTitle
    if (payload.ogDescription !== undefined) page.ogDescription = payload.ogDescription
    if (payload.ogImage !== undefined) page.ogImage = payload.ogImage
    page.updatedBy = req.user._id

    const updated = await page.save()

    await logActivity({
      user: req.user,
      action: "UPDATE",
      module: "SEO_SETTINGS",
      description: `Updated static SEO settings: ${updated.pageName}`,
      targetId: updated._id,
      targetName: updated.pageKey,
      newData: req.body,
      req,
    })

    res.json({
      pageKey: updated.pageKey,
      pageName: updated.pageName,
      routePath: updated.routePath,
      seo: {
        title: updated.seoTitle || "",
        description: updated.seoDescription || "",
        keywords: updated.seoKeywords || "",
        canonicalUrl: updated.seoCanonicalUrl || "",
        robots: updated.seoRobots || "index, follow",
        customSchema: updated.customSchema || "",
        ogTitle: updated.ogTitle || "",
        ogDescription: updated.ogDescription || "",
        ogImage: updated.ogImage || "",
      },
      updatedAt: updated.updatedAt,
    })
  }),
)

// @desc    List dynamic SEO records
// @route   GET /api/seo-pages/dynamic
// @access  Private/Admin (seoSettings permission)
router.get(
  "/dynamic",
  protect,
  admin,
  checkPermission("seoSettings"),
  asyncHandler(async (req, res) => {
    const entityType = sanitizeText(req.query.entityType || "all").toLowerCase()
    const search = sanitizeText(req.query.search || "")
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1)
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100)

    const entityKeys = entityType === "all" ? Object.keys(ENTITY_CONFIG) : [entityType]
    const validEntityKeys = entityKeys.filter((key) => ENTITY_CONFIG[key])

    if (validEntityKeys.length === 0) {
      res.status(400)
      throw new Error("Invalid entityType")
    }

    if (validEntityKeys.length > 1) {
      const counts = await Promise.all(
        validEntityKeys.map(async (key) => {
          const config = ENTITY_CONFIG[key]
          const query = search
            ? {
                $or: [
                  { [config.nameField]: { $regex: search, $options: "i" } },
                  { [config.slugField]: { $regex: search, $options: "i" } },
                ],
              }
            : {}
          const total = await config.model.countDocuments(query)
          return { entityType: key, label: config.label, total }
        }),
      )

      return res.json({
        items: [],
        pagination: {
          page: 1,
          limit,
          total: 0,
          totalPages: 0,
        },
        availableEntities: counts,
        note: "Select a specific entity type to list records.",
      })
    }

    const selectedType = validEntityKeys[0]
    const config = ENTITY_CONFIG[selectedType]
    const query = search
      ? {
          $or: [
            { [config.nameField]: { $regex: search, $options: "i" } },
            { [config.slugField]: { $regex: search, $options: "i" } },
          ],
        }
      : {}

    const total = await config.model.countDocuments(query)
    const totalPages = total > 0 ? Math.ceil(total / limit) : 0
    const currentPage = totalPages > 0 ? Math.min(page, totalPages) : 1
    const skip = (currentPage - 1) * limit

    const docs = await config.model
      .find(query)
      .select(`${config.nameField} ${config.slugField} metaTitle metaDescription seoTitle seoDescription seoKeywords seoCanonicalUrl canonicalUrl seoRobots customSchema schema ogTitle ogDescription ogImage seoContent updatedAt`)
      .sort({ updatedAt: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean()

    const items = docs.map((doc) => buildDynamicPageRecord(selectedType, config, doc))

    const availableEntities = await Promise.all(
      Object.keys(ENTITY_CONFIG).map(async (key) => {
        const typeConfig = ENTITY_CONFIG[key]
        const typeQuery = search
          ? {
              $or: [
                { [typeConfig.nameField]: { $regex: search, $options: "i" } },
                { [typeConfig.slugField]: { $regex: search, $options: "i" } },
              ],
            }
          : {}
        const count = await typeConfig.model.countDocuments(typeQuery)
        return {
          entityType: key,
          label: typeConfig.label,
          total: count,
        }
      }),
    )

    res.json({
      items,
      pagination: {
        page: currentPage,
        limit,
        total,
        totalPages,
      },
      availableEntities,
    })
  }),
)

// @desc    Update dynamic SEO record
// @route   PUT /api/seo-pages/dynamic/:entityType/:id
// @access  Private/Admin (seoSettings permission)
router.put(
  "/dynamic/:entityType/:id",
  protect,
  admin,
  checkPermission("seoSettings"),
  requireSeoUnlock,
  asyncHandler(async (req, res) => {
    const entityType = sanitizeText(req.params.entityType).toLowerCase()
    const id = sanitizeText(req.params.id)
    const config = ENTITY_CONFIG[entityType]

    if (!config) {
      res.status(400)
      throw new Error("Invalid entity type")
    }

    const payload = normalizeSeoPayload(req.body)

    const doc = await config.model.findById(id)
    if (!doc) {
      res.status(404)
      throw new Error("SEO target not found")
    }

    config.writeSeo(doc, payload)
    const updated = await doc.save()

    await logActivity({
      user: req.user,
      action: "UPDATE",
      module: "SEO_SETTINGS",
      description: `Updated SEO for ${config.label}: ${updated[config.nameField] || updated.name || updated.title || updated._id}`,
      targetId: updated._id,
      targetName: updated[config.nameField] || updated.name || updated.title || "",
      newData: req.body,
      req,
    })

    const response = buildDynamicPageRecord(entityType, config, updated)
    res.json(response)
  }),
)

export default router
