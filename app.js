const STORAGE_KEY = "loanledger-prototype-v1";
const DAY_MS = 24 * 60 * 60 * 1000;
const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const fullCurrency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

const initialState = () => {
  const today = new Date();
  const daysFromNow = (days) => {
    const date = new Date(today);
    date.setDate(date.getDate() + days);
    return date.toISOString().slice(0, 10);
  };
  const start = new Date(today);
  start.setMonth(start.getMonth() - 8);
  return {
    users: [{ id: "demo-admin", name: "Demo User", email: "demo@loanledger.local", password: "demo123", approved: true, admin: true }],
    loans: [
      { id: "sample-auto", name: "Auto loan", lender: "Northstar Credit", principal: 14200, annualRate: 6.4, monthlyPayment: 435, startDate: start.toISOString().slice(0, 10), dueDate: daysFromNow(5), color: "green" },
      { id: "sample-education", name: "Education loan", lender: "Bright Path Lending", principal: 8200, annualRate: 4.8, monthlyPayment: 210, startDate: start.toISOString().slice(0, 10), dueDate: daysFromNow(18), color: "blue" }
    ],
    payments: [
      { id: "sample-payment-1", loanId: "sample-auto", amount: 435, date: daysFromNow(-24), note: "Monthly repayment" },
      { id: "sample-payment-2", loanId: "sample-education", amount: 210, date: daysFromNow(-20), note: "Monthly repayment" },
      { id: "sample-payment-3", loanId: "sample-auto", amount: 435, date: daysFromNow(-54), note: "Monthly repayment" }
    ],
    currentUserId: null
  };
};

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialState();
    const saved = JSON.parse(raw);
    if (!Array.isArray(saved.users) || !Array.isArray(saved.loans) || !Array.isArray(saved.payments)) return initialState();
    return saved;
  } catch (error) {
    console.error("Unable to load LoanLedger browser data.", error);
    return initialState();
  }
}

let state = loadState();
let isRegistering = false;
let toastTimer;
const saveState = () => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error("Unable to save LoanLedger browser data.", error);
    showToast("This browser could not save your changes.");
  }
};
const currentUser = () => state.users.find((user) => user.id === state.currentUserId) || null;
const isAdmin = () => Boolean(currentUser()?.admin);
const findLoan = (id) => state.loans.find((loan) => loan.id === id);
const dayStart = (date) => new Date(`${date}T00:00:00`);
const daysBetween = (first, second) => Math.max(0, Math.floor((dayStart(second) - dayStart(first)) / DAY_MS));
const dateLabel = (date) => dateFormat.format(dayStart(date));
const initials = (name) => (name || "?").trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const iconClass = (loan) => loan.color === "amber" ? "amber" : loan.color === "blue" ? "blue" : "";

function loanState(loan, asOf = new Date().toISOString().slice(0, 10)) {
  let principal = Number(loan.principal);
  let accruedInterest = 0;
  let paidInterest = 0;
  let principalPaid = 0;
  let cursor = loan.startDate;
  const payments = state.payments
    .filter((payment) => payment.loanId === loan.id && payment.date >= loan.startDate && payment.date <= asOf)
    .sort((a, b) => a.date.localeCompare(b.date));

  for (const payment of payments) {
    const elapsed = daysBetween(cursor, payment.date);
    accruedInterest += principal * (Number(loan.annualRate) / 100) * elapsed / 365;
    cursor = payment.date;
    const amount = Number(payment.amount);
    const interestPayment = Math.min(accruedInterest, amount);
    accruedInterest -= interestPayment;
    paidInterest += interestPayment;
    const principalPayment = Math.min(principal, amount - interestPayment);
    principal -= principalPayment;
    principalPaid += principalPayment;
  }
  accruedInterest += principal * (Number(loan.annualRate) / 100) * daysBetween(cursor, asOf) / 365;
  return {
    principal: Math.max(0, principal),
    accruedInterest: Math.max(0, accruedInterest),
    paidInterest,
    principalPaid,
    balance: Math.max(0, principal + accruedInterest),
    original: Number(loan.principal)
  };
}

function statusFor(loan) {
  const days = daysBetween(new Date().toISOString().slice(0, 10), loan.dueDate);
  const isOverdue = dayStart(loan.dueDate) < dayStart(new Date().toISOString().slice(0, 10));
  if (isOverdue && loanState(loan).balance > 0) return { label: "Overdue", className: "overdue", days: 0 };
  if (days <= 7 && loanState(loan).balance > 0) return { label: days === 0 ? "Due today" : `Due in ${days} day${days === 1 ? "" : "s"}`, className: "due-soon", days };
  return { label: "On track", className: "", days };
}

function totalPaid(loanId) {
  return state.payments.filter((payment) => payment.loanId === loanId).reduce((sum, payment) => sum + Number(payment.amount), 0);
}

function paymentProgress(loan) {
  const total = loanState(loan).original + loanState(loan).paidInterest;
  return total > 0 ? Math.min(100, Math.round(totalPaid(loan.id) / total * 100)) : 100;
}

function render() {
  if (!currentUser()) return;
  const user = currentUser();
  document.getElementById("auth-screen").classList.add("hidden");
  document.getElementById("app").classList.remove("hidden");
  document.getElementById("sidebar-name").textContent = user.name;
  document.getElementById("sidebar-role").textContent = user.admin ? "Administrator" : "Approved member";
  document.getElementById("sidebar-avatar").textContent = initials(user.name);
  document.getElementById("top-avatar").textContent = initials(user.name);
  document.querySelectorAll(".admin-only").forEach((el) => el.classList.toggle("hidden", !user.admin));
  const pendingCount = state.users.filter((account) => !account.approved).length;
  document.getElementById("approval-count").textContent = pendingCount;
  document.getElementById("approval-count").classList.toggle("hidden", pendingCount === 0);
  const today = new Date();
  const hour = today.getHours();
  document.getElementById("greeting").textContent = `${hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"}, ${user.name.split(" ")[0]}.`;
  document.getElementById("today-label").textContent = today.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }).toUpperCase();
  renderOverview();
  renderLoans();
  renderPayments();
  renderApprovals();
  renderReminder();
}

function renderReminder() {
  const banner = document.getElementById("reminder-banner");
  const upcoming = state.loans.map((loan) => ({ loan, status: statusFor(loan) }))
    .filter(({ loan, status }) => loanState(loan).balance > 0 && (status.className === "overdue" || status.className === "due-soon"))
    .sort((a, b) => a.loan.dueDate.localeCompare(b.loan.dueDate));
  if (!upcoming.length) {
    banner.classList.add("hidden");
    return;
  }
  const { loan, status } = upcoming[0];
  banner.classList.remove("hidden");
  banner.classList.toggle("overdue-banner", status.className === "overdue");
  banner.innerHTML = `<span>${status.className === "overdue" ? "!" : "◷"}</span><span><strong>${status.className === "overdue" ? "Payment overdue" : "Payment coming up"}:</strong> ${escapeHtml(loan.name)} · ${fullCurrency.format(loan.monthlyPayment)} · ${status.className === "overdue" ? `was due ${dateLabel(loan.dueDate)}` : `due ${status.days === 0 ? "today" : dateLabel(loan.dueDate)}`}</span>`;
}

function renderOverview() {
  const balances = state.loans.map((loan) => loanState(loan));
  const totalBalance = balances.reduce((sum, result) => sum + result.balance, 0);
  const interest = balances.reduce((sum, result) => sum + result.accruedInterest, 0);
  const paid = state.payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
  const next = state.loans.filter((loan) => loanState(loan).balance > 0).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
  document.getElementById("metric-balance").textContent = currency.format(totalBalance);
  document.getElementById("metric-interest").textContent = currency.format(interest);
  document.getElementById("metric-paid").textContent = currency.format(paid);
  document.getElementById("metric-due").textContent = next ? currency.format(next.monthlyPayment) : currency.format(0);
  document.getElementById("metric-due-date").textContent = next ? `Due ${dateLabel(next.dueDate)} · ${next.name}` : "No upcoming payments";

  const loans = state.loans.slice(0, 4);
  document.getElementById("overview-loans").innerHTML = loans.length ? loans.map((loan) => {
    const result = loanState(loan);
    const progress = paymentProgress(loan);
    return `<div class="loan-row"><div class="loan-identity"><span class="lender-icon ${iconClass(loan)}">${loan.color === "amber" ? "⌂" : loan.color === "blue" ? "▤" : "↗"}</span><div><strong>${escapeHtml(loan.name)}</strong><span>${escapeHtml(loan.lender)}</span></div></div><div class="progress-wrap"><div class="progress-label"><span>Repaid</span><strong>${progress}%</strong></div><div class="progress-track"><div class="progress-bar" style="width:${progress}%"></div></div></div><div class="loan-balance"><strong>${currency.format(result.balance)}</strong><span>remaining</span></div></div>`;
  }).join("") : emptyState("◫", "Your first loan starts here.", "Add a loan to see balances and repayment progress.");

  const upcoming = state.loans.filter((loan) => loanState(loan).balance > 0).sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 3);
  document.getElementById("upcoming-list").innerHTML = upcoming.length ? upcoming.map((loan) => {
    const due = dayStart(loan.dueDate);
    const status = statusFor(loan);
    return `<div class="upcoming-item"><div class="date-block"><span>${due.toLocaleDateString("en-US", { month: "short" })}</span><strong>${due.getDate()}</strong></div><div class="upcoming-info"><strong>${escapeHtml(loan.name)}</strong><span class="status-pill ${status.className}">${status.label}</span></div><span class="upcoming-amount">${currency.format(loan.monthlyPayment)}</span></div>`;
  }).join("") : emptyState("◷", "All clear.", "Add a loan to see upcoming due dates.");

  const recent = state.payments.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 4);
  document.getElementById("recent-payments").innerHTML = paymentTable(recent);
}

function renderLoans() {
  const container = document.getElementById("all-loans");
  document.getElementById("loan-count-label").textContent = `${state.loans.length} loan${state.loans.length === 1 ? "" : "s"} · Interest estimates update daily`;
  if (!state.loans.length) {
    container.innerHTML = emptyState("◫", "No loans to show yet.", "Add your first loan to keep the balance and due date in one place.");
    return;
  }
  container.innerHTML = state.loans.map((loan) => {
    const result = loanState(loan);
    const status = statusFor(loan);
    const progress = paymentProgress(loan);
    const paid = totalPaid(loan.id);
    return `<article class="loan-card"><div class="loan-card-top"><div class="loan-identity"><span class="lender-icon ${iconClass(loan)}">${loan.color === "amber" ? "⌂" : loan.color === "blue" ? "▤" : "↗"}</span><div><strong>${escapeHtml(loan.name)}</strong><span>${escapeHtml(loan.lender)}</span></div></div><span class="status-pill ${status.className}">${status.label}</span></div><div class="loan-card-balance">${fullCurrency.format(result.balance)}</div><div class="loan-card-sub">estimated remaining balance</div><div class="loan-card-progress progress-wrap"><div class="progress-label"><span>${fullCurrency.format(paid)} repaid</span><strong>${progress}%</strong></div><div class="progress-track"><div class="progress-bar" style="width:${progress}%"></div></div></div><div class="loan-card-meta"><span>${Number(loan.annualRate).toFixed(2)}% annual interest</span><span>${fullCurrency.format(result.accruedInterest)} accrued</span></div><div class="loan-card-meta"><span>Next due ${dateLabel(loan.dueDate)}</span><span>${fullCurrency.format(loan.monthlyPayment)} / month</span></div><div class="loan-card-actions"><button class="small-action" data-action="edit-due" data-id="${loan.id}">Update due date</button><button class="small-action" data-action="add-payment" data-id="${loan.id}">Record payment</button></div></article>`;
  }).join("");
}

function paymentTable(payments) {
  if (!payments.length) return emptyState("↗", "No payments recorded yet.", "When you make a repayment, add it here to update your balance.");
  const rows = payments.map((payment) => {
    const loan = findLoan(payment.loanId);
    const name = loan ? loan.name : "Loan removed";
    return `<tr><td><div class="table-loan"><span class="table-mini-icon">↗</span>${escapeHtml(name)}</div></td><td>${dateLabel(payment.date)}</td><td>${escapeHtml(payment.note || "Repayment")}</td><td class="payment-amount">−${fullCurrency.format(payment.amount)}</td></tr>`;
  }).join("");
  return `<div class="table-wrap"><table class="data-table"><thead><tr><th>LOAN</th><th>DATE</th><th>NOTE</th><th>AMOUNT</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderPayments() {
  const sorted = state.payments.slice().sort((a, b) => b.date.localeCompare(a.date));
  document.getElementById("payments-total").textContent = currency.format(sorted.reduce((sum, payment) => sum + Number(payment.amount), 0));
  document.getElementById("payments-count").textContent = sorted.length;
  document.getElementById("all-payments").innerHTML = paymentTable(sorted);
}

function renderApprovals() {
  const pending = state.users.filter((account) => !account.approved && !account.rejected);
  document.getElementById("pending-approvals").innerHTML = pending.length ? pending.map((account) =>
    `<div class="approval-row"><div class="approval-person"><div class="avatar">${initials(account.name)}</div><div><strong>${escapeHtml(account.name)}</strong><span>${escapeHtml(account.email)} · Requested ${dateLabel(account.createdAt)}</span></div></div><div class="approval-actions"><button class="reject-button" data-action="reject-user" data-id="${account.id}">Reject</button><button class="approve-button" data-action="approve-user" data-id="${account.id}">Approve access</button></div></div>`
  ).join("") : emptyState("✓", "No pending requests.", "New sign-ups will appear here for your review.");
}

function emptyState(symbol, title, description) {
  return `<div class="empty-state"><span class="empty-symbol">${symbol}</span><strong>${title}</strong><br>${description}</div>`;
}

function showView(view) {
  if (view === "approvals" && !isAdmin()) return;
  document.querySelectorAll(".view").forEach((section) => section.classList.toggle("active", section.id === `view-${view}`));
  document.querySelectorAll(".nav-link[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  const active = document.getElementById(`view-${view}`);
  if (active) document.getElementById("breadcrumb-current").textContent = active.querySelector("h1")?.textContent || "Overview";
  document.getElementById("sidebar").classList.remove("open");
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 2800);
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
  document.getElementById("auth-error").textContent = "";
}

function openModal(title, description, fields, submitText, onSubmit) {
  const layer = document.getElementById("modal-layer");
  layer.classList.remove("hidden");
  layer.innerHTML = `<section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-head"><div><h2 id="modal-title">${title}</h2><p>${description}</p></div><button type="button" class="icon-button modal-close" aria-label="Close dialog">×</button></div><form class="modal-form">${fields}<p class="form-error" id="modal-error" role="alert"></p><button type="submit" class="button button-dark button-wide">${submitText}</button></form></section>`;
  layer.querySelector(".modal-close").addEventListener("click", closeModal);
  layer.addEventListener("click", (event) => { if (event.target === layer) closeModal(); }, { once: true });
  layer.querySelector("form").addEventListener("submit", (event) => {
    event.preventDefault();
    const result = onSubmit(new FormData(event.currentTarget));
    if (result === false) return;
    closeModal();
    saveState();
    render();
    showToast(result || "Saved successfully.");
  });
  layer.querySelector("input, select")?.focus();
}

function closeModal() {
  const layer = document.getElementById("modal-layer");
  layer.classList.add("hidden");
  layer.innerHTML = "";
}

function openLoanModal() {
  const today = new Date().toISOString().slice(0, 10);
  openModal("Add a loan", "Add the terms you want to keep track of.", `
    <label for="loan-name" class="field-full">Loan name</label><input id="loan-name" name="name" class="field-full" placeholder="e.g. Home loan" required maxlength="55">
    <label for="loan-lender" class="field-full">Lender</label><input id="loan-lender" name="lender" class="field-full" placeholder="e.g. Your bank" required maxlength="55">
    <label for="loan-principal" class="field-half">Original amount</label><label for="loan-rate" class="field-half">Annual interest (%)</label>
    <input id="loan-principal" name="principal" class="field-half" type="number" min="0.01" step="0.01" placeholder="15000" required><input id="loan-rate" name="rate" class="field-half" type="number" min="0" max="100" step="0.01" placeholder="5.5" required>
    <label for="loan-payment" class="field-half">Monthly payment</label><label for="loan-date" class="field-half">Next due date</label>
    <input id="loan-payment" name="payment" class="field-half" type="number" min="0.01" step="0.01" placeholder="350" required><input id="loan-date" name="dueDate" class="field-half" type="date" min="${today}" required>
    <label for="loan-start" class="field-full">Loan start date</label><input id="loan-start" name="startDate" class="field-full" type="date" value="${today}" max="${today}" required>
    <p class="field-hint">We estimate simple daily interest on your remaining principal and apply recorded payments to interest before principal.</p>`, "Save loan", (form) => {
    const loan = { id: crypto.randomUUID(), name: form.get("name").trim(), lender: form.get("lender").trim(), principal: Number(form.get("principal")), annualRate: Number(form.get("rate")), monthlyPayment: Number(form.get("payment")), dueDate: form.get("dueDate"), startDate: form.get("startDate"), color: ["green", "blue", "amber"][state.loans.length % 3] };
    if (loan.startDate > loan.dueDate || loan.startDate > today) {
      document.getElementById("modal-error").textContent = "Choose a valid start date before the next due date.";
      return false;
    }
    state.loans.unshift(loan);
    return "Loan added. You’re all set.";
  });
}

function openPaymentModal(loanId = "") {
  if (!state.loans.length) {
    showToast("Add a loan before recording a payment.");
    return;
  }
  const options = state.loans.map((loan) => `<option value="${loan.id}" ${loan.id === loanId ? "selected" : ""}>${escapeHtml(loan.name)} · ${escapeHtml(loan.lender)}</option>`).join("");
  const today = new Date().toISOString().slice(0, 10);
  openModal("Record a payment", "Add a repayment to update your loan balance.", `
    <label for="payment-loan" class="field-full">Loan</label><select id="payment-loan" name="loanId" class="field-full">${options}</select>
    <label for="payment-amount" class="field-half">Amount paid</label><label for="payment-date" class="field-half">Payment date</label>
    <input id="payment-amount" name="amount" class="field-half" type="number" min="0.01" step="0.01" placeholder="350" required><input id="payment-date" name="date" class="field-half" type="date" value="${today}" max="${today}" required>
    <label for="payment-note" class="field-full">Note (optional)</label><input id="payment-note" name="note" class="field-full" placeholder="e.g. Monthly repayment" maxlength="60">`, "Save payment", (form) => {
    state.payments.unshift({ id: crypto.randomUUID(), loanId: form.get("loanId"), amount: Number(form.get("amount")), date: form.get("date"), note: form.get("note").trim() || "Repayment" });
    return "Payment recorded and balance updated.";
  });
}

function openDueDateModal(loanId) {
  const loan = findLoan(loanId);
  if (!loan) return;
  const today = new Date().toISOString().slice(0, 10);
  openModal("Update due date", `Set the next payment date for ${escapeHtml(loan.name)}.`, `
    <label for="new-due-date" class="field-full">Next due date</label><input id="new-due-date" class="field-full" name="dueDate" type="date" value="${loan.dueDate}" required>`, "Save due date", (form) => {
    loan.dueDate = form.get("dueDate");
    return loan.dueDate < today ? "Due date updated. This payment is now overdue." : "Next due date updated.";
  });
}

document.getElementById("auth-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const name = String(form.get("name") || "").trim();
  const email = String(form.get("email")).trim().toLowerCase();
  const password = String(form.get("password"));
  const error = document.getElementById("auth-error");
  error.textContent = "";
  if (isRegistering) {
    if (state.users.some((user) => user.email === email)) {
      error.textContent = "An account with this email already exists.";
      return;
    }
    state.users.push({ id: crypto.randomUUID(), name, email, password, approved: false, admin: false, createdAt: new Date().toISOString().slice(0, 10) });
    saveState();
    switchAuthMode(false);
    error.textContent = "Access requested. The administrator must approve your account before you can sign in.";
    return;
  }
  const account = state.users.find((user) => user.email === email && user.password === password);
  if (!account) {
    error.textContent = "That email and password combination wasn’t found.";
    return;
  }
  if (account.rejected) {
    error.textContent = "This access request was declined. Please contact the administrator.";
    return;
  }
  if (!account.approved) {
    error.textContent = "Your account is waiting for administrator approval.";
    return;
  }
  state.currentUserId = account.id;
  saveState();
  render();
});

document.getElementById("auth-switch").addEventListener("click", () => switchAuthMode(!isRegistering));
document.getElementById("toggle-password").addEventListener("click", (event) => {
  const input = document.getElementById("auth-password");
  const visible = input.type === "password";
  input.type = visible ? "text" : "password";
  event.currentTarget.textContent = visible ? "Hide" : "Show";
  event.currentTarget.setAttribute("aria-label", `${visible ? "Hide" : "Show"} password`);
});
document.getElementById("sign-out").addEventListener("click", () => {
  state.currentUserId = null;
  saveState();
  document.getElementById("app").classList.add("hidden");
  document.getElementById("auth-screen").classList.remove("hidden");
  switchAuthMode(false);
  document.getElementById("auth-password").value = "";
});
document.getElementById("menu-toggle").addEventListener("click", () => document.getElementById("sidebar").classList.toggle("open"));
document.querySelectorAll(".nav-link[data-view]").forEach((button) => button.addEventListener("click", () => showView(button.dataset.view)));
document.querySelectorAll("[data-navigate]").forEach((button) => button.addEventListener("click", () => showView(button.dataset.navigate)));
document.addEventListener("click", (event) => {
  const action = event.target.closest("[data-action]");
  if (!action) return;
  if (action.dataset.action === "add-loan") openLoanModal();
  if (action.dataset.action === "add-payment") openPaymentModal(action.dataset.id || "");
  if (action.dataset.action === "edit-due") openDueDateModal(action.dataset.id);
  if (action.dataset.action === "approve-user" && isAdmin()) {
    const account = state.users.find((user) => user.id === action.dataset.id);
    if (account) {
      account.approved = true;
      saveState();
      render();
      showToast(`${account.name} can now sign in.`);
    }
  }
  if (action.dataset.action === "reject-user" && isAdmin()) {
    const account = state.users.find((user) => user.id === action.dataset.id);
    if (account) {
      account.rejected = true;
      saveState();
      render();
      showToast("Access request declined.");
    }
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeModal();
    document.getElementById("sidebar").classList.remove("open");
  }
});

if (currentUser()) render();
