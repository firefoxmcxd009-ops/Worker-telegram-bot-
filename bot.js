require("dotenv").config();

const fs = require("fs");
const path = require("path");
const express = require("express");
const cron = require("node-cron");
const TelegramBot = require("node-telegram-bot-api");

/* =========================================================
CONFIG
========================================================= */
const TOKEN = process.env.BOT_TOKEN;
const OWNER_ID = Number(process.env.OWNER_ID);
const PORT = process.env.PORT || 3000;

if (!TOKEN) throw new Error("BOT_TOKEN missing");
if (!OWNER_ID) throw new Error("OWNER_ID missing");

/* =========================================================
EXPRESS SERVER
========================================================= */
const app = express();

app.get("/", (req, res) => {
    res.send("Worker Bot Running ✅");
});

app.listen(PORT, () => {
    console.log("Server running:", PORT);
});

/* =========================================================
BOT INIT
========================================================= */
const bot = new TelegramBot(TOKEN, { polling: true });

console.log("Bot started");

/* =========================================================
FILES
========================================================= */
const WORKERS_FILE = path.join(__dirname, "workers.json");
const ATT_FILE = path.join(__dirname, "attendance.json");

/* =========================================================
INIT FILES
========================================================= */
if (!fs.existsSync(WORKERS_FILE)) {
    fs.writeFileSync(WORKERS_FILE, "[]");
}

if (!fs.existsSync(ATT_FILE)) {
    fs.writeFileSync(ATT_FILE, "{}");
}

/* =========================================================
HELPERS
========================================================= */
function read(file) {
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
        return {};
    }
}

function save(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function isOwner(msg) {
    return msg.from.id === OWNER_ID;
}

/* =========================================================
DATE SYSTEM
========================================================= */
function today() {
    return new Date().toISOString().split("T")[0];
}

/* =========================================================
WEEK SYSTEM (MON - SAT)
========================================================= */
function getWeekDates() {
    const now = new Date();
    const day = now.getDay();

    const diff = day === 0 ? -6 : 1 - day;

    const mon = new Date(now);
    mon.setDate(now.getDate() + diff);

    let arr = [];

    for (let i = 0; i < 6; i++) {
        let d = new Date(mon);
        d.setDate(mon.getDate() + i);

        arr.push(d.toISOString().split("T")[0]);
    }

    return arr;
}

/* =========================================================
DATA LAYER
========================================================= */
function getWorkers() {
    return read(WORKERS_FILE);
}

function getAttendance() {
    return read(ATT_FILE);
}

/* =========================================================
WORKER MANAGEMENT
========================================================= */
function addWorker(name, salary) {
    let w = getWorkers();

    let id = w.length ? w[w.length - 1].id + 1 : 1;

    w.push({
        id,
        name,
        dailySalary: salary
    });

    save(WORKERS_FILE, w);

    return id;
}

function deleteWorker(id) {
    let w = getWorkers().filter(x => x.id !== id);
    save(WORKERS_FILE, w);
}

/* =========================================================
ATTENDANCE SYSTEM
========================================================= */
function setAttendance(date, workerId, type) {
    let att = getAttendance();

    if (!att[date]) att[date] = {};

    att[date][workerId] = type;

    save(ATT_FILE, att);
}

/* =========================================================
SALARY ENGINE (FIXED CORE)
========================================================= */
function calculateSalary(worker) {

    const att = getAttendance();
    const week = getWeekDates();

    let total = worker.dailySalary * week.length;

    week.forEach(date => {

        const status = att?.[date]?.[worker.id];

        if (!status) return;

        if (status === "morning" || status === "evening") {
            total -= worker.dailySalary / 2;
        }

        if (status === "full") {
            total -= worker.dailySalary;
        }
    });

    return Math.max(0, total);
}

/* =========================================================
REPORT SYSTEM
========================================================= */
function generateReport() {

    let w = getWorkers();

    let text = "💰 Weekly Payroll Report\n\n";

    w.forEach((x, i) => {

        text += `${i + 1}. ${x.name}\n`;
        text += `Salary: ${calculateSalary(x).toLocaleString()}៛\n\n`;
    });

    return text;
}

/* =========================================================
START COMMAND
========================================================= */
bot.onText(/\/start/, (msg) => {

    if (!isOwner(msg)) return;

    bot.sendMessage(msg.chat.id,
`👷 Worker Bot System

/addworker name salary
/add name salary
/listworkers
/deleteworker id
/អវត្តមាន
/មើលអវត្តមាន
/report`
    );
});

/* =========================================================
ADD WORKER
========================================================= */
bot.onText(/\/addworker (.+) (\d+)/, (msg, m) => {

    if (!isOwner(msg)) return;

    let id = addWorker(m[1], Number(m[2]));

    bot.sendMessage(msg.chat.id, `Added Worker ID: ${id}`);
});

/* alias add */
bot.onText(/\/add (.+) (\d+)/, (msg, m) => {

    if (!isOwner(msg)) return;

    let id = addWorker(m[1], Number(m[2]));

    bot.sendMessage(msg.chat.id, `Added Worker ID: ${id}`);
});

/* =========================================================
LIST WORKERS
========================================================= */
bot.onText(/\/listworkers/, (msg) => {

    if (!isOwner(msg)) return;

    let w = getWorkers();

    let text = "👷 Workers List\n\n";

    w.forEach(x => {
        text += `${x.id}. ${x.name} - ${x.dailySalary}៛\n`;
    });

    bot.sendMessage(msg.chat.id, text);
});

/* =========================================================
DELETE WORKER
========================================================= */
bot.onText(/\/deleteworker (\d+)/, (msg, m) => {

    if (!isOwner(msg)) return;

    deleteWorker(Number(m[1]));

    bot.sendMessage(msg.chat.id, "Deleted ✔");
});

/* =========================================================
ABSENCE MENU
========================================================= */
bot.onText(/\/អវត្តមាន/, (msg) => {

    if (!isOwner(msg)) return;

    let w = getWorkers();

    let kb = w.map(x => ([{
        text: x.name,
        callback_data: "w_" + x.id
    }]));

    bot.sendMessage(msg.chat.id, "Select Worker", {
        reply_markup: {
            inline_keyboard: kb
        }
    });
});

/* =========================================================
CALLBACK SYSTEM
========================================================= */
bot.on("callback_query", (q) => {

    const data = q.data;
    const chatId = q.message.chat.id;

    let workers = getWorkers();
    let att = getAttendance();

    /* worker select */
    if (data.startsWith("w_")) {

        let id = Number(data.split("_")[1]);
        let w = workers.find(x => x.id === id);

        return bot.editMessageText(`👷 ${w.name}`, {
            chat_id: chatId,
            message_id: q.message.message_id,
            reply_markup: {
                inline_keyboard: [
                    [{ text: "🌅 Morning", callback_data: `m_${id}` }],
                    [{ text: "🌙 Evening", callback_data: `e_${id}` }],
                    [{ text: "❌ Full Day", callback_data: `f_${id}` }]
                ]
            }
        });
    }

    let date = today();

    if (!att[date]) att[date] = {};

    if (data.startsWith("m_")) {
        let id = data.split("_")[1];
        att[date][id] = "morning";
    }

    if (data.startsWith("e_")) {
        let id = data.split("_")[1];
        att[date][id] = "evening";
    }

    if (data.startsWith("f_")) {
        let id = data.split("_")[1];
        att[date][id] = "full";
    }

    save(ATT_FILE, att);

    bot.answerCallbackQuery(q.id, { text: "Saved ✔" });
});

/* =========================================================
REPORT COMMAND
========================================================= */
bot.onText(/\/report/, (msg) => {

    if (!isOwner(msg)) return;

    bot.sendMessage(msg.chat.id, generateReport());
});

/* =========================================================
AUTO REPORT (SAT 5PM)
========================================================= */
cron.schedule("0 17 * * 6", () => {

    bot.sendMessage(OWNER_ID, generateReport());

}, {
    timezone: "Asia/Phnom_Penh"
});

/* =========================================================
RESET (SUN 00:00)
========================================================= */
cron.schedule("0 0 * * 0", () => {

    save(ATT_FILE, {});

    bot.sendMessage(OWNER_ID, "🔄 New Week Started");

}, {
    timezone: "Asia/Phnom_Penh"
});

/* =========================================================
ERROR HANDLING
========================================================= */
process.on("uncaughtException", console.error);
process.on("unhandledRejection", console.error);

console.log("READY ✔");