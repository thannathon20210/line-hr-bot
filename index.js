const express = require("express");
const axios = require("axios");
const { google } = require("googleapis");

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SERVICE_ACCOUNT = JSON.parse(
  Buffer.from(
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64,
    "base64"
  ).toString("utf8")
);
const app = express();
app.use(express.json());

const TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.status(200).send("LINE HR BOT RUNNING");
});

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  const events = req.body.events || [];

  for (const event of events) {
    try {
      if (event.type === "postback") {
        const [action, leaveId] = event.postback.data.split("|");

if (action === "approve") {
  console.log("APPROVE:", leaveId);

  const leave = await getLeaveById(leaveId);
  const name = leave.name;

 await updateLeaveStatus(
  leaveId,
  "approved",
  event.source.userId
);

const balance = await getLeaveBalance(leave.userId);
const remaining = balance[leave.type].remaining;
console.log("APPROVED SUCCESS");
await replyText(
  event.replyToken,
  `อนุมัติใบลาของ ${name} แล้ว\nคงเหลือ ${leave.type}: ${remaining} วัน/ปี`
);
}
        if (action === "request_info") {
  console.log("REQUEST INFO:", leaveId);

  const leave = await getLeaveById(leaveId);
  const name = leave.name;

  await updateLeaveStatus(
    leaveId,
    "request_info",
    event.source.userId
  );

await replyText(
  event.replyToken,
  `ขอข้อมูลเพิ่มเติมจาก ${name}\nประเภท: ${leave.type}\nวันที่: ${leave.date}\nระยะเวลา: ${leave.duration}\nเหตุผล: ${leave.reason}`
);

  continue;
}
if (action === "reject") {
  console.log("REJECT:", leaveId);
const leave = await getLeaveById(leaveId);
const name = leave.name;
  await updateLeaveStatus(
    leaveId,
    "rejected",
    event.source.userId
  );

  console.log("REJECTED SUCCESS");

  await replyText(
    event.replyToken,
    `ปฏิเสธใบลาของ ${name} แล้ว`
  );
}
        continue;
      }

      if (event.type === "message" && event.message.type === "text") {
        const text = event.message.text.trim();
if (text === "สิทธิลา") {
  const balance = await getLeaveBalance(event.source.userId);

 await replyText(
  event.replyToken,
  `สิทธิวันลาคงเหลือ\n\n` +
  `ลาป่วย: ${balance["ลาป่วย"].remaining} วัน\n` +
  `ลากิจ: ${balance["ลากิจ"].remaining} วัน\n` +
  `ลาพักร้อน: ${balance["ลาพักร้อน"].remaining} วัน\n` +
  `ลาบวช: ${balance["ลาบวช"].remaining} วัน`
);

continue;
}
        if (text.startsWith("แจ้งลา")) {
const name = getField(text, "ชื่อ");
const type = getField(text, "ประเภท");
const date = getField(text, "วันที่");
const duration = getField(text, "เวลา");
const reason = getField(text, "เหตุผล");
const exists = await hasDuplicateLeave(
  event.source.userId,
  date
);

if (exists) {
  await replyText(
    event.replyToken,
    "คุณมีใบลาในช่วงวันที่นี้อยู่แล้ว"
  );
  continue;
}
const leaveId = await saveLeaveToSheet({
  userId: event.source.userId,
  name,
  type,
  date,
  duration,
  reason
});

    const balance = await getLeaveBalance(event.source.userId);
          const remaining = balance[type]?.remaining || 0;

let requestedDays = 1;

if (String(duration).includes("ครึ่ง")) {
  requestedDays = 0.5;
} else {
  requestedDays = parseInt(duration) || 1;
}

if (requestedDays > remaining) {
await replyText(
  event.replyToken,
  `สิทธิ์ลาไม่เพียงพอ\nเหลือ ${remaining} วัน`
);
  continue;
}
}       
await replyFlex(event.replyToken, createLeaveFlex(text, leaveId, balance));
}
function createLeaveFlex(text, leaveId, balance) {
const name = getField(text, "ชื่อ");
const type = getField(text, "ประเภท");
const date = getField(text, "วันที่");
const duration = getField(text, "เวลา");
const reason = getField(text, "เหตุผล");

  const quota = {
    "ลาป่วย": 30,
    "ลากิจ": 6,
    "ลาพักร้อน": 10,
    "ลาบวช": 15
  };

  return {
    type: "flex",
    altText: "ใบลาใหม่รออนุมัติ",
    contents: {
      type: "bubble",
      size: "mega",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          {
            type: "text",
            text: "📝 ใบลาใหม่รออนุมัติ",
            weight: "bold",
            size: "xl",
            wrap: true
          },
          {
            type: "text",
            text: "(L1/1)",
            color: "#888888"
          },
          { type: "separator" },
          {
            type: "text",
            text: name,
            weight: "bold"
          },
          {
            type: "text",
            text: "Management · Owner",
            color: "#666666",
            size: "sm"
          },
          { type: "separator" },
          row("วันที่", date),
          row("ประเภท", type),
          row("ระยะเวลา", duration),
          row("เหตุผล", reason),
          { type: "separator" },
          {
            type: "text",
            text: "สิทธิ์วันลา",
            weight: "bold",
            color: "#666666"
          },
row("ลาป่วย", `เหลือ ${balance["ลาป่วย"].remaining} วัน/ปี`),
row("ลากิจ", `เหลือ ${balance["ลากิจ"].remaining} วัน/ปี`),
row("ลาพักร้อน", `เหลือ ${balance["ลาพักร้อน"].remaining} วัน/ปี`),
row("ลาบวช", `เหลือ ${balance["ลาบวช"].remaining} วัน/ปี`),
          { type: "separator" },
          {
            type: "text",
            text: `สิทธิ์ ${type}: ${quota[type] || "-"} วัน/ปี`,
            wrap: true,
            weight: "bold"
          }
        ]
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
postbackBtn("✅ อนุมัติ", "#0b5d32", `approve|${leaveId}`),
postbackBtn("❌ ปฏิเสธ", "#d9dde6", `reject|${leaveId}`, "secondary"),
postbackBtn("ℹ️ ขอข้อมูลเพิ่ม", "#d9dde6", `request_info|${leaveId}`, "secondary")        ]
      }
    }
  };
}
function getField(text, label) {
  const line = text
    .split("\n")
    .find(l => l.trim().startsWith(label + ":"));

  return line ? line.replace(label + ":", "").trim() : "-";
}
function row(label, value) {
  return {
    type: "box",
    layout: "baseline",
    contents: [
      {
        type: "text",
        text: label,
        color: "#888888",
        flex: 2,
        size: "sm"
      },
      {
        type: "text",
        text: String(value),
        flex: 4,
        size: "sm",
        wrap: true
      }
    ]
  };
}

function btn (label, color, text, style = "primary") {
  const button = {
    type: "button",
    style,
    action: {
      type: "message",
      label,
      text
    }
  };

  if (style === "primary") {
    button.color = color;
  }

  return button;
}
function postbackBtn(label, color, data, style = "primary") {
  const button = {
    type: "button",
    style,
    action: {
      type: "postback",
      label,
      data,
      displayText: label
    }
  };

  if (style === "primary") {
    button.color = color;
  }

  return button;
}

async function replyText(replyToken, text) {
  await axios.post(
    "https://api.line.me/v2/bot/message/reply",
    {
      replyToken,
      messages: [{ type: "text", text }]
    },
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TOKEN}`
      }
    }
  );
}

async function replyFlex(replyToken, flexMessage) {
  await axios.post(
    "https://api.line.me/v2/bot/message/reply",
    {
      replyToken,
      messages: [flexMessage]
    },
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TOKEN}`
      }
    }
  );
}
async function saveLeaveToSheet({ userId, name, type, date, duration, reason }) {
  const auth = new google.auth.GoogleAuth({
    credentials: SERVICE_ACCOUNT,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});

const sheets = google.sheets({ version: "v4", auth });

const leaveId = `LV-${Date.now()}`;

await sheets.spreadsheets.values.append({
  spreadsheetId: SHEET_ID,
  range: "A:J",
  valueInputOption: "USER_ENTERED",
  requestBody: {
    values: [[
      leaveId,
      userId,
      name,
      type,
      date,
      duration,
      reason,
      "pending",
      "",
      new Date().toISOString()
    ]]
  }
});

return leaveId;
}

async function updateLeaveStatus(leaveId, status, approver) {
  const auth = new google.auth.GoogleAuth({
    credentials: SERVICE_ACCOUNT,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });

  const sheets = google.sheets({ version: "v4", auth });

  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "A:J"
  });

  const rows = result.data.values || [];
  const rowIndex = rows.findIndex(row => row[0] === leaveId);

  if (rowIndex === -1) {
    throw new Error(`Leave ID not found: ${leaveId}`);
  }
const currentStatus = rows[rowIndex][7];

if (currentStatus !== "pending") {
  throw new Error(`ใบลานี้ถูกดำเนินการแล้ว: ${currentStatus}`);
}
  const sheetRow = rowIndex + 1;

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `H${sheetRow}:I${sheetRow}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[status, approver]]
    }
  });
}
async function getLeaveById(leaveId) {
  const auth = new google.auth.GoogleAuth({
    credentials: SERVICE_ACCOUNT,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });

  const sheets = google.sheets({ version: "v4", auth });

  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "A:J"
  });

  const rows = result.data.values || [];

  const row = rows.find(r => r[0] === leaveId);

  if (!row) {
    throw new Error("Leave not found");
  }

  return {
    leaveId: row[0],
    userId: row[1],
    displayName: row[2],
    type: row[3],
    date: row[4],
    duration: row[5],
    reason: row[6],
    status: row[7],
    approver: row[8],
    createdAt: row[9]
  };
};

}

async function hasDuplicateLeave(userId, date) {
  const auth = new google.auth.GoogleAuth({
    credentials: SERVICE_ACCOUNT,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });

  const sheets = google.sheets({ version: "v4", auth });

  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "A:J"
  });

  const rows = result.data.values || [];

  return rows.some(row => {
  const rowUserId = row[1];
  const rowDate = row[4];
  const status = row[7];

  return (
    rowUserId === userId &&
    rowDate === date &&
    (status === "pending" || status === "approved")
  );
});
}

async function getLeaveBalance(userId) {
  const auth = new google.auth.GoogleAuth({
    credentials: SERVICE_ACCOUNT,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });

  const sheets = google.sheets({ version: "v4", auth });

  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "A:J"
  });

  const rows = result.data.values || [];
  const quota = {
    "ลาป่วย": 30,
    "ลากิจ": 6,
    "ลาพักร้อน": 10,
    "ลาบวช": 15
  };

  const used = {
    "ลาป่วย": 0,
    "ลากิจ": 0,
    "ลาพักร้อน": 0,
    "ลาบวช": 0
  };

  rows.forEach(row => {
    const rowUserId = row[1];
    const type = row[3];
let duration = 1;

if (String(row[5]).includes("ครึ่ง")) {
  duration = 0.5;
} else {
  duration = parseInt(row[5]) || 1;
}
    const status = row[7];

    if (
      rowUserId === userId &&
      status === "approved" &&
      used[type] !== undefined
    ) {
      used[type] += duration;
    }
  });

  const balance = {};

  Object.keys(quota).forEach(type => {
    balance[type] = {
      total: quota[type],
      used: used[type],
      remaining: quota[type] - used[type]
    };
  });

  return balance;
}
app.listen(PORT, () => {
  console.log(`LINE HR BOT START PORT ${PORT}`);
});
