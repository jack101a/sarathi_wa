/**
 * infoFetcherService.js
 *
 * Standalone service to fetch applicant details from Sarathi portal
 * and format them according to specific JSON constraints.
 * Ensures all fields are always present, and strips out literal "Unknown" values.
 */

const ack = require('./ackService');
const cheerio = require('cheerio');

// Constraints
const MAX_TOTAL = 34;
const MAX_FIRST = 14;
const MAX_LAST = 14;
const MAX_MIDDLE = 6;

function splitAndTrimName(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);

  let first = (parts[0] || '').substring(0, MAX_FIRST);
  let last = (parts.length > 1 ? parts[parts.length - 1] : '').substring(0, MAX_LAST);
  let middle = (parts.length > 2 ? parts.slice(1, -1).join(' ') : '').substring(0, MAX_MIDDLE);

  // Final total check (including spaces)
  let total = `${first}${middle ? ' ' + middle : ''}${last ? ' ' + last : ''}`;
  if (total.length > MAX_TOTAL) {
    const over = total.length - MAX_TOTAL;
    // Trim from middle first, then last, then first
    if (middle.length >= over) {
      middle = middle.substring(0, middle.length - over).trim();
    } else {
      const remainingOver = over - middle.length;
      middle = '';
      if (last.length >= remainingOver) {
        last = last.substring(0, last.length - remainingOver).trim();
      } else {
        const firstOver = remainingOver - last.length;
        last = '';
        first = first.substring(0, first.length - firstOver).trim();
      }
    }
  }

  return {
    first_name: first,
    middle_name: middle,
    last_name: last
  };
}

function parseAddress(html, detailMap) {
  let applicantAddrStr = '';
  let pinCode = '';

  for (const key in detailMap) {
    if (key.includes('applicant address')) {
      applicantAddrStr = detailMap[key] || '';
      const pinMatch = key.match(/pincode\s*:\s*(\d+)/i) || applicantAddrStr.match(/pincode\s*:\s*(\d+)/i);
      if (pinMatch) {
        pinCode = pinMatch[1];
      }
      break;
    }
  }

  const cleanAddr = applicantAddrStr
    .replace(/pincode\s*:\s*\d+/gi, '')
    .replace(/,\s*,/g, ',')
    .trim();

  const parts = cleanAddr.split(',').map(p => p.trim()).filter(Boolean);

  let address1 = parts[0] || '';
  let address2 = parts[1] || '';
  let address3 = parts.slice(2).join(', ') || '';

  return {
    address1,
    address2,
    address3,
    pin_code: pinCode
  };
}

async function fetchInfo(appNo, dob) {
  // Get acknowledgement receipt HTML snapshot
  const snapshot = await ack.getAckSnapshot(appNo, dob, { keepFile: false });
  if (!snapshot || !snapshot.html) {
    throw new Error('Failed to retrieve acknowledgement receipt HTML');
  }

  const $ = cheerio.load(snapshot.html);
  const detailMap = {};

  $('tr').each((_, row) => {
    const cells = $(row).find('td');
    for (let index = 0; index + 1 < cells.length; index += 2) {
      const label = String($(cells[index]).text() || '')
        .replace(/[:\s]+$/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
      const value = String($(cells[index + 1]).text() || '')
        .replace(/^[:\s]+/g, '')
        .replace(/\s+/g, ' ')
        .trim();

      if (label && value) {
        detailMap[label] = value;
      }
    }
  });

  const rawName = detailMap['name'] || '';
  const rawFatherName = detailMap['father name'] || detailMap['father\'s name'] || '';

  let docProof = '';
  for (const key in detailMap) {
    if (key.includes('documentary proof required')) {
      docProof = detailMap[key] || '';
      break;
    }
  }

  return {
    NAME: splitAndTrimName(rawName),
    "FATHER NAME": splitAndTrimName(rawFatherName),
    "DATE OF BIRTH": dob,
    "BLOOD GROUP": (detailMap['blood group'] || '').toLowerCase() === 'unknown' ? '' : (detailMap['blood group'] || ''),
    "DOCUMENTARY PROOF REQUIRED": docProof,
    ADDRESS: parseAddress(snapshot.html, detailMap)
  };
}

module.exports = {
  fetchInfo
};
