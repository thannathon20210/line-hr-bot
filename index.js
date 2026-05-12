const express = require("express");
const axios = require("axios");

const app = express();

app.use(express.json());

const TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

app.post("/webhook", async (req, res) => {

  const events = req.body.events || [];

  for (const event of events) {

    if (event.type === "message") {

      const text = event.message.text;

      if (text.startsWith("ลา")) {

        await axios.post(
          "https://api.line.me/v2/bot/message/reply",
          {
            replyToken: event.replyToken,
            messages: [
              {
                type: "flex",
                altText: "ใบลาใหม่",
                contents: {
                  type: "bubble",
                  body: {
                    type: "box",
                    layout: "vertical",
                    contents: [

                      {
                        type: "text",
                        text: "📝 ใบลาใหม่รออนุมัติ",
                        weight: "bold",
                        size: "xl"
                      },

                      {
                        type: "separator",
                        margin: "md"
                      },

                      {
                        type: "text",
                        text: text,
                        wrap: true,
                        margin: "md"
                      },

                      {
                        type: "separator",
                        margin: "md"
                      },

                      {
                        type: "text",
                        text: "สิทธิ์วันลา",
                        weight: "bold",
                        margin: "md"
                      },

                      {
                        type: "text",
                        text: "ลาป่วย 30 วัน/ปี"
                      },

                      {
                        type: "text",
                        text: "ลากิจ 6 วัน/ปี"
                      },

                      {
                        type: "text",
                        text: "ลาพักร้อน 10 วัน/ปี"
                      },

                      {
                        type: "text",
                        text: "ลาบวช 15 วัน/ปี"
                      }

                    ]
                  },

                  footer: {
                    type: "box",
                    layout: "vertical",
                    spacing: "sm",
                    contents: [

                      {
                        type: "button",
                        style: "primary",
                        color: "#0b5d32",
                        action: {
                          type: "message",
                          label: "✅ อนุมัติ",
                          text: "อนุมัติแล้ว"
                        }
                      },

                      {
                        type: "button",
                        style: "primary",
                        color: "#9a7400",
                        action: {
                          type: "message",
                          label: "✅ อนุมัติแบบมีเงื่อนไข",
                          text: "อนุมัติแบบมีเงื่อนไข"
                        }
                      },

                      {
                        type: "button",
                        style: "secondary",
                        action: {
                          type: "message",
                          label: "❌ ปฏิเสธ",
                          text: "ปฏิเสธใบลา"
                        }
                      }

                    ]
                  }

                }
              }
            ]
          },
          {
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${TOKEN}`
            }
          }
        );

      }

    }

  }

  res.sendStatus(200);

});

app.listen(3000, () => {
  console.log("LINE HR BOT START");
});
