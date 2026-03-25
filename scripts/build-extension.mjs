#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';
import fg from 'fast-glob';
import fs from 'fs-extra';
import CleanCSS from 'clean-css';
import { minify as minifyHtml } from 'html-minifier-terser';
import JavaScriptObfuscator from 'javascript-obfuscator';
import { minify as minifyJs } from 'terser';

const rootDir = process.cwd();
const distDir = path.join(rootDir, 'dist');
const runtimeEntries = [
  'manifest.json',
  'background',
  'content',
  'sidepanel',
  'lib',
  'icons'
];
const optionalRuntimeEntries = ['inject'];
const jsObfuscationExclude = new Set(['lib/config.js']);
const globalReservedNames = ['AutoRegisterConfig'];

const args = new Set(process.argv.slice(2));
const mode = args.has('--mode=dev') ? 'dev' : 'release';
const shouldMinify = mode !== 'dev';
const shouldObfuscate = args.has('--obfuscate');

async function main() {
  console.log(`[build-extension] mode=${mode} obfuscate=${shouldObfuscate}`);

  await prepareDist();
  await copyRuntimeFiles();

  if (shouldMinify) {
    await minifyDistAssets();
  }

  if (shouldObfuscate) {
    await obfuscateDistJavaScript();
  }

  await validateDistManifest();
  console.log(`[build-extension] done -> ${distDir}`);
}

async function prepareDist() {
  await fs.emptyDir(distDir);
}

async function copyRuntimeFiles() {
  for (const entry of runtimeEntries) {
    const sourcePath = path.join(rootDir, entry);
    if (!(await fs.pathExists(sourcePath))) {
      throw new Error(`Missing required runtime entry: ${entry}`);
    }
    await fs.copy(sourcePath, path.join(distDir, entry));
    console.log(`[copy] ${entry}`);
  }

  for (const entry of optionalRuntimeEntries) {
    const sourcePath = path.join(rootDir, entry);
    if (await fs.pathExists(sourcePath)) {
      await fs.copy(sourcePath, path.join(distDir, entry));
      console.log(`[copy] ${entry}`);
    } else {
      console.warn(`[copy] optional entry not found, skipped: ${entry}`);
    }
  }
}

async function minifyDistAssets() {
  const [jsFiles, htmlFiles, cssFiles] = await Promise.all([
    fg('**/*.js', { cwd: distDir, onlyFiles: true }),
    fg('**/*.html', { cwd: distDir, onlyFiles: true }),
    fg('**/*.css', { cwd: distDir, onlyFiles: true })
  ]);

  for (const relativePath of jsFiles) {
    const filePath = path.join(distDir, relativePath);
    const source = await fs.readFile(filePath, 'utf8');
    const result = await minifyJs(source, {
      compress: {
        passes: 2
      },
      mangle: {
        toplevel: false,
        reserved: globalReservedNames
      },
      format: {
        comments: false
      },
      keep_classnames: true,
      keep_fnames: true
    });

    if (!result.code) {
      throw new Error(`Failed to minify JS: ${relativePath}`);
    }

    await fs.writeFile(filePath, result.code, 'utf8');
    console.log(`[minify:js] ${relativePath}`);
  }

  for (const relativePath of htmlFiles) {
    const filePath = path.join(distDir, relativePath);
    const source = await fs.readFile(filePath, 'utf8');
    const output = await minifyHtml(source, {
      collapseWhitespace: true,
      removeComments: true,
      minifyCSS: true,
      minifyJS: false,
      keepClosingSlash: true
    });
    await fs.writeFile(filePath, output, 'utf8');
    console.log(`[minify:html] ${relativePath}`);
  }

  for (const relativePath of cssFiles) {
    const filePath = path.join(distDir, relativePath);
    const source = await fs.readFile(filePath, 'utf8');
    const result = new CleanCSS({ level: 2 }).minify(source);

    if (result.errors.length) {
      throw new Error(`Failed to minify CSS ${relativePath}: ${result.errors.join('; ')}`);
    }

    await fs.writeFile(filePath, result.styles, 'utf8');
    console.log(`[minify:css] ${relativePath}`);
  }
}

async function obfuscateDistJavaScript() {
  const jsFiles = await fg(['**/*.js', '!lib/config.js'], { cwd: distDir, onlyFiles: true });

  for (const relativePath of jsFiles) {
    if (jsObfuscationExclude.has(relativePath)) {
      continue;
    }

    const filePath = path.join(distDir, relativePath);
    const source = await fs.readFile(filePath, 'utf8');
    const result = JavaScriptObfuscator.obfuscate(source, {
      compact: true,
      controlFlowFlattening: false,
      deadCodeInjection: false,
      disableConsoleOutput: false,
      identifierNamesGenerator: 'hexadecimal',
      renameGlobals: false,
      simplify: true,
      splitStrings: false,
      stringArray: true,
      stringArrayCallsTransform: false,
      stringArrayEncoding: [],
      stringArrayRotate: true,
      stringArrayShuffle: true,
      transformObjectKeys: false,
      unicodeEscapeSequence: false,
      reservedNames: globalReservedNames
    });

    await fs.writeFile(filePath, result.getObfuscatedCode(), 'utf8');
    console.log(`[obfuscate:js] ${relativePath}`);
  }

  console.warn('[obfuscate] lib/config.js skipped to preserve shared global contract');
}

async function validateDistManifest() {
  const manifestPath = path.join(distDir, 'manifest.json');
  const manifest = await fs.readJson(manifestPath);

  const requiredEntries = [
    manifest.background?.service_worker,
    manifest.side_panel?.default_path,
    ...(manifest.content_scripts || []).flatMap((entry) => entry.js || []),
    ...normalizeIconEntries(manifest.action?.default_icon)
  ].filter(Boolean);

  for (const relativePath of requiredEntries) {
    await assertPathExists(relativePath, 'manifest reference');
  }

  for (const resource of manifest.web_accessible_resources || []) {
    for (const entry of resource.resources || []) {
      if (entry.includes('*')) {
        const matches = await fg(entry, { cwd: distDir, onlyFiles: false, dot: true });
        if (matches.length === 0) {
          console.warn(`[validate] web_accessible_resources pattern has no matches: ${entry}`);
        }
        continue;
      }
      await assertPathExists(entry, 'web_accessible_resources');
    }
  }

  console.log('[validate] manifest references verified');
}

function normalizeIconEntries(iconField) {
  if (!iconField) {
    return [];
  }
  if (typeof iconField === 'string') {
    return [iconField];
  }
  return Object.values(iconField).filter(Boolean);
}

async function assertPathExists(relativePath, label) {
  const targetPath = path.join(distDir, relativePath);
  if (!(await fs.pathExists(targetPath))) {
    throw new Error(`Missing ${label}: ${relativePath}`);
  }
}

main().catch((error) => {
  console.error('[build-extension] failed');
  console.error(error);
  process.exitCode = 1;
});
