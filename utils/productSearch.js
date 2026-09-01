// One implementation of buyer-facing product search, shared by the website, the mobile
// API and the app API. It used to be copy-pasted into all three route files, which meant
// a fix in one left the other two wrong.

// Escape regex special characters so a shopper typing "AL15-53P (2024)" cannot break the query.
export function escapeRegex(string) {
  return String(string).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// Fields a buyer-facing search is allowed to match.
//
// `description` is deliberately absent. Product descriptions are long spec blobs -- a
// laptop description reads "... 15.6" FHD, Backlit English Keyboard ..." -- so matching
// them turned a search for "Keyboard" into a page of laptops. Descriptions are only used
// to widen a search that would otherwise return nothing, and admin screens opt back in
// explicitly.
export const SEARCH_NAME_FIELDS = ["name", "nameAr", "slug"]
export const SEARCH_CODE_FIELDS = ["sku", "barcode"]
export const SEARCH_TAG_FIELDS = ["tags", "tagsAr"]
export const SEARCH_CATEGORY_FIELDS = [
  "parentCategoryName",
  "categoryName",
  "subCategory2Name",
  "subCategory3Name",
  "subCategory4Name",
]
export const SEARCH_DESCRIPTION_FIELDS = [
  "description",
  "descriptionAr",
  "shortDescription",
  "shortDescriptionAr",
]

// A term has to start a word rather than land anywhere inside one, so "keyboard" matches
// "Gaming Keyboard", "Keyboards" and the slug "rgb-keyboard-black", but not an unrelated
// run of characters that merely contains those letters.
export const wordBoundaryPattern = (safeTerm) => `(^|[^a-zA-Z0-9])${safeTerm}`

// Split a raw query into terms, unwrapping a pasted product URL into its slug.
export function parseSearchTerms(search) {
  if (!search || typeof search !== "string" || !search.trim()) return { queryStr: "", terms: [] }
  let queryStr = search.trim()

  if (queryStr.includes("/product/")) {
    try {
      const cleanUrl = queryStr.split("?")[0].replace(/\/$/, "")
      const parts = cleanUrl.split("/product/")
      if (parts.length > 1) queryStr = decodeURIComponent(parts[1])
    } catch (e) {
      // fall back to the original search string
    }
  }

  return { queryStr, terms: queryStr.split(/\s+/).filter(Boolean) }
}

// Build search conditions for multi-word queries.
// Every word must match at least one field (AND across words, OR across fields).
export async function buildSearchConditions(search, BrandModel, { includeDescription = false } = {}) {
  const { terms } = parseSearchTerms(search)
  if (terms.length === 0) return null

  // For each word, check if it matches a brand name; only add the brand filter for that specific word.
  const wordConditions = await Promise.all(
    terms.map(async (term) => {
      const safeTerm = escapeRegex(term)
      const wordRegex = new RegExp(wordBoundaryPattern(safeTerm), "i")
      // SKUs and barcodes are short identifiers, so a plain substring match is safe there
      // and lets a buyer paste a fragment of a code.
      const codeRegex = new RegExp(safeTerm, "i")

      const orClause = []
      for (const field of [...SEARCH_NAME_FIELDS, ...SEARCH_TAG_FIELDS, ...SEARCH_CATEGORY_FIELDS]) {
        orClause.push({ [field]: wordRegex })
      }
      for (const field of SEARCH_CODE_FIELDS) {
        orClause.push({ [field]: codeRegex })
      }
      if (includeDescription) {
        for (const field of SEARCH_DESCRIPTION_FIELDS) {
          orClause.push({ [field]: wordRegex })
        }
      }

      const matchingBrands = await BrandModel.find({ name: wordRegex }).select("_id").lean()
      if (matchingBrands.length > 0) {
        orClause.push({ brand: { $in: matchingBrands.map((b) => b._id) } })
      }
      return { $or: orClause }
    }),
  )

  return wordConditions.length > 1 ? { $and: wordConditions } : wordConditions[0]
}

// Relevance weights, added together per product.
//
// The catalog stores spec text inside the product *name* -- a laptop is listed as
// "Aspire Lite AL15-53P-56PA, Intel Core 5-120u, ... English Keyboard, ..." -- so a name
// hit alone is a weak signal. What a product *is* lives in its category and tags, which
// is why those outweigh a mention buried in a name. That is the whole reason a search for
// "Keyboard" used to return a page of laptops.
//
// Mirrored client-side by scoreSearchRelevance in client/src/services/productCache.js;
// the two must stay in step.
export const RELEVANCE_WEIGHTS = {
  namePrefix: 120,
  nameAllTerms: 35,
  namePerTerm: 5,
  categoryAllTerms: 80,
  categoryAnyTerm: 35,
  codeAllTerms: 90,
  tagAllTerms: 30,
  tagAnyTerm: 12,
}

// Aggregation expression scoring a document against the search query, for sortBy=relevance.
// Returns null when there is nothing to score.
export function buildRelevanceExpression(search) {
  const { queryStr, terms: rawTerms } = parseSearchTerms(search)
  if (rawTerms.length === 0) return null
  const terms = rawTerms.map(escapeRegex)

  const textField = (path) => ({ $ifNull: [`$${path}`, ""] })
  // Flatten an array field (tags) into one string so a single $regexMatch can scan it.
  const arrayField = (path) => ({
    $reduce: {
      input: { $ifNull: [`$${path}`, []] },
      initialValue: "",
      in: { $concat: ["$$value", " ", { $toString: "$$this" }] },
    },
  })
  const joined = (inputs) => ({ $concat: inputs.flatMap((input) => [input, " "]) })

  const nameInput = joined(SEARCH_NAME_FIELDS.map(textField))
  const codeInput = joined(SEARCH_CODE_FIELDS.map(textField))
  const tagInput = joined(SEARCH_TAG_FIELDS.map(arrayField))
  const categoryInput = joined(SEARCH_CATEGORY_FIELDS.map(textField))

  const hits = (input, patternFor) =>
    terms.map((term) => ({ $regexMatch: { input, regex: patternFor(term), options: "i" } }))
  const everyTerm = (input, patternFor) => ({ $and: hits(input, patternFor) })
  const anyTerm = (input, patternFor) => ({ $or: hits(input, patternFor) })
  const termCount = (input, patternFor) => ({
    $add: hits(input, patternFor).map((hit) => ({ $cond: [hit, 1, 0] })),
  })
  const weigh = (condition, weight) => ({ $cond: [condition, weight, 0] })
  const substring = (term) => term

  return {
    $add: [
      // The name literally starts with what was typed -- as close to "this is it" as it gets.
      weigh(
        { $regexMatch: { input: textField("name"), regex: `^\\s*${escapeRegex(queryStr)}`, options: "i" } },
        RELEVANCE_WEIGHTS.namePrefix,
      ),
      weigh(everyTerm(nameInput, wordBoundaryPattern), RELEVANCE_WEIGHTS.nameAllTerms),
      // Partial name coverage, so a two-word query still separates one hit from two.
      { $multiply: [termCount(nameInput, wordBoundaryPattern), RELEVANCE_WEIGHTS.namePerTerm] },
      // What the product actually is.
      weigh(everyTerm(categoryInput, wordBoundaryPattern), RELEVANCE_WEIGHTS.categoryAllTerms),
      weigh(anyTerm(categoryInput, wordBoundaryPattern), RELEVANCE_WEIGHTS.categoryAnyTerm),
      // Someone pasted a code.
      weigh(everyTerm(codeInput, substring), RELEVANCE_WEIGHTS.codeAllTerms),
      weigh(everyTerm(tagInput, wordBoundaryPattern), RELEVANCE_WEIGHTS.tagAllTerms),
      weigh(anyTerm(tagInput, wordBoundaryPattern), RELEVANCE_WEIGHTS.tagAnyTerm),
    ],
  }
}
