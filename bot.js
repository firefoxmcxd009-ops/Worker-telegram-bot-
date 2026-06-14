require("dotenv").config();

const express = require("express");
const cron = require("node-cron");
const TelegramBot = require("node-telegram-bot-api");
const mongoose = require("mongoose");
const path = require("path");

/*
========================================
CONFIG & MONGO URL CONNECTION
========================================
*/
const TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;
const MONGO_URL = "mongodb+srv://allinonebot:allinonebot123@amertakcluster.m5zjxka.mongodb.net/worker_db?retryWrites=true&w=majority&appName=AmertakCluster";

if (!TOKEN) {
    console.error("❌ មិនទាន់បានដាក់ BOT_TOKEN នៅក្នុង .env ឡើយ!");
    process.exit(1);
}

/*
========================================
EXPRESS SERVER & WEB DASHBOARD
========================================
*/
const app = express();

// បើកឱ្យ Express អាច Serve ឯកសារ HTML/CSS/JS នៅក្នុង Folder "dashboard" 
app.use("/dashboard", express.static(path.join(__dirname, "dashboard")));

app.get("/", (req, res) => res.send("Multi-Project Worker Bot with MongoDB is Running ✅"));

app.listen(PORT, () => console.log(`Server running on port ${PORT} 🌐`));

// បន្ថែមក្នុង bot.js ក្រោមផ្នែក Express
app.get("/api/dashboard-data", async (req, res) => {
    const userId = req.query.userId;
    // រកមើល Session ដែលមាន userId នេះ
    const session = await Session.findOne({ chatId: userId });
    if (!session) return res.json({ success: false });

    const account = await Account.findOne({ id: session.projectId });
    res.json({
        success: true,
        projectName: account.projectName,
        id: account.id,
        workers: account.workers
    });
});

const cors = require('cors');
app.use(cors());
app.use(express.json());

// API សម្រាប់ទាញយកទិន្នន័យកម្មករ
app.get("/api/dashboard-data", async (req, res) => {
    const userId = req.query.userId;
    try {
        // រកមើល Account ដែលមាន creatorId នេះ
        const account = await Account.findOne({ creatorId: userId });
        if (!account) return res.json({ success: false, message: "មិនទាន់មានគណនី" });

        res.json({
            success: true,
            projectName: account.projectName,
            id: account.id,
            workers: account.workers,
            totalAdvance: Object.values(account.borrows || {}).reduce((a, b) => a + b, 0)
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/*
========================================
MONGODB CONNECTION
========================================
*/
mongoose.connect(MONGO_URL)
    .then(() => console.log("Connected to MongoDB Cloud successfully! 📁✨ (Data is 100% Safe)"))
    .catch(err => {
        console.error("MongoDB connection error:", err);
        process.exit(1);
    });

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
    attendance: { type: Object, default: {} }, 
    borrows: { type: Object, default: {} }     
});

const SessionSchema = new mongoose.Schema({
    chatId: { type: String, required: true, unique: true },
    projectId: { type: String, required: true } 
});

const Account = mongoose.model("Account", AccountSchema);
const Session = mongoose.model("Session", SessionSchema);

/*
========================================
TELEGRAM BOT
========================================
*/
const bot = new TelegramBot(TOKEN, { polling: true });
console.log("Telegram Bot Started 🚀");

bot.setMyCommands([
    { command: "start", description: "🚀 ចាប់ផ្តើម / ម៉ឺនុយមេ" },
    { command: "id", description: "🆔 មើល Telegram ID របស់អ្នក" },
    { command: "myprojects", description: "📁 មើលបញ្ជីប្រូជេកទាំងអស់របស់អ្នក" },
    { command: "logout", description: "🚪 ចាកចេញពីប្រូជេកបច្ចុប្បន្ន" },
    { command: "addworker", description: "➕ បន្ថែមកម្មករថ្មី" },
    { command: "listworkers", description: "👷 មើលបញ្ជីឈ្មោះកម្មករ" },
    { command: "report", description: "💰 មើលរបាយការណ៍ប្រាក់ខែ" }
]);

const userSessions = {};

/*
========================================
HELPERS
========================================
*/
function validatePassword(password) {
    const hasLetter = /[a-zA-Z]/.test(password);
    const hasNumber = /[0-9]/.test(password);
    const isLongEnough = password.length >= 6; 
    return hasLetter && hasNumber && isLongEnough;
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
        const nextDay = new Date(monday);
        nextDay.setDate(monday.getDate() + i);
        dates.push(`${nextDay.getFullYear()}-${String(nextDay.getMonth() + 1).padStart(2, "0")}-${String(nextDay.getDate()).padStart(2, "0")}`);
    }
    return dates;
}

function getKhmerDayName(dateStr) {
    const date = new Date(dateStr);
    const map = { 0: "អាទិត្យ", 1: "ចន្ទ", 2: "អង្គារ", 3: "ពុធ", 4: "ព្រហស្បតិ៍", 5: "សុក្រ", 6: "សៅរ៍" };
    return map[date.getDay()];
}

/*
========================================
KEYBOARDS & INTERFACES
========================================
*/
const MAIN_INLINE_KEYBOARD = [
    [{ text: "📝 កត់អវត្តមាន", callback_data: "main_absence" }, { text: "📋 មើលអវត្តមាន", callback_data: "main_view_absence" }],
    [{ text: "💸 បើកលុយមុន", callback_data: "main_borrow" }, { text: "👷 បញ្ជីកម្មករ", callback_data: "main_listworkers" }],
    [{ text: "✍️ បន្ថែមកម្មករ", callback_data: "main_addworker" }, { text: "🗑 លុបកម្មករ", callback_data: "main_deleteworker" }],
    [{ text: "💰 មើលរបាយការណ៍ប្រាក់ខែ", callback_data: "main_report" }],
    [{ 
        text: "🌐 បើក Dashboard", 
        web_app: { url: "https://worker-telegram-bot-nwoq.onrender.com/dashboard/index.html" } 
    }],
    [{ text: "🚪 ចាកចេញ (Logout)", callback_data: "main_logout" }]
];

function sendMainMenu(chatId, projectName, projectId) {
    const text = `📁 ប្រូជេកបច្ចុប្បន្ន៖ **${projectName}**\n👷 **ម៉ឺនុយបញ្ជាចម្បង**\n\nសូមជ្រើសរើសមុខងារណាមួយខាងក្រោមដើម្បីគ្រប់គ្រង៖`;
    bot.sendMessage(chatId, text, { parse_mode: "Markdown", reply_markup: { inline_keyboard: MAIN_INLINE_KEYBOARD } });
}

function sendAuthRequired(chatId, telegramId) {
    const text = `🔒 **មិនទាន់បានចូលប្រើប្រាស់ប្រូជេកទេ!**\n\n` +
                 `🆔 Telegram ID របស់អ្នកគឺ៖ \`${telegramId}\`\n\n` +
                 `សូមជ្រើសរើសមុខងារខាងក្រោម៖\n` +
                 `1️⃣ **Register**៖ ដើម្បីបង្កើតប្រូជេកថ្មី (អាចបង្កើតបានច្រើន)\n` +
                 `2️⃣ **Login**៖ ដើម្បីចូលប្រើប្រូជេកដែលធ្លាប់បង្កើតរួច`;
    bot.sendMessage(chatId, text, {
        parse_mode: "Markdown",
        reply_markup: {
            inline_keyboard: [
                [{ text: "🔐 បង្កើតប្រូជេកថ្មី (Register)", callback_data: "auth_register" }],
                [{ text: "🔑 ចូលប្រើប្រាស់ (Login)", callback_data: "auth_login" }]
            ]
        }
    });
}

async function handleLogout(chatId) {
    await Session.deleteOne({ chatId: String(chatId) });
    delete userSessions[chatId];
    bot.sendMessage(chatId, "🚪 បានចាកចេញពីប្រូជេកដោយជោគជ័យ។");
}

/*
========================================
COMMAND HANDLERS
========================================
*/
bot.onText(/^\/start$/, async (msg) => {
    delete userSessions[msg.chat.id];
    const session = await Session.findOne({ chatId: String(msg.chat.id) });

    if (!session) {
        return sendAuthRequired(msg.chat.id, msg.from.id);
    }

    const account = await Account.findOne({ id: session.projectId });
    if (!account) {
        await handleLogout(msg.chat.id);
        return sendAuthRequired(msg.chat.id, msg.from.id);
    }

    const welcomeText = `👋 សួស្តី! ស្វាគមន៍មកកាន់ប្រព័ន្ធគ្រប់គ្រងកម្មករ។\n\n` +
                        `📁 ប្រូជេកសកម្ម៖ **${account.projectName}**\n` +
                        `🆔 Telegram ID របស់អ្នក៖ \`${msg.from.id}\`\n\n` +
                        `ℹ️ លោកអ្នកអាចប្រើម៉ឺនុយប៊ូតុងខាងក្រោមដើម្បីបញ្ជាការងារលឿនរហ័ស។`;
    
    bot.sendMessage(msg.chat.id, welcomeText, { parse_mode: "Markdown" }).then(() => {
        sendMainMenu(msg.chat.id, account.projectName, account.id);
    });
});

bot.onText(/^\/id$/, (msg) => {
    bot.sendMessage(msg.chat.id, `🆔 Telegram ID របស់អ្នកគឺ៖ \`${msg.from.id}\` *(ចុចដើម្បី Copy)*`, { parse_mode: "Markdown" });
});

bot.onText(/^\/logout$/, async (msg) => {
    await handleLogout(msg.chat.id);
    sendAuthRequired(msg.chat.id, msg.from.id);
});

bot.onText(/^\/myprojects$/, async (msg) => {
    delete userSessions[msg.chat.id]; // Clear any pending text input state
    const creatorId = String(msg.from.id);
    const projects = await Account.find({ creatorId: creatorId });
    
    if (projects.length === 0) {
        return bot.sendMessage(msg.chat.id, "❌ លោកអ្នកមិនទាន់ធ្លាប់បានបង្កើតប្រូជេកណាមួយឡើយ។");
    }
    
    const buttons = projects.map(p => [{ text: `🏗 ${p.projectName}`, callback_data: `view_proj_${p.id}` }]);

    bot.sendMessage(msg.chat.id, "📁 <b>បញ្ជីប្រូជេករបស់អ្នកទាំងអស់៖</b>\n👉 <i>សូមចុចលើឈ្មោះប្រូជេកដើម្បីមើលព័ត៌មានលម្អិត</i>", { 
        parse_mode: "HTML", 
        reply_markup: { inline_keyboard: buttons } 
    });
});

bot.onText(/^\/listworkers$/, async (msg) => {
    delete userSessions[msg.chat.id];
    const session = await Session.findOne({ chatId: String(msg.chat.id) });
    if (!session) return sendAuthRequired(msg.chat.id, msg.from.id);
    const account = await Account.findOne({ id: session.projectId });
    if (!account) return sendAuthRequired(msg.chat.id, msg.from.id);

    if (account.workers.length === 0) return bot.sendMessage(msg.chat.id, "❌ មិនទាន់មានកម្មករនៅក្នុងប្រព័ន្ធឡើយ។", { reply_markup: { inline_keyboard: MAIN_INLINE_KEYBOARD } });
    let text = "👷 **បញ្ជីឈ្មោះកម្មករ និងប្រាក់ថ្ងៃ**\n\n";
    account.workers.forEach(w => { text += `• 👤 **${w.name}** | ប្រាក់ថ្ងៃ: ${w.dailySalary.toLocaleString()}៛\n`; });
    return bot.sendMessage(msg.chat.id, text, { parse_mode: "Markdown", reply_markup: { inline_keyboard: MAIN_INLINE_KEYBOARD } });
});

bot.onText(/^\/addworker$/, async (msg) => {
    delete userSessions[msg.chat.id];
    const session = await Session.findOne({ chatId: String(msg.chat.id) });
    if (!session) return sendAuthRequired(msg.chat.id, msg.from.id);
    userSessions[msg.chat.id] = { state: "AWAITING_WORKER_DETAILS" };
    return bot.sendMessage(msg.chat.id, "✍️ សូមវាយបញ្ចូលឈ្មោះ និងប្រាក់ថ្ងៃរបស់កម្មករថ្មី (អាចបញ្ចូលច្រើននាក់បានដោយចុះបន្ទាត់)៖\n\n*ទម្រង់វាយ៖*\n`ឈ្មោះទី១ ប្រាក់ថ្ងៃ`\n`ឈ្មោះទី២ ប្រាក់ថ្ងៃ`\n\n*ឧទាហរណ៍៖*\n`សុខា 80000`\n`មករា 75000`", { parse_mode: "Markdown" });
});

bot.onText(/^\/report$/, async (msg) => {
    delete userSessions[msg.chat.id];
    const session = await Session.findOne({ chatId: String(msg.chat.id) });
    if (!session) return sendAuthRequired(msg.chat.id, msg.from.id);
    const account = await Account.findOne({ id: session.projectId });
    if (!account) return sendAuthRequired(msg.chat.id, msg.from.id);

    if (account.workers.length === 0) return bot.sendMessage(msg.chat.id, "❌ មិនទាន់មានកម្មករទេ។", { reply_markup: { inline_keyboard: MAIN_INLINE_KEYBOARD } });
    let text = "💰 **📊 របាយការណ៍បើកប្រាក់ប្រចាំសប្តាហ៍**\n\n";
    account.workers.forEach((w, index) => {
        let total = w.dailySalary * 6;
      
        getWeekDates().forEach(date => {
            const status = account.attendance[date]?.[w.id];
            if (status === "morning" || status === "evening") total -= (w.dailySalary / 2);
            if (status === "full") total -= w.dailySalary;
        });
        const adv = account.borrows[w.id] || 0;
        total -= adv;
        if (total < 0) total = 0;

        text += `${index + 1}. 👤 **${w.name}**\n`;
        if (adv > 0) text += `   • បើកមុន៖ -${adv.toLocaleString()}៛\n`;
        text += `   • លុយត្រូវបើក៖ **${total.toLocaleString()}៛**\n\n`;
    });
    return bot.sendMessage(msg.chat.id, text, { parse_mode: "Markdown", reply_markup: { inline_keyboard: MAIN_INLINE_KEYBOARD } });
});

/*
========================================
CALLBACK QUERY HANDLER
========================================
*/
bot.on("callback_query", async (query) => {
    const chatId = query.message.chat.id;
    const telegramId = query.from.id;
    const data = query.data;

    try {
        // Clear Text State on any button click to avoid overlap bugs
        if (!data.startsWith("auth_") && !data.startsWith("main_addworker") && !data.startsWith("borrow_select_")) {
            delete userSessions[chatId]; 
        }

        if (data === "main_logout") {
            await handleLogout(chatId);
            return sendAuthRequired(chatId, telegramId);
        }

        if (data === "auth_register") {
            userSessions[chatId] = { state: "REGISTRATION_PROJECT_NAME" };
            return bot.sendMessage(chatId, `✍️ **ជំហានទី១៖** សូមវាយបញ្ចូល **ឈ្មោះប្រូជេក** ថ្មីរបស់អ្នក៖\n\n*ឧទាហរណ៍៖ ការដ្ឋានចោមចៅ*`);
        }

        if (data === "auth_login") {
            userSessions[chatId] = { state: "LOGIN_CREDENTIALS" };
            return bot.sendMessage(chatId, `✍️ **សូមវាយបញ្ចូល Project ID និង ពាក្យសម្ងាត់ប្រូជេក៖**\n\n*ទម្រង់វាយ៖* \`ProjectID ពាក្យសម្ងាត់\`\n*ឧទាហរណ៍៖* \`1 boss123\``, { parse_mode: "Markdown" });
        }

        if (data === "cancel_to_main") {
            delete userSessions[chatId];
            const session = await Session.findOne({ chatId: String(chatId) });
            if (!session) return sendAuthRequired(chatId, telegramId);
            const account = await Account.findOne({ id: session.projectId });
            if (!account) return sendAuthRequired(chatId, telegramId);
            return sendMainMenu(chatId, account.projectName, account.id);
        }

        if (data.startsWith("view_proj_")) {
            const projId = data.replace("view_proj_", "");
            const project = await Account.findOne({ id: projId, creatorId: String(telegramId) });

            if (!project) return bot.answerCallbackQuery(query.id, { text: "❌ រកមិនឃើញប្រូជេកនេះទេ" });

            const text = `📁 <b>ព័ត៌មានលម្អិតប្រូជេក</b>\n\n` +
                         `🏗 ឈ្មោះប្រូជេក៖ <b>${project.projectName}</b>\n` +
                         `🔑 Project ID: <tg-spoiler><code>${project.id}</code></tg-spoiler>\n` +
                         `🔐 Password: <tg-spoiler><code>${project.password}</code></tg-spoiler>\n\n` +
                         `<i>(សូមចុចលើផ្ទាំងព្រាលៗដើម្បីមើល រួចចុចលើលេខកូដដើម្បី Copy)</i>`;

            return bot.editMessageText(text, {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: "HTML",
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "🔙 ត្រឡប់ក្រោយ", callback_data: "back_to_projects" }]
                    ]
                }
            });
        }

        if (data === "back_to_projects") {
            const projects = await Account.find({ creatorId: String(telegramId) });
            const buttons = projects.map(p => [{ text: `🏗 ${p.projectName}`, callback_data: `view_proj_${p.id}` }]);
            
            return bot.editMessageText("📁 <b>បញ្ជីប្រូជេករបស់អ្នកទាំងអស់៖</b>\n👉 <i>សូមចុចលើឈ្មោះប្រូជេកដើម្បីមើលព័ត៌មានលម្អិត</i>", {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: "HTML",
                reply_markup: { inline_keyboard: buttons }
            });
        }

        const session = await Session.findOne({ chatId: String(chatId) });
        if (!session && !data.startsWith("auth_")) return sendAuthRequired(chatId, telegramId);

        const account = await Account.findOne({ id: session?.projectId });
        if (!account && !data.startsWith("auth_")) return sendAuthRequired(chatId, telegramId);

        if (data === "main_addworker") {
            userSessions[chatId] = { state: "AWAITING_WORKER_DETAILS" };
            return bot.sendMessage(chatId, "✍️ សូមវាយបញ្ចូលឈ្មោះ និងប្រាក់ថ្ងៃរបស់កម្មករថ្មី (អាចបញ្ចូលច្រើននាក់បានដោយចុះបន្ទាត់)៖\n\n*ទម្រង់វាយ៖*\n`ឈ្មោះទី១ ប្រាក់ថ្ងៃ`\n`ឈ្មោះទី២ ប្រាក់ថ្ងៃ`\n\n*ឧទាហរណ៍៖*\n`សុខា 80000`\n`មករា 75000`", { parse_mode: "Markdown" });
        }

        if (data === "main_listworkers") {
            if (account.workers.length === 0) return bot.sendMessage(chatId, "❌ មិនទាន់មានកម្មករនៅក្នុងប្រព័ន្ធឡើយ។");
            let text = "👷 **បញ្ជីឈ្មោះកម្មករ និងប្រាក់ថ្ងៃ**\n\n";
            account.workers.forEach(w => { text += `• 👤 **${w.name}** | ប្រាក់ថ្ងៃ: ${w.dailySalary.toLocaleString()}៛\n`; });
            return bot.sendMessage(chatId, text, { parse_mode: "Markdown", reply_markup: { inline_keyboard: MAIN_INLINE_KEYBOARD } });
        }

        if (data === "main_report") {
            if (account.workers.length === 0) return bot.sendMessage(chatId, "❌ មិនទាន់មានកម្មករទេ។");
            let text = "💰 **📊 របាយការណ៍បើកប្រាក់ប្រចាំសប្តាហ៍**\n\n";
            account.workers.forEach((w, index) => {
                let total = w.dailySalary * 6;
                getWeekDates().forEach(date => {
                    const status = account.attendance[date]?.[w.id];
                    if (status === "morning" || status === "evening") total -= (w.dailySalary / 2);
                    if (status === "full") total -= w.dailySalary;
                });
                const adv = account.borrows[w.id] || 0;
                total -= adv;
                
                if (total < 0) total = 0;

                text += `${index + 1}. 👤 **${w.name}**\n`;
                if (adv > 0) text += `   • បើកមុន៖ -${adv.toLocaleString()}៛\n`;
                text += `   • លុយត្រូវបើក៖ **${total.toLocaleString()}៛**\n\n`;
            });
            return bot.sendMessage(chatId, text, { parse_mode: "Markdown", reply_markup: { inline_keyboard: MAIN_INLINE_KEYBOARD } });
        }

        if (data === "main_absence") {
            if (account.workers.length === 0) return bot.sendMessage(chatId, "❌ មិនទាន់មានកម្មករទេ។");
            const buttons = account.workers.map(w => [{ text: `👤 ${w.name}`, callback_data: `abs_select_${w.id}` }]);
            buttons.push([{ text: "🔄 បោះបង់", callback_data: "cancel_to_main" }]);
            return bot.sendMessage(chatId, "👉 សូមជ្រើសរើសកម្មករដើម្បីកត់អវត្តមាន៖", { reply_markup: { inline_keyboard: buttons } });
        }

        if (data === "main_view_absence") {
            if (account.workers.length === 0) return bot.sendMessage(chatId, "❌ មិនទាន់មានកម្មករទេ។");
            const buttons = account.workers.map(w => [{ text: `📋 ${w.name}`, callback_data: `history_${w.id}` }]);
            buttons.push([{ text: "🔄 បោះបង់", callback_data: "cancel_to_main" }]);
            return bot.sendMessage(chatId, "👉 សូមជ្រើសរើសកម្មករដើម្បីមើលប្រវត្តិច្បាប់៖", { reply_markup: { inline_keyboard: buttons } });
        }

        if (data === "main_borrow") {
            if (account.workers.length === 0) return bot.sendMessage(chatId, "❌ មិនទាន់មានកម្មករទេ។");
            const buttons = account.workers.map(w => [{ text: `💸 ${w.name}`, callback_data: `borrow_select_${w.id}` }]);
            buttons.push([{ text: "🔄 បោះបង់", callback_data: "cancel_to_main" }]);
            return bot.sendMessage(chatId, "👉 សូមជ្រើសរើសកម្មករដែលចង់កត់ត្រាបើកលុយមុន៖", { reply_markup: { inline_keyboard: buttons } });
        }

        if (data === "main_deleteworker") {
            if (account.workers.length === 0) return bot.sendMessage(chatId, "❌ មិនទាន់មានកម្មករទេ។");
            const buttons = account.workers.map(w => [{ text: `🗑 លុប៖ ${w.name}`, callback_data: `del_select_${w.id}` }]);
            buttons.push([{ text: "🔄 បោះបង់", callback_data: "cancel_to_main" }]);
            return bot.sendMessage(chatId, "👉 សូមជ្រើសរើសកម្មករដែលអ្នកចង់លុបឈ្មោះ៖", { reply_markup: { inline_keyboard: buttons } });
        }

        if (data.startsWith("abs_select_")) {
            const workerId = Number(data.replace("abs_select_", ""));
            const worker = account.workers.find(w => w.id === workerId);
            const half = worker.dailySalary / 2;
            return bot.sendMessage(chatId, `👤 កម្មករ: **${worker.name}**\n👉 សូមជ្រើសរើសប្រភេទអវត្តមាន៖`, {
                parse_mode: "Markdown",
                reply_markup: {
                    inline_keyboard: [
                        [{ text: `🌅 ឈប់ព្រឹក (កាត់ -${half.toLocaleString()}៛)`, callback_data: `abs_save_morning_${workerId}` }],
                        [{ text: `🌙 ឈប់ល្ងាច (កាត់ -${half.toLocaleString()}៛)`, callback_data: `abs_save_evening_${workerId}` }],
                        [{ text: `❌ ឈប់មួយថ្ងៃពេញ (កាត់ -${worker.dailySalary.toLocaleString()}៛)`, callback_data: `abs_save_full_${workerId}` }],
                        [{ text: "✅ មកធ្វើការធម្មតាវិញ", callback_data: `abs_save_present_${workerId}` }],
                        [{ text: "🔄 បោះបង់", callback_data: "main_absence" }]
                    ]
                }
            });
        }

        if (data.startsWith("abs_save_")) {
            const rem = data.replace("abs_save_", "");
            const today = getTodayDate();
            
            if (!account.attendance[today]) account.attendance[today] = {};

            if (rem.startsWith("present_")) {
                const wId = Number(rem.replace("present_", ""));
                delete account.attendance[today][wId];
                account.markModified("attendance");
                await account.save();
                return bot.sendMessage(chatId, `✅ បានកែប្រែ៖ **${account.workers.find(w=>w.id===wId).name}** មកធ្វើការធម្មតាវិញ។`, { parse_mode: "Markdown", reply_markup: { inline_keyboard: MAIN_INLINE_KEYBOARD } });
            }

            let type = ""; let wId = 0;
            if (rem.startsWith("morning_")) { type = "morning"; wId = Number(rem.replace("morning_", "")); }
            if (rem.startsWith("evening_")) { type = "evening"; wId = Number(rem.replace("evening_", "")); }
            if (rem.startsWith("full_")) { type = "full"; wId = Number(rem.replace("full_", "")); }

            account.attendance[today][wId] = type;
            account.markModified("attendance");
            await account.save();
            return bot.sendMessage(chatId, `✅ កត់អវត្តមានជោគជ័យ៖ **${account.workers.find(w=>w.id===wId).name}**`, { parse_mode: "Markdown", reply_markup: { inline_keyboard: MAIN_INLINE_KEYBOARD } });
        }

        if (data.startsWith("borrow_select_")) {
            const workerId = Number(data.replace("borrow_select_", ""));
            userSessions[chatId] = { state: "AWAITING_BORROW_AMOUNT", workerId: workerId };
            return bot.sendMessage(chatId, `✍️ សូមវាយបញ្ចូល **ចំនួនទឹកប្រាក់** ដែលកម្មករឈ្មោះ "${account.workers.find(w=>w.id===workerId).name}" បានបើកមុន៖`);
        }

        if (data.startsWith("del_select_")) {
            const workerId = Number(data.replace("del_select_", ""));
            const worker = account.workers.find(w => w.id === workerId);
            return bot.sendMessage(chatId, `⚠️ តើអ្នកពិតជាចង់លុបកម្មករឈ្មោះ "**${worker.name}**" មែនទេ?`, {
                parse_mode: "Markdown",
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "❌ យល់ព្រមលុបចោល", callback_data: `confirm_del_${workerId}` }],
                        [{ text: "🔄 បោះបង់", callback_data: "cancel_to_main" }] 
                    ]
                }
            });
        }

        if (data.startsWith("confirm_del_")) {
            const workerId = Number(data.replace("confirm_del_", ""));
            account.workers = account.workers.filter(w => w.id !== workerId);
            if (account.borrows[workerId]) delete account.borrows[workerId];
            account.markModified("borrows");
            await account.save();
            return bot.sendMessage(chatId, "🗑 បានលុបកម្មករចេញពីប្រព័ន្ធរួចរាល់។", { reply_markup: { inline_keyboard: MAIN_INLINE_KEYBOARD } });
        }

        if (data.startsWith("history_")) {
            const workerId = Number(data.replace("history_", ""));
            const worker = account.workers.find(w => w.id === workerId);
            let text = `📋 **ប្រវត្តិច្បាប់សប្តាហ៍នេះរបស់៖ ${worker.name}**\n\n`;
            getWeekDates().sort().forEach(date => {
                const day = getKhmerDayName(date);
                const status = account.attendance[date]?.[workerId];
                let res = "មកធ្វើការ";
                if (status === "morning") res = "ឈប់ព្រឹក";
                if (status === "evening") res = "ឈប់ល្ងាច";
                if (status === "full") res = "ឈប់ពេញមួយថ្ងៃ";
                text += `• ${day} (${date}) : *${res}*\n`;
            });
            return bot.sendMessage(chatId, text, { parse_mode: "Markdown", reply_markup: { inline_keyboard: MAIN_INLINE_KEYBOARD } });
        }

    } catch (err) { console.error(err); }
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

    if (sessionState.state === "REGISTRATION_PROJECT_NAME") {
        if (text.length < 2) return bot.sendMessage(chatId, "❌ ឈ្មោះប្រូជេកខ្លីពេកហើយ! សូមវាយម្តងទៀត៖");
        userSessions[chatId] = { state: "REGISTRATION_PASSWORD", projectName: text };
        return bot.sendMessage(chatId, `✍️ **ជំហានទី២៖** សូមបង្កើតពាក្យសម្ងាត់សម្រាប់ប្រូជេក "${text}"៖\n\n⚠️ *លក្ខខណ្ឌ៖* ត្រូវមាន**អក្សរលាយលេខ** យ៉ាងតិច **៦ ខ្ទង់** (ឧទាហរណ៍៖ boss123)`);
    }

    if (sessionState.state === "REGISTRATION_PASSWORD") {
        if (!validatePassword(text)) {
            return bot.sendMessage(chatId, "❌ **ពាក្យសម្ងាត់មិនត្រូវតាមលក្ខខណ្ឌទេ!**\n\nសូមវាយម្តងទៀត៖ ត្រូវមាន**អក្សរលាយលេខ** និងយ៉ាងតិច **៦ ខ្ទង់**");
        }

        const projName = sessionState.projectName;
        
        const allAccounts = await Account.find({});
        const nextProjectId = allAccounts.length > 0 ? String(Math.max(...allAccounts.map(a => Number(a.id))) + 1) : "1";
        
        const newAccount = new Account({
            id: nextProjectId,
            creatorId: String(telegramId),
            projectName: projName,
            password: text,
            workers: [],
            attendance: {},
            borrows: {}
        });
        await newAccount.save();

        await Session.findOneAndUpdate(
            { chatId: String(chatId) },
            { projectId: nextProjectId },
            { upsert: true, new: true }
        );
        delete userSessions[chatId];

        const successText = `🎉 <b>បង្កើតប្រូជេកបានជោគជ័យ!</b>\n\n` +
                            `🏗 ឈ្មោះប្រូជេក៖ <b>${projName}</b>\n` +
                            `🔑 Project ID៖ <tg-spoiler><code>${nextProjectId}</code></tg-spoiler> <i>(ចាំលេខកូដនេះសម្រាប់ Login)</i>\n` +
                            `🔐 ពាក្យសម្ងាត់៖ <tg-spoiler><code>${text}</code></tg-spoiler>\n\n` +
                            `ℹ️ <i>អ្នកអាចចុចលើផ្ទាំងព្រាលៗដើម្បីមើល រួចចុចលើលេខកូដដើម្បី Copy។ វាយបញ្ជា /myprojects ដើម្បីមើលបញ្ជី!</i>`;
        
        return bot.sendMessage(chatId, successText, { parse_mode: "HTML" }).then(() => sendMainMenu(chatId, projName, nextProjectId));
    }

    if (sessionState.state === "LOGIN_CREDENTIALS") {
        const match = text.match(/^(\w+)\s+(.+)$/);
        if (!match) {
            return bot.sendMessage(chatId, "❌ ទម្រង់វាយខុសហើយ! សូមវាយតាមទម្រង់៖ `ProjectID ពាក្យសម្ងាត់` (ឧទាហរណ៍៖ `1 boss123`)");
        }
        
        const inputProjectId = match[1].trim();
        const inputPassword = match[2].trim();

        const account = await Account.findOne({ id: inputProjectId, password: inputPassword });
        if (account) {
            await Session.findOneAndUpdate(
                { chatId: String(chatId) },
                { projectId: inputProjectId },
                { upsert: true, new: true }
            );
            delete userSessions[chatId];

            return bot.sendMessage(chatId, `✅ **ចូលប្រើប្រាស់ជោគជ័យ!**\n\nបានបើកប្រូជេក "**${account.projectName}**" មកប្រើប្រាស់។`, { parse_mode: "Markdown" }).then(() => sendMainMenu(chatId, account.projectName, account.id));
        } else {
            return bot.sendMessage(chatId, "❌ **Project ID ឬពាក្យសម្ងាត់មិនត្រឹមត្រូវឡើយ!** សូមពិនិត្យរួចវាយបញ្ចូលម្តងទៀត៖");
        }
    }

    const userSession = await Session.findOne({ chatId: String(chatId) });
    if (!userSession) return sendAuthRequired(chatId, telegramId);

    const account = await Account.findOne({ id: userSession.projectId });
    if (!account) return sendAuthRequired(chatId, telegramId);

    if (sessionState.state === "AWAITING_WORKER_DETAILS") {
        const lines = text.split('\n'); 
        let addedWorkers = [];
        let errors = [];
        
        let currentMaxId = account.workers.length > 0 ? Math.max(...account.workers.map(w => w.id)) : 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue; 

            const match = line.match(/^(.+)\s+(\d+)$/);
            if (!match) {
                errors.push(`បន្ទាត់ទី ${i + 1} ("${line}") ខុសទម្រង់។`);
                continue;
            }

            const name = match[1].trim();
            const salary = Number(match[2]);
            
            if (salary <= 0) {
                errors.push(`បន្ទាត់ទី ${i + 1} ("${line}") ចំនួនទឹកប្រាក់មិនត្រឹមត្រូវ។`);
                continue;
            }

            currentMaxId++; 
            const newWorker = { id: currentMaxId, name, dailySalary: salary };
            account.workers.push(newWorker);
            addedWorkers.push(newWorker);
        }

        if (addedWorkers.length === 0) {
             return bot.sendMessage(chatId, "❌ មិនមានទិន្នន័យត្រឹមត្រូវទេ! សូមវាយម្តងទៀត (ឧទាហរណ៍៖ `សុខា 80000`)", { parse_mode: "Markdown" });
        }

        await account.save();
        delete userSessions[chatId];
        
        let replyMsg = `✅ **បានបន្ថែមកម្មករថ្មីចំនួន ${addedWorkers.length} នាក់ជោគជ័យ៖**\n\n`;
        addedWorkers.forEach(w => {
            replyMsg += `• 👤 **${w.name}** | 💰 **${w.dailySalary.toLocaleString()}៛**\n`;
        });

        if (errors.length > 0) {
            replyMsg += `\n⚠️ **បញ្ហាមួយចំនួន (មិនបានបន្ថែម)៖**\n${errors.join('\n')}`;
        }

        return bot.sendMessage(chatId, replyMsg, { parse_mode: "Markdown", reply_markup: { inline_keyboard: MAIN_INLINE_KEYBOARD } });
    }

    if (sessionState.state === "AWAITING_BORROW_AMOUNT") {
        const amount = Number(text);
        if (isNaN(amount) || amount <= 0) return bot.sendMessage(chatId, "❌ សូមវាយបញ្ចូលតែចំនួនលេខទឹកប្រាក់ប៉ុណ្ណោះ! (ឧទាហរណ៍៖ 10000)");

        const workerId = sessionState.workerId;
        const worker = account.workers.find(w => w.id === workerId);

        if (!account.borrows) account.borrows = {};
        if (!account.borrows[workerId]) account.borrows[workerId] = 0;
        account.borrows[workerId] += amount;
        account.markModified("borrows");
        await account.save();
        delete userSessions[chatId];

        return bot.sendMessage(chatId, `💸 កត់ត្រាលុយបើកមុនរួចរាល់៖\n\n👤 កម្មករ៖ **${worker.name}**\n💵 ចំនួនទឹកប្រាក់៖ **${amount.toLocaleString()}៛**`, { parse_mode: "Markdown", reply_markup: { inline_keyboard: MAIN_INLINE_KEYBOARD } });
    }
});

/*
========================================
CRON SCHEDULES
========================================
*/
cron.schedule("0 0 * * 0", async () => {
    try {
        await Account.updateMany({}, { $set: { attendance: {}, borrows: {} } });
        console.log("All projects reset successfully for the new week.");
    } catch (err) { console.error("Cron job error:", err); }
}, { timezone: "Asia/Phnom_Penh" });

bot.on("polling_error", err => console.error("Polling error:", err.message));
process.on("uncaughtException", err => console.error("Uncaught Exception:", err));
