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

// A pasted product title drags its punctuation along: "S25 plus,", "MagSafe,", "Blue".
// Matched literally those never find a product whose own title reads "S25 plus and
// MagSafe Charging", so the comma comes off before anything is compared. Punctuation
// *inside* a word stays, because "anti-slip" and "6.8-inch" are single words.
export function normalizeSearchToken(token) {
  return String(token || "")
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/[^\p{L}\p{N}]+$/u, "")
}

// Words that sit in almost every product title and so tell the ranking nothing. Dropping
// them is what lets a pasted title find the right colour: scoring "for" as a match is
// what let a Black case tie with the Blue one actually being searched for.
export const SEARCH_STOPWORDS = new Set([
  "a", "an", "and", "for", "from", "in", "of", "on", "or", "the", "to", "with", "&",
])

// Short queries are precise instructions: "crownyx screen protector" means all three
// words. A pasted product title is not -- it is one product's exact wording, and the
// catalogue's wording for that same product differs by a word or two ("for iPhone &
// Samsung Galaxy S25 Plus," against "Compatible with Samsung Galaxy S25 plus and").
// Demanding every word of a 20-word title rejects the one product being looked for,
// which is exactly the failure this threshold exists to prevent.
export const PARTIAL_MATCH_MIN_TERMS = 4
export const PARTIAL_MATCH_RATIO = 0.6

export function requiredTermHits(termCount) {
  if (termCount < PARTIAL_MATCH_MIN_TERMS) return termCount
  return Math.max(PARTIAL_MATCH_MIN_TERMS, Math.ceil(termCount * PARTIAL_MATCH_RATIO))
}

// The query reduced to the words that will actually be matched, so the scorer, the
// database filter and any caller comparing the two all agree on what was asked for.
export function normalizeSearchText(text) {
  return String(text || "")
    .toLowerCase()
    .split(/\s+/)
    .map(normalizeSearchToken)
    .filter(Boolean)
    .join(" ")
}

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

  const rawTerms = queryStr.split(/\s+/).map(normalizeSearchToken).filter(Boolean)
  const terms = rawTerms.filter((term) => !SEARCH_STOPWORDS.has(term.toLowerCase()))

  // Someone searching "the" still has to be searching for something.
  return { queryStr, terms: terms.length > 0 ? terms : rawTerms }
}

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

const nameInput = () => joined(SEARCH_NAME_FIELDS.map(textField))
const codeInput = () => joined(SEARCH_CODE_FIELDS.map(textField))
const tagInput = () => joined(SEARCH_TAG_FIELDS.map(arrayField))
const categoryInput = () => joined(SEARCH_CATEGORY_FIELDS.map(textField))
const descriptionInput = () => joined(SEARCH_DESCRIPTION_FIELDS.map(textField))

// Build search conditions for a query.
//
// By default every word must match at least one field (AND across words, OR across
// fields) -- an exact search keeps giving its exact answer. `allowPartial` relaxes that
// to requiredTermHits(), and callers turn it on only once the strict pass found nothing,
// so a pasted product title still reaches the product it names when a word or two of the
// catalogue's own wording differs.
export async function buildSearchConditions(
  search,
  BrandModel,
  { includeDescription = false, allowPartial = false } = {},
) {
  const { terms } = parseSearchTerms(search)
  if (terms.length === 0) return null

  // For each word, check if it matches a brand name; only add the brand filter for that specific word.
  const perTerm = await Promise.all(
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
      const brandIds = matchingBrands.map((b) => b._id)
      if (brandIds.length > 0) {
        orClause.push({ brand: { $in: brandIds } })
      }

      // The same test as orClause, written as an aggregation expression so the partial
      // branch below can count how many of the words a document carries.
      const hitExpr = [
        { $regexMatch: { input: nameInput(), regex: wordBoundaryPattern(safeTerm), options: "i" } },
        { $regexMatch: { input: tagInput(), regex: wordBoundaryPattern(safeTerm), options: "i" } },
        { $regexMatch: { input: categoryInput(), regex: wordBoundaryPattern(safeTerm), options: "i" } },
        { $regexMatch: { input: codeInput(), regex: safeTerm, options: "i" } },
      ]
      if (includeDescription) {
        hitExpr.push({ $regexMatch: { input: descriptionInput(), regex: wordBoundaryPattern(safeTerm), options: "i" } })
      }
      if (brandIds.length > 0) {
        hitExpr.push({ $in: ["$brand", brandIds] })
      }

      return { condition: { $or: orClause }, hit: { $or: hitExpr } }
    }),
  )

  const wordConditions = perTerm.map((entry) => entry.condition)
  const required = allowPartial ? requiredTermHits(terms.length) : terms.length

  if (required >= wordConditions.length) {
    return wordConditions.length > 1 ? { $and: wordConditions } : wordConditions[0]
  }

  // At least one word still has to land before the expression is evaluated, so the
  // cheap indexed-ish clause runs first and $expr only scores what survived it.
  return {
    $and: [
      { $or: wordConditions },
      {
        $expr: {
          $gte: [{ $add: perTerm.map((entry) => ({ $cond: [entry.hit, 1, 0] })) }, required],
        },
      },
    ],
  }
}

// Relevance weights, added together per product.
//
// The catalog stores spec text inside the product *name* -- a laptop is listed as
// "Aspire Lite AL15-53P-56PA, Intel Core 5-120u, ... English Keyboard, ..." -- so a name
// hit alone is a weak signal. What a product *is* lives in its category and tags, which
// is why those outweigh a mention buried in a name. That is the whole reason a search for
// "Keyboard" used to return a page of laptops.
//
// `nameExact` and `nameCoverage` are what answer a pasted product title: once partial
// matches are allowed in, the product whose title covers the most of the query has to
// come out on top of the ones that merely share a prefix with it.
//
// Mirrored client-side by scoreSearchRelevance in client/src/services/productCache.js;
// the two must stay in step.
export const RELEVANCE_WEIGHTS = {
  nameExact: 200,
  namePrefix: 120,
  nameCoverage: 60,
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

  const nameIn = nameInput()
  const codeIn = codeInput()
  const tagIn = tagInput()
  const categoryIn = categoryInput()

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
      // The name IS what was typed. Anchored at both ends, so this fires only for the
      // one product whose title the shopper pasted in.
      weigh(
        {
          $regexMatch: {
            input: textField("name"),
            regex: `^\\s*${escapeRegex(queryStr)}\\s*$`,
            options: "i",
          },
        },
        RELEVANCE_WEIGHTS.nameExact,
      ),
      // The name literally starts with what was typed -- as close to "this is it" as it gets.
      weigh(
        { $regexMatch: { input: textField("name"), regex: `^\\s*${escapeRegex(queryStr)}`, options: "i" } },
        RELEVANCE_WEIGHTS.namePrefix,
      ),
      // How much of the query this name accounts for. A title that carries 17 of the 19
      // words asked for beats one that carries 16, which is the whole point of letting
      // partial matches through in the first place.
      {
        $multiply: [
          { $divide: [termCount(nameIn, wordBoundaryPattern), terms.length] },
          RELEVANCE_WEIGHTS.nameCoverage,
        ],
      },
      weigh(everyTerm(nameIn, wordBoundaryPattern), RELEVANCE_WEIGHTS.nameAllTerms),
      // Partial name coverage, so a two-word query still separates one hit from two.
      { $multiply: [termCount(nameIn, wordBoundaryPattern), RELEVANCE_WEIGHTS.namePerTerm] },
      // What the product actually is.
      weigh(everyTerm(categoryIn, wordBoundaryPattern), RELEVANCE_WEIGHTS.categoryAllTerms),
      weigh(anyTerm(categoryIn, wordBoundaryPattern), RELEVANCE_WEIGHTS.categoryAnyTerm),
      // Someone pasted a code.
      weigh(everyTerm(codeIn, substring), RELEVANCE_WEIGHTS.codeAllTerms),
      weigh(everyTerm(tagIn, wordBoundaryPattern), RELEVANCE_WEIGHTS.tagAllTerms),
      weigh(anyTerm(tagIn, wordBoundaryPattern), RELEVANCE_WEIGHTS.tagAnyTerm),
    ],
  }
}
