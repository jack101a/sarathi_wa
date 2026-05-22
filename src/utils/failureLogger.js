'use strict';

const fs   = require('fs');
const path = require('path');

const PROJECT_ROOT  = path.resolve(__dirname, '..', '..');
const FAILURES_DIR  = path.join(PROJECT_ROOT, 'data', 'logs', 'failures');

/**
 * Captures a targeted diagnostic bundle when an automation flow fails.
 *
 * Saves two files inside data/logs/failures/<timestamp>_<tag>/:
 *   - screenshot.png   : full-page Playwright screenshot
 *   - diagnostics.json : url, error info, and visible interactive/error DOM elements
 *
 * This function NEVER throws. All errors are swallowed so it can be called
 * safely inside existing catch blocks with .catch(() => {}) or await + catch.
 *
 * @param {import('playwright').Page} page        - Active Playwright page
 * @param {Error}                     error       - The caught error object
 * @param {Object}                    metadata    - Arbitrary key-value context (serviceType, dlNo, etc.)
 * @returns {Promise<{dirPath:string, screenshotPath:string, jsonPath:string}|null>}
 */
async function captureFailureDiagnostics(page, error, metadata = {}) {
    try {
        // ── 1. Create unique directory ──────────────────────────────────────────
        const timestamp  = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19); // 2026-05-23T00-09-51
        const tag        = String(metadata.serviceType || metadata.identifier || 'unknown')
                             .replace(/\s+/g, '_').toUpperCase().slice(0, 30);
        const dirName    = `${timestamp}_${tag}`;
        const dirPath    = path.join(FAILURES_DIR, dirName);

        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }

        // ── 2. Full-page screenshot ─────────────────────────────────────────────
        const screenshotPath = path.join(dirPath, 'screenshot.png');
        await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});

        // ── 3. Current URL ──────────────────────────────────────────────────────
        const pageUrl = await page.url().catch(() => 'unknown');

        // ── 4. Targeted DOM extraction (no full HTML) ───────────────────────────
        // Queries only interactive inputs + visible error/alert containers.
        const domElements = await page.evaluate(() => {
            const SELECTORS = [
                'input', 'select', 'textarea', 'button',
                '.error', '.errText', '.alert', '.warning',
                '#errorDiv', '#errDiv', '[class*="error"]', '[class*="alert"]'
            ].join(', ');

            return Array.from(document.querySelectorAll(SELECTORS))
                .filter(el => el.offsetWidth > 0 && el.offsetHeight > 0) // visible only
                .map(el => {
                    const base = {
                        tag:       el.tagName.toLowerCase(),
                        id:        el.id        || null,
                        name:      el.name      || null,
                        type:      el.type      || null,
                        value:     el.value     || null,
                        innerText: (el.innerText || el.placeholder || '').trim().slice(0, 200) || null,
                        classes:   el.className || null,
                    };

                    // For <select>, capture all option texts
                    if (el.tagName === 'SELECT') {
                        base.options = Array.from(el.options).map(o => ({
                            value: o.value,
                            text:  o.text.trim(),
                        }));
                    }

                    return base;
                })
                .slice(0, 60); // cap at 60 elements to keep the file lean
        }).catch(() => []);

        // ── 5. Error stack — extract only lines referencing project source files ─
        const rawStack    = (error && error.stack) ? String(error.stack) : '';
        const projectLines = rawStack
            .split('\n')
            .filter(line => line.includes('sarathiwa_bot') || line.includes('src/'))
            .map(line => line.trim())
            .slice(0, 10);

        // ── 6. Write diagnostics.json ──────────────────────────────────────────
        const diagnostics = {
            failure_summary: {
                timestamp:      new Date().toISOString(),
                url:            pageUrl,
                ...metadata,
            },
            error_details: {
                message:      (error && error.message) ? error.message : String(error),
                project_stack: projectLines,
            },
            dom_elements: domElements,
        };

        const jsonPath = path.join(dirPath, 'diagnostics.json');
        fs.writeFileSync(jsonPath, JSON.stringify(diagnostics, null, 2), 'utf8');

        console.log(`📁 [FailureLogger] Diagnostics saved → ${dirPath}`);
        return { dirPath, screenshotPath, jsonPath };

    } catch (loggerError) {
        // Logger must never throw — silently swallow any internal failure
        console.error('[FailureLogger] Logger itself failed (non-critical):', loggerError.message);
        return null;
    }
}

module.exports = { captureFailureDiagnostics };
