import { jest } from '@jest/globals'
import * as os from 'os'
import * as path from 'path'
import type * as exec from '@actions/exec'
import * as core from '../__fixtures__/core.js'

const mockExec = jest.fn<typeof exec.exec>()
const mockGetExecOutput = jest.fn<typeof exec.getExecOutput>()

jest.unstable_mockModule('@actions/core', () => core)
jest.unstable_mockModule('@actions/exec', () => ({
  exec: mockExec,
  getExecOutput: mockGetExecOutput,
}))

core.getInput.mockImplementation((name: string) => {
  if (name === 'rocq-version') {
    return 'latest'
  }
  if (name === 'cache-key-opam-files') {
    return path.join(os.tmpdir(), 'setup-rocq-empty', '*.opam')
  }
  return ''
})

// core.group() only wraps for log folding, so run the body directly.
core.group.mockImplementation(async (_name, fn) => fn())

const output = (stdout: string, exitCode = 0) => ({
  exitCode,
  stdout,
  stderr: '',
})

const {
  parseInstalledVersion,
  parseOpamEnv,
  stripAnsi,
  setupOpamEnv,
  opamInstalledVersion,
  opamSwitchExists,
  ensureSwitch,
  setupOpamRepositories,
  SWITCH_NAME,
} = await import('../src/opam.js')
const { OCAML_VERSION } = await import('../src/constants.js')

beforeEach(() => {
  mockExec.mockResolvedValue(0)
  mockGetExecOutput.mockResolvedValue(output(''))
  core.group.mockImplementation(async (_name, fn) => fn())
})

afterEach(() => {
  jest.resetAllMocks()
})

describe('stripAnsi', () => {
  it('removes SGR escapes', () => {
    expect(stripAnsi('\x1b[35mhello\x1b[0m')).toBe('hello')
  })

  it('leaves plain text alone', () => {
    expect(stripAnsi('hello')).toBe('hello')
  })
})

describe('parseInstalledVersion', () => {
  it('reads a plain version', () => {
    expect(parseInstalledVersion('3.22.1\n')).toBe('3.22.1')
  })

  // initializeOpam exports OPAMCOLOR=always, so this is what opam actually
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

describe('parseOpamEnv', () => {
  it('parses the VAR=...; export VAR; form opam emits', () => {
    const vars = parseOpamEnv(
      [
        "OPAM_SWITCH_PREFIX='/home/runner/.opam/default'; export OPAM_SWITCH_PREFIX;",
        "CAML_LD_LIBRARY_PATH='/home/runner/.opam/default/lib/stublibs'; export CAML_LD_LIBRARY_PATH;",
        "PATH='/home/runner/.opam/default/bin:/usr/bin'; export PATH;",
        '',
      ].join('\n'),
    )

    expect(vars.get('OPAM_SWITCH_PREFIX')).toBe('/home/runner/.opam/default')
    expect(vars.get('CAML_LD_LIBRARY_PATH')).toBe(
      '/home/runner/.opam/default/lib/stublibs',
    )
    expect(vars.get('PATH')).toBe('/home/runner/.opam/default/bin:/usr/bin')
  })

  it('parses the export VAR=... form', () => {
    const vars = parseOpamEnv("export OPAMSWITCH='default'")
    expect(vars.get('OPAMSWITCH')).toBe('default')
  })

  // A value containing a single quote is written the POSIX way, by closing
  // the quote, emitting an escaped quote, and reopening.  Matching the value
  // with [^']* stopped at the first of those and truncated the variable.
  it('unescapes a single quote inside a value', () => {
    const vars = parseOpamEnv(
      "OPAMROOT='/home/o'\\''brien/.opam'; export OPAMROOT;",
    )
    expect(vars.get('OPAMROOT')).toBe("/home/o'brien/.opam")
  })

  it('accepts variable names containing digits', () => {
    const vars = parseOpamEnv("MY_VAR2='x'; export MY_VAR2;")
    expect(vars.get('MY_VAR2')).toBe('x')
  })

  it('ignores lines that are not assignments', () => {
    const vars = parseOpamEnv('# a comment\n\nnot an assignment\n')
    expect(vars.size).toBe(0)
  })

  it('handles an empty value', () => {
    const vars = parseOpamEnv("EMPTY=''; export EMPTY;")
    expect(vars.get('EMPTY')).toBe('')
  })
})

describe('setupOpamEnv', () => {
  it('exports every variable opam env reports', async () => {
    mockGetExecOutput.mockResolvedValue(
      output(
        "OPAM_SWITCH_PREFIX='/opam/default'; export OPAM_SWITCH_PREFIX;\n" +
          "OCAML_TOPLEVEL_PATH='/opam/default/lib/toplevel'; export OCAML_TOPLEVEL_PATH;\n",
      ),
    )

    await setupOpamEnv()

    expect(core.exportVariable).toHaveBeenCalledWith(
      'OPAM_SWITCH_PREFIX',
      '/opam/default',
    )
    expect(core.exportVariable).toHaveBeenCalledWith(
      'OCAML_TOPLEVEL_PATH',
      '/opam/default/lib/toplevel',
    )
  })

  it('adds only PATH entries that are not already present', async () => {
    const oldPath = process.env.PATH
    process.env.PATH = ['/usr/bin', '/bin'].join(path.delimiter)
    mockGetExecOutput.mockResolvedValue(
      output(
        `PATH='${['/opam/default/bin', '/usr/bin', '/bin'].join(path.delimiter)}'; export PATH;\n`,
      ),
    )

    await setupOpamEnv()

    expect(core.addPath).toHaveBeenCalledWith('/opam/default/bin')
    expect(core.addPath).toHaveBeenCalledTimes(1)
    process.env.PATH = oldPath
  })

  // A substring test reports a hit for any path that merely contains an
  // existing entry, so /usr/local/bin would never be added once
  // /usr/local/bin/something was on PATH.
  it('compares whole PATH entries, not substrings', async () => {
    const oldPath = process.env.PATH
    process.env.PATH = '/usr/local/bin/nested'
    mockGetExecOutput.mockResolvedValue(
      output("PATH='/usr/local/bin'; export PATH;\n"),
    )

    await setupOpamEnv()

    expect(core.addPath).toHaveBeenCalledWith('/usr/local/bin')
    process.env.PATH = oldPath
  })
})

describe('opamInstalledVersion', () => {
  it('queries the current switch by default', async () => {
    mockGetExecOutput.mockResolvedValue(output('5.4.0\n'))

    expect(await opamInstalledVersion('ocaml')).toBe('5.4.0')

    const [, args] = mockGetExecOutput.mock.calls[0]
    expect(args).not.toContain('--switch')
  })

  it('passes --switch when a switch is named', async () => {
    mockGetExecOutput.mockResolvedValue(output('5.4.0\n'))

    expect(await opamInstalledVersion('ocaml', 'default')).toBe('5.4.0')

    const [, args] = mockGetExecOutput.mock.calls[0]
    expect(args).toEqual(expect.arrayContaining(['--switch', 'default']))
  })

  it('returns null when opam fails', async () => {
    mockGetExecOutput.mockResolvedValue(output('', 2))
    expect(await opamInstalledVersion('nonexistent')).toBeNull()
  })
})

describe('opamSwitchExists', () => {
  it('finds the switch in a --short listing', async () => {
    mockGetExecOutput.mockResolvedValue(output('default\n5.4.0\n'))
    expect(await opamSwitchExists()).toBe(true)
  })

  it('tolerates the color escapes opam adds to the listing', async () => {
    mockGetExecOutput.mockResolvedValue(output('\x1b[32mdefault\x1b[0m\n'))
    expect(await opamSwitchExists()).toBe(true)
  })

  it('reports false when the switch is absent', async () => {
    mockGetExecOutput.mockResolvedValue(output('4.14.2\n'))
    expect(await opamSwitchExists()).toBe(false)
  })

  it('reports false when opam itself fails', async () => {
    mockGetExecOutput.mockResolvedValue(output('', 1))
    expect(await opamSwitchExists()).toBe(false)
  })
})

describe('ensureSwitch', () => {
  const switchCreateCall = [
    'opam',
    ['switch', 'create', SWITCH_NAME, `ocaml-base-compiler.${OCAML_VERSION}`],
  ]

  it('does nothing when the switch has the requested compiler', async () => {
    mockGetExecOutput.mockImplementation(async (_cmd, args) => {
      if (args?.includes('list')) return output(`${SWITCH_NAME}\n`)
      return output(`${OCAML_VERSION}\n`)
    })

    await ensureSwitch()

    expect(mockExec).not.toHaveBeenCalled()
    expect(core.warning).not.toHaveBeenCalled()
  })

  // A restored archive can be partial, and a fallback cache key can match an
  // archive saved by an older version of the action.  main.ts skips switch
  // creation on any cache hit, so without this the run dies later with an
  // error that does not explain itself.
  it('creates the switch when the restored cache has none', async () => {
    mockGetExecOutput.mockResolvedValue(output(''))

    await ensureSwitch()

    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining('no "default" switch'),
    )
    expect(mockExec).toHaveBeenCalledWith(...switchCreateCall)
  })

  it('recreates the switch when its compiler is the wrong version', async () => {
    mockGetExecOutput.mockImplementation(async (_cmd, args) => {
      if (args?.includes('list')) return output(`${SWITCH_NAME}\n`)
      return output('4.14.2\n')
    })

    await ensureSwitch()

    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining('has OCaml 4.14.2'),
    )
    expect(mockExec).toHaveBeenCalledWith('opam', [
      'switch',
      'remove',
      SWITCH_NAME,
      '--yes',
    ])
    expect(mockExec).toHaveBeenCalledWith(...switchCreateCall)
  })

  it('recreates the switch when it has no compiler at all', async () => {
    mockGetExecOutput.mockImplementation(async (_cmd, args) => {
      if (args?.includes('list')) return output(`${SWITCH_NAME}\n`)
      return output('--\n')
    })

    await ensureSwitch()

    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining('no OCaml compiler'),
    )
    expect(mockExec).toHaveBeenCalledWith(...switchCreateCall)
  })
})

describe('setupOpamRepositories', () => {
  const repoAdds = () =>
    mockExec.mock.calls
      .filter(([, args]) => args?.[0] === 'repository')
      .map(([, args]) => [args?.at(-2), args?.at(-1)])

  it('always adds rocq-released', async () => {
    await setupOpamRepositories()

    expect(repoAdds()).toEqual([
      ['rocq-released', 'https://rocq-prover.org/opam/released'],
    ])
  })

  it.each(['dev', 'weekly'])('adds core-dev for %s', async (version) => {
    core.getInput.mockImplementation((name: string) =>
      name === 'rocq-version' ? version : '',
    )
    jest.resetModules()
    const { setupOpamRepositories: setup } = await import('../src/opam.js')

    await setup()

    expect(repoAdds()).toContainEqual([
      'rocq-core-dev',
      'https://rocq-prover.github.io/opam/core-dev',
    ])
  })

  it('adds repositories from the opam-repositories input', async () => {
    core.getInput.mockImplementation((name: string) => {
      if (name === 'rocq-version') return 'latest'
      if (name === 'opam-repositories') {
        return 'iris-dev: https://gitlab.mpi-sws.org/iris/opam.git\n'
      }
      return ''
    })

    await setupOpamRepositories()

    expect(repoAdds()).toContainEqual([
      'iris-dev',
      'https://gitlab.mpi-sws.org/iris/opam.git',
    ])
  })

  it('warns rather than failing on malformed YAML', async () => {
    core.getInput.mockImplementation((name: string) => {
      if (name === 'rocq-version') return 'latest'
      if (name === 'opam-repositories') return '{ this is: not: valid'
      return ''
    })

    await expect(setupOpamRepositories()).resolves.toBeUndefined()
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining('Failed to parse opam-repositories'),
    )
  })
})
