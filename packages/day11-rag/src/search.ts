import { embedOne } from './embed.js'
import { search as dbSearch } from './db.js'
import type { SearchResult } from './types.js'

// search() returns raw chunks — may include multiple chunks from the same document.
// Use searchDeduped() to get one result per path (max-pooling by slug).
export async function search(
  query: string,
  k = 5,
  minSimilarity = 0.3,
): Promise<SearchResult[]> {
  const queryEmbedding = await embedOne(query)
  return dbSearch(queryEmbedding, k, minSimilarity)
}

// searchDeduped() over-fetches then keeps only the top-scoring chunk per document.
// Why over-fetch (k * 4)? If we only requested k chunks and 4 came from one doc,
// dedup would return fewer than k results. Over-fetching guarantees k distinct docs
// as long as the corpus has at least k paths.
export async function searchDeduped(
  query: string,
  k = 5,
  minSimilarity = 0.0,
): Promise<SearchResult[]> {
  const raw = await search(query, k * 4, minSimilarity)
  const seen = new Set<string>()
  return raw.filter((r) => !seen.has(r.slug) && seen.add(r.slug)).slice(0, k)
}

export type { SearchResult }
