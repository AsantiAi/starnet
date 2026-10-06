#!/usr/bin/env python3
"""Generate a SYNTHETIC three-bureau credit report text fixture that mirrors the layout
of `pdftotext -layout` output for the 'Three Bureau Credit Report powered by Equifax' format.
All names, numbers, addresses and dates are FAKE."""
REPORT_DATE = "Sep 01, 2026"
LONG_DATE = "September 01, 2026"
FOOT = REPORT_DATE + " Three Bureau Credit Report powered by Equifax"
out = []
page = [1]
TOTAL = 30
def L(s=""): out.append(s)
def brk():
    L(); L(); L(); L()
    pad = " " * (max(1, 118 - len(FOOT) - len("Page %d of %d" % (page[0], TOTAL))))
    L(FOOT + pad + "Page %d of %d" % (page[0], TOTAL) + "\f")
    page[0] += 1
def row(label, a, b, c, cols=(39, 73, 101), lead=1):
    s = " " * lead + label
    for v, col in zip((a, b, c), cols):
        s = s.ljust(col) if len(s) < col else s + "  "
        s += v
    L(s.rstrip())
def hdr(cols=(39, 73, 101)):
    row("", "Equifax", "Experian", "TransUnion", cols, lead=0)
D = (39, 63, 94)

L("                     powered by"); L(); L(); L(); L()
L("Three Bureau Credit Report"); L(); L()
L("Alex R. Testperson"); L(LONG_DATE)
L("                             Three Bureau Credit Report")
L("Alex Testperson | " + LONG_DATE); L(); L()
toc = [("1. Report Summary", 1), ("2. Revolving Accounts", 3), ("  2.1 Example Bank Card (CLOSED)", 3),
       ("  2.2 Sample Card Services (CLOSED)", 6), ("  2.3 Demo Credit Union", 9), ("  2.4 Placeholder Store Card (CLOSED)", 11), ("3. Mortgage Accounts", 12),
       ("  3.1 Demo Mortgage Co", 12), ("4. Installment Accounts", 15), ("  4.1 Test Student Loan (CLOSED)", 15),
       ("5. Other Accounts", 18), ("  5.1 Example Bank Card (CLOSED)", 18), ("6. Consumer Statements", 21),
       ("7. Personal Information", 22), ("8. Inquiries", 24), ("9. Public Records", 25), ("10. Collections", 26),
       ("11. Dispute File Information", 28)]
for t, p in toc:
    L(t.ljust(58) + str(p)); L()
L("1. Report Summary")
L("Review this summary for a quick view of key information contained in your credit file, as well as your resulting credit scores")
L("and ratings."); L()
hdr()
row("Report Date", LONG_DATE, LONG_DATE, LONG_DATE)
row("Average Account Age", "4 Years, 2 Months", "4 Years, 1 Months", "4 Years, 0 Months")
row("Oldest Account", "Demo Mortgage Co", "Demo Mortgage Co", "Demo Mortgage Co")
row("", "Mar 2018", "Mar 2018", "Mar 2018")
L(); L(); L()
L("Credit Score and Rating")
L("Your credit score and rating are not part of your credit report, but are derived from the information in your file.")
L(); L()
L("               Equifax                                       Experian                          TransUnion")
L("                   610                                          605                                    612")
L("                    Fair                                        Fair                                   Fair")
L(); L()
L("Other Credit Items")
L("Your credit report includes information about instances of non-account items that may affect your credit score and rating.")
L("The table below is a summary of non-account related items on your report."); L()
row("    Consumer Statements", "0", "0", "0", (52, 103, 154), lead=0)
row("    Personal Information", "4", "3", "4", (52, 103, 154), lead=0)
row("    Inquiries", "1", "3", "2", (52, 103, 154), lead=0)
row("    Public Records", "0", "0", "0", (52, 103, 154), lead=0)
row("    Collections", "1", "1", "1", (52, 103, 154), lead=0)
brk()

def account(num, title, top, summary, details, comments, contact, grids=("Equifax", "Experian", "TransUnion"),
            split_summary_at=None):
    L(num + " " + title)
    L("Your debt-to-credit ratio represents the amount of credit you're using and make up 30% of your credit score. It's calculated")
    L("by dividing an account's reported balance by it is credit limit. The idea range for your debt-to-credit ratio is 30% or less.")
    L(); hdr()
    for r in top: row(*r)
    L(); L(); L()
    L("Payment History")
    L("This tables below show up to 7 years of monthly payment history for this account. The numbers in each cell indicate the")
    L("number of days a payment was due; the letters indicate other account events, such as bankruptcy or collections."); L(); L()
    for g in grids:
        L(g); L()
        L(" Year       Jan         Feb         Mar         Apr          May   Jun         Jul       Aug   Sep        Oct     Nov       Dec")
        L(" 2026"); L(" 2025"); L(); L()
    L(); L()
    L("Payment Summary")
    L("The tables below shows a summary of 7 years of monthly payment history for this account as reported by each bureau."); L()
    hdr(D)
    for i, r in enumerate(summary):
        if split_summary_at is not None and i == split_summary_at:
            brk(); hdr(D)
        row(*r, cols=D)
    L(); L(); L()
    L("Account Details")
    L("View the detailed information about this account. Contact the creditor or lender if you have any question."); L()
    hdr(D)
    for r in details: row(*r, cols=D)
    L(); L()
    L("Comments".ljust(61) + "Contact")
    n = max(len(comments), len(contact))
    for i in range(n):
        a = comments[i] if i < len(comments) else ""
        b = contact[i] if i < len(contact) else ""
        L((a.ljust(61) + b).rstrip())
    brk()

SUMLABELS = ["30 Days Past Due", "60 Days Past Due", "90 Days Past Due", "120 Days Past Due", "Collection Account",
             "Charge Off", "Included in Bankruptcy", "Repossession", "Too New to Rate", "No Data Available"]
def summ(eq, ex, tu):
    return [(lab, eq[i], ex[i], tu[i]) for i, lab in enumerate(SUMLABELS)]
Z = ["0"] * 9
NA = ["N/A"] * 10
def details(**kw):
    order = ["Account Type", "Loan Type", "Creditor Classification", "Status", "Activity Designator", "Date Opened",
             "Date Closed", "Date Reported", "Date Of Last Activity", "Date Of First Delinquency",
             "Deferred Payment Start Date", "Balloon Payment Date", "Term Duration", "Term Frequency", "Month Reviewed",
             "Balance", "Credit Limit", "High Credit", "Monthly Payment Amount", "Actual Payment Amount",
             "Amount Past Due", "Balloon Payment Amount", "Charge Off Amount"]
    rows = []
    for lab in order:
        v = kw.get(lab, ("N/A",))
        if len(v) == 1: v = v * 3
        rows.append((lab,) + tuple(v))
    return rows

L("2. Revolving Accounts")
L("Revolving accounts are those that include a credit limit and require a minimum monthly payment, such as credit cards.")
L(); L()
# 2.1 clean closed
account("2.1", "Example Bank Card (CLOSED)",
        [("Reported", "Yes", "Yes", "Yes"), ("Account Number", "xxxxxxxxxxxxx 1111", "xxxxxxxx 2222", "xxxxxxxxxxxx 1111"),
         ("Account Status", "Closed", "Closed", "Closed"), ("Credit Limit", "$2,000", "$2,000", "$2,000"),
         ("Reported Balance", "$0", "$0", "$0")],
        summ(Z + ["13"], Z + ["13"], Z + ["13"]),
        details(**{"Account Type": ("Revolving",), "Loan Type": ("creditcard",), "Creditor Classification": ("Unknown",),
                   "Status": ("Pays as Agreed",), "Activity Designator": ("Closed",), "Date Opened": ("Jan 01, 2024",),
                   "Date Closed": ("Jun 01, 2026", "N/A", "Jun 01, 2026"), "Date Reported": ("Jul 01, 2026",),
                   "Term Duration": ("0",), "Term Frequency": ("N/A", "rev", "N/A"), "Month Reviewed": ("11", "12", "11"),
                   "Balance": ("$0",), "Credit Limit": ("$2,000",), "High Credit": ("$740",), "Monthly Payment Amount": ("$0",),
                   "Amount Past Due": ("$0",)}),
        ["- ACCOUNT CLOSED BY CREDIT GRANTOR", "- ACCOUNT PAID AND CLOSED", "- THIS IS AN ACCOUNT IN GOOD STANDING", "- LAST PAID:"],
        ["EXAMPLE BANK", "P.O. BOX 00001", "ANYTOWN,TX 79000", "(800) 5550100-null"])
# 2.2 derogatory, inconsistent across bureaus, no DOFD, EQ grid missing
account("2.2", "Sample Card Services (CLOSED)",
        [("Reported", "Yes", "Yes", "Yes"), ("Account Number", "xxxxxxxx 3333", "xxxxxxxx 3333", "xxxxxxxxxxxx 4444"),
         ("Account Status", "Closed", "Closed", "Closed"), ("Credit Limit", "$8,000", "$8,000", "$8,000"),
         ("Reported Balance", "$9,120", "$9,180", "$9,180")],
        summ(NA, ["0", "1", "0", "2", "0", "0", "0", "0", "0", "20"], ["0", "1", "0", "1", "0", "0", "0", "0", "0", "32"]),
        details(**{"Account Type": ("Revolving",), "Loan Type": ("creditcard", "creditcard", "unknownloantype"),
                   "Creditor Classification": ("Unknown",), "Status": ("Over 120 Days Past Due",), "Activity Designator": ("Closed",),
                   "Date Opened": ("May 01, 2024",), "Date Closed": ("Jun 01, 2026", "N/A", "Jun 01, 2026"),
                   "Date Reported": ("Jul 01, 2026", "Aug 01, 2026", "Aug 01, 2026"),
                   "Date Of Last Activity": ("Apr 01, 2026", "N/A", "Mar 01, 2026"),
                   "Term Duration": ("0",), "Term Frequency": ("N/A", "rev", "min"), "Month Reviewed": ("25", "19", "26"),
                   "Balance": ("$9,120", "$9,180", "$9,180"), "Credit Limit": ("$8,000",), "High Credit": ("$9,120", "$9,180", "$9,180"),
                   "Monthly Payment Amount": ("$250", "$90", "$90"), "Amount Past Due": ("$6,400", "$6,950", "$6,950")}),
        ["- ACCOUNT CLOSED", "- LAST REPORTED DELINQUENCIES: 08/2026=R6", "- LAST REPORTED DELINQUENCIES: 07/2026=R5,05/2026=R3",
         "- ACCOUNT CLOSED BY CREDIT GRANTOR", "- LAST PAID: 03/2026", "- 120 DAYS PAST DUE"],
        ["SAMPLE CARD SERVICES", "200 EXAMPLE AVE STE 1", "SAMPLETOWN,DE 19000", "(800) 5550200-null"],
        grids=("Experian", "TransUnion"), split_summary_at=5)
# 2.3 status current but past due > 0 on Experian
account("2.3", "Demo Credit Union",
        [("Reported", "Yes", "Yes", "Yes"), ("Account Number", "xxxxxxxxxxxx 5555", "xxxxxxxx 5555", "xxxxxxxxxxxx 5555"),
         ("Account Status", "Pays as Agreed", "Pays as Agreed", "Pays as Agreed"), ("Credit Limit", "$5,000", "$5,000", "$5,000"),
         ("Reported Balance", "$1,200", "$1,200", "$1,200")],
        summ(Z + ["12"], ["0"] * 9 + ["11"], Z + ["13"]),
        details(**{"Account Type": ("Revolving",), "Loan Type": ("creditcard",), "Creditor Classification": ("Unknown",),
                   "Status": ("Pays as Agreed",), "Activity Designator": ("Open",), "Date Opened": ("Aug 01, 2025",),
                   "Date Reported": ("Aug 01, 2026",), "Date Of Last Activity": ("Aug 01, 2026", "N/A", "Aug 01, 2026"),
                   "Term Duration": ("0",), "Term Frequency": ("N/A", "rev", "min"), "Month Reviewed": ("12", "13", "11"),
                   "Balance": ("$1,200",), "Credit Limit": ("$5,000",), "High Credit": ("$1,200",), "Monthly Payment Amount": ("$35",),
                   "Amount Past Due": ("$0", "$150", "$0")}),
        ["- CREDIT CARD", "- OPEN ACCOUNT", "- LAST PAID: 08/2026", "- THIS IS AN ACCOUNT IN GOOD STANDING"],
        ["DEMO CREDIT UNION", "ONE SAMPLE PLAZA   000001", "SAMPLEVILLE,VA 22000", "(888) 5550300-null"])
# 2.4 sparse account: reported by one bureau, no payment history / details (real-format variant)
L("2.4 Placeholder Store Card (CLOSED)")
L("Your debt-to-credit ratio represents the amount of credit you're using and make up 30% of your credit score. It's calculated")
L("by dividing an account's reported balance by it is credit limit. The idea range for your debt-to-credit ratio is 30% or less.")
L(); hdr((39, 63, 95))
for r in [("Reported", "Yes", "No", "No"), ("Account Number", "xxxxxxxxxxxx 1212", "N/A", "N/A"), ("Account Status", "Closed", "N/A", "N/A"),
          ("Credit Limit", "$1,000", "N/A", "N/A"), ("Reported Balance", "$0", "N/A", "N/A")]:
    row(*r, cols=(39, 63, 95))
L(); L(); L()
L("Payment History")
L("This tables below show up to 7 years of monthly payment history for this account. The numbers in each cell indicate the")
L("number of days a payment was due; the letters indicate other account events, such as bankruptcy or collections."); L(); L()
L("You currently have no Payment History on your credit file."); L(); L()
L("Payment Summary")
L("The tables below shows a summary of 7 years of monthly payment history for this account as reported by each bureau."); L(); L()
L("Account Details")
L("View the detailed information about this account. Contact the creditor or lender if you have any question."); L(); L()
L("You currently have no Account Details on your credit file."); L()
L("Comments".ljust(65) + "Contact")
L("- ACCOUNT PAID AND CLOSED".ljust(65) + "PLACEHOLDER STORE CARD")
L("- CLOSED OR PAID ACCOUNT/ZERO BALANCE".ljust(65) + "C O P.O. BOX 00012")
L(" " * 65 + "STORETOWN,FL 32000")
L(" " * 65 + "(866) 5551212-null")
brk()
L("3. Mortgage Accounts"); L("Mortgage accounts are real estate loans that require payment on a monthly basis until the loan is paid off."); L(); L()
account("3.1", "Demo Mortgage Co",
        [("Reported", "Yes", "Yes", "Yes"), ("Account Number", "xxxxxx 6666", "xxxxxx 6666", "xxxxxx 6666"),
         ("Account Status", "Pays as Agreed", "Pays as Agreed", "Pays as Agreed"), ("Credit Limit", "N/A", "N/A", "N/A"),
         ("Reported Balance", "$200,000", "$200,000", "$200,000")],
        summ(Z + ["0"], Z + ["0"], Z + ["0"]),
        details(**{"Account Type": ("Mortgage",), "Loan Type": ("conventionalrealestatemortgage",), "Creditor Classification": ("Unknown",),
                   "Status": ("Pays as Agreed",), "Activity Designator": ("Open",), "Date Opened": ("Mar 01, 2018",),
                   "Date Reported": ("Aug 01, 2026",), "Date Of Last Activity": ("Aug 01, 2026",),
                   "Term Duration": ("360",), "Term Frequency": ("monthly",), "Month Reviewed": ("99",),
                   "Balance": ("$200,000",), "Credit Limit": ("N/A",), "High Credit": ("$220,000",), "Monthly Payment Amount": ("$1,500",),
                   "Amount Past Due": ("$0",)}),
        ["- CONVENTIONAL REAL ESTATE MORTGAGE", "- THIS IS AN ACCOUNT IN GOOD STANDING"],
        ["DEMO MORTGAGE CO", "PO BOX 00006", "MORTGAGETOWN,FL 33000", "(800) 5550600-null"])
L("4. Installment Accounts"); L("Installment accounts are loans that require payment on a monthly basis until the loan is paid off, such as auto or student loans."); L(); L()
account("4.1", "Test Student Loan (CLOSED)",
        [("Reported", "Yes", "No", "No"), ("Account Number", "xxxxxxxxxx 7777", "N/A", "N/A"),
         ("Account Status", "Closed", "N/A", "N/A"), ("Credit Limit", "$0", "N/A", "N/A"),
         ("Reported Balance", "$0", "N/A", "N/A")],
        summ(["0", "0", "0", "3", "0", "0", "0", "0", "0", "40"], NA, NA),
        details(**{"Account Type": ("Installment", "N/A", "N/A"), "Loan Type": ("educationloan", "N/A", "N/A"),
                   "Creditor Classification": ("Unknown", "N/A", "N/A"), "Status": ("Over 120 Days Past Due", "N/A", "N/A"),
                   "Activity Designator": ("Closed", "N/A", "N/A"), "Date Opened": ("Sep 01, 2019", "N/A", "N/A"),
                   "Date Closed": ("Jan 01, 2023", "N/A", "N/A"), "Date Reported": ("Jan 01, 2023", "N/A", "N/A"),
                   "Term Duration": ("120", "N/A", "N/A"), "Month Reviewed": ("40", "N/A", "N/A"),
                   "Balance": ("$0", "N/A", "N/A"), "Credit Limit": ("$0", "N/A", "N/A"), "High Credit": ("$3,500", "N/A", "N/A"),
                   "Monthly Payment Amount": ("$0", "N/A", "N/A"), "Amount Past Due": ("$0", "N/A", "N/A")}),
        ["- TRANSFERRED TO ANOTHER LENDER", "- STUDENT LOAN"],
        ["TEST STUDENT LOAN", "PO BOX 00007", "LOANCITY,NE 68000", "(888) 5550700-null"],
        grids=("Equifax",))
L("5. Other Accounts"); L(); L()
account("5.1", "Example Bank Card (CLOSED)",
        [("Reported", "Yes", "Yes", "Yes"), ("Account Number", "xxxxxxxxxxxxx 8888", "xxxxxxxx 9999", "xxxxxxxxxxxx 8888"),
         ("Account Status", "Closed", "Closed", "Closed"), ("Credit Limit", "$0", "$0", "$0"),
         ("Reported Balance", "$4,100", "$4,100", "$4,100")],
        summ(["N/A"] * 10, Z + ["12"], ["N/A"] * 10),
        details(**{"Account Type": ("Other",), "Loan Type": ("creditcard", "unknownloantype", "creditcard"),
                   "Creditor Classification": ("Unknown",), "Status": ("Collection Account",), "Activity Designator": ("Closed",),
                   "Date Opened": ("Nov 01, 2023",), "Date Closed": ("N/A", "N/A", "Jul 01, 2026"), "Date Reported": ("Sep 01, 2026",),
                   "Date Of Last Activity": ("May 01, 2026", "N/A", "N/A"), "Term Duration": ("0", "1", "0"),
                   "Month Reviewed": ("12", "1", "0"), "Balance": ("$4,100",), "Credit Limit": ("$0",), "High Credit": ("$9,000",),
                   "Monthly Payment Amount": ("$0",), "Amount Past Due": ("$450",), "Charge Off Amount": ("$4,100",)}),
        ["- ACCOUNT CLOSED", "- COLLECTION ACCOUNT", "- DATE FIRST MAJOR DELINQUENCY REPORTED: 09/01/2026",
         "- LAST REPORTED DELINQUENCIES: 09/2026=O9", "- LAST PAID:"],
        ["EXAMPLE BANK", "P.O. BOX 00001", "ANYTOWN,TX 79000", "(800) 5550100-null"],
        grids=("Experian",))
L("6. Consumer Statements")
L("Consumer statements are personal notes of up to 100 words (200 words if you live in Maine) you can attach to your credit")
L("file to explain the circumstances behind any negative information or to dispute information you feel is incorrect even")
L("though a creditor has verified it as correct. Consumer statements are voluntary and have no impact on your credit score.")
L(); L(); L("You currently have no Consumer Statements on your credit file.")
brk()
L("7. Personal Information")
L("Creditors use your personal information primarily to identify you. This information has no impact on your credit score.")
L(); L(); L("Identification")
L("Identification is the information in your credit file that indicates your current identification as reported to Equifax, Experian,")
L("and TransUnion. It does not affect your credit score or rating."); L()
I = (39, 67, 101)
hdr(I)
row("Name", "Testperson Alex", "Testperson Alex", "Testperson Alex", I)
row("Formerly Known As", "TESTPERSON ALEX R,", "N/A", "Testperson-Smith Alex", I)
row("", "TESTPERSONSMITH", "", "", I)
row("", "ALEX", "", "", I)
row("Social Security Number", "xxxxx 0000", "xxxxx 0000", "xxxxx 0000", I)
row("Date Of Birth", "Jan 01, 1990", "Jan 01, 1990", "Jan 01, 1990", I)
L(); L(); L()
L("Contact Information")
L("Contact information is the information in your credit file that indicates your current address as reported to Equifax,")
L("Experian, and TransUnion. It does not affect your credit score or rating."); L()
C = (28, 61, 96)
hdr(C)
row("Information Reported", "Yes", "No", "No", C)
row("Address", "100 SAMPLE ST", "N/A", "N/A", C)
row("", "ANYTOWN, FL 30000", "", "", C)
row("Status", "Current", "N/A", "N/A", C)
row("Date Reported", "8/1/26", "N/A", "N/A", C)
row("Information Reported", "Yes", "Yes", "Yes", C)
row("Address", "200 EXAMPLE AVE", "300 DEMO RD", "400 PLACEHOLDER LN APT 1", C)
row("", "SAMPLEVILLE, FL 30001", "SAMPLEVILLE, FL 30002", "SAMPLEVILLE, FL 30002", C)
row("Status", "Former", "Former", "Former", C)
row("Date Reported", "7/1/26", "4/15/23", "6/12/20", C)
L(); L(); L()
L("Employment History")
L("Employment history is the information in your credit file that indicates your current and former employment as reported to")
L("Equifax, Experian, and TransUnion. It does not affect your credit score or rating."); L(); L()
L("Experian"); L()
brk()
L("Company                            Occupation                Start Date   End Date   Status    Address")
L("EXAMPLE WIDGETS LLC                N/A                       Mar 20, 2024 N/A        Current   N/A")
L(); L("TransUnion")
L("Company                            Occupation                Start Date   End Date   Status    Address")
L("EXAMPLE WIDGETS LLC                N/A                       N/A          N/A        Former    N/A")
L("SELF EMPLOYED                      N/A                       N/A          N/A        Former    N/A")
L("CONSULTANT")
brk()
L("8. Inquiries")
L("Inquiries are requests from creditors and lenders to view your credit report. Inquiries stay on your credit report for up to")
L("three years and may negatively impact your credit score."); L(); L()
L("Hard Inquiries")
L("Hard inquiries -- those made by potential creditors -- may lower your score if too many occur within a certain timeframe.")
L("Hard inquiries stay on your credit report for up to three years, but only impact your credit score for up to one year."); L(); L()
def inq(rows):
    L(" Date                                  Company                   Address")
    for d, co, a1, a2 in rows:
        L((" " + d).ljust(39) + co.ljust(26) + a1)
        L(" " * 65 + a2)
    L()
L("Equifax"); inq([("Dec 15, 2025", "DEMO CREDIT UNION", "1 SAMPLE PLAZA", "SAMPLEVILLE, VA     22000")])
L("Experian"); inq([("Oct 13, 2025", "DEMO CREDIT UNION", "1 SAMPLE PLAZA", "SAMPLEVILLE, VA 22000"),
                    ("Aug 12, 2025", "EXAMPLE BANK", "PO BOX 00001", "ANYTOWN, TX 79000"),
                    ("Aug 12, 2025", "UNKNOWN AUTO FINANCE", "PO BOX 00099", "NOWHERE, OH 44000")])
L("TransUnion"); inq([("Aug 12, 2025", "EXAMPLE BK", "P O BOX 00001", "ANYTOWN, TX 79000"),
                      ("Aug 12, 2025", "DEMO CU", "1 SAMPLE PLAZA", "SAMPLEVILLE, VA 22000")])
L(); L(); L("Soft Inquiries")
L("Soft inquiries, such as reviewing your own credit file, have no impact on your credit score. Soft inquires stay on your credit")
L("report for up to one year."); L(); L(); L("You currently have no Soft Inquiries on your credit file.")
brk()
L("9. Public Records")
L("A public record is a legal document issued by local or federal government that is typically accessible by the public. Only")
L("public records pertaining to finance will appear on your credit report. Public records stay on your credit report for 5 to 10")
L("years and have a negative impact on your credit score"); L(); L()
for kind, txt in (("Bankruptcies", "Bankruptcies are a legal status granted by a state or federal court that indicates you are unable to pay off outstanding"),
                  ("Judgments", "Judgments are a legal status granted by a small claims court that indicates you must pay back an outstanding debt."),
                  ("Liens", "A lien is a legal claim on an asset, such as your house or car, a creditor or lender can take possession of and use to pay")):
    L(kind); L(txt); L(); L(); L("You currently have no %s on your credit file." % kind); L()
brk()
L("10. Collections")
L("Collections are accounts with outstanding debt that have been sold by a creditor to a collections agency.Collections stay")
L("on your credit report for 7 years plus 180 days from the date the account first became past due. They negatively impact")
L("your credit score."); L(); L()
def coll(bureau, client, acct, split=False):
    L(bureau); L(); L("Date Reported: Sep 01, 2026"); L("Agency Client: " + client); L(); L()
    rows = [("Date Assigned", "Nov 01, 2023"), ("Original Amount Owed", "N/A"), ("Amount", "$4,100"), ("Status Date", "Sep 01, 2026"),
            ("Balance Date", "Sep 01, 2026"), ("Purge Date", "N/A"), ("Account Designator Code", "INDIVIDUAL_ACCOUNT"), ("Account Number", acct)]
    for i, (k, v) in enumerate(rows):
        if split and i == 4:
            brk(); 
            for k2, v2 in rows[4:]: L(k2.ljust(39) + v2)
            break
        L((" " + k).ljust(39) + v)
    L(); L()
coll("Equifax", "EXAMPLE BANK", "xxxxxxxxxxxxx 8888")
coll("TransUnion", "EXAMPLE BK", "xxxxxxxxxxxx 8888")
coll("Experian", "EXAMPLE BK", "xxxxxxxx 9999", split=True)
L(); L()
brk()
L("11. Dispute File Information")
L("If you believe that any of the information found on this report is incorrect, there are 3 ways to launch an investigation about")
L("the information in this report."); L(); L()
L("When you file a dispute, the credit bureau you contact is required to investigate your dispute within 30 days. They will not")
L("remove accurate data unless it is outdated or cannot be verified.")
brk()
open(__import__("sys").argv[1] if len(__import__("sys").argv) > 1 else "synthetic-3b-report.txt", "w").write("\n".join(out) + "\n")
print(len(out), "lines")
