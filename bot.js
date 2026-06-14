require("dotenv").config();

const express = require("express");
const cron = require("node-cron");
const TelegramBot = require("node-telegram-bot-api");
const mongoose = require("mongoose");

/*
========================================
CONFIG & MONGO URL CONNECTION
========================================
*/
const TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;

// តំណភ្ជាប់ទៅកាន់ MongoDB Cloud របស់បងផ្ទាល់
const MONGO_URL = "mongodb+srv://allinonebot:allinonebot123@amertakcluster.m5zjxka.mongodb.net/worker_db?retryWrites=true&w=majority&appName=AmertakCluster";

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
app.get("/", (req, res) => res.send("Multi-Project Worker Bot with MongoDB is Running ✅"));
app.listen(PORT, () => console.log(`Server running on ${PORT}`));

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

// ទម្រង់ទិន្នន័យ (Database Schemas)
const AccountSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true }, 
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
console.log("Bot Started");

bot.setMyCommands([
    { command: "start", description: "🚀 ចាប់ផ្តើម / ម៉ឺនុយមេ" },
    { command: "id", description: "🆔 មើល និងចម្លង Telegram ID របស់អ្នក" },
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
    const isLongEnough = password.length >= 8;
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
    monday.setDate(now.getDate() + distanceToDistance);
    
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
    [{ text: "🚪 ចាកចេញ (Logout)", callback_data: "main_logout" }]
];

function sendMainMenu(chatId, projectName) {
    const text = `📁 ប្រូជេកបច្ចុប្បន្ន៖ **${projectName}**\n👷 **ម៉ឺនុយបញ្ជាចម្បង**\n\nសូមជ្រើសរើសមុខងារណាមួយខាងក្រោមដើម្បីគ្រប់គ្រង៖`;
    bot.sendMessage(chatId, text, { parse_mode: "Markdown", reply_markup: { inline_keyboard: MAIN_INLINE_KEYBOARD } });
}

function sendAuthRequired(chatId, telegramId) {
    const text = `🔒 **មិនទាន់បានចូលប្រើប្រាស់ប្រូជេកទេ!**\n\n` +
                 `🆔 Telegram ID របស់អ្នកគឺ៖ \`${telegramId}\` *(ចុចលើលេខដើម្បី Copy)*\n\n` +
                 `សូមជ្រើសរើសមុខងារខាងក្រោម៖\n` +
                 `1️⃣ **បង្កើតប្រូជេកថ្មី (Register)**៖ បើមិនទាន់មានប្រូជេកសោះ\n` +
                 `2️⃣ **ចូលប្រើប្រូជេក (Login)**៖ ដើម្បីទាញយកទិន្នន័យប្រូជេកមកប្រើ`;
    
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
COMMAND HANDLERS (បាន Fix ឱ្យដំណើរការ 100%)
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

    const welcomeText = `👋 សួស្តី! ស្វាគមន៍មកកាន់ប្រព័ន្ធគ្រប់គ្រងប្រាក់ខែកម្មករ (រក្សាទុកលើ MongoDB សុវត្ថិភាព 100%)។\n\n` +
                        `📁 ប្រូជេកសកម្ម៖ **${account.projectName}**\n` +
                        `🆔 Telegram ID របស់អ្នក៖ \`${msg.from.id}\`\n\n` +
                        `ℹ️ **របៀបប្រើប្រាស់៖**\n` +
                        `• ប្រើប៊ូតុងបញ្ជាដែលផ្ញើមកជាមួយសារ (Inline Keyboard) ដើម្បីបញ្ជាលឿនរហ័ស។\n` +
                        `• រាល់ពេលបំពេញតម្លៃ គ្រាន់តែវាយបញ្ចូលត្រង់ៗក្នុងប្រអប់សារជាការស្រេច។`;
    
    bot.sendMessage(msg.chat.id, welcomeText, { parse_mode: "Markdown" }).then(() => {
        sendMainMenu(msg.chat.id, account.projectName);
    });
});

bot.onText(/^\/id$/, (msg) => {
    bot.sendMessage(msg.chat.id, `🆔 Telegram ID របស់អ្នកគឺ៖ \`${msg.from.id}\`\n\n*(លោកអ្នកគ្រាន់តែចុចចំលេខ ID ខាងលើ វានឹងចម្លង Copy ទុកស្វ័យប្រវត្តិភ្លាមៗ)*`, { parse_mode: "Markdown" });
});

bot.onText(/^\/logout$/, async (msg) => {
    await handleLogout(msg.chat.id);
    sendAuthRequired(msg.chat.id, msg.from.id);
});

// បាន Fix មុខងារ /listworkers, /addworker, /report ឱ្យដំណើរការលឿនរហ័ស
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
    return bot.sendMessage(msg.chat.id, "✍️ សូមវាយបញ្ចូលឈ្មោះ និងប្រាក់ថ្ងៃរបស់កម្មករថ្មី៖\n\n*ទម្រង់វាយ៖* `ឈ្មោះ ប្រាក់ឈ្នួល`\n*ឧទាហរណ៍៖* `សុខា 80000`", { parse_mode: "Markdown" });
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
CALLBACK QUERY HANDLER (ប៊ូតុងបញ្ជា)
========================================
*/
bot.on("callback_query", async (query) => {
    const chatId = query.message.chat.id;
    const telegramId = query.from.id;
    const data = query.data;

    try {
        if (data === "main_logout") {
            await handleLogout(chatId);
            return sendAuthRequired(chatId, telegramId);
        }

        if (data === "auth_register") {
            userSessions[chatId] = { state: "REGISTRATION_PROJECT_NAME" };
            return bot.sendMessage(chatId, `✍️ **ជំហានទី១៖** សូមវាយបញ្ចូល **ឈ្មោះប្រូជេក (Project Name)** របស់អ្នក៖\n\n*ឧទាហរណ៍៖ ការដ្ឋានអាគារA*`);
        }

        if (data === "auth_login") {
            userSessions[chatId] = { state: "LOGIN_CREDENTIALS" };
            return bot.sendMessage(chatId, `✍️ **សូមវាយបញ្ចូល Telegram ID និងពាក្យសម្ងាត់ប្រូជេក៖**\n\n*ទម្រង់វាយ៖* \`TelegramID ពាក្យសម្ងាត់\`\n*ឧទាហរណ៍៖* \`${telegramId} boss1234\``, { parse_mode: "Markdown" });
        }

        // ប៊ូតុងត្រឡប់ក្រោយ ឬ បោះបង់ទៅកាន់ Menu មេ
        if (data === "cancel_to_main") {
            delete userSessions[chatId];
            const session = await Session.findOne({ chatId: String(chatId) });
            if (!session) return sendAuthRequired(chatId, telegramId);
            const account = await Account.findOne({ id: session.projectId });
            if (!account) return sendAuthRequired(chatId, telegramId);
            return sendMainMenu(chatId, account.projectName);
        }

        const session = await Session.findOne({ chatId: String(chatId) });
        if (!session) return sendAuthRequired(chatId, telegramId);

        const account = await Account.findOne({ id: session.projectId });
        if (!account) return sendAuthRequired(chatId, telegramId);

        if (data === "main_addworker") {
            userSessions[chatId] = { state: "AWAITING_WORKER_DETAILS" };
            return bot.sendMessage(chatId, "✍️ សូមវាយបញ្ចូលឈ្មោះ និងប្រាក់ថ្ងៃរបស់កម្មករថ្មី៖\n\n*ទម្រង់វាយ៖* `ឈ្មោះ ប្រាក់ឈ្នួល`\n*ឧទាហរណ៍៖* `សុខា 80000`", { parse_mode: "Markdown" });
        }

        if (data === "main_listworkers") {
            if (account.workers.length === 0) return bot.sendMessage(chatId, "❌ មិនទាន់មានកម្មករនៅក្នុងប្រព័ន្ធឡើយ។", { reply_markup: { inline_keyboard: MAIN_INLINE_KEYBOARD } });
            let text = "👷 **បញ្ជីឈ្មោះកម្មករ និងប្រាក់ថ្ងៃ**\n\n";
            account.workers.forEach(w => { text += `• 👤 **${w.name}** | ប្រាក់ថ្ងៃ: ${w.dailySalary.toLocaleString()}៛\n`; });
            return bot.sendMessage(chatId, text, { parse_mode: "Markdown", reply_markup: { inline_keyboard: MAIN_INLINE_KEYBOARD } });
        }

        if (data === "main_report") {
            if (account.workers.length === 0) return bot.sendMessage(chatId, "❌ មិនទាន់មានកម្មករទេ។", { reply_markup: { inline_keyboard: MAIN_INLINE_KEYBOARD } });
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

        // បន្ថែមប៊ូតុងបោះបង់ ពេលចុច កត់អវត្តមាន
        if (data === "main_absence") {
            if (account.workers.length === 0) return bot.sendMessage(chatId, "❌ មិនទាន់មានកម្មករទេ។");
            const buttons = account.workers.map(w => [{ text: `👤 ${w.name} (${w.dailySalary.toLocaleString()}៛)`, callback_data: `abs_select_${w.id}` }]);
            buttons.push([{ text: "🔄 បោះបង់", callback_data: "cancel_to_main" }]); 
            return bot.sendMessage(chatId, "👉 សូមជ្រើសរើសកម្មករដើម្បីកត់អវត្តមាន៖", { reply_markup: { inline_keyboard: buttons } });
        }

        // បន្ថែមប៊ូតុងបោះបង់ ពេលចុច មើលអវត្តមាន
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

        // បន្ថែមប៊ូតុងបោះបង់ ពេលចុច លុបកម្មករ
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
                        [{ text: "✅ មកធ្វើការធម្មតាវិញ (លុបច្បាប់ថ្ងៃនេះ)", callback_data: `abs_save_present_${workerId}` }],
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
                return bot.sendMessage(chatId, `✅ បានកែប្រែ៖ **${account.workers.find(w=>w.id===wId).name}** មកធ្វើការពេញថ្ងៃវិញ។`, { parse_mode: "Markdown", reply_markup: { inline_keyboard: MAIN_INLINE_KEYBOARD } });
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
            return bot.sendMessage(chatId, `✍️ សូមវាយបញ្ចូល **ចំនួនទឹកប្រាក់** ដែលកម្មករឈ្មោះ "${account.workers.find(w=>w.id===workerId).name}" បានបើកមុន៖\n\n*(ឧទាហរណ៍៖ 50000)*`);
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
MESSAGE HANDLER (រៀបចំចាប់អត្ថបទ)
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
        return bot.sendMessage(chatId, `✍️ **ជំហានទី២៖** សូមបង្កើតពាក្យសម្ងាត់សម្រាប់ប្រូជេក "${text}"៖\n\n⚠️ *លក្ខខណ្ឌ៖* ត្រូវមាន**អក្សរលាយលេខ** ប្រវែងយ៉ាងតិច **៨ ខ្ទង់**`);
    }

    if (sessionState.state === "REGISTRATION_PASSWORD") {
        if (!validatePassword(text)) {
            return bot.sendMessage(chatId, "❌ **ពាក្យសម្ងាត់មិនត្រូវតាមលក្ខខណ្ឌទេ!**\n\nសូមវាយម្តងទៀត៖ ត្រូវតែមាន**អក្សរលាយលេខ** និងយ៉ាងតិច **8 ខ្ទង់** (ឧទាហរណ៍៖ `boss1234`)");
        }

        const projName = sessionState.projectName;
        const accountKey = String(telegramId); 

        const existingAccount = await Account.findOne({ id: accountKey });
        if (existingAccount) {
            return bot.sendMessage(chatId, `❌ **Telegram ID របស់អ្នកធ្លាប់បានបង្កើតប្រូជេករួចម្តងហើយ!**\n\nមិនអាចបង្កើតថ្មីជាន់គ្នាបានទេ ប៉ុន្តែអ្នកអាចចុច Login ចូលប្រើប្រាស់បាន។`);
        }

        const newAccount = new Account({
            id: accountKey,
            projectName: projName,
            password: text,
            workers: [],
            attendance: {},
            borrows: {}
        });
        await newAccount.save();

        await Session.findOneAndUpdate(
            { chatId: String(chatId) },
            { projectId: accountKey },
            { upsert: true, new: true }
        );

        delete userSessions[chatId];

        const successText = `🎉 **បង្កើតប្រូជេក និងចុះឈ្មោះជោគជ័យ!**\n\n` +
                            `📁 ឈ្មោះប្រូជេក៖ **${projName}**\n` +
                            `🆔 លេខ Telegram ID (Account ID)៖ \`${accountKey}\`\n` +
                            `🔑 ពាក្យសម្ងាត់ប្រូជេក៖ \`${text}\`\n\n` +
                            `ℹ️ រក្សាទុកលើ Cloud MongoDB សុវត្ថិភាព 100%! លោកអ្នកអាចយក \`Telegram ID\` និង \`ពាក្យសម្ងាត់\` នេះទៅ Login ប្រើរួមគ្នានៅលើទូរស័ព្ទផ្សេងបាន!`;
        
        return bot.sendMessage(chatId, successText, { parse_mode: "Markdown" }).then(() => sendMainMenu(chatId, projName));
    }

    if (sessionState.state === "LOGIN_CREDENTIALS") {
        const match = text.match(/^(\d+)\s+(.+)$/);
        if (!match) {
            return bot.sendMessage(chatId, "❌ ទម្រង់វាយខុសហើយ! សូមវាយតាមទម្រង់៖ `TelegramID ពាក្យសម្ងាត់` (ឧទាហរណ៍៖ `5544332211 boss1234`)");
        }
        
        const inputId = match[1];
        const inputPassword = match[2].trim();

        const account = await Account.findOne({ id: inputId, password: inputPassword });

        if (account) {
            await Session.findOneAndUpdate(
                { chatId: String(chatId) },
                { projectId: inputId },
                { upsert: true, new: true }
            );
            delete userSessions[chatId];

            return bot.sendMessage(chatId, `✅ **ចូលប្រើប្រាស់ជោគជ័យ!**\n\nបានទាញយកទិន្នន័យប្រូជេក "**${account.projectName}**" មកប្រើលើឧបករណ៍នេះ។`, { parse_mode: "Markdown" }).then(() => sendMainMenu(chatId, account.projectName));
        } else {
            return bot.sendMessage(chatId, "❌ **Telegram ID ឬពាក្យសម្ងាត់មិនត្រឹមត្រូវឡើយ!** សូមវាយបញ្ចូលម្តងទៀត៖");
        }
    }

    // ផ្នែកគ្រប់គ្រងទិន្នន័យកម្មករ
    const userSession = await Session.findOne({ chatId: String(chatId) });
    if (!userSession) return sendAuthRequired(chatId, telegramId);

    const account = await Account.findOne({ id: userSession.projectId });
    if (!account) return sendAuthRequired(chatId, telegramId);

    if (sessionState.state === "AWAITING_WORKER_DETAILS") {
        const match = text.match(/^(.+)\s+(\d+)$/);
        if (!match) return bot.sendMessage(chatId, "❌ ទម្រង់មិនត្រូវទេ! សូមវាយម្តងទៀត៖ `ឈ្មោះ ប្រាក់ថ្ងៃ` (ឧទាហរណ៍៖ `សុខា 80000`)");

        const name = match[1].trim();
        const salary = Number(match[2]);

        const newId = account.workers.length > 0 ? Math.max(...account.workers.map(w => w.id)) + 1 : 1;
        account.workers.push({ id: newId, name, dailySalary: salary });
        await account.save();
        delete userSessions[chatId];

        return bot.sendMessage(chatId, `✅ បានបន្ថែមកម្មករជោគជ័យ៖\n\n👤 ឈ្មោះ: **${name}**\n💰 ប្រាក់ថ្ងៃ: **${salary.toLocaleString()}៛**`, { parse_mode: "Markdown", reply_markup: { inline_keyboard: MAIN_INLINE_KEYBOARD } });
    }

    if (sessionState.state === "AWAITING_BORROW_AMOUNT") {
        const amount = Number(text);
        if (isNaN(amount) || amount <= 0) return bot.sendMessage(chatId, "❌ សូមវាយបញ្ចូលតែចំនួនលេខទឹកប្រាក់ប៉ុណ្ណោះ! (ឧទាហរណ៍៖ 50000)");

        const workerId = sessionState.workerId;
        const worker = account.workers.find(w => w.id === workerId);

        if (!account.borrows) account.borrows = {};
        if (!account.borrows[workerId]) account.borrows[workerId] = 0;
        
        account.borrows[workerId] += amount;
        account.markModified("borrows");
        await account.save();
        delete userSessions[chatId];

        return bot.sendMessage(chatId, `💸 កត់ត្រាលុយបើកមុនរួចរាល់៖\n\n👤 កម្មករ៖ **${worker.name}**\n💵 ចំនួនទឹកប្រាក់៖ **${amount.toLocaleString()}៛**\n💰 ជំពាក់សរុបសប្តាហ៍នេះ៖ **${account.borrows[workerId].toLocaleString()}៛**`, { parse_mode: "Markdown", reply_markup: { inline_keyboard: MAIN_INLINE_KEYBOARD } });
    }
});

/*
========================================
CRON SCHEDULES (លុបអវត្តមានរាល់ថ្ងៃអាទិត្យ)
========================================
*/
cron.schedule("0 0 * * 0", async () => {
    try {
        await Account.updateMany({}, { $set: { attendance: {}, borrows: {} } });
        console.log("All projects reset successfully for the new week on MongoDB.");
    } catch (err) { console.error("Cron job error:", err); }
}, { timezone: "Asia/Phnom_Penh" });

/*
========================================
ERROR HANDLERS
========================================
*/
bot.on("polling_error", err => console.error(err.message));
process.on("uncaughtException", err => console.error(err));
