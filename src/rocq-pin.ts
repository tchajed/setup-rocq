import * as core from '@actions/core'
import * as glob from '@actions/glob'
import { createHash } from 'crypto'
import * as fs from 'fs/promises'

export interface RocqPin {
  pkg: string
  target: string
}

const ROCQ_PACKAGE_PATTERN = /^(?:coq|rocq)(?:[.-]|$)/

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

export function getPinnedRocqInstallPackage(pins: RocqPin[]): string {
  if (pins.some((pin) => pin.pkg === 'coq.dev')) {
    return 'coq.dev'
  }

  if (pins.some((pin) => pin.pkg === 'coq')) {
    return 'coq'
  }

  if (pins.length === 1) {
    return pins[0].pkg
  }

  throw new Error(
    'Found Rocq pin-depends, but could not determine which package to install. Pin coq or coq.dev explicitly.',
  )
}
