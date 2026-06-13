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
FILES
========================================
*/

const WORKERS_FILE = path.join(__dirname, "workers.json");
const ATTENDANCE_FILE = path.join(__dirname, "attendance.json");

/*
========================================
INIT FILES
========================================
*/

if (!fs.existsSync(WORKERS_FILE)) {
    fs.writeFileSync(
        WORKERS_FILE,
        JSON.stringify([], null, 2)
    );
}

if (!fs.existsSync(ATTENDANCE_FILE)) {
    fs.writeFileSync(
        ATTENDANCE_FILE,
        JSON.stringify({}, null, 2)
    );
}

/*
========================================
HELPERS
========================================
*/

function readWorkers() {
    try {
        return JSON.parse(
            fs.readFileSync(WORKERS_FILE, "utf8")
        );
    } catch {
        return [];
    }
}

function saveWorkers(data) {
    fs.writeFileSync(
        WORKERS_FILE,
        JSON.stringify(data, null, 2)
    );
}

function readAttendance() {
    try {
        return JSON.parse(
            fs.readFileSync(ATTENDANCE_FILE, "utf8")
        );
    } catch {
        return {};
    }
}

function saveAttendance(data) {
    fs.writeFileSync(
        ATTENDANCE_FILE,
        JSON.stringify(data, null, 2)
    );
}

function isOwner(msg) {
    return msg.from.id === OWNER_ID;
}

function getTodayDate() {
    const now = new Date();

    const year = now.getFullYear();

    const month = String(
        now.getMonth() + 1
    ).padStart(2, "0");

    const day = String(
        now.getDate()
    ).padStart(2, "0");

    return `${year}-${month}-${day}`;
}

function getWorkerById(workerId) {
    const workers = readWorkers();

    return workers.find(
        w => Number(w.id) === Number(workerId)
    );
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

function saveAbsence(
    workerId,
    type
) {

    const attendance =
        readAttendance();

    const today =
        getTodayDate();

    if (!attendance[today]) {
        attendance[today] = {};
    }

    attendance[today][workerId] =
        type;

    saveAttendance(
        attendance
    );
}

/*
========================================
START
========================================
*/

bot.onText(
    /^\/start$/,
    async (msg) => {

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

/report
`;

        bot.sendMessage(
            msg.chat.id,
            text
        );
    }
);

/*
========================================
ADD WORKER
========================================
*/

bot.onText(
    /^\/addworker (.+) (\d+)$/,
    (msg, match) => {

        if (!isOwner(msg)) {
            return;
        }

        const name =
            match[1].trim();

        const salary =
            Number(match[2]);

        const workers =
            readWorkers();

        const newId =
            workers.length > 0
                ? Math.max(
                    ...workers.map(
                        w => w.id
                    )
                ) + 1
                : 1;

        workers.push({
            id: newId,
            name,
            dailySalary: salary
        });

        saveWorkers(
            workers
        );

        bot.sendMessage(
            msg.chat.id,
            `✅ Added\n\nID: ${newId}\nName: ${name}\nSalary: ${salary.toLocaleString()}៛`
        );
    }
);

/*
========================================
SHORT ADD
========================================
*/

bot.onText(
    /^\/add (.+) (\d+)$/,
    (msg, match) => {

        if (!isOwner(msg)) {
            return;
        }

        const name =
            match[1].trim();

        const salary =
            Number(match[2]);

        const workers =
            readWorkers();

        const newId =
            workers.length > 0
                ? Math.max(
                    ...workers.map(
                        w => w.id
                    )
                ) + 1
                : 1;

        workers.push({
            id: newId,
            name,
            dailySalary: salary
        });

        saveWorkers(
            workers
        );

        bot.sendMessage(
            msg.chat.id,
            `✅ Added\n\nID: ${newId}\nName: ${name}\nSalary: ${salary.toLocaleString()}៛`
        );
    }
);

/*
========================================
LIST WORKERS
========================================
*/

bot.onText(
    /^\/listworkers$/,
    msg => {

        if (!isOwner(msg)) {
            return;
        }

        const workers =
            readWorkers();

        if (
            workers.length === 0
        ) {
            return bot.sendMessage(
                msg.chat.id,
                "No workers found."
            );
        }

        let text =
            "👷 Workers List\n\n";

        workers.forEach(
            worker => {

                text +=
                    `${worker.id}. ${worker.name}\n`;

                text +=
                    `Salary: ${worker.dailySalary.toLocaleString()}៛\n\n`;
            }
        );

        bot.sendMessage(
            msg.chat.id,
            text
        );
    }
);

/*
========================================
DELETE WORKER
========================================
*/

bot.onText(
    /^\/deleteworker (\d+)$/,
    (msg, match) => {

        if (!isOwner(msg)) {
            return;
        }

        const workerId =
            Number(match[1]);

        const workers =
            readWorkers();

        const filtered =
            workers.filter(
                w =>
                    w.id !== workerId
            );

        saveWorkers(
            filtered
        );

        bot.sendMessage(
            msg.chat.id,
            "🗑 Worker deleted"
        );
    }
);

/*
========================================
ABSENCE MENU
========================================
*/

bot.onText(
    /^\/អវត្តមាន$/,
    msg => {

        if (!isOwner(msg)) {
            return;
        }

        const workers =
            readWorkers();

        if (
            workers.length === 0
        ) {
            return bot.sendMessage(
                msg.chat.id,
                "No workers."
            );
        }

        const buttons =
            workers.map(
                worker => [{
                    text:
                        `${worker.name}`,
                    callback_data:
                        `worker_${worker.id}`
                }]
            );

        bot.sendMessage(
            msg.chat.id,
            "ជ្រើសកម្មករ",
            {
                reply_markup: {
                    inline_keyboard:
                        buttons
                }
            }
        );
    }
);

/*
========================================
PART 2 CONTINUES...
========================================
*/
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
        SELECT WORKER
        ================================
        */

        if (data.startsWith("worker_")) {

            const workerId =
                Number(
                    data.replace(
                        "worker_",
                        ""
                    )
                );

            const worker =
                getWorkerById(
                    workerId
                );

            if (!worker) {
                return bot.answerCallbackQuery(
                    query.id,
                    {
                        text:
                            "Worker not found"
                    }
                );
            }

            return bot.editMessageText(
                `👷 ${worker.name}

ជ្រើសប្រភេទអវត្តមាន`,
                {
                    chat_id: chatId,
                    message_id:
                        query.message
                            .message_id,

                    reply_markup: {
                        inline_keyboard: [
                            [
                                {
                                    text:
                                        "🌅 ឈប់ព្រឹក",
                                    callback_data:
                                        `abs_morning_${workerId}`
                                }
                            ],
                            [
                                {
                                    text:
                                        "🌙 ឈប់ល្ងាច",
                                    callback_data:
                                        `abs_evening_${workerId}`
                                }
                            ],
                            [
                                {
                                    text:
                                        "❌ ឈប់មួយថ្ងៃ",
                                    callback_data:
                                        `abs_full_${workerId}`
                                }
                            ]
                        ]
                    }
                }
            );
        }

        /*
        ================================
        MORNING ABSENT
        ================================
        */

        if (
            data.startsWith(
                "abs_morning_"
            )
        ) {

            const workerId =
                Number(
                    data.replace(
                        "abs_morning_",
                        ""
                    )
                );

            const worker =
                getWorkerById(
                    workerId
                );

            saveAbsence(
                workerId,
                "morning"
            );

            await bot.editMessageText(
                `✅ ${worker.name}

កត់ត្រា:
ឈប់ព្រឹក

ប្រាក់ថ្ងៃនេះ:
${(
                    worker.dailySalary /
                    2
                ).toLocaleString()}៛`,
                {
                    chat_id: chatId,
                    message_id:
                        query.message
                            .message_id
                }
            );

            return;
        }

        /*
        ================================
        EVENING ABSENT
        ================================
        */

        if (
            data.startsWith(
                "abs_evening_"
            )
        ) {

            const workerId =
                Number(
                    data.replace(
                        "abs_evening_",
                        ""
                    )
                );

            const worker =
                getWorkerById(
                    workerId
                );

            saveAbsence(
                workerId,
                "evening"
            );

            await bot.editMessageText(
                `✅ ${worker.name}

កត់ត្រា:
ឈប់ល្ងាច

ប្រាក់ថ្ងៃនេះ:
${(
                    worker.dailySalary /
                    2
                ).toLocaleString()}៛`,
                {
                    chat_id: chatId,
                    message_id:
                        query.message
                            .message_id
                }
            );

            return;
        }

        /*
        ================================
        FULL DAY ABSENT
        ================================
        */

        if (
            data.startsWith(
                "abs_full_"
            )
        ) {

            const workerId =
                Number(
                    data.replace(
                        "abs_full_",
                        ""
                    )
                );

            const worker =
                getWorkerById(
                    workerId
                );

            saveAbsence(
                workerId,
                "full"
            );

            await bot.editMessageText(
                `✅ ${worker.name}

កត់ត្រា:
ឈប់មួយថ្ងៃពេញ

ប្រាក់ថ្ងៃនេះ:
0៛`,
                {
                    chat_id: chatId,
                    message_id:
                        query.message
                            .message_id
                }
            );

            return;
        }

        /*
        ================================
        VIEW WORKER HISTORY
        ================================
        */

        if (
            data.startsWith(
                "history_"
            )
        ) {

            const workerId =
                Number(
                    data.replace(
                        "history_",
                        ""
                    )
                );

            const worker =
                getWorkerById(
                    workerId
                );

            const attendance =
                readAttendance();

            let text =
                `📋 ${worker.name}\n\n`;

            const dates =
                Object.keys(
                    attendance
                ).sort();

            if (
                dates.length === 0
            ) {

                text +=
                    "មិនមានទិន្នន័យ";

            } else {

                dates.forEach(
                    date => {

                        const day =
                            getKhmerDayName(
                                date
                            );

                        const status =
                            attendance[
                                date
                            ]?.[
                                workerId
                            ];

                        let result =
                            "មកពេញថ្ងៃ";

                        if (
                            status ===
                            "morning"
                        ) {
                            result =
                                "ឈប់ព្រឹក";
                        }

                        if (
                            status ===
                            "evening"
                        ) {
                            result =
                                "ឈប់ល្ងាច";
                        }

                        if (
                            status ===
                            "full"
                        ) {
                            result =
                                "ឈប់មួយថ្ងៃ";
                        }

                        text +=
                            `${day} (${date}) : ${result}\n`;
                    }
                );
            }

            return bot.editMessageText(
                text,
                {
                    chat_id: chatId,
                    message_id:
                        query.message
                            .message_id
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

bot.onText(
    /^\/មើលអវត្តមាន$/,
    msg => {

        if (!isOwner(msg))
            return;

        const workers =
            readWorkers();

        if (
            workers.length === 0
        ) {
            return bot.sendMessage(
                msg.chat.id,
                "No workers."
            );
        }

        const buttons =
            workers.map(
                worker => [
                    {
                        text:
                            worker.name,
                        callback_data:
                            `history_${worker.id}`
                    }
                ]
            );

        bot.sendMessage(
            msg.chat.id,
            "📋 ជ្រើសកម្មករ",
            {
                reply_markup: {
                    inline_keyboard:
                        buttons
                }
            }
        );
    }
);

/*
========================================
SALARY CALCULATOR
========================================
*/

function calculateWorkerSalary(
    worker
) {

    const attendance =
        readAttendance();

    let total = 0;

    const dates =
        Object.keys(
            attendance
        );

    /*
    Monday-Saturday = 6 days
    Default worker present
    */

    const weekDays = 6;

    total =
        worker.dailySalary *
        weekDays;

    dates.forEach(date => {

        const status =
            attendance[date]?.[
                worker.id
            ];

        if (!status)
            return;

        if (
            status === "morning"
        ) {

            total -=
                worker.dailySalary /
                2;

        }

        if (
            status === "evening"
        ) {

            total -=
                worker.dailySalary /
                2;

        }

        if (
            status === "full"
        ) {

            total -=
                worker.dailySalary;

        }

    });

    return total;
}

/*
========================================
MANUAL REPORT
========================================
*/

bot.onText(
    /^\/report$/,
    msg => {

        if (!isOwner(msg))
            return;

        sendWeeklyReport(
            msg.chat.id
        );
    }
);

/*
========================================
SEND REPORT
========================================
*/

function sendWeeklyReport(
    chatId
) {

    const workers =
        readWorkers();

    if (
        workers.length === 0
    ) return;

    let text =
        "💰 បញ្ជីបើកប្រាក់ប្រចាំសប្តាហ៍\n\n";

    workers.forEach(
        (
            worker,
            index
        ) => {

            const total =
                calculateWorkerSalary(
                    worker
                );

            text +=
                `${index + 1}. ${worker.name}\n`;

            text +=
                `ប្រាក់សរុប: ${total.toLocaleString()}៛\n\n`;
        }
    );

    bot.sendMessage(
        chatId,
        text
    );
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

            sendWeeklyReport(
                OWNER_ID
            );

            console.log(
                "Weekly report sent"
            );

        } catch (err) {

            console.error(
                err
            );

        }

    },
    {
        timezone:
            "Asia/Phnom_Penh"
    }
);

/*
========================================
RESET WEEK
SUNDAY 00:00
========================================
*/

cron.schedule(
    "0 0 * * 0",
    async () => {

        try {

            saveAttendance(
                {}
            );

            bot.sendMessage(
                OWNER_ID,
                "🔄 សប្តាហ៍ថ្មីបានចាប់ផ្តើម\nAttendance Reset Complete"
            );

            console.log(
                "Attendance Reset"
            );

        } catch (err) {

            console.error(
                err
            );

        }

    },
    {
        timezone:
            "Asia/Phnom_Penh"
    }
);

/*
========================================
ERROR HANDLER
========================================
*/

bot.on(
    "polling_error",
    err => {

        console.error(
            "Polling Error:",
            err.message
        );

    }
);

/*
========================================
UNCAUGHT
========================================
*/

process.on(
    "uncaughtException",
    err => {

        console.error(
            err
        );

    }
);

process.on(
    "unhandledRejection",
    err => {

        console.error(
            err
        );

    }
);

console.log(
    "Worker Salary System Ready ✅"
);