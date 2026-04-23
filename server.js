const express = require("express");
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { Server } = require("socket.io");
const webPush = require("web-push");

const PORT = Number(process.env.PORT || 3000);
const HTTPS_PORT = Number(process.env.HTTPS_PORT || 3443);
const VAPID_PUBLIC_KEY = "BEEIcknCeYijSEAngwE-mPexGxzrOBjt4JY3avIhxKKSdZCgJOe3NXY_2FjgKs1sLLzjwtPFgOL8LiNfJc9EbJE";
const VAPID_PRIVATE_KEY = "VRbkLEQELXZ1uKRsxemUIEvDxiSMwjORuNuIeIz9FmQ";

webPush.setVapidDetails(
  "mailto:taskflow@example.com",
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer);

const subscriptions = new Map();
const reminders = new Map();

app.use(express.json());
app.use(express.static(path.join(__dirname)));

app.get("/api/config", (_request, response) => {
  response.json({
    vapidPublicKey: VAPID_PUBLIC_KEY,
    httpUrl: `http://localhost:${PORT}`,
    httpsUrl: `https://localhost:${HTTPS_PORT}`
  });
});

app.post("/subscribe", (request, response) => {
  const subscription = request.body;
  if (!subscription?.endpoint) {
    return response.status(400).json({ message: "Subscription endpoint is required." });
  }

  subscriptions.set(subscription.endpoint, subscription);
  return response.status(201).json({ message: "Subscription saved." });
});

app.post("/unsubscribe", (request, response) => {
  const endpoint = request.body?.endpoint || request.body?.subscription?.endpoint;
  if (!endpoint) {
    return response.status(400).json({ message: "Subscription endpoint is required." });
  }

  subscriptions.delete(endpoint);
  return response.json({ message: "Subscription removed." });
});

app.post("/snooze", (request, response) => {
  const reminderId = Number(request.query.reminderId || request.body?.reminderId);
  if (!reminderId || !reminders.has(reminderId)) {
    return response.status(404).json({ error: "Reminder not found" });
  }

  const reminder = reminders.get(reminderId);
  clearTimeout(reminder.timeoutId);

  const newDelay = 5 * 60 * 1000;
  const newTimeoutId = setTimeout(() => {
    notifyReminder({
      id: reminderId,
      text: reminder.text,
      reminderTime: Date.now() + newDelay,
      title: "Напоминание отложено"
    });
    reminders.delete(reminderId);
  }, newDelay);

  reminders.set(reminderId, {
    timeoutId: newTimeoutId,
    text: reminder.text,
    reminderTime: Date.now() + newDelay
  });

  return response.json({ message: "Reminder snoozed for 5 minutes" });
});

app.get("/health", (_request, response) => {
  response.json({
    ok: true,
    subscriptions: subscriptions.size,
    reminders: reminders.size
  });
});

const socketServers = [io];

attachSocketHandlers(io);

async function notifyReminder(reminder) {
  await sendPushNotification({
    title: reminder.title === "Напоминание отложено" ? "Напоминание отложено" : "!!! Напоминание",
    body: reminder.text,
    url: "/index.html",
    reminderId: reminder.id
  });
}

function attachSocketHandlers(socketServer) {
  socketServer.on("connection", (socket) => {
    socket.emit("taskAdded", {
      title: "Соединение с сервером установлено",
      source: "system"
    });

    socket.on("newTask", async (payload) => {
      const title = String(payload?.title || payload?.text || "").trim();
      if (!title) {
        return;
      }

      const taskData = {
        id: payload?.id || Date.now(),
        title,
        createdAt: payload?.timestamp || new Date().toISOString(),
        source: socket.id
      };

      broadcast("taskAdded", taskData);
      await sendPushNotification({
        title: "Новая задача в TaskFlow",
        body: `Добавлена задача: ${taskData.title}`,
        url: "/index.html"
      });
    });

    socket.on("newReminder", (payload) => {
      const reminderId = Number(payload?.id);
      const text = String(payload?.text || "").trim();
      const reminderTime = Number(payload?.reminderTime);
      const delay = reminderTime - Date.now();

      if (!reminderId || !text || !reminderTime || delay <= 0) {
        return;
      }

      if (reminders.has(reminderId)) {
        clearTimeout(reminders.get(reminderId).timeoutId);
      }

      const timeoutId = setTimeout(() => {
        notifyReminder({
          id: reminderId,
          text,
          reminderTime,
          title: "Напоминание"
        });
        reminders.delete(reminderId);
      }, delay);

      reminders.set(reminderId, { timeoutId, text, reminderTime });
      broadcast("reminderScheduled", { id: reminderId, text, reminderTime });
    });
  });
}

function broadcast(eventName, payload) {
  socketServers.forEach((server) => {
    server.emit(eventName, payload);
  });
}

async function sendPushNotification(payload) {
  if (subscriptions.size === 0) {
    return;
  }

  const pending = Array.from(subscriptions.values()).map(async (subscription) => {
    try {
      await webPush.sendNotification(subscription, JSON.stringify(payload));
    } catch (error) {
      const statusCode = error?.statusCode;
      if (statusCode === 404 || statusCode === 410) {
        subscriptions.delete(subscription.endpoint);
      } else {
        console.error("Push notification failed:", error.message || error);
      }
    }
  });

  await Promise.allSettled(pending);
}

httpServer.listen(PORT, () => {
  console.log(`TaskFlow HTTP server is running on http://localhost:${PORT}`);
});

const certPath = path.join(__dirname, "localhost.pem");
const keyPath = path.join(__dirname, "localhost-key.pem");

if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
  const httpsServer = https.createServer(
    {
      cert: fs.readFileSync(certPath),
      key: fs.readFileSync(keyPath)
    },
    app
  );

  const ioHttps = new Server(httpsServer);
  socketServers.push(ioHttps);
  attachSocketHandlers(ioHttps);

  httpsServer.listen(HTTPS_PORT, () => {
    console.log(`TaskFlow HTTPS server is running on https://localhost:${HTTPS_PORT}`);
  });
} else {
  console.log("HTTPS certificates not found. Add localhost.pem and localhost-key.pem to enable local HTTPS.");
}
