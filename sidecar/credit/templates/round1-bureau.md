{{consumer.fullName}}
{{consumer.addressLine1}}
{{consumer.cityStateZip}}
Date of Birth: {{consumer.dob}}
SSN (last 4): XXX-XX-{{consumer.ssnLast4}}

{{letterDate}}

{{bureau.name}}
{{bureau.addressLine1}}
{{bureau.cityStateZip}}

Re: Formal Dispute of Inaccurate, Incomplete, and Unverifiable Information
Consumer: {{consumer.fullName}} | DOB: {{consumer.dob}} | SSN (last 4): XXX-XX-{{consumer.ssnLast4}}

To Whom It May Concern:

This is a formal dispute submitted under the Fair Credit Reporting Act, 15 U.S.C. § 1681i. I am disputing the {{itemOrItems}} below on my consumer file as inaccurate, incomplete, and not verifiable. For {{thisItemOrEachItem}}, I request deletion under 15 U.S.C. § 1681i(a)(5)(A), which requires that information found to be inaccurate, incomplete, or unverifiable be promptly deleted or modified.

{{#each items}}{{> disputed-item}}{{/each}}

## Procedural demands

1. Conduct a reasonable reinvestigation under 15 U.S.C. § 1681i(a)(1), one that does not merely repeat the furnisher's response. See *Cushman v. Trans Union Corp.*, 115 F.3d 220 (3d Cir. 1997).
2. Forward all information I have submitted to the furnisher within five business days under 15 U.S.C. § 1681i(a)(2).
3. Provide written notice of the results under 15 U.S.C. § 1681i(a)(6).

I have enclosed legible copies of one government-issued photo ID and one proof of current address. This dispute is made in good faith, and I expect a substantive response within 30 days of your receipt of this letter.

Sincerely,

[signature]
{{consumer.fullName}}

**Enclosures:**
- Copy of government-issued photo ID
- Copy of proof of address
{{#each enclosures}}- {{this}}
{{/each}}
---
This document is prepared by a credit-repair service provider and is not legal advice. It does not establish an attorney-client relationship. Compliance with the Fair Credit Reporting Act does not guarantee any specific change to a credit report.
