// California statutory lien waiver forms (Civil Code §8134 and §8138).
// The wording must follow the statute; don't edit it casually.
const NOTICE = 'NOTICE TO CLAIMANT: THIS DOCUMENT WAIVES AND RELEASES LIEN, STOP PAYMENT NOTICE, AND PAYMENT BOND RIGHTS UNCONDITIONALLY AND STATES THAT YOU HAVE BEEN PAID FOR GIVING UP THOSE RIGHTS. THIS DOCUMENT IS ENFORCEABLE AGAINST YOU IF YOU SIGN IT, EVEN IF YOU HAVE NOT BEEN PAID. IF YOU HAVE NOT BEEN PAID, USE A CONDITIONAL WAIVER AND RELEASE FORM.';

module.exports = {
  progress: {
    title: 'UNCONDITIONAL WAIVER AND RELEASE ON PROGRESS PAYMENT',
    statute: '(California Civil Code Section 8134)',
    notice: NOTICE,
    body: 'This document waives and releases lien, stop payment notice, and payment bond rights the claimant has for labor and service provided, and equipment and material delivered, to the customer on this job through the Through Date of this document. Rights based upon labor or service provided, or equipment or material delivered, pursuant to a written change order that has been fully executed by the parties prior to the date that this document is signed by the claimant, are waived and released by this document, unless listed as an Exception below. The claimant has received the following progress payment:',
  },
  final: {
    title: 'UNCONDITIONAL WAIVER AND RELEASE ON FINAL PAYMENT',
    statute: '(California Civil Code Section 8138)',
    notice: NOTICE,
    body: 'This document waives and releases lien, stop payment notice, and payment bond rights the claimant has for all labor and service provided, and equipment and material delivered, to the customer on this job. Rights based upon labor or service provided, or equipment or material delivered, pursuant to a written change order that has been fully executed by the parties prior to the date that this document is signed by the claimant, are waived and released by this document, unless listed as an Exception below. The claimant has been paid in full.',
  },
  exceptions: 'This document does not affect the following:',
  disputed: 'Disputed claims for extras in the amount of: $',
};
