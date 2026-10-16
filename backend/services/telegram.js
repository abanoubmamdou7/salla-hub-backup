import axios from 'axios';

async function send(tenantCreds, text) {
  const botToken = tenantCreds?.telegramBotToken || '';
  const chatId   = tenantCreds?.telegramChatId   || '';
  if (!botToken || !chatId) return;
  try {
    await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      chat_id:    chatId,
      text,
      parse_mode: 'HTML',
    }, { timeout: 10000 });
  } catch (err) {
    console.warn(`[telegram] Failed to send: ${err.message}`);
  }
}

function fmt(date) {
  if (!date) return '—';
  return new Date(date).toLocaleString('en-GB', {
    timeZone: 'Asia/Riyadh',
    hour12: false,
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function durationSec(from, to) {
  if (!from || !to) return '—';
  const sec = Math.round((new Date(to) - new Date(from)) / 1000);
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

function formatPlayerId(playerId) {
  if (!playerId || playerId === '(none)' || playerId === 'none' || playerId === '1') {
    return '⚠️ فشل استلام رقم اللاعب من سلة';
  }
  return `<code>${playerId}</code>`;
}

export async function notifyOrderTimeline({
  orderId, refId, customer, total, currency, playerId, coins,
  sallaCreatedAt, detectedAt, masaSentAt, masaRepliedAt,
  status, providerRef, error, draftSent,
}, tenantCreds) {
  const icon = status === 'success' ? '✅' : '❌';
  const label = status === 'success' ? 'نجح' : 'فشل';

  const msg =
`${icon} <b>تفاصيل الطلب — ${label}</b>

📋 <b>رقم الطلب:</b>  <code>${orderId}</code>
🔖 <b>المرجع:</b> <code>${refId}</code>
👤 <b>العميل:</b>  ${customer ?? '—'}
💰 <b>الإجمالي:</b>  ${total ?? '?'} ${currency ?? ''}
🎮 <b>رقم اللاعب:</b> ${formatPlayerId(playerId)}
💎 <b>الكوينز:</b>   ${coins ?? '—'}

━━━━━━━━━━━━━━━━━━━━━━━━
⏱ <b>التسلسل الزمني (توقيت الرياض)</b>
━━━━━━━━━━━━━━━━━━━━━━━━

🛒 <b>١. أنشأت سلة الطلب</b>
     ${fmt(sallaCreatedAt)}

📥 <b>٢. استلمناه</b>
     ${fmt(detectedAt)}
     <i>(+${durationSec(sallaCreatedAt, detectedAt)} بعد سلة)</i>

🚀 <b>٣. أُرسل إلى المورد</b>
     ${fmt(masaSentAt)}
     <i>(+${durationSec(detectedAt, masaSentAt)} بعد الاستلام)</i>

📬 <b>٤. رد المورد</b>
     ${fmt(masaRepliedAt)}
     <i>(+${durationSec(masaSentAt, masaRepliedAt)} للمعالجة)</i>

━━━━━━━━━━━━━━━━━━━━━━━━
⚡ <b>المدة الإجمالية:</b> ${durationSec(sallaCreatedAt, masaRepliedAt)}
━━━━━━━━━━━━━━━━━━━━━━━━
${status === 'success'
  ? `\n🔗 <b>رقم مرجع المزود:</b> <code>${providerRef ?? '—'}</code>`
  : `\n💥 <b>الخطأ:</b> ${error ?? '—'}\n📋 <b>المسودة:</b> ${draftSent ? '✅ أُرسلت للتنفيذ اليدوي' : '❌ فشل الإرسال'}`
}`;

  return send(tenantCreds, msg);
}

export function notifyNewOrder({ orderId, refId, customer, total, currency, playerId, sallaTime, detectedTime, delaySec, orderBody }, tenantCreds) {
  const msg =
`🆕 <b>طلب جديد</b>

📋 <b>رقم الطلب:</b>  <code>${orderId}</code>
🔖 <b>المرجع:</b> <code>${refId}</code>
👤 <b>العميل:</b>  ${customer}
💰 <b>الإجمالي:</b>  ${total} ${currency}
🎮 <b>رقم اللاعب:</b> ${formatPlayerId(playerId)}

⏱ <b>وقت الإنشاء:</b>  ${sallaTime} <i>(سلة)</i>
⏱ <b>وقت الاكتشاف:</b> ${detectedTime} <i>(نحن)</i>
⚡ <b>التأخير:</b>       ${delaySec} ثانية

📦 <b>بيانات الطلب:</b>
<pre>${JSON.stringify(orderBody, null, 2)}</pre>`;

  return send(tenantCreds, msg);
}

export function notifyOrderSuccess({ orderId, refId, providerRef, totalSec }, tenantCreds) {
  const msg =
`✅ <b>تم إرسال الطلب بنجاح</b>

📋 <b>الطلب:</b> <code>${orderId}</code> (مرجع: <code>${refId}</code>)
🔗 <b>رقم مرجع المزود:</b> <code>${providerRef}</code>
⏱ <b>الوقت الإجمالي:</b> ${totalSec} ثانية من سلة`;

  return send(tenantCreds, msg);
}

export function notifyOrderFailed({ orderId, refId, error, sentToHub, missingPlayerId, optionsSeen }, tenantCreds) {
  // Highlight the most common operational cause — a missing player ID — with a
  // clear manual-fix instruction and the raw fields we received from Salla.
  const playerIdBlock = missingPlayerId
    ? `\n\n⚠️ <b>السبب: رقم اللاعب مفقود</b> — لم نستطع استخراجه من الطلب.
🧾 <b>الحقول الموجودة في الطلب:</b>
<pre>${optionsSeen?.length ? optionsSeen.join('\n') : '(لا توجد خيارات في الـ payload)'}</pre>
🛠 <b>المطلوب:</b> افتح المسودة عند المورد، أدخل رقم اللاعب الصحيح، ونفّذ يدوياً.`
    : '';

  const msg =
`❌ <b>فشل الطلب</b>

📋 <b>الطلب:</b> <code>${orderId}</code> (مرجع: <code>${refId}</code>)
💥 <b>الخطأ:</b> ${error}
📋 <b>المسودة:</b> ${sentToHub ? '✅ أُرسلت للتنفيذ اليدوي' : '❌ فشل إرسال المسودة'}${playerIdBlock}`;

  return send(tenantCreds, msg);
}

export function notifyUnknownProduct({ orderId, refId, productName }, tenantCreds) {
  const msg =
`⚠️ <b>فشل في التعرف على المنتج</b>

📋 <b>رقم الطلب:</b> <code>${orderId}</code>
🔖 <b>المرجع:</b> <code>${refId ?? '—'}</code>
📦 <b>اسم المنتج:</b> ${productName ?? '—'}

❌ لم يتم التعرف على البراند — الطلب متوقف ولم يُرسل للمورد
🔧 أضف الكلمة المفتاحية في <b>brand_mappings</b> لمعالجة هذا المنتج`;

  return send(tenantCreds, msg);
}

export async function notifyOrderRetry({ orderId, refId, customer, total, currency, coins, error, optionsSeen }, tenantCreds) {
  const optionsBlock = optionsSeen?.length
    ? `\n🧾 <b>الحقول الموجودة في الطلب:</b>\n<pre>${optionsSeen.join('\n')}</pre>`
    : '\n🧾 <b>الحقول الموجودة في الطلب:</b> (لا توجد خيارات في الـ payload)';

  const msg =
`🔄 <b>إعادة محاولة الأوردر</b>

📋 <b>رقم الأوردر:</b>  <code>${orderId}</code>
🔖 <b>المرجع:</b> <code>${refId ?? '—'}</code>
👤 <b>العميل:</b>  ${customer ?? '—'}
💰 <b>الإجمالي:</b>  ${total ?? '?'} ${currency ?? ''}
💎 <b>الكوينز:</b>   ${coins ?? '—'}
🎮 <b>رقم اللاعب:</b> ⚠️ فشل استلام رقم اللاعب من سلة
${optionsBlock}

━━━━━━━━━━━━━━━━━━━━━━━━
💥 <b>سبب الفشل:</b> ${error ?? '—'}
━━━━━━━━━━━━━━━━━━━━━━━━

⏳ جاري إعادة المحاولة بعد 5 ثوانٍ...`;

  return send(tenantCreds, msg);
}
