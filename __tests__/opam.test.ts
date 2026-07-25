import { jest } from '@jest/globals'
import * as os from 'os'
import * as path from 'path'
import * as core from '../__fixtures__/core.js'

jest.unstable_mockModule('@actions/core', () => core)

core.getInput.mockImplementation((name: string) => {
  if (name === 'rocq-version') {
    return 'latest'
  }
  if (name === 'cache-key-opam-files') {
    return path.join(os.tmpdir(), 'setup-rocq-empty', '*.opam')
  }
  return ''
})

const { parseInstalledVersion } = await import('../src/opam.js')

describe('parseInstalledVersion', () => {
  it('reads a plain version', () => {
    expect(parseInstalledVersion('3.22.1\n')).toBe('3.22.1')
  })

  // setupOpamEnv exports OPAMCOLOR=always, so this is what opam actually
  // prints under the action.  Leaving the escapes on made every version
  // unparsable, which silently disabled the "keep a newer dune" check.
  it('strips the color escapes OPAMCOLOR=always adds', () => {
    expect(parseInstalledVersion('\x1b[35m3.23.1\x1b[0m\n')).toBe('3.23.1')
  })

  it('returns null for a package that is not installed', () => {
    expect(parseInstalledVersion('--\n')).toBeNull()
    expect(parseInstalledVersion('\x1b[35m--\x1b[0m\n')).toBeNull()
  })

  it('returns null for empty output', () => {
    expect(parseInstalledVersion('')).toBeNull()
  })
})
