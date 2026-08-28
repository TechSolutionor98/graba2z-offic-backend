import express from "express"
import asyncHandler from "express-async-handler"
import Country from "../models/countryModel.js"
import { protect, admin } from "../middleware/authMiddleware.js"
import { logActivity } from "../middleware/permissionMiddleware.js"
import { updateLiveExchangeRates } from "../services/exchangeRateService.js"

const router = express.Router()

// Initial seed data for GCC countries
const INITIAL_GCC_COUNTRIES = [
  {
    code: "AE",
    name: "UAE",
    nameAr: "الإمارات",
    currencyCode: "AED",
    currencySymbol: "AED",
    currencySymbolAr: "د.إ",
    flagSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 300"><rect width="600" height="100" fill="#00732f"/><rect y="100" width="600" height="100" fill="#fff"/><rect y="200" width="600" height="100" fill="#000"/><rect width="150" height="300" fill="#ff0000"/></svg>`,
    isActive: true,
    isDefault: true,
    useManualRate: false,
    manualExchangeRate: 1.0,
    liveExchangeRate: 1.0,
    sortOrder: 1,
  },
  {
    code: "SA",
    name: "Saudi Arabia",
    nameAr: "السعودية",
    currencyCode: "SAR",
    currencySymbol: "SAR",
    currencySymbolAr: "ر.س",
    flagSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400"><rect width="600" height="400" fill="#006c35"/><text x="300" y="210" font-family="sans-serif" font-weight="bold" font-size="55" fill="#fff" text-anchor="middle">السعودية</text><path d="M180 260 h240 v15 h-240 z" fill="#fff"/></svg>`,
    isActive: true,
    isDefault: false,
    useManualRate: false,
    manualExchangeRate: 1.021,
    liveExchangeRate: 1.021,
    sortOrder: 2,
  },
  {
    code: "QA",
    name: "Qatar",
    nameAr: "قطر",
    currencyCode: "QAR",
    currencySymbol: "QAR",
    currencySymbolAr: "ر.ق",
    flagSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 300"><rect width="600" height="300" fill="#8d1b3d"/><polygon points="0,0 150,0 200,16 150,33 200,50 150,66 200,83 150,100 200,116 150,133 200,150 150,166 200,183 150,200 200,216 150,233 200,250 150,266 200,283 150,300 0,300" fill="#ffffff"/></svg>`,
    isActive: true,
    isDefault: false,
    useManualRate: false,
    manualExchangeRate: 0.991,
    liveExchangeRate: 0.991,
    sortOrder: 3,
  },
  {
    code: "OM",
    name: "Oman",
    nameAr: "عمان",
    currencyCode: "OMR",
    currencySymbol: "OMR",
    currencySymbolAr: "ر.ع",
    flagSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 300"><rect width="600" height="100" fill="#ffffff"/><rect y="100" width="600" height="100" fill="#db161b"/><rect y="200" width="600" height="100" fill="#008000"/><rect width="150" height="300" fill="#db161b"/></svg>`,
    isActive: true,
    isDefault: false,
    useManualRate: false,
    manualExchangeRate: 0.1048,
    liveExchangeRate: 0.1048,
    sortOrder: 4,
  },
  {
    code: "BH",
    name: "Bahrain",
    nameAr: "البحرين",
    currencyCode: "BHD",
    currencySymbol: "BHD",
    currencySymbolAr: "د.ب",
    flagSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 360"><rect width="600" height="360" fill="#ce1126"/><polygon points="0,0 150,0 210,36 150,72 210,108 150,144 210,180 150,216 210,252 150,288 210,324 150,360 0,360" fill="#ffffff"/></svg>`,
    isActive: true,
    isDefault: false,
    useManualRate: false,
    manualExchangeRate: 0.1026,
    liveExchangeRate: 0.1026,
    sortOrder: 5,
  },
  {
    code: "KW",
    name: "Kuwait",
    nameAr: "الكويت",
    currencyCode: "KWD",
    currencySymbol: "KWD",
    currencySymbolAr: "د.ك",
    flagSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 300"><rect width="600" height="100" fill="#007a3d"/><rect y="100" width="600" height="100" fill="#ffffff"/><rect y="200" width="600" height="100" fill="#ce1126"/><polygon points="0,0 150,100 150,200 0,300" fill="#000000"/></svg>`,
    isActive: true,
    isDefault: false,
    useManualRate: false,
    manualExchangeRate: 0.0835,
    liveExchangeRate: 0.0835,
    sortOrder: 6,
  },
]

/**
 * Seed default GCC countries if not existing
 */
export const seedDefaultCountries = async () => {
  try {
    const count = await Country.countDocuments()
    if (count === 0) {
      await Country.insertMany(INITIAL_GCC_COUNTRIES)
      console.log("✅ Seeded initial GCC countries successfully.")
    }
  } catch (err) {
    console.error("Error seeding default GCC countries:", err.message)
  }
}

// @desc    Public list of active countries & effective conversion rates
// @route   GET /api/countries/public
// @access  Public
router.get(
  "/public",
  asyncHandler(async (req, res) => {
    await seedDefaultCountries()
    const countries = await Country.find({ isActive: true }).sort({ sortOrder: 1, name: 1 })

    const result = countries.map((c) => {
      const obj = c.toObject()
      return {
        id: obj._id,
        code: obj.code,
        name: obj.name,
        nameAr: obj.nameAr,
        currencyCode: obj.currencyCode,
        currencySymbol: obj.currencySymbol,
        currencySymbolAr: obj.currencySymbolAr,
        flagSvg: obj.flagSvg,
        isDefault: obj.isDefault,
        effectiveRate: obj.effectiveRate,
        sortOrder: obj.sortOrder,
      }
    })

    res.set("Cache-Control", "public, max-age=300, s-maxage=600")
    res.json(result)
  }),
)

// @desc    Admin list of all countries with rate settings
// @route   GET /api/countries/admin
// @access  Private/Admin
router.get(
  "/admin",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    await seedDefaultCountries()
    const countries = await Country.find({}).sort({ sortOrder: 1, name: 1 })
    res.json(countries)
  }),
)

// @desc    Admin update country configuration & manual exchange rate
// @route   PUT /api/countries/admin/:id
// @access  Private/Admin
router.put(
  "/admin/:id",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const country = await Country.findById(req.params.id)
    if (!country) {
      res.status(404)
      throw new Error("Country not found")
    }

    const { isActive, useManualRate, manualExchangeRate, currencySymbol, currencySymbolAr, sortOrder, flagSvg } = req.body

    if (isActive !== undefined) country.isActive = Boolean(isActive)
    if (useManualRate !== undefined) country.useManualRate = Boolean(useManualRate)
    if (manualExchangeRate !== undefined) country.manualExchangeRate = Number(manualExchangeRate) || 0
    if (currencySymbol !== undefined) country.currencySymbol = String(currencySymbol).trim()
    if (currencySymbolAr !== undefined) country.currencySymbolAr = String(currencySymbolAr).trim()
    if (sortOrder !== undefined) country.sortOrder = Number(sortOrder) || 0
    if (flagSvg !== undefined) country.flagSvg = String(flagSvg)

    country.updatedBy = req.user._id

    const updated = await country.save()

    await logActivity({
      user: req.user,
      action: "UPDATE",
      module: "COUNTRY_MANAGEMENT",
      description: `Updated country settings for ${updated.name} (${updated.code})`,
      targetId: updated._id,
      targetName: updated.name,
      newData: req.body,
      req,
    })

    res.json(updated)
  }),
)

// @desc    Admin manually trigger live exchange rate refresh from Google/Exchange API
// @route   POST /api/countries/admin/refresh-rates
// @access  Private/Admin
router.post(
  "/admin/refresh-rates",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const result = await updateLiveExchangeRates()
    if (!result.success) {
      res.status(500)
      throw new Error(result.error || "Failed to update exchange rates")
    }

    const countries = await Country.find({}).sort({ sortOrder: 1, name: 1 })
    res.json({
      message: "Exchange rates updated successfully",
      countries,
    })
  }),
)

// @desc    Admin add a new country
// @route   POST /api/countries/admin
// @access  Private/Admin
router.post(
  "/admin",
  protect,
  admin,
  asyncHandler(async (req, res) => {
    const {
      code,
      name,
      nameAr,
      currencyCode,
      currencySymbol,
      currencySymbolAr,
      flagSvg,
      useManualRate,
      manualExchangeRate,
      liveExchangeRate,
      sortOrder,
    } = req.body

    if (!code || !name) {
      res.status(400)
      throw new Error("Country code and name are required")
    }

    const uppercaseCode = String(code).trim().toUpperCase()

    const existing = await Country.findOne({ code: uppercaseCode })
    if (existing) {
      res.status(400)
      throw new Error(`Country with code '${uppercaseCode}' already exists`)
    }

    const defaultFlag = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 300"><rect width="600" height="300" fill="#00732f"/><text x="300" y="170" font-family="sans-serif" font-weight="bold" font-size="65" fill="#ffffff" text-anchor="middle">${uppercaseCode}</text></svg>`

    const country = new Country({
      code: uppercaseCode,
      name: String(name).trim(),
      nameAr: nameAr ? String(nameAr).trim() : String(name).trim(),
      currencyCode: currencyCode ? String(currencyCode).trim().toUpperCase() : uppercaseCode,
      currencySymbol: currencySymbol ? String(currencySymbol).trim() : uppercaseCode,
      currencySymbolAr: currencySymbolAr ? String(currencySymbolAr).trim() : (nameAr || uppercaseCode),
      flagSvg: flagSvg || defaultFlag,
      isActive: true,
      useManualRate: Boolean(useManualRate),
      manualExchangeRate: Number(manualExchangeRate) || 1.0,
      liveExchangeRate: Number(liveExchangeRate) || Number(manualExchangeRate) || 1.0,
      sortOrder: Number(sortOrder) || (await Country.countDocuments()) + 1,
      createdBy: req.user._id,
    })

    const created = await country.save()

    await logActivity({
      user: req.user,
      action: "CREATE",
      module: "COUNTRY_MANAGEMENT",
      description: `Added new country ${created.name} (${created.code})`,
      targetId: created._id,
      targetName: created.name,
      newData: req.body,
      req,
    })

    res.status(201).json(created)
  }),
)

export default router
