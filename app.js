import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const config = window.LOANLEDGER_SUPABASE_CONFIG;
const configured = Boolean(config?.url && config?.anonKey &&
  !config.url.includes("YOUR_SUPABASE") && !config.anonKey.includes("YOUR_SUPABASE"));
const supabase = configured ? createClient(config.url, config.anonKey) : null;
const DAY_MS = 24 * 60 * 60 * 1000;
const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const fullCurrency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const state = { user: null, profile: null, loans: [], payments: [], pendingUsers: [], applications: [] };
let isRegistering = false;
let toastTimer;
let authNotice = "";
let authGeneration = 0;

const dayStart = (date) => new Date(`${date}T00:00:00`);
const daysBetween = (first, second) => Math.max(0, Math.floor((dayStart(second) - dayStart(first)) / DAY_MS));
const dateLabel = (date) => dateFormat.format(dayStart(date));
const initials = (name) => (name || "?").trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const findLoan = (id) => state.loans.find((loan) => loan.id === id);
const iconClass = (loan) => loan.color === "amber" ? "amber" : loan.color === "blue" ? "blue" : "";

function showAuthNotice(message, isError = false) {
  authNotice = message;
  const error = document.getElementById("auth-error");
  error.textContent = message;
  error.classList.toggle("notice-success", !isError && Boolean(message));
}

function showAuthScreen() {
  document.getElementById("auth-screen").classList.remove("hidden");
  document.getElementById("app").classList.add("hidden");
}

async function signOutLocally() {
  if (supabase) {
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) throw error;
  }
  state.user = null;
  state.profile = null;
  state.loans = [];
  state.payments = [];
  state.pendingUsers = [];
  state.applications = [];
  showAuthScreen();
}

async function loadSignedInSession(session, generation) {
  if (!session?.user) {
    state.user = null;
    state.profile = null;
    state.loans = [];
    state.payments = [];
    state.pendingUsers = [];
    state.applications = [];
    showAuthScreen();
    if (authNotice) showAuthNotice(authNotice);
    return;
  }

  state.user = session.user;
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, full_name, email, approval_status, role")
    .eq("id", session.user.id)
    .single();

  if (generation !== authGeneration) return;
  if (error) {
    console.error("Could not load your account profile.", error);
    showAuthNotice(`We couldn't load your account profile: ${error.message}`, true);
    showAuthScreen();
    await signOutLocally();
    return;
  }

  state.profile = profile;
  if (profile.approval_status !== "approved") {
    const message = profile.approval_status === "rejected"
      ? "Your access request was declined. Please contact the administrator."
      : "Your account is awaiting approval. You can sign in after the administrator approves it.";
    authNotice = message;
    showAuthScreen();
    await signOutLocally();
    if (generation !== authGeneration) return;
    showAuthNotice(message);
    return;
  }

  authNotice = "";
  await refreshDashboard(generation);
}

async function refreshDashboard(generation = authGeneration) {
  if (!state.user || !state.profile) return;
  const [loansResult, paymentsResult, applicationsResult] = await Promise.all([
    supabase.from("loans").select("*").order("created_at", { ascending: false }),
    supabase.from("payments").select("*").order("payment_date", { ascending: false }),
    supabase.from("loan_applications")
      .select("*, profiles!loan_applications_user_id_fkey(full_name, email)")
      .order("created_at", { ascending: false })
  ]);
  if (generation !== authGeneration) return;
  if (loansResult.error) throw loansResult.error;
  if (paymentsResult.error) throw paymentsResult.error;
  if (applicationsResult.error) throw applicationsResult.error;

  state.loans = loansResult.data;
  state.payments = paymentsResult.data;
  state.applications = applicationsResult.data;
  if (state.profile.role === "admin") {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name, email, created_at")
      .eq("approval_status", "pending")
      .order("created_at", { ascending: true });
    if (generation !== authGeneration) return;
    if (error) throw error;
    state.pendingUsers = data;
  } else {
    state.pendingUsers = [];
  }
  render();
}

async function handleAuthChange(session) {
  const generation = ++authGeneration;
  try {
    await loadSignedInSession(session, generation);
  } catch (error) {
    console.error("Could not load LoanLedger data.", error);
    if (state.user) {
      if (!document.getElementById("app").classList.contains("hidden")) {
        showToast(`Could not load your data: ${error.message}`);
      } else {
        const message = `Could not load your account data: ${error.message}`;
        authNotice = message;
        showAuthNotice(message, true);
        showAuthScreen();
        try {
          await signOutLocally();
        } catch (signOutError) {
          console.error("Could not clear the local session after a data loading failure.", signOutError);
        }
      }
      return;
    }
    showAuthNotice(`Could not load your account: ${error.message}`, true);
    showAuthScreen();
  }
}

function loanState(loan, asOf = new Date().toISOString().slice(0, 10)) {
  let principal = Number(loan.principal);
  let accruedInterest = 0;
  let paidInterest = 0;
  let cursor = loan.start_date;
  const payments = state.payments
    .filter((payment) => payment.loan_id === loan.id && payment.payment_date >= loan.start_date && payment.payment_date <= asOf)
    .sort((a, b) => a.payment_date.localeCompare(b.payment_date));

  for (const payment of payments) {
    accruedInterest += principal * (Number(loan.annual_rate) / 100) * daysBetween(cursor, payment.payment_date) / 365;
    cursor = payment.payment_date;
    const interestPayment = Math.min(accruedInterest, Number(payment.amount));
    accruedInterest -= interestPayment;
    paidInterest += interestPayment;
    principal -= Math.min(principal, Number(payment.amount) - interestPayment);
  }
  accruedInterest += principal * (Number(loan.annual_rate) / 100) * daysBetween(cursor, asOf) / 365;
  return { principal: Math.max(0, principal), accruedInterest: Math.max(0, accruedInterest), paidInterest, balance: Math.max(0, principal + accruedInterest) };
}

function statusFor(loan) {
  const today = new Date().toISOString().slice(0, 10);
  const days = daysBetween(today, loan.due_date);
  const isOverdue = dayStart(loan.due_date) < dayStart(today);
  if (isOverdue && loanState(loan).balance > 0) return { label: "Overdue", className: "overdue", days: 0 };
  if (days <= 7 && loanState(loan).balance > 0) return { label: days === 0 ? "Due today" : `Due in ${days} day${days === 1 ? "" : "s"}`, className: "due-soon", days };
  return { label: "On track", className: "", days };
}

function totalPaid(loanId) {
  return state.payments.filter((payment) => payment.loan_id === loanId).reduce((sum, payment) => sum + Number(payment.amount), 0);
}

function paymentProgress(loan) {
  const total = Number(loan.principal) + loanState(loan).paidInterest;
  return total > 0 ? Math.min(100, Math.round(totalPaid(loan.id) / total * 100)) : 100;
}

function render() {
  if (!state.user || !state.profile) return;
  const user = state.profile;
  document.getElementById("auth-screen").classList.add("hidden");
  document.getElementById("app").classList.remove("hidden");
  document.getElementById("sidebar-name").textContent = user.full_name;
  document.getElementById("sidebar-role").textContent = user.role === "admin" ? "Administrator" : "Approved member";
  document.getElementById("sidebar-avatar").textContent = initials(user.full_name);
  document.getElementById("top-avatar").textContent = initials(user.full_name);
  document.querySelectorAll(".admin-only").forEach((el) => el.classList.toggle("hidden", user.role !== "admin"));
  document.querySelectorAll(".member-only").forEach((el) => el.classList.toggle("hidden", user.role === "admin"));
  document.getElementById("applications-nav-label").textContent = user.role === "admin" ? "Loan applications" : "Apply for a loan";
  document.getElementById("application-count").textContent = state.applications.filter((application) => application.status === "pending").length;
  document.getElementById("application-count").classList.toggle("hidden", user.role !== "admin" || !state.applications.some((application) => application.status === "pending"));
  document.getElementById("applications-heading").textContent = user.role === "admin" ? "Loan applications" : "Apply for a loan";
  document.getElementById("applications-description").textContent = user.role === "admin"
    ? "Review loan requests from approved members."
    : "Submit your requested loan terms for administrator review.";
  document.getElementById("applications-list-heading").textContent = user.role === "admin" ? "Submitted applications" : "Your applications";
  document.getElementById("applications-list-description").textContent = user.role === "admin"
    ? "Approve a request to add it to the member's loans, or reject it."
    : "Track the review status of your requests.";
  document.getElementById("approval-count").textContent = state.pendingUsers.length;
  document.getElementById("approval-count").classList.toggle("hidden", state.pendingUsers.length === 0);
  const hour = new Date().getHours();
  document.getElementById("greeting").textContent = `${hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"}, ${user.full_name.split(" ")[0]}.`;
  document.getElementById("today-label").textContent = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }).toUpperCase();
  renderOverview();
  renderLoans();
  renderPayments();
  renderApprovals();
  renderApplications();
  renderReminder();
}

function renderReminder() {
  const banner = document.getElementById("reminder-banner");
  const upcoming = state.loans.map((loan) => ({ loan, status: statusFor(loan) }))
    .filter(({ loan, status }) => loanState(loan).balance > 0 && (status.className === "overdue" || status.className === "due-soon"))
    .sort((a, b) => a.loan.due_date.localeCompare(b.loan.due_date));
  if (!upcoming.length) {
    banner.classList.add("hidden");
    return;
  }
  const { loan, status } = upcoming[0];
  banner.classList.remove("hidden");
  banner.classList.toggle("overdue-banner", status.className === "overdue");
  banner.innerHTML = `<span>${status.className === "overdue" ? "!" : "◷"}</span><span><strong>${status.className === "overdue" ? "Payment overdue" : "Payment coming up"}:</strong> ${escapeHtml(loan.name)} · ${fullCurrency.format(loan.monthly_payment)} · ${status.className === "overdue" ? `was due ${dateLabel(loan.due_date)}` : `due ${status.days === 0 ? "today" : dateLabel(loan.due_date)}`}</span>`;
}

function renderOverview() {
  const balances = state.loans.map((loan) => loanState(loan));
  const totalBalance = balances.reduce((sum, result) => sum + result.balance, 0);
  const interest = balances.reduce((sum, result) => sum + result.accruedInterest, 0);
  const paid = state.payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
  const next = state.loans.filter((loan) => loanState(loan).balance > 0).sort((a, b) => a.due_date.localeCompare(b.due_date))[0];
  document.getElementById("metric-balance").textContent = currency.format(totalBalance);
  document.getElementById("metric-interest").textContent = currency.format(interest);
  document.getElementById("metric-paid").textContent = currency.format(paid);
  document.getElementById("metric-due").textContent = next ? currency.format(next.monthly_payment) : currency.format(0);
  document.getElementById("metric-due-date").textContent = next ? `Due ${dateLabel(next.due_date)} · ${next.name}` : "No upcoming payments";

  document.getElementById("overview-loans").innerHTML = state.loans.length ? state.loans.slice(0, 4).map((loan) => {
    const result = loanState(loan);
    const progress = paymentProgress(loan);
    return `<div class="loan-row"><div class="loan-identity"><span class="lender-icon ${iconClass(loan)}">${loan.color === "amber" ? "⌂" : loan.color === "blue" ? "▤" : "↗"}</span><div><strong>${escapeHtml(loan.name)}</strong><span>${escapeHtml(loan.lender)}</span></div></div><div class="progress-wrap"><div class="progress-label"><span>Repaid</span><strong>${progress}%</strong></div><div class="progress-track"><div class="progress-bar" style="width:${progress}%"></div></div></div><div class="loan-balance"><strong>${currency.format(result.balance)}</strong><span>remaining</span></div></div>`;
  }).join("") : emptyState("◫", "Your first loan starts here.", "Add a loan to see balances and repayment progress.");

  const upcoming = state.loans.filter((loan) => loanState(loan).balance > 0).sort((a, b) => a.due_date.localeCompare(b.due_date)).slice(0, 3);
  document.getElementById("upcoming-list").innerHTML = upcoming.length ? upcoming.map((loan) => {
    const due = dayStart(loan.due_date);
    const status = statusFor(loan);
    return `<div class="upcoming-item"><div class="date-block"><span>${due.toLocaleDateString("en-US", { month: "short" })}</span><strong>${due.getDate()}</strong></div><div class="upcoming-info"><strong>${escapeHtml(loan.name)}</strong><span class="status-pill ${status.className}">${status.label}</span></div><span class="upcoming-amount">${currency.format(loan.monthly_payment)}</span></div>`;
  }).join("") : emptyState("◷", "All clear.", "Add a loan to see upcoming due dates.");

  const recent = state.payments.slice().sort((a, b) => b.payment_date.localeCompare(a.payment_date)).slice(0, 4);
  document.getElementById("recent-payments").innerHTML = paymentTable(recent);
}

function renderLoans() {
  document.getElementById("loan-count-label").textContent = `${state.loans.length} loan${state.loans.length === 1 ? "" : "s"} · Interest estimates update daily`;
  document.getElementById("all-loans").innerHTML = state.loans.length ? state.loans.map((loan) => {
    const result = loanState(loan);
    const status = statusFor(loan);
    const progress = paymentProgress(loan);
    const paid = totalPaid(loan.id);
    return `<article class="loan-card"><div class="loan-card-top"><div class="loan-identity"><span class="lender-icon ${iconClass(loan)}">${loan.color === "amber" ? "⌂" : loan.color === "blue" ? "▤" : "↗"}</span><div><strong>${escapeHtml(loan.name)}</strong><span>${escapeHtml(loan.lender)}</span></div></div><span class="status-pill ${status.className}">${status.label}</span></div><div class="loan-card-balance">${fullCurrency.format(result.balance)}</div><div class="loan-card-sub">estimated remaining balance</div><div class="loan-card-progress progress-wrap"><div class="progress-label"><span>${fullCurrency.format(paid)} repaid</span><strong>${progress}%</strong></div><div class="progress-track"><div class="progress-bar" style="width:${progress}%"></div></div></div><div class="loan-card-meta"><span>${Number(loan.annual_rate).toFixed(2)}% annual interest</span><span>${fullCurrency.format(result.accruedInterest)} accrued</span></div><div class="loan-card-meta"><span>Next due ${dateLabel(loan.due_date)}</span><span>${fullCurrency.format(loan.monthly_payment)} / month</span></div><div class="loan-card-actions"><button class="small-action" data-action="edit-due" data-id="${loan.id}">Update due date</button><button class="small-action" data-action="add-payment" data-id="${loan.id}">Record payment</button></div></article>`;
  }).join("") : emptyState("◫", "No loans to show yet.", "Add your first loan to keep the balance and due date in one place.");
}

function paymentTable(payments) {
  if (!payments.length) return emptyState("↗", "No payments recorded yet.", "When you make a repayment, add it here to update your balance.");
  const rows = payments.map((payment) => {
    const loan = findLoan(payment.loan_id);
    const name = loan ? loan.name : "Loan removed";
    return `<tr><td><div class="table-loan"><span class="table-mini-icon">↗</span>${escapeHtml(name)}</div></td><td>${dateLabel(payment.payment_date)}</td><td>${escapeHtml(payment.note || "Repayment")}</td><td class="payment-amount">−${fullCurrency.format(payment.amount)}</td></tr>`;
  }).join("");
  return `<div class="table-wrap"><table class="data-table"><thead><tr><th>LOAN</th><th>DATE</th><th>NOTE</th><th>AMOUNT</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderPayments() {
  document.getElementById("payments-total").textContent = currency.format(state.payments.reduce((sum, payment) => sum + Number(payment.amount), 0));
  document.getElementById("payments-count").textContent = state.payments.length;
  document.getElementById("all-payments").innerHTML = paymentTable(state.payments);
}

function renderApprovals() {
  document.getElementById("pending-approvals").innerHTML = state.pendingUsers.length ? state.pendingUsers.map((account) =>
    `<div class="approval-row"><div class="approval-person"><div class="avatar">${initials(account.full_name)}</div><div><strong>${escapeHtml(account.full_name)}</strong><span>${escapeHtml(account.email)} · Requested ${dateLabel(account.created_at.slice(0, 10))}</span></div></div><div class="approval-actions"><button class="reject-button" data-action="reject-user" data-id="${account.id}">Reject</button><button class="approve-button" data-action="approve-user" data-id="${account.id}">Approve access</button></div></div>`
  ).join("") : emptyState("✓", "No pending requests.", "New account requests will appear here for your review.");
}

function renderApplications() {
  const container = document.getElementById("loan-applications");
  if (!state.applications.length) {
    container.innerHTML = emptyState("▣", "No loan applications yet.", state.profile.role === "admin"
      ? "Submitted loan requests will appear here."
      : "Submit an application to request a loan.");
    return;
  }
  const applications = state.applications.slice().sort((a, b) => {
    if (a.status === "pending" && b.status !== "pending") return -1;
    if (a.status !== "pending" && b.status === "pending") return 1;
    return b.created_at.localeCompare(a.created_at);
  });
  container.innerHTML = applications.map((application) => {
    const profile = application.profiles;
    const isAdmin = state.profile.role === "admin";
    const statusLabel = application.status[0].toUpperCase() + application.status.slice(1);
    const actions = isAdmin && application.status === "pending"
      ? `<div class="approval-actions"><button class="reject-button" data-action="reject-loan-application" data-id="${application.id}">Reject</button><button class="approve-button" data-action="approve-loan-application" data-id="${application.id}">Approve loan</button></div>`
      : "";
    const applicant = isAdmin && profile
      ? `<div class="application-applicant">${escapeHtml(profile.full_name)} · ${escapeHtml(profile.email)}</div>`
      : "";
    return `<article class="application-row"><div class="application-main"><div class="application-title"><strong>${escapeHtml(application.name)}</strong><span class="status-pill ${application.status === "pending" ? "due-soon" : application.status === "rejected" ? "overdue" : ""}">${statusLabel}</span></div>${applicant}<div class="application-lender">${escapeHtml(application.lender)} · Requested ${dateLabel(application.created_at.slice(0, 10))}</div><div class="application-terms"><span>${fullCurrency.format(application.requested_amount)} requested</span><span>${Number(application.annual_rate).toFixed(2)}% annual interest</span><span>${fullCurrency.format(application.monthly_payment)} / month</span><span>First due ${dateLabel(application.due_date)}</span></div></div>${actions}</article>`;
  }).join("");
}

function emptyState(symbol, title, description) {
  return `<div class="empty-state"><span class="empty-symbol">${symbol}</span><strong>${title}</strong><br>${description}</div>`;
}

async function showView(view) {
  if (view === "approvals" && state.profile?.role !== "admin") return;
  if (view === "applications" && !state.profile) return;
  document.querySelectorAll(".view").forEach((section) => section.classList.toggle("active", section.id === `view-${view}`));
  document.querySelectorAll(".nav-link[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  const active = document.getElementById(`view-${view}`);
  if (active) document.getElementById("breadcrumb-current").textContent = active.querySelector("h1")?.textContent || "Overview";
  document.getElementById("sidebar").classList.remove("open");
  if (view === "applications" && state.profile.role === "admin") {
    try {
      await refreshDashboard();
    } catch (error) {
      console.error("Could not refresh loan applications.", error);
      showToast(`Could not refresh applications: ${error.message}`);
    }
  }
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 3200);
}

function switchAuthMode(register) {
  isRegistering = register;
  document.getElementById("auth-title").textContent = register ? "Create your account." : "Good to see you.";
  document.getElementById("auth-description").textContent = register ? "Your account will be ready after the owner approves it." : "Sign in to pick up where you left off.";
  document.getElementById("auth-name").classList.toggle("hidden", !register);
  document.getElementById("auth-name-label").classList.toggle("hidden", !register);
  document.getElementById("auth-name").required = register;
  document.getElementById("auth-password").autocomplete = register ? "new-password" : "current-password";
  document.getElementById("auth-submit").innerHTML = register ? "Request access <span>→</span>" : "Sign in <span>→</span>";
  document.getElementById("auth-switch-copy").textContent = register ? "Already have access?" : "New to LoanLedger?";
  document.getElementById("auth-switch").textContent = register ? "Sign in" : "Create an account";
  showAuthNotice(authNotice);
}

function setBusy(busy) {
  document.querySelectorAll("#auth-form input, #auth-form button").forEach((element) => { element.disabled = busy; });
}

function showConfigurationMessage() {
  document.getElementById("auth-title").textContent = "Connect your Supabase project.";
  document.getElementById("auth-description").textContent = "Add your project URL and public anon key in supabase-config.js, then reload this page.";
  document.getElementById("auth-form").classList.add("hidden");
  document.getElementById("auth-switch").classList.add("hidden");
  document.getElementById("auth-switch-copy").classList.add("hidden");
  document.getElementById("auth-error").textContent = "Setup required: follow the Supabase instructions in README.md.";
}

function openModal(title, description, fields, submitText, onSubmit) {
  const layer = document.getElementById("modal-layer");
  layer.classList.remove("hidden");
  layer.innerHTML = `<section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-head"><div><h2 id="modal-title">${title}</h2><p>${description}</p></div><button type="button" class="icon-button modal-close" aria-label="Close dialog">×</button></div><form class="modal-form">${fields}<p class="form-error" id="modal-error" role="alert"></p><button type="submit" class="button button-dark button-wide">${submitText}</button></form></section>`;
  layer.querySelector(".modal-close").addEventListener("click", closeModal);
  layer.addEventListener("click", (event) => { if (event.target === layer) closeModal(); }, { once: true });
  layer.querySelector("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = layer.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      const result = await onSubmit(new FormData(event.currentTarget));
      if (result === false) {
        submit.disabled = false;
        return;
      }
      closeModal();
      await refreshDashboard();
      showToast(result || "Saved successfully.");
    } catch (error) {
      console.error("Unable to save the requested change.", error);
      const errorElement = document.getElementById("modal-error");
      if (errorElement) errorElement.textContent = error.message;
      submit.disabled = false;
    }
  });
  layer.querySelector("input, select")?.focus();
}

function closeModal() {
  const layer = document.getElementById("modal-layer");
  layer.classList.add("hidden");
  layer.innerHTML = "";
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function openLoanModal() {
  if (state.profile?.role !== "admin") return;
  const today = todayISO();
  openModal("Add a loan", "Add the terms you want to keep track of.", `
    <label for="loan-name" class="field-full">Loan name</label><input id="loan-name" name="name" class="field-full" placeholder="e.g. Home loan" required maxlength="55">
    <label for="loan-lender" class="field-full">Lender</label><input id="loan-lender" name="lender" class="field-full" placeholder="e.g. Your bank" required maxlength="55">
    <label for="loan-principal" class="field-half">Original amount</label><label for="loan-rate" class="field-half">Annual interest (%)</label>
    <input id="loan-principal" name="principal" class="field-half" type="number" min="0.01" step="0.01" placeholder="15000" required><input id="loan-rate" name="rate" class="field-half" type="number" min="0" max="100" step="0.01" placeholder="5.5" required>
    <label for="loan-payment" class="field-half">Monthly payment</label><label for="loan-date" class="field-half">Next due date</label>
    <input id="loan-payment" name="payment" class="field-half" type="number" min="0.01" step="0.01" placeholder="350" required><input id="loan-date" name="dueDate" class="field-half" type="date" min="${today}" required>
    <label for="loan-start" class="field-full">Loan start date</label><input id="loan-start" name="startDate" class="field-full" type="date" value="${today}" max="${today}" required>
    <p class="field-hint">We estimate simple daily interest on your remaining principal and apply recorded payments to interest before principal.</p>`, "Save loan", async (form) => {
    const loan = { name: form.get("name").trim(), lender: form.get("lender").trim(), principal: Number(form.get("principal")), annual_rate: Number(form.get("rate")), monthly_payment: Number(form.get("payment")), due_date: form.get("dueDate"), start_date: form.get("startDate"), color: ["green", "blue", "amber"][state.loans.length % 3] };
    if (loan.start_date > loan.due_date || loan.start_date > today) {
      document.getElementById("modal-error").textContent = "Choose a valid start date before the next due date.";
      return false;
    }
    const { error } = await supabase.from("loans").insert(loan);
    if (error) throw error;
    return "Loan added. You’re all set.";
  });
}

function openLoanApplicationModal() {
  if (state.profile?.role !== "member") return;
  const today = todayISO();
  openModal("Apply for a loan", "Submit your requested terms for administrator review.", `
    <label for="application-name" class="field-full">Loan name</label><input id="application-name" name="name" class="field-full" placeholder="e.g. Home loan" required maxlength="55">
    <label for="application-lender" class="field-full">Lender</label><input id="application-lender" name="lender" class="field-full" placeholder="e.g. Your bank" required maxlength="55">
    <label for="application-principal" class="field-half">Amount requested</label><label for="application-rate" class="field-half">Proposed annual interest (%)</label>
    <input id="application-principal" name="principal" class="field-half" type="number" min="0.01" step="0.01" placeholder="15000" required><input id="application-rate" name="rate" class="field-half" type="number" min="0" max="100" step="0.01" placeholder="5.5" required>
    <label for="application-payment" class="field-half">Proposed monthly payment</label><label for="application-date" class="field-half">Proposed first due date</label>
    <input id="application-payment" name="payment" class="field-half" type="number" min="0.01" step="0.01" placeholder="350" required><input id="application-date" name="dueDate" class="field-half" type="date" min="${today}" required>
    <label for="application-start" class="field-full">Proposed loan start date</label><input id="application-start" name="startDate" class="field-full" type="date" value="${today}" min="${today}" required>
    <p class="field-hint">These are requested terms only. A loan is added to your account only if an administrator approves this application.</p>`, "Submit application", async (form) => {
    const application = {
      name: form.get("name").trim(),
      lender: form.get("lender").trim(),
      requested_amount: Number(form.get("principal")),
      annual_rate: Number(form.get("rate")),
      monthly_payment: Number(form.get("payment")),
      due_date: form.get("dueDate"),
      start_date: form.get("startDate")
    };
    if (application.start_date < today || application.start_date > application.due_date) {
      document.getElementById("modal-error").textContent = "Choose a loan start date today or later, before the first due date.";
      return false;
    }
    const { error } = await supabase.from("loan_applications").insert(application);
    if (error) throw error;
    return "Application submitted for administrator review.";
  });
}

function openPaymentModal(loanId = "") {
  if (!state.loans.length) {
    showToast("Add a loan before recording a payment.");
    return;
  }
  const options = state.loans.map((loan) => `<option value="${loan.id}" ${loan.id === loanId ? "selected" : ""}>${escapeHtml(loan.name)} · ${escapeHtml(loan.lender)}</option>`).join("");
  const today = todayISO();
  openModal("Record a payment", "Add a repayment to update your loan balance.", `
    <label for="payment-loan" class="field-full">Loan</label><select id="payment-loan" name="loanId" class="field-full">${options}</select>
    <label for="payment-amount" class="field-half">Amount paid</label><label for="payment-date" class="field-half">Payment date</label>
    <input id="payment-amount" name="amount" class="field-half" type="number" min="0.01" step="0.01" placeholder="350" required><input id="payment-date" name="date" class="field-half" type="date" value="${today}" max="${today}" required>
    <label for="payment-note" class="field-full">Note (optional)</label><input id="payment-note" name="note" class="field-full" placeholder="e.g. Monthly repayment" maxlength="60">`, "Save payment", async (form) => {
    const loan = findLoan(form.get("loanId"));
    const amount = Number(form.get("amount"));
    const date = form.get("date");
    if (!loan || date < loan.start_date || date > today) {
      document.getElementById("modal-error").textContent = "Choose a payment date between the loan start date and today.";
      return false;
    }
    if (amount > loanState(loan, today).balance + 0.01) {
      document.getElementById("modal-error").textContent = "The payment is greater than this loan’s estimated remaining balance.";
      return false;
    }
    const payment = { loan_id: loan.id, amount, payment_date: date, note: form.get("note").trim() || "Repayment" };
    const { error } = await supabase.from("payments").insert(payment);
    if (error) throw error;
    return "Payment recorded and balance updated.";
  });
}

function openDueDateModal(loanId) {
  const loan = findLoan(loanId);
  if (!loan) return;
  openModal("Update due date", `Set the next payment date for ${escapeHtml(loan.name)}.`, `
    <label for="new-due-date" class="field-full">Next due date</label><input id="new-due-date" class="field-full" name="dueDate" type="date" value="${loan.due_date}" required>`, "Save due date", async (form) => {
    const { error } = await supabase.from("loans").update({ due_date: form.get("dueDate") }).eq("id", loan.id);
    if (error) throw error;
    return "Next due date updated.";
  });
}

document.getElementById("auth-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!supabase) return;
  const form = new FormData(event.currentTarget);
  const name = String(form.get("name") || "").trim();
  const email = String(form.get("email")).trim().toLowerCase();
  const password = String(form.get("password"));
  showAuthNotice("");
  setBusy(true);
  try {
    if (isRegistering) {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: name }, emailRedirectTo: window.location.origin + window.location.pathname }
      });
      if (error) throw error;
      if (data.session) {
        const { error: signOutError } = await supabase.auth.signOut({ scope: "local" });
        if (signOutError) throw signOutError;
      }
      document.getElementById("auth-form").reset();
      switchAuthMode(false);
      showAuthNotice(data.session
        ? "Request submitted. You can sign in after the administrator approves your account."
        : "Check your email to confirm your address. Your account will be ready after the administrator approves it.");
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    }
  } catch (error) {
    console.error("Sign-in or registration failed.", error);
    showAuthNotice(error.message, true);
  } finally {
    setBusy(false);
  }
});

document.getElementById("auth-switch").addEventListener("click", () => switchAuthMode(!isRegistering));
document.getElementById("toggle-password").addEventListener("click", (event) => {
  const input = document.getElementById("auth-password");
  const visible = input.type === "password";
  input.type = visible ? "text" : "password";
  event.currentTarget.textContent = visible ? "Hide" : "Show";
  event.currentTarget.setAttribute("aria-label", `${visible ? "Hide" : "Show"} password`);
});
document.getElementById("sign-out").addEventListener("click", async () => {
  try {
    await supabase.auth.signOut();
  } catch (error) {
    console.error("Sign out failed.", error);
    showToast(`Could not sign out: ${error.message}`);
  }
});
document.getElementById("menu-toggle").addEventListener("click", () => document.getElementById("sidebar").classList.toggle("open"));
document.querySelectorAll(".nav-link[data-view]").forEach((button) => button.addEventListener("click", () => { void showView(button.dataset.view); }));
document.querySelectorAll("[data-navigate]").forEach((button) => button.addEventListener("click", () => showView(button.dataset.navigate)));
document.addEventListener("click", async (event) => {
  const action = event.target.closest("[data-action]");
  if (!action) return;
  if (action.dataset.action === "add-loan") openLoanModal();
  if (action.dataset.action === "apply-loan") openLoanApplicationModal();
  if (action.dataset.action === "add-payment") openPaymentModal(action.dataset.id || "");
  if (action.dataset.action === "edit-due") openDueDateModal(action.dataset.id);
  if (["approve-user", "reject-user"].includes(action.dataset.action) && state.profile?.role === "admin") {
    const approved = action.dataset.action === "approve-user";
    action.disabled = true;
    try {
      const { error } = await supabase.rpc("set_account_approval", { target_user_id: action.dataset.id, approve: approved });
      if (error) throw error;
      await refreshDashboard();
      showToast(approved ? "Account approved. Ask the user to sign in again; no email is sent." : "Access request declined.");
    } catch (error) {
      console.error("Could not update account approval.", error);
      showToast(`Could not update approval: ${error.message}`);
      action.disabled = false;
    }
  }
  if (["approve-loan-application", "reject-loan-application"].includes(action.dataset.action) && state.profile?.role === "admin") {
    const approve = action.dataset.action === "approve-loan-application";
    action.disabled = true;
    try {
      const { error } = await supabase.rpc("review_loan_application", {
        target_application_id: action.dataset.id,
        approve
      });
      if (error) throw error;
      await refreshDashboard();
      showToast(approve ? "Loan application approved and added to the member's loans." : "Loan application rejected.");
    } catch (error) {
      console.error("Could not review loan application.", error);
      showToast(`Could not review application: ${error.message}`);
      action.disabled = false;
    }
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeModal();
    document.getElementById("sidebar").classList.remove("open");
  }
});

if (!configured) {
  showConfigurationMessage();
} else {
  supabase.auth.onAuthStateChange((_event, session) => {
    setTimeout(() => handleAuthChange(session), 0);
  });
}
