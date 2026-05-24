const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const cheerio = require('cheerio');

const CONFIG = require('../config/config');
const { navigateToSarathiHome, smartSolveCaptcha } = require('./sarathiCommon');
const { captureFailureDiagnostics } = require('../utils/failureLogger');

async function fetchAndRenderDLInfo(dlNo, dob) {
    console.log(`[DLInfoService] Starting fetch flow for DL: ${dlNo}, DOB: ${dob}`);

    const headless = CONFIG.PUPPETEER.HEADLESS === 'new' || CONFIG.PUPPETEER.HEADLESS === true;
    const browser = await chromium.launch({ headless });
    const context = await browser.newContext({
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(60000);
    page.setDefaultNavigationTimeout(60000);

    let htmlContent = '';

    try {
        // Step 1: Navigate to Sarathi Home
        await navigateToSarathiHome(page, 'MH');

        // Step 2: Go to DL Renewal section to access DL login page
        console.log("[DLInfoService] Navigating to DL Renewal login page...");
        await page.getByRole('link', { name: 'Apply for Driving Licence Apply for DL Renewal' }).click();
        await page.getByRole('button', { name: 'Continue' }).click();

        // Handle dialog popups (alerts, warnings)
        let lastDialogMessage = null;
        let isFatalError = false;
        page.on('dialog', async dialog => {
            lastDialogMessage = dialog.message();
            console.log(`💬 [DLInfo Dialog] ${dialog.type()}: ${lastDialogMessage}`);
            const lower = lastDialogMessage.toLowerCase();
            if (lower.includes('no details found') || lower.includes('invalid') || lower.includes('wrong') || lower.includes('does not exist') || lower.includes('expired')) {
                isFatalError = true;
            }
            await dialog.dismiss().catch(() => {});
        });

        // Step 3: Enter credentials and login
        let detailsLoaded = false;
        let attempts = 0;

        while (!detailsLoaded && attempts < 5) {
            attempts++;
            console.log(`[DLInfoService] Attempt ${attempts}: Entering credentials...`);

            if (isFatalError) {
                throw new Error(`Portal returned error: ${lastDialogMessage}`);
            }

            const dlInput = page.getByRole('textbox', { name: 'DL number' }).first();
            await dlInput.waitFor({ state: 'visible', timeout: 15000 });
            await dlInput.click();
            await dlInput.focus();
            await dlInput.fill('');
            await dlInput.pressSequentially(dlNo, { delay: 100 });
            await page.waitForTimeout(500);

            const dobInput = page.getByRole('textbox', { name: 'DD-MM-YYYY' }).first();
            await dobInput.waitFor({ state: 'visible', timeout: 5000 });
            await dobInput.click();
            await dobInput.focus();
            await dobInput.fill('');
            await dobInput.pressSequentially(dob, { delay: 100 });
            await page.waitForTimeout(1000);

            // Solve CAPTCHA
            await smartSolveCaptcha(page, `Login Attempt ${attempts}`, 'DLInfo');
            await page.locator('#PrivacyPolicyTermsofService').check().catch(() => {});

            // Click Get details
            const getDetailsBtn = page.getByRole('button', { name: 'Get DL Details' });
            await getDetailsBtn.click();

            console.log("[DLInfoService] Waiting for DL details panel (#dispDLDet)...");
            try {
                // Wait up to 10s for details panel
                await page.locator('#dispDLDet').waitFor({ state: 'visible', timeout: 10000 });
                detailsLoaded = true;
                console.log("[DLInfoService] DL login screen bypassed successfully.");
            } catch (e) {
                if (isFatalError) {
                    throw new Error(`Portal returned error: ${lastDialogMessage}`);
                }
                console.log("[DLInfoService] Failed to load details. Refreshing CAPTCHA...");
                await page.locator("img[src*='captchaimage.jsp']").first().click().catch(() => {});
                await page.waitForTimeout(1000);
            }
        }

        if (!detailsLoaded) {
            throw new Error("Failed to pass initial DL login screen. Please check DL number or DOB.");
        }

        // Step 4: Select YES to load details
        console.log("[DLInfoService] Selecting YES on #dispDLDet to load details...");
        await page.locator('#dispDLDet').selectOption('YES');
        console.log("[DLInfoService] Waiting for details to render...");
        await page.waitForTimeout(3000);

        // Get page HTML content for Cheerio parsing
        htmlContent = await page.content();

    } catch (error) {
        console.error("❌ [DLInfoService] Extraction failed:", error);
        await captureFailureDiagnostics(page, error, { serviceType: 'dlInfoService', dlNo }).catch(() => {});
        throw error;
    } finally {
        await context.close().catch(() => {});
        await browser.close().catch(() => {});
    }

    // Step 5: Cheerio Parsing
    console.log("[DLInfoService] Parsing page content using Cheerio...");
    const $ = cheerio.load(htmlContent);

    // DL Number - use actual input to avoid matching portal examples
    let dlNumber = dlNo.toUpperCase();
    const cleanedDL = dlNumber.replace(/[-\s]/g, '');
    if (/^[A-Z]{2}\d{2}/.test(cleanedDL)) {
        dlNumber = cleanedDL.slice(0, 4) + ' ' + cleanedDL.slice(4);
    }

    // Name
    let name = '';
    $('td, th').each((i, el) => {
        const text = $(el).text().trim().toLowerCase();
        if (text === 'name :' || text === 'name') {
            name = $(el).next('td').text().trim().replace(/\s+/g, ' ');
        }
    });

    // Father Name
    let fatherName = '';
    $('td, th').each((i, el) => {
        const text = $(el).text().trim().toLowerCase();
        if (text.includes("father's name") || text.includes("husband's name")) {
            fatherName = $(el).next('td').text().trim().replace(/\s+/g, ' ');
        }
    });

    // DOB
    let dobVal = dob;
    $('td, th').each((i, el) => {
        const text = $(el).text().trim().toLowerCase();
        if (text.includes("date of birth") || text.includes("dob")) {
            dobVal = $(el).next('td').text().trim().replace(/\s+/g, ' ');
        }
    });

    // Present Address
    let presentAddressLines = [];
    $('td').each((i, el) => {
        const text = $(el).text().trim();
        if (text.startsWith("Present Address")) {
            presentAddressLines.push($(el).next('td').text().trim());
            let nextRow = $(el).parent().next('tr');
            while (nextRow.length > 0) {
                const firstCell = nextRow.find('td').first().text().trim();
                const secondCell = nextRow.find('td').eq(1).text().trim();
                if (firstCell === '' && secondCell !== '') {
                    presentAddressLines.push(secondCell);
                    nextRow = nextRow.next('tr');
                } else {
                    break;
                }
            }
        }
    });
    const presentAddressHtml = presentAddressLines.filter(Boolean).join('<br>\n');
    const permanentAddressHtml = presentAddressHtml; // duplicate

    // Images
    let photoBase64 = '';
    let signBase64 = '';
    $('img').each((i, el) => {
        const src = $(el).attr('src') || '';
        const height = $(el).attr('height') || '';
        if (src.startsWith('data:image')) {
            if (height === '120') {
                photoBase64 = src;
            } else if (height === '40') {
                signBase64 = src;
            }
        }
    });

    // Validity
    // Validity
    let validFromNT = '';
    let validToNT = '';
    const ntText = $('#envaction_dl_nt').parent().next().text().trim();
    if (ntText && ntText.includes('to')) {
        const parts = ntText.split('to').map(p => p.trim());
        validFromNT = parts[0];
        validToNT = parts[1];
    }

    let validFromTR = '';
    let validToTR = '';
    const trText = $('#envaction_dl_tr').parent().next().text().trim();
    if (trText && trText.includes('to')) {
        const parts = trText.split('to').map(p => p.trim());
        validFromTR = parts[0];
        validToTR = parts[1];
    }

    // Date of Issue
    const issueDate = validFromNT || 'Not Available';

    // Issued RTO
    let rto = 'MH02';
    const rtoB = $('b:contains("RTO")').first();
    if (rtoB.length > 0) {
        const rtoText = rtoB.parent().text().replace(/RTO\s*-\s*/i, '').trim().replace(/\s+/g, ' ');
        if (rtoText) {
            rto = rtoText;
        }
    }

    // Parse COVs dynamically from table
    const covMap = {
        "MCWG": "Motor Cycle with Gear(Non Transport)",
        "LMV": "LIGHT MOTOR VEHICLE",
        "LMV-TR": "LIGHT MOTOR VEHICLE (TRANSPORT)",
        "3W-CAB": "Three Wheeler Cab (3W-CAB)",
        "3W-GV": "3 Wheeler Goods Vehicle (3W-GV)",
        "TRANS": "Transport (TRANS)",
        "MCWOG": "Motor cycle without Gear",
        "HMV": "HEAVY MOTOR VEHICLE",
        "HPMV": "HEAVY PASSENGER MOTOR VEHICLE"
    };

    const parsedCovs = [];
    $('tr').each((i, tr) => {
        const cells = [];
        $(tr).find('td').each((j, td) => {
            cells.push($(td).text().trim());
        });
        if (cells.length >= 2) {
            const covCode = cells[0].toUpperCase();
            const hasCov = /\b(MCWG|LMV|MCWOG|TRANS|3W-CAB|3W-GV|LMV-TR|HMV|HPMV)\b/i.test(covCode);
            if (hasCov) {
                let type = 'NT';
                if (['TRANS', 'LMV-TR', '3W-GV', '3W-CAB', 'HMV', 'HPMV'].includes(covCode)) {
                    type = 'TR';
                }
                const date = type === 'TR' ? validFromTR : validFromNT;
                const covName = covMap[covCode] || cells[0];
                parsedCovs.push({ type, name: covName, date });
            }
        }
    });

    let covRowsHtml = '';
    parsedCovs.forEach(c => {
        covRowsHtml += `
        <tr>
            <td><b><input type="text" name="value.split('|')[0]" size="20" readonly="readonly" class="form-control input-sm" value="${c.type}"/></b></td>
            <td><b><input type="text" name="value.split('|')[1]" value="${c.name}" readonly="readonly" size="20" class="form-control input-sm"/></b></td>
            <td><b><input type="text" name="value.split('|')[2]" size="20" class="form-control input-sm" value="${c.date}" readonly="readonly"/></b></td>
        </tr>`;
    });

    // Parse Badge Details dynamically
    let badgeRowsHtml = '';
    let badgeNo = '';
    const badgeLabel = $('#envaction_dl_badge');
    if (badgeLabel.length > 0) {
        const rawVal = badgeLabel.parent().next().text().trim();
        badgeNo = rawVal.replace(/\s+/g, ' ').replace(/\s*\)\s*/g, ') ').trim();
    }

    if (badgeNo) {
        const trCovCodes = [];
        $('tr').each((i, tr) => {
            const cells = [];
            $(tr).find('td').each((j, td) => {
                cells.push($(td).text().trim());
            });
            if (cells.length >= 2) {
                const covCode = cells[0].toUpperCase();
                const hasCov = /\b(MCWG|LMV|MCWOG|TRANS|3W-CAB|3W-GV|LMV-TR|HMV|HPMV)\b/i.test(covCode);
                if (hasCov) {
                    if (['TRANS', 'LMV-TR', '3W-GV', '3W-CAB', 'HMV', 'HPMV'].includes(covCode)) {
                        trCovCodes.push(covCode);
                    }
                }
            }
        });

        // Rule: If badge number starts with A or contains AR, it belongs to 3W category. Otherwise empty.
        let badgeClass = '';
        const coreBadgeNo = badgeNo.replace(/^\d+\)\s*/, '').trim();
        const startsWithA = /^A/i.test(coreBadgeNo);
        const containsAR = /AR/i.test(coreBadgeNo);
        if (startsWithA || containsAR) {
            const parsed3W = trCovCodes.find(code => /3W/i.test(code));
            badgeClass = parsed3W || '3W-CAB';
        } else {
            badgeClass = '';
        }

        const badgeIssueDate = validFromTR || validFromNT || '';

        badgeRowsHtml = `
        <tr>
            <td><b><input type="text" readonly="readonly" class="form-control input-sm" value="${badgeNo}"/></b></td>
            <td><b><input type="text" readonly="readonly" class="form-control input-sm" value="${badgeClass}"/></b></td>
            <td><b><input type="text" readonly="readonly" class="form-control input-sm" value="${badgeIssueDate}"/></b></td>
        </tr>`;
    } else {
        // Fallback: parse Badge Details dynamically from table if present
        const badgeHeader = $('td:contains("Badge Details"), th:contains("Badge Details"), p:contains("Badge Details"), div:contains("Badge Details"), b:contains("Badge Details")').first();
        let targetBadgeTable = null;
        if (badgeHeader.length > 0) {
            targetBadgeTable = badgeHeader.nextAll('table').first();
            if (targetBadgeTable.length === 0) {
                targetBadgeTable = badgeHeader.closest('table');
            }
        } else {
            targetBadgeTable = $('table:has(td:contains("Badge Number"), th:contains("Badge Number"), td:contains("Badge No"), th:contains("Badge No"))').first();
        }

        if (targetBadgeTable && targetBadgeTable.length > 0) {
            targetBadgeTable.find('tr').each((i, tr) => {
                const cells = [];
                $(tr).find('td').each((j, td) => {
                    cells.push($(td).text().trim().replace(/\s+/g, ' '));
                });
                if (cells.length >= 3 && !cells[0].toLowerCase().includes('badge') && cells[0] !== '') {
                    badgeRowsHtml += `
                    <tr>
                        <td><b><input type="text" readonly="readonly" class="form-control input-sm" value="${cells[0]}"/></b></td>
                        <td><b><input type="text" readonly="readonly" class="form-control input-sm" value="${cells[1]}"/></b></td>
                        <td><b><input type="text" readonly="readonly" class="form-control input-sm" value="${cells[2]}"/></b></td>
                    </tr>`;
                }
            });
        }
    }

    if (!badgeRowsHtml) {
        badgeRowsHtml = `
        <tr>
            <td><b><input type="text" readonly="readonly" class="form-control input-sm" value=""/></b></td>
            <td><b><input type="text" readonly="readonly" class="form-control input-sm" value=""/></b></td>
            <td><b><input type="text" readonly="readonly" class="form-control input-sm" value=""/></b></td>
        </tr>`;
    }

    // Make sure we have scraped name and valid dates to prevent empty renders
    if (!name) {
        throw new Error("Unable to extract name details. DL details might be blocked or structured differently.");
    }

    // Step 6: Render A4 Layout
    console.log("[DLInfoService] Generating HTML layout...");
    const templateHtml = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8" />
    <meta name="description" content="" />
    <meta name="keywords" content="" />
    <meta name="author" content="" />
    <meta name="ROBOTS" content="NONE">
    <meta http-equiv="X-UA-Compatible" content="IE=edge" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>DL Search</title>
    
    <link href="https://sarathi.parivahan.gov.in/cdn-sarathi/css/bootstrap/bootstrap-theme.min.css?v=1.0" type="text/css" rel="stylesheet" />
    <link href="https://sarathi.parivahan.gov.in/cdn-sarathi/css/bootstrap/bootstrap.min.css?v=1.0" type="text/css" rel="stylesheet" />
    <link href="https://sarathi.parivahan.gov.in/cdn-sarathi/css/jquery/jquery-ui.min.css?v=1.0" rel="stylesheet" type="text/css" />
    <link href="https://sarathi.parivahan.gov.in/cdn-sarathi/css/sarathi/custom.css?v=1.0" type="text/css" rel="stylesheet" />
    <link href="https://sarathi.parivahan.gov.in/cdn-sarathi/css/sarathi/sarathi_parivahan.css?v=1.0" rel="stylesheet" type="text/css" />
    <link href="https://sarathi.parivahan.gov.in/cdn-sarathi/css/sarathi/sarathi_parivahan_layout.css?v=1.0" type="text/css" rel="stylesheet" />
    <link href="https://sarathi.parivahan.gov.in/cdn-sarathi/css/sarathi/sow4.css?v=1.0" type="text/css" rel="stylesheet" />
    <link href="https://sarathi.parivahan.gov.in/cdn-sarathi/css/fonts/font-awesome.min.css?v=1.0" rel="stylesheet" type="text/css" />
    
    <script type="text/javascript" src="https://sarathi.parivahan.gov.in/cdn-sarathi/js/jquery/jquery.min.js?v=1.0"></script>
    <script type="text/javascript" src="https://sarathi.parivahan.gov.in/cdn-sarathi/js/jquery/jquery-ui.min.js?v=1.0"></script>
    <script type="text/javascript" src="https://sarathi.parivahan.gov.in/cdn-sarathi/js/bootstrap/bootstrap.min.js?v=1.0"></script>
    <script type="text/javascript" src="https://sarathi.parivahan.gov.in/cdn-sarathi/js/modal.js?v=1.0"></script>
    
    <script type="text/javascript">
        var is_s5redirection = false;
        if (navigator.userAgent.match(/IEMobile\\/10\\.0/)) {
            var msViewportStyle = document.createElement("style");
            msViewportStyle.appendChild(document.createTextNode("@-ms-viewport{width:auto!important}"));
            document.getElementsByTagName("head")[0].appendChild(msViewportStyle);
        }
        $(document).ready(function() {
            var windowsize = $(window).width();
            if (windowsize > 1600) { 
                $('#bdheight').css("min-height", 400);
            }
        });
    </script>
</head>
<body>
    <div class="main">
        <div class="container padding0px">
            <div class="header">
                <script type="text/javascript">
                    function myDate(){
                        var d = new Date();
                        document.write(d.getDate() + "-" + (d.getMonth() + 1) + "-" + d.getFullYear());
                    }
                </script>
                <style type="text/css">
                    .font3 {
                        color: #3081c5;
                        text-align: center;
                        padding-right: 10% !important;
                        font-family: Trebuchet MS;
                    }
                    .rtosarathiheader_page {
                        background: #1CA6EF;
                        clear: both;
                        padding: 0px 0px 0px 20px;
                    }
                    .rtologindatetime { margin-top: 15px; color: #ffffff; }
                    @media screen and (max-width: 550px) {
                        .font3size {font-size:1.2em;}
                        .rtologindatetime { margin-top: 8px; }
                    }
                    @media (min-width: 992px) { .col-md-offset-1 { margin-left: 0% !important; } }
                </style>
                <div class="rtosarathiheader_page">
                    <div class="row">
                        <div class="col-md-8 padding0px mb_textcenter text-left">
                            <div class="col-md-7 col-sm-7 col-xs-12">
                            </div>
                        </div>
                        <div class="col-md-4 padding0px rtologindatetime text-center">
                            <div class="col-md-12 padding0px mb_width50p">
                                <div class="col-md-7 padding0px" style="font-size: 12px; color: #ffffff;">
                                    <label class="margin0px" style="color:#000; padding-bottom:12px;">DATE:</label> 
                                    <span id="currdate" style="color:#ffffff;" class="NALOC"><script type="text/javascript">myDate();</script></span> <br>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        
        <div class="width100p">
            <script type="text/javascript">
                function noBack() { window.history.forward(); }
            </script>
            <style type="text/css">
                .blink {
                    animation: blinker 1s step-start infinite;
                    background-color: red;
                    border: 1px;
                    padding: 2px;
                    border-radius: 7px;
                }
                @keyframes blinker { 50% { opacity: 0; } }
            </style>
            
            <div id="bdheight" class="content">
                <div class="panel panel-primary">
                    <div class="panel-heading text-left">
                        <h3 class="panel-title">Details of Driving Licence: ${dlNumber}</h3>
                    </div>
                    <div class="panel-body">
                        <div align="center">
                            <div id="divToPrint">
                                <table width="787" border="2">
                                    <tr>
                                        <td width="785">
                                            <div align="center">
                                                <b style="color: green"> Details of Driving Licence: </b>
                                                <b>${dlNumber}</b>
                                            </div>
                                        </td>
                                    </tr>
                                </table>
                                
                                <table width="787" height="132" border="2">
                                    <tr>
                                        <td width="389" height="101">
                                            <p><b style="color: green">Name: </b><b>${name}</b></p>
                                            <p><b style="color: green">Gender: </b><b>Male</b></p>
                                        </td>
                                        <td width="382">
                                            <img width="100" height="120" src="${photoBase64}" alt="Photo" />
                                            <img width="100" height="40" src="${signBase64}" alt="Signature" />
                                        </td>
                                    </tr>
                                </table>
                                
                                <table width="788" border="2">
                                    <tr>
                                        <td width="778"><b style="color: green">Status:</b></td>
                                        <td width="778"><b>Active</b></td>
                                    </tr>
                                </table>
                                
                                <table width="788" border="2">
                                    <tr>
                                        <td width="150"><b style="color: green">SWD Name:</b></td>
                                        <td width="206"><b>${fatherName} </b></td>
                                        <td width="323"><b style="color: green">Date of Birth:</b> </td>
                                        <td width="190"><b>${dobVal}</b></td>
                                    </tr>
                                </table>
                                
                                <p class="style2">Address:</b></p>
                                <table width="791" border="2">
                                    <tr>
                                        <td width="391"><b style="color: green">Present Address: </b></td>
                                        <td width="382"><b style="color: green">Permanent Address:</b> </td>
                                    </tr>
                                    <tr>
                                        <td height="51">
                                            <b>${presentAddressHtml}</b>
                                        </td>
                                        <td>
                                            <b>${permanentAddressHtml}</b>
                                        </td>
                                    </tr>
                                </table>
                                <br>
                                
                                <table width="792" border="2">
                                    <tr>
                                        <td width="186"><b style="color: green">Date of Issue: </b></td>
                                        <td width="194"><b>${issueDate}</b></td>
                                        <td width="190"><b style="color: green">Issued RTO: </b></td>
                                        <td width="192"><b>${rto}</b></td>
                                    </tr>
                                </table>
                                
                                <p class="style2">DL Validity ::</p>
                                <table width="793" border="2">
                                    <tr>
                                        <td width="140"><b style="color: green">Non Transport: </b></td>
                                        <td width="172"><b style="color: green">From:</b></td>
                                        <td width="139"><b>${validFromNT}</b></td>
                                        <td width="101"><b style="color: green">To:</b></td>
                                        <td width="205"><b>${validToNT}</b></td>
                                    </tr>
                                    <tr>
                                        <td><b style="color: green">Transport:</b></td>
                                        <td><b style="color: green">From:</b></td>
                                        <td><b>${validFromTR}</b></td>
                                        <td><b style="color: green">To:</b></td>
                                        <td><b>${validToTR}</b></td>
                                    </tr>
                                    <tr>
                                        <td><b style="color: green">Hazardous Valid Till: </b></td>
                                        <td><b></b></td>
                                        <td><b style="color: green">Hill Valid Till: </b></td>
                                        <td><b></b></td>
                                        <td>&nbsp;</td>
                                    </tr>
                                </table>
                                
                                <p class="style2">COV Details ::</p>
                                <table width="793" border="2">
                                    <tr>
                                        <td width="258"><b style="color: green">COV Category: </b></td>
                                        <td width="271"><b style="color: green">Class of Vehicle: </b></td>
                                        <td width="240"><b style="color: green">COV Issue Date: </b></td>
                                    </tr>
                                    ${covRowsHtml}
                                </table>
                                
                                <p class="style2">Badge Details:</p>
                                <table width="792" border="2">
                                    <tr>
                                        <td width="203"><b style="color: green">Badge Number:</b> </td>
                                        <td width="286"><b style="color: green">Class of Vehicle: </b></td>
                                        <td width="279"><b style="color: green">Badge Issue Date: </b></td>
                                    </tr>
                                    ${badgeRowsHtml}
                                </table>
                                
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            
        </div>
    </div>
</body>
</html>`;

    // Ensure temp dir exists
    if (!fs.existsSync(CONFIG.TEMP.DIR)) {
        fs.mkdirSync(CONFIG.TEMP.DIR, { recursive: true });
    }

    const cleanDlName = dlNo.replace(/[-\s]/g, '_');
    const tempHtmlPath = path.join(CONFIG.TEMP.DIR, `temp_dl_details_${cleanDlName}_${Date.now()}.html`);
    const finalJpgPath = path.join(CONFIG.TEMP.DIR, `dl_details_${cleanDlName}_${Date.now()}.jpg`);

    fs.writeFileSync(tempHtmlPath, templateHtml, 'utf8');
    console.log(`[DLInfoService] Temporary HTML saved to: ${tempHtmlPath}`);

    // Step 7: Render HTML to A4 size JPEG screenshot using Playwright
    console.log("[DLInfoService] Rendering JPEG screenshot using Playwright...");
    const renderBrowser = await chromium.launch({ headless: true });
    const renderContext = await renderBrowser.newContext();
    const renderPage = await renderContext.newPage();

    try {
        await renderPage.setViewportSize({ width: 842, height: 1191 });
        await renderPage.goto('file:///' + tempHtmlPath.replace(/\\/g, '/'));
        await renderPage.waitForTimeout(1500); // Settle script and styles

        await renderPage.screenshot({
            path: finalJpgPath,
            type: 'jpeg',
            quality: 95,
            fullPage: false
        });

        console.log(`[DLInfoService] Saved A4 formatted JPEG to: ${finalJpgPath}`);

    } finally {
        await renderContext.close().catch(() => {});
        await renderBrowser.close().catch(() => {});
        if (fs.existsSync(tempHtmlPath)) {
            fs.unlinkSync(tempHtmlPath);
        }
    }

    return finalJpgPath;
}

module.exports = {
    fetchAndRenderDLInfo
};
