const { Telegraf } = require('telegraf');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createWriteStream } = require('fs');
const { promisify } = require('util');
const stream = require('stream');

const pipeline = promisify(stream.pipeline);

// ================= ИНИЦИАЛИЗАЦИЯ =================
const bot = new Telegraf(process.env.BOT_TOKEN);

// Проверка ключа Gemini
if (!process.env.GEMINI_API_KEY) {
  console.error('❌ GEMINI_API_KEY не найден в переменных окружения');
} else {
  console.log('✅ GEMINI_API_KEY загружен');
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Пробуем разные модели (на случай, если одна недоступна)
const models = [
  "gemini-1.5-flash",
  "gemini-1.5-pro",
  "gemini-pro"
];

let model = null;
let modelIndex = 0;

// ================= ФУНКЦИИ =================
async function downloadFile(fileId, fileExt) {
  const fileLink = await bot.telegram.getFileLink(fileId);
  const url = fileLink.href;
  const tempDir = os.tmpdir();
  const filePath = path.join(tempDir, `${fileId}.${fileExt}`);
  const writer = createWriteStream(filePath);
  const response = await axios({ url, method: 'GET', responseType: 'stream' });
  await pipeline(response.data, writer);
  return filePath;
}

function fileToBase64(filePath) {
  const data = fs.readFileSync(filePath);
  return data.toString('base64');
}

// Функция для отправки в Gemini с выбором модели
async function askGemini(prompt, parts = []) {
  let lastError = null;

  for (let i = modelIndex; i < models.length; i++) {
    try {
      console.log(`🔄 Пробуем модель: ${models[i]}`);
      const currentModel = genAI.getGenerativeModel({ model: models[i] });
      
      let result;
      if (parts.length > 0) {
        result = await currentModel.generateContent([prompt, ...parts]);
      } else {
        result = await currentModel.generateContent(prompt);
      }
      
      // Если успешно — запоминаем рабочую модель
      modelIndex = i;
      console.log(`✅ Модель ${models[i]} работает`);
      return result.response.text();
    } catch (error) {
      console.log(`❌ Модель ${models[i]} не работает:`, error.message);
      lastError = error;
      // Пробуем следующую
    }
  }

  throw lastError || new Error('Все модели Gemini недоступны');
}

// ================= ОБРАБОТЧИКИ =================
bot.start((ctx) => {
  ctx.reply(
    '👋 Добро пожаловать! Я – ваш виртуальный терапевт на базе Gemini.\n' +
    'Я могу помочь с вопросами о здоровье, расшифровать анализы (фото, PDF, голос).\n' +
    '⚠️ ВНИМАНИЕ: я не заменяю настоящего врача! При серьёзных симптомах обратитесь к специалисту.',
    {
      reply_markup: {
        keyboard: [[{ text: 'Получить консультацию' }]],
        resize_keyboard: true,
        one_time_keyboard: true
      }
    }
  );
});

bot.on('text', async (ctx) => {
  const userText = ctx.message.text;

  if (userText === 'Получить консультацию') {
    ctx.reply('Опишите ваши симптомы, задайте вопрос или загрузите анализ (фото, документ, голос).');
    return;
  }

  try {
    // Проверка ключа
    if (!process.env.GEMINI_API_KEY) {
      return ctx.reply('❌ Ошибка: API ключ Gemini не найден на сервере');
    }

    await ctx.reply('⏳ Думаю...');

    const response = await askGemini(userText);
    ctx.reply(response);
    
  } catch (error) {
    console.error('❌ Ошибка Gemini:', error);
    
    let errorMessage = '❌ Ошибка при обращении к AI.';
    
    if (error.message?.includes('API key')) {
      errorMessage = '❌ Неверный API ключ Gemini. Проверьте настройки.';
    } else if (error.message?.includes('quota')) {
      errorMessage = '❌ Превышен лимит запросов к Gemini. Попробуйте позже.';
    } else if (error.message?.includes('models')) {
      errorMessage = '❌ Модели Gemini временно недоступны. Попробуйте позже.';
    }
    
    ctx.reply(errorMessage);
  }
});

// ================= ЭКСПОРТ =================
module.exports = async (req, res) => {
  try {
    await bot.handleUpdate(req.body, res);
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(200).send('');
  }
};