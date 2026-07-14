import * as core from '@actions/core'
import * as glob from '@actions/glob'
import { createHash } from 'crypto'
import * as fs from 'fs/promises'

export interface RocqPin {
  pkg: string
  target: string
}

// Matches the packages that name a Rocq release: the top-level "coq" compat
// metapackage and the post-rename rocq-* packages.
const ROCQ_PACKAGE_PATTERN =
  /^(?:coq|rocq-core|rocq-runtime|rocq-stdlib)(?:\.|$)/

// The root of the post-rename Rocq package graph.
const ROCQ_CORE_PATTERN = /^rocq-core(?:\.|$)/

/**
 * Extract a balanced bracketed list from opam file contents.
 *
 * @param contents Full opam file contents.
 * @param start Index of the opening `[` that starts the list.
 * @returns The list contents including the outer brackets, or undefined if the
 * list is not balanced.
 */
function extractList(contents: string, start: number): string | undefined {
  let depth = 0
  let inString = false

  for (let i = start; i < contents.length; i++) {
    const char = contents[i]
    if (char === '"' && contents[i - 1] !== '\\') {
      inString = !inString
      continue
    }

    if (inString) {
      continue
    }

    if (char === '[') {
      depth += 1
    } else if (char === ']') {
      depth -= 1
      if (depth === 0) {
        return contents.slice(start, i + 1)
      }
    }
  }
}

/**
 * Parse Rocq-related pin-depends entries from a single opam file.
 *
 * A valid Rocq pin is any `pin-depends` entry whose package name begins with
 * `coq` or `rocq`.
 *
 * @param contents Full opam file contents.
 * @returns Rocq pin entries found in the file, in file order.
 */
function extractRocqPins(contents: string): RocqPin[] {
  const pins: RocqPin[] = []
  const pinDependsPattern = /pin-depends\s*:/g
  let match: RegExpExecArray | null

  while ((match = pinDependsPattern.exec(contents)) !== null) {
    const listStart = contents.indexOf('[', match.index)
    if (listStart === -1) {
      continue
    }

    const list = extractList(contents, listStart)
    if (!list) {
      continue
    }

    const pinPattern = /\[\s*"([^"]+)"\s*"([^"]+)"\s*\]/g
    let pinMatch: RegExpExecArray | null
    while ((pinMatch = pinPattern.exec(list)) !== null) {
      const [, pkg, target] = pinMatch
      if (ROCQ_PACKAGE_PATTERN.test(pkg)) {
        pins.push({ pkg, target })
      }
    }
  }

  return pins
}

/**
 * Read the opam files matched by `cache-key-opam-files` and collect any
 * Rocq-related pin-depends entries.
 *
 * @returns A sorted list of unique Rocq pins.
 * @throws If the same Rocq package is pinned to conflicting targets.
 */
export async function getPinnedRocqPackages(): Promise<RocqPin[]> {
  const cacheKeyFiles = core.getInput('cache-key-opam-files')
  if (!cacheKeyFiles.trim()) {
    return []
  }
  const globber = await glob.create(cacheKeyFiles)
  const packages = new Map<string, string>()

  for await (const file of globber.globGenerator()) {
    const contents = await fs.readFile(file, 'utf8')
    for (const pin of extractRocqPins(contents)) {
      const existingTarget = packages.get(pin.pkg)
      if (existingTarget && existingTarget !== pin.target) {
        throw new Error(
          `Conflicting Rocq pin-depends targets found for ${pin.pkg}: ${existingTarget} and ${pin.target}`,
        )
      }
      packages.set(pin.pkg, pin.target)
    }
  }

  return [...packages.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([pkg, target]) => ({ pkg, target }))
}

/**
 * Produce a stable hash fragment for Rocq pin-depends entries.
 *
 * The cache key only needs a short, deterministic identifier; when no Rocq
 * pins are present, undefined is returned so the caller can keep using the
 * normal version-based cache key.
 *
 * @returns A 16-character SHA-256 prefix for the current Rocq pins, or
 * undefined when no Rocq pins are present.
 */
export async function getPinnedRocqCacheKeyPart(): Promise<string | undefined> {
  const pins = await getPinnedRocqPackages()
  if (pins.length === 0) {
    return
  }

  return createHash('sha256')
    .update(JSON.stringify(pins))
    .digest('hex')
    .slice(0, 16)
}

/**
 * Choose the Rocq packages to install from the discovered pin-depends entries.
 *
 * The precedence matches the common layouts for Rocq source pins:
 * `coq.dev` first, then `coq`, then a single pinned package when there is only
 * one candidate. When multiple `rocq-*` packages are pinned without a `coq`
 * metapackage, all pins are installed explicitly since `rocq-core` does not
 * depend on `rocq-stdlib`.
 *
 * @param pins Rocq-related pin-depends entries.
 * @returns The package names to pass to `opam install`.
 * @throws If multiple Rocq pins are present without an explicit `coq`,
 * `coq.dev`, or `rocq-core` package.
 */
export function getPinnedRocqInstallPackages(pins: RocqPin[]): string[] {
  if (pins.some((pin) => pin.pkg === 'coq.dev')) {
    return ['coq.dev']
  }

  if (pins.some((pin) => pin.pkg === 'coq')) {
    return ['coq']
  }

  if (pins.length === 1) {
    return [pins[0].pkg]
  }

  if (pins.some((pin) => ROCQ_CORE_PATTERN.test(pin.pkg))) {
    return pins.map((pin) => pin.pkg)
  }

  throw new Error(
    'Found Rocq pin-depends, but could not determine which package to install. Pin coq, coq.dev, or rocq-core explicitly.',
  )
}
