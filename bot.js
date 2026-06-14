require("dotenv").config();
const express = require("express");
const cron = require("node-cron");
const TelegramBot = require("node-telegram-bot-api");
const mongoose = require("mongoose");

const TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;
const MONGO_URL = "mongodb+srv://allinonebot:allinonebot123@amertakcluster.m5zjxka.mongodb.net/worker_db?retryWrites=true&w=majority&appName=AmertakCluster";

const bot = new TelegramBot(TOKEN, { polling: true });

// --- SET MENU ---
bot.setMyCommands([
    { command: "start", description: "🚀 ម៉ឺនុយមេ" },
    { command: "myprojects", description: "📁 បញ្ជីប្រូជេក" },
    { command: "addworker", description: "➕ បន្ថែមកម្មករ" },
    { command: "listworkers", description: "👷 មើលកម្មករ" },
    { command: "report", description: "💰 របាយការណ៍" },
    { command: "logout", description: "🚪 ចាកចេញ" }
]);

mongoose.connect(MONGO_URL);

// --- SCHEMAS ---
const Account = mongoose.model("Account", new mongoose.Schema({
    id: String, creatorId: String, projectName: String, password: String,
    workers: Array, attendance: Object, borrows: Object
}));
const Session = mongoose.model("Session", new mongoose.Schema({ chatId: String, projectId: String }));

const userSessions = {};
const activeProjectInfoMsg = {};

// --- UTILS ---
async function maskProjectInfo(chatId) {
    if (activeProjectInfoMsg[chatId]) {
        const { messageId, project } = activeProjectInfoMsg[chatId];
        const masked = `📁 <b>ព័ត៌មានប្រូជេក (Locked)</b>\n\n🏗 ឈ្មោះ: <b>${project.projectName}</b>\n🔑 ID: <tg-spoiler>${project.id}</tg-spoiler>\n🔐 PW: <tg-spoiler>${project.password}</tg-spoiler>`;
        try { await bot.editMessageText(masked, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "🔙 ត្រឡប់", callback_data: "back_to_projects" }]] } }); } catch (e) {}
        delete activeProjectInfoMsg[chatId];
    }
}

// --- MESSAGE HANDLER ---
bot.on("message", async (msg) => {
    await maskProjectInfo(msg.chat.id);
    if (msg.text?.startsWith("/")) return;

    const chatId = msg.chat.id;
    const state = userSessions[chatId]?.state;

    if (state === "REGISTRATION_PROJECT_NAME") {
        userSessions[chatId] = { state: "REGISTRATION_PASSWORD", projectName: msg.text };
        bot.sendMessage(chatId, "✍️ សូមវាយបញ្ចូលពាក្យសម្ងាត់ប្រូជេក (យ៉ាងតិច ៦ខ្ទង់):");
    } else if (state === "REGISTRATION_PASSWORD") {
        const p = await Account.find({});
        const nextId = p.length > 0 ? String(Math.max(...p.map(a => Number(a.id))) + 1) : "1";
        const acc = new Account({ id: nextId, creatorId: String(msg.from.id), projectName: userSessions[chatId].projectName, password: msg.text });
        await acc.save();
        delete userSessions[chatId];
        bot.sendMessage(chatId, `✅ បង្កើតជោគជ័យ! Project ID: ${nextId}`);
    } else if (state === "AWAITING_WORKER_DETAILS") {
        const [name, salary] = msg.text.split(" ");
        const session = await Session.findOne({ chatId: String(chatId) });
        const acc = await Account.findOne({ id: session.projectId });
        acc.workers.push({ id: Date.now(), name, dailySalary: Number(salary) });
        await acc.save();
        delete userSessions[chatId];
        bot.sendMessage(chatId, "✅ បន្ថែមកម្មករជោគជ័យ!");
    }
});

// --- CALLBACK HANDLER ---
bot.on("callback_query", async (q) => {
    const chatId = q.message.chat.id;
    const session = await Session.findOne({ chatId: String(chatId) });
    
    if (q.data === "auth_register") { userSessions[chatId] = { state: "REGISTRATION_PROJECT_NAME" }; bot.sendMessage(chatId, "✍️ វាយឈ្មោះប្រូជេក:"); }
    else if (q.data.startsWith("view_proj_")) {
        const acc = await Account.findOne({ id: q.data.replace("view_proj_", "") });
        const sent = await bot.editMessageText(`📁 <b>ព័ត៌មានប្រូជេក</b>\n\n🏗 ឈ្មោះ: ${acc.projectName}\n🔑 ID: ${acc.id}\n🔐 PW: ${acc.password}`, { chat_id: chatId, message_id: q.message.message_id, parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "🔙 ត្រឡប់", callback_data: "back_to_projects" }]] } });
        activeProjectInfoMsg[chatId] = { messageId: sent.message_id, project: acc };
    }
    // បងអាចបន្ថែម Logic ប៊ូតុងផ្សេងៗ (Absence, Report, Borrow) នៅទីនេះតាមលំនាំដដែល
});

// --- COMMANDS ---
bot.onText(/\/myprojects/, async (m) => {
    const projs = await Account.find({ creatorId: String(m.from.id) });
    bot.sendMessage(m.chat.id, "📁 ប្រូជេករបស់អ្នក:", { reply_markup: { inline_keyboard: projs.map(p => [{ text: p.projectName, callback_data: `view_proj_${p.id}` }]) } });
});

bot.onText(/\/addworker/, (m) => { userSessions[m.chat.id] = { state: "AWAITING_WORKER_DETAILS" }; bot.sendMessage(m.chat.id, "✍️ វាយ: `ឈ្មោះ ប្រាក់ខែ`"); });

bot.onText(/\/start/, (m) => bot.sendMessage(m.chat.id, "🚀 ម៉ឺនុយមេ", { reply_markup: { inline_keyboard: [[{ text: "Register", callback_data: "auth_register" }, { text: "Login", callback_data: "auth_login" }]] } }));

const app = express();
app.get("/", (req, res) => res.send("Bot is Running"));
app.listen(PORT);
