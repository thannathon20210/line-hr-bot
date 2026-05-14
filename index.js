const express = require("express");
const axios = require("axios");
const { google } = require("googleapis");

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SERVICE_ACCOUNT = JSON.parse(
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON.replace(/\\n/g, '\n')
);const app = express();
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
      if (event.type === "message" && event.message.type === "text") {
        const text = event.message.text.trim();

        if (text.startsWith("ลา ")) {
          const parts = text.split(" ");
const type = parts[1] || "-";
const date = parts[2] || "-";
const duration = parts[3] || "-";
const reason = parts.slice(4).join(" ") || "-";

await saveLeaveToSheet({
  userId: event.source.userId,
  type,
  date,
  duration,
  reason
});

await replyFlex(event.replyToken, createLeaveFlex(text));
        } else {
          await replyText(
            event.replyToken,
            "พิมพ์ขอลาแบบนี้:\nลา ลาป่วย 2026-05-10 ครึ่งวัน ปวดฟัน"
          );
        }
      }
    } catch (err) {
      console.error("EVENT ERROR:", err.response?.data || err.message);
    }
  }
});

function createLeaveFlex(text) {
  const parts = text.split(" ");
  const type = parts[1] || "-";
  const date = parts[2] || "-";
  const duration = parts[3] || "-";
  const reason = parts.slice(4).join(" ") || "-";

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
            text: "เจ้าของ ระบบ",
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
          row("ลาป่วย", "30 วัน/ปี"),
          row("ลากิจ", "6 วัน/ปี"),
          row("ลาพักร้อน", "10 วัน/ปี"),
          row("ลาบวช", "15 วัน/ปี"),
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
          btn("✅ อนุมัติ", "#0b5d32", "อนุมัติแล้ว"),
          btn("✅ ⏳ อนุมัติแบบมีเงื่อนไข", "#9a7400", "อนุมัติแบบมีเงื่อนไข"),
          btn("❌ ปฏิเสธ", "#d9dde6", "ปฏิเสธใบลา", "secondary"),
          btn("ℹ️ ขอข้อมูลเพิ่ม", "#d9dde6", "ขอข้อมูลเพิ่มเติม", "secondary")
        ]
      }
    }
  };
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

function btn(label, color, text, style = "primary") {
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
async function saveLeaveToSheet({ userId, type, date, duration, reason }) {
  const auth = new google.auth.GoogleAuth({
    credentials: SERVICE_ACCOUNT,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });

  const sheets = google.sheets({ version: "v4", auth });

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: "Leaves!A:J",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[
        `LV-${Date.now()}`,
        userId,
        "เจ้าของ ระบบ",
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
}
app.listen(PORT, () => {
  console.log(`LINE HR BOT START PORT ${PORT}`);
});
