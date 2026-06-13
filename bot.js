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
const PORT = process.env.PORT || 3000;

if (!TOKEN) {
    console.error("BOT_TOKEN missing");
    process.exit(1);
}

/*
========================================
EXPRESS SERVER
========================================
*/
const app = express();
app.get("/", (req, res) => res.send("Multi-User Worker Bot Running ✅"));
app.listen(PORT, () => console.log(`Server running on ${PORT}`));

/*
========================================
TELEGRAM BOT
========================================
*/
const bot = new TelegramBot(TOKEN, { polling: true });
console.log("Bot Started");

// កំណត់ Menu Command ផ្លូវការនៅចំហៀងប្រអប់សារ
bot.setMyCommands([
    { command: "start", description: "🚀 ចាប់ផ្តើម / ម៉ឺនុយមេ" },
    { command: "id", description: "🆔 មើលលេខសម្គាល់គណនី (Account ID) របស់អ្នក" },
    { command: "addworker", description: "➕ បន្ថែមកម្មករថ្មី" },
    { command: "listworkers", description: "👷 មើលបញ្ជីឈ្មោះកម្មករ" },
    { command: "report", description: "💰 មើលរបាយការណ៍ប្រាក់ខែ" }
]);

/*
========================================
DATABASE FILES (ទិន្នន័យរួម)
========================================
*/
const USERS_FILE = path.join(__dirname, "users.json"); // ផ្ទុកគណនី ID, Password, និង Telegram Mapping

if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify({ nextAccountId: 1001, accounts: {}, telegram_to_account: {} }, null, 2));
}

function readUsersData() {
    try { return JSON.parse(fs.readFileSync(USERS_FILE, "utf8")); } catch { return { nextAccountId: 1001, accounts: {}, telegram_to_account: {} }; }
}

function saveUsersData(data) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
}

/*
========================================
SESSION MANAGEMENT (ស្ថានភាពបញ្ជា)
========================================
*/
const userSessions = {};

/*
========================================
HELPERS
========================================
*/
// ពិនិត្យរកគណនីដែលបានភ្ជាប់ជាមួយ Telegram ID នេះ
function getActiveAccountId(telegramId) {
    const db = readUsersData();
    return db.telegram_to_account[telegramId] || null;
}

// ពិនិត្យលក្ខខណ្ឌពាក្យសម្ងាត់ (អក្សរ + លេខ យ៉ាងតិច ៨ខ្ទង់)
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
MAIN INLINE KEYBOARD (ម៉ឺនុយប៊ូតុងជាប់សារ)
========================================
*/
const MAIN_INLINE_KEYBOARD = [
    [{ text: "📝 កត់អវត្តមាន", callback_data: "main_absence" }, { text: "📋 មើលអវត្តមាន", callback_data: "main_view_absence" }],
    [{ text: "💸 បើកលុយមុន", callback_data: "main_borrow" }, { text: "👷 បញ្ជីកម្មករ", callback_data: "main_listworkers" }],
    [{ text: "✍️ បន្ថែមកម្មករ", callback_data: "main_addworker" }, { text: "🗑 លុបកម្មករ", callback_data: "main_deleteworker" }],
    [{ text: "💰 មើលរបាយការណ៍ប្រាក់ខែ", callback_data: "main_report" }]
];

function sendMainMenu(chatId) {
    const text = `👷 **ម៉ឺនុយបញ្ជាចម្បង**\n\nសូមជ្រើសរើសមុខងារណាមួយខាងក្រោមដើម្បីគ្រប់គ្រងទិន្នន័យកម្មកររបស់អ្នក៖`;
    bot.sendMessage(chatId, text, { parse_mode: "Markdown", reply_markup: { inline_keyboard: MAIN_INLINE_KEYBOARD } });
}

function sendAuthRequired(chatId) {
    const text = `🔒 **មិនទាន់បានចូលប្រើប្រាស់ទេ!**\n\nដើម្បីរក្សាទិន្នន័យកម្មកររបស់អ្នក និងអាចប្រើលើទូរស័ព្ទផ្សេងបាន សូមជ្រើសរើស៖\n\n` +
                 `1️⃣ **ចុះឈ្មោះថ្មី (Register)**៖ ប្រសិនបើអ្នកមិនទាន់មានគណនីសោះ\n` +
                 `2️⃣ **ចូលប្រើ (Login)**៖ ប្រសិនបើអ្នកមានគណនីរួចហើយពីទូរស័ព្ទផ្សេង`;
    
    bot.sendMessage(chatId, text, {
        parse_mode: "Markdown",
        reply_markup: {
            inline_keyboard: [
                [{ text: "🔐 ចុះឈ្មោះថ្មី (Register)", callback_data: "auth_register" }],
                [{ text: "🔑 ចូលប្រើប្រាស់ (Login)", callback_data: "auth_login" }]
            ]
        }
    });
}

/*
========================================
COMMAND HANDLERS (/START & /ID)
========================================
*/
bot.onText(/^\/start$/, (msg) => {
    delete userSessions[msg.chat.id];
    const accId = getActiveAccountId(msg.from.id);

    if (!accId) {
        return sendAuthRequired(msg.chat.id);
    }

    const welcomeText = `👋 សួស្តី! ស្វាគមន៍មកកាន់ប្រព័ន្ធគ្រប់គ្រងប្រាក់ខែកម្មករ។\n\n` +
                        `ℹ️ **របៀបប្រើប្រាស់៖**\n` +
                        `• ប្រើប្រាស់ប៊ូតុងបញ្ជាដែលផ្ញើមកជាមួយសារ (Inline Keyboard) ដើម្បីបញ្ជាភ្លាមៗ។\n` +
                        `• រាល់ពេលបំពេញតម្លៃ (ដូចជាឈ្មោះ លុយ ឬចំនួនទឹកប្រាក់) គឺគ្រាន់តែវាយបញ្ចូលត្រង់ៗក្នុងប្រអប់សារជាការស្រេច (មិនបាច់ប្រើសញ្ញា / ឡើយ)។\n\n` +
                        `🆔 គណនីបច្ចុប្បន្នរបស់អ្នកគឺ៖ \`${accId}\` (ប្រើពាក្យបញ្ជា /id ដើម្បីមើលឡើងវិញ)`;
    
    bot.sendMessage(msg.chat.id, welcomeText, { parse_mode: "Markdown" }).then(() => {
        sendMainMenu(msg.chat.id);
    });
});

bot.onText(/^\/id$/, (msg) => {
    const accId = getActiveAccountId(msg.from.id);
    if (!accId) return sendAuthRequired(msg.chat.id);
    
    bot.sendMessage(msg.chat.id, `🆔 **លេខសម្គាល់គណនីរបស់អ្នក (Account ID)៖** \`${accId}\`\n\n⚠️ *សម្គាល់៖* លេខ ID នេះរួមជាមួយពាក្យសម្ងាត់របស់អ្នក គឺប្រើសម្រាប់យកទៅ Login ប្រើប្រាស់នៅលើទូរស័ព្ទផ្សេងទៀតបាន។`, { parse_mode: "Markdown" });
});

// រារាំងពាក្យបញ្ជាផ្សេងៗបើមិនទាន់ Login
bot.onText(/^\/(addworker|listworkers|report)$/, (msg) => {
    if (!getActiveAccountId(msg.from.id)) return sendAuthRequired(msg.chat.id);
});

/*
========================================
CALLBACK QUERY HANDLER (ប៊ូតុង Inline)
========================================
*/
bot.on("callback_query", async (query) => {
    const chatId = query.message.chat.id;
    const telegramId = query.from.id;
    const data = query.data;

    try {
        // ប្រព័ន្ធមិនទាន់មានគណនី (Authentication)
        if (data === "auth_register") {
            const db = readUsersData();
            // ពិនិត្យថាតើ Telegram នេះធ្លាប់បង្កើតអាខោនពីមុនហើយឬនៅ
            const alreadyHasAccount = Object.values(db.accounts).find(acc => acc.originalTelegramId === telegramId);
            if (alreadyHasAccount) {
                return bot.sendMessage(chatId, `❌ **គណនីមួយនេះបានបង្កើតពាក្យសម្ងាត់រួចរាល់ម្តងហើយ!**\n\nគណនីរបស់អ្នកគឺ ID: \`${alreadyHasAccount.id}\`។ មិនអាចបង្កើតថ្មីបានទៀតទេ ទោះបីជាអ្នកចុចលុបចោលក៏ដោយ។ សូមប្រើប្រាស់មុខងារ Login ជំនួសវិញ។`, { parse_mode: "Markdown" });
            }

            userSessions[chatId] = { state: "REGISTRATION_PASSWORD" };
            return bot.sendMessage(chatId, "✍️ **សូមបង្កើតពាក្យសម្ងាត់ (Password) របស់អ្នក៖**\n\n⚠️ *លក្ខខណ្ឌ៖* ត្រូវតែមាន**អក្សរលាយជាមួយលេខ** និងមានប្រវែងយ៉ាងតិច **៨ ខ្ទង់** (ឧទាហរណ៍៖ `manager2026`)");
        }

        if (data === "auth_login") {
            userSessions[chatId] = { state: "LOGIN_CREDENTIALS" };
            return bot.sendMessage(chatId, "✍️ **សូមវាយបញ្ចូល ID គណនី និងពាក្យសម្ងាត់របស់អ្នក៖**\n\n*ទម្រង់វាយ៖* `ID ពាក្យសម្ងាត់`\n*ឧទាហរណ៍៖* `1001 manager2026`");
        }

        // ចាប់ពីជំហាននេះទៅ ត្រូវតែមានគណនីទើបដើរ
        const accId = getActiveAccountId(telegramId);
        if (!accId) return sendAuthRequired(chatId);

        const db = readUsersData();
        const account = db.accounts[accId];

        // ១. បន្ថែមកម្មករ
        if (data === "main_addworker") {
            userSessions[chatId] = { state: "AWAITING_WORKER_DETAILS" };
            return bot.sendMessage(chatId, "✍️ សូមវាយបញ្ចូលឈ្មោះ និងប្រាក់ថ្ងៃរបស់កម្មករថ្មី៖\n\n*ទម្រង់វាយ៖* `ឈ្មោះ ប្រាក់ឈ្នួល`\n*ឧទាហរណ៍៖* `សុខា 80000`", { parse_mode: "Markdown" });
        }

        // ២. មើលបញ្ជីកម្មករ
        if (data === "main_listworkers") {
            if (account.workers.length === 0) return bot.sendMessage(chatId, "❌ មិនទាន់មានកម្មករនៅក្នុងប្រព័ន្ធឡើយ។", { reply_markup: { inline_keyboard: MAIN_INLINE_KEYBOARD } });
            let text = "👷 **បញ្ជីឈ្មោះកម្មករ និងប្រាក់ថ្ងៃ**\n\n";
            account.workers.forEach(w => { text += `• 👤 **${w.name}** | ប្រាក់ថ្ងៃ: ${w.dailySalary.toLocaleString()}៛\n`; });
            return bot.sendMessage(chatId, text, { parse_mode: "Markdown", reply_markup: { inline_keyboard: MAIN_INLINE_KEYBOARD } });
        }

        // ៣. មើលរបាយការណ៍ប្រាក់ខែ
        if (data === "main_report") {
            if (account.workers.length === 0) return bot.sendMessage(chatId, "❌ មិនទាន់មានកម្មករទេ។", { reply_markup: { inline_keyboard: MAIN_INLINE_KEYBOARD } });
            let text = "💰 **បញ្ជីបើកប្រាក់ប្រចាំសប្តាហ៍**\n\n";
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

        // ៤. ចុចកត់អវត្តមាន -> បង្ហាញបញ្ជីឈ្មោះកម្មករជាប៊ូតុង
        if (data === "main_absence") {
            if (account.workers.length === 0) return bot.sendMessage(chatId, "❌ មិនទាន់មានកម្មករទេ។");
            const buttons = account.workers.map(w => [{ text: `👤 ${w.name} (${w.dailySalary.toLocaleString()}៛)`, callback_data: `abs_select_${w.id}` }]);
            return bot.sendMessage(chatId, "👉 សូមជ្រើសរើសកម្មករដើម្បីកត់អវត្តមាន៖", { reply_markup: { inline_keyboard: buttons } });
        }

        // ៥. ចុចមើលអវត្តមាន -> បង្ហាញបញ្ជីឈ្មោះកម្មករជាប៊ូតុង
        if (data === "main_view_absence") {
            if (account.workers.length === 0) return bot.sendMessage(chatId, "❌ មិនទាន់មានកម្មករទេ។");
            const buttons = account.workers.map(w => [{ text: `📋 ${w.name}`, callback_data: `history_${w.id}` }]);
            return bot.sendMessage(chatId, "👉 សូមជ្រើសរើសកម្មករដើម្បីមើលប្រវត្តិច្បាប់៖", { reply_markup: { inline_keyboard: buttons } });
        }

        // ៦. ចុចដកប្រាក់/បើកលុយមុន -> បង្ហាញបញ្ជីឈ្មោះកម្មករជាប៊ូតុង
        if (data === "main_borrow") {
            if (account.workers.length === 0) return bot.sendMessage(chatId, "❌ មិនទាន់មានកម្មករទេ។");
            const buttons = account.workers.map(w => [{ text: `💸 ${w.name}`, callback_data: `borrow_select_${w.id}` }]);
            return bot.sendMessage(chatId, "👉 សូមជ្រើសរើសកម្មករដែលចង់កត់ត្រាបើកលុយមុន៖", { reply_markup: { inline_keyboard: buttons } });
        }

        // ៧. ចុចលុបកម្មករ -> បង្ហាញបញ្ជីឈ្មោះកម្មករជាប៊ូតុង
        if (data === "main_deleteworker") {
            if (account.workers.length === 0) return bot.sendMessage(chatId, "❌ មិនទាន់មានកម្មករទេ។");
            const buttons = account.workers.map(w => [{ text: `🗑 លុប៖ ${w.name}`, callback_data: `del_select_${w.id}` }]);
            return bot.sendMessage(chatId, "👉 សូមជ្រើសរើសកម្មករដែលអ្នកចង់លុបឈ្មោះ៖", { reply_markup: { inline_keyboard: buttons } });
        }

        // ----------------------------------------------------
        // ផ្នែកដំណើរការរង (Sub-actions របស់កម្មករម្នាក់ៗ)
        // ----------------------------------------------------
        if (data.startsWith("abs_select_")) {
            const workerId = Number(data.replace("abs_select_", ""));
            const worker = account.workers.find(w => w.id === workerId);
            const half = worker.dailySalary / 2;

            return bot.sendMessage(chatId, `👤 កម្មករ: **${worker.name}**\n👉 សូមជ្រើសរើសប្រភេទអវត្តមានសម្រាប់ថ្ងៃនេះ៖`, {
                parse_mode: "Markdown",
                reply_markup: {
                    inline_keyboard: [
                        [{ text: `🌅 ឈប់ព្រឹក (កាត់ -${half.toLocaleString()}៛)`, callback_data: `abs_save_morning_${workerId}` }],
                        [{ text: `🌙 ឈប់ល្ងាច (កាត់ -${half.toLocaleString()}៛)`, callback_data: `abs_save_evening_${workerId}` }],
                        [{ text: `❌ ឈប់មួយថ្ងៃពេញ (កាត់ -${worker.dailySalary.toLocaleString()}៛)`, callback_data: `abs_save_full_${workerId}` }],
                        [{ text: "✅ មកធ្វើការធម្មតាវិញ (លុបច្បាប់ថ្ងៃនេះ)", callback_data: `abs_save_present_${workerId}` }]
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
                saveUsersData(db);
                return bot.sendMessage(chatId, `✅ បានកែប្រែ៖ **${account.workers.find(w=>w.id===wId).name}** មកធ្វើការពេញថ្ងៃធម្មតាវិញ។`, { parse_mode: "Markdown", reply_markup: { inline_keyboard: MAIN_INLINE_KEYBOARD } });
            }

            let type = ""; let wId = 0;
            if (rem.startsWith("morning_")) { type = "morning"; wId = Number(rem.replace("morning_", "")); }
            if (rem.startsWith("evening_")) { type = "evening"; wId = Number(rem.replace("evening_", "")); }
            if (rem.startsWith("full_")) { type = "full"; wId = Number(rem.replace("full_", "")); }

            account.attendance[today][wId] = type;
            saveUsersData(db);
            return bot.sendMessage(chatId, `✅ កត់ត្រាអវត្តមានជោគជ័យសម្រាប់៖ **${account.workers.find(w=>w.id===wId).name}**`, { parse_mode: "Markdown", reply_markup: { inline_keyboard: MAIN_INLINE_KEYBOARD } });
        }

        if (data.startsWith("borrow_select_")) {
            const workerId = Number(data.replace("borrow_select_", ""));
            userSessions[chatId] = { state: "AWAITING_BORROW_AMOUNT", workerId: workerId };
            return bot.sendMessage(chatId, `✍️ សូមវាយបញ្ចូល **ចំនួនទឹកប្រាក់** ដែលកម្មករឈ្មោះ "${account.workers.find(w=>w.id===workerId).name}" បានបើកមុន៖\n\n*(វាយតែលេខលុយត្រង់ៗ ឧទាហរណ៍៖ 50000)*`);
        }

        if (data.startsWith("del_select_")) {
            const workerId = Number(data.replace("del_select_", ""));
            const worker = account.workers.find(w => w.id === workerId);
            return bot.sendMessage(chatId, `⚠️ តើអ្នកពិតជាចង់លុបកម្មករឈ្មោះ "**${worker.name}**" ចេញពីប្រព័ន្ធមែនទេ?`, {
                parse_mode: "Markdown",
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
            account.workers = account.workers.filter(w => w.id !== workerId);
            if (account.borrows[workerId]) delete account.borrows[workerId];
            saveUsersData(db);
            return bot.sendMessage(chatId, "🗑 បានលុបកម្មករចេញពីប្រព័ន្ធរួចរាល់។", { reply_markup: { inline_keyboard: MAIN_INLINE_KEYBOARD } });
        }

        if (data === "cancel_del") {
            return bot.sendMessage(chatId, "🔄 បានបោះបង់ការលុប។", { reply_markup: { inline_keyboard: MAIN_INLINE_KEYBOARD } });
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
MESSAGE HANDLER (សម្រាប់ចាប់ VALUE ត្រង់ៗ)
========================================
*/
bot.on("message", (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    const text = msg.text ? msg.text.trim() : "";

    if (text.startsWith("/")) return;

    const session = userSessions[chatId];
    if (!session) return;

    const db = readUsersData();

    // ១. ដំណើរការចុះឈ្មោះ (Register Password)
    if (session.state === "REGISTRATION_PASSWORD") {
        if (!validatePassword(text)) {
            return bot.sendMessage(chatId, "❌ **ពាក្យសម្ងាត់មិនត្រឹមត្រូវតាមលក្ខខណ្ឌទេ!**\n\nសូមវាយម្តងទៀត៖ ត្រូវតែមាន**អក្សរលាយលេខ** និងយ៉ាងតិច **8 ខ្ទង់** (ឧទាហរណ៍៖ `boss1234`)");
        }

        const newAccountId = db.nextAccountId++;
        db.accounts[newAccountId] = {
            id: newAccountId,
            password: text,
            originalTelegramId: telegramId,
            workers: [],
            attendance: {},
            borrows: {}
        };
        db.telegram_to_account[telegramId] = newAccountId; // ភ្ជាប់ជាមួយទូរស័ព្ទនេះភ្លាម
        saveUsersData(db);
        delete userSessions[chatId];

        const successText = `🎉 **ចុះឈ្មោះគណនីជោគជ័យ!**\n\n` +
                            `🆔 ID គណនីរបស់អ្នកគឺ៖ \`${newAccountId}\`\n` +
                            `🔑 ពាក្យសម្ងាត់របស់អ្នកគឺ៖ \`${text}\`\n\n` +
                            `⚠️ **សំខាន់ណាស់៖** សូមកត់ ID និងពាក្យសម្ងាត់នេះទុក! បើអ្នកចង់ទៅប្រើលើទូរស័ព្ទផ្សេង គឺត្រូវប្រើ ID និង Password នេះដើម្បី Login ទាញយកទិន្នន័យដដែលមកវិញ។`;
        
        return bot.sendMessage(chatId, successText, { parse_mode: "Markdown" }).then(() => sendMainMenu(chatId));
    }

    // ២. ដំណើរការចូលប្រើ (Login)
    if (session.state === "LOGIN_CREDENTIALS") {
        const match = text.match(/^(\d+)\s+(.+)$/);
        if (!match) {
            return bot.sendMessage(chatId, "❌ ទម្រង់វាយខុសហើយ! សូមវាយតាមទម្រង់៖ `ID ពាក្យសម្ងាត់` (ឧទាហរណ៍៖ `1001 manager2026`)");
        }
        
        const inputId = Number(match[1]);
        const inputPassword = match[2].trim();

        if (db.accounts[inputId] && db.accounts[inputId].password === inputPassword) {
            db.telegram_to_account[telegramId] = inputId; // ប្តូរការភ្ជាប់មកទូរស័ព្ទថ្មីនេះ
            saveUsersData(db);
            delete userSessions[chatId];

            return bot.sendMessage(chatId, `✅ **ចូលប្រើប្រាស់ជោគជ័យ!**\n\nប្រព័ន្ធបានទាញយកទិន្នន័យគណនី ID \`${inputId}\` មកកាន់ទូរស័ព្ទនេះហើយ។`, { parse_mode: "Markdown" }).then(() => sendMainMenu(chatId));
        } else {
            return bot.sendMessage(chatId, "❌ **ID ឬពាក្យសម្ងាត់មិនត្រឹមត្រូវឡើយ!** សូមពិនិត្យ និងវាយបញ្ចូលម្តងទៀត៖");
        }
    }

    // បើមិនទាន់ Login មិនឱ្យធ្វើអ្វីទាំងអស់
    const accId = db.telegram_to_account[telegramId];
    if (!accId) return sendAuthRequired(chatId);
    const account = db.accounts[accId];

    // ៣. វាយតម្លៃបន្ថែមកម្មករ (ឈ្មោះ ប្រាក់ថ្ងៃ)
    if (session.state === "AWAITING_WORKER_DETAILS") {
        const match = text.match(/^(.+)\s+(\d+)$/);
        if (!match) return bot.sendMessage(chatId, "❌ ទម្រង់មិនត្រូវទេ! សូមវាយម្តងទៀត៖ `ឈ្មោះ ប្រាក់ថ្ងៃ` (ឧទាហរណ៍៖ `សុខា 80000`)");

        const name = match[1].trim();
        const salary = Number(match[2]);

        const newId = account.workers.length > 0 ? Math.max(...account.workers.map(w => w.id)) + 1 : 1;
        account.workers.push({ id: newId, name, dailySalary: salary });
        saveUsersData(db);
        delete userSessions[chatId];

        return bot.sendMessage(chatId, `✅ បានបន្ថែមកម្មករជោគជ័យ៖\n\n👤 ឈ្មោះ: **${name}**\n💰 ប្រាក់ថ្ងៃ: **${salary.toLocaleString()}៛**`, { parse_mode: "Markdown", reply_markup: { inline_keyboard: MAIN_INLINE_KEYBOARD } });
    }

    // ៤. វាយលេខលុយបើកមុនត្រង់ៗ
    if (session.state === "AWAITING_BORROW_AMOUNT") {
        const amount = Number(text);
        if (isNaN(amount) || amount <= 0) return bot.sendMessage(chatId, "❌ សូមវាយបញ្ចូលតែចំនួនលេខទឹកប្រាក់ប៉ុណ្ណោះ! (ឧទាហរណ៍៖ 50000)");

        const workerId = session.workerId;
        const worker = account.workers.find(w => w.id === workerId);

        if (!account.borrows[workerId]) account.borrows[workerId] = 0;
        account.borrows[workerId] += amount;
        saveUsersData(db);
        delete userSessions[chatId];

        return bot.sendMessage(chatId, `💸 កត់ត្រាលុយបើកមុនរួចរាល់៖\n\n👤 កម្មករ៖ **${worker.name}**\n💵 ចំនួនទឹកប្រាក់៖ **${amount.toLocaleString()}៛**\n💰 ជំពាក់សរុបសប្តាហ៍នេះ៖ **${account.borrows[workerId].toLocaleString()}៛**`, { parse_mode: "Markdown", reply_markup: { inline_keyboard: MAIN_INLINE_KEYBOARD } });
    }
});

/*
========================================
CRON SCHEDULES (រៀបចំទិន្នន័យស្វ័យប្រវត្តិតាមគណនីនីមួយៗ)
========================================
*/
// Reset ទិន្នន័យអវត្តមាន និងលុយមុននៅរាល់ថ្ងៃអាទិត្យ វេលាម៉ោង 00:00 សម្រាប់គ្រប់អាខោនទាំងអស់
cron.schedule("0 0 * * 0", async () => {
    try {
        const db = readUsersData();
        Object.keys(db.accounts).forEach(id => {
            db.accounts[id].attendance = {};
            db.accounts[id].borrows = {};
        });
        saveUsersData(db);
        console.log("All accounts data reset for new week.");
    } catch (err) { console.error(err); }
}, { timezone: "Asia/Phnom_Penh" });

/*
========================================
ERROR HANDLERS
========================================
*/
bot.on("polling_error", err => console.error(err.message));
process.on("uncaughtException", err => console.error(err));
console.log("Worker Salary System Ready ✅");
