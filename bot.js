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
១. កំណត់ BUTTON MENU ខាងឆ្វេង BOX MESSAGE
========================================
*/
bot.setMyCommands([
    { command: "start", description: "បើកម៉ឺនុយមេ / បង្ហាញប៊ូតុងបញ្ជា" },
    { command: "addworker", description: "➕ បន្ថែមកម្មករថ្មី" },
    { command: "borrow", description: "💸 កត់ត្រាកម្មករបើកលុយមុន" },
    { command: "deleteworker", description: "🗑 លុបឈ្មោះកម្មករ" },
    { command: "listworkers", description: "👷 មើលបញ្ជីឈ្មោះកម្មករ" },
    { command: "report", description: "💰 មើលរបាយការណ៍ប្រាក់ខែសរុប" },
    { command: "absence", description: "📝 កត់ត្រាការឈប់សម្រាក (អវត្តមាន)" },
    { command: "view_absence", description: "📋 មើលប្រវត្តិច្បាប់កម្មករ" }
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

function saveAbsence(workerId, type) {
    const attendance = readAttendance();
    const today = getTodayDate();
    if (!attendance[today]) {
        attendance[today] = {};
    }
    attendance[today][workerId] = type;
    saveAttendance(attendance);
}

/*
========================================
២. វត្ថុរក្សាទម្រង់ប៊ូតុង KEYBOARD មេ (សម្រាប់ហៅប្រើគ្រប់សារ)
========================================
*/
const MAIN_KEYBOARD_MARKUP = {
    keyboard: [
        [{ text: "📝 កត់អវត្តមាន" }, { text: "📋 មើលអវត្តមាន" }],
        [{ text: "💰 មើលរបាយការណ៍" }, { text: "👷 បញ្ជីកម្មករ" }],
        [{ text: "✍️ បន្ថែមកម្មករ" }, { text: "💸 បើកលុយមុន" }]
    ],
    resize_keyboard: true,
    one_time_keyboard: false
};

// មុខងារផ្ញើសាររួម ដោយភ្ជាប់ប៊ូតុងមេទៅជាមួយជានិច្ច
function sendMessageWithKeyboard(chatId, textMessage, options = {}) {
    const finalOptions = {
        ...options,
        reply_markup: {
            ...options.reply_markup,
            keyboard: MAIN_KEYBOARD_MARKUP.keyboard,
            resize_keyboard: true,
            one_time_keyboard: false
        }
    };
    bot.sendMessage(chatId, textMessage, finalOptions);
}

/*
========================================
START
========================================
*/

bot.onText(/^\/start$/, async (msg) => {
    if (!isOwner(msg)) return;
    delete userSessions[msg.chat.id];

    const text = `👷 សួស្តីម្ចាស់ហាង! ស្វាគមន៍មកកាន់ប្រព័ន្ធគ្រប់គ្រងកម្មករ។\n\nលោកអ្នកអាចចុចប៊ូតុង "Menu" នៅខាងឆ្វេងប្រអប់សារ ឬប្រើប្រាស់ប៊ូតុងបញ្ជាធំៗនៅខាងក្រោមបានយ៉ាងងាយស្រួល។`;
    sendMessageWithKeyboard(msg.chat.id, text);
});

/*
========================================
ពាក្យបញ្ជាពី MENU ដែលត្រូវបញ្ចូល VALUE
========================================
*/

bot.onText(/^\/addworker$/, msg => {
    if (!isOwner(msg)) return;
    userSessions[msg.chat.id] = { state: "AWAITING_WORKER_DETAILS" };
    sendMessageWithKeyboard(msg.chat.id, "✍️ សូមវាយបញ្ចូលឈ្មោះ និងប្រាក់ថ្ងៃរបស់កម្មករថ្មី៖\n\n*ទម្រង់វាយ៖* `ឈ្មោះ ប្រាក់ឈ្នួល`\n*ឧទាហរណ៍៖* `សុខា 80000`", { parse_mode: "Markdown" });
});

bot.onText(/^\/borrow$/, msg => {
    if (!isOwner(msg)) return;
    userSessions[msg.chat.id] = { state: "AWAITING_BORROW_DETAILS" };
    sendMessageWithKeyboard(msg.chat.id, "✍️ សូមវាយបញ្ចូល ID កម្មករ និងចំនួនលុយដែលបើកមុន៖\n\n*ទម្រង់វាយ៖* `ID ចំនួនលុយ`\n*ឧទាហរណ៍៖* `1 50000`", { parse_mode: "Markdown" });
});

bot.onText(/^\/deleteworker$/, msg => {
    if (!isOwner(msg)) return;
    userSessions[msg.chat.id] = { state: "AWAITING_DELETE_ID" };
    sendMessageWithKeyboard(msg.chat.id, "✍️ សូមវាយបញ្ចូល *ID* របស់កម្មករដែលអ្នកចង់លុប៖\n\n*ឧទាហរណ៍៖* `1`", { parse_mode: "Markdown" });
});

bot.onText(/^\/listworkers$/, msg => { if (isOwner(msg)) { delete userSessions[msg.chat.id]; sendWorkersList(msg.chat.id); } });
bot.onText(/^\/report$/, msg => { if (isOwner(msg)) { delete userSessions[msg.chat.id]; sendWeeklyReport(msg.chat.id); } });
bot.onText(/^\/absence$/, msg => { if (isOwner(msg)) { delete userSessions[msg.chat.id]; sendAbsenceMenu(msg.chat.id); } });
bot.onText(/^\/view_absence$/, msg => { if (isOwner(msg)) { delete userSessions[msg.chat.id]; sendViewAbsenceMenu(msg.chat.id); } });

bot.onText(/^\/អវត្តមាន$/, msg => { if (isOwner(msg)) { delete userSessions[msg.chat.id]; sendAbsenceMenu(msg.chat.id); } });
bot.onText(/^\/មើលអវត្តមាន$/, msg => { if (isOwner(msg)) { delete userSessions[msg.chat.id]; sendViewAbsenceMenu(msg.chat.id); } });

/*
========================================
៣. ដំណើរការចាប់សារទូទៅ និងប៊ូតុងបញ្ជា
========================================
*/
bot.on("message", (msg) => {
    if (!isOwner(msg)) return;
    const text = msg.text ? msg.text.trim() : "";

    if (text.startsWith("/")) return;

    const chatId = msg.chat.id;
    const session = userSessions[chatId];

    if (text === "📝 កត់អវត្តមាន") {
        delete userSessions[chatId];
        return sendAbsenceMenu(chatId);
    } else if (text === "📋 មើលអវត្តមាន") {
        delete userSessions[chatId];
        return sendViewAbsenceMenu(chatId);
    } else if (text === "💰 មើលរបាយការណ៍") {
        delete userSessions[chatId];
        return sendWeeklyReport(chatId);
    } else if (text === "👷 បញ្ជីកម្មករ") {
        delete userSessions[chatId];
        return sendWorkersList(chatId);
    } else if (text === "✍️ បន្ថែមកម្មករ") {
        userSessions[chatId] = { state: "AWAITING_WORKER_DETAILS" };
        return sendMessageWithKeyboard(chatId, "✍️ សូមវាយបញ្ចូលឈ្មោះ និងប្រាក់ថ្ងៃរបស់កម្មករថ្មី៖\n\n*ទម្រង់វាយ៖* `ឈ្មោះ ប្រាក់ឈ្នួល`\n*ឧទាហរណ៍៖* `សុខា 80000`", { parse_mode: "Markdown" });
    } else if (text === "💸 បើកលុយមុន") {
        userSessions[chatId] = { state: "AWAITING_BORROW_DETAILS" };
        return sendMessageWithKeyboard(chatId, "✍️ សូមវាយបញ្ចូល ID កម្មករ និងចំនួនលុយដែលបើកមុន៖\n\n*ទម្រង់វាយ៖* `ID ចំនួនលុយ`\n*ឧទាហរណ៍៖* `1 50000`", { parse_mode: "Markdown" });
    }

    if (session) {
        if (session.state === "AWAITING_WORKER_DETAILS") {
            const match = text.match(/^(.+)\s+(\d+)$/);
            if (!match) {
                return sendMessageWithKeyboard(chatId, "❌ ទម្រង់វាយមិនត្រឹមត្រូវទេ! សូមវាយម្តងទៀតតាមទម្រង់៖ `ឈ្មោះ ប្រាក់ថ្ងៃ` (ឧទាហរណ៍៖ `សុខា 80000`)");
            }
            const name = match[1].trim();
            const salary = Number(match[2]);
            
            delete userSessions[chatId];
            return handleAddWorker(msg, name, salary);
        }

        if (session.state === "AWAITING_BORROW_DETAILS") {
            const match = text.match(/^(\d+)\s+(\d+)$/);
            if (!match) {
                return sendMessageWithKeyboard(chatId, "❌ ទម្រង់វាយមិនត្រឹមត្រូវទេ! សូមវាយម្តងទៀតតាមទម្រង់៖ `ID ចំនួនលុយ` (ឧទាហរណ៍៖ `1 50000`)");
            }
            const workerId = Number(match[1]);
            const amount = Number(match[2]);

            delete userSessions[chatId];
            return handleBorrow(msg, workerId, amount);
        }

        if (session.state === "AWAITING_DELETE_ID") {
            const workerId = Number(text);
            if (isNaN(workerId)) {
                return sendMessageWithKeyboard(chatId, "❌ សូមវាយបញ្ចូលតែលេខ ID របស់កម្មករប៉ុណ្ណោះ (ឧទាហរណ៍៖ `1`)");
            }
            
            delete userSessions[chatId];
            return askDeleteConfirmation(chatId, workerId);
        }
    }
});

/*
========================================
ADD WORKER CORE FUNCTION
========================================
*/
function handleAddWorker(msg, name, salary) {
    const workers = readWorkers();
    const newId = workers.length > 0 ? Math.max(...workers.map(w => w.id)) + 1 : 1;

    workers.push({ id: newId, name, dailySalary: salary });
    saveWorkers(workers);

    sendMessageWithKeyboard(
        msg.chat.id,
        `✅ បានបន្ថែមកម្មករជោគជ័យ\n\n🆔 ID: ${newId}\n👤 ឈ្មោះ: ${name}\n💰 ប្រាក់ថ្ងៃ: ${salary.toLocaleString()}៛`
    );
}

/*
========================================
LIST WORKERS CORE FUNCTION
========================================
*/
function sendWorkersList(chatId) {
    const workers = readWorkers();
    if (workers.length === 0) {
        return sendMessageWithKeyboard(chatId, "❌ មិនទាន់មានកម្មករនៅក្នុងប្រព័ន្ធឡើយ។");
    }

    let text = "👷 បញ្ជីកម្មករ និងប្រាក់ថ្ងៃ\n\n";
    workers.forEach(worker => {
        text += `🆔 ID: ${worker.id} | 👤 ${worker.name}\n`;
        text += `💰 ប្រាក់ប្រចាំថ្ងៃ: ${worker.dailySalary.toLocaleString()}៛\n\n`;
    });
    sendMessageWithKeyboard(chatId, text);
}

/*
========================================
DELETE WORKER CONFIRMATION
========================================
*/
function askDeleteConfirmation(chatId, workerId) {
    const worker = getWorkerById(workerId);
    if (!worker) {
        return sendMessageWithKeyboard(chatId, "❌ រកមិនឃើញកម្មករអាយឌីនេះទេ។");
    }

    // សារសួរបញ្ជាក់នេះប្រើ Inline Keyboard (ប៉ុន្តែប៊ូតុងធំខាងក្រោមក៏នៅតែមិនបាត់ដែរ)
    bot.sendMessage(
        chatId,
        `⚠️ តើអ្នកពិតជាចង់លុបកម្មករឈ្មោះ "${worker.name}" (ID: ${workerId}) មែនទេ?`,
        {
            reply_markup: {
                keyboard: MAIN_KEYBOARD_MARKUP.keyboard,
                resize_keyboard: true,
                one_time_keyboard: false,
                inline_keyboard: [
                    [
                        { text: "❌ យល់ព្រមលុប", callback_data: `confirm_del_${workerId}` },
                        { text: "🔄 បោះបង់", callback_data: "cancel_del" }
                    ]
                ]
            }
        }
    );
}

bot.onText(/^\/deleteworker (\d+)$/, (msg, match) => {
    if (!isOwner(msg)) return;
    askDeleteConfirmation(msg.chat.id, Number(match[1]));
});

/*
========================================
BORROW MONEY CORE FUNCTION
========================================
*/
function handleBorrow(msg, workerId, amount) {
    const worker = getWorkerById(workerId);
    if (!worker) {
        return sendMessageWithKeyboard(msg.chat.id, "❌ មិនមានកម្មករអាយឌីនេះទេ។");
    }

    const borrows = readBorrows();
    if (!borrows[workerId]) {
        borrows[workerId] = 0;
    }
    borrows[workerId] += amount;
    saveBorrows(borrows);

    sendMessageWithKeyboard(
        msg.chat.id,
        `💸 កត់ត្រាលុយបុរេប្រទាន (បើកមុន)\n\nកម្មករ៖ ${worker.name}\nបានបើកមុន៖ ${amount.toLocaleString()}៛\nជំពាក់សរុបសប្តាហ៍នេះ៖ ${borrows[workerId].toLocaleString()}៛`
    );
}

bot.onText(/^\/borrow (\d+) (\d+)$/, (msg, match) => {
    if (!isOwner(msg)) return;
    handleBorrow(msg, Number(match[1]), Number(match[2]));
});

/*
========================================
ABSENCE MENU
========================================
*/
function sendAbsenceMenu(chatId) {
    const workers = readWorkers();
    if (workers.length === 0) {
        return sendMessageWithKeyboard(chatId, "❌ មិនទាន់មានកម្មករទេ។");
    }

    const buttons = workers.map(worker => [{
        text: `👤 ${worker.name} (ប្រាក់ថ្ងៃ: ${worker.dailySalary.toLocaleString()}៛)`,
        callback_data: `worker_${worker.id}`
    }]);

    bot.sendMessage(chatId, "👉 សូមជ្រើសរើសកម្មករដើម្បីកត់អវត្តមាន៖", {
        reply_markup: { 
            keyboard: MAIN_KEYBOARD_MARKUP.keyboard,
            resize_keyboard: true,
            inline_keyboard: buttons 
        }
    });
}

/*
========================================
VIEW ABSENCE MENU
========================================
*/
function sendViewAbsenceMenu(chatId) {
    const workers = readWorkers();
    if (workers.length === 0) {
        return sendMessageWithKeyboard(chatId, "❌ មិនទាន់មានកម្មករទេ។");
    }

    const buttons = workers.map(worker => [{
        text: `📋 មើលប្រវត្តិ៖ ${worker.name}`,
        callback_data: `history_${worker.id}`
    }]);

    bot.sendMessage(chatId, "សូមជ្រើសរើសកម្មករដើម្បីមើលប្រវត្តិច្បាប់៖", {
        reply_markup: { 
            keyboard: MAIN_KEYBOARD_MARKUP.keyboard,
            resize_keyboard: true,
            inline_keyboard: buttons 
        }
    });
}

/*
========================================
CALLBACK QUERY
========================================
*/
bot.on("callback_query", async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;

    try {
        if (data.startsWith("confirm_del_")) {
            const workerId = Number(data.replace("confirm_del_", ""));
            const workers = readWorkers();
            const filtered = workers.filter(w => w.id !== workerId);
            saveWorkers(filtered);

            const borrows = readBorrows();
            if (borrows[workerId]) {
                delete borrows[workerId];
                saveBorrows(borrows);
            }

            return bot.editMessageText("🗑 កម្មករត្រូវបានលុបចេញពីប្រព័ន្ធដោយជោគជ័យ។", {
                chat_id: chatId, message_id: query.message.message_id
            });
        }

        if (data === "cancel_del") {
            return bot.editMessageText("🔄 បានបោះបង់ការលុប។", {
                chat_id: chatId, message_id: query.message.message_id
            });
        }

        if (data.startsWith("worker_")) {
            const workerId = Number(data.replace("worker_", ""));
            const worker = getWorkerById(workerId);
            if (!worker) return bot.answerCallbackQuery(query.id, { text: "រកមិនឃើញកម្មករ" });

            const halfSalary = worker.dailySalary / 2;
            return bot.editMessageText(
                `👤 កម្មករ: ${worker.name} (ប្រាក់ថ្ងៃ: ${worker.dailySalary.toLocaleString()}៛)\n\n👉 សូមជ្រើសរើសប្រភេទអវត្តមាន៖`,
                {
                    chat_id: chatId, message_id: query.message.message_id,
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: `🌅 ឈប់ព្រឹក (កាត់ -${halfSalary.toLocaleString()}៛)`, callback_data: `abs_morning_${workerId}` }],
                            [{ text: `🌙 ឈប់ល្ងាច (កាត់ -${halfSalary.toLocaleString()}៛)`, callback_data: `abs_evening_${workerId}` }],
                            [{ text: `❌ ឈប់មួយថ្ងៃពេញ (កាត់ -${worker.dailySalary.toLocaleString()}៛)`, callback_data: `abs_full_${workerId}` }],
                            [{ text: "✅ មកធ្វើការវិញ (លុបច្បាប់ថ្ងៃនេះ)", callback_data: `abs_present_${workerId}` }]
                        ]
                    }
                }
            );
        }

        if (data.startsWith("abs_present_")) {
            const workerId = Number(data.replace("abs_present_", ""));
            const worker = getWorkerById(workerId);
            const attendance = readAttendance();
            const today = getTodayDate();

            if (attendance[today] && attendance[today][workerId]) {
                delete attendance[today][workerId];
                saveAttendance(attendance);
            }

            return bot.editMessageText(`✅ ${worker.name}\n\nកត់ត្រា៖ មកធ្វើការពេញថ្ងៃធម្មតាវិញហើយ\nប្រាក់ថ្ងៃនេះ៖ ${worker.dailySalary.toLocaleString()}៛`, {
                chat_id: chatId, message_id: query.message.message_id
            });
        }

        if (data.startsWith("abs_morning_")) {
            const workerId = Number(data.replace("abs_morning_", ""));
            const worker = getWorkerById(workerId);
            saveAbsence(workerId, "morning");
            return bot.editMessageText(`✅ ${worker.name}\n\nកត់ត្រា៖ ឈប់ព្រឹក\nប្រាក់ថ្ងៃនេះ៖ ${(worker.dailySalary / 2).toLocaleString()}៛`, {
                chat_id: chatId, message_id: query.message.message_id
            });
        }

        if (data.startsWith("abs_evening_")) {
            const workerId = Number(data.replace("abs_evening_", ""));
            const worker = getWorkerById(workerId);
            saveAbsence(workerId, "evening");
            return bot.editMessageText(`✅ ${worker.name}\n\nកត់ត្រា៖ ឈប់ល្ងាច\nប្រាក់ថ្ងៃនេះ៖ ${(worker.dailySalary / 2).toLocaleString()}៛`, {
                chat_id: chatId, message_id: query.message.message_id
            });
        }

        if (data.startsWith("abs_full_")) {
            const workerId = Number(data.replace("abs_full_", ""));
            const worker = getWorkerById(workerId);
            saveAbsence(workerId, "full");
            return bot.editMessageText(`✅ ${worker.name}\n\nកត់ត្រា៖ ឈប់មួយថ្ងៃពេញ\nប្រាក់ថ្ងៃនេះ៖ 0៛`, {
                chat_id: chatId, message_id: query.message.message_id
            });
        }

        if (data.startsWith("history_")) {
            const workerId = Number(data.replace("history_", ""));
            const worker = getWorkerById(workerId);
            const attendance = readAttendance();
            let text = `📋 ប្រវត្តិច្បាប់របស់៖ ${worker.name}\n\n`;
            
            const dates = getWeekDates().sort();
            dates.forEach(date => {
                const day = getKhmerDayName(date);
                const status = attendance[date]?.[workerId];
                let result = "មកពេញថ្ងៃ";

                if (status === "morning") result = "ឈប់ព្រឹក";
                if (status === "evening") result = "ឈប់ល្ងាច";
                if (status === "full") result = "ឈប់មួយថ្ងៃ";

                text += `${day} (${date}) : ${result}\n`;
            });

            return bot.editMessageText(text, { chat_id: chatId, message_id: query.message.message_id });
        }

    } catch (err) {
        console.error(err);
    }
});

/*
========================================
SALARY CALCULATOR
========================================
*/
function calculateWorkerSalary(worker) {
    const attendance = readAttendance();
    const borrows = readBorrows();
    const dates = getWeekDates();

    let total = worker.dailySalary * 6;

    dates.forEach(date => {
        const status = attendance[date]?.[worker.id];
        if (!status) return;

        if (status === "morning" || status === "evening") {
            total -= worker.dailySalary / 2;
        }
        if (status === "full") {
            total -= worker.dailySalary;
        }
    });

    const advancePaid = borrows[worker.id] || 0;
    total -= advancePaid;

    return total < 0 ? 0 : total;
}

/*
========================================
SEND REPORT
========================================
*/
function sendWeeklyReport(chatId) {
    const workers = readWorkers();
    const borrows = readBorrows();
    if (workers.length === 0) return sendMessageWithKeyboard(chatId, "❌ មិនទាន់មានកម្មករទេ។");

    let text = "💰 បញ្ជីបើកប្រាក់ប្រចាំសប្តាហ៍\n\n";

    workers.forEach((worker, index) => {
        const total = calculateWorkerSalary(worker);
        const advance = borrows[worker.id] || 0;

        text += `${index + 1}. ${worker.name} (ID: ${worker.id})\n`;
        if (advance > 0) {
            text += `  • បើកមុន៖ -${advance.toLocaleString()}៛\n`;
        }
        text += `  • ប្រាក់ខែត្រូវបើក៖ ${total.toLocaleString()}៛\n\n`;
    });

    sendMessageWithKeyboard(chatId, text);
}

/*
========================================
CRON SCHEDULES
========================================
*/
cron.schedule("0 17 * * 6", async () => {
    try {
        sendWeeklyReport(OWNER_ID);
    } catch (err) { console.error(err); }
}, { timezone: "Asia/Phnom_Penh" });

cron.schedule("0 0 * * 0", async () => {
    try {
        saveAttendance({});
        saveBorrows({});
        sendMessageWithKeyboard(OWNER_ID, "🔄 សប្តាហ៍ថ្មីបានចាប់ផ្តើម\nAttendance & Advance Reset Complete");
    } catch (err) { console.error(err); }
}, { timezone: "Asia/Phnom_Penh" });

/*
========================================
ERROR HANDLER
========================================
*/
bot.on("polling_error", err => console.error("Polling Error:", err.message));
process.on("uncaughtException", err => console.error(err));
process.on("unhandledRejection", err => console.error(err));

console.log("Worker Salary System Ready ✅");
