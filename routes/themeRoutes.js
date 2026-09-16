import express from "express"
import asyncHandler from "express-async-handler"
import Theme from "../models/themeModel.js"
import { BUILT_IN_THEME_PAGES } from "../constants/themePages.js"
import { protect, admin } from "../middleware/authMiddleware.js"
import { logActivity } from "../middleware/permissionMiddleware.js"
import { cacheMiddleware, invalidateCache } from "../middleware/cacheMiddleware.js"

const router = express.Router()

// Sections that are stored as nested sub-documents. A PUT may send any subset
// of them, and any subset of the keys inside them, so they are merged field by
// field rather than replaced wholesale -- replacing would silently reset every
// key the client happened not to send.
const NESTED_SECTIONS = ["brandScale", "logos", "header", "navbar", "footer", "buttons", "page"]

// Never writable from a request body.
const PROTECTED_FIELDS = new Set(["_id", "updatedBy", "createdAt", "updatedAt", "__v"])

/**
 * Add any built-in page rows the document is missing.
 *
 * The built-in list lives in code and can grow between deploys; existing rows
 * are never touched, so an admin's saved colours survive. Returns true when the
 * document changed and needs saving.
 */
const syncBuiltInPages = (theme) => {
  const existing = new Set((theme.pages || []).map((p) => p.key))
  let changed = false

  BUILT_IN_THEME_PAGES.forEach((page, index) => {
    if (existing.has(page.key)) return
    theme.pages.push({
      key: page.key,
      label: page.label,
      pattern: page.pattern,
      enabled: false,
      builtIn: true,
      sortOrder: index,
    })
    changed = true
  })

  return changed
}

const getOrCreateTheme = async () => {
  let theme = await Theme.findOne({})

  if (!theme) {
    theme = new Theme({})
    syncBuiltInPages(theme)
    await theme.save()
    return theme
  }

  if (syncBuiltInPages(theme)) {
    await theme.save()
  }

  return theme
}

const mergeSection = (target, incoming) => {
  if (!incoming || typeof incoming !== "object") return
  Object.keys(incoming).forEach((key) => {
    if (incoming[key] === undefined) return
    target[key] = incoming[key]
  })
}

// @desc    Get the site theme
// @route   GET /api/theme
// @access  Public
router.get(
  "/",
  cacheMiddleware("settings", { ttl: 120, keyPrefix: "theme" }),
  asyncHandler(async (req, res) => {
    const theme = await getOrCreateTheme()
    res.json(theme)
  }),
)

// @desc    Update the site theme
// @route   PUT /api/theme
// @access  Private/Admin
router.put(
  "/",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const theme = await getOrCreateTheme()
    const body = req.body || {}

    Object.keys(body).forEach((key) => {
      if (PROTECTED_FIELDS.has(key)) return

      if (NESTED_SECTIONS.includes(key)) {
        mergeSection(theme[key], body[key])
        return
      }

      if (key === "pages") {
        if (!Array.isArray(body.pages)) return
        // Built-in rows may be reordered, relabelled and recoloured, but not
        // removed -- their key is what the admin form renders against.
        const incomingByKey = new Map(body.pages.filter((p) => p && p.key).map((p) => [p.key, p]))
        const kept = []

        BUILT_IN_THEME_PAGES.forEach((builtIn, index) => {
          const incoming = incomingByKey.get(builtIn.key)
          const current = theme.pages.find((p) => p.key === builtIn.key)
          kept.push({
            ...(current ? current.toObject() : {}),
            ...(incoming || {}),
            key: builtIn.key,
            builtIn: true,
            label: (incoming?.label || current?.label || builtIn.label).trim(),
            pattern: (incoming?.pattern || current?.pattern || builtIn.pattern).trim(),
            sortOrder: index,
          })
          incomingByKey.delete(builtIn.key)
        })

        // Whatever is left is a custom rule the admin added.
        let order = BUILT_IN_THEME_PAGES.length
        incomingByKey.forEach((incoming) => {
          if (!incoming.pattern || !String(incoming.pattern).trim()) return
          kept.push({ ...incoming, builtIn: false, sortOrder: order++ })
        })

        theme.pages = kept
        return
      }

      theme[key] = body[key]
    })

    theme.updatedBy = req.user._id
    const saved = await theme.save()

    await logActivity({
      user: req.user,
      action: "UPDATE",
      module: "SETTINGS",
      description: "Updated site theme (appearance)",
      targetId: saved._id,
      targetName: "Site Theme",
      req,
    })

    await invalidateCache("settings")

    res.json(saved)
  }),
)

// @desc    Reset the theme back to the shipped defaults
// @route   POST /api/theme/reset
// @access  Private/Admin
router.post(
  "/reset",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    await Theme.deleteMany({})

    const theme = new Theme({ updatedBy: req.user._id })
    syncBuiltInPages(theme)
    await theme.save()

    await logActivity({
      user: req.user,
      action: "UPDATE",
      module: "SETTINGS",
      description: "Reset site theme to defaults",
      targetId: theme._id,
      targetName: "Site Theme",
      req,
    })

    await invalidateCache("settings")

    res.json(theme)
  }),
)

export default router
