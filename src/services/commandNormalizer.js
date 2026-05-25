const { normalizeDob } = require('./commandInputService');

function isDlInput(appNo) {
  const cleaned = String(appNo || '').trim().replace(/[-\s]/g, '');
  if (!cleaned) return false;
  // Purely numeric (DL application number, usually 10 digits)
  if (/^\d+$/.test(cleaned)) return true;
  // DL license number: starts with 2 letters, followed ONLY by digits, length >= 15
  if (/^[A-Za-z]{2}\d+$/.test(cleaned) && cleaned.length >= 15) return true;
  return false;
}

// Simple Hindi/Hinglish Error templates
const ERRORS = {
  MISSING_DOB: (cmd) => `❌ *जन्मतिथि (DOB) नहीं मिली!*\nलाइसेंस की जानकारी के लिए जन्मतिथि देना ज़रूरी है।\n\n*सही तरीका (Format):*\n👉 \`${cmd} <appl_no> <DOB>\`\n\n*उदाहरण (Example):*\n👉 \`${cmd} 2982778275 01-02-2003\`\n(जन्मतिथि को हमेशा DD-MM-YYYY फॉर्मेट में लिखें, जैसे: 01-02-2003)`,
  
  INVALID_DOB: `❌ *गलत जन्मतिथि (DOB) फॉर्मेट!*\nजन्मतिथि का फॉर्मेट सही नहीं है।\n\n*सही तरीका (Format):*\n👉 जन्मतिथि को हमेशा DD-MM-YYYY फॉर्मेट में लिखें (जैसे: 01-02-2003)`,
  
  MISSING_QUALIFIER: `❌ *कृपया DL या RC कमांड का उपयोग करें!*\nअब केवल \`track\` लिखने से काम नहीं चलेगा। आपको स्पष्ट बताना होगा कि आप DL देखना चाहते हैं या RC।\n\n*सही तरीका (Format):*\n👉 *DL के लिए:* \`track DL <appl_no> <DOB>\`\n👉 *RC के लिए:* \`track RC <appl_no>\`\n\n*उदाहरण (Example):*\n👉 \`track DL 2982778275 01-02-2003\`\n👉 \`track RC MH26021234567\``,
  
  MISSING_APP_NO: (cmd, requiresDob = false) => `❌ *आवेदन संख्या (Application Number) नहीं मिली!*\n\n*सही तरीका (Format):*\n👉 \`${cmd} <appl_no>${requiresDob ? ' <DOB>' : ''}\``
};

const USER_HELP_TEXT = `📋 *Sarathi Bot Help (मदद)*

*DL/RC की जानकारी (Tracking):*
• \`track DL <appl_no> <DOB>\` - DL का स्टेटस देखने के लिए
• \`track RC <appl_no>\` - गाड़ी का RC स्टेटस देखने के लिए
• \`track status\` - आपकी सक्रिय ट्रैकिंग लिस्ट देखने के लिए
• \`track add <appl_no> <DOB>\` - DL ऑटो-ट्रैकिंग चालू करने के लिए
• \`track add <appl_no>\` - RC ऑटो-ट्रैकिंग चालू करने के लिए
• \`track remove <appl_no>\` - ऑटो-ट्रैकिंग बंद करने के लिए

*फॉर्म डाउनलोड करें (Download Forms):*
• \`app <appl_no> <DOB>\` - रसीद (Acknowledgement) डाउनलोड करने के लिए
• \`slot <appl_no> <DOB>\` - स्लॉट बुकिंग रसीद (Slot Acknowledgement) डाउनलोड करने के लिए
• \`form1 <appl_no> <DOB>\` - स्व-घोषणा फॉर्म (Self Declaration) डाउनलोड करने के लिए
• \`form1a <appl_no> <DOB>\` - मेडिकल सर्टिफिकेट फॉर्म डाउनलोड करने के लिए
• \`form2 <appl_no> <DOB>\` - फॉर्म 2 एप्लीकेशन डाउनलोड करने के लिए
• \`formset <appl_no> <DOB>\` - सारे फॉर्म एक साथ (Combined Set) डाउनलोड करने के लिए
• \`fees <appl_no> <DOB>\` - फीस की रसीद प्रिंट करने के लिए
• \`llprint <appl_no> <DOB>\` - लर्निंग लाइसेंस डाउनलोड करने के लिए

*अन्य कमांड्स (Others):*
• \`resend <appl_no> <DOB>\` - लर्निंग लाइसेंस (LL) का पासवर्ड दोबारा भेजने के लिए
• \`renewal <dl_no> <DOB> [RTO]\` - DL रिन्यूअल (Renewal of DL) के लिए
• \`duplicate <dl_no> <DOB> [RTO]\` - डुप्लीकेट DL (Duplicate DL) के लिए
• \`replacement <dl_no> <DOB> [RTO]\` - DL रिप्लेसमेंट (Replacement of DL) के लिए
• \`dl extract <dl_no> <DOB> [RTO]\` - DL एक्सट्रैक्ट (DL Extract) के लिए
• \`dlinfo <dl_no> <DOB>\` - DL की जानकारी देखने के लिए
• \`dlapp <ll_no> <DOB>\` - नया DL अप्लाई करने के लिए
• \`alive\` - बॉट का स्टेटस चेक करने के लिए
• \`stop\` - चल रहे काम को रोकने के लिए

💡 _नोट: जन्मतिथि (DOB) हमेशा DD-MM-YYYY फॉर्मेट में लिखें (जैसे: 01-02-2003)_`;

const ADMIN_HELP_TEXT = `📋 *Sarathi Bot Help (मदद) - Admin Mode*

*DL/RC की जानकारी (Tracking):*
• \`track DL <appl_no> <DOB>\` - DL का स्टेटस देखने के लिए
• \`track RC <appl_no>\` - गाड़ी का RC स्टेटस देखने के लिए
• \`track status\` - आपकी सक्रिय ट्रैकिंग लिस्ट देखने के लिए
• \`track add <appl_no> <DOB>\` - DL ऑटो-ट्रैकिंग चालू करने के लिए
• \`track add <appl_no>\` - RC ऑटो-ट्रैकिंग चालू करने के लिए
• \`track remove <appl_no>\` - ऑटो-ट्रैकिंग बंद करने के लिए

*फॉर्म डाउनलोड करें (Download Forms):*
• \`app <appl_no> <DOB>\` - रसीद (Acknowledgement) डाउनलोड करने के लिए
• \`slot <appl_no> <DOB>\` - स्लॉट बुकिंग रसीद (Slot Acknowledgement) डाउनलोड करने के लिए
• \`form1 <appl_no> <DOB>\` - स्व-घोषणा फॉर्म (Self Declaration) डाउनलोड करने के लिए
• \`form1a <appl_no> <DOB>\` - मेडिकल सर्टिफिकेट फॉर्म डाउनलोड करने के लिए
• \`form2 <appl_no> <DOB>\` - फॉर्म 2 एप्लीकेशन डाउनलोड करने के लिए
• \`formset <appl_no> <DOB>\` - सारे फॉर्म एक साथ (Combined Set) डाउनलोड करने के लिए
• \`fees <appl_no> <DOB>\` - फीस की रसीद प्रिंट करने के लिए
• \`llprint <appl_no> <DOB>\` - लर्निंग लाइसेंस डाउनलोड करने के लिए

*अन्य कमांड्स (Others):*
• \`resend <appl_no> <DOB>\` - लर्निंग लाइसेंस (LL) का पासवर्ड दोबारा भेजने के लिए
• \`renewal <dl_no> <DOB> [RTO]\` - DL रिन्यूअल (Renewal of DL) के लिए
• \`duplicate <dl_no> <DOB> [RTO]\` - डुप्लीकेट DL (Duplicate DL) के लिए
• \`replacement <dl_no> <DOB> [RTO]\` - DL रिप्लेसमेंट (Replacement of DL) के लिए
• \`dl extract <dl_no> <DOB> [RTO]\` - DL एक्सट्रैक्ट (DL Extract) के लिए
• \`dlinfo <dl_no> <DOB>\` - DL की जानकारी देखने के लिए
• \`dlapp <ll_no> <DOB>\` - नया DL अप्लाई करने के लिए
• \`payfee <appl_no> <DOB>\` - फीस पेमेंट करने के लिए
• \`bookslot <appl_no> <DOB>\` - स्लॉट बुकिंग के लिए
• \`alive\` - बॉट का स्टेटस चेक करने के लिए
• \`stop\` - चल रहे काम को रोकने के लिए

💡 _नोट: जन्मतिथि (DOB) हमेशा DD-MM-YYYY फॉर्मेट में लिखें (जैसे: 01-02-2003)_`;

function parseCommand(rawText, hasMedia, user, isAdmin) {
  if (hasMedia) {
    return { success: false, ignore: true };
  }

  const cleanedText = String(rawText || '')
    .trim()
    .replace(/\s+/g, ' ');

  if (!cleanedText) {
    return { success: false, ignore: true };
  }

  // Check for admin commands silent block
  const isAuthCommand = /^(?:\/)?auth\b/i.test(cleanedText);
  const isRefreshCommand = /^(?:\/)?refreshtrack\b/i.test(cleanedText) || /^refresh\s+track$/i.test(cleanedText) || /^track\s+refresh$/i.test(cleanedText);

  if (isAuthCommand || isRefreshCommand) {
    if (!isAdmin) {
      return { success: false, silent: true };
    }
  }

  // Strip leading slash if present
  let textToParse = cleanedText;
  if (textToParse.startsWith('/')) {
    textToParse = textToParse.slice(1);
  }

  // Normalize multi-word phrases to their single-word equivalents
  textToParse = textToParse
    .replace(/^add\s+track\s+rc\b/i, 'addtrackrc')
    .replace(/^remove\s+track\s+rc\b/i, 'removetrackrc')
    .replace(/^add\s+track\b/i, 'addtrack')
    .replace(/^remove\s+track\b/i, 'removetrack')
    .replace(/^track\s+rc\b/i, 'trackrc')
    .replace(/^track\s+dl\b/i, 'trackdl')
    .replace(/^list\s+track\b/i, 'listtrack')
    .replace(/^dl\s+renewal\b/i, 'dlrenewal')
    .replace(/^dl\s+extract\b/i, 'dlextract')
    .replace(/^dl\s+info\b/i, 'dlinfo')
    .replace(/^dl\s+duplicate\b/i, 'duplicate')
    .replace(/^dl\s+replacement\b/i, 'replacement')
    .replace(/^apply\s+dl\b/i, 'dlapp')
    .replace(/^book\s+slot\b/i, 'bookslot')
    .replace(/^pay\s+fee\b/i, 'payfee')
    .replace(/^fee\s+print\b/i, 'feeprint')
    .replace(/^print\s+fee\b/i, 'feeprint')
    .replace(/^ll\s+print\b/i, 'llprint')
    .replace(/^ll\s+edit\b/i, 'lledit');

  const parts = textToParse.split(' ');
  const cmd = parts[0].toLowerCase();

  // Pre-process and merge split DL number parts (e.g. "MH47 20150008844")
  if (['dlrenewal', 'renewal', 'duplicate', 'replacement', 'dlextract', 'dlinfo'].includes(cmd)) {
    if (parts[1] && parts[2]) {
      const p1Clean = parts[1].replace(/[-\s]/g, '').toUpperCase();
      const p2Clean = parts[2].replace(/[-\s]/g, '').toUpperCase();
      if (/^[A-Z]{2}\d{2}$/.test(p1Clean) && /^\d+$/.test(p2Clean)) {
        parts[1] = p1Clean + p2Clean;
        parts.splice(2, 1); // remove the merged part
      }
    }
  }

  // 1. HELP COMMANDS
  if (/^(?:help|मदद|maddad|hi|hello)$/i.test(cmd)) {
    return { success: true, type: 'help', message: isAdmin ? ADMIN_HELP_TEXT : USER_HELP_TEXT };
  }

  // 2. ALIVE/SUNO
  if (/^(?:alive|suno)$/i.test(cmd)) {
    return { success: true, type: 'alive' };
  }

  // 3. STOP
  if (/^(?:stop)$/i.test(cmd)) {
    return { success: true, type: 'stop' };
  }

  // 4. ADMIN REFRESH TRACK (already verified isAdmin above)
  if (isRefreshCommand) {
    return { success: true, type: 'refresh_track', payload: {} };
  }

  // 5. TRACK COMMANDS
  if (cmd === 'track') {
    const sub = (parts[1] || '').toLowerCase();
    
    // track status
    if (sub === 'status') {
      return { success: true, type: 'track_status', payload: {} };
    }

    // track add
    if (sub === 'add') {
      let appNo = parts[2] || '';
      let rawDob = '';
      let isExplicitRc = false;
      let isExplicitDl = false;

      if (appNo.toLowerCase() === 'dl') {
        isExplicitDl = true;
        appNo = parts[3] || '';
        rawDob = parts[4] || '';
      } else if (appNo.toLowerCase() === 'rc') {
        const nextArg = parts[3] || '';
        if (isDlInput(nextArg)) {
          isExplicitDl = true;
          appNo = nextArg;
          rawDob = parts[4] || '';
        } else {
          isExplicitRc = true;
          appNo = nextArg;
        }
      } else {
        rawDob = parts[3] || '';
      }

      if (!appNo) {
        return { success: false, error: ERRORS.MISSING_APP_NO('track add', !isExplicitRc) };
      }

      const isRc = isExplicitRc || (!isExplicitDl && !isDlInput(appNo) && /^[A-Z0-9]{8,22}$/i.test(appNo) && /[A-Z]/i.test(appNo));
      if (isRc) {
        return { success: true, type: 'add_track_rc', payload: { appNo: appNo.toUpperCase(), tag: '' } };
      } else {
        // DL track add requires DOB
        if (!rawDob) {
          return { success: false, error: ERRORS.MISSING_DOB('track add') };
        }
        const normalizedDob = rawDob ? normalizeDob(rawDob) : '';
        if (!normalizedDob) {
          return { success: false, error: ERRORS.INVALID_DOB };
        }
        return { success: true, type: 'add_track', payload: { appNo, dob: normalizedDob, tag: '' } };
      }
    }

    // track remove
    if (sub === 'remove') {
      let appNo = parts[2] || '';
      if (appNo.toLowerCase() === 'dl' || appNo.toLowerCase() === 'rc') {
        appNo = parts[3] || '';
      }
      if (!appNo) {
        return { success: false, error: ERRORS.MISSING_APP_NO('track remove') };
      }
      const isRc = !isDlInput(appNo) && /^[A-Z0-9]{8,22}$/i.test(appNo) && /[A-Z]/i.test(appNo);
      if (isRc) {
        return { success: true, type: 'remove_track_rc', payload: { appNo: appNo.toUpperCase() } };
      } else {
        return { success: true, type: 'remove_track', payload: { appNo } };
      }
    }

    // track DL
    if (sub === 'dl') {
      const appNo = parts[2] || '';
      if (!appNo) {
        return { success: false, error: ERRORS.MISSING_APP_NO('track DL', true) };
      }
      const rawDob = parts[3] || '';
      if (!rawDob) {
        return { success: false, error: ERRORS.MISSING_DOB('track DL') };
      }
      const normalizedDob = rawDob ? normalizeDob(rawDob) : '';
      if (!normalizedDob) {
        return { success: false, error: ERRORS.INVALID_DOB };
      }
      return { success: true, type: 'track', payload: { appNo, dob: normalizedDob } };
    }

    // track RC
    if (sub === 'rc') {
      const appNo = parts[2] || '';
      if (!appNo) {
        return { success: false, error: ERRORS.MISSING_APP_NO('track RC') };
      }
      if (isDlInput(appNo)) {
        const rawDob = parts[3] || '';
        if (!rawDob) {
          return { success: false, error: ERRORS.MISSING_DOB('track DL') };
        }
        const normalizedDob = normalizeDob(rawDob);
        if (!normalizedDob) {
          return { success: false, error: ERRORS.INVALID_DOB };
        }
        return { success: true, type: 'track', payload: { appNo, dob: normalizedDob } };
      }
      return { success: true, type: 'track_rc', payload: { appNo: appNo.toUpperCase() } };
    }

    if (sub) {
      if (isDlInput(sub)) {
        const rawDob = parts[2] || '';
        if (!rawDob) {
          return { success: false, error: ERRORS.MISSING_DOB('track DL') };
        }
        const normalizedDob = rawDob ? normalizeDob(rawDob) : '';
        if (!normalizedDob) {
          return { success: false, error: ERRORS.INVALID_DOB };
        }
        return { success: true, type: 'track', payload: { appNo: sub, dob: normalizedDob } };
      } else {
        const isRc = /^[A-Z0-9]{8,22}$/i.test(sub) && /[A-Z]/i.test(sub);
        if (isRc) {
          return { success: true, type: 'track_rc', payload: { appNo: sub.toUpperCase() } };
        }
      }
    }

    // fallback: plain "track" command or invalid qualifier
    return { success: false, error: ERRORS.MISSING_QUALIFIER };
  }

  // 6. SHORTCUT / INDEPENDENT COMMANDS
  if (/^(?:listtrack|list\s+track)$/i.test(textToParse)) {
    return { success: true, type: 'track_status', payload: {} };
  }

  if (cmd === 'trackrc') {
    const appNo = parts[1] || '';
    if (!appNo) return { success: false, error: ERRORS.MISSING_APP_NO('track RC') };
    if (isDlInput(appNo)) {
      const rawDob = parts[2] || '';
      if (!rawDob) return { success: false, error: ERRORS.MISSING_DOB('track DL') };
      const normalizedDob = normalizeDob(rawDob);
      if (!normalizedDob) return { success: false, error: ERRORS.INVALID_DOB };
      return { success: true, type: 'track', payload: { appNo, dob: normalizedDob } };
    }
    return { success: true, type: 'track_rc', payload: { appNo: appNo.toUpperCase() } };
  }
  if (cmd === 'addtrackrc') {
    const appNo = parts[1] || '';
    if (!appNo) return { success: false, error: ERRORS.MISSING_APP_NO('track add') };
    if (isDlInput(appNo)) {
      const rawDob = parts[2] || '';
      if (!rawDob) return { success: false, error: ERRORS.MISSING_DOB('track add') };
      const normalizedDob = normalizeDob(rawDob);
      if (!normalizedDob) return { success: false, error: ERRORS.INVALID_DOB };
      return { success: true, type: 'add_track', payload: { appNo, dob: normalizedDob, tag: '' } };
    }
    return { success: true, type: 'add_track_rc', payload: { appNo: appNo.toUpperCase(), tag: '' } };
  }
  if (cmd === 'removetrackrc') {
    const appNo = parts[1] || '';
    if (!appNo) return { success: false, error: ERRORS.MISSING_APP_NO('track remove') };
    if (isDlInput(appNo)) {
      return { success: true, type: 'remove_track', payload: { appNo } };
    }
    return { success: true, type: 'remove_track_rc', payload: { appNo: appNo.toUpperCase() } };
  }

  if (cmd === 'trackdl') {
    const appNo = parts[1] || '';
    if (!appNo) return { success: false, error: ERRORS.MISSING_APP_NO('track DL', true) };
    const rawDob = parts[2] || '';
    if (!rawDob) return { success: false, error: ERRORS.MISSING_DOB('track DL') };
    const normalizedDob = rawDob ? normalizeDob(rawDob) : '';
    if (!normalizedDob) return { success: false, error: ERRORS.INVALID_DOB };
    return { success: true, type: 'track', payload: { appNo, dob: normalizedDob } };
  }
  if (cmd === 'addtrack') {
    let appNo = parts[1] || '';
    let rawDob = '';
    let isExplicitRc = false;
    let isExplicitDl = false;

    if (appNo.toLowerCase() === 'dl') {
      isExplicitDl = true;
      appNo = parts[2] || '';
      rawDob = parts[3] || '';
    } else if (appNo.toLowerCase() === 'rc') {
      const nextArg = parts[2] || '';
      if (isDlInput(nextArg)) {
        isExplicitDl = true;
        appNo = nextArg;
        rawDob = parts[3] || '';
      } else {
        isExplicitRc = true;
        appNo = nextArg;
      }
    } else {
      rawDob = parts[2] || '';
    }

    if (!appNo) return { success: false, error: ERRORS.MISSING_APP_NO('track add', !isExplicitRc) };

    const isRc = isExplicitRc || (!isExplicitDl && !isDlInput(appNo) && /^[A-Z0-9]{8,22}$/i.test(appNo) && /[A-Z]/i.test(appNo));
    if (isRc) {
      return { success: true, type: 'add_track_rc', payload: { appNo: appNo.toUpperCase(), tag: '' } };
    } else {
      if (!rawDob) return { success: false, error: ERRORS.MISSING_DOB('track add') };
      const normalizedDob = rawDob ? normalizeDob(rawDob) : '';
      if (!normalizedDob) return { success: false, error: ERRORS.INVALID_DOB };
      return { success: true, type: 'add_track', payload: { appNo, dob: normalizedDob, tag: '' } };
    }
  }
  if (cmd === 'removetrack') {
    let appNo = parts[1] || '';
    if (appNo.toLowerCase() === 'dl' || appNo.toLowerCase() === 'rc') {
      appNo = parts[2] || '';
    }
    if (!appNo) return { success: false, error: ERRORS.MISSING_APP_NO('track remove') };
    const isRc = !isDlInput(appNo) && /^[A-Z0-9]{8,22}$/i.test(appNo) && /[A-Z]/i.test(appNo);
    if (isRc) {
      return { success: true, type: 'remove_track_rc', payload: { appNo: appNo.toUpperCase() } };
    } else {
      return { success: true, type: 'remove_track', payload: { appNo } };
    }
  }

  // 7. FORM DOWNLOAD COMMANDS
  const FORM_MAP = {
    form1: 'form1',
    form1a: 'form1a',
    form2: 'form2',
    appl: 'appl_pdf',
    app: 'appl_pdf',
    formset: 'formset',
    feeprint: 'fee_print_start',
    fees: 'fee_print_start',
    llprint: 'llprint_start',
    lledit: 'lledit_start',
    resend: 'resend_otp',
    payfee: 'pay_fee_start',
    bookslot: 'slot_booking_start',
    dlrenewal: 'dl_renewal_start',
    renewal: 'dl_renewal_start',
    duplicate: 'dl_renewal_start',
    replacement: 'dl_renewal_start',
    dlextract: 'dl_renewal_start',
    dlapp: 'apply_dl_start',
    dlinfo: 'dl_info_start',
    slot: 'slot_pdf'
  };

  if (FORM_MAP[cmd]) {
    if ((cmd === 'payfee' || cmd === 'bookslot') && !isAdmin) {
      return { success: false, silent: true };
    }
    const appNo = parts[1] || '';
    if (!appNo) {
      return { success: false, error: ERRORS.MISSING_APP_NO(cmd, true) };
    }
    const rawDob = parts[2] || '';
    if (!rawDob) {
      return { success: false, error: ERRORS.MISSING_DOB(cmd) };
    }
    const normalizedDob = rawDob ? normalizeDob(rawDob) : '';
    if (!normalizedDob) {
      return { success: false, error: ERRORS.INVALID_DOB };
    }

    if (cmd === 'dlrenewal' || cmd === 'renewal' || cmd === 'duplicate' || cmd === 'replacement' || cmd === 'dlextract' || cmd === 'dlinfo') {
      let dlNo = appNo;
      // Clean and format DL number with space after the 4th character (State + RTO) in uppercase
      const cleanedDL = dlNo.replace(/[-\s]/g, '').toUpperCase();
      if (/^[A-Z]{2}\d{2}/.test(cleanedDL)) {
        dlNo = cleanedDL.slice(0, 4) + ' ' + cleanedDL.slice(4);
      }
      const rtoCode = parts[3] && parts[3].length !== 10 && isNaN(Number(parts[3])) ? parts[3] : '';
      let mobile = '';
      if (parts[3] && (parts[3].length === 10 || !isNaN(Number(parts[3])))) {
        mobile = parts[3];
      } else if (parts[4]) {
        mobile = parts[4];
      }
      
      if (cmd === 'dlinfo') {
        return { success: true, type: 'dl_info_start', payload: { dlNo, dob: normalizedDob, mobile } };
      }

      let serviceType = 'RENEWAL OF DL';
      if (cmd === 'duplicate') serviceType = 'ISSUE OF DUPLICATE DL';
      else if (cmd === 'replacement') serviceType = 'REPLACEMENT OF DL';
      else if (cmd === 'dlextract') serviceType = 'DL EXTRACT';

      return { success: true, type: 'dl_renewal_start', payload: { dlNo, dob: normalizedDob, rtoCode, mobile, serviceType } };
    }

    if (cmd === 'dlapp') {
      const llNo = appNo;
      const mobile = parts[3] || '';
      return { success: true, type: 'apply_dl_start', payload: { llNo, dob: normalizedDob, mobile } };
    }

    const mobile = parts[3] || '';
    return { success: true, type: FORM_MAP[cmd], payload: { appNo, dob: normalizedDob, mobile } };
  }

  // No command matched
  return { success: false, unmatched: true };
}

module.exports = {
  parseCommand,
  USER_HELP_TEXT,
  ADMIN_HELP_TEXT,
  ERRORS
};
