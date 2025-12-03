// See: https://rollupjs.org/introduction/

import commonjs from '@rollup/plugin-commonjs'
import json from '@rollup/plugin-json'
import nodeResolve from '@rollup/plugin-node-resolve'
import typescript from '@rollup/plugin-typescript'

const sharedPlugins = [
  typescript(),
  json(),
  nodeResolve({ preferBuiltins: true }),
  commonjs()
]

const config = [
  {
    input: 'src/index.ts',
    output: {
      esModule: true,
      file: 'dist/index.js',
      format: 'es',
      sourcemap: true
    },
    plugins: sharedPlugins
  },
  {
    input: 'src/post.ts',
    output: {
      esModule: true,
      file: 'dist/post.js',
      format: 'es',
      sourcemap: true
    },
    plugins: sharedPlugins
  }
]

export default config
