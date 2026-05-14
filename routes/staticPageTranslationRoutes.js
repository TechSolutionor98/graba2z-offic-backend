import express from "express"
import asyncHandler from "express-async-handler"
import StaticPageTranslation from "../models/staticPageTranslationModel.js"
import { normalizeStaticPagePath, resolveStaticPageByPath } from "../constants/staticPages.js"

const router = express.Router()

router.get(
  "/by-path",
  asyncHandler(async (req, res) => {
    const requestedPath = typeof req.query.path === "string" ? req.query.path : "/"
    const normalizedPath = normalizeStaticPagePath(requestedPath)
    const page = resolveStaticPageByPath(normalizedPath)

    if (!page) {
      return res.json({
        success: true,
        pageKey: null,
        routePath: normalizedPath,
        translations: [],
        translationMap: {},
      })
    }

    const docs = await StaticPageTranslation.find({ pageKey: page.pageKey })
      .select("sourceText translatedText normalizedSourceText -_id")
      .lean()

    const translationMap = {}
    docs.forEach((doc) => {
      if (doc?.sourceText && doc?.translatedText) {
        translationMap[doc.sourceText] = doc.translatedText
      }
      if (doc?.normalizedSourceText && doc?.translatedText) {
        translationMap[doc.normalizedSourceText] = doc.translatedText
      }
    })

    res.json({
      success: true,
      pageKey: page.pageKey,
      routePath: page.routePath,
      translations: docs,
      translationMap,
    })
  }),
)

export default router
