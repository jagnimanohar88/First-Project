# LoanLedger

LoanLedger tracks loan balances, estimated interest, repayments, and due dates. Sign-ups require administrator approval. Supabase Auth and a shared Postgres database make account requests and loan records available across browsers and devices.

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

Do not make an arbitrary user an administrator. The app never lets users grant themselves admin access; initial administrator setup is an explicit database-owner action.

## Loan and payment calculations

Interest and balances are estimates: interest accrues daily at the entered annual rate on outstanding principal, with recorded payments applied to accrued interest before principal. Due-date reminders appear in the dashboard; the prototype does not send email or push reminders. This is not financial advice.
