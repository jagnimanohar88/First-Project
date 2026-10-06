# LoanLedger

LoanLedger tracks loan balances, estimated interest, repayments, and due dates in Indian rupees (INR). Sign-ups require administrator approval. Members can submit loan applications for administrator approval; an approved application creates the loan on the member's account. Members can also request approval for interest-only or regular payments. Supabase Auth and a shared Postgres database make account requests, loan applications, payment requests, and loan records available across browsers and devices.

## Set up Supabase

1. Create a Supabase project at [supabase.com](https://supabase.com/).
2. In the Supabase SQL Editor, run the contents of [`supabase/schema.sql`](supabase/schema.sql). This creates the account profiles, loan and payment tables, account-approval function, and row-level security policies.
3. In **Project Settings → API**, copy the project URL and the public publishable (or legacy `anon`) key into `supabase-config.js`:

   ```js
   window.LOANLEDGER_SUPABASE_CONFIG = {
     url: "https://your-project-ref.supabase.co",
     anonKey: "your-public-publishable-or-anon-key"
   };
   ```

   The URL and publishable/anon key are intended to be used by a public browser app. Never put a `service_role` key or database password in this repository or browser code. Database row-level security is what protects account data.
4. In Supabase **Authentication → URL Configuration**, set the site URL and add `https://jagnimanohar88.github.io/First-Project/` as an allowed redirect URL. Configure email delivery if email confirmation is enabled.
5. Deploy the updated site to GitHub Pages. The Pages workflow deploys changes merged to `main`.

## Set up the administrator

1. Open the deployed site and create an account using the email address you will use as the administrator. Confirm the email first if confirmation is enabled.
2. In the Supabase SQL Editor, promote that account by running this query with your email address:

   ```sql
   update public.profiles
   set role = 'admin', approval_status = 'approved'
   where email = 'you@example.com';
   ```

3. Sign in to LoanLedger again. The **Access requests** section lists sign-ups from every browser. Approve or reject a request there; approved users can sign in from their own devices. Approval does not send an email, so let the user know they can sign in.
4. Approved members can use **Apply for a loan** to submit the requested amount and repayment term in months. During review, the administrator sets the approved amount (up to the requested amount), monthly interest rate, and first due date. The app calculates and previews the monthly interest amount in INR from the approved principal and entered rate; interest scales down proportionally as principal is repaid. In **Loan applications**, approving creates the loan with those terms in the member's account; rejecting records the decision without adding a loan. Members cannot create tracked loans directly or approve their own applications.
5. Administrators can open **Member loans** to see approved external members, their active loan balances, due dates, estimated interest, and repayment history. **Delete all loans** permanently removes a member's loan records along with their recorded payments and payment requests after confirmation. Members continue to see only their own loans and payments.
6. External members can submit an interest-only payment request (which leaves principal unchanged) or a regular payment request (which pays accrued interest first and reduces principal with any remainder). Find **Payment requests** in the administrator workspace to approve a verified payment or reject it. A request affects loan balances and payment history only after approval; members can see request statuses under **Payments**. Only an administrator can change a loan's due date.

Do not make an arbitrary user an administrator. The app never lets users grant themselves admin access; initial administrator setup is an explicit database-owner action.

If you already ran `supabase/schema.sql`, run the updated file again in the Supabase SQL Editor to add the application and payment-request workflows, administrator loan/payment tracking and deletion, and the corresponding row-level security policies. This migration makes new applications store a requested term and leaves the approved amount, monthly interest rate, and due date for administrator approval. Members can no longer record a payment directly; approved payment requests are recorded by the administrator review function.

## Loan and payment calculations

Interest and balances are estimates: older loans accrue daily at their annual rate on outstanding principal. Newly approved applications use the administrator-entered monthly interest rate, prorated daily and scaled to outstanding principal; the interface shows the current month's calculated interest amount in INR, not a separate installment amount. Interest-only requests may cover the monthly interest amount even when it has not fully accrued yet; an approved early payment is carried forward as an interest credit and does not reduce principal. Regular payments are applied to accrued interest first, with any remainder reducing principal. Loan balances and payment history show principal and interest separately for members and administrators. Due-date reminders appear in the dashboard; the prototype does not send email or push reminders. This is not financial advice.
