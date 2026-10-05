# LoanLedger

A browser-only prototype for tracking loans, interest, repayments, due dates, and account approvals.

## Run locally

Open `index.html` in a modern browser. No build step or external dependencies are required.

Use the demo account to explore the dashboard:

- Email: `demo@loanledger.local`
- Password: `demo123`

From **Access requests**, the demo administrator can approve accounts created from the sign-in screen. Approved accounts can then sign in. The app stores its demo accounts and financial records in this browser's `localStorage`; **it is not a production authentication system or a secure multi-user service**. Do not enter real credentials or sensitive financial information.

Interest and balances are estimates: interest accrues daily at the entered annual rate on the outstanding principal, with repayments applied to accrued interest before principal. Due-date reminders appear in the dashboard and loan list; this prototype does not send email or push notifications.
