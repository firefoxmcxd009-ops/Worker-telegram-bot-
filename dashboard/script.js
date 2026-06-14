/* ========================================
   GLOBAL VARIABLES & TELEGRAM INIT
======================================== */
const tg = window.Telegram.WebApp;
tg.ready();

let currentLanguage = 'kh';
let userData = { projectId: null, workers: [] };

/* ========================================
   TRANSLATIONS (ស៊ុមភាសា)
======================================== */
const translations = {
    kh: {
        app_name: "ការដ្ឋាន", nav_overview: "ទិដ្ឋភាពទូទៅ", nav_workers: "បញ្ជីកម្មករ",
        nav_attendance: "កត់អវត្តមាន", nav_advance: "បើកលុយមុន", nav_report: "របាយការណ៍",
        nav_logout: "ចាកចេញ", stat_workers: "កម្មករសរុប", stat_advance: "ប្រាក់បើកមុនសរុប",
        title_workers: "បញ្ជីឈ្មោះកម្មករ", btn_add_worker: "បន្ថែមកម្មករ", col_name: "ឈ្មោះ",
        col_salary: "ប្រាក់ថ្ងៃ", col_action: "សកម្មភាព", title_attendance: "កត់ត្រាអវត្តមាន",
        title_advance: "កត់ត្រាការបើកលុយមុន", title_report: "របាយការណ៍សប្តាហ៍នេះ", btn_print: "បោះពុម្ព",
        modal_add_worker_title: "បន្ថែមកម្មករថ្មី", btn_save: "រក្សាទុក", btn_cancel: "បោះបង់", btn_confirm: "យល់ព្រម"
    },
    en: {
        app_name: "Construction", nav_overview: "Overview", nav_workers: "Workers",
        nav_attendance: "Attendance", nav_advance: "Advances", nav_report: "Report",
        nav_logout: "Logout", stat_workers: "Total Workers", stat_advance: "Total Advances",
        title_workers: "Worker List", btn_add_worker: "Add Worker", col_name: "Name",
        col_salary: "Daily Salary", col_action: "Action", title_attendance: "Attendance",
        title_advance: "Salary Advance", title_report: "Weekly Report", btn_print: "Print",
        modal_add_worker_title: "Add New Worker", btn_save: "Save", btn_cancel: "Cancel", btn_confirm: "Confirm"
    }
};

/* ========================================
   UI FUNCTIONS
======================================== */
function updateLanguage(lang) {
    currentLanguage = lang;
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (translations[lang][key]) el.innerText = translations[lang][key];
    });
    document.getElementById('current-lang').innerText = lang.toUpperCase();
}

// Dark/Light Mode
const themeToggle = document.getElementById('theme-toggle');
themeToggle.addEventListener('click', () => {
    document.body.classList.toggle('dark-mode');
    const icon = document.getElementById('theme-icon');
    icon.classList.toggle('ph-moon');
    icon.classList.toggle('ph-sun');
});

// Dropdown Language
document.getElementById('lang-btn').addEventListener('click', () => {
    document.querySelector('.dropdown-menu').classList.toggle('hidden');
});

document.querySelectorAll('.dropdown-item').forEach(item => {
    item.addEventListener('click', (e) => {
        updateLanguage(e.target.dataset.lang);
        document.querySelector('.dropdown-menu').classList.add('hidden');
    });
});

/* ========================================
   APP LOGIC (DATA FETCHING)
======================================== */
async function initApp() {
    // 1. Auto-login check (ប្រើ tg.initDataUnsafe)
    const telegramId = tg.initDataUnsafe?.user?.id;
    if (!telegramId) {
        console.log("Not in Telegram, showing Login Modal...");
        return;
    }

    // 2. Fetch data from Server (នៅទីនេះលោកអ្នកត្រូវបង្កើត Endpoint ក្នុង bot.js)
    try {
        const response = await fetch(`/api/dashboard-data?userId=${telegramId}`);
        const data = await response.json();
        
        if (data.success) {
            userData = data;
            document.getElementById('auth-modal').classList.remove('active');
            document.getElementById('main-app').classList.remove('hidden');
            renderDashboard();
        }
    } catch (err) {
        console.error("Fetch Error:", err);
    }
}

// Rendering Logic
function renderDashboard() {
    document.getElementById('stat-total-workers').innerText = userData.workers.length;
    document.getElementById('display-proj-name').innerText = userData.projectName;
    document.getElementById('display-proj-id').innerText = userData.id;
    document.getElementById('tg-username').innerText = tg.initDataUnsafe?.user?.first_name || "User";
}

// Navigation
document.querySelectorAll('.nav-item').forEach(nav => {
    nav.addEventListener('click', (e) => {
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        nav.classList.add('active');
        
        const target = nav.dataset.target;
        document.querySelectorAll('.view-section').forEach(s => s.classList.add('hidden'));
        document.getElementById(target).classList.remove('hidden');
    });
});

// Start the app
initApp();
