const { chromium, firefox } = require('playwright');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const { PDFDocument } = require('pdf-lib');

const OCR_API = "https://tata-ocs.duckdns.org/v1/solve";
const BASE_URL = "https://sarathi.parivahan.gov.in/sarathiservice";
const CAPTCHA_RULES = [
    { src: "#capimg1", tgt: "#entcaptxt1" },
    { src: "#capimg", tgt: "#captxt1" },
    { src: "#capimg", tgt: "#entCaptha" },
    { src: "#capimg", tgt: "#entcaptxt" },
    { src: "#captchaImg", tgt: "#captcha" },
    { src: "#captchaImg", tgt: "#captchatext" },
    { src: "#capimg", tgt: "input[name='captxt']" },
    { src: "img[src*='captchaimage.jsp']", tgt: "input[name='captxt']" },
];

async function solveOcr(imageBytes) {
    const b64Img = imageBytes.toString('base64');
    try {
        const res = await axios.post(
            OCR_API,
            {
                type: "image",
                provider: "image_ocr",
                payload_base64: b64Img,
                mode: "accurate",
                domain: "sarathi.parivahan.gov.in",
            },
            {
                headers: { "x-api-key": process.env.SARATHI_API_KEY || "sk-pJgH9MuRXU0ARtjgkeiNhztCrlqSFMSn4LerY06hhB4" },
                timeout: 15000,
            }
        );
        const data = res.data;
        const solved = data.result || data.text || "";
        return String(solved).trim();
    } catch (e) {
        return "";
    }
}

async function smartSolveCaptcha(page, stepName) {
    console.log(`[${stepName}] Solving CAPTCHA...`);
    await page.waitForTimeout(1000);

    for (const rule of CAPTCHA_RULES) {
        const tgtLoc = page.locator(rule.tgt);
        const srcLoc = page.locator(rule.src);

        if (await tgtLoc.isVisible()) {
            await tgtLoc.click();
            await tgtLoc.fill("");

            await srcLoc.waitFor({ state: "visible", timeout: 5000 });
            await page.waitForTimeout(1000);

            const imgBytes = await srcLoc.screenshot();
            const solvedText = await solveOcr(imgBytes);

            if (!solvedText) {
                console.log("    -> ❌ OCR failed to read UI Captcha.");
                return false;
            }

            console.log(`    -> ✅ Solved: ${solvedText}`);

            await tgtLoc.pressSequentially(solvedText, { delay: 100 });
            await tgtLoc.press("Tab");
            await page.mouse.click(0, 0);

            return true;
        }
    }
    return false;
}

async function startLLPrintFlow(appNum, dob, mobile) {
    console.log("🚀 Starting LL Print Flow...");

    // No persistent profile or firefox lock!
    // Each session gets a new browser context (no lock on disk).
    let browser, context;
    try {
        browser = await firefox.launch({
            headless: true,
        });

        context = await browser.newContext({
            acceptDownloads: true,
            userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0"
            // No profile path: use blank/ephemeral profile per context
        });

        const page = await context.newPage();

        await page.goto(`${BASE_URL}/stateSelection.do`);

        try {
            await page.getByLabel("Close").click({ timeout: 2000 });
        } catch (e) { }

        console.log(" Selecting State...");
        await Promise.all([
            page.waitForNavigation(),
            page.locator("#stfNameId").selectOption("MH")
        ]);

        try {
            await page.getByRole("button", { name: "x" }).click({ timeout: 2000 });
        } catch (e) { }

        console.log(" Navigating to DL Search...");
        await page.getByRole("link", { name: "Learner Licence", exact: true }).click();
        await page.getByRole("link", { name: "Others", exact: true }).click();
        await page.getByRole("link", { name: "Others", exact: true }).click();
        await page.getByRole("link", { name: "DL Search" }).click();

        console.log("\n Triggering OTP...");
        let otpTriggered = false;

        while (!otpTriggered) {
            const mobileField = page.locator("#mobileNumber");
            await mobileField.click();
            await mobileField.fill("");
            await mobileField.pressSequentially(mobile, { delay: 50 });

            await smartSolveCaptcha(page, "Tab 1: SMS");

            const btn = page.locator("#generateSarathiotp");
            await page.waitForTimeout(1500);

            if (await btn.isDisabled()) {
                await page.evaluate("document.getElementById('generateSarathiotp').removeAttribute('disabled')");
            }

            await btn.click();
            await page.waitForTimeout(2000);

            if (await page.locator("#otpNumberSarathi").isVisible()) {
                otpTriggered = true;
            } else {
                await page.getByRole("img", { name: "Click Here to Refresh Captcha" }).click();
                await page.waitForTimeout(1000);
            }
        }

        // Return context, page, and browser for clean closing
        return { context, page, browser };
    } catch (error) {
        console.error("❌ Error in startLLPrintFlow:", error);
        if (context) {
            await context.close().catch(() => {});
        }
        if (browser) {
            await browser.close().catch(() => {});
        }
        throw error;
    }
}

async function submitLLPrintOTP(context, page, otpCode, appNum, dob) {
    let downloadSuccess = false;
    let outputPath = path.join(process.cwd(), `LL_${appNum}.pdf`);

    try {
        console.log("\n Priming Print Data via Background Fetch...");

        const timestamp = Date.now();
        const captchaResp = await page.request.get(`${BASE_URL}/jsp/common/captchaimage.jsp?${timestamp}`, {
            headers: {
                "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
                "Referer": `${BASE_URL}/dlSearch.do`,
                "Sec-Fetch-Dest": "image",
                "Sec-Fetch-Mode": "no-cors",
                "Sec-Fetch-Site": "same-origin",
            }
        });

        const primeCaptchaBytes = await captchaResp.body();
        const primeCaptchaText = await solveOcr(primeCaptchaBytes);

        if (!primeCaptchaText) {
            console.log("    -> ❌ OCR failed on Background Captcha. Exiting.");
            await context.close();
            throw new Error("OCR failed on Background Captcha");
        }

        console.log(`    -> ✅ Background CAPTCHA Solved: ${primeCaptchaText}`);

        const fetchJs = `
            fetch("${BASE_URL}/sendOtp.do", {
                "headers": {
                    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "content-type": "application/x-www-form-urlencoded",
                    "pragma": "no-cache"
                },
                "referrer": "${BASE_URL}/printlearerslicence.do",
                "body": "listwise=1&applNum=${appNum}&hiddenOtp=&licNum=&mobileNum=&dateOfBirth=${dob}&captxt=${primeCaptchaText}&newll.submit=Submit",
                "method": "POST",
                "mode": "cors",
                "credentials": "include"
            }).then(response => response.status);
        `;

        const fetchStatus = await page.evaluate(fetchJs);
        console.log(`    -> Priming Fetch executed. Server returned HTTP ${fetchStatus}`);

        console.log("\n Final eKYC Authentication...");

        await page.getByRole("img", { name: "Click Here to Refresh Captcha" }).click();
        await page.waitForTimeout(1500);

        await page.locator("#otpNumberSarathi").fill(otpCode);
        await smartSolveCaptcha(page, "Tab 1: Final Auth");
        await page.locator("#otpCheckbox").check();

        console.log("    -> Clicking 'Submit OTP'...");
        await page.getByRole("button", { name: "Submit OTP" }).click();

        console.log("\n Launching Final PDF Download...");
        
        const pdfResponses = [];
        context.on("response", response => {
            const contentType = (response.headers()["content-type"] || "").toLowerCase();
            if (contentType.includes("application/pdf")) {
                pdfResponses.push(response);
            }
        });

        const finalSubmitBtn = page.locator("#otpsubmit");
        try {
            await finalSubmitBtn.waitFor({ state: "visible", timeout: 50000 });
        } catch (waitErr) {
            console.log("    -> ❌ Timeout waiting for #otpsubmit. Checking for page errors...");
            const errorMsgLoc = page.locator(".alert-danger, #errorMessages, .error-message, span[style*='color: red']").first();
            let errText = "Unknown error (likely incorrect OTP or Captcha).";
            if (await errorMsgLoc.isVisible().catch(() => false)) {
                errText = await errorMsgLoc.textContent();
            }
            // Save a debug screenshot
            await page.screenshot({ path: `debug_llprint_${appNum}.png`, fullPage: true }).catch(() => {});
            throw new Error(`Failed to reach final submit button. Server says: ${errText.trim()}`);
        }

        try {
            const [download] = await Promise.all([
                page.waitForEvent('download', { timeout: 20000 }).catch(() => null),
                finalSubmitBtn.click()
            ]);

            if (download) {
                console.log("    -> ✅ Download event captured!");
                await download.saveAs(outputPath);
                downloadSuccess = true;
            }
        } catch (e) {
            console.log(`    -> Info: Download event failed or timed out (${e}). Trying fallbacks...`);
        }

        if (!downloadSuccess && pdfResponses.length > 0) {
            console.log(`    -> Found ${pdfResponses.length} PDF responses. Saving first one...`);
            try {
                const pdfBytes = await pdfResponses[0].body();
                fs.writeFileSync(outputPath, pdfBytes);
                console.log("    -> ✅ PDF captured from response body!");
                downloadSuccess = true;
            } catch (re) {
                console.log(`    -> Failed to read response body: ${re}`);
            }
        }

        if (!downloadSuccess) {
            const allPages = context.pages();
            if (allPages.length > 1) {
                const lastPage = allPages[allPages.length - 1];
                console.log(`    -> Trying direct request for last page URL: ${lastPage.url()}`);
                try {
                    const resp = await context.request.get(lastPage.url());
                    if (resp.status() === 200 && (resp.headers()["content-type"] || "").toLowerCase().includes("application/pdf")) {
                        const pdfBytes = await resp.body();
                        fs.writeFileSync(outputPath, pdfBytes);
                        console.log("    -> ✅ Direct download successful from page URL!");
                        downloadSuccess = true;
                    }
                } catch (ue) {
                    console.log(`    -> Direct request failed: ${ue}`);
                }
            }
        }

        if (downloadSuccess) {
            console.log(`🎉 PDF downloaded. Now cropping and stacking multiple pages...`);
            
            // Post-process the PDF to crop and stack LLs
            try {
                const pdfBytes = fs.readFileSync(outputPath);
                const pdfDoc = await PDFDocument.load(pdfBytes);
                const pages = pdfDoc.getPages();
                
                const mergedDoc = await PDFDocument.create();
                const A4_WIDTH = 595.28;
                const A4_HEIGHT = 841.89;
                
                const pageTopMargin = 20;
                const firstPageTopTrim = 45;
                const otherPagesTopTrim = 45;
                const cropHeight = 185;
                const gap = 0;
                
                let currentPage = mergedDoc.addPage([A4_WIDTH, A4_HEIGHT]);
                let currentY = A4_HEIGHT - pageTopMargin;
                
                for (let i = 0; i < pages.length; i++) {
                    const origPage = pages[i];
                    const { width, height } = origPage.getSize();
                    
                    const topTrim = i === 0 ? firstPageTopTrim : otherPagesTopTrim;
                    const cropTop = height - topTrim;
                    const cropBottom = cropTop - cropHeight;
                    
                    const boundingBox = {
                        left: 0,
                        bottom: cropBottom,
                        right: width,
                        top: cropTop,
                    };
                    
                    const [embeddedCroppedPage] = await mergedDoc.embedPages([origPage], [boundingBox]);
                    
                    if (currentY - cropHeight < 0) {
                        currentPage = mergedDoc.addPage([A4_WIDTH, A4_HEIGHT]);
                        currentY = A4_HEIGHT - pageTopMargin;
                    }
                    
                    currentY -= cropHeight;
                    
                    currentPage.drawPage(embeddedCroppedPage, {
                        x: 0,
                        y: currentY,
                        width: width,
                        height: cropHeight,
                    });
                    
                    currentY -= gap;
                }
                
                const mergedBytes = await mergedDoc.save();
                fs.writeFileSync(outputPath, mergedBytes);
                console.log(`🎉 MISSION ACCOMPLISHED! Cropped PDF saved as ${outputPath}`);
            } catch (cropErr) {
                console.log(`❌ Cropping failed, falling back to original PDF: ${cropErr}`);
            }

            return outputPath;
        } else {
            throw new Error("All PDF download strategies failed.");
        }
    } catch (e) {
        console.log(`❌ Critical error during final download: ${e}`);
        throw e;
    } finally {
        await page.waitForTimeout(3000);
        await context.close();
        if (context.browser) {
            await context.browser().close().catch(() => {});
        }
    }
}

module.exports = {
    startLLPrintFlow,
    submitLLPrintOTP
};
