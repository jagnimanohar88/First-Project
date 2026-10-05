# LoanLedger

A browser-only prototype for tracking loans, interest, repayments, due dates, and account approvals.

## Run locally

Open `index.html` in a modern browser. No build step or external dependencies are required.

## Public demo

After GitHub Pages is enabled and the deployment workflow has completed, visit:

<https://jagnimanohar88.github.io/First-Project/>

The demo is public. Its sample account and all data are stored only in each visitor's browser, so registrations, approvals, loans, and payments are not shared between users. Do not enter real credentials or financial information.

Use the demo account to explore the dashboard:

- Email: `demo@loanledger.local`
- Password: `demo123`

From **Access requests**, the demo administrator can approve accounts created from the sign-in screen in that same browser. Approved accounts can then sign in there. **This is not a production authentication system or a secure multi-user service.**

Interest and balances are estimates: interest accrues daily at the entered annual rate on the outstanding principal, with repayments applied to accrued interest before principal. Due-date reminders appear in the dashboard and loan list; this prototype does not send email or push notifications.
