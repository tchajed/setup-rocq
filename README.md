# setup-rocq

![Linter](https://github.com/tchajed/setup-rocq/actions/workflows/linter.yml/badge.svg)
![CI](https://github.com/tchajed/setup-rocq/actions/workflows/ci.yml/badge.svg)
![Check dist/](https://github.com/tchajed/setup-rocq/actions/workflows/check-dist.yml/badge.svg)
![CodeQL](https://github.com/tchajed/setup-rocq/actions/workflows/codeql-analysis.yml/badge.svg)

GitHub action to install Rocq with opam. Supports caching of opam dependencies.

## Usage

```yaml
- uses: tchajed/setup-rocq@v1
  with:
    rocq-version: 'latest' # default
```

## Configuration

### Inputs

| Input                      | Description                                                 | Required | Default    |
| -------------------------- | ----------------------------------------------------------- | -------- | ---------- |
| `rocq-version`             | The version of Rocq to install                              | No       | `latest`   |
| `opam-repositories`        | Additional opam repositories to add (YAML name:url object)  | No       | `''`       |
| `cache-key-opam-files`     | Opam files to hash for the cache key.                       | No       | `'*.opam'` |
| `save-if`                  | Whether the post step saves a cache (`true`/`false`/`auto`) | No       | `'auto'`   |
| `strip-binary-annotations` | Delete `.cmt`/`.cmti` from the switch before saving         | No       | `'true'`   |

`rocq-version` supports these special strings, in addition to full Rocq versions
(as used by `opam install`):

- "latest" installs the most recent stable release
- "dev" installs the latest git version of Rocq
- "weekly" installs the git version of Rocq from this Monday

The Rocq opam repository is always available (the equivalent of running
`opam repo add rocq-released https://rocq-prover.org/opam/released`).

`cache-key-opam-files` uses
[actions/glob](https://www.npmjs.com/package/@actions/glob), which takes
newline-separated patterns.

`save-if` controls whether the post step writes a cache. GitHub scopes a cache
to the ref that created it: a cache saved by a `pull_request` run lands under
`refs/pull/N/merge`, where neither the base branch nor any sibling PR can read
it. It can only consume the repository's 10GB cache quota and, once that fills,
evict — least recently used — the branch caches that pull requests do restore
from. A busy repository can lose its default-branch cache this way and
cold-start every job from then on, which is both slow and exposed to upstream
rate limits.

Under the default `auto`, pull request runs restore a cache but do not save one;
every other event saves as before. Use `true` to always save and `false` to
never save.

> [!IMPORTANT] If your workflow only runs on pull requests (`on: pull_request`
> with no `push` trigger), no run will ever be eligible to save under `auto` and
> your cache will never be populated. Set `save-if: true`, or add a `push`
> trigger for your default branch.

`strip-binary-annotations` deletes `.cmt` and `.cmti` files from the switch in
the post step, just before the cache is uploaded. These are OCaml binary
annotation files: merlin, ocaml-lsp and odoc read them to answer questions about
source, but nothing involved in _building_ a Rocq project does. They are roughly
a fifth of the compressed cache, which makes this the largest saving available.

Deleting them does not disturb opam's bookkeeping — opam tracks which packages
are installed, not a checksum over their files — so an incremental
`opam install` against the restored switch still sees every package as present.

Set it to `false` if your workflow runs merlin, ocaml-lsp or odoc against the
restored switch.

If the opam files matched by `cache-key-opam-files` contain `pin-depends`
entries for Rocq packages, setup-rocq will install that pinned package instead
of the `rocq-version` input and will include the pin target in the Rocq cache
key.

### Examples

```yaml
- uses: tchajed/setup-rocq@v1
  with:
    rocq-version: dev
    opam-repositories: |
      iris-dev: https://gitlab.mpi-sws.org/iris/opam.git
    cache-key-opam-files: **.opam
```
