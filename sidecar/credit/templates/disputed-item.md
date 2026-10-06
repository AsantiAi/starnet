## Disputed Item #{{n}}

**Creditor / Furnisher:** {{furnisher}}
**Account Number (as reported):** {{accountNumberMasked}}
**Date Opened (as reported):** {{dateOpened}}
**High Credit / Credit Limit (as reported):** {{highCreditOrLimit}}
**Reported Status (as reported on the {{reportDate}} {{bureau.name}} report):** {{reportedStatus}}
**Date of First Delinquency (as reported):** {{dofdOrNoneReported}}

**Nature of the dispute.** {{natureOfDispute}}

**Identified inaccuracies.**
{{#each inaccuracies}}{{@number}}. {{this}}
{{/each}}
**Legal grounds.**
{{#each legalGrounds}}- {{this}}
{{/each}}
**Demand.** {{demand}} If you contend the information is accurate, provide the description of the procedure used to verify it under 15 U.S.C. § 1681i(a)(7), including the business name, address, and telephone number of each furnisher contacted.
