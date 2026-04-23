const STORAGE_KEY = "taskflow-offline-tasks";

const networkStatus = document.querySelector("#networkStatus");
const secureStatus = document.querySelector("#secureStatus");
const socketStatus = document.querySelector("#socketStatus");
const toastRegion = document.querySelector("#toastRegion");
const appShell = document.querySelector(".app-shell");

const taskForm = document.querySelector("#taskForm");
const taskInput = document.querySelector("#taskInput");
const reminderForm = document.querySelector("#reminderForm");
const reminderText = document.querySelector("#reminderText");
const reminderTime = document.querySelector("#reminderTime");
const taskList = document.querySelector("#taskList");
const emptyState = document.querySelector("#emptyState");
const taskCounter = document.querySelector("#taskCounter");
const clearDoneButton = document.querySelector("#clearDoneButton");
const subscribePushButton = document.querySelector("#subscribePushButton");
const unsubscribePushButton = document.querySelector("#unsubscribePushButton");
const filterButtons = document.querySelectorAll(".filter-button");

const contactForm = document.querySelector("#contactForm");
const contactResetButton = document.querySelector("#contactResetButton");
const contactLiveRegion = document.querySelector("#contactLiveRegion");
const contactModalShell = document.querySelector("#contactModalShell");
const contactModal = document.querySelector("#contactModal");
const contactModalClose = document.querySelector("#contactModalClose");
const contactModalConfirm = document.querySelector("#contactModalConfirm");

let tasks = normalizeTasks(loadTasks());
let currentFilter = "all";
let socket = null;
let vapidPublicKey = "";
let previousModalFocus = null;

const contactValidationMessages = {
  name: "Введите имя, чтобы мы понимали, как к вам обращаться.",
  email: "Укажите корректный email для ответа.",
  topic: "Выберите тему обращения.",
  message: "Введите сообщение, чтобы форма могла быть отправлена.",
  consent: "Подтвердите согласие на обработку обращения."
};

updateNetworkStatus();
updateSecureStatus();
registerServiceWorker();
initSocket();
loadClientConfig();
bindPushControls();
initTaskPage();
initContactsPage();

window.addEventListener("online", updateNetworkStatus);
window.addEventListener("offline", updateNetworkStatus);

function initTaskPage() {
  if (!taskForm || !taskInput || !taskList || !emptyState || !taskCounter || !clearDoneButton) {
    return;
  }

  renderTasks();
  setReminderMinTime();

  taskForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const title = taskInput.value.trim();
    if (!title) {
      return;
    }

    const task = createTask(title);
    tasks.unshift(task);
    persistTasks();
    renderTasks();
    taskForm.reset();
    taskInput.focus();

    if (socket?.connected) {
      socket.emit("newTask", {
        id: task.id,
        text: task.title,
        title: task.title,
        timestamp: task.createdAt
      });
    }
  });

  reminderForm?.addEventListener("submit", (event) => {
    event.preventDefault();

    const title = reminderText.value.trim();
    const datetime = reminderTime.value;
    if (!title || !datetime) {
      return;
    }

    const reminderTimestamp = new Date(datetime).getTime();
    if (Number.isNaN(reminderTimestamp) || reminderTimestamp <= Date.now()) {
      showToast("Дата напоминания должна быть в будущем.");
      reminderTime.focus();
      return;
    }

    const task = createTask(title, reminderTimestamp);
    tasks.unshift(task);
    persistTasks();
    renderTasks();
    reminderForm.reset();
    setReminderMinTime();
    reminderText.focus();

    if (socket?.connected) {
      socket.emit("newReminder", {
        id: task.id,
        text: task.title,
        reminderTime: task.reminder
      });
    }
  });

  taskList.addEventListener("click", (event) => {
    const removeButton = event.target.closest("[data-action='remove']");
    if (!removeButton) {
      return;
    }

    const taskId = removeButton.dataset.id;
    tasks = tasks.filter((task) => String(task.id) !== String(taskId));
    persistTasks();
    renderTasks();
  });

  taskList.addEventListener("change", (event) => {
    const checkbox = event.target.closest("[data-action='toggle']");
    if (!checkbox) {
      return;
    }

    const taskId = checkbox.dataset.id;
    tasks = tasks.map((task) => {
      if (String(task.id) !== String(taskId)) {
        return task;
      }

      return { ...task, done: checkbox.checked };
    });

    persistTasks();
    renderTasks();
  });

  clearDoneButton.addEventListener("click", () => {
    tasks = tasks.filter((task) => !task.done);
    persistTasks();
    renderTasks();
  });

  filterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      currentFilter = button.dataset.filter;

      filterButtons.forEach((item) => {
        item.classList.toggle("active", item === button);
      });

      renderTasks();
    });
  });
}

function initContactsPage() {
  if (!contactForm) {
    return;
  }

  const fields = Array.from(contactForm.elements).filter((element) =>
    ["INPUT", "SELECT", "TEXTAREA"].includes(element.tagName)
  );

  fields.forEach((field) => {
    field.addEventListener("blur", () => {
      validateContactField(field);
    });

    field.addEventListener("input", () => {
      if (field.getAttribute("aria-invalid") === "true") {
        validateContactField(field);
      }
    });
  });

  contactForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const invalidField = fields.find((field) => !validateContactField(field));
    if (invalidField) {
      setContactStatus("Пожалуйста, исправьте ошибки в форме перед отправкой.");
      invalidField.focus();
      return;
    }

    contactForm.reset();
    fields.forEach(clearContactFieldError);
    setContactStatus("Форма успешно отправлена.");
    openContactModal();
  });

  if (contactResetButton) {
    contactResetButton.addEventListener("click", () => {
      contactForm.reset();
      fields.forEach(clearContactFieldError);
      setContactStatus("Форма очищена.");
    });
  }

  contactModalClose?.addEventListener("click", closeContactModal);
  contactModalConfirm?.addEventListener("click", closeContactModal);
  contactModalShell?.addEventListener("click", (event) => {
    if (event.target.dataset.action === "close-contact-modal") {
      closeContactModal();
    }
  });
}

function createTask(title, reminderTimestamp = null) {
  return {
    id: Date.now() + Math.floor(Math.random() * 1000),
    title,
    done: false,
    createdAt: new Date().toISOString(),
    reminder: reminderTimestamp
  };
}

function loadTasks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    console.error("Не удалось прочитать задачи из localStorage:", error);
    return [];
  }
}

function normalizeTasks(items) {
  return items.map((task, index) => ({
    id: task.id ?? Date.now() + index,
    title: task.title ?? task.text ?? "",
    done: Boolean(task.done),
    createdAt: task.createdAt ?? new Date().toISOString(),
    reminder: task.reminder ?? null
  }));
}

function persistTasks() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}

function renderTasks() {
  const visibleTasks = tasks.filter((task) => {
    if (currentFilter === "active") {
      return !task.done;
    }

    if (currentFilter === "done") {
      return task.done;
    }

    return true;
  });

  taskList.innerHTML = visibleTasks
    .map((task) => {
      const reminderInfo = task.reminder
        ? `<p class="task-reminder">Напоминание: ${formatReminder(task.reminder)}</p>`
        : "";

      return `
        <li class="task-item ${task.done ? "done" : ""}">
          <input
            class="task-toggle"
            type="checkbox"
            data-action="toggle"
            data-id="${task.id}"
            aria-label="Отметить задачу выполненной"
            ${task.done ? "checked" : ""}
          >
          <div class="task-content">
            <p class="task-title">${escapeHtml(task.title)}</p>
            <p class="task-meta">Создано: ${formatDate(task.createdAt)}</p>
            ${reminderInfo}
          </div>
          <button
            class="icon-button"
            type="button"
            data-action="remove"
            data-id="${task.id}"
            aria-label="Удалить задачу"
          >
            ×
          </button>
        </li>
      `;
    })
    .join("");

  const hasVisibleTasks = visibleTasks.length > 0;
  emptyState.classList.toggle("visible", !hasVisibleTasks);
  taskCounter.textContent = makeCounterText(tasks.length);
}

function makeCounterText(count) {
  const word =
    count % 10 === 1 && count % 100 !== 11
      ? "заметка"
      : [2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100)
        ? "заметки"
        : "заметок";

  return `${count} ${word}`;
}

function formatDate(isoDate) {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(isoDate));
}

function formatReminder(timestamp) {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(timestamp));
}

function setReminderMinTime() {
  if (!reminderTime) {
    return;
  }

  const nextMinute = new Date(Date.now() + 60000);
  const isoLocal = new Date(nextMinute.getTime() - nextMinute.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
  reminderTime.min = isoLocal;
}

function updateNetworkStatus() {
  if (!networkStatus) {
    return;
  }

  const offline = !navigator.onLine;
  networkStatus.textContent = offline ? "Офлайн-режим активен" : "Соединение есть";
  networkStatus.classList.toggle("offline", offline);
}

function updateSecureStatus() {
  if (!secureStatus) {
    return;
  }

  const secureContext = window.isSecureContext || location.hostname === "localhost" || location.hostname === "127.0.0.1";
  const protocolLabel = location.protocol === "https:" ? "HTTPS активен" : "HTTP/localhost режим";
  secureStatus.textContent = secureContext ? protocolLabel : "Нужен HTTPS или localhost";
  secureStatus.classList.toggle("offline", !secureContext);
}

function updateSocketStatus(connected) {
  if (!socketStatus) {
    return;
  }

  socketStatus.textContent = connected ? "Socket.IO: подключено" : "Socket.IO: нет соединения";
  socketStatus.classList.toggle("offline", !connected);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  window.addEventListener("load", async () => {
    try {
      await navigator.serviceWorker.register("./sw.js");
      await updatePushButtons();
    } catch (error) {
      console.error("Не удалось зарегистрировать Service Worker:", error);
    }
  });
}

function initSocket() {
  if (typeof io === "undefined") {
    updateSocketStatus(false);
    return;
  }

  socket = io();

  socket.on("connect", () => {
    updateSocketStatus(true);
  });

  socket.on("disconnect", () => {
    updateSocketStatus(false);
  });

  socket.on("taskAdded", (payload) => {
    const title = payload?.title || payload?.text;
    if (!title) {
      return;
    }

    const prefix = payload.source === "system" ? "" : "Сервер: ";
    showToast(`${prefix}${title}`);
  });

  socket.on("reminderScheduled", (payload) => {
    if (!payload?.text) {
      return;
    }

    showToast(`Напоминание запланировано: ${payload.text}`);
  });
}

async function loadClientConfig() {
  try {
    const response = await fetch("/api/config");
    const data = await response.json();
    vapidPublicKey = data.vapidPublicKey;
  } catch (error) {
    console.error("Не удалось загрузить конфигурацию клиента:", error);
  }
}

function bindPushControls() {
  if (subscribePushButton) {
    subscribePushButton.addEventListener("click", async () => {
      await subscribeToPush();
    });
  }

  if (unsubscribePushButton) {
    unsubscribePushButton.addEventListener("click", async () => {
      await unsubscribeFromPush();
    });
  }
}

async function subscribeToPush() {
  try {
    const registration = await getServiceWorkerRegistration();
    if (!registration || !vapidPublicKey) {
      showToast("Сначала дождитесь инициализации Service Worker и конфигурации.");
      return;
    }

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      showToast("Разрешение на уведомления не выдано.");
      return;
    }

    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
      });
    }

    await fetch("/subscribe", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(subscription)
    });

    await updatePushButtons();
    showToast("Push-уведомления включены.");
  } catch (error) {
    console.error("Ошибка подписки на push:", error);
    showToast("Не удалось включить push-уведомления.");
  }
}

async function unsubscribeFromPush() {
  try {
    const registration = await getServiceWorkerRegistration();
    if (!registration) {
      return;
    }

    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      await updatePushButtons();
      showToast("Подписка уже отключена.");
      return;
    }

    await fetch("/unsubscribe", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        endpoint: subscription.endpoint
      })
    });

    await subscription.unsubscribe();
    await updatePushButtons();
    showToast("Push-уведомления отключены.");
  } catch (error) {
    console.error("Ошибка отписки от push:", error);
    showToast("Не удалось отключить push-уведомления.");
  }
}

async function updatePushButtons() {
  if (!subscribePushButton || !unsubscribePushButton || !("serviceWorker" in navigator)) {
    return;
  }

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  const isSubscribed = Boolean(subscription);

  subscribePushButton.disabled = isSubscribed;
  unsubscribePushButton.disabled = !isSubscribed;
}

async function getServiceWorkerRegistration() {
  if (!("serviceWorker" in navigator)) {
    return null;
  }

  return navigator.serviceWorker.ready;
}

function validateContactField(field) {
  if (!field.name) {
    return true;
  }

  let isValid = true;
  let message = "";

  if (field.type === "checkbox") {
    isValid = field.checked;
    if (!isValid) {
      message = contactValidationMessages[field.name];
    }
  } else if (field.validity.valueMissing) {
    isValid = false;
    message = contactValidationMessages[field.name];
  } else if (field.validity.typeMismatch) {
    isValid = false;
    message = contactValidationMessages[field.name];
  }

  if (!isValid) {
    setContactFieldError(field, message);
  } else {
    clearContactFieldError(field);
  }

  return isValid;
}

function setContactFieldError(field, message) {
  field.setAttribute("aria-invalid", "true");
  const errorElement = document.querySelector(`#${field.id}Error`);
  if (errorElement) {
    errorElement.hidden = false;
    errorElement.textContent = message;
  }
}

function clearContactFieldError(field) {
  field.removeAttribute("aria-invalid");
  const errorElement = document.querySelector(`#${field.id}Error`);
  if (errorElement) {
    errorElement.hidden = true;
    errorElement.textContent = "";
  }
}

function setContactStatus(message) {
  if (contactLiveRegion) {
    contactLiveRegion.textContent = message;
    contactLiveRegion.classList.toggle("visible", Boolean(message));
  }
}

function openContactModal() {
  if (!contactModalShell || !contactModal) {
    return;
  }

  previousModalFocus = document.activeElement;
  contactModalShell.hidden = false;
  document.body.classList.add("modal-open");
  appShell?.setAttribute("aria-hidden", "true");
  toastRegion?.setAttribute("aria-hidden", "true");
  contactModal.focus();
  document.addEventListener("keydown", handleContactModalKeydown);
}

function closeContactModal() {
  if (!contactModalShell) {
    return;
  }

  contactModalShell.hidden = true;
  document.body.classList.remove("modal-open");
  appShell?.removeAttribute("aria-hidden");
  toastRegion?.removeAttribute("aria-hidden");
  document.removeEventListener("keydown", handleContactModalKeydown);

  if (previousModalFocus instanceof HTMLElement) {
    previousModalFocus.focus();
  }
}

function handleContactModalKeydown(event) {
  if (event.key === "Escape") {
    event.preventDefault();
    closeContactModal();
    return;
  }

  if (event.key !== "Tab" || !contactModal) {
    return;
  }

  const focusable = contactModal.querySelectorAll(
    "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"
  );
  const firstElement = focusable[0];
  const lastElement = focusable[focusable.length - 1];

  if (!firstElement || !lastElement) {
    return;
  }

  if (event.shiftKey && document.activeElement === firstElement) {
    event.preventDefault();
    lastElement.focus();
  } else if (!event.shiftKey && document.activeElement === lastElement) {
    event.preventDefault();
    firstElement.focus();
  }
}

function showToast(message) {
  if (!toastRegion) {
    return;
  }

  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  toastRegion.append(toast);

  window.setTimeout(() => {
    toast.classList.add("toast-out");
  }, 2500);

  window.setTimeout(() => {
    toast.remove();
  }, 3200);
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replaceAll("-", "+")
    .replaceAll("_", "/");

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let index = 0; index < rawData.length; index += 1) {
    outputArray[index] = rawData.charCodeAt(index);
  }

  return outputArray;
}
