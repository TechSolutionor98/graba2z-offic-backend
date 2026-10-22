import express from "express"
import asyncHandler from "express-async-handler"
import fs from "fs"
import path from "path"
import multer from "multer"
import { fileURLToPath } from "url"

import { protect, admin } from "../middleware/authMiddleware.js"

/**
 * The image library behind the email builder.
 *
 * Images live on disk under uploads/media, in folders the admin creates. Every
 * path that arrives from the browser is rebuilt from a sanitized name rather
 * than trusted: a folder called "../../config" would otherwise let a listing
 * read, and a delete remove, anything the server can reach.
 */

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const ROOT = path.join(__dirname, "..", "uploads", "media")
if (!fs.existsSync(ROOT)) fs.mkdirSync(ROOT, { recursive: true })

const IMAGE_TYPES = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".avif"])
const MAX_BYTES = 5 * 1024 * 1024

/**
 * A folder name reduced to something that cannot escape the library: letters,
 * digits, dashes and spaces only, and never "." or "..".
 */
const safeFolder = (value) => {
  const name = String(value ?? "")
    .replace(/[^a-zA-Z0-9 _-]/g, "")
    .trim()
    .slice(0, 60)
  return name === "." || name === ".." ? "" : name
}

/** The absolute path of a folder inside the library, or null if it escapes. */
const folderPath = (folder) => {
  const name = safeFolder(folder)
  const full = name ? path.join(ROOT, name) : ROOT
  // Belt and braces: even after sanitising, confirm the result is still inside.
  return full === ROOT || full.startsWith(ROOT + path.sep) ? full : null
}

const publicUrl = (folder, file) =>
  `/uploads/media/${folder ? `${encodeURIComponent(folder)}/` : ""}${encodeURIComponent(file)}`

const router = express.Router()
const adminOnly = [protect, admin]

// ---------------------------------------------------------------------------

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const target = folderPath(req.query.folder || req.body.folder)
    if (!target) return cb(new Error("That folder name cannot be used."))
    if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true })
    cb(null, target)
  },
  filename: (req, file, cb) => {
    const extension = path.extname(file.originalname).toLowerCase()
    const base = path
      .basename(file.originalname, extension)
      .replace(/[^a-zA-Z0-9_-]/g, "-")
      .slice(0, 50)
    cb(null, `${base || "image"}-${Date.now()}${extension}`)
  },
})

const upload = multer({
  storage,
  limits: { fileSize: MAX_BYTES },
  fileFilter: (req, file, cb) => {
    const extension = path.extname(file.originalname).toLowerCase()
    if (!IMAGE_TYPES.has(extension)) return cb(new Error("Only image files can be uploaded."))
    cb(null, true)
  },
})

// @desc    Folders and images in one folder
// @route   GET /api/media?folder=
// @access  Private/Admin
router.get(
  "/",
  ...adminOnly,
  asyncHandler(async (req, res) => {
    const folder = safeFolder(req.query.folder)
    const target = folderPath(folder)
    if (!target || !fs.existsSync(target)) {
      return res.json({ folder: "", folders: [], files: [], usage: measureUsage() })
    }

    const entries = fs.readdirSync(target, { withFileTypes: true })

    // Folders are only listed at the top level: one level deep is enough to
    // organise a few hundred images, and nesting makes every path above longer
    // to validate for no practical gain.
    const folders = folder
      ? []
      : entries
          .filter((entry) => entry.isDirectory())
          .map((entry) => {
            const inside = fs.readdirSync(path.join(ROOT, entry.name))
            return { name: entry.name, count: inside.length }
          })
          .sort((a, b) => a.name.localeCompare(b.name))

    const files = entries
      .filter((entry) => entry.isFile() && IMAGE_TYPES.has(path.extname(entry.name).toLowerCase()))
      .map((entry) => {
        const stats = fs.statSync(path.join(target, entry.name))
        return {
          name: entry.name,
          url: publicUrl(folder, entry.name),
          size: stats.size,
          uploadedAt: stats.mtime,
        }
      })
      .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))

    res.json({ folder, folders, files, usage: measureUsage() })
  }),
)

/** Total bytes held, so the screen can show what is being used. */
function measureUsage() {
  let bytes = 0
  let files = 0
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else {
        bytes += fs.statSync(full).size
        files += 1
      }
    }
  }
  try {
    walk(ROOT)
  } catch {
    // An unreadable library reports zero rather than failing the listing.
  }
  return { bytes, files }
}

// @desc    Create a folder
// @route   POST /api/media/folder
// @access  Private/Admin
router.post(
  "/folder",
  ...adminOnly,
  asyncHandler(async (req, res) => {
    const name = safeFolder(req.body.name)
    if (!name) {
      res.status(400)
      throw new Error("Give the folder a name using letters, numbers, spaces or dashes.")
    }
    const target = folderPath(name)
    if (!target) {
      res.status(400)
      throw new Error("That folder name cannot be used.")
    }
    if (fs.existsSync(target)) {
      res.status(409)
      throw new Error("A folder with that name already exists.")
    }
    fs.mkdirSync(target, { recursive: true })
    res.status(201).json({ name })
  }),
)

// @desc    Upload images into a folder
// @route   POST /api/media/upload?folder=
// @access  Private/Admin
router.post("/upload", ...adminOnly, upload.array("images", 20), (req, res) => {
  const folder = safeFolder(req.query.folder || req.body.folder)
  const files = (req.files || []).map((file) => ({
    name: file.filename,
    url: publicUrl(folder, file.filename),
    size: file.size,
  }))
  if (files.length === 0) {
    return res.status(400).json({ message: "No image was uploaded." })
  }
  res.status(201).json({ files })
})

// @desc    Delete one image
// @route   DELETE /api/media/file
// @access  Private/Admin
router.delete(
  "/file",
  ...adminOnly,
  asyncHandler(async (req, res) => {
    const folder = safeFolder(req.query.folder)
    const name = path.basename(String(req.query.name || ""))
    const target = folderPath(folder)
    if (!target || !name) {
      res.status(400)
      throw new Error("That file cannot be removed.")
    }
    const full = path.join(target, name)
    if (!full.startsWith(ROOT + path.sep) || !fs.existsSync(full)) {
      res.status(404)
      throw new Error("That image is no longer there.")
    }
    fs.unlinkSync(full)
    res.json({ message: "Image deleted." })
  }),
)

// @desc    Delete a folder and everything in it
// @route   DELETE /api/media/folder
// @access  Private/Admin
router.delete(
  "/folder",
  ...adminOnly,
  asyncHandler(async (req, res) => {
    const name = safeFolder(req.query.name)
    const target = folderPath(name)
    if (!name || !target || target === ROOT) {
      res.status(400)
      throw new Error("That folder cannot be removed.")
    }
    if (!fs.existsSync(target)) {
      res.status(404)
      throw new Error("That folder is no longer there.")
    }
    // Deliberately not recursive by default: an email referencing an image whose
    // file has gone shows a broken box to every reader, so emptying a folder is
    // a decision the admin confirms rather than a side effect of tidying up.
    const remaining = fs.readdirSync(target)
    if (remaining.length > 0 && req.query.force !== "true") {
      res.status(409)
      throw new Error(`That folder still holds ${remaining.length} image(s).`)
    }
    fs.rmSync(target, { recursive: true, force: true })
    res.json({ message: "Folder deleted." })
  }),
)

export default router
