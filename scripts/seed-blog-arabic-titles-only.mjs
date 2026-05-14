import 'dotenv/config'
import mongoose from 'mongoose'
import connectDB, { connectBlogDB } from '../config/db.js'
import Blog from '../models/blogModel.js'
import { translate } from 'bing-translate-api'

const isAr = (s) => /[\u0600-\u06FF]/.test(String(s || ''))

const tx = async (t) => {
  const src = String(t || '').trim()
  if (!src || isAr(src)) return src
  try {
    const r = await Promise.race([
      translate(src, null, 'ar'),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000)),
    ])
    const out = String(r?.translation || src).trim()
    return out || src
  } catch {
    return src
  }
}

await connectDB()
await connectBlogDB()

const blogs = await Blog.find({}).select('blogName title postedBy').lean()
let updated = 0
let arabicTitles = 0
for (const b of blogs) {
  const blogNameAr = await tx(b.blogName)
  const titleAr = await tx(b.title)
  const postedByAr = await tx(b.postedBy)
  if (isAr(titleAr)) arabicTitles += 1
  await Blog.updateOne(
    { _id: b._id },
    { $set: { blogNameAr, titleAr, postedByAr } },
  )
  updated += 1
}

console.log('✅ title-only Arabic pass done')
console.log(`blogs updated: ${updated}/${blogs.length}`)
console.log(`titles containing Arabic: ${arabicTitles}/${blogs.length}`)

await mongoose.disconnect()
