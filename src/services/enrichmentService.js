const { getAckSnapshot } = require('./ackService');
const { updateEntry } = require('./unifiedTrackStore');

/**
 * Enriches Sarathi entries with applicant names from the acknowledgement receipt.
 * This is done lazily only when applicantName is missing.
 */
async function enrichSarathiEntries(entries) {
  const results = [];
  
  for (const entry of entries) {
    // Only enrich Sarathi entries missing a name but having a DOB
    if (entry.type === 'sarathi' && !entry.applicantName && entry.dob) {
      try {
        console.log(`[enrichment] Lazy fetching ACK for Sarathi app: ${entry.appNo}`);
        
        // We use the existing Puppeteer-based ACK fetch as requested
        const snapshot = await getAckSnapshot(entry.appNo, entry.dob, { 
          keepFile: false 
        });
        
        if (snapshot.ackDetails && snapshot.ackDetails.name) {
          const updates = {
            applicantName: snapshot.ackDetails.name,
            serviceName: snapshot.ackDetails.serviceRequested || entry.serviceName,
          };
          
          // Persist to store so we don't fetch again
          updateEntry(entry, updates);
          
          results.push({
            ...entry,
            ...updates
          });
          continue;
        }
      } catch (error) {
        console.error(`[enrichment] Failed to fetch ACK for ${entry.appNo}:`, error.message);
      }
    }
    
    results.push(entry);
  }
  
  return results;
}

module.exports = {
  enrichSarathiEntries,
};
