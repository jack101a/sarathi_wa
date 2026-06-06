'use strict';

function getSafeJobFailureMessage(error) {
  if (error && error.code === 'PORTAL_BUSINESS_RULE' && error.publicMessage) {
    return `${error.publicMessage}\n\nProcessing stopped.`;
  }
  if (error && error.code === 'MOBILE_PORTAL_MESSAGE' && error.publicMessage) {
    return `${error.publicMessage}\n\nProcessing stopped. Please try again later.`;
  }
  if (error && error.code === 'INTERACTIVE_TIMEOUT') {
    return 'No response was received within 5 minutes. Processing has stopped. Please start the service again.';
  }
  if (error && error.code === 'INTERACTIVE_CANCELLED') {
    return 'Processing stopped.';
  }
  return 'We could not complete this service. Processing has stopped. Please check your details and try again.';
}

function isNonRetryableError(error) {
  return Boolean(
    error
      && (
        error.retryable === false
        || error.code === 'PORTAL_BUSINESS_RULE'
        || error.code === 'INTERACTIVE_CANCELLED'
      )
  );
}

module.exports = {
  getSafeJobFailureMessage,
  isNonRetryableError,
};
