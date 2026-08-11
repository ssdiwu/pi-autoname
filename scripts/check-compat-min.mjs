import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const lockfile = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"));
const minimumVersion = "0.80.10";
const peers = ["@earendil-works/pi-ai", "@earendil-works/pi-coding-agent"];

for (const dependency of peers) {
  const range = packageJson.peerDependencies?.[dependency];
  const installed = lockfile.packages?.[`node_modules/${dependency}`]?.version;
  const expectedRange = `>=${minimumVersion}`;

  if (range !== expectedRange) {
    throw new Error(`${dependency} must declare peer range ${expectedRange}; found ${range ?? "missing"}`);
  }
  if (installed !== minimumVersion) {
    throw new Error(`${dependency} must be tested at minimum ${minimumVersion}; found ${installed ?? "missing"}`);
  }
}

console.log(`Compatibility contract verified at Pi API ${minimumVersion}.`);
