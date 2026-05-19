'use strict';

const fs = require('fs');
const path = require('path');

/**
 * CaptchaRuleRegistry
 * 
 * Provides a central registry for captcha field mappings (source/target selectors)
 * across different domains. Loads rules from captcha_rules.json.
 */
class CaptchaRuleRegistry {
  constructor() {
    this.rulesPath = path.join(__dirname, '..', 'config', 'captcha_rules.json');
    this.rules = { field_mappings: [], locators: {} };
    this.loadRules();
  }

  loadRules() {
    try {
      if (fs.existsSync(this.rulesPath)) {
        const raw = fs.readFileSync(this.rulesPath, 'utf8');
        this.rules = JSON.parse(raw);
        console.log(`[CaptchaRuleRegistry] Loaded ${this.rules.field_mappings.length} field mappings.`);
      } else {
        console.warn(`[CaptchaRuleRegistry] Rules file not found at ${this.rulesPath}`);
      }
    } catch (err) {
      console.error(`[CaptchaRuleRegistry] Failed to load rules: ${err.message}`);
    }
  }

  /**
   * Get all field mappings for a specific domain.
   * @param {string} domain 
   * @returns {Array} List of mapping objects { source_selector, target_selector, ... }
   */
  getMappingsByDomain(domain) {
    return this.rules.field_mappings.filter(m => m.domain === domain);
  }

  /**
   * Get formatted rules (src/tgt) for use in automation scripts.
   * @param {string} domain 
   * @returns {Array} List of { src, tgt } objects
   */
  getAutomationRules(domain) {
    return this.getMappingsByDomain(domain).map(m => ({
      src: m.source_selector,
      tgt: m.target_selector
    }));
  }

  /**
   * Get a specific locator by name from the global locators map.
   * @param {string} name 
   * @returns {string|null}
   */
  getLocator(name) {
    return this.rules.locators[name] || null;
  }
}

// Singleton instance
const registry = new CaptchaRuleRegistry();

module.exports = registry;
