const fs = require('fs/promises');
const path = require('path');
const sharp = require('sharp');
const { build: esbuildBuild, transform } = require('esbuild');

const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const assetDir = path.join(distDir, 'assets');
const materialSvgDir = path.join(
  path.dirname(require.resolve('@material-symbols/svg-400/package.json')),
  'outlined'
);

const rootStaticFiles = [
  '.nojekyll',
  'robots.txt',
  'site.webmanifest',
  'sitemap.xml'
];

const rootHtmlFiles = [
  '404.html',
  'index.html'
];

const copyDirs = [
  'data',
  'styles'
];

const pageDir = 'pages';
const imageDir = 'images';

const themeInitPath = path.join(rootDir, 'scripts', 'theme-init.js');
const ambientSourceFiles = [
  path.join(rootDir, 'scripts', 'night-sky.js'),
  path.join(rootDir, 'scripts', 'day-clouds.js')
];

const firebaseBridgeEntry = path.join(rootDir, 'scripts', 'build', 'firebase-modules.entry.js');
const d3BridgeEntry = path.join(rootDir, 'scripts', 'build', 'd3-topo.entry.js');

const jsExtensions = new Set(['.js']);
const cssExtensions = new Set(['.css']);
const optimizableImageExtensions = new Set(['.webp', '.png', '.jpg', '.jpeg']);
const extraIconNames = new Set(['dark_mode', 'expand_less']);
const iconSourceAliases = new Map([
  ['expand_less', 'keyboard_arrow_up'],
  ['expand_more', 'keyboard_arrow_down']
]);

const materialIconSpanPattern = /<span([^>]*class=(["'])[^"']*\bmaterial-symbols-outlined\b[^"']*\2[^>]*)>([^<]+)<\/span>/gi;
const localScriptTagPattern = /<script\b([^>]*?)\bsrc=(["'])([^"']+)\2([^>]*)><\/script>\s*/gi;
const googleFontLinkPattern = /<link\b[^>]*href=(["'])(https:\/\/fonts\.googleapis\.com\/css2[^"']+)\1[^>]*>\s*/gi;
const materialIconLinkPattern = /<link[^>]+Material\+Symbols[^>]*>\s*/gi;
const materialIconNoScriptPattern = /<noscript>\s*<link[^>]+Material\+Symbols[^>]*>\s*<\/noscript>\s*/gi;
const firebaseCompatScriptPattern = /<script\b[^>]*src=(["'])https:\/\/www\.gstatic\.com\/firebasejs\/[^"']*firebase-(?:app|auth|firestore)-compat\.js\1[^>]*><\/script>\s*/gi;
const d3CdnScriptPattern = /<script\b[^>]*src=(["'])https:\/\/cdn\.jsdelivr\.net\/npm\/d3@[^"']*\1[^>]*><\/script>\s*/gi;
const topojsonCdnScriptPattern = /<script\b[^>]*src=(["'])https:\/\/cdn\.jsdelivr\.net\/npm\/topojson-client@[^"']*\1[^>]*><\/script>\s*/gi;
const gstaticPreconnectPattern = /<link[^>]+href=(["'])https:\/\/www\.gstatic\.com\1[^>]*>\s*/gi;
const jsdelivrPreconnectPattern = /<link[^>]+href=(["'])https:\/\/cdn\.jsdelivr\.net\1[^>]*>\s*/gi;
const ambientBodyOptInPattern = /<body\b[^>]*\bdata-ambient-enabled(?:=(["'])(?:true|1|enabled)\1)?[^>]*>/i;

function toPosixPath(filePath) {
  return filePath.split(path.sep).join('/');
}

function stripQueryAndHash(value) {
  return String(value || '').split('#')[0].split('?')[0];
}

function escapeInlineScript(value) {
  return String(value || '').replace(/<\/script/gi, '<\\/script');
}

function escapeHtmlAttribute(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function sanitizeIconName(value) {
  return String(value == null ? '' : value)
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_-]/gi, '');
}

function isExternalAsset(src) {
  return /^(?:[a-z]+:)?\/\//i.test(src);
}

function isThemeInitScript(scriptRelPath) {
  return scriptRelPath === 'scripts/theme-init.js';
}

function isAmbientScript(scriptRelPath) {
  return scriptRelPath === 'scripts/night-sky.js' || scriptRelPath === 'scripts/day-clouds.js';
}

function pageNeedsFirebase(scriptRelPaths) {
  return scriptRelPaths.includes('scripts/firebase-config.js');
}

function pageNeedsD3(scriptRelPaths) {
  return scriptRelPaths.some((scriptRelPath) => {
    return (
      scriptRelPath === 'scripts/editor.js' ||
      scriptRelPath === 'scripts/main.js' ||
      scriptRelPath.startsWith('scripts/main/')
    );
  });
}

function pageNeedsRemoteWorldAtlas(scriptRelPaths) {
  return scriptRelPaths.includes('scripts/main.js');
}

function pageHasAmbientOptIn(htmlContent) {
  return ambientBodyOptInPattern.test(htmlContent);
}

function pageKeyForHtml(htmlRelPath) {
  return path.posix.basename(htmlRelPath, '.html');
}

function relativeRefFromHtml(htmlRelPath, assetRelPath) {
  return path.posix.relative(path.posix.dirname(htmlRelPath), assetRelPath);
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function readText(filePath) {
  return fs.readFile(filePath, 'utf8');
}

async function writeText(filePath, content) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, content, 'utf8');
}

async function writeBuffer(filePath, content) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, content);
}

async function minifyTextFile(sourcePath, destPath, extension) {
  const source = await readText(sourcePath);
  const loader = extension === '.css' ? 'css' : 'js';
  const result = await transform(source, {
    charset: 'utf8',
    legalComments: 'none',
    loader,
    minify: true
  });
  await writeText(destPath, result.code);
}

async function copyPlainFile(sourcePath, destPath) {
  await ensureDir(path.dirname(destPath));
  await fs.copyFile(sourcePath, destPath);
}

async function optimizeImageBuffer(sourcePath, sourceBuffer) {
  const relativePath = toPosixPath(path.relative(rootDir, sourcePath));
  const extension = path.extname(sourcePath).toLowerCase();

  if (!optimizableImageExtensions.has(extension)) {
    return sourceBuffer;
  }

  if (relativePath.startsWith('images/thumbs/')) {
    return sourceBuffer;
  }

  if (extension === '.webp') {
    if (sourceBuffer.length < 120 * 1024) {
      return sourceBuffer;
    }

    const optimizedBuffer = await sharp(sourceBuffer)
      .rotate()
      .resize({
        width: 1600,
        height: 1600,
        fit: 'inside',
        withoutEnlargement: true
      })
      .webp({
        quality: 80,
        effort: 6,
        smartSubsample: true
      })
      .toBuffer();

    return optimizedBuffer.length < sourceBuffer.length ? optimizedBuffer : sourceBuffer;
  }

  if (relativePath === 'images/landing/app-preview-tree.png') {
    const optimizedBuffer = await sharp(sourceBuffer)
      .png({
        compressionLevel: 9,
        effort: 10,
        adaptiveFiltering: true
      })
      .toBuffer();

    return optimizedBuffer.length < sourceBuffer.length ? optimizedBuffer : sourceBuffer;
  }

  return sourceBuffer;
}

async function copyImageFile(sourcePath, destPath) {
  const sourceBuffer = await fs.readFile(sourcePath);
  const outputBuffer = await optimizeImageBuffer(sourcePath, sourceBuffer);
  await writeBuffer(destPath, outputBuffer);
}

async function copyDirectory(sourceDir, destDir, transformFile) {
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  await ensureDir(destDir);

  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const destPath = path.join(destDir, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, destPath, transformFile);
      continue;
    }

    if (entry.isFile()) {
      await transformFile(sourcePath, destPath);
    }
  }
}

async function transformStaticAsset(sourcePath, destPath) {
  const extension = path.extname(sourcePath).toLowerCase();

  if (jsExtensions.has(extension)) {
    await minifyTextFile(sourcePath, destPath, extension);
    return;
  }

  if (cssExtensions.has(extension)) {
    await minifyTextFile(sourcePath, destPath, extension);
    return;
  }

  await copyPlainFile(sourcePath, destPath);
}

async function walkFiles(dirPath, predicate) {
  const results = [];
  const entries = await fs.readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      const nested = await walkFiles(fullPath, predicate);
      results.push(...nested);
      continue;
    }

    if (entry.isFile() && (!predicate || predicate(fullPath))) {
      results.push(fullPath);
    }
  }

  return results;
}

function resolveLocalAssetPath(htmlRelPath, assetSrc) {
  const cleanSrc = stripQueryAndHash(assetSrc);
  if (!cleanSrc || isExternalAsset(cleanSrc)) return null;

  if (cleanSrc.startsWith('/')) {
    return path.join(rootDir, cleanSrc.slice(1).replace(/\//g, path.sep));
  }

  return path.resolve(path.dirname(path.join(rootDir, htmlRelPath)), cleanSrc.replace(/\//g, path.sep));
}

function extractLocalScriptPaths(htmlRelPath, htmlContent) {
  const scriptRelPaths = [];
  let match;

  while ((match = localScriptTagPattern.exec(htmlContent)) !== null) {
    const src = match[3];
    const assetPath = resolveLocalAssetPath(htmlRelPath, src);
    if (!assetPath) continue;
    scriptRelPaths.push(toPosixPath(path.relative(rootDir, assetPath)));
  }

  return scriptRelPaths;
}

async function buildVendorCode(entryPath) {
  const result = await esbuildBuild({
    entryPoints: [entryPath],
    bundle: true,
    charset: 'utf8',
    legalComments: 'none',
    minify: true,
    platform: 'browser',
    target: ['es2020'],
    write: false,
    format: 'iife'
  });

  return result.outputFiles[0].text;
}

async function collectUsedIconNames() {
  const icons = new Set(extraIconNames);
  const htmlFiles = rootHtmlFiles.map((fileName) => path.join(rootDir, fileName));
  const pageFiles = await walkFiles(path.join(rootDir, pageDir), (filePath) => filePath.endsWith('.html'));
  const scriptFiles = await walkFiles(path.join(rootDir, 'scripts'), (filePath) => filePath.endsWith('.js'));
  const files = htmlFiles.concat(pageFiles, scriptFiles);

  for (const filePath of files) {
    const source = await readText(filePath);
    let match;
    while ((match = materialIconSpanPattern.exec(source)) !== null) {
      const iconName = sanitizeIconName(match[3]);
      if (iconName) {
        icons.add(iconName);
      }
    }
  }

  return Array.from(icons).sort();
}

async function buildIconSpriteMarkup(iconNames) {
  const symbols = [];

  for (const iconName of iconNames) {
    const sourceIconName = iconSourceAliases.get(iconName) || iconName;
    const svgPath = path.join(materialSvgDir, `${sourceIconName}.svg`);
    const svgSource = await readText(svgPath);
    const svgMatch = svgSource.match(/<svg[^>]*viewBox="([^"]+)"[^>]*>([\s\S]*?)<\/svg>/i);
    if (!svgMatch) {
      throw new Error(`Could not parse Material icon SVG for "${iconName}".`);
    }
    symbols.push(
      `<symbol id="icon-${iconName}" viewBox="${svgMatch[1]}">${svgMatch[2]}</symbol>`
    );
  }

  return [
    '<svg class="ancestrio-icon-sprite" aria-hidden="true" focusable="false" width="0" height="0" style="position:absolute;width:0;height:0;overflow:hidden">',
    '<defs>',
    symbols.join(''),
    '</defs>',
    '</svg>'
  ].join('');
}

function renderStaticIconSvg(attributes, iconNameRaw) {
  const iconName = sanitizeIconName(iconNameRaw);
  if (!iconName) return null;

  return `<svg${attributes} viewBox="0 -960 960 960" focusable="false" data-icon-name="${iconName}"><use href="#icon-${iconName}" xlink:href="#icon-${iconName}"></use></svg>`;
}

function rewriteStaticIconMarkup(htmlContent) {
  return htmlContent.replace(materialIconSpanPattern, (match, attributes, _quote, iconNameRaw) => {
    return renderStaticIconSvg(attributes, iconNameRaw) || match;
  });
}

function stripMaterialIconStylesheets(htmlContent) {
  return htmlContent
    .replace(materialIconNoScriptPattern, '')
    .replace(materialIconLinkPattern, '');
}

function rewriteDeferredFontStylesheets(htmlContent) {
  return htmlContent.replace(googleFontLinkPattern, (match) => {
    if (/\bdata-font-opt\b/i.test(match)) {
      return match;
    }

    const baseLink = match
      .replace(/\smedia=(["']).*?\1/gi, '')
      .replace(/\sdata-font-opt\b/gi, '')
      .replace(/\s*>\s*$/, '>');
    const deferredLink = baseLink.replace(/>$/, ' media="print" data-font-opt>');

    return `${deferredLink}\n  <noscript>${baseLink}</noscript>\n`;
  });
}

function stripUnusedPreconnects(htmlContent, options = {}) {
  let output = htmlContent.replace(gstaticPreconnectPattern, '');
  if (!options.keepJsDelivr) {
    output = output.replace(jsdelivrPreconnectPattern, '');
  }
  return output;
}

function inlineThemeInit(htmlContent, themeInitSource) {
  return htmlContent.replace(
    /<script\b[^>]*src=(["'])[^"']*theme-init\.js(?:\?[^"']*)?\1[^>]*><\/script>/i,
    `<script>${escapeInlineScript(themeInitSource)}</script>`
  );
}

function stripExternalVendorScripts(htmlContent, options = {}) {
  let output = htmlContent;

  if (options.stripFirebase) {
    output = output.replace(firebaseCompatScriptPattern, '');
  }
  if (options.stripD3) {
    output = output.replace(d3CdnScriptPattern, '');
  }
  if (options.stripTopojson) {
    output = output.replace(topojsonCdnScriptPattern, '');
  }

  return output;
}

function removeLocalScriptTags(htmlRelPath, htmlContent) {
  return htmlContent.replace(localScriptTagPattern, (match, before, quote, src, after) => {
    const assetPath = resolveLocalAssetPath(htmlRelPath, src);
    if (!assetPath) {
      return match;
    }
    return '';
  });
}

function injectSpriteAndAmbient(htmlContent, spriteMarkup, ambientBundleRef) {
  return htmlContent.replace(/<body([^>]*)>/i, (match, attributes) => {
    const ambientAttribute = ambientBundleRef
      ? ` data-ambient-bundle="${escapeHtmlAttribute(ambientBundleRef)}"`
      : '';
    return `<body${attributes}${ambientAttribute}>${spriteMarkup}`;
  });
}

function injectPageBundle(htmlContent, bundleRef) {
  const bundleTag = `  <script defer src="${bundleRef}"></script>\n`;
  return htmlContent.replace(/<\/body>/i, `${bundleTag}</body>`);
}

function buildBundleManifest(scriptRelPaths, pageHasAmbient) {
  const filtered = [];
  let insertedRuntimeExtras = false;

  for (const scriptRelPath of scriptRelPaths) {
    if (isThemeInitScript(scriptRelPath) || isAmbientScript(scriptRelPath)) {
      continue;
    }

    filtered.push(scriptRelPath);

    if (!insertedRuntimeExtras && scriptRelPath === 'scripts/runtime.js') {
      filtered.push('scripts/icon-runtime.js');
      if (pageHasAmbient) {
        filtered.push('scripts/ambient-loader.js');
      }
      insertedRuntimeExtras = true;
    }
  }

  if (!filtered.includes('scripts/icon-runtime.js')) {
    filtered.unshift('scripts/icon-runtime.js');
  }

  if (pageHasAmbient && !filtered.includes('scripts/ambient-loader.js')) {
    filtered.splice(1, 0, 'scripts/ambient-loader.js');
  }

  return filtered;
}

async function buildPageBundle(scriptRelPaths, options) {
  const parts = [];

  if (options.needsFirebase) {
    parts.push(options.firebaseVendorCode);
  }

  if (options.needsD3) {
    parts.push(options.d3VendorCode);
  }

  for (const scriptRelPath of scriptRelPaths) {
    const source = await readText(path.join(rootDir, scriptRelPath));
    parts.push(source);
  }

  const result = await transform(parts.join('\n;\n'), {
    charset: 'utf8',
    legalComments: 'none',
    loader: 'js',
    minify: true
  });

  return result.code;
}

async function writePageBundle(htmlRelPath, bundleSource) {
  const bundleRelPath = path.posix.join('assets', `${pageKeyForHtml(htmlRelPath)}.js`);
  await writeText(path.join(distDir, bundleRelPath), bundleSource);
  return bundleRelPath;
}

async function writeAmbientBundle() {
  const sources = await Promise.all(ambientSourceFiles.map(readText));
  const result = await transform(sources.join('\n;\n'), {
    charset: 'utf8',
    legalComments: 'none',
    loader: 'js',
    minify: true
  });
  const ambientRelPath = path.posix.join('assets', 'ambient.js');
  await writeText(path.join(distDir, ambientRelPath), result.code);
  return ambientRelPath;
}

async function buildHtmlPage(htmlRelPath, options) {
  const sourcePath = path.join(rootDir, htmlRelPath);
  const htmlSource = await readText(sourcePath);
  const scriptRelPaths = extractLocalScriptPaths(htmlRelPath, htmlSource);
  const pageHasAmbient = pageHasAmbientOptIn(htmlSource);
  const bundleManifest = buildBundleManifest(scriptRelPaths, pageHasAmbient);

  const bundleSource = await buildPageBundle(bundleManifest, {
    d3VendorCode: options.d3VendorCode,
    firebaseVendorCode: options.firebaseVendorCode,
    needsD3: pageNeedsD3(bundleManifest),
    needsFirebase: pageNeedsFirebase(bundleManifest)
  });

  const bundleRelPath = await writePageBundle(htmlRelPath, bundleSource);
  const bundleRef = relativeRefFromHtml(htmlRelPath, bundleRelPath);
  const ambientRef = pageHasAmbient
    ? relativeRefFromHtml(htmlRelPath, options.ambientBundleRelPath)
    : '';
  const keepJsDelivrPreconnect = pageNeedsRemoteWorldAtlas(bundleManifest);

  let htmlOutput = htmlSource;
  htmlOutput = rewriteDeferredFontStylesheets(htmlOutput);
  htmlOutput = stripMaterialIconStylesheets(htmlOutput);
  htmlOutput = stripUnusedPreconnects(htmlOutput, {
    keepJsDelivr: keepJsDelivrPreconnect
  });
  htmlOutput = stripExternalVendorScripts(htmlOutput, {
    stripFirebase: pageNeedsFirebase(bundleManifest),
    stripD3: pageNeedsD3(bundleManifest),
    stripTopojson: pageNeedsD3(bundleManifest)
  });
  htmlOutput = inlineThemeInit(htmlOutput, options.themeInitSource);
  htmlOutput = removeLocalScriptTags(htmlRelPath, htmlOutput);
  htmlOutput = rewriteStaticIconMarkup(htmlOutput);
  htmlOutput = injectSpriteAndAmbient(htmlOutput, options.iconSpriteMarkup, ambientRef);
  htmlOutput = injectPageBundle(htmlOutput, bundleRef);

  await writeText(path.join(distDir, htmlRelPath), htmlOutput);
}

async function build() {
  await fs.rm(distDir, { recursive: true, force: true });
  await ensureDir(distDir);
  await ensureDir(assetDir);

  const [themeInitSource, firebaseVendorCode, d3VendorCode, iconNames] = await Promise.all([
    readText(themeInitPath),
    buildVendorCode(firebaseBridgeEntry),
    buildVendorCode(d3BridgeEntry),
    collectUsedIconNames()
  ]);

  const iconSpriteMarkup = await buildIconSpriteMarkup(iconNames);
  const ambientBundleRelPath = await writeAmbientBundle();

  for (const fileName of rootStaticFiles) {
    await transformStaticAsset(
      path.join(rootDir, fileName),
      path.join(distDir, fileName)
    );
  }

  for (const dirName of copyDirs) {
    await copyDirectory(
      path.join(rootDir, dirName),
      path.join(distDir, dirName),
      transformStaticAsset
    );
  }

  await copyDirectory(
    path.join(rootDir, imageDir),
    path.join(distDir, imageDir),
    copyImageFile
  );

  for (const htmlFile of rootHtmlFiles) {
    await buildHtmlPage(htmlFile, {
      ambientBundleRelPath,
      d3VendorCode,
      firebaseVendorCode,
      iconSpriteMarkup,
      themeInitSource
    });
  }

  const pageFiles = await walkFiles(path.join(rootDir, pageDir), (filePath) => filePath.endsWith('.html'));
  for (const pageFile of pageFiles) {
    const htmlRelPath = toPosixPath(path.relative(rootDir, pageFile));
    await buildHtmlPage(htmlRelPath, {
      ambientBundleRelPath,
      d3VendorCode,
      firebaseVendorCode,
      iconSpriteMarkup,
      themeInitSource
    });
  }
}

build().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
