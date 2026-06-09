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

// ใส่ลิงก์โลโก้บริษัทแบบ https ใน Render > Environment เช่น LOGO_URL=https://...
// ถ้าไม่ใส่ ระบบจะใช้ตัวอักษร S แทนโลโก้ เพื่อให้ Flex Message ไม่พัง
const LOGO_URL = process.env.LOGO_URL || "";

app.get("/", (req, res) => {
  res.status(200).send("LINE HR BOT RUNNING");
});

app.get("/dashboard", async (req, res) => {
  try {
    const password = process.env.DASHBOARD_PASSWORD;

    if (password && req.query.password !== password) {
      return res.status(401).send(`
        <!doctype html>
        <html lang="th">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>HR Dashboard Login</title>
          <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@1/css/pico.min.css">
        </head>
        <body>
          <main class="container">
            <article>
              <h2>HR Dashboard</h2>
              <p>กรุณาใส่รหัสผ่านต่อท้าย URL แบบนี้</p>
              <code>/dashboard?password=YOUR_PASSWORD</code>
            </article>
          </main>
        </body>
        </html>
      `);
    }

    const data = await getDashboardData();
    res.status(200).send(renderDashboardHtml(data));
  } catch (error) {
    console.error("Dashboard error:", error);
    res.status(500).send("Dashboard error: " + escapeHtml(error.message));
  }
});

app.get("/dashboard.json", async (req, res) => {
  try {
    const password = process.env.DASHBOARD_PASSWORD;

    if (password && req.query.password !== password) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const data = await getDashboardData();
    res.status(200).json(data);
  } catch (error) {
    console.error("Dashboard JSON error:", error);
    res.status(500).json({ error: error.message });
  }
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
          const remaining = balance[leave.type]?.remaining ?? "-";

          console.log("APPROVED SUCCESS");

          await replyText(
            event.replyToken,
            `อนุมัติใบลาของ ${name} แล้ว\nคงเหลือ ${leave.type}: ${remaining} วัน/ปี`
          );

          continue;
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

          continue;
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

          if (!name || name === "-" || !type || type === "-" || !date || date === "-") {
            await replyText(
              event.replyToken,
              "กรุณากรอกข้อมูลให้ครบ เช่น\n\nแจ้งลา\nชื่อ: ทดสอบ\nประเภท: ลาป่วย\nวันที่: 2026-06-12\nเวลา: 1 วัน\nเหตุผล: ไม่สบาย"
            );
            continue;
          }

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

          const balance = await getLeaveBalance(event.source.userId);
          const remaining = balance[type]?.remaining || 0;

          let requestedDays = 1;

          if (String(duration).includes("ครึ่ง")) {
            requestedDays = 0.5;
          } else {
            requestedDays = parseFloat(String(duration).replace(/[^\d.]/g, "")) || 1;
          }

          if (requestedDays > remaining) {
            await replyText(
              event.replyToken,
              `สิทธิ์ลาไม่เพียงพอ\nเหลือ ${remaining} วัน`
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

          await replyFlex(event.replyToken, createLeaveFlex(text, leaveId, balance));
          continue;
        }
      }
    } catch (error) {
      console.error("Event handling error:", error);
      if (event.replyToken) {
        try {
          await replyText(
            event.replyToken,
            "ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง"
          );
        } catch (replyError) {
          console.error("Reply error:", replyError);
        }
      }
    }
  }
});

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

  const logoBox = LOGO_URL
    ? {
        type: "image",
        url: LOGO_URL,
        size: "sm",
        aspectMode: "cover",
        aspectRatio: "1:1",
        flex: 1
      }
    : {
        type: "box",
        layout: "vertical",
        width: "44px",
        height: "44px",
        cornerRadius: "22px",
        backgroundColor: "#FFFFFF",
        justifyContent: "center",
        alignItems: "center",
        contents: [
          {
            type: "text",
            text: "S",
            color: "#0B73D9",
            weight: "bold",
            size: "xl",
            align: "center"
          }
        ]
      };

  return {
    type: "flex",
    altText: "ใบลาใหม่รออนุมัติ",
    contents: {
      type: "bubble",
      size: "mega",
      styles: {
        header: {
          backgroundColor: "#0B73D9"
        },
        body: {
          backgroundColor: "#F4FAFF"
        },
        footer: {
          backgroundColor: "#F4FAFF"
        }
      },
      header: {
        type: "box",
        layout: "vertical",
        paddingAll: "20px",
        contents: [
          {
            type: "box",
            layout: "horizontal",
            spacing: "md",
            contents: [
              logoBox,
              {
                type: "box",
                layout: "vertical",
                flex: 4,
                contents: [
                  {
                    type: "text",
                    text: "HR Sooksabay",
                    color: "#FFFFFF",
                    weight: "bold",
                    size: "lg"
                  },
                  {
                    type: "text",
                    text: "ระบบจัดการใบลาออนไลน์",
                    color: "#E8F4FF",
                    size: "sm"
                  }
                ]
              }
            ]
          }
        ]
      },
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "20px",
        spacing: "md",
        contents: [
          {
            type: "box",
            layout: "vertical",
            backgroundColor: "#FFFFFF",
            cornerRadius: "20px",
            paddingAll: "18px",
            spacing: "md",
            contents: [
              {
                type: "box",
                layout: "horizontal",
                spacing: "md",
                contents: [
                  {
                    type: "box",
                    layout: "vertical",
                    width: "48px",
                    height: "48px",
                    cornerRadius: "24px",
                    backgroundColor: "#E7F2FF",
                    justifyContent: "center",
                    alignItems: "center",
                    contents: [
                      {
                        type: "text",
                        text: "📝",
                        size: "xl",
                        align: "center"
                      }
                    ]
                  },
                  {
                    type: "box",
                    layout: "vertical",
                    flex: 1,
                    contents: [
                      {
                        type: "text",
                        text: "ใบลาใหม่รออนุมัติ",
                        weight: "bold",
                        size: "xl",
                        color: "#0B2B5B",
                        wrap: true
                      },
                      {
                        type: "text",
                        text: `(L1/1) • ${type}`,
                        color: "#6B7A90",
                        size: "sm"
                      }
                    ]
                  }
                ]
              },
              {
                type: "separator",
                color: "#DDEBFA"
              },
              {
                type: "box",
                layout: "vertical",
                backgroundColor: "#F2F8FF",
                cornerRadius: "14px",
                paddingAll: "14px",
                spacing: "xs",
                contents: [
                  {
                    type: "text",
                    text: name,
                    weight: "bold",
                    size: "lg",
                    color: "#0B2B5B"
                  },
                  {
                    type: "text",
                    text: "Management · Owner",
                    color: "#6B7A90",
                    size: "sm"
                  }
                ]
              },
              rowStyled("วันที่", date),
              rowStyled("ประเภท", type),
              rowStyled("ระยะเวลา", duration),
              rowStyled("เหตุผล", reason),
              {
                type: "separator",
                color: "#DDEBFA"
              },
              {
                type: "text",
                text: "สิทธิ์วันลา",
                weight: "bold",
                color: "#0B73D9",
                size: "md"
              },
              {
                type: "box",
                layout: "vertical",
                backgroundColor: "#F2F8FF",
                cornerRadius: "14px",
                paddingAll: "14px",
                spacing: "sm",
                contents: [
                  leaveBalanceRow("🏥 ลาป่วย", balance["ลาป่วย"].remaining),
                  leaveBalanceRow("📌 ลากิจ", balance["ลากิจ"].remaining),
                  leaveBalanceRow("🌤 ลาพักร้อน", balance["ลาพักร้อน"].remaining),
                  leaveBalanceRow("🙏 ลาบวช", balance["ลาบวช"].remaining)
                ]
              },
              {
                type: "box",
                layout: "vertical",
                backgroundColor: "#E8F4FF",
                cornerRadius: "14px",
                paddingAll: "14px",
                contents: [
                  {
                    type: "text",
                    text: `สิทธิ์ ${type}: ${quota[type] || "-"} วัน/ปี`,
                    wrap: true,
                    weight: "bold",
                    size: "md",
                    color: "#0B2B5B",
                    align: "center"
                  }
                ]
              }
            ]
          }
        ]
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        paddingAll: "18px",
        contents: [
          postbackBtn("✅ อนุมัติ", "#087A3D", `approve|${leaveId}`),
          postbackBtn("❌ ปฏิเสธ", "#FFFFFF", `reject|${leaveId}`, "secondary"),
          postbackBtn("ℹ️ ขอข้อมูลเพิ่ม", "#FFFFFF", `request_info|${leaveId}`, "secondary")
        ]
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

function rowStyled(label, value) {
  return {
    type: "box",
    layout: "horizontal",
    spacing: "md",
    paddingTop: "4px",
    paddingBottom: "4px",
    contents: [
      {
        type: "text",
        text: label,
        color: "#7A8AA0",
        size: "sm",
        flex: 3
      },
      {
        type: "text",
        text: String(value),
        color: "#1F2D3D",
        size: "sm",
        weight: "bold",
        wrap: true,
        flex: 5
      }
    ]
  };
}

function leaveBalanceRow(label, remaining) {
  return {
    type: "box",
    layout: "horizontal",
    contents: [
      {
        type: "text",
        text: label,
        size: "sm",
        color: "#1F2D3D",
        flex: 4
      },
      {
        type: "text",
        text: `เหลือ ${remaining} วัน/ปี`,
        size: "sm",
        color: "#0B73D9",
        weight: "bold",
        align: "end",
        flex: 4
      }
    ]
  };
}

function btn(label, color, text, style = "primary") {
  const button = {
    type: "button",
    style,
    height: "md",
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
    height: "md",
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
    name: row[2],
    displayName: row[2],
    type: row[3],
    date: row[4],
    duration: row[5],
    reason: row[6],
    status: row[7],
    approver: row[8],
    createdAt: row[9]
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
    const status = row[7];

    let duration = 1;

    if (String(row[5]).includes("ครึ่ง")) {
      duration = 0.5;
    } else {
      duration = parseFloat(String(row[5]).replace(/[^\d.]/g, "")) || 1;
    }

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


function parseDurationDays(value) {
  const text = String(value || "").trim();

  if (!text) return 1;
  if (text.includes("ครึ่ง")) return 0.5;

  const match = text.match(/(\d+(?:\.\d+)?)/);
  if (match) return Number(match[1]);

  return 1;
}

async function getSheetRows() {
  const auth = new google.auth.GoogleAuth({
    credentials: SERVICE_ACCOUNT,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });

  const sheets = google.sheets({ version: "v4", auth });

  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "A:J"
  });

  return result.data.values || [];
}

async function getDashboardData() {
  const rows = await getSheetRows();

  const quota = {
    "ลาป่วย": 30,
    "ลากิจ": 6,
    "ลาพักร้อน": 10,
    "ลาบวช": 15
  };

  const peopleMap = {};
  const totalsByType = {};
  const pending = [];
  const recent = [];

  Object.keys(quota).forEach(type => {
    totalsByType[type] = 0;
  });

  rows.forEach(row => {
    const leaveId = row[0] || "";
    const userId = row[1] || "";
    const name = row[2] || "ไม่ระบุชื่อ";
    const type = row[3] || "ไม่ระบุประเภท";
    const date = row[4] || "";
    const durationText = row[5] || "";
    const reason = row[6] || "";
    const status = row[7] || "";
    const approver = row[8] || "";
    const createdAt = row[9] || "";
    const days = parseDurationDays(durationText);

    if (!peopleMap[userId]) {
      peopleMap[userId] = {
        userId,
        name,
        totalApprovedDays: 0,
        pendingCount: 0,
        rejectedCount: 0,
        requestInfoCount: 0,
        byType: {}
      };

      Object.keys(quota).forEach(qType => {
        peopleMap[userId].byType[qType] = {
          quota: quota[qType],
          used: 0,
          remaining: quota[qType]
        };
      });
    }

    if (!peopleMap[userId].byType[type]) {
      peopleMap[userId].byType[type] = {
        quota: quota[type] || 0,
        used: 0,
        remaining: quota[type] || 0
      };
    }

    if (status === "approved") {
      peopleMap[userId].totalApprovedDays += days;
      peopleMap[userId].byType[type].used += days;
      peopleMap[userId].byType[type].remaining =
        peopleMap[userId].byType[type].quota - peopleMap[userId].byType[type].used;

      if (totalsByType[type] === undefined) totalsByType[type] = 0;
      totalsByType[type] += days;
    } else if (status === "pending") {
      peopleMap[userId].pendingCount += 1;
      pending.push({ leaveId, userId, name, type, date, duration: durationText, days, reason, status, createdAt });
    } else if (status === "rejected") {
      peopleMap[userId].rejectedCount += 1;
    } else if (status === "request_info") {
      peopleMap[userId].requestInfoCount += 1;
    }

    if (leaveId) {
      recent.push({ leaveId, userId, name, type, date, duration: durationText, days, reason, status, approver, createdAt });
    }
  });

  const people = Object.values(peopleMap)
    .sort((a, b) => b.totalApprovedDays - a.totalApprovedDays || a.name.localeCompare(b.name, "th"));

  const approvedTotalDays = people.reduce((sum, person) => sum + person.totalApprovedDays, 0);

  recent.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      peopleCount: people.length,
      approvedTotalDays,
      pendingCount: pending.length,
      totalRequests: recent.length
    },
    totalsByType,
    people,
    pending,
    recent: recent.slice(0, 30)
  };
}

function formatDays(value) {
  const number = Number(value || 0);
  return Number.isInteger(number) ? String(number) : String(number.toFixed(1));
}

function statusLabel(status) {
  const map = {
    approved: "อนุมัติแล้ว",
    pending: "รออนุมัติ",
    rejected: "ปฏิเสธ",
    request_info: "ขอข้อมูลเพิ่ม"
  };

  return map[status] || status || "-";
}

function statusClass(status) {
  const map = {
    approved: "success",
    pending: "warning",
    rejected: "danger",
    request_info: "info"
  };

  return map[status] || "muted";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderDashboardHtml(data) {
  const peopleRows = data.people.map(person => {
    const sick = person.byType["ลาป่วย"] || { used: 0, remaining: 30 };
    const personal = person.byType["ลากิจ"] || { used: 0, remaining: 6 };
    const vacation = person.byType["ลาพักร้อน"] || { used: 0, remaining: 10 };
    const ordain = person.byType["ลาบวช"] || { used: 0, remaining: 15 };

    return `
      <tr>
        <td>
          <strong>${escapeHtml(person.name)}</strong>
          <br><small>${escapeHtml(person.userId)}</small>
        </td>
        <td><strong>${formatDays(person.totalApprovedDays)}</strong></td>
        <td>${formatDays(sick.used)} / เหลือ ${formatDays(sick.remaining)}</td>
        <td>${formatDays(personal.used)} / เหลือ ${formatDays(personal.remaining)}</td>
        <td>${formatDays(vacation.used)} / เหลือ ${formatDays(vacation.remaining)}</td>
        <td>${formatDays(ordain.used)} / เหลือ ${formatDays(ordain.remaining)}</td>
        <td>${person.pendingCount}</td>
      </tr>
    `;
  }).join("");

  const pendingRows = data.pending.map(item => `
    <tr>
      <td>${escapeHtml(item.name)}</td>
      <td>${escapeHtml(item.type)}</td>
      <td>${escapeHtml(item.date)}</td>
      <td>${escapeHtml(item.duration)}</td>
      <td>${escapeHtml(item.reason)}</td>
    </tr>
  `).join("");

  const recentRows = data.recent.map(item => `
    <tr>
      <td>${escapeHtml(item.name)}</td>
      <td>${escapeHtml(item.type)}</td>
      <td>${escapeHtml(item.date)}</td>
      <td>${escapeHtml(item.duration)}</td>
      <td><span class="badge ${statusClass(item.status)}">${statusLabel(item.status)}</span></td>
    </tr>
  `).join("");

  const typeCards = Object.entries(data.totalsByType).map(([type, days]) => `
    <article class="stat-card">
      <small>${escapeHtml(type)}</small>
      <h3>${formatDays(days)} วัน</h3>
    </article>
  `).join("");

  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>HR Sooksabay Dashboard</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@1/css/pico.min.css">
  <style>
    :root {
      --primary: #0B73D9;
      --primary-hover: #075BB0;
      --primary-focus: rgba(11, 115, 217, .25);
      --font-size: 16px;
    }

    body {
      background:
        radial-gradient(circle at top left, rgba(42, 160, 255, .20), transparent 32rem),
        linear-gradient(180deg, #F3F9FF 0%, #FFFFFF 100%);
      color: #10243f;
    }

    nav {
      padding-top: 1rem;
      padding-bottom: 1rem;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: .75rem;
      font-weight: 800;
      color: #0B2B5B;
    }

    .brand-icon {
      width: 42px;
      height: 42px;
      border-radius: 50%;
      display: grid;
      place-items: center;
      background: linear-gradient(135deg, #0B73D9, #51C7F4);
      color: white;
      box-shadow: 0 10px 25px rgba(11, 115, 217, .25);
    }

    .hero {
      border: 0;
      color: white;
      background: linear-gradient(135deg, #0B73D9, #064EBD);
      box-shadow: 0 20px 45px rgba(11, 115, 217, .22);
      border-radius: 28px;
      overflow: hidden;
      position: relative;
    }

    .hero::after {
      content: "";
      position: absolute;
      width: 320px;
      height: 320px;
      border-radius: 50%;
      right: -90px;
      top: -130px;
      background: rgba(255,255,255,.16);
    }

    .hero h1, .hero p {
      color: white;
      position: relative;
      z-index: 1;
    }

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 1rem;
      margin: 1.25rem 0;
    }

    .stat-card {
      border: 0;
      border-radius: 22px;
      background: rgba(255,255,255,.88);
      box-shadow: 0 14px 35px rgba(17, 67, 119, .10);
      margin: 0;
    }

    .stat-card h2, .stat-card h3 {
      color: #0B2B5B;
      margin-bottom: 0;
    }

    .table-card {
      border: 0;
      border-radius: 22px;
      background: rgba(255,255,255,.92);
      box-shadow: 0 14px 35px rgba(17, 67, 119, .10);
      overflow: hidden;
    }

    .table-wrap {
      overflow-x: auto;
    }

    table {
      min-width: 900px;
    }

    th {
      color: #0B73D9;
      white-space: nowrap;
    }

    td {
      vertical-align: middle;
    }

    .badge {
      display: inline-block;
      padding: .25rem .65rem;
      border-radius: 999px;
      font-size: .85rem;
      font-weight: 700;
      white-space: nowrap;
    }

    .success { color: #087A3D; background: #E6F7ED; }
    .warning { color: #9A6700; background: #FFF4D6; }
    .danger { color: #B42318; background: #FFE8E6; }
    .info { color: #075BB0; background: #E8F4FF; }
    .muted { color: #5D6B7A; background: #EEF2F6; }

    footer {
      color: #6B7A90;
      padding-bottom: 2rem;
    }

    @media (max-width: 900px) {
      .stats-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 560px) {
      .stats-grid {
        grid-template-columns: 1fr;
      }

      .hero {
        border-radius: 20px;
      }
    }
  </style>
</head>
<body>
  <nav class="container-fluid">
    <ul>
      <li>
        <span class="brand">
          <span class="brand-icon">S</span>
          HR Sooksabay
        </span>
      </li>
    </ul>
    <ul>
      <li><a href="/dashboard">Dashboard</a></li>
      <li><a href="/dashboard.json" role="button">JSON</a></li>
    </ul>
  </nav>

  <main class="container">
    <article class="hero">
      <h1>แดชบอร์ดสรุปวันลา</h1>
      <p>ดูภาพรวมว่าแต่ละคนลาไปกี่วันแล้ว แยกตามประเภทวันลา และรายการที่ยังรออนุมัติ</p>
    </article>

    <section class="stats-grid">
      <article class="stat-card">
        <small>พนักงานทั้งหมด</small>
        <h2>${data.summary.peopleCount} คน</h2>
      </article>
      <article class="stat-card">
        <small>วันลาที่อนุมัติแล้ว</small>
        <h2>${formatDays(data.summary.approvedTotalDays)} วัน</h2>
      </article>
      <article class="stat-card">
        <small>รออนุมัติ</small>
        <h2>${data.summary.pendingCount} รายการ</h2>
      </article>
      <article class="stat-card">
        <small>คำขอทั้งหมด</small>
        <h2>${data.summary.totalRequests} รายการ</h2>
      </article>
    </section>

    <section class="stats-grid">
      ${typeCards}
    </section>

    <article class="table-card">
      <h2>สรุปตามพนักงาน</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ชื่อ</th>
              <th>รวมลาแล้ว</th>
              <th>ลาป่วย</th>
              <th>ลากิจ</th>
              <th>ลาพักร้อน</th>
              <th>ลาบวช</th>
              <th>รออนุมัติ</th>
            </tr>
          </thead>
          <tbody>
            ${peopleRows || `<tr><td colspan="7">ยังไม่มีข้อมูล</td></tr>`}
          </tbody>
        </table>
      </div>
    </article>

    <article class="table-card">
      <h2>รายการรออนุมัติ</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ชื่อ</th>
              <th>ประเภท</th>
              <th>วันที่</th>
              <th>ระยะเวลา</th>
              <th>เหตุผล</th>
            </tr>
          </thead>
          <tbody>
            ${pendingRows || `<tr><td colspan="5">ไม่มีรายการรออนุมัติ</td></tr>`}
          </tbody>
        </table>
      </div>
    </article>

    <article class="table-card">
      <h2>รายการล่าสุด</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ชื่อ</th>
              <th>ประเภท</th>
              <th>วันที่</th>
              <th>ระยะเวลา</th>
              <th>สถานะ</th>
            </tr>
          </thead>
          <tbody>
            ${recentRows || `<tr><td colspan="5">ยังไม่มีข้อมูล</td></tr>`}
          </tbody>
        </table>
      </div>
    </article>
  </main>

  <footer class="container">
    <small>Generated at ${escapeHtml(data.generatedAt)} • HR Sooksabay Dashboard</small>
  </footer>
</body>
</html>`;
}

app.listen(PORT, () => {
  console.log(`LINE HR BOT START PORT ${PORT}`);
});
