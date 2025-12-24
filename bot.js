require("dotenv").config();

const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs");

// .env dan o'qish
const TOKEN = process.env.TOKEN?.trim();
const ADMIN_ID = process.env.ADMIN_ID ? Number(process.env.ADMIN_ID.trim()) : null;
const SUBSCRIBE_URL = process.env.SUBSCRIBE_URL?.trim() || "https://t.me/testyabaa";

let CHANNELS = [];
if (process.env.CHANNELS && process.env.CHANNELS.trim() !== "") {
  CHANNELS = process.env.CHANNELS.split(",")
    .map(ch => ch.trim())
    .filter(ch => ch.startsWith("@") || !isNaN(ch));
}

if (!TOKEN || !ADMIN_ID || CHANNELS.length === 0) {
  console.error("❌ .env faylda TOKEN, ADMIN_ID yoki CHANNELS noto'g'ri yoki yo'q!");
  process.exit(1);
}

// Bot yaratish
const bot = new TelegramBot(TOKEN, {
  polling: true,
  request: {
    agentOptions: {
      keepAlive: true,
      family: 4
    }
  }
});

const DATA_FILE = "posts.json";
let posts = [];

function loadPosts() {
  if (fs.existsSync(DATA_FILE)) {
    try {
      const data = fs.readFileSync(DATA_FILE, "utf-8");
      posts = JSON.parse(data);
      posts.forEach(post => {
        post.likedUsers = new Set(post.likedUsers || []);
        post.messageIds = post.messageIds || {};
      });
      console.log(`✅ ${posts.length} ta post muvaffaqiyatli yuklandi.`);
    } catch (e) {
      console.error("❌ posts.json o'qishda xato:", e.message);
      posts = [];
    }
  } else {
    console.log("📭 posts.json fayli yo'q – yangi boshlanmoqda.");
  }
}

function savePosts() {
  try {
    const dataToSave = posts.map(post => ({
      ...post,
      likedUsers: Array.from(post.likedUsers)
    }));
    fs.writeFileSync(DATA_FILE, JSON.stringify(dataToSave, null, 2));
    console.log("💾 posts.json saqlandi.");
  } catch (e) {
    console.error("❌ posts.json saqlashda xato:", e.message);
  }
}

loadPosts();

// Foydalanuvchi holati
let userState = {};

function clearUserState(userId) {
  delete userState[userId];
}

function showMainMenu(chatId) {
  bot.sendMessage(chatId, "👨‍💼 *Admin Panel*\n\nKerakli bo‘limni tanlang:", {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [
          { text: "📸 Yangi post qo'shish", callback_data: "new_post" },
          { text: "📋 Postlarni boshqarish", callback_data: "manage_posts" }
        ],
        [{ text: "📊 Statistika ko'rish", callback_data: "stats" }]
      ]
    }
  }).catch(err => console.error("❌ Menu yuborish xatosi:", err.message));
}

// /start
bot.onText(/\/start/, (msg) => {
  if (msg.from.id !== ADMIN_ID) return;
  console.log(`👤 Admin /start buyrug'i oldi: ${msg.from.id} (${msg.from.username || msg.from.first_name})`);
  clearUserState(msg.from.id);
  showMainMenu(msg.chat.id);
});

// Xatoliklarni ushlash
bot.on("polling_error", (error) => console.error(`[Polling xatosi] ${error.message}`));
bot.on("error", (error) => console.error("[Bot xatosi]:", error.message));

process.on("unhandledRejection", (reason) => console.error("Unhandled Rejection:", reason));
process.on("uncaughtException", (error) => console.error("Uncaught Exception:", error));

process.on("SIGINT", () => bot.stop("SIGINT").then(() => process.exit(0)));
process.on("SIGTERM", () => bot.stop("SIGTERM").then(() => process.exit(0)));

// Admin callbacklari
bot.on("callback_query", async (q) => {
  const userId = q.from.id;
  if (userId !== ADMIN_ID) {
    bot.answerCallbackQuery(q.id);
    return;
  }

  const data = q.data;
  console.log(`🔘 Admin callback: ${data} (User: ${userId})`);

  try {
    if (data === "new_post") {
      clearUserState(userId);
      userState[userId] = { action: "waiting_media" };
      await bot.sendMessage(userId, "📸 *Yangi post uchun rasm yoki video yuboring*\n\nBekor qilish uchun tugma:", {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: [[{ text: "❌ Bekor qilish", callback_data: "cancel" }]] }
      });

    } else if (data === "cancel") {
      clearUserState(userId);
      await bot.sendMessage(userId, "❌ Jarayon bekor qilindi.");
      showMainMenu(userId);

    } else if (data === "stats") {
      const totalPosts = posts.length;
      const totalLikes = posts.reduce((sum, p) => sum + p.likes, 0);
      await bot.sendMessage(userId, `*📊 Statistika*\n\n📸 Jami postlar: ${totalPosts}\n❤️ Jami layklar: ${totalLikes}`, {
        parse_mode: "Markdown"
      });

    } else if (data === "manage_posts") {
      if (posts.length === 0) {
        await bot.sendMessage(userId, "📭 Hozircha post yo‘q.");
        showMainMenu(userId);
        return;
      }

      const buttons = posts.slice(-10).reverse().map((post, i) => [{
        text: `${posts.length - i}. ❤️ ${post.likes} • ${new Date(Number(post.id)).toLocaleDateString("uz-UZ")}`,
        callback_data: `view_post_${post.id}`
      }]);

      buttons.push([{ text: "◀️ Orqaga", callback_data: "back_to_menu" }]);

      await bot.sendMessage(userId, "📋 *Oxirgi 10 ta post* (eng yangisi yuqorida):", {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: buttons }
      });

    } else if (data === "back_to_menu") {
      showMainMenu(userId);

    } else if (data.startsWith("view_post_")) {
      const postId = data.split("_")[2];
      const post = posts.find(p => p.id === postId);
      if (!post) return;

      const date = new Date(Number(postId)).toLocaleString("uz-UZ");
      let captionText = `*📸 Post ma'lumotlari*\n\n📅 Yuborilgan: ${date}\n❤️ Layklar: ${post.likes}\n\n${post.caption || "_Izoh yo‘q_"}`;

      if (post.type === "photo") {
        await bot.sendPhoto(userId, post.fileId, {
          caption: captionText,
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [{ text: "🗑 O‘chirish", callback_data: `delete_post_${post.id}` }],
              [{ text: "◀️ Orqaga", callback_data: "manage_posts" }]
            ]
          }
        });
      } else if (post.type === "video") {
        await bot.sendVideo(userId, post.fileId, {
          caption: captionText,
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [{ text: "🗑 O‘chirish", callback_data: `delete_post_${post.id}` }],
              [{ text: "◀️ Orqaga", callback_data: "manage_posts" }]
            ]
          }
        });
      }

    } else if (data.startsWith("delete_post_")) {
      const postId = data.split("_")[2];
      const postIndex = posts.findIndex(p => p.id === postId);
      if (postIndex === -1) return;

      const post = posts[postIndex];

      for (let [channel, messageId] of Object.entries(post.messageIds)) {
        try {
          await bot.deleteMessage(channel, messageId);
          console.log(`🗑 ${channel} dan post o'chirildi (msg_id: ${messageId})`);
        } catch (err) {
          console.error(`❌ O'chirish xatosi (${channel}):`, err.message);
        }
      }

      posts.splice(postIndex, 1);
      savePosts();

      await bot.sendMessage(userId, "🗑 Post barcha kanallardan o‘chirildi!", {
        reply_markup: { inline_keyboard: [[{ text: "◀️ Orqaga", callback_data: "manage_posts" }]] }
      });
    }
  } catch (err) {
    console.error("Admin callback xatosi:", err.message);
    bot.answerCallbackQuery(q.id, { text: "❌ Xato yuz berdi!", show_alert: true });
  }

  bot.answerCallbackQuery(q.id);
});

// LIKE TUGMASI – BATTAFSIL LOG BILAN
bot.on("callback_query", async (q) => {
  if (!q.data?.startsWith("like_")) return;

  const postId = q.data.split("_")[1];
  const post = posts.find(p => p.id === postId);
  if (!post) {
    console.log(`❌ Like bosildi, lekin post topilmadi: ${postId}`);
    bot.answerCallbackQuery(q.id, { text: "❌ Post topilmadi." });
    return;
  }

  const userId = q.from.id;
  const username = q.from.username ? `@${q.from.username}` : q.from.first_name || "Noma'lum";

  console.log(`\n❤️ LIKE BOSILDI!`);
  console.log(`👤 Foydalanuvchi: ${userId} (${username})`);
  console.log(`📸 Post ID: ${postId}`);
  console.log(`🔍 Obuna tekshiruvi boshlanmoqda... Kanallar: ${CHANNELS.join(", ")}`);

  try {
    let unsubscribedChannels = [];

    const checks = CHANNELS.map(async (channel) => {
      try {
        const member = await bot.getChatMember(channel, userId);
        console.log(`   ✅ ${channel} → Status: ${member.status}`);

        if (["member", "administrator", "creator"].includes(member.status)) {
          return null; // obuna bor
        } else {
          console.log(`   ❌ ${channel} → Obuna yo'q (status: ${member.status})`);
          return channel;
        }
      } catch (err) {
        console.error(`   ❌ ${channel} → getChatMember XATOSI: ${err.message}`);
        return channel; // xato bo'lsa obuna yo'q deb hisoblaymiz
      }
    });

    const results = await Promise.all(checks);
    unsubscribedChannels = results.filter(ch => ch !== null);

    if (unsubscribedChannels.length > 0) {
      console.log(`🚫 LIKE RAD ETILDI! Obuna bo'lmagan kanallar: ${unsubscribedChannels.join(", ")}`);

      const buttons = unsubscribedChannels.map(ch => {
        const url = ch.startsWith("@")
          ? `https://t.me/${ch.substring(1)}`
          : `https://t.me/c/${ch.replace(/^-100/, '')}`;
        return [{ text: `Obuna bo'lish ${ch}`, url }];
      });

      await bot.sendMessage(userId, "❗ Layk bosish uchun quyidagi kanal(lar)ga obuna bo‘ling:", {
        reply_markup: { inline_keyboard: buttons }
      });

      await bot.answerCallbackQuery(q.id, { text: "❌ Avval obuna bo‘ling!" });
      return;
    }

    console.log(`✅ Barcha kanallarga obuna bor!`);

    if (post.likedUsers.has(userId)) {
      console.log(`🔁 Bu foydalanuvchi allaqachon like bosgan!`);
      await bot.answerCallbackQuery(q.id, {
        text: "❗ Siz allaqachon layk bosgansiz!",
        show_alert: true
      });
      return;
    }

    post.likes++;
    post.likedUsers.add(userId);
    savePosts();

    console.log(`🎉 LIKE QO'SHILDI! Yangi layklar soni: ${post.likes}`);

    for (let [channel, msgId] of Object.entries(post.messageIds)) {
      try {
        await bot.editMessageReplyMarkup({
          inline_keyboard: [[
            { text: `❤️ Layk (${post.likes})`, callback_data: `like_${post.id}` },
            { text: "🔔 Obuna bo‘lish", url: SUBSCRIBE_URL }
          ]]
        }, { chat_id: channel, message_id: msgId });
        console.log(`   ✅ Tugma yangilandi: ${channel} (msg_id: ${msgId})`);
      } catch (err) {
        if (!err.message.includes("message not modified")) {
          console.error(`   ❌ Tugma yangilash xatosi (${channel}):`, err.message);
        }
      }
    }

    await bot.answerCallbackQuery(q.id, { text: "❤️ Laykingiz qabul qilindi!" });
    console.log(`✅ Like jarayoni muvaffaqiyatli yakunlandi.\n`);

  } catch (err) {
    console.error("💥 Like jarayonida katta xato:", err);
    bot.answerCallbackQuery(q.id, { text: "❌ Xato yuz berdi!", show_alert: true });
  }
});

// Media (rasm yoki video) qabul qilish
bot.on("photo", handleMedia);
bot.on("video", handleMedia);

async function handleMedia(msg) {
  const userId = msg.from.id;
  if (userId !== ADMIN_ID) return;

  console.log(`📸 Admin media yubordi (User ID: ${userId})`);

  if (!userState[userId] || userState[userId].action !== "waiting_media") {
    bot.sendMessage(userId, "❌ Avval \"Yangi post qo'shish\" ni bosing.");
    return;
  }

  let fileId, type;
  if (msg.photo) {
    fileId = msg.photo[msg.photo.length - 1].file_id;
    type = "photo";
  } else if (msg.video) {
    fileId = msg.video.file_id;
    type = "video";
  } else {
    return;
  }

  userState[userId] = { ...userState[userId], action: "waiting_caption", fileId, type };

  bot.sendMessage(userId, "✅ Media qabul qilindi!\n\n✍️ Izoh (caption) yozing (bo‘sh qoldirsangiz ham bo‘ladi):", {
    parse_mode: "Markdown",
    reply_markup: { inline_keyboard: [[{ text: "❌ Bekor qilish", callback_data: "cancel" }]] }
  });
}

// Caption va post yuborish
bot.on("text", async (msg) => {
  const userId = msg.from.id;
  if (userId !== ADMIN_ID || msg.text.startsWith("/")) return;

  if (!userState[userId] || userState[userId].action !== "waiting_caption") return;

  const caption = msg.text.trim() || undefined;
  const fileId = userState[userId].fileId;
  const type = userState[userId].type;
  clearUserState(userId);

  console.log(`📝 Admin post yaratmoqda. Caption: ${caption ? caption.substring(0, 50) : "yo'q"}`);

  const post = {
    id: Date.now().toString(),
    fileId: fileId,
    type: type,
    caption: caption,
    likes: 0,
    likedUsers: new Set(),
    messageIds: {}
  };
  posts.push(post);

  let successCount = 0;
  for (let channel of CHANNELS) {
    try {
      let sent;
      const options = {
        caption: caption,
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [[
            { text: "❤️ Layk (0)", callback_data: `like_${post.id}` },
            { text: "🔔 Obuna bo‘lish", url: SUBSCRIBE_URL }
          ]]
        }
      };

      if (type === "photo") {
        sent = await bot.sendPhoto(channel, fileId, options);
      } else if (type === "video") {
        sent = await bot.sendVideo(channel, fileId, options);
      }

      post.messageIds[channel] = sent.message_id;
      successCount++;
      console.log(`   ✅ ${channel} ga post yuborildi (msg_id: ${sent.message_id})`);
    } catch (err) {
      console.error(`   ❌ ${channel} ga yuborish xatosi:`, err.message);
      await bot.sendMessage(ADMIN_ID, `❌ ${channel} ga post yuborilmadi:\n${err.message}`);
    }
  }

  savePosts();
  console.log(`✅ Post ${successCount}/${CHANNELS.length} ta kanalga yuborildi!`);

  await bot.sendMessage(ADMIN_ID, `✅ Post ${successCount}/${CHANNELS.length} ta kanalga yuborildi!`, {
    reply_markup: { inline_keyboard: [[{ text: "📸 Yana post qo'shish", callback_data: "new_post" }]] }
  });
  showMainMenu(ADMIN_ID);
});

// Bot ishga tushdi
console.log("🤖 Bot muvaffaqiyatli ishga tushdi!");
console.log(`👤 Admin ID: ${ADMIN_ID}`);
console.log(`📢 Kanallar: ${CHANNELS.join(", ")}`);
console.log(`🔔 Obuna linki: ${SUBSCRIBE_URL}`);
showMainMenu(ADMIN_ID);