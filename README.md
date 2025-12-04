# setup-rocq

![Linter](https://github.com/tchajed/setup-rocq/actions/workflows/linter.yml/badge.svg)
![CI](https://github.com/tchajed/setup-rocq/actions/workflows/ci.yml/badge.svg)
![Check dist/](https://github.com/tchajed/setup-rocq/actions/workflows/check-dist.yml/badge.svg)
![CodeQL](https://github.com/tchajed/setup-rocq/actions/workflows/codeql-analysis.yml/badge.svg)

GitHub action to install Rocq with opam. Supports caching of opam dependencies.

## Usage

Rocq version defaults to "latest", which uses the most recent stable release.

```yaml
- uses: tchajed/setup-rocq@v1
  with:
    rocq-version: 'latest'
```

## Configuration

### Inputs

| Input               | Description                                                | Required | Default  |
| ------------------- | ---------------------------------------------------------- | -------- | -------- |
| `rocq-version`      | The version of Rocq to install                             | No       | `latest` |
| `opam-repositories` | Additional opam repositories to add (YAML name:url object) | No       | `''`     |

### Examples

```yaml
- uses: tchajed/setup-rocq@v1
  with:
    rocq-version: dev
    opam-repositories: |
      iris-dev: https://gitlab.mpi-sws.org/iris/opam.git
```
