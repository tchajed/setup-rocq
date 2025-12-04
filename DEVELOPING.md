# Developing rocq-setup action

See also
[actions/typescript-action](https://github.com/actions/typescript-action), the
template this action was generated from.

## Setting up development environment

You'll need Node.js. You can use a version manager like
[`nodenv`](https://github.com/nodenv/nodenv) or

> [`fnm`](https://github.com/Schniz/fnm) to automatically use the version
> specified by `.node-version`.

1. :hammer_and_wrench: Install the dependencies

   ```bash
   npm install
   ```

1. :building_construction: Package the TypeScript for distribution

   ```bash
   npm run bundle
   ```

   This is important to run before committing - the bundled output in `dist/`
   needs to be committed.

1. :white_check_mark: Run the tests

   ```bash
   npm test
   ```

For more useful testing, install [act](https://github.com/nektos/act) and run
the workflow that runs the action:

```bash
act -j 'test-action-dev' -W .github/workflows/ci.yml
```

On macOS, I also pass `--container-architecture linux/arm64` which is
significantly faster than emulating x86.

For more information about the GitHub Actions toolkit, see the
[documentation](https://github.com/actions/toolkit/blob/main/README.md).

## Releases

We maintain a major version tag that points to the latest release tag.

For information about versioning your action, see
[Versioning](https://github.com/actions/toolkit/blob/main/docs/action-versioning.md)
in the GitHub Actions toolkit.
