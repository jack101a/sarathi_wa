const { fetchInfo } = require('../../infoFetcherService');

// Helper to fill a field if it exists and is visible
async function smartFillField(page, selector, value) {
    if (!value) return;
    const loc = page.locator(selector).first();
    if (await loc.isVisible().catch(() => false)) {
        console.log(`[DLDetails] Filling ${selector}`);
        await loc.focus();
        await loc.fill('');
        await loc.pressSequentially(value, { delay: 100 });
        await page.waitForTimeout(200);
    }
}

// Helper for robust selection
async function smartSelect(page, selector, value, label, isStateInjection = false) {
    const loc = page.locator(selector).first();
    if (!(await loc.isVisible().catch(() => false))) return;

    console.log(`[DLDetails] Selecting ${value} for ${selector}`);
    try {
        if (isStateInjection) {
            await page.evaluate((sel) => {
                const el = document.querySelector(sel);
                if (!el) return;
                const options = Array.from(el.options);
                const up = options.find(o => o.textContent.toLowerCase().includes('uttar pradesh'));
                if (up) {
                    up.value = 'MH';
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }, selector);
            
            await loc.selectOption({ value: '-1' }).catch(() => {});
            await page.waitForTimeout(500);
            await loc.selectOption({ label: 'Uttar Pradesh' }).catch(() => {});
        } else {
            await loc.evaluate((el, val) => {
                el.value = val;
                el.dispatchEvent(new Event('change', { bubbles: true }));
            }, value).catch(() => {});
        }

        await page.waitForTimeout(1000);

        if (!isStateInjection && label) {
            await loc.selectOption({ label: label }).catch(() => {
                return loc.selectOption({ label: label.toUpperCase() });
            }).catch(() => {});
        }
    } catch (e) {
        console.log(`[DLDetails] Selection failed for ${selector}:`, e.message);
    }
}

async function handleAddressAndDetails(page, targetAppNo, targetDob, dynamicData = null) {
    console.log("[DLDetails] Checking if full address/details form is present...");
    
    // Check if the form is fully open (e.g., #fname or #presHouseNo is visible)
    const isFormPresent = await page.locator('#fname, #presHouseNo').first().isVisible().catch(() => false);
    if (!isFormPresent) {
        console.log("[DLDetails] Full application form not visible. Checking for dropdowns only (Same RTO case).");
        await fillAddressDropdowns(page);
        return;
    }

    console.log("[DLDetails] Full form detected. Using smart fill logic...");
    let fetchedData = dynamicData;
    if (!fetchedData && targetAppNo && targetDob) {
        fetchedData = await fetchInfo(targetAppNo, targetDob).catch(() => null);
    }

    if (!fetchedData || !fetchedData.NAME) {
        console.log("[DLDetails] No dynamic data available to fill full form. Attempting basic dropdowns.");
        await fillAddressDropdowns(page);
        return;
    }

    const addrKeys = Object.keys(fetchedData.ADDRESS || {}).filter(k => k.startsWith('address'));
    const addressLine1 = fetchedData.ADDRESS.address1 || '';
    const addressLine2 = addrKeys.slice(1).map(k => fetchedData.ADDRESS[k]).filter(Boolean).join(' ') || fetchedData.ADDRESS.address2 || '';

    const dyn = {
        fname: fetchedData.NAME.first_name || '',
        mname: fetchedData.NAME.middle_name || '',
        lname: fetchedData.NAME.last_name || '',
        ffname: fetchedData["FATHER NAME"]?.first_name || '',
        fmname: fetchedData["FATHER NAME"]?.middle_name || '',
        flname: fetchedData["FATHER NAME"]?.last_name || '',
        bg: "O+",
        addressLine1,
        addressLine2,
        pincode: fetchedData.ADDRESS?.pin_code || '',
        fullAddress: Object.values(fetchedData.ADDRESS || {}).join(' ')
    };

    // Fill Personal Details
    await smartFillField(page, '#fname', dyn.fname);
    await smartFillField(page, '#mname', dyn.mname);
    await smartFillField(page, '#lname', dyn.lname);
    await smartFillField(page, '#swdfName', dyn.ffname);
    await smartFillField(page, '#swdmName', dyn.fmname);
    await smartFillField(page, '#swdlName', dyn.flname);
    
    await smartSelect(page, '#bloodGroup', dyn.bg);
    await smartSelect(page, '#presState', 'MH', 'Uttar Pradesh', true);

    // District matching
    const presDistrictLoc = page.locator('#presDistrict');
    if (await presDistrictLoc.isVisible().catch(() => false)) {
        console.log('[DLDetails] Matching District for address:', dyn.fullAddress);
        const districtOptions = await presDistrictLoc.locator('option').evaluateAll(options => options.map(o => ({ value: o.value, text: o.textContent.trim() })));
        let selectedDist = districtOptions.find(o => dyn.fullAddress.toLowerCase().includes(o.text.toLowerCase()));
        if (!selectedDist && dyn.fullAddress.toLowerCase().includes('mumbai')) {
            selectedDist = districtOptions.find(o => o.text.toLowerCase().includes('mumbai suburban')) || districtOptions.find(o => o.text.toLowerCase().includes('mumbai'));
        }
        if (selectedDist) {
            await smartSelect(page, '#presDistrict', selectedDist.value, selectedDist.text);
        } else {
            await smartSelect(page, '#presDistrict', '518'); 
        }
    }

    // Sub-district matching
    const presSubLoc = page.locator('#presSubDistrict');
    if (await presSubLoc.isVisible().catch(() => false)) {
        const subdistOptions = await presSubLoc.locator('option').evaluateAll(options => options.map(o => o.value));
        const validSub = subdistOptions.find(v => v !== '-1');
        if (validSub) await smartSelect(page, '#presSubDistrict', validSub);
    }

    // Fill Address Details
    await smartFillField(page, '#presHouseNo', dyn.addressLine1);
    await smartFillField(page, '#presStreet', dyn.addressLine2);
    await smartFillField(page, '#presPinCode', dyn.pincode);
    
    const sameAsPerm = page.locator('#presSameAsPerm, #sameasperm').first();
    if (await sameAsPerm.isVisible().catch(() => false) && !(await sameAsPerm.isChecked().catch(() => true))) {
        await sameAsPerm.check().catch(() => {});
    }
}

// Fallback for simple address dropdowns
async function fillAddressDropdowns(page) {
    console.log("[DLDetails] Running simple address dropdown fallback...");
    // 1. Extract read-only old address details from the page
    const oldAddressLines = await page.locator('input[type="text"]')
        .evaluateAll(inputs => inputs
            .filter(input => !input.id && !input.name && input.value && input.value.trim())
            .map(input => input.value.trim())
        ).catch(() => []);
    
    if (oldAddressLines.length === 0) return;
    
    const addr1 = oldAddressLines[0] || '';
    const addr2 = oldAddressLines[1] || '';
    const addr3 = oldAddressLines[2] || '';
    const addr1And2 = `${addr1} ${addr2}`;
    let selectedDistrictText = '';

    const dropdowns = [
        { id: 'prmDist', keys: [addr3] },
        { id: 'prmMandal', getKeys: () => [selectedDistrictText, addr3, addr1And2] }
    ];

    for (const step of dropdowns) {
        const sel = page.locator(`#${step.id}`);
        if (!(await sel.isVisible().catch(() => false))) continue;
        if (await sel.inputValue() !== '-1') {
            if (step.id === 'prmDist') {
                selectedDistrictText = await sel.locator('option:checked').textContent().catch(() => '');
            }
            continue;
        }

        const options = await sel.locator('option').evaluateAll(os =>
            os.map(o => ({ value: o.value, text: o.textContent }))
        );
        const validOptions = options.filter(o => o.value !== '-1' && o.value !== '' && o.text.toLowerCase() !== 'select');
        if (validOptions.length === 0) continue;

        const keys = step.keys || step.getKeys();
        let matchedOption = null;
        for (const key of keys) {
            if (!key) continue;
            const cleanKey = key.toLowerCase().replace(/[^a-z0-9\s]/g, " ").trim();
            const matches = validOptions.filter(opt => {
                const cleanOpt = opt.text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").trim();
                return cleanOpt && cleanKey.includes(cleanOpt);
            });
            if (matches.length > 0) {
                matches.sort((a, b) => b.text.length - a.text.length);
                matchedOption = matches[0];
                break;
            }
        }

        if (matchedOption) {
            await sel.selectOption(matchedOption.value).catch(() => {});
            if (step.id === 'prmDist') selectedDistrictText = matchedOption.text;
        }
        await page.waitForTimeout(1000);
    }
}

module.exports = {
    handleAddressAndDetails,
    fillAddressDropdowns
};
