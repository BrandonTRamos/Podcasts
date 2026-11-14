// Makes package-lock.json acceptable to `npm ci` (npm 10).
//
// Some Amplify packages (@aws-amplify/data-construct, graphql-api-construct)
// publish bundles whose contents disagree with their own dependency ranges.
// `npm install` drops the extra copies npm needs to satisfy those ranges, but
// `npm ci` still expects them in the lockfile and fails with "Missing: ... from
// lock file". This rebuilds npm's ideal tree and saves it as the lockfile. It is
// a no-op when the lockfile is already in sync, and runs on every install.
const path = require('node:path')

async function main() {
  const npmCli = process.env.npm_execpath
  if (!npmCli) return // not run by npm
  const npmDir = path.resolve(path.dirname(npmCli), '..')
  const Arborist = require(path.join(npmDir, 'node_modules', '@npmcli', 'arborist'))
  const arb = new Arborist({ path: path.resolve(__dirname, '..') })
  const tree = await arb.buildIdealTree()
  await tree.meta.save()
}

main().catch((error) => {
  console.warn(`repair-lockfile: skipped (${error.message})`)
})
