require("dotenv").config();

const express = require("express");
const cron = require("node-cron");
const TelegramBot = require("node-telegram-bot-api");
const mongoose = require("mongoose");
const cors = require("cors");
const path = require("path");

/*
========================================
CONFIG
========================================
*/
const TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;
const MONGO_URL = process.env.MONGO_URL ||
    "mongodb+srv://allinonebot:allinonebot123@amertakcluster.m5zjxka.mongodb.net/worker_db?retryWrites=true&w=majority&appName=AmertakCluster";
const BASE_URL = process.env.BASE_URL || "https://worker-telegram-bot-nwoq.onrender.com";

if (!TOKEN) {
    console.error("❌ មិនទាន់បានដាក់ BOT_TOKEN នៅក្នុង .env ឡើយ!");
    process.exit(1);
}

/*
========================================
EXPRESS SERVER
========================================
*/
const app = express();

// ✅ FIX: cors + json MUST be before routes
app.use(cors());
app.use(express.json());

// Static dashboard files
app.use("/dashboard", express.static(path.join(__dirname, "dashboard")));

app.get("/", (req, res) =>
    res.send("Worker Management Bot v2 is Running ✅")
);

/*
========================================
MONGODB SCHEMAS
========================================
*/
mongoose.connect(MONGO_URL)
    .then(() => console.log("✅ Connected to MongoDB Cloud! Data is safe 📁"))
    .catch(err => { console.error("MongoDB connection error:", err); process.exit(1); });

const AccountSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    creatorId: { type: String, required: true },
    projectName: { type: String, required: true },
    password: { type: String, required: true },
    workers: [{
        id: Number,
        name: String,
        dailySalary: Number
    }],
    // ✅ FIX: attendance stored as Map for safe nested key updates
    attendance: { type: Map, of: Object, default: {} },
    // ✅ FIX: borrows stored as Map for safe key access
    borrows: { type: Map, of: Number, default: {} },
    // ✅ NEW: track cumulative advance history (never deleted on weekly reset)
    borrowHistory: { type: Array, default: [] }
});

const SessionSchema = new mongoose.Schema({
    chatId: { type: String, required: true, unique: true },
    projectId: { type: String, required: true }
});

const Account = mongoose.model("Account", AccountSchema);
const Session = mongoose.model("Session", SessionSchema);

/*
========================================
API ROUTES (single definition each)
========================================
*/

// ✅ FIX: only ONE /api/dashboard-data route, returns full data including attendance
app.get("/api/dashboard-data", async (req, res) => {
    const userId = req.query.userId;
    const projectId = req.query.projectId;

    try {
        let account;

        if (projectId) {
            // Login by projectId (from web dashboard login form)
            account = await Account.findOne({ id: projectId });
        } else if (userId) {
            // Auto-login by Telegram userId via Session
            const session = await Session.findOne({ chatId: userId });
            if (!session) return res.json({ success: false, message: "មិនទាន់បានចូលប្រើ" });
            account = await Account.findOne({ id: session.projectId });
        }

        if (!account) return res.json({ success: false, message: "រកមិនឃើញគណនី" });

        const borrowsObj = {};
        account.borrows.forEach((val, key) => { borrowsObj[key] = val; });

        const attendanceObj = {};
        account.attendance.forEach((val, key) => { attendanceObj[key] = val; });

        const totalAdvance = [...account.borrows.values()].reduce((a, b) => a + b, 0);

        res.json({
            success: true,
            projectName: account.projectName,
            id: account.id,
            workers: account.workers,
            attendance: attendanceObj,
            borrows: borrowsObj,
            totalAdvance,
            borrowHistory: account.borrowHistory || []
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ✅ NEW: Web dashboard login endpoint
app.post("/api/login", async (req, res) => {
    const { projectId, password } = req.body;
    try {
        const account = await Account.findOne({ id: projectId, password });
        if (!account) return res.json({ success: false, message: "Project ID ឬ Password មិនត្រឹមត្រូវ" });

        const borrowsObj = {};
        account.borrows.forEach((val, key) => { borrowsObj[key] = val; });
        const attendanceObj = {};
        account.attendance.forEach((val, key) => { attendanceObj[key] = val; });
        const totalAdvance = [...account.borrows.values()].reduce((a, b) => a + b, 0);

        res.json({
            success: true,
            projectName: account.projectName,
            id: account.id,
            workers: account.workers,
            attendance: attendanceObj,
            borrows: borrowsObj,
            totalAdvance,
            borrowHistory: account.borrowHistory || []
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ✅ NEW: Web dashboard register endpoint
app.post("/api/register", async (req, res) => {
    const { projectName, password, creatorId } = req.body;
    try {
        if (!validatePassword(password))
            return res.json({ success: false, message: "ពាក្យសម្ងាត់ត្រូវមានអក្សរ + លេខ ≥ ៦ ខ្ទង់" });

        const allAccounts = await Account.find({});
        const nextId = allAccounts.length > 0
            ? String(Math.max(...allAccounts.map(a => Number(a.id))) + 1) : "1";

        const newAccount = new Account({
            id: nextId,
            creatorId: creatorId || "web",
            projectName,
            password,
            workers: [], attendance: new Map(), borrows: new Map(), borrowHistory: []
        });
        await newAccount.save();

        res.json({ success: true, projectId: nextId, projectName });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ✅ NEW: Add worker from web dashboard
app.post("/api/add-worker", async (req, res) => {
    const { projectId, password, name, dailySalary } = req.body;
    try {
        const account = await Account.findOne({ id: projectId, password });
        if (!account) return res.json({ success: false, message: "Authentication failed" });

        // ✅ FIX: use absolute max ID to avoid conflicts after deletions
        const maxId = account.workers.length > 0
            ? Math.max(...account.workers.map(w => w.id)) : 0;
        account.workers.push({ id: maxId + 1, name, dailySalary: Number(dailySalary) });
        await account.save();
        res.json({ success: true, workers: account.workers });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ✅ NEW: Delete worker from web dashboard
app.post("/api/delete-worker", async (req, res) => {
    const { projectId, password, workerId } = req.body;
    try {
        const account = await Account.findOne({ id: projectId, password });
        if (!account) return res.json({ success: false });
        account.workers = account.workers.filter(w => w.id !== Number(workerId));
        account.borrows.delete(String(workerId));
        account.markModified("borrows");
        await account.save();
        res.json({ success: true, workers: account.workers });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ✅ NEW: Save attendance from web dashboard
app.post("/api/attendance", async (req, res) => {
    const { projectId, password, date, workerId, status } = req.body;
    try {
        const account = await Account.findOne({ id: projectId, password });
        if (!account) return res.json({ success: false });

        const dayData = account.attendance.get(date) || {};
        if (status === "present") {
            delete dayData[workerId];
        } else {
            dayData[workerId] = status;
        }
        account.attendance.set(date, dayData);
        account.markModified("attendance");
        await account.save();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ✅ NEW: Save borrow (advance) from web dashboard
app.post("/api/borrow", async (req, res) => {
    const { projectId, password, workerId, amount } = req.body;
    try {
        const account = await Account.findOne({ id: projectId, password });
        if (!account) return res.json({ success: false });

        const key = String(workerId);
        const current = account.borrows.get(key) || 0;
        account.borrows.set(key, current + Number(amount));
        account.markModified("borrows");

        // ✅ NEW: log to history (never lost on reset)
        account.borrowHistory.push({
            workerId: Number(workerId),
            workerName: account.workers.find(w => w.id === Number(workerId))?.name || "Unknown",
            amount: Number(amount),
            date: new Date().toISOString()
        });
        await account.save();
        res.json({ success: true, borrows: Object.fromEntries(account.borrows) });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ✅ NEW: Reset advance for one worker (after payday)
app.post("/api/reset-borrow", async (req, res) => {
    const { projectId, password, workerId } = req.body;
    try {
        const account = await Account.findOne({ id: projectId, password });
        if (!account) return res.json({ success: false });
        account.borrows.delete(String(workerId));
        account.markModified("borrows");
        await account.save();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.listen(PORT, () => console.log(`🌐 Server running on port ${PORT}`));

/*
========================================
TELEGRAM BOT
========================================
*/
const bot = new TelegramBot(TOKEN, { polling: true });
console.log("🚀 Telegram Bot Started");

bot.setMyCommands([
    { command: "start", description: "🚀 ចាប់ផ្តើម / ម៉ឺនុយមេ" },
    { command: "id", description: "🆔 មើល Telegram ID" },
    { command: "myprojects", description: "📁 មើលបញ្ជីប្រូជេក" },
    { command: "logout", description: "🚪 ចាកចេញ" },
    { command: "addworker", description: "➕ បន្ថែមកម្មករ" },
    { command: "listworkers", description: "👷 មើលបញ្ជីកម្មករ" },
    { command: "report", description: "💰 របាយការណ៍ប្រាក់ខែ" }
]);

const userSessions = {};

/*
========================================
HELPERS
========================================
*/
function validatePassword(password) {
    return /[a-zA-Z]/.test(password) && /[0-9]/.test(password) && password.length >= 6;
}

function getTodayDate() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function getWeekDates() {
    const dates = [];
    const now = new Date();
    const currentDay = now.getDay();
    const monday = new Date(now);
    const distanceToMonday = currentDay === 0 ? -6 : 1 - currentDay;
    monday.setDate(now.getDate() + distanceToMonday);
    for (let i = 0; i < 6; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        dates.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
    }
    return dates;
}

function getKhmerDayName(dateStr) {
    const map = { 0: "អាទិត្យ", 1: "ចន្ទ", 2: "អង្គារ", 3: "ពុធ", 4: "ព្រហស្បតិ៍", 5: "សុក្រ", 6: "សៅរ៍" };
    return map[new Date(dateStr).getDay()];
}

// ✅ FIX: use Map-aware getters for attendance/borrows
function getAttendance(account, date, workerId) {
    const day = account.attendance.get(date);
    return day ? day[workerId] : undefined;
}

function getBorrow(account, workerId) {
    return account.borrows.get(String(workerId)) || 0;
}

/*
========================================
KEYBOARDS
========================================
*/
const MAIN_INLINE_KEYBOARD = [
    [{ text: "📝 កត់អវត្តមាន", callback_data: "main_absence" }, { text: "📋 មើលអវត្តមាន", callback_data: "main_view_absence" }],
    [{ text: "💸 បើកលុយមុន", callback_data: "main_borrow" }, { text: "👷 បញ្ជីកម្មករ", callback_data: "main_listworkers" }],
    [{ text: "✍️ បន្ថែមកម្មករ", callback_data: "main_addworker" }, { text: "🗑 លុបកម្មករ", callback_data: "main_deleteworker" }],
    [{ text: "💰 របាយការណ៍ប្រចាំសប្តាហ៍", callback_data: "main_report" }],
    [{ text: "🔄 សូន្យលុយបើកមុន (Reset Advance)", callback_data: "main_reset_borrows" }],
    [{ text: "🌐 បើក Dashboard", web_app: { url: `${BASE_URL}/dashboard/index.html` } }],
    [{ text: "🚪 ចាកចេញ", callback_data: "main_logout" }]
];

function sendMainMenu(chatId, projectName) {
    bot.sendMessage(chatId,
        `📁 ប្រូជេក៖ **${projectName}**\n👷 **ម៉ឺនុយបញ្ជាចម្បង**\n\nសូមជ្រើសរើសមុខងារ៖`,
        { parse_mode: "Markdown", reply_markup: { inline_keyboard: MAIN_INLINE_KEYBOARD } }
    );
}

function sendAuthRequired(chatId, telegramId) {
    bot.sendMessage(chatId,
        `🔒 **មិនទាន់បានចូលប្រើប្រាស់ប្រូជេកទេ!**\n\n🆔 Telegram ID: \`${telegramId}\`\n\n1️⃣ **Register** — បង្កើតប្រូជេកថ្មី\n2️⃣ **Login** — ចូលប្រូជេកដែលមានរួច`,
        {
            parse_mode: "Markdown",
            reply_markup: {
                inline_keyboard: [
                    [{ text: "🔐 បង្កើតប្រូជេកថ្មី (Register)", callback_data: "auth_register" }],
                    [{ text: "🔑 ចូលប្រើប្រាស់ (Login)", callback_data: "auth_login" }]
                ]
            }
        }
    );
}

async function handleLogout(chatId) {
    await Session.deleteOne({ chatId: String(chatId) });
    delete userSessions[chatId];
    bot.sendMessage(chatId, "🚪 បានចាកចេញដោយជោគជ័យ។");
}

/*
========================================
COMMANDS
========================================
*/
bot.onText(/^\/start$/, async (msg) => {
    delete userSessions[msg.chat.id];
    const session = await Session.findOne({ chatId: String(msg.chat.id) });
    if (!session) return sendAuthRequired(msg.chat.id, msg.from.id);
    const account = await Account.findOne({ id: session.projectId });
    if (!account) { await handleLogout(msg.chat.id); return sendAuthRequired(msg.chat.id, msg.from.id); }
    bot.sendMessage(msg.chat.id,
        `👋 ស្វាគមន៍!\n\n📁 ប្រូជេកសកម្ម៖ **${account.projectName}**\n🆔 Telegram ID: \`${msg.from.id}\``,
        { parse_mode: "Markdown" }
    ).then(() => sendMainMenu(msg.chat.id, account.projectName));
});

bot.onText(/^\/id$/, (msg) => {
    bot.sendMessage(msg.chat.id, `🆔 Telegram ID: \`${msg.from.id}\``, { parse_mode: "Markdown" });
});

bot.onText(/^\/logout$/, async (msg) => {
    await handleLogout(msg.chat.id);
    sendAuthRequired(msg.chat.id, msg.from.id);
});

bot.onText(/^\/myprojects$/, async (msg) => {
    delete userSessions[msg.chat.id];
    const projects = await Account.find({ creatorId: String(msg.from.id) });
    if (projects.length === 0)
        return bot.sendMessage(msg.chat.id, "❌ លោកអ្នកមិនទាន់មានប្រូជេកណាមួយ។");
    const buttons = projects.map(p => [{ text: `🏗 ${p.projectName}`, callback_data: `view_proj_${p.id}` }]);
    bot.sendMessage(msg.chat.id, "📁 <b>បញ្ជីប្រូជេករបស់អ្នក៖</b>",
        { parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } });
});

bot.onText(/^\/listworkers$/, async (msg) => {
    delete userSessions[msg.chat.id];
    const session = await Session.findOne({ chatId: String(msg.chat.id) });
    if (!session) return sendAuthRequired(msg.chat.id, msg.from.id);
    const account = await Account.findOne({ id: session.projectId });
    if (!account || account.workers.length === 0)
        return bot.sendMessage(msg.chat.id, "❌ មិនទាន់មានកម្មករ។");
    let text = "👷 **បញ្ជីកម្មករ**\n\n";
    account.workers.forEach(w => { text += `• 👤 **${w.name}** | ${w.dailySalary.toLocaleString()}៛/ថ្ងៃ\n`; });
    bot.sendMessage(msg.chat.id, text, { parse_mode: "Markdown", reply_markup: { inline_keyboard: MAIN_INLINE_KEYBOARD } });
});

bot.onText(/^\/addworker$/, async (msg) => {
    delete userSessions[msg.chat.id];
    const session = await Session.findOne({ chatId: String(msg.chat.id) });
    if (!session) return sendAuthRequired(msg.chat.id, msg.from.id);
    userSessions[msg.chat.id] = { state: "AWAITING_WORKER_DETAILS" };
    bot.sendMessage(msg.chat.id,
        "✍️ វាយឈ្មោះ + ប្រាក់ថ្ងៃ (ច្រើននាក់ – ចុះបន្ទាត់):\n\n*ឧទាហរណ៍:*\n`សុខា 80000`\n`មករា 75000`",
        { parse_mode: "Markdown" }
    );
});

bot.onText(/^\/report$/, async (msg) => {
    delete userSessions[msg.chat.id];
    const session = await Session.findOne({ chatId: String(msg.chat.id) });
    if (!session) return sendAuthRequired(msg.chat.id, msg.from.id);
    const account = await Account.findOne({ id: session.projectId });
    if (!account || account.workers.length === 0)
        return bot.sendMessage(msg.chat.id, "❌ មិនទាន់មានកម្មករ។");
    bot.sendMessage(msg.chat.id, buildReport(account), { parse_mode: "Markdown", reply_markup: { inline_keyboard: MAIN_INLINE_KEYBOARD } });
});

/*
========================================
REPORT HELPER (shared by command + callback)
========================================
*/
function buildReport(account) {
    let text = "💰 **📊 របាយការណ៍ប្រចាំសប្តាហ៍**\n\n";
    const weekDates = getWeekDates();
    account.workers.forEach((w, index) => {
        // ✅ FIX: full week = 6 days × dailySalary
        let total = w.dailySalary * 6;
        weekDates.forEach(date => {
            const status = getAttendance(account, date, w.id);
            // ✅ FIX: deduct correctly — half-day = 0.5 × daily, full = 1 × daily
            if (status === "morning" || status === "evening") total -= (w.dailySalary / 2);
            if (status === "full") total -= w.dailySalary;
        });
        const adv = getBorrow(account, w.id);
        total = Math.max(0, total - adv);
        text += `${index + 1}. 👤 **${w.name}**\n`;
        text += `   • ប្រាក់ថ្ងៃ: ${w.dailySalary.toLocaleString()}៛\n`;
        if (adv > 0) text += `   • បើកមុន: -${adv.toLocaleString()}៛\n`;
        text += `   • 💵 **ត្រូវបើក: ${total.toLocaleString()}៛**\n\n`;
    });
    return text;
}

/*
========================================
CALLBACK HANDLER
========================================
*/
bot.on("callback_query", async (query) => {
    const chatId = query.message.chat.id;
    const telegramId = query.from.id;
    const data = query.data;
    bot.answerCallbackQuery(query.id);

    try {
        const safeClears = ["auth_register", "auth_login", "main_addworker", "cancel_to_main"];
        if (!safeClears.includes(data) && !data.startsWith("borrow_select_")) {
            delete userSessions[chatId];
        }

        if (data === "main_logout") {
            await handleLogout(chatId);
            return sendAuthRequired(chatId, telegramId);
        }

        if (data === "auth_register") {
            userSessions[chatId] = { state: "REGISTRATION_PROJECT_NAME" };
            return bot.sendMessage(chatId, "✍️ **ជំហានទី១:** វាយឈ្មោះប្រូជេក:\n*ឧទាហរណ៍: ការដ្ឋានចោមចៅ*", { parse_mode: "Markdown" });
        }

        if (data === "auth_login") {
            userSessions[chatId] = { state: "LOGIN_CREDENTIALS" };
            return bot.sendMessage(chatId, "✍️ **វាយ ProjectID + Password:**\n*ទម្រង់:* `1 boss123`", { parse_mode: "Markdown" });
        }

        if (data === "cancel_to_main") {
            delete userSessions[chatId];
            const session = await Session.findOne({ chatId: String(chatId) });
            if (!session) return sendAuthRequired(chatId, telegramId);
            const account = await Account.findOne({ id: session.projectId });
            if (!account) return sendAuthRequired(chatId, telegramId);
            return sendMainMenu(chatId, account.projectName);
        }

        if (data.startsWith("view_proj_")) {
            const projId = data.replace("view_proj_", "");
            const project = await Account.findOne({ id: projId, creatorId: String(telegramId) });
            if (!project) return bot.answerCallbackQuery(query.id, { text: "❌ រកមិនឃើញ" });
            return bot.editMessageText(
                `📁 <b>ព័ត៌មានប្រូជេក</b>\n\n🏗 ឈ្មោះ: <b>${project.projectName}</b>\n🔑 ID: <tg-spoiler><code>${project.id}</code></tg-spoiler>\n🔐 Password: <tg-spoiler><code>${project.password}</code></tg-spoiler>\n\n<i>ចុចផ្ទាំងព្រាលៗដើម្បីមើល</i>`,
                { chat_id: chatId, message_id: query.message.message_id, parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "🔙 ត្រឡប់", callback_data: "back_to_projects" }]] } }
            );
        }

        if (data === "back_to_projects") {
            const projects = await Account.find({ creatorId: String(telegramId) });
            const buttons = projects.map(p => [{ text: `🏗 ${p.projectName}`, callback_data: `view_proj_${p.id}` }]);
            return bot.editMessageText("📁 <b>បញ្ជីប្រូជេករបស់អ្នក:</b>",
                { chat_id: chatId, message_id: query.message.message_id, parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } });
        }

        const session = await Session.findOne({ chatId: String(chatId) });
        if (!session && !data.startsWith("auth_")) return sendAuthRequired(chatId, telegramId);
        const account = await Account.findOne({ id: session?.projectId });
        if (!account && !data.startsWith("auth_")) return sendAuthRequired(chatId, telegramId);

        // ── MAIN MENU CALLBACKS ──
        if (data === "main_addworker") {
            userSessions[chatId] = { state: "AWAITING_WORKER_DETAILS" };
            return bot.sendMessage(chatId, "✍️ វាយឈ្មោះ + ប្រាក់ថ្ងៃ:\n`ឈ្មោះ ចំនួន`\n\n*ឧទាហរណ៍:*\n`សុខា 80000`\n`មករា 75000`", { parse_mode: "Markdown" });
        }

        if (data === "main_listworkers") {
            if (account.workers.length === 0) return bot.sendMessage(chatId, "❌ មិនទាន់មានកម្មករ។");
            let text = "👷 **បញ្ជីកម្មករ**\n\n";
            account.workers.forEach(w => { text += `• 👤 **${w.name}** | ${w.dailySalary.toLocaleString()}៛/ថ្ងៃ\n`; });
            return bot.sendMessage(chatId, text, { parse_mode: "Markdown", reply_markup: { inline_keyboard: MAIN_INLINE_KEYBOARD } });
        }

        if (data === "main_report") {
            if (account.workers.length === 0) return bot.sendMessage(chatId, "❌ មិនទាន់មានកម្មករ។");
            return bot.sendMessage(chatId, buildReport(account), { parse_mode: "Markdown", reply_markup: { inline_keyboard: MAIN_INLINE_KEYBOARD } });
        }

        if (data === "main_absence") {
            if (account.workers.length === 0) return bot.sendMessage(chatId, "❌ មិនទាន់មានកម្មករ។");
            const buttons = account.workers.map(w => [{ text: `👤 ${w.name}`, callback_data: `abs_select_${w.id}` }]);
            buttons.push([{ text: "🔄 បោះបង់", callback_data: "cancel_to_main" }]);
            return bot.sendMessage(chatId, "👉 ជ្រើសរើសកម្មករដើម្បីកត់អវត្តមាន:", { reply_markup: { inline_keyboard: buttons } });
        }

        if (data === "main_view_absence") {
            if (account.workers.length === 0) return bot.sendMessage(chatId, "❌ មិនទាន់មានកម្មករ។");
            const buttons = account.workers.map(w => [{ text: `📋 ${w.name}`, callback_data: `history_${w.id}` }]);
            buttons.push([{ text: "🔄 បោះបង់", callback_data: "cancel_to_main" }]);
            return bot.sendMessage(chatId, "👉 ជ្រើសរើសកម្មករដើម្បីមើលប្រវត្តិ:", { reply_markup: { inline_keyboard: buttons } });
        }

        if (data === "main_borrow") {
            if (account.workers.length === 0) return bot.sendMessage(chatId, "❌ មិនទាន់មានកម្មករ។");
            const buttons = account.workers.map(w => [{ text: `💸 ${w.name}`, callback_data: `borrow_select_${w.id}` }]);
            buttons.push([{ text: "🔄 បោះបង់", callback_data: "cancel_to_main" }]);
            return bot.sendMessage(chatId, "👉 ជ្រើសរើសកម្មករ:", { reply_markup: { inline_keyboard: buttons } });
        }

        if (data === "main_deleteworker") {
            if (account.workers.length === 0) return bot.sendMessage(chatId, "❌ មិនទាន់មានកម្មករ។");
            const buttons = account.workers.map(w => [{ text: `🗑 ${w.name}`, callback_data: `del_select_${w.id}` }]);
            buttons.push([{ text: "🔄 បោះបង់", callback_data: "cancel_to_main" }]);
            return bot.sendMessage(chatId, "👉 ជ្រើសរើសកម្មករដើម្បីលុប:", { reply_markup: { inline_keyboard: buttons } });
        }

        // ✅ NEW: Reset all borrows with confirmation
        if (data === "main_reset_borrows") {
            return bot.sendMessage(chatId,
                "⚠️ **តើអ្នកចង់សូន្យ (Reset) ប្រាក់បើកមុន (Advance) ទាំងអស់មែនទេ?**\n\n_(ប្រើបន្ទាប់ពីបើកប្រាក់ខែហើយ)_",
                {
                    parse_mode: "Markdown",
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "✅ យល់ព្រម Reset", callback_data: "confirm_reset_borrows" }],
                            [{ text: "❌ បោះបង់", callback_data: "cancel_to_main" }]
                        ]
                    }
                }
            );
        }

        if (data === "confirm_reset_borrows") {
            account.borrows = new Map();
            account.markModified("borrows");
            await account.save();
            return bot.sendMessage(chatId, "✅ បានសូន្យប្រាក់បើកមុនទាំងអស់ (Advance Reset)។",
                { reply_markup: { inline_keyboard: MAIN_INLINE_KEYBOARD } });
        }

        // ── ABSENCE ──
        if (data.startsWith("abs_select_")) {
            const workerId = Number(data.replace("abs_select_", ""));
            const worker = account.workers.find(w => w.id === workerId);
            const half = worker.dailySalary / 2;
            return bot.sendMessage(chatId,
                `👤 **${worker.name}** — ប្រភេទអវត្តមានថ្ងៃនេះ:`,
                {
                    parse_mode: "Markdown",
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `🌅 ឈប់ព្រឹក (−${half.toLocaleString()}៛)`, callback_data: `abs_save_morning_${workerId}` }],
                            [{ text: `🌙 ឈប់ល្ងាច (−${half.toLocaleString()}៛)`, callback_data: `abs_save_evening_${workerId}` }],
                            [{ text: `❌ ឈប់ពេញថ្ងៃ (−${worker.dailySalary.toLocaleString()}៛)`, callback_data: `abs_save_full_${workerId}` }],
                            [{ text: "✅ មកធ្វើការធម្មតា", callback_data: `abs_save_present_${workerId}` }],
                            [{ text: "🔄 បោះបង់", callback_data: "main_absence" }]
                        ]
                    }
                }
            );
        }

        if (data.startsWith("abs_save_")) {
            const rem = data.replace("abs_save_", "");
            const today = getTodayDate();
            const dayData = account.attendance.get(today) || {};

            let type = ""; let wId = 0;
            if (rem.startsWith("present_")) { wId = Number(rem.replace("present_", "")); delete dayData[wId]; }
            else if (rem.startsWith("morning_")) { type = "morning"; wId = Number(rem.replace("morning_", "")); dayData[wId] = type; }
            else if (rem.startsWith("evening_")) { type = "evening"; wId = Number(rem.replace("evening_", "")); dayData[wId] = type; }
            else if (rem.startsWith("full_")) { type = "full"; wId = Number(rem.replace("full_", "")); dayData[wId] = type; }

            account.attendance.set(today, dayData);
            account.markModified("attendance");
            await account.save();
            const workerName = account.workers.find(w => w.id === wId)?.name;
            const statusText = type === "" ? "មកធ្វើការធម្មតា" : type === "morning" ? "ឈប់ព្រឹក" : type === "evening" ? "ឈប់ល្ងាច" : "ឈប់ពេញថ្ងៃ";
            return bot.sendMessage(chatId, `✅ **${workerName}** — ${statusText}`, { parse_mode: "Markdown", reply_markup: { inline_keyboard: MAIN_INLINE_KEYBOARD } });
        }

        // ── BORROW ──
        if (data.startsWith("borrow_select_")) {
            const workerId = Number(data.replace("borrow_select_", ""));
            userSessions[chatId] = { state: "AWAITING_BORROW_AMOUNT", workerId };
            const worker = account.workers.find(w => w.id === workerId);
            return bot.sendMessage(chatId, `✍️ វាយចំនួនទឹកប្រាក់ដែល **${worker.name}** បានបើកមុន:`, { parse_mode: "Markdown" });
        }

        // ── DELETE WORKER ──
        if (data.startsWith("del_select_")) {
            const workerId = Number(data.replace("del_select_", ""));
            const worker = account.workers.find(w => w.id === workerId);
            return bot.sendMessage(chatId,
                `⚠️ ពិតជាចង់លុប **${worker.name}** មែនទេ?`,
                {
                    parse_mode: "Markdown",
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "❌ យល់ព្រមលុប", callback_data: `confirm_del_${workerId}` }],
                            [{ text: "🔄 បោះបង់", callback_data: "cancel_to_main" }]
                        ]
                    }
                }
            );
        }

        if (data.startsWith("confirm_del_")) {
            const workerId = Number(data.replace("confirm_del_", ""));
            account.workers = account.workers.filter(w => w.id !== workerId);
            account.borrows.delete(String(workerId));
            account.markModified("borrows");
            await account.save();
            return bot.sendMessage(chatId, "🗑 បានលុបកម្មករ។", { reply_markup: { inline_keyboard: MAIN_INLINE_KEYBOARD } });
        }

        // ── HISTORY ──
        if (data.startsWith("history_")) {
            const workerId = Number(data.replace("history_", ""));
            const worker = account.workers.find(w => w.id === workerId);
            let text = `📋 **ប្រវត្តិច្បាប់សប្តាហ៍នេះ: ${worker.name}**\n\n`;
            getWeekDates().sort().forEach(date => {
                const status = getAttendance(account, date, workerId);
                let res = "✅ មកធ្វើការ";
                if (status === "morning") res = "🌅 ឈប់ព្រឹក";
                if (status === "evening") res = "🌙 ឈប់ល្ងាច";
                if (status === "full") res = "❌ ឈប់ពេញថ្ងៃ";
                text += `• ${getKhmerDayName(date)} (${date}): ${res}\n`;
            });
            const adv = getBorrow(account, workerId);
            if (adv > 0) text += `\n💸 ប្រាក់បើកមុន: ${adv.toLocaleString()}៛`;
            return bot.sendMessage(chatId, text, { parse_mode: "Markdown", reply_markup: { inline_keyboard: MAIN_INLINE_KEYBOARD } });
        }

    } catch (err) {
        console.error("Callback error:", err);
        bot.sendMessage(chatId, "❌ Error: " + err.message);
    }
});

/*
========================================
MESSAGE HANDLER
========================================
*/
bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    const text = msg.text ? msg.text.trim() : "";
    if (text.startsWith("/")) return;

    const sessionState = userSessions[chatId];
    if (!sessionState) return;

    try {
        if (sessionState.state === "REGISTRATION_PROJECT_NAME") {
            if (text.length < 2) return bot.sendMessage(chatId, "❌ ឈ្មោះខ្លីពេក! សូមវាយម្តងទៀត:");
            userSessions[chatId] = { state: "REGISTRATION_PASSWORD", projectName: text };
            return bot.sendMessage(chatId,
                `✍️ **ជំហានទី២:** Password សម្រាប់ "${text}":\n\n⚠️ *ត្រូវមានអក្សរ+លេខ ≥ ៦ ខ្ទង់ (ឧ: boss123)*`,
                { parse_mode: "Markdown" });
        }

        if (sessionState.state === "REGISTRATION_PASSWORD") {
            if (!validatePassword(text))
                return bot.sendMessage(chatId, "❌ Password មិនត្រូវ! ត្រូវមានអក្សរ+លេខ ≥ ៦ ខ្ទង់:");
            const allAccounts = await Account.find({});
            const nextId = allAccounts.length > 0
                ? String(Math.max(...allAccounts.map(a => Number(a.id))) + 1) : "1";
            const newAccount = new Account({
                id: nextId, creatorId: String(telegramId),
                projectName: sessionState.projectName, password: text,
                workers: [], attendance: new Map(), borrows: new Map(), borrowHistory: []
            });
            await newAccount.save();
            await Session.findOneAndUpdate({ chatId: String(chatId) }, { projectId: nextId }, { upsert: true, new: true });
            delete userSessions[chatId];
            return bot.sendMessage(chatId,
                `🎉 <b>បង្កើតជោគជ័យ!</b>\n\n🏗 ប្រូជេក: <b>${sessionState.projectName}</b>\n🔑 ID: <tg-spoiler><code>${nextId}</code></tg-spoiler>\n🔐 Password: <tg-spoiler><code>${text}</code></tg-spoiler>\n\n<i>ចុចលើផ្ទាំងព្រាលៗដើម្បីមើល</i>`,
                { parse_mode: "HTML" }
            ).then(() => sendMainMenu(chatId, sessionState.projectName));
        }

        if (sessionState.state === "LOGIN_CREDENTIALS") {
            const match = text.match(/^(\S+)\s+(.+)$/);
            if (!match) return bot.sendMessage(chatId, "❌ ទម្រង់ខុស! ឧ: `1 boss123`", { parse_mode: "Markdown" });
            const account = await Account.findOne({ id: match[1].trim(), password: match[2].trim() });
            if (account) {
                await Session.findOneAndUpdate({ chatId: String(chatId) }, { projectId: account.id }, { upsert: true, new: true });
                delete userSessions[chatId];
                return bot.sendMessage(chatId, `✅ ចូលជោគជ័យ! ប្រូជេក: **${account.projectName}**`, { parse_mode: "Markdown" })
                    .then(() => sendMainMenu(chatId, account.projectName));
            } else {
                return bot.sendMessage(chatId, "❌ ID ឬ Password មិនត្រូវ! សូមព្យាយាមមើលទៀត:");
            }
        }

        const userSession = await Session.findOne({ chatId: String(chatId) });
        if (!userSession) return sendAuthRequired(chatId, telegramId);
        const account = await Account.findOne({ id: userSession.projectId });
        if (!account) return sendAuthRequired(chatId, telegramId);

        if (sessionState.state === "AWAITING_WORKER_DETAILS") {
            const lines = text.split("\n");
            let added = [], errors = [];
            // ✅ FIX: use maxId to avoid collisions after past deletions
            let maxId = account.workers.length > 0 ? Math.max(...account.workers.map(w => w.id)) : 0;
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;
                const m = line.match(/^(.+)\s+(\d+)$/);
                if (!m) { errors.push(`• បន្ទាត់ ${i + 1}: "${line}" ខុសទម្រង់`); continue; }
                if (Number(m[2]) <= 0) { errors.push(`• បន្ទាត់ ${i + 1}: ប្រាក់ត្រូវ > 0`); continue; }
                maxId++;
                account.workers.push({ id: maxId, name: m[1].trim(), dailySalary: Number(m[2]) });
                added.push({ name: m[1].trim(), salary: Number(m[2]) });
            }
            if (added.length === 0) return bot.sendMessage(chatId, "❌ មិនមានទិន្នន័យត្រឹមត្រូវ!");
            await account.save();
            delete userSessions[chatId];
            let reply = `✅ **បន្ថែមកម្មករ ${added.length} នាក់:**\n\n`;
            added.forEach(w => { reply += `• 👤 ${w.name} | ${w.salary.toLocaleString()}៛/ថ្ងៃ\n`; });
            if (errors.length > 0) reply += `\n⚠️ **ចន្លោះខ្វះខាត:**\n${errors.join("\n")}`;
            return bot.sendMessage(chatId, reply, { parse_mode: "Markdown", reply_markup: { inline_keyboard: MAIN_INLINE_KEYBOARD } });
        }

        if (sessionState.state === "AWAITING_BORROW_AMOUNT") {
            const amount = Number(text.replace(/[,\s]/g, ""));
            if (isNaN(amount) || amount <= 0) return bot.sendMessage(chatId, "❌ សូមវាយលេខទឹកប្រាក់! ឧ: 10000");
            const workerId = sessionState.workerId;
            const worker = account.workers.find(w => w.id === workerId);
            const key = String(workerId);
            const current = account.borrows.get(key) || 0;
            account.borrows.set(key, current + amount);
            account.markModified("borrows");
            account.borrowHistory.push({
                workerId, workerName: worker.name, amount,
                date: new Date().toISOString()
            });
            await account.save();
            delete userSessions[chatId];
            return bot.sendMessage(chatId,
                `💸 **${worker.name}** — បានកត់ម្ពុលបើកលុយមុន:\n💵 ${amount.toLocaleString()}៛\n📊 សរុបបើកមុន: ${(current + amount).toLocaleString()}៛`,
                { parse_mode: "Markdown", reply_markup: { inline_keyboard: MAIN_INLINE_KEYBOARD } }
            );
        }
    } catch (err) {
        console.error("Message handler error:", err);
        bot.sendMessage(chatId, "❌ Error: " + err.message);
    }
});

/*
========================================
CRON — Weekly Reset (Sunday midnight)
✅ FIX: only resets attendance + borrows, NOT workers or history
========================================
*/
cron.schedule("0 0 * * 0", async () => {
    try {
        const accounts = await Account.find({});
        for (const account of accounts) {
            account.attendance = new Map();
            account.borrows = new Map();
            account.markModified("attendance");
            account.markModified("borrows");
            await account.save();
        }
        console.log("✅ Weekly reset: attendance + borrows cleared for all projects.");
    } catch (err) {
        console.error("Cron error:", err);
    }
}, { timezone: "Asia/Phnom_Penh" });

bot.on("polling_error", err => console.error("Polling error:", err.message));
process.on("uncaughtException", err => console.error("Uncaught:", err));
