const fs = require('fs/promises');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { assertLayoutAudit, collectLayoutAudit } = require('./visual/layout-audit');

const FIXED_NOW = '2026-03-02T12:00:00.000Z';
const AUDIT_ROOT = path.resolve(__dirname, '..', 'visual-audit');
const VISUAL_TEST_LOGIN_IDENTIFIER = process.env.VISUAL_TEST_LOGIN_IDENTIFIER || process.env.VISUAL_TEST_EMAIL || '';
const VISUAL_TEST_PASSWORD = process.env.VISUAL_TEST_PASSWORD || '';
const HAS_VISUAL_AUTH = Boolean(VISUAL_TEST_LOGIN_IDENTIFIER && VISUAL_TEST_PASSWORD);

const viewports = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 1024, height: 1366 },
  { name: 'desktop', width: 1440, height: 1200 }
];

const pages = [
  {
    name: 'landing',
    path: '/index.html',
    readySelector: '.landing-hero',
    alignmentScopes: ['.site-header__inner', '.landing-hero-cta', '.landing-metrics', '.product-cards', '.feature-grid'],
    edgeAlignmentChecks: [
      {
        selectorA: '.landing-hero-copy',
        selectorB: '.landing-hero-stage .hero-stage-card--keepsake',
        edge: 'bottom',
        tolerance: 16,
        minViewportWidth: 1081,
        description: 'The landing hero copy panel and the final hero stage card should share the same bottom edge on wide layouts'
      }
    ],
    overlapScopes: ['.site-header__inner', '.landing-hero', '.product-cards', '.feature-grid', '.site-footer__inner']
  },
  {
    name: 'demo-tree',
    path: '/pages/demo-tree.html',
    readySelector: '#tree .person',
    alignmentScopes: ['.topbar.app-header', '.brand-group', '.controls-tree', '.tw-toggle'],
    overlapScopes: ['.topbar.app-header', '.controls-tree', '.tw-toggle'],
    stabilize: async (page) => {
      await expect.poll(async () => page.locator('#tree .person').count(), {
        message: 'Expected the demo tree to render at least 6 person nodes.'
      }).toBeGreaterThan(5);
    }
  },
  {
    name: 'tree-viewer',
    path: '/pages/tree.html',
    readySelector: '#tree .person',
    alignmentScopes: ['.topbar.app-header', '.brand-group', '.controls-tree', '.tw-toggle'],
    overlapScopes: ['.topbar.app-header', '.controls-tree', '.tw-toggle'],
    stabilize: async (page) => {
      await expect.poll(async () => page.locator('#tree .person').count(), {
        message: 'Expected the shared tree viewer to render at least 6 person nodes.'
      }).toBeGreaterThan(5);
    }
  },
  {
    name: 'store',
    path: '/pages/store.html?product=paper-print&source=visual-test&view=tree',
    readySelector: '.product-grid',
    alignmentScopes: ['.site-header__inner', '.store-hero', '.store-confidence', '.product-grid', '.store-hero-actions'],
    overlapScopes: ['.site-header__inner', '.store-hero', '.product-grid', '.store-confidence', '.site-footer__inner'],
    stabilize: async (page) => {
      await expect(page.locator('.product-price').first()).not.toHaveText('');
    }
  },
  {
    name: 'contact',
    path: '/pages/contact.html',
    readySelector: '.contact-grid',
    alignmentScopes: ['.site-header__inner', '.contact-grid', '.contact-methods', '.support-strip'],
    overlapScopes: ['.site-header__inner', '.contact-grid', '.support-strip', '.site-footer__inner']
  },
  {
    name: 'auth',
    path: '/pages/auth.html',
    readySelector: '.auth-card',
    alignmentScopes: ['.site-header__inner', '.auth-layout', '.auth-story-points', '.signup-row'],
    overlapScopes: ['.site-header__inner', '.auth-layout', '.auth-story-points', '.site-footer__inner']
  }
];

if (HAS_VISUAL_AUTH) {
  pages.push(
    {
      name: 'dashboard',
      path: '/pages/dashboard.html',
      readySelector: '.dashboard-hero',
      alignmentScopes: ['.site-header__inner', '.app-header', '.dashboard-hero', '#treesGrid'],
      edgeAlignmentChecks: [
        {
          selectorA: '.dashboard-hero',
          selectorB: '#treesGrid',
          edge: 'left',
          tolerance: 4,
          description: 'The dashboard hero and tree grid should share the same left edge'
        },
        {
          selectorA: '.dashboard-hero',
          selectorB: '#treesGrid',
          edge: 'right',
          tolerance: 4,
          description: 'The dashboard hero and tree grid should share the same right edge'
        }
      ],
      overlapScopes: ['.site-header__inner', '.app-header', '.dashboard-hero', '#treesGrid'],
      open: async (page) => {
        await loginForVisualAudit(page);
        await page.goto('/pages/dashboard.html', { waitUntil: 'domcontentloaded' });
      },
      stabilize: async (page) => {
        await expect(page.locator('.dashboard-hero')).toBeVisible();
        await expect.poll(async () => page.locator('.tree-card').count(), {
          message: 'Expected at least one tree card on the dashboard.'
        }).toBeGreaterThan(0);
      }
    },
    {
      name: 'editor',
      path: '/pages/editor.html',
      readySelector: '.editor-layout',
      alignmentScopes: ['.site-header__inner', '.app-header', '.editor-tabs', '.visual-toolbar'],
      containmentChecks: [
        {
          containerSelector: '.editor-content',
          subjectSelector: '.visual-canvas',
          edges: ['left', 'right', 'bottom'],
          tolerance: 2,
          minViewportWidth: 1025,
          description: 'The editor canvas should stay fully contained inside the editor content panel on desktop layouts'
        }
      ],
      overlapScopes: ['.site-header__inner', '.app-header', '.editor-layout', '.visual-toolbar'],
      open: async (page) => {
        await loginForVisualAudit(page);
        await openFirstEditableTree(page);
      },
      stabilize: async (page) => {
        await expect(page.locator('.editor-layout')).toBeVisible();
        await expect(page.locator('#treeTitle')).not.toHaveText('Loading...');
        await expect.poll(async () => page.locator('#visualTree .person').count(), {
          message: 'Expected the editor canvas to render at least one person node.'
        }).toBeGreaterThan(0);
      }
    }
  );
}

test.describe.configure({ mode: 'parallel' });

test.beforeEach(async ({ page }) => {
  await page.route('**/widget.prod.min.js*', (route) => route.abort());
  await page.addInitScript(({ fixedNow }) => {
    const OriginalDate = Date;
    const fixedTimestamp = new OriginalDate(fixedNow).valueOf();

    class FixedDate extends OriginalDate {
      constructor(...args) {
        if (args.length === 0) {
          super(fixedTimestamp);
          return;
        }
        super(...args);
      }

      static now() {
        return fixedTimestamp;
      }

      static parse(value) {
        return OriginalDate.parse(value);
      }

      static UTC(...args) {
        return OriginalDate.UTC(...args);
      }
    }

    window.Date = FixedDate;
    window.__ancestrioVisualTest = true;
    window.localStorage.setItem('ancestrio-visual-test', 'true');
    window.localStorage.setItem('ancestrio-consent-optional', 'rejected');
    window.localStorage.setItem('tree-theme', 'light');
  }, { fixedNow: FIXED_NOW });
});

for (const viewport of viewports) {
  test.describe(`${viewport.name} viewport`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const pageConfig of pages) {
      test(`${pageConfig.name} has a stable layout`, async ({ page }, testInfo) => {
        if (pageConfig.open) {
          await pageConfig.open(page);
        } else {
          await page.goto(pageConfig.path, { waitUntil: 'domcontentloaded' });
        }

        await page.locator(pageConfig.readySelector).first().waitFor({ state: 'visible', timeout: 20_000 });

        if (pageConfig.stabilize) {
          await pageConfig.stabilize(page);
        }

        await waitForFonts(page);
        await warmLazyContent(page);
        await hideNoisyUi(page);
        await waitForVisualSettle(page);

        const auditResult = await collectLayoutAudit(page, {
          alignmentScopes: pageConfig.alignmentScopes,
          containmentChecks: pageConfig.containmentChecks,
          edgeAlignmentChecks: pageConfig.edgeAlignmentChecks,
          ignoreSelectors: ['.day-clouds', '.night-sky', '#cookie-buddy-panel', '#cookie-buddy-launcher', '#bmc-wbtn', '#ancestrio-toast-region'],
          overlapScopes: pageConfig.overlapScopes
        });

        const auditPaths = await writeAuditArtifacts({
          auditResult,
          page,
          pageConfig,
          viewport
        });

        await testInfo.attach('layout-audit', {
          body: JSON.stringify({ ...auditResult, artifacts: auditPaths }, null, 2),
          contentType: 'application/json'
        });

        assertLayoutAudit(auditResult);

        await expect(page).toHaveScreenshot(`${pageConfig.name}-${viewport.name}.png`, {
          animations: 'disabled',
          caret: 'hide',
          fullPage: true,
          scale: 'css'
        });
      });
    }
  });
}

async function warmLazyContent(page) {
  const totalHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  const step = Math.max(480, Math.floor((await page.viewportSize()).height * 0.75));

  for (let offset = 0; offset < totalHeight; offset += step) {
    await page.evaluate((y) => window.scrollTo(0, y), offset);
    await page.waitForTimeout(60);
  }

  await page.evaluate(() => window.scrollTo(0, 0));
}

async function hideNoisyUi(page) {
  await page.addStyleTag({
    content: `
      *,
      *::before,
      *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
        scroll-behavior: auto !important;
      }

      #cookie-buddy-launcher,
      #cookie-buddy-panel,
      #bmc-wbtn,
      .day-clouds,
      .night-sky,
      #ancestrio-toast-region {
        display: none !important;
      }
    `
  });
}

async function waitForFonts(page) {
  await page.evaluate(async () => {
    if (!document.fonts || typeof document.fonts.ready?.then !== 'function') {
      return;
    }
    await document.fonts.ready;
  });
}

async function waitForVisualSettle(page) {
  await page.waitForTimeout(150);
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
}

async function writeAuditArtifacts({ auditResult, page, pageConfig, viewport }) {
  const runDir = path.join(AUDIT_ROOT, `${pageConfig.name}-${viewport.name}`);
  await fs.mkdir(runDir, { recursive: true });

  const screenshotPath = path.join(runDir, 'page.png');
  await page.screenshot({
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
    path: screenshotPath,
    scale: 'css'
  });

  let annotatedScreenshotPath = null;
  if (auditResult.issueCount > 0) {
    annotatedScreenshotPath = path.join(runDir, 'page-annotated.png');
    await highlightAuditIssues(page, auditResult);
    await page.screenshot({
      animations: 'disabled',
      caret: 'hide',
      fullPage: true,
      path: annotatedScreenshotPath,
      scale: 'css'
    });
    await clearAuditHighlights(page);
  }

  const jsonPath = path.join(runDir, 'report.json');
  const markdownPath = path.join(runDir, 'report.md');
  const payload = {
    ...auditResult,
    generatedAt: new Date().toISOString(),
    issuesFound: auditResult.issueCount,
    page: pageConfig.name,
    path: pageConfig.path,
    resolvedUrl: page.url(),
    screenshots: {
      annotated: annotatedScreenshotPath,
      clean: screenshotPath
    },
    viewport: {
      ...auditResult.viewport,
      name: viewport.name
    }
  };

  await fs.writeFile(jsonPath, JSON.stringify(payload, null, 2));
  await fs.writeFile(markdownPath, renderAuditMarkdown(payload));

  return {
    annotatedScreenshotPath,
    jsonPath,
    markdownPath,
    screenshotPath
  };
}

async function highlightAuditIssues(page, auditResult) {
  const markers = [];

  for (const issue of auditResult.overflowIssues) {
    if (issue.selector) {
      markers.push({ selector: issue.selector, type: 'overflow' });
    }
  }

  for (const issue of auditResult.overlapIssues) {
    if (issue.a.selector) {
      markers.push({ selector: issue.a.selector, type: 'overlap' });
    }
    if (issue.b.selector) {
      markers.push({ selector: issue.b.selector, type: 'overlap' });
    }
  }

  for (const issue of auditResult.alignmentIssues) {
    for (const item of issue.items) {
      if (item.selector) {
        markers.push({ selector: item.selector, type: 'alignment' });
      }
    }
  }

  for (const issue of auditResult.edgeAlignmentIssues || []) {
    if (issue.first.selector) {
      markers.push({ selector: issue.first.selector, type: 'alignment' });
    }
    if (issue.second.selector) {
      markers.push({ selector: issue.second.selector, type: 'alignment' });
    }
  }

  for (const issue of auditResult.containmentIssues || []) {
    if (issue.container.selector) {
      markers.push({ selector: issue.container.selector, type: 'alignment' });
    }
    if (issue.subject.selector) {
      markers.push({ selector: issue.subject.selector, type: 'overflow' });
    }
  }

  await page.evaluate((entries) => {
    const styleId = 'visual-audit-highlight-style';
    let style = document.getElementById(styleId);
    if (!style) {
      style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        [data-visual-audit-issue] {
          outline: 3px solid #e11d48 !important;
          outline-offset: 2px !important;
        }

        [data-visual-audit-issue="alignment"] {
          outline-color: #f59e0b !important;
        }

        [data-visual-audit-issue="overflow"] {
          outline-color: #dc2626 !important;
        }

        [data-visual-audit-issue="overlap"] {
          outline-color: #7c3aed !important;
        }
      `;
      document.head.appendChild(style);
    }

    document.querySelectorAll('[data-visual-audit-issue]').forEach((el) => {
      el.removeAttribute('data-visual-audit-issue');
    });

    for (const entry of entries) {
      const node = document.querySelector(entry.selector);
      if (node) {
        node.setAttribute('data-visual-audit-issue', entry.type);
      }
    }
  }, markers);
}

async function clearAuditHighlights(page) {
  await page.evaluate(() => {
    document.querySelectorAll('[data-visual-audit-issue]').forEach((el) => {
      el.removeAttribute('data-visual-audit-issue');
    });
  });
}

function renderAuditMarkdown(payload) {
  const lines = [
    `# Visual Audit: ${payload.page} (${payload.viewport.name})`,
    '',
    `- URL: \`${payload.path}\``,
    `- Resolved URL: \`${payload.resolvedUrl}\``,
    `- Viewport: \`${payload.viewport.width}x${payload.viewport.height}\``,
    `- Issues found: \`${payload.issuesFound}\``,
    `- Screenshot: \`${payload.screenshots.clean}\``
  ];

  if (payload.screenshots.annotated) {
    lines.push(`- Annotated screenshot: \`${payload.screenshots.annotated}\``);
  }

  lines.push('');
  lines.push('## Overflow');
  lines.push(...formatIssueLines(payload.overflowIssues, (issue) => `${issue.element}: ${issue.reason}`));
  lines.push('');
  lines.push('## Overlap');
  lines.push(...formatIssueLines(payload.overlapIssues, (issue) => `${issue.scope}: ${issue.a.element} overlaps ${issue.b.element}`));
  lines.push('');
  lines.push('## Alignment');
  lines.push(...formatIssueLines(payload.alignmentIssues, (issue) => `${issue.scope}: row center spread ${issue.centerSpread}px across ${issue.items.map((item) => item.element).join(', ')}`));
  lines.push(...formatIssueLines(payload.edgeAlignmentIssues || [], (issue) => `${issue.expected} (${issue.first.element} vs ${issue.second.element}, delta ${issue.delta}px)`));
  lines.push('');
  lines.push('## Containment');
  lines.push(...formatIssueLines(payload.containmentIssues || [], (issue) => `${issue.expected} (${issue.subject.element} vs ${issue.container.element}, delta ${issue.delta}px)`));
  lines.push('');

  return `${lines.join('\n')}\n`;
}

function formatIssueLines(issues, renderIssue) {
  if (!issues.length) {
    return ['- None'];
  }

  return issues.map((issue) => `- ${renderIssue(issue)}`);
}

async function loginForVisualAudit(page) {
  await page.goto('/pages/auth.html', { waitUntil: 'domcontentloaded' });
  await page.fill('#loginIdentifier', VISUAL_TEST_LOGIN_IDENTIFIER);
  await page.fill('#loginPassword', VISUAL_TEST_PASSWORD);
  await page.locator('#loginForm button[type="submit"]').click();

  await expect.poll(() => page.url(), {
    message: 'Expected the local visual audit login to land on the dashboard.'
  }).toContain('/pages/dashboard.html');
}

async function openFirstEditableTree(page) {
  await page.goto('/pages/dashboard.html', { waitUntil: 'domcontentloaded' });
  await expect.poll(async () => page.locator('[data-action="edit-tree"]').count(), {
    message: 'Expected at least one editable tree on the dashboard before opening the editor.'
  }).toBeGreaterThan(0);

  await page.locator('[data-action="edit-tree"]').first().click();
  await expect.poll(() => page.url(), {
    message: 'Expected the dashboard edit action to open the editor.'
  }).toContain('/pages/editor.html');
}
