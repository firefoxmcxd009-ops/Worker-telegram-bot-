/* ══════════════════════════════════════════
   CONFIG & STATE
══════════════════════════════════════════ */
const BASE = "";  // same-origin (served by bot.js Express)
const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); }

let state = {
    projectId: null,
    password: null,
    projectName: null,
    workers: [],
    attendance: {},
    borrows: {},
    borrowHistory: [],
    totalAdvance: 0
};

let pendingBorrowWorkerId = null;
let pendingConfirmAction = null;

/* ══════════════════════════════════════════
   HELPERS
══════════════════════════════════════════ */
function fmt(n) { return Number(n).toLocaleString(); }

function getTodayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function getWeekDates() {
    const dates = [];
    const now = new Date();
    const day = now.getDay();
    const mon = new Date(now);
    mon.setDate(now.getDate() + (day === 0 ? -6 : 1 - day));
    for (let i = 0; i < 6; i++) {
        const d = new Date(mon);
        d.setDate(mon.getDate() + i);
        dates.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);
    }
    return dates;
}

function getKhmerDay(dateStr) {
    const map = ["អាទិត្យ","ចន្ទ","អង្គារ","ពុធ","ព្រហស្បតិ៍","សុក្រ","សៅរ៍"];
    return map[new Date(dateStr).getDay()];
}

function validatePassword(p) {
    return /[a-zA-Z]/.test(p) && /[0-9]/.test(p) && p.length >= 6;
}

function showToast(msg, type = "success") {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.className = `toast ${type}`;
    t.classList.remove("hidden");
    setTimeout(() => t.classList.add("hidden"), 2800);
}

function showError(id, msg) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = msg;
    el.classList.remove("hidden");
    setTimeout(() => el.classList.add("hidden"), 4000);
}

/* ══════════════════════════════════════════
   AUTH — WEB LOGIN / REGISTER
══════════════════════════════════════════ */
document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        const tab = btn.dataset.tab;
        document.getElementById("login-form").classList.toggle("active", tab === "login");
        document.getElementById("login-form").classList.toggle("hidden", tab !== "login");
        document.getElementById("register-form").classList.toggle("active", tab === "register");
        document.getElementById("register-form").classList.toggle("hidden", tab !== "register");
    });
});

async function handleWebLogin() {
    const id = document.getElementById("login-id").value.trim();
    const pass = document.getElementById("login-pass").value.trim();
    if (!id || !pass) return showError("login-error", "⚠️ សូមបំពេញ Project ID និង Password");

    try {
        const res = await fetch(`${BASE}/api/login`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ projectId: id, password: pass })
        });
        const data = await res.json();
        if (data.success) {
            state.projectId = data.id;
            state.password = pass;
            state.projectName = data.projectName;
            state.workers = data.workers || [];
            state.attendance = data.attendance || {};
            state.borrows = data.borrows || {};
            state.borrowHistory = data.borrowHistory || [];
            state.totalAdvance = data.totalAdvance || 0;
            loadApp();
        } else {
            showError("login-error", "❌ " + (data.message || "Project ID ឬ Password មិនត្រូវ"));
        }
    } catch (e) {
        showError("login-error", "❌ ចាប់ connection មិនបាន: " + e.message);
    }
}

async function handleWebRegister() {
    const name = document.getElementById("reg-name").value.trim();
    const pass = document.getElementById("reg-pass").value.trim();
    if (!name) return showError("reg-error", "⚠️ សូមបញ្ចូលឈ្មោះប្រូជេក");
    if (!validatePassword(pass)) return showError("reg-error", "⚠️ ពាក្យសម្ងាត់ = អក្សរ + លេខ ≥ ៦ ខ្ទង់");

    const telegramId = tg?.initDataUnsafe?.user?.id || null;
    try {
        const res = await fetch(`${BASE}/api/register`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ projectName: name, password: pass, creatorId: String(telegramId || "web") })
        });
        const data = await res.json();
        if (data.success) {
            state.projectId = data.projectId;
            state.password = pass;
            state.projectName = data.projectName;
            state.workers = [];
            state.attendance = {}; state.borrows = {};
            state.borrowHistory = []; state.totalAdvance = 0;
            showToast(`✅ បង្កើតជោគជ័យ! ID: ${data.projectId}`, "success");
            setTimeout(loadApp, 800);
        } else {
            showError("reg-error", "❌ " + data.message);
        }
    } catch (e) {
        showError("reg-error", "❌ " + e.message);
    }
}

/* ══════════════════════════════════════════
   AUTH — TELEGRAM AUTO-LOGIN
══════════════════════════════════════════ */
async function tryTelegramAutoLogin() {
    const telegramId = tg?.initDataUnsafe?.user?.id;
    if (!telegramId) return; // fallback to web form

    try {
        const res = await fetch(`${BASE}/api/dashboard-data?userId=${telegramId}`);
        const data = await res.json();
        if (data.success) {
            state.projectId = data.id;
            state.password = null; // no password for tg auto-login
            state.projectName = data.projectName;
            state.workers = data.workers || [];
            state.attendance = data.attendance || {};
            state.borrows = data.borrows || {};
            state.borrowHistory = data.borrowHistory || [];
            state.totalAdvance = data.totalAdvance || 0;
            loadApp();
        }
    } catch (e) {
        console.log("Telegram auto-login failed:", e.message);
    }
}

/* ══════════════════════════════════════════
   LOAD APP AFTER LOGIN
══════════════════════════════════════════ */
function loadApp() {
    document.getElementById("auth-modal").classList.remove("active");
    document.getElementById("auth-modal").style.display = "none";
    document.getElementById("main-app").classList.remove("hidden");

    // User info
    const firstName = tg?.initDataUnsafe?.user?.first_name || state.projectName || "User";
    document.getElementById("tg-username").textContent = firstName;
    document.getElementById("display-proj-name").textContent = state.projectName;
    document.getElementById("display-proj-id").textContent = state.projectId;
    document.getElementById("today-date").textContent = getTodayStr();

    renderAll();
}

function renderAll() {
    renderDashboard();
    renderWorkers();
    renderAttendance();
    renderBorrow();
    renderReport();
}

/* ══════════════════════════════════════════
   DASHBOARD VIEW
══════════════════════════════════════════ */
function renderDashboard() {
    document.getElementById("stat-workers").textContent = state.workers.length;
    document.getElementById("stat-advance").textContent = fmt(state.totalAdvance) + " ៛";

    // Total salary due this week
    const weekDates = getWeekDates();
    let totalSalary = 0, totalAbsent = 0;
    state.workers.forEach(w => {
        let pay = w.dailySalary * 6;
        weekDates.forEach(date => {
            const st = state.attendance[date]?.[w.id];
            if (st === "morning" || st === "evening") { pay -= w.dailySalary / 2; totalAbsent++; }
            if (st === "full") { pay -= w.dailySalary; totalAbsent++; }
        });
        pay -= (state.borrows[w.id] || 0);
        totalSalary += Math.max(0, pay);
    });
    document.getElementById("stat-salary").textContent = fmt(totalSalary) + " ៛";
    document.getElementById("stat-absent").textContent = totalAbsent + " ដង";

    // Recent borrow history
    const tbody = document.getElementById("history-tbody");
    if (!state.borrowHistory || state.borrowHistory.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" class="empty-cell">មិនទាន់មានប្រវត្តិ</td></tr>';
    } else {
        const recent = [...state.borrowHistory].reverse().slice(0, 8);
        tbody.innerHTML = recent.map(h => {
            const d = new Date(h.date);
            const ds = `${d.getDate()}/${d.getMonth()+1}/${d.getFullYear()}`;
            return `<tr>
                <td>${h.workerName}</td>
                <td class="text-red">−${fmt(h.amount)}៛</td>
                <td>${ds}</td>
            </tr>`;
        }).join("");
    }
}

/* ══════════════════════════════════════════
   WORKERS VIEW
══════════════════════════════════════════ */
function renderWorkers() {
    const tbody = document.getElementById("workers-tbody");
    if (state.workers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="empty-cell">មិនទាន់មានកម្មករ — ចុច "បន្ថែម" ដើម្បីចាប់ផ្តើម</td></tr>';
        return;
    }
    tbody.innerHTML = state.workers.map((w, i) => `
        <tr>
            <td>${i + 1}</td>
            <td><strong>${w.name}</strong></td>
            <td>${fmt(w.dailySalary)} ៛</td>
            <td>
                <div class="row-actions">
                    <button class="btn-sm btn-del" title="លុប" onclick="confirmDeleteWorker(${w.id}, '${w.name}')">
                        <i class="ph ph-trash"></i>
                    </button>
                </div>
            </td>
        </tr>
    `).join("");
}

function openAddWorkerModal() {
    document.getElementById("worker-input").value = "";
    document.getElementById("worker-modal-error").classList.add("hidden");
    document.getElementById("add-worker-modal").classList.remove("hidden");
}

async function saveWorkers() {
    const raw = document.getElementById("worker-input").value.trim();
    if (!raw) return showError("worker-modal-error", "⚠️ សូមវាយឈ្មោះ + ប្រាក់ថ្ងៃ");

    const lines = raw.split("\n").filter(l => l.trim());
    const toAdd = [];
    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].trim().match(/^(.+)\s+(\d+)$/);
        if (!m) return showError("worker-modal-error", `❌ បន្ទាត់ ${i+1}: ខុសទម្រង់ (ឧ: "សុខា 80000")`);
        if (Number(m[2]) <= 0) return showError("worker-modal-error", `❌ ប្រាក់ > 0`);
        toAdd.push({ name: m[1].trim(), dailySalary: Number(m[2]) });
    }

    let allOk = true;
    for (const w of toAdd) {
        try {
            const res = await fetch(`${BASE}/api/add-worker`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ projectId: state.projectId, password: state.password || "_tg_", name: w.name, dailySalary: w.dailySalary })
            });
            const data = await res.json();
            if (data.success) {
                state.workers = data.workers;
            } else { allOk = false; }
        } catch (e) { allOk = false; }
    }
    closeModal("add-worker-modal");
    if (allOk) showToast(`✅ បន្ថែមកម្មករ ${toAdd.length} នាក់`);
    else showToast("⚠️ មានខ្លះបានបន្ថែម", "error");
    renderAll();
}

function confirmDeleteWorker(id, name) {
    document.getElementById("confirm-title").textContent = `លុប "${name}"?`;
    document.getElementById("confirm-desc").textContent = "ប្រាក់បើកមុននឹងត្រូវបានលុបផងដែរ";
    pendingConfirmAction = () => deleteWorker(id, name);
    document.getElementById("confirm-modal").classList.remove("hidden");
}

async function deleteWorker(id, name) {
    closeModal("confirm-modal");
    try {
        const res = await fetch(`${BASE}/api/delete-worker`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ projectId: state.projectId, password: state.password || "_tg_", workerId: id })
        });
        const data = await res.json();
        if (data.success) {
            state.workers = data.workers;
            delete state.borrows[id];
            state.totalAdvance = Object.values(state.borrows).reduce((a,b)=>a+b,0);
            showToast(`🗑 លុប ${name} ចេញ`);
            renderAll();
        }
    } catch(e) { showToast("❌ " + e.message, "error"); }
}

/* ══════════════════════════════════════════
   ATTENDANCE VIEW
══════════════════════════════════════════ */
function renderAttendance() {
    const grid = document.getElementById("attendance-grid");
    if (state.workers.length === 0) {
        grid.innerHTML = '<p style="color:var(--text-2); text-align:center; padding:2rem">មិនទាន់មានកម្មករ</p>';
        return;
    }
    const today = getTodayStr();
    grid.innerHTML = state.workers.map(w => {
        const st = state.attendance[today]?.[w.id] || "present";
        const labels = { present:"✅ មក", morning:"🌅 ព្រឹក", evening:"🌙 ល្ងាច", full:"❌ ពេញ" };
        const statusClass = { present:"status-present", morning:"status-morning", evening:"status-evening", full:"status-full" };
        return `
        <div class="worker-att-card" id="att-card-${w.id}">
            <div class="card-header">
                <div class="worker-avatar">${w.name.charAt(0)}</div>
                <div>
                    <div class="card-worker-name">${w.name}</div>
                    <div class="card-worker-salary">${fmt(w.dailySalary)} ៛/ថ្ងៃ</div>
                </div>
                <span class="card-status-label ${statusClass[st]}" id="att-status-${w.id}">${labels[st]}</span>
            </div>
            <div class="card-att-btns">
                <button class="att-btn present" onclick="setAttendance(${w.id}, 'present')">✅ មក</button>
                <button class="att-btn morning" onclick="setAttendance(${w.id}, 'morning')">🌅 ព្រឹក</button>
                <button class="att-btn evening" onclick="setAttendance(${w.id}, 'evening')">🌙 ល្ងាច</button>
                <button class="att-btn full" onclick="setAttendance(${w.id}, 'full')">❌ ពេញ</button>
            </div>
        </div>`;
    }).join("");
}

async function setAttendance(workerId, status) {
    const today = getTodayStr();
    // Optimistic update
    if (!state.attendance[today]) state.attendance[today] = {};
    state.attendance[today][workerId] = status;
    const labels = { present:"✅ មក", morning:"🌅 ព្រឹក", evening:"🌙 ល្ងាច", full:"❌ ពេញ" };
    const statusClass = { present:"status-present", morning:"status-morning", evening:"status-evening", full:"status-full" };
    const badge = document.getElementById(`att-status-${workerId}`);
    if (badge) {
        badge.textContent = labels[status];
        badge.className = `card-status-label ${statusClass[status]}`;
    }

    try {
        await fetch(`${BASE}/api/attendance`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ projectId: state.projectId, password: state.password || "_tg_", date: today, workerId, status })
        });
        showToast("✅ រក្សាទុករួច");
        renderReport(); renderDashboard();
    } catch (e) { showToast("❌ " + e.message, "error"); }
}

/* ══════════════════════════════════════════
   BORROW VIEW
══════════════════════════════════════════ */
function renderBorrow() {
    const grid = document.getElementById("borrow-grid");
    if (state.workers.length === 0) {
        grid.innerHTML = '<p style="color:var(--text-2); text-align:center; padding:2rem">មិនទាន់មានកម្មករ</p>';
        return;
    }
    grid.innerHTML = state.workers.map(w => {
        const adv = state.borrows[w.id] || 0;
        return `
        <div class="borrow-card">
            <div class="card-header">
                <div class="worker-avatar">${w.name.charAt(0)}</div>
                <div>
                    <div class="card-worker-name">${w.name}</div>
                    <div class="card-worker-salary">${fmt(w.dailySalary)} ៛/ថ្ងៃ</div>
                </div>
            </div>
            <div class="borrow-amount"><i class="ph ph-hand-coins"></i>${fmt(adv)} ៛</div>
            <div class="borrow-card-actions">
                <button class="primary-btn" onclick="openBorrowModal(${w.id}, '${w.name}', ${adv})">
                    <i class="ph ph-plus"></i> បន្ថែម
                </button>
                ${adv > 0 ? `<button class="danger-btn-outline" onclick="confirmResetWorker(${w.id}, '${w.name}')">
                    <i class="ph ph-arrow-counter-clockwise"></i> Reset
                </button>` : ''}
            </div>
        </div>`;
    }).join("");
}

function openBorrowModal(workerId, workerName, current) {
    pendingBorrowWorkerId = workerId;
    document.getElementById("borrow-worker-name").textContent = workerName;
    document.getElementById("borrow-current").textContent = fmt(current) + " ៛";
    document.getElementById("borrow-amount").value = "";
    document.getElementById("borrow-error").classList.add("hidden");
    document.getElementById("borrow-modal").classList.remove("hidden");
}

async function saveBorrow() {
    const amount = Number(document.getElementById("borrow-amount").value.replace(/[,\s]/g, ""));
    if (!amount || amount <= 0) return showError("borrow-error", "⚠️ សូមវាយចំនួនទឹកប្រាក់ > 0");

    try {
        const res = await fetch(`${BASE}/api/borrow`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ projectId: state.projectId, password: state.password || "_tg_", workerId: pendingBorrowWorkerId, amount })
        });
        const data = await res.json();
        if (data.success) {
            state.borrows = data.borrows;
            state.totalAdvance = Object.values(state.borrows).reduce((a,b)=>a+Number(b),0);
            // add to local history for immediate display
            const w = state.workers.find(w => w.id === pendingBorrowWorkerId);
            state.borrowHistory.push({ workerId: pendingBorrowWorkerId, workerName: w?.name, amount, date: new Date().toISOString() });
            closeModal("borrow-modal");
            showToast(`💸 ${fmt(amount)}៛ — កត់ម្ពុលរួចហើយ`);
            renderAll();
        } else {
            showError("borrow-error", "❌ " + (data.message || "Error"));
        }
    } catch (e) { showError("borrow-error", "❌ " + e.message); }
}

function confirmResetWorker(workerId, name) {
    document.getElementById("confirm-title").textContent = `Reset ${name}?`;
    document.getElementById("confirm-desc").textContent = "ប្រាក់បើកមុនរបស់ " + name + " នឹងត្រូវសូន្យ";
    pendingConfirmAction = () => resetWorkerBorrow(workerId);
    document.getElementById("confirm-modal").classList.remove("hidden");
}

async function resetWorkerBorrow(workerId) {
    closeModal("confirm-modal");
    try {
        const res = await fetch(`${BASE}/api/reset-borrow`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ projectId: state.projectId, password: state.password || "_tg_", workerId })
        });
        const data = await res.json();
        if (data.success) {
            delete state.borrows[workerId];
            state.totalAdvance = Object.values(state.borrows).reduce((a,b)=>a+Number(b),0);
            showToast("✅ Reset ប្រាក់បើកមុនរួចហើយ");
            renderAll();
        }
    } catch(e) { showToast("❌ " + e.message, "error"); }
}

function confirmResetAll() {
    document.getElementById("confirm-title").textContent = "Reset ប្រាក់បើកមុនទាំងអស់?";
    document.getElementById("confirm-desc").textContent = "ប្រើបន្ទាប់ពីបើកប្រាក់ខែហើយ — ទិន្នន័យប្រវត្តិនឹងស្អាត";
    pendingConfirmAction = async () => {
        closeModal("confirm-modal");
        for (const w of state.workers) {
            try {
                await fetch(`${BASE}/api/reset-borrow`, {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ projectId: state.projectId, password: state.password || "_tg_", workerId: w.id })
                });
            } catch(e) { /* continue */ }
        }
        state.borrows = {};
        state.totalAdvance = 0;
        showToast("✅ Reset ប្រាក់បើកមុនទាំងអស់");
        renderAll();
    };
    document.getElementById("confirm-modal").classList.remove("hidden");
}

/* ══════════════════════════════════════════
   REPORT VIEW
   ✅ FIX: uses w.dailySalary (not w.salary)
   ✅ FIX: deducts half vs full correctly
══════════════════════════════════════════ */
function renderReport() {
    const tbody = document.getElementById("report-tbody");
    if (state.workers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">មិនទាន់មានកម្មករ</td></tr>';
        return;
    }
    const weekDates = getWeekDates();
    tbody.innerHTML = state.workers.map((w, i) => {
        let workingDays = 6;
        let deductDays = 0;
        weekDates.forEach(date => {
            const st = state.attendance[date]?.[w.id];
            if (st === "morning" || st === "evening") deductDays += 0.5;
            if (st === "full") deductDays += 1;
        });
        workingDays = 6 - deductDays;
        const grossSalary = w.dailySalary * 6;
        const absenceDeduct = w.dailySalary * deductDays;
        const adv = Number(state.borrows[w.id] || 0);
        const net = Math.max(0, grossSalary - absenceDeduct - adv);

        const wdColor = workingDays < 5 ? "color:var(--red)" : workingDays < 6 ? "color:var(--warning)" : "color:var(--green)";
        return `<tr>
            <td>${i+1}</td>
            <td><strong>${w.name}</strong></td>
            <td style="${wdColor}">${workingDays} ថ្ងៃ</td>
            <td>${fmt(grossSalary)} ៛</td>
            <td class="text-red">${adv > 0 ? '−' + fmt(adv) + ' ៛' : '—'}</td>
            <td class="align-right"><strong class="text-green">${fmt(net)} ៛</strong></td>
        </tr>`;
    }).join("");
}

/* ══════════════════════════════════════════
   NAVIGATION
══════════════════════════════════════════ */
document.querySelectorAll(".nav-item").forEach(nav => {
    nav.addEventListener("click", e => {
        e.preventDefault();
        document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
        nav.classList.add("active");
        const target = nav.dataset.target;
        document.querySelectorAll(".view-section").forEach(s => {
            s.classList.toggle("hidden", s.id !== target);
            s.classList.toggle("active", s.id === target);
        });
        document.getElementById("page-title").textContent = nav.querySelector("span").textContent;
        document.getElementById("sidebar").classList.remove("open");
    });
});

document.getElementById("menu-toggle").addEventListener("click", () => {
    document.getElementById("sidebar").classList.add("open");
});
document.getElementById("close-sidebar").addEventListener("click", () => {
    document.getElementById("sidebar").classList.remove("open");
});

/* ══════════════════════════════════════════
   THEME TOGGLE
══════════════════════════════════════════ */
function toggleTheme() {
    document.body.classList.toggle("light-mode");
    const icon = document.getElementById("theme-icon");
    icon.classList.toggle("ph-moon", !document.body.classList.contains("light-mode"));
    icon.classList.toggle("ph-sun", document.body.classList.contains("light-mode"));
}

/* ══════════════════════════════════════════
   MODAL HELPERS
══════════════════════════════════════════ */
function closeModal(id) {
    document.getElementById(id).classList.add("hidden");
}

function togglePass(inputId) {
    const el = document.getElementById(inputId);
    el.type = el.type === "password" ? "text" : "password";
}

document.getElementById("confirm-ok-btn").addEventListener("click", () => {
    if (pendingConfirmAction) pendingConfirmAction();
    pendingConfirmAction = null;
});

/* ══════════════════════════════════════════
   LOGOUT
══════════════════════════════════════════ */
function doLogout() {
    state = { projectId:null, password:null, projectName:null, workers:[], attendance:{}, borrows:{}, borrowHistory:[], totalAdvance:0 };
    document.getElementById("main-app").classList.add("hidden");
    const auth = document.getElementById("auth-modal");
    auth.style.display = "";
    auth.classList.add("active");
    document.getElementById("login-id").value = "";
    document.getElementById("login-pass").value = "";
    document.getElementById("reg-name").value = "";
    document.getElementById("reg-pass").value = "";
}

/* ══════════════════════════════════════════
   INIT
══════════════════════════════════════════ */
document.addEventListener("DOMContentLoaded", () => {
    // start light mode by default
    document.body.classList.add("light-mode");
    document.getElementById("theme-icon").classList.add("ph-sun");

    // Try Telegram auto-login first, else show web form
    tryTelegramAutoLogin();

    // Enter key on auth forms
    document.getElementById("login-pass").addEventListener("keydown", e => {
        if (e.key === "Enter") handleWebLogin();
    });
    document.getElementById("reg-pass").addEventListener("keydown", e => {
        if (e.key === "Enter") handleWebRegister();
    });
});
