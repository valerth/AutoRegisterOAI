#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';
import fs from 'fs-extra';
import crx3 from 'crx3';

const rootDir = process.cwd();
const distDir = path.join(rootDir, 'dist');
const distManifestPath = path.join(distDir, 'manifest.json');
const defaultKeyPath = path.join(rootDir, '.keys', 'extension.pem');
const defaultOutputPath = path.join(rootDir, 'artifacts', 'auto-register.crx');

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const keyPath = path.resolve(rootDir, args.keyPath || defaultKeyPath);
  const outPath = path.resolve(rootDir, args.outPath || defaultOutputPath);

  await ensureDistReady();
  await ensureKeyExists(keyPath);
  await fs.ensureDir(path.dirname(outPath));

  console.log(`[package-crx] input=${distDir}`);
  console.log(`[package-crx] key=${keyPath}`);
  console.log(`[package-crx] output=${outPath}`);

  const result = await crx3([distManifestPath], {
    keyPath,
    crxPath: outPath
  });

  console.log(`[package-crx] appId=${result.appId}`);
  console.log(`[package-crx] done -> ${outPath}`);
}

function parseArgs(argv) {
  const options = {
    keyPath: '',
    outPath: ''
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--key') {
      options.keyPath = readValue(argv, index, '--key');
      index += 1;
      continue;
    }

    if (arg.startsWith('--key=')) {
      options.keyPath = arg.slice('--key='.length);
      continue;
    }

    if (arg === '--out') {
      options.outPath = readValue(argv, index, '--out');
      index += 1;
      continue;
    }

    if (arg.startsWith('--out=')) {
      options.outPath = arg.slice('--out='.length);
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function readValue(argv, index, flagName) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${flagName}`);
  }
  return value;
}

async function ensureDistReady() {
  if (!(await fs.pathExists(distManifestPath))) {
    throw new Error(`Missing dist manifest: ${distManifestPath}. Run \"npm run build\" first.`);
  }
}

async function ensureKeyExists(keyPath) {
  if (!(await fs.pathExists(keyPath))) {
    throw new Error([
      `Missing PEM key: ${keyPath}`,
      'Provide one with --key <path> or place a reusable key at ./.keys/extension.pem.',
      'This script does not generate keys automatically because the same PEM must be reused to keep the extension ID stable.'
    ].join('\n'));
  }
}

main().catch((error) => {
  console.error('[package-crx] failed');
  console.error(error.message || error);
  process.exitCode = 1;
});
