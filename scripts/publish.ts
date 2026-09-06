#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJSONPath = path.join(repositoryRoot, 'package.json');

function fail(message: string): never {
  console.error(`❌ ${message}`);
  process.exit(1);
}

const version = process.argv[2];
if (version == null || version.length === 0) {
  fail('Missing version argument. Usage: pnpm run release <version>');
}

const packageJSON: { name: string; version: string } = JSON.parse(await fs.readFile(packageJSONPath, 'utf-8'));

const response = await fetch(`https://registry.npmjs.org/${packageJSON.name}/${version}`);
if (response.ok) {
  fail(
    `${packageJSON.name}@${version} is already published to npm. Push a new tag with a version that hasn't been published yet.`,
  );
}

await fs.writeFile(packageJSONPath, `${JSON.stringify({ ...packageJSON, version }, null, 2)}\n`);

const result = spawnSync('pnpm', ['publish', '--no-git-checks'], { cwd: repositoryRoot, stdio: 'inherit' });
if (result.status !== 0) fail('pnpm publish failed');

console.log(`✅ published ${packageJSON.name}@${version}`);
