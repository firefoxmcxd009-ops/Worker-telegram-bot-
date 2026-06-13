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
FILES & QUEUE SYSTEM (To prevent Race Conditions)
========================================
*/

const WORKERS_FILE = path.join(__dirname, "workers.json");
const ATTENDANCE_FILE = path.join(__dirname, "attendance.json");
const BORROW_FILE = path.join(__dirname, "borrow.json");

// Simple write queue to prevent race conditions
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

// មុខងារចម្រាញ់យកតែថ្ងៃក្នុងសប្តាហ៍បច្ចុប្បន្ន (Current Week) ដើម្បីកុំឱ្យគណនាដកលុយខុសខែ
function getWeekDates() {
    const dates = [];
    const now = new Date();
    const currentDay = now.getDay(); // 0 = អាទិត្យ, 1 = ចន្ទ ...
    
    // រកថ្ងៃចន្ទនៃសប្តាហ៍នេះ
    const monday = new Date(now);
    const distanceToMonday = currentDay === 0 ? -6 : 1 - currentDay;
    monday.setDate(now.getDate() + distanceToMonday);
    
    // ប្រមូលយកពីថ្ងៃចន្ទ ដល់ ថ្ងៃសៅរ៍ (៦ថ្ងៃ)
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

/*
========================================
DAY NAME
========================================
*/

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
ADD ABSENCE
========================================
*/

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
START
========================================
*/

bot.onText(/^\/start$/, async (msg) => {
    if (!isOwner(msg)) {
        return;
    }

    const text = `
👷 Worker Salary Bot

Commands:

/addworker ឈ្មោះ 20000
/add ឈ្មោះ 20000

/listworkers

/deleteworker ID

/អវត្តមាន

/មើលអវត្តមាន

/borrow ID ចំនួនលុយ (ឧទាហរណ៍៖ /borrow 1 50000)
/បុរេប្រទាន ID ចំនួនលុយ

/report
`;

    bot.sendMessage(msg.chat.id, text);
});

/*
========================================
ADD WORKER
========================================
*/

bot.onText(/^\/addworker (.+) (\d+)$/, (msg, match) => {
    if (!isOwner(msg)) {
        return;
    }

    const name = match[1].trim();
    const salary = Number(match[2]);
    const workers = readWorkers();

    const newId = workers.length > 0
        ? Math.max(...workers.map(w => w.id)) + 1
        : 1;

    workers.push({
        id: newId,
        name,
        dailySalary: salary
    });

    saveWorkers(workers);

    bot.sendMessage(
        msg.chat.id,
        `✅ Added\n\nID: ${newId}\nName: ${name}\nSalary: ${salary.toLocaleString()}៛`
    );
});

/*
========================================
SHORT ADD
========================================
*/

bot.onText(/^\/add (.+) (\d+)$/, (msg, match) => {
    if (!isOwner(msg)) {
        return;
    }

    const name = match[1].trim();
    const salary = Number(match[2]);
    const workers = readWorkers();

    const newId = workers.length > 0
        ? Math.max(...workers.map(w => w.id)) + 1
        : 1;

    workers.push({
        id: newId,
        name,
        dailySalary: salary
    });

    saveWorkers(workers);

    bot.sendMessage(
        msg.chat.id,
        `✅ Added\n\nID: ${newId}\nName: ${name}\nSalary: ${salary.toLocaleString()}៛`
    );
});

/*
========================================
LIST WORKERS
========================================
*/

bot.onText(/^\/listworkers$/, msg => {
    if (!isOwner(msg)) {
        return;
    }

    const workers = readWorkers();

    if (workers.length === 0) {
        return bot.sendMessage(msg.chat.id, "No workers found.");
    }

    let text = "👷 Workers List\n\n";

    workers.forEach(worker => {
        text += `${worker.id}. ${worker.name}\n`;
        text += `Salary: ${worker.dailySalary.toLocaleString()}៛\n\n`;
    });

    bot.sendMessage(msg.chat.id, text);
});

/*
========================================
DELETE WORKER (With Confirmation)
========================================
*/

bot.onText(/^\/deleteworker (\d+)$/, (msg, match) => {
    if (!isOwner(msg)) {
        return;
    }

    const workerId = Number(match[1]);
    const worker = getWorkerById(workerId);

    if (!worker) {
        return bot.sendMessage(msg.chat.id, "❌ រកមិនឃើញកម្មករអាយឌីនេះទេ។");
    }

    // បន្ថែមប្រព័ន្ធសួរដើម្បីបញ្ជាក់សិន ការពារការចុចច្រឡំលុប
    bot.sendMessage(
        msg.chat.id,
        `⚠️ តើអ្នកពិតជាចង់លុបកម្មករឈ្មោះ "${worker.name}" (ID: ${workerId}) មែនទេ?`,
        {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: "❌ យល់ព្រមលុប", callback_data: `confirm_del_${workerId}` },
                        { text: "🔄 បោះបង់", callback_data: "cancel_del" }
                    ]
                ]
            }
        }
    );
});

/*
========================================
BORROW / ADVANCE MONEY (New Feature)
========================================
*/

function handleBorrow(msg, workerId, amount) {
    if (!isOwner(msg)) return;

    const worker = getWorkerById(workerId);
    if (!worker) {
        return bot.sendMessage(msg.chat.id, "❌ មិនមានកម្មករអាយឌីនេះទេ។");
    }

    const borrows = readBorrows();
    if (!borrows[workerId]) {
        borrows[workerId] = 0;
    }
    borrows[workerId] += amount;
    saveBorrows(borrows);

    bot.sendMessage(
        msg.chat.id,
        `💸 កត់ត្រាលុយបុរេប្រទាន (បើកមុន)\n\nកម្មករ៖ ${worker.name}\nបានបើកមុន៖ ${amount.toLocaleString()}៛\nជំពាក់សរុបសប្តាហ៍នេះ៖ ${borrows[workerId].toLocaleString()}៛`
    );
}

bot.onText(/^\/borrow (\d+) (\d+)$/, (msg, match) => {
    handleBorrow(msg, Number(match[1]), Number(match[2]));
});

bot.onText(/^\/បុរេប្រទាន (\d+) (\d+)$/, (msg, match) => {
    handleBorrow(msg, Number(match[1]), Number(match[2]));
});

/*
========================================
ABSENCE MENU
========================================
*/

bot.onText(/^\/អវត្តមាន$/, msg => {
    if (!isOwner(msg)) {
        return;
    }

    const workers = readWorkers();

    if (workers.length === 0) {
        return bot.sendMessage(msg.chat.id, "No workers.");
    }

    const buttons = workers.map(worker => [{
        text: `${worker.name}`,
        callback_data: `worker_${worker.id}`
    }]);

    bot.sendMessage(
        msg.chat.id,
        "ជ្រើសកម្មករ",
        {
            reply_markup: {
                inline_keyboard: buttons
            }
        }
    );
});

/*
========================================
CALLBACK QUERY
========================================
*/

bot.on("callback_query", async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;

    try {

        /*
        ================================
        CONFIRM / CANCEL DELETE
        ================================
        */
        if (data.startsWith("confirm_del_")) {
            const workerId = Number(data.replace("confirm_del_", ""));
            const workers = readWorkers();
            const filtered = workers.filter(w => w.id !== workerId);
            saveWorkers(filtered);

            // លុបទិន្នន័យបុរេប្រទានរបស់គេចោលដែរ
            const borrows = readBorrows();
            if (borrows[workerId]) {
                delete borrows[workerId];
                saveBorrows(borrows);
            }

            return bot.editMessageText("🗑 កម្មករត្រូវបានលុបចេញពីប្រព័ន្ធដោយជោគជ័យ។", {
                chat_id: chatId,
                message_id: query.message.message_id
            });
        }

        if (data === "cancel_del") {
            return bot.editMessageText("🔄 បានបោះបង់ការលុប។", {
                chat_id: chatId,
                message_id: query.message.message_id
            });
        }

        /*
        ================================
        SELECT WORKER
        ================================
        */

        if (data.startsWith("worker_")) {
            const workerId = Number(data.replace("worker_", ""));
            const worker = getWorkerById(workerId);

            if (!worker) {
                return bot.answerCallbackQuery(query.id, {
                    text: "Worker not found"
                });
            }

            return bot.editMessageText(
                `👷 ${worker.name}\n\nជ្រើសប្រភេទអវត្តមាន`,
                {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    reply_markup: {
                        inline_keyboard: [
                            [
                                {
                                    text: "🌅 ឈប់ព្រឹក",
                                    callback_data: `abs_morning_${workerId}`
                                }
                            ],
                            [
                                {
                                    text: "🌙 ឈប់ល្ងាច",
                                    callback_data: `abs_evening_${workerId}`
                                }
                            ],
                            [
                                {
                                    text: "❌ ឈប់មួយថ្ងៃ",
                                    callback_data: `abs_full_${workerId}`
                                }
                            ],
                            // កង្វះខាតទី១៖ បន្ថែមប៊ូតុង "មកធ្វើការវិញ" ដើម្បីលុបច្បាប់ពេលចុចច្រឡំ
                            [
                                {
                                    text: "✅ មកធ្វើការវិញ (លុបច្បាប់ថ្ងៃនេះ)",
                                    callback_data: `abs_present_${workerId}`
                                }
                            ]
                        ]
                    }
                }
            );
        }

        /*
        ================================
        UNDO ABSENT (PRESENT)
        ================================
        */
        if (data.startsWith("abs_present_")) {
            const workerId = Number(data.replace("abs_present_", ""));
            const worker = getWorkerById(workerId);
            const attendance = readAttendance();
            const today = getTodayDate();

            if (attendance[today] && attendance[today][workerId]) {
                delete attendance[today][workerId];
                saveAttendance(attendance);
            }

            await bot.editMessageText(
                `✅ ${worker.name}\n\nកត់ត្រា:\nមកធ្វើការពេញថ្ងៃធម្មតាវិញហើយ\n\nប្រាក់ថ្ងៃនេះ:\n${worker.dailySalary.toLocaleString()}៛`,
                {
                    chat_id: chatId,
                    message_id: query.message.message_id
                }
            );
            return;
        }

        /*
        ================================
        MORNING ABSENT
        ================================
        */

        if (data.startsWith("abs_morning_")) {
            const workerId = Number(data.replace("abs_morning_", ""));
            const worker = getWorkerById(workerId);
            saveAbsence(workerId, "morning");
            await bot.editMessageText(
                `✅ ${worker.name}\n\nកត់ត្រា:\nឈប់ព្រឹក\n\nប្រាក់ថ្ងៃនេះ:\n${(worker.dailySalary / 2).toLocaleString()}៛`,
                {
                    chat_id: chatId,
                    message_id: query.message.message_id
                }
            );
            return;
        }

        /*
        ================================
        EVENING ABSENT
        ================================
        */

        if (data.startsWith("abs_evening_")) {
            const workerId = Number(data.replace("abs_evening_", ""));
            const worker = getWorkerById(workerId);
            saveAbsence(workerId, "evening");
            await bot.editMessageText(
                `✅ ${worker.name}\n\nកត់ត្រា:\nឈប់ល្ងាច\n\nប្រាក់ថ្ងៃនេះ:\n${(worker.dailySalary / 2).toLocaleString()}៛`,
                {
                    chat_id: chatId,
                    message_id: query.message.message_id
                }
            );
            return;
        }

        /*
        ================================
        FULL DAY ABSENT
        ================================
        */

        if (data.startsWith("abs_full_")) {
            const workerId = Number(data.replace("abs_full_", ""));
            const worker = getWorkerById(workerId);
            saveAbsence(workerId, "full");
            await bot.editMessageText(
                `✅ ${worker.name}\n\nកត់ត្រា:\nឈប់មួយថ្ងៃពេញ\n\nប្រាក់ថ្ងៃនេះ:\n0៛`,
                {
                    chat_id: chatId,
                    message_id: query.message.message_id
                }
            );
            return;
        }

        /*
        ================================
        VIEW WORKER HISTORY
        ================================
        */

        if (data.startsWith("history_")) {
            const workerId = Number(data.replace("history_", ""));
            const worker = getWorkerById(workerId);
            const attendance = readAttendance();
            let text = `📋 ${worker.name}\n\n`;
            
            // កែសម្រួល៖ បង្ហាញតែប្រវត្តិនៃសប្តាហ៍បច្ចុប្បន្នដើម្បីកុំឱ្យច្រឡំជាមួយសប្តាហ៍ចាស់
            const dates = getWeekDates().sort();
            
            dates.forEach(date => {
                const day = getKhmerDayName(date);
                const status = attendance[date]?.[workerId];
                let result = "មកពេញថ្ងៃ";

                if (status === "morning") {
                    result = "ឈប់ព្រឹក";
                }
                if (status === "evening") {
                    result = "ឈប់ល្ងាច";
                }
                if (status === "full") {
                    result = "ឈប់មួយថ្ងៃ";
                }

                text += `${day} (${date}) : ${result}\n`;
            });

            return bot.editMessageText(
                text,
                {
                    chat_id: chatId,
                    message_id: query.message.message_id
                }
            );
        }

    } catch (err) {
        console.error(err);
    }
});

/*
========================================
VIEW ABSENCE
========================================
*/

bot.onText(/^\/មើលអវត្តមាន$/, msg => {
    if (!isOwner(msg))
        return;

    const workers = readWorkers();

    if (workers.length === 0) {
        return bot.sendMessage(
            msg.chat.id,
            "No workers."
        );
    }

    const buttons = workers.map(worker => [
        {
            text: worker.name,
            callback_data: `history_${worker.id}`
        }
    ]);

    bot.sendMessage(
        msg.chat.id,
        "📋 ជ្រើសកម្មករ",
        {
            reply_markup: {
                inline_keyboard: buttons
            }
        }
    );
});

/*
========================================
SALARY CALCULATOR (With Current Week Locking & Advance Deduction)
========================================
*/

function calculateWorkerSalary(worker) {
    const attendance = readAttendance();
    const borrows = readBorrows();
    let total = 0;

    // កែសម្រួល៖ គណនាតែថ្ងៃដែលមាននៅក្នុងសប្តាហ៍បច្ចុប្បន្នប៉ុណ្ណោះ ការពារកូដគណនាជាន់ថ្ងៃចាស់
    const dates = getWeekDates();

    const weekDays = 6;
    total = worker.dailySalary * weekDays;

    dates.forEach(date => {
        const status = attendance[date]?.[worker.id];

        if (!status)
            return;

        if (status === "morning") {
            total -= worker.dailySalary / 2;
        }

        if (status === "evening") {
            total -= worker.dailySalary / 2;
        }

        if (status === "full") {
            total -= worker.dailySalary;
        }
    });

    // ដកលុយដែលកម្មករបានបើកមុន (បុរេប្រទាន) ចេញពីលុយសរុប
    const advancePaid = borrows[worker.id] || 0;
    total = total - advancePaid;

    return total < 0 ? 0 : total; // បើដកទៅអវិជ្ជមាន ឱ្យស្មើ 0
}

/*
========================================
MANUAL REPORT
========================================
*/

bot.onText(/^\/report$/, msg => {
    if (!isOwner(msg))
        return;

    sendWeeklyReport(msg.chat.id);
});

/*
========================================
SEND REPORT
========================================
*/

function sendWeeklyReport(chatId) {
    const workers = readWorkers();
    const borrows = readBorrows();
    if (workers.length === 0) return;

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

    bot.sendMessage(chatId, text);
}

/*
========================================
AUTO REPORT
SATURDAY 5 PM
CAMBODIA
========================================
*/

cron.schedule(
    "0 17 * * 6",
    async () => {
        try {
            sendWeeklyReport(OWNER_ID);
            console.log("Weekly report sent");
        } catch (err) {
            console.error(err);
        }
    },
    {
        timezone: "Asia/Phnom_Penh"
    }
);

/*
========================================
RESET WEEK
SUNDAY 00:00 (Includes Borrows Reset)
========================================
*/

cron.schedule(
    "0 0 * * 0",
    async () => {
        try {
            saveAttendance({});
            saveBorrows({}); // លុបទិន្នន័យជំពាក់លុយមុននៅដើមសប្តាហ៍ថ្មីដែរ

            bot.sendMessage(
                OWNER_ID,
                "🔄 សប្តាហ៍ថ្មីបានចាប់ផ្តើម\nAttendance & Advance Reset Complete"
            );

            console.log("Attendance & Borrows Reset");
        } catch (err) {
            console.error(err);
        }
    },
    {
        timezone: "Asia/Phnom_Penh"
    }
);

/*
========================================
ERROR HANDLER
========================================
*/

bot.on("polling_error", err => {
    console.error("Polling Error:", err.message);
});

/*
========================================
UNCAUGHT
========================================
*/

process.on("uncaughtException", err => {
    console.error(err);
});

process.on("unhandledRejection", err => {
    console.error(err);
});

console.log("Worker Salary System Ready ✅");