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

// Инициализация бота и Gemini
const bot = new Telegraf(process.env.BOT_TOKEN);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// Вспомогательная функция: скачать файл из Telegram
async function downloadFile(fileId, fileExt) {
  try {
    const fileLink = await bot.telegram.getFileLink(fileId);
    const url = fileLink.href;
    const tempDir = os.tmpdir();
    const filePath = path.join(tempDir, `${fileId}.${fileExt}`);
    const writer = createWriteStream(filePath);
    const response = await axios({ url, method: 'GET', responseType: 'stream' });
    await pipeline(response.data, writer);
    return filePath;
  } catch (error) {
    console.error('Ошибка скачивания файла:', error);
    throw error;
  }
}

// Вспомогательная функция: прочитать файл и закодировать в base64
function fileToBase64(filePath) {
  const data = fs.readFileSync(filePath);
  return data.toString('base64');
}

// КОМАНДА /start
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

// Обработка текстовых сообщений
bot.on('text', async (ctx) => {
  const userText = ctx.message.text;

  // Если нажали кнопку
  if (userText === 'Получить консультацию') {
    ctx.reply('Опишите ваши симптомы, задайте вопрос или загрузите анализ (фото, документ, голос).');
    return;
  }

  try {
    // Отправляем текст в Gemini
    const result = await model.generateContent(userText);
    const response = result.response.text();
    ctx.reply(response);
  } catch (error) {
    console.error('Ошибка Gemini:', error);
    ctx.reply('❌ Ошибка при обращении к AI. Пожалуйста, попробуйте позже.');
  }
});

// Обработка ФОТОГРАФИЙ
bot.on('photo', async (ctx) => {
  try {
    const photo = ctx.message.photo.pop();
    const fileId = photo.file_id;
    
    await ctx.reply('📸 Получил фото, обрабатываю...');
    
    const filePath = await downloadFile(fileId, 'jpg');
    const base64Image = fileToBase64(filePath);

    const prompt = "Ты – опытный врач-терапевт. Расшифруй этот медицинский анализ или опиши, что видно на изображении. Если это не медицинское изображение, просто сообщи, что на нём изображено.";
    const imagePart = {
      inlineData: {
        data: base64Image,
        mimeType: "image/jpeg"
      }
    };

    const result = await model.generateContent([prompt, imagePart]);
    const response = result.response.text();
    
    await ctx.reply(response);
    fs.unlinkSync(filePath); // Удаляем временный файл
  } catch (error) {
    console.error('Ошибка обработки фото:', error);
    ctx.reply('❌ Не удалось обработать изображение. Пожалуйста, попробуйте ещё раз.');
  }
});

// Обработка ДОКУМЕНТОВ
bot.on('document', async (ctx) => {
  try {
    const doc = ctx.message.document;
    const fileId = doc.file_id;
    const mimeType = doc.mime_type;
    const fileName = doc.file_name;
    const fileExt = fileName.split('.').pop() || 'bin';
    
    await ctx.reply('📄 Получил документ, обрабатываю...');

    const filePath = await downloadFile(fileId, fileExt);
    const base64File = fileToBase64(filePath);

    const prompt = "Ты – врач. Проанализируй содержимое этого файла. Если это медицинский анализ – дай интерпретацию. Если это просто текст – ответь по существу.";
    const filePart = {
      inlineData: {
        data: base64File,
        mimeType: mimeType || "application/octet-stream"
      }
    };

    const result = await model.generateContent([prompt, filePart]);
    const response = result.response.text();
    
    await ctx.reply(response);
    fs.unlinkSync(filePath);
  } catch (error) {
    console.error('Ошибка обработки документа:', error);
    ctx.reply('❌ Ошибка при обработке документа.');
  }
});

// Обработка ГОЛОСОВЫХ СООБЩЕНИЙ
bot.on('voice', async (ctx) => {
  try {
    const voice = ctx.message.voice;
    const fileId = voice.file_id;
    
    await ctx.reply('🎤 Получил голосовое, обрабатываю...');

    const filePath = await downloadFile(fileId, 'ogg');
    const base64Audio = fileToBase64(filePath);

    const prompt = "Прослушай это голосовое сообщение и кратко перескажи, о чём оно. Если это медицинский вопрос – ответь как врач.";
    const audioPart = {
      inlineData: {
        data: base64Audio,
        mimeType: "audio/ogg"
      }
    };

    const result = await model.generateContent([prompt, audioPart]);
    const response = result.response.text();
    
    await ctx.reply(response);
    fs.unlinkSync(filePath);
  } catch (error) {
    console.error('Ошибка обработки голоса:', error);
    ctx.reply('❌ Ошибка при обработке голосового сообщения.');
  }
});

// Экспорт для Vercel
module.exports = async (req, res) => {
  try {
    await bot.handleUpdate(req.body, res);
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(200).send('');
  }
};