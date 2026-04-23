export interface ParsedClients {
  key: string
  display: string
  parties: string[]
  isJoint: boolean
}

/** Patterns (lowercased substrings) that identify non-client placeholder entries
 *  — administrative bookkeeping that shouldn't appear in any client/revenue analysis. */
const EXCLUDED_CLIENT_PATTERNS = ["non-billable that counts"]

export function isExcludedClient(raw: string | null | undefined): boolean {
  if (!raw) return false
  const s = raw.toLowerCase()
  return EXCLUDED_CLIENT_PATTERNS.some((p) => s.includes(p))
}

const SPLIT_RE = /\s*(?:;|&| and )\s*/i

export function parseClientsField(raw: string | null | undefined): ParsedClients {
  if (!raw || !raw.trim()) {
    return { key: "__unknown__", display: "(unknown client)", parties: [], isJoint: false }
  }

  const trimmed = raw.replace(/\s+/g, " ").trim()
  const parties = trimmed
    .split(SPLIT_RE)
    .map((p) => p.trim())
    .filter(Boolean)

  if (parties.length <= 1) {
    return {
      key: normalize(trimmed),
      display: trimmed,
      parties: [trimmed],
      isJoint: false,
    }
  }

  const sortedParties = [...parties].sort((a, b) => a.localeCompare(b))
  return {
    key: sortedParties.map(normalize).join(" + "),
    display: parties.join(" + "),
    parties,
    isJoint: true,
  }
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim()
}
