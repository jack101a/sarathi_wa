const { solveSarathiCaptcha } = require('./sarathiCaptchaSolver');

const BASE_URL = "https://sarathi.parivahan.gov.in/sarathiservice";

const CAPTCHA_RULES = [
    { src: "#capimg", tgt: "#captchaByApplicant" },
    { src: "#capimg1", tgt: "#entcaptxt1" },
    { src: "#capimg", tgt: "#captxt1" },
    { src: "#capimg", tgt: "#entCaptha" },
    { src: "#capimg", tgt: "#entcaptxt" },
    { src: "#captchaImg", tgt: "#captcha" },
    { src: "#captchaImg", tgt: "#captchatext" },
    { src: "#capimg", tgt: "input[name='captxt']" },
    { src: "img[src*='captchaimage.jsp']", tgt: "input[name='captxt']" },
];

/**
 * Handles common navigation to Sarathi portal, state selection, and popup closing.
 * @param {import('playwright').Page} page
 * @param {string} state - 2 letter state code, defaults to 'MH'
 */
async function navigateToSarathiHome(page, state = 'MH') {
    console.log(`[SarathiCommon] Navigating to Sarathi selection page...`);
    await page.goto(`${BASE_URL}/stateSelection.do`);

    try {
        await page.getByLabel('Close').click({ timeout: 3000 });
    } catch (e) {}

    console.log(`[SarathiCommon] Selecting State: ${state}...`);
    await Promise.all([
        page.waitForNavigation(),
        page.locator('#stfNameId').selectOption(state)
    ]);

    try {
        await page.getByRole('button', { name: 'x' }).click({ timeout: 3000 });
    } catch (e) {}

    try {
        const modalClose = page.locator('#contactless_statepopup button[data-dismiss="modal"], #contactless_statepopup .close, button.close, [data-dismiss="modal"]').first();
        if (await modalClose.isVisible()) {
            console.log("[SarathiCommon] Closing contactless state popup modal...");
            await modalClose.click();
            await page.waitForTimeout(1000);
        }
    } catch (e) {}
}

/**
 * Centrally solves captcha for all Sarathi workflow pages.
 * @param {import('playwright').Page} page
 * @param {string} stepName
 * @param {string} serviceName
 * @returns {Promise<boolean>}
 */
async function smartSolveCaptcha(page, stepName, serviceName = 'Sarathi') {
    console.log(`[${serviceName} - ${stepName}] Solving CAPTCHA...`);
    await page.waitForTimeout(1000);

    for (const rule of CAPTCHA_RULES) {
        const tgtLoc = page.locator(rule.tgt).first();
        const srcLoc = page.locator(rule.src).first();

        if (await tgtLoc.isVisible().catch(() => false)) {
            await tgtLoc.click();
            await tgtLoc.fill("");

            await srcLoc.waitFor({ state: "visible", timeout: 5000 });
            await page.waitForTimeout(1000);

            const imgBytes = await srcLoc.screenshot().catch(() => null);
            if (!imgBytes) continue;

            const solvedText = await solveSarathiCaptcha(imgBytes);
            if (!solvedText) {
                console.log(`[${serviceName} - ${stepName}] ❌ OCR failed to read UI Captcha.`);
                continue;
            }

            console.log(`[${serviceName} - ${stepName}] ✅ Solved: ${solvedText}`);

            await tgtLoc.pressSequentially(solvedText, { delay: 100 });
            await tgtLoc.press("Tab");
            await page.mouse.click(0, 0);

            return true;
        }
    }
    return false;
}

module.exports = {
    navigateToSarathiHome,
    smartSolveCaptcha,
    BASE_URL,
    CAPTCHA_RULES
};
