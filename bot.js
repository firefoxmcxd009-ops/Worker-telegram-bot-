require("dotenv").config();

const fs = require("fs");
const path = require("path");
const express = require("express");
const cron = require("node-cron");
const TelegramBot = require("node-telegram-bot-api");

/*
========================================
CONFIG
========================================
*/

const TOKEN = process.env.BOT_TOKEN;
const OWNER_ID = Number(process.env.OWNER_ID);
const PORT = process.env.PORT || 3000;

if (!TOKEN) {
    console.error("BOT_TOKEN missing");
    process.exit(1);
}

if (!OWNER_ID) {
    console.error("OWNER_ID missing");
    process.exit(1);
}

/*
========================================
EXPRESS
========================================
*/

const app = express();

app.get("/", (req, res) => {
    res.send("Worker Bot Running ✅");
});

app.listen(PORT, () => {
    console.log(`Server running on ${PORT}`);
});

/*
========================================
BOT
========================================
*/

const bot = new TelegramBot(TOKEN, {
    polling: true
});

console.log("Bot Started");

/*
========================================
BUTTON MENU ខាងឆ្វេង BOX MESSAGE
========================================
*/
bot.setMyCommands([
    { command: "start", description: "👷 បើកម៉ឺនុយបញ្ជាចម្បង" },
    { command: "addworker", description: "➕ បន្ថែមកម្មករថ្មី" },
    { command: "listworkers", description: "👷 មើលបញ្ជីឈ្មោះកម្មករ" },
    { command: "report", description: "💰 មើលរបាយការណ៍ប្រាក់ខែ" }
]).then(() => {
    console.log("Telegram Command Menu set successfully");
});

/*
========================================
STATE MANAGEMENT
========================================
*/
const userSessions = {};

/*
========================================
FILES & QUEUE SYSTEM
========================================
*/

const WORKERS_FILE = path.join(__dirname, "workers.json");
const ATTENDANCE_FILE = path.join(__dirname, "attendance.json");
const BORROW_FILE = path.join(__dirname, "borrow.json");

let isWriting = false;
const writeQueue = [];

function processWriteQueue() {
    if (isWriting || writeQueue.length === 0) return;
    isWriting = true;
    const nextWrite = writeQueue.shift();
    try {
        fs.writeFileSync(nextWrite.file, JSON.stringify(nextWrite.data, null, 2));
    } catch (err) {
        console.error("Write error:", err);
    }
    isWriting = false;
    processWriteQueue();
}

function safeWriteFileSync(file, data) {
    writeQueue.push({ file, data });
    processWriteQueue();
}

/*
========================================
INIT FILES
========================================
*/

if (!fs.existsSync(WORKERS_FILE)) {
    fs.writeFileSync(WORKERS_FILE, JSON.stringify([], null, 2));
}

if (!fs.existsSync(ATTENDANCE_FILE)) {
    fs.writeFileSync(ATTENDANCE_FILE, JSON.stringify({}, null, 2));
}

if (!fs.existsSync(BORROW_FILE)) {
    fs.writeFileSync(BORROW_FILE, JSON.stringify({}, null, 2));
}

/*
========================================
HELPERS
========================================
*/

function readWorkers() {
    try {
        return JSON.parse(fs.readFileSync(WORKERS_FILE, "utf8"));
    } catch {
        return [];
    }
}

function saveWorkers(data) {
    safeWriteFileSync(WORKERS_FILE, data);
}

function readAttendance() {
    try {
        return JSON.parse(fs.readFileSync(ATTENDANCE_FILE, "utf8"));
    } catch {
        return {};
    }
}

function saveAttendance(data) {
    safeWriteFileSync(ATTENDANCE_FILE, data);
}

function readBorrows() {
    try {
        return JSON.parse(fs.readFileSync(BORROW_FILE, "utf8"));
    } catch {
        return {};
    }
}

function saveBorrows(data) {
    safeWriteFileSync(BORROW_FILE, data);
}

function isOwner(msg) {
    return msg.from.id === OWNER_ID;
}

function getTodayDate() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function getWorkerById(workerId) {
    const workers = readWorkers();
    return workers.find(w => Number(w.id) === Number(workerId));
}

function getWeekDates() {
    const dates = [];
    const now = new Date();
    const currentDay = now.getDay();
    
    const monday = new Date(now);
    const distanceToMonday = currentDay === 0 ? -6 : 1 - currentDay;
    monday.setDate(now.getDate() + distanceToMonday);
    
    for (let i = 0; i < 6; i++) {
        const nextDay = new Date(monday);
        nextDay.setDate(monday.getDate() + i);
        const y = nextDay.getFullYear();
        const m = String(nextDay.getMonth() + 1).padStart(2, "0");
        const d = String(nextDay.getDate()).padStart(2, "0");
        dates.push(`${y}-${m}-${d}`);
    }
    return dates;
}

function getKhmerDayName(dateStr) {
    const date = new Date(dateStr);
    const day = date.getDay();
    const map = {
        0: "អាទិត្យ",
        1: "ចន្ទ",
        2: "អង្គារ",
        3: "ពុធ",
        4: "ព្រហស្បតិ៍",
        5: "សុក្រ",
        6: "សៅរ៍"
    };
    return map[day];
}

/*
========================================
MEMBER BUTTON INLINE (ប៊ូតុងជាប់សារចម្បង)
========================================
*/
const MAIN_INLINE_KEYBOARD = [
    [{ text: "📝 កត់អវត្តមាន", callback_data: "main_absence" }, { text: "📋 មើលអវត្តមាន", callback_data: "main_view_absence" }],
    [{ text: "💸 បើកលុយមុន", callback_data: "main_borrow" }, { text: "👷 បញ្ជីកម្មករ", callback_data: "main_listworkers" }],
    [{ text: "✍️ បន្ថែមកម្មករ", callback_data: "main_addworker" }, { text: "🗑 លុបកម្មករ", callback_data: "main_deleteworker" }],
    [{ text: "💰 មើលរបាយការណ៍ប្រាក់ខែ", callback_data: "main_report" }]
];

// មុខងារផ្ញើលទ្ធផលចុងក្រោយ ដោយភ្ជាប់ប៊ូតុងជាប់សារជានិច្ច
function sendFinalResult(chatId, textMessage) {
    bot.sendMessage(chatId, textMessage, {
        reply_markup: {
            inline_keyboard: MAIN_INLINE_KEYBOARD
        }
    });
}

/*
========================================
COMMANDS /START & /ADDWORKER FROM MENU
========================================
*/

bot.onText(/^\/start$/, async (msg) => {
    if (!isOwner(msg)) return;
    delete userSessions[msg.chat.id];
    sendFinalResult(msg.chat.id, "👷 សួស្តីម្ចាស់ហាង! នេះជាម៉ឺនុយបញ្ជាចម្បងរបស់អ្នក៖");
});

bot.onText(/^\/addworker$/, async (msg) => {
    if (!isOwner(msg)) return;
    userSessions[msg.chat.id] = { state: "AWAITING_WORKER_DETAILS" };
    bot.sendMessage(msg.chat.id, "✍️ សូមវាយបញ្ចូលឈ្មោះ និងប្រាក់ថ្ងៃរបស់កម្មករថ្មី៖\n\n*ទម្រង់វាយ៖* `ឈ្មោះ ប្រាក់ឈ្នួល`\n*ឧទាហរណ៍៖* `សុខា 80000`", { parse_mode: "Markdown" });
});

bot.onText(/^\/listworkers$/, async (msg) => {
    if (!isOwner(msg)) return;
    sendWorkersList(msg.chat.id);
});

bot.onText(/^\/report$/, async (msg) => {
    if (!isOwner(msg)) return;
    sendWeeklyReport(msg.chat.id);
});

/*
========================================
CALLBACK QUERY (ដំណើរការរាល់ពេលចុចប៊ូតុងជាប់សារ)
========================================
*/
bot.on("callback_query", async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;

    try {
        // ១. មើលបញ្ជីកម្មករ
        if (data === "main_listworkers") {
            return sendWorkersList(chatId);
        }

        // ២. មើលរបាយការណ៍
        if (data === "main_report") {
            return sendWeeklyReport(chatId);
        }

        // ៣. បន្ថែមកម្មករ
        if (data === "main_addworker") {
            userSessions[chatId] = { state: "AWAITING_WORKER_DETAILS" };
            return bot.sendMessage(chatId, "✍️ សូមវាយបញ្ចូលឈ្មោះ និងប្រាក់ថ្ងៃរបស់កម្មករថ្មី៖\n\n*ទម្រង់វាយ៖* `ឈ្មោះ ប្រាក់ឈ្នួល`\n*ឧទាករណ៍៖* `សុខា 80000`", { parse_mode: "Markdown" });
        }

        // ៤. ចុចកត់អវត្តមាន -> បង្ហាញឈ្មោះកម្មករជាប៊ូតុង
        if (data === "main_absence") {
            const workers = readWorkers();
            if (workers.length === 0) return bot.sendMessage(chatId, "❌ មិនទាន់មានកម្មករទេ។");

            const buttons = workers.map(w => [{ text: `👤 ${w.name} (${w.dailySalary.toLocaleString()}៛)`, callback_data: `abs_select_${w.id}` }]);
            return bot.sendMessage(chatId, "👉 សូមជ្រើសរើសកម្មករដើម្បីកត់អវត្តមាន៖", { reply_markup: { inline_keyboard: buttons } });
        }

        // ៥. ចុចមើលប្រវត្តិច្បាប់ -> បង្ហាញឈ្មោះកម្មករជាប៊ូតុង
        if (data === "main_view_absence") {
            const workers = readWorkers();
            if (workers.length === 0) return bot.sendMessage(chatId, "❌ មិនទាន់មានកម្មករទេ។");

            const buttons = workers.map(w => [{ text: `📋 ${w.name}`, callback_data: `history_${w.id}` }]);
            return bot.sendMessage(chatId, "👉 សូមជ្រើសរើសកម្មករដើម្បីមើលប្រវត្តិ៖", { reply_markup: { inline_keyboard: buttons } });
        }

        // ៦. ចុចបើកលុយមុន -> បង្ហាញឈ្មោះកម្មករជាប៊ូតុង
        if (data === "main_borrow") {
            const workers = readWorkers();
            if (workers.length === 0) return bot.sendMessage(chatId, "❌ មិនទាន់មានកម្មករទេ។");

            const buttons = workers.map(w => [{ text: `💸 ${w.name}`, callback_data: `borrow_select_${w.id}` }]);
            return bot.sendMessage(chatId, "👉 សូមជ្រើសរើសកម្មករដែលចង់បើកលុយមុន៖", { reply_markup: { inline_keyboard: buttons } });
        }

        // ៧. ចុចលុបកម្មករ -> បង្ហាញឈ្មោះកម្មករជាប៊ូតុង
        if (data === "main_deleteworker") {
            const workers = readWorkers();
            if (workers.length === 0) return bot.sendMessage(chatId, "❌ មិនទាន់មានកម្មករទេ។");

            const buttons = workers.map(w => [{ text: `🗑 លុប៖ ${w.name}`, callback_data: `del_select_${w.id}` }]);
            return bot.sendMessage(chatId, "👉 សូមជ្រើសរើសកម្មករដែលចង់លុប៖", { reply_markup: { inline_keyboard: buttons } });
        }

        // ----------------------------------------------------
        // លទ្ធផលជ្រើសរើសឈ្មោះកម្មករពីប៊ូតុង (Sub-Actions)
        // ----------------------------------------------------

        // ករណី៖ កត់អវត្តមាន (ជ្រើសរើសប្រភេទច្បាប់)
        if (data.startsWith("abs_select_")) {
            const workerId = Number(data.replace("abs_select_", ""));
            const worker = getWorkerById(workerId);
            const half = worker.dailySalary / 2;

            return bot.sendMessage(chatId, `👤 កម្មករ: ${worker.name}\n👉 សូមជ្រើសរើសប្រភេទច្បាប់៖`, {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: `🌅 ឈប់ព្រឹក (កាត់ -${half.toLocaleString()}៛)`, callback_data: `abs_save_morning_${workerId}` }],
                        [{ text: `🌙 ឈប់ល្ងាច (កាត់ -${half.toLocaleString()}៛)`, callback_data: `abs_save_evening_${workerId}` }],
                        [{ text: `❌ ឈប់ពេញមួយថ្ងៃ (កាត់ -${worker.dailySalary.toLocaleString()}៛)`, callback_data: `abs_save_full_${workerId}` }],
                        [{ text: "✅ មកធ្វើការធម្មតាវិញ (លុបច្បាប់ថ្ងៃនេះ)", callback_data: `abs_save_present_${workerId}` }]
                    ]
                }
            });
        }

        // ដំណើរការរក្សាច្បាប់អវត្តមាន
        if (data.startsWith("abs_save_")) {
            const rem = data.replace("abs_save_", "");
            const today = getTodayDate();
            const attendance = readAttendance();

            if (rem.startsWith("present_")) {
                const wId = Number(rem.replace("present_", ""));
                if (attendance[today] && attendance[today][wId]) delete attendance[today][wId];
                saveAttendance(attendance);
                return sendFinalResult(chatId, `✅ បានកែប្រែ៖ ${getWorkerById(wId).name} មកធ្វើការពេញថ្ងៃធម្មតាវិញ។`);
            }

            let type = "";
            let wId = 0;
            if (rem.startsWith("morning_")) { type = "morning"; wId = Number(rem.replace("morning_", "")); }
            if (rem.startsWith("evening_")) { type = "evening"; wId = Number(rem.replace("evening_", "")); }
            if (rem.startsWith("full_")) { type = "full"; wId = Number(rem.replace("full_", "")); }

            if (!attendance[today]) attendance[today] = {};
            attendance[today][wId] = type;
            saveAttendance(attendance);

            return sendFinalResult(chatId, `✅ កត់ត្រាអវត្តមានជោគជ័យសម្រាប់៖ ${getWorkerById(wId).name}`);
        }

        // ករណី៖ បើកលុយមុន (រង់ចាំវាយតម្លៃលេខលុយ)
        if (data.startsWith("borrow_select_")) {
            const workerId = Number(data.replace("borrow_select_", ""));
            userSessions[chatId] = { state: "AWAITING_BORROW_AMOUNT", workerId: workerId };
            return bot.sendMessage(chatId, `✍️ សូមវាយបញ្ចូល *ចំនួនទឹកប្រាក់* ដែលកម្មករឈ្មោះ "${getWorkerById(workerId).name}" ចង់បើកមុន៖\n\n*(វាយតែលេខលុយត្រង់ៗ ឧទាហរណ៍៖ 50000)*`);
        }

        // ករណី៖ សួរលុបកម្មករ
        if (data.startsWith("del_select_")) {
            const workerId = Number(data.replace("del_select_", ""));
            const worker = getWorkerById(workerId);
            return bot.sendMessage(chatId, `⚠️ តើអ្នកពិតជាចង់លុបកម្មករឈ្មោះ "${worker.name}" មែនទេ?`, {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "❌ យល់ព្រមលុបចោល", callback_data: `confirm_del_${workerId}` }],
                        [{ text: "🔄 បោះបង់", callback_data: "cancel_del" }]
                    ]
                }
            });
        }

        if (data.startsWith("confirm_del_")) {
            const workerId = Number(data.replace("confirm_del_", ""));
            const workers = readWorkers().filter(w => w.id !== workerId);
            saveWorkers(workers);

            const borrows = readBorrows();
            if (borrows[workerId]) delete borrows[workerId];
            saveBorrows(borrows);

            return sendFinalResult(chatId, "🗑 បានលុបកម្មករចេញពីប្រព័ន្ធរួចរាល់។");
        }

        if (data === "cancel_del") {
            return sendFinalResult(chatId, "🔄 បានបោះបង់ការលុប។");
        }

        // ករណី៖ មើលប្រវត្តិច្បាប់
        if (data.startsWith("history_")) {
            const workerId = Number(data.replace("history_", ""));
            const worker = getWorkerById(workerId);
            const attendance = readAttendance();
            let text = `📋 ប្រវត្តិច្បាប់សប្តាហ៍នេះរបស់៖ ${worker.name}\n\n`;

            getWeekDates().sort().forEach(date => {
                const day = getKhmerDayName(date);
                const status = attendance[date]?.[workerId];
                let res = "មកធ្វើការ";
                if (status === "morning") res = "ឈប់ព្រឹក";
                if (status === "evening") res = "ឈប់ល្ងាច";
                if (status === "full") res = "ឈប់ពេញមួយថ្ងៃ";
                text += `• ${day} (${date}) : ${res}\n`;
            });

            return sendFinalResult(chatId, text);
        }

    } catch (err) {
        console.error(err);
    }
});

/*
========================================
MESSAGE HANDLER (សម្រាប់ចាំចាប់តម្លៃ VALUE ត្រង់ៗ)
========================================
*/
bot.on("message", (msg) => {
    if (!isOwner(msg)) return;
    const text = msg.text ? msg.text.trim() : "";
    if (text.startsWith("/")) return;

    const chatId = msg.chat.id;
    const session = userSessions[chatId];

    if (session) {
        // ករណី៖ វាយតម្លៃបន្ថែមកម្មករ (ឈ្មោះ លុយ)
        if (session.state === "AWAITING_WORKER_DETAILS") {
            const match = text.match(/^(.+)\s+(\d+)$/);
            if (!match) {
                return bot.sendMessage(chatId, "❌ ទម្រង់មិនត្រូវទេ! សូមវាយម្តងទៀត៖ `ឈ្មោះ ប្រាក់ថ្ងៃ` (ឧទាហរណ៍៖ `សុខា 80000`)");
            }
            const name = match[1].trim();
            const salary = Number(match[2]);

            const workers = readWorkers();
            const newId = workers.length > 0 ? Math.max(...workers.map(w => w.id)) + 1 : 1;
            workers.push({ id: newId, name, dailySalary: salary });
            saveWorkers(workers);

            delete userSessions[chatId];
            return sendFinalResult(chatId, `✅ បានបន្ថែមកម្មករជោគជ័យ៖\n\n👤 ឈ្មោះ: ${name}\n💰 ប្រាក់ថ្ងៃ: ${salary.toLocaleString()}៛`);
        }

        // ករណី៖ វាយលេខលុយបើកមុនត្រង់ៗ (លុយ)
        if (session.state === "AWAITING_BORROW_AMOUNT") {
            const amount = Number(text);
            if (isNaN(amount) || amount <= 0) {
                return bot.sendMessage(chatId, "❌ សូមវាយបញ្ចូលតែចំនួនលេខទឹកប្រាក់ប៉ុណ្ណោះ! (ឧទាហរណ៍៖ 50000)");
            }

            const workerId = session.workerId;
            const worker = getWorkerById(workerId);
            const borrows = readBorrows();

            if (!borrows[workerId]) borrows[workerId] = 0;
            borrows[workerId] += amount;
            saveBorrows(borrows);

            delete userSessions[chatId];
            return sendFinalResult(chatId, `💸 កត់ត្រាលុយបើកមុនរួចរាល់៖\n\n👤 កម្មករ៖ ${worker.name}\n💵 ចំនួនទឹកប្រាក់៖ ${amount.toLocaleString()}៛\n💰 ជំពាក់សរុប៖ ${borrows[workerId].toLocaleString()}៛`);
        }
    }
});

/*
========================================
CORE FUNCTIONS TO DISPLAY DATA
========================================
*/

function sendWorkersList(chatId) {
    const workers = readWorkers();
    if (workers.length === 0) return sendFinalResult(chatId, "❌ មិនទាន់មានកម្មករនៅក្នុងប្រព័ន្ធឡើយ។");

    let text = "👷 បញ្ជីឈ្មោះកម្មករ និងប្រាក់ថ្ងៃ\n\n";
    workers.forEach(w => {
        text += `• ${w.name} | ប្រាក់ប្រចាំថ្ងៃ: ${w.dailySalary.toLocaleString()}៛\n`;
    });
    sendFinalResult(chatId, text);
}

function calculateWorkerSalary(worker) {
    const attendance = readAttendance();
    const borrows = readBorrows();
    let total = worker.dailySalary * 6;

    getWeekDates().forEach(date => {
        const status = attendance[date]?.[worker.id];
        if (status === "morning" || status === "evening") total -= worker.dailySalary / 2;
        if (status === "full") total -= worker.dailySalary;
    });

    total -= (borrows[worker.id] || 0);
    return total < 0 ? 0 : total;
}

function sendWeeklyReport(chatId) {
    const workers = readWorkers();
    const borrows = readBorrows();
    if (workers.length === 0) return sendFinalResult(chatId, "❌ មិនទាន់មានកម្មករទេ។");

    let text = "💰 បញ្ជីបើកប្រាក់ប្រចាំសប្តាហ៍\n\n";
    workers.forEach((w, i) => {
        const total = calculateWorkerSalary(w);
        const adv = borrows[w.id] || 0;
        text += `${i + 1}. ${w.name}\n`;
        if (adv > 0) text += `  • បើកមុន៖ -${adv.toLocaleString()}៛\n`;
        text += `  • លុយត្រូវបើក៖ ${total.toLocaleString()}៛\n\n`;
    });

    sendFinalResult(chatId, text);
}

/*
========================================
CRON SCHEDULES
========================================
*/
cron.schedule("0 17 * * 6", async () => {
    try { sendWeeklyReport(OWNER_ID); } catch (err) { console.error(err); }
}, { timezone: "Asia/Phnom_Penh" });

cron.schedule("0 0 * * 0", async () => {
    try {
        saveAttendance({});
        saveBorrows({});
        sendFinalResult(OWNER_ID, "🔄 សប្តាហ៍ថ្មីបានចាប់ផ្តើម\nទិន្នន័យចាស់ត្រូវបាន Reset រួចរាល់។");
    } catch (err) { console.error(err); }
}, { timezone: "Asia/Phnom_Penh" });

/*
========================================
ERROR HANDLER
========================================
*/
bot.on("polling_error", err => console.error(err.message));
process.on("uncaughtException", err => console.error(err));
console.log("Worker Salary System Ready ✅");