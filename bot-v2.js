require('dotenv').config();

const fs = require("fs");
const path = require("path");
const express = require("express");

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandBuilder,
  REST,
  Routes
} = require("discord.js");

const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  StreamType,
  entersState,
  VoiceConnectionStatus
} = require("@discordjs/voice");

// ===============================
// CONFIGURACIÓN
// ===============================

const CONFIG = {
  TOKEN: process.env.DISCORD_BOT_TOKEN,

  WAITING_CHANNEL_ID: process.env.WAITING_CHANNEL_ID,
  STAFF_AVAILABLE_CHANNEL_ID: process.env.STAFF_AVAILABLE_CHANNEL_ID,
  STAFF_BUSY_CHANNEL_ID: process.env.STAFF_BUSY_CHANNEL_ID,
  STAFF_TEXT_CHANNEL_ID: process.env.STAFF_TEXT_CHANNEL_ID,
  REVIEW_CHANNEL_ID: process.env.REVIEW_CHANNEL_ID || "1423880600422711377",

  SUPPORT_CHANNELS: process.env.SUPPORT_CHANNELS?.split(',').map(id => id.trim()) || [],
  STAFF_ROLES: process.env.STAFF_ROLES?.split(',').map(id => id.trim()) || [],
  VIP_ROLES: process.env.VIP_ROLES?.split(',').map(id => id.trim()) || [],
  DONATOR_ROLES: process.env.DONATOR_ROLES?.split(',').map(id => id.trim()) || [],

  AUDIO_FILES: {
    WELCOME_MUSIC: "./musica_espera.mp3",
    VOICE_WAITING: "./voz_atendiendo.mp3",
    VOICE_NO_STAFF: "./voz_no_disponible.mp3",
    VOICE_VIP: "./voz_vip.mp3"
  },

  MUSIC_INTRO: 8000,
  MUSIC_BETWEEN_VOICES: 15000,
  MUSIC_CYCLE_BASE: 25000,
  MUSIC_CYCLE_INCREMENT: 8000,
  MAX_MUSIC_DURATION: 50000,
  TRANSITION_BUFFER: 600,

  TIME_BEFORE_ASSIGN: 5000,
  QUEUE_UPDATE_INTERVAL: 10000,
  NO_STAFF_WARNING_TIME: 180000,
  STAFF_UNAVAILABLE_WARNING_TIME: 1800000,
  USER_QUEUE_TIMEOUT: 600000,
  ANTI_SPAM_COOLDOWN: 15000,

  AVERAGE_SUPPORT_TIME: 3,
  DATA_FILE: "./data.json"
};

// ===============================
// PERSISTENCIA JSON
// ===============================

function loadData() {
  try {
    if (fs.existsSync(CONFIG.DATA_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG.DATA_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('⚠️ Error cargando data.json:', e.message);
  }
  return { ticketHistory: [], staffStats: {} };
}

function saveData() {
  try {
    fs.writeFileSync(CONFIG.DATA_FILE, JSON.stringify(persistData, null, 2));
  } catch (e) {
    console.error('⚠️ Error guardando data.json:', e.message);
  }
}

const persistData = loadData();

// ===============================
// ESTADO DEL BOT
// ===============================

const botState = {
  activeConnections: new Map(),
  currentPlayers: new Map(),
  cycleRunning: new Map(),

  queue: [],
  activeSupport: new Map(),
  userDMMessages: new Map(),

  lastStaffNotification: new Map(),
  staffUnavailableTimers: new Map(),
  noStaffWarnings: new Map(),
  queueTimeouts: new Map(),
  antiSpamMap: new Map(),
};

// ===============================
// DISCORD CLIENT
// ===============================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

// ===============================
// WEB SERVER
// ===============================

const app = express();
app.get("/", (req, res) => res.send("✅ El Patio RP - Call Center V5.1 AUDIO FIX"));
app.get("/stats", (req, res) => res.json({
  queue: botState.queue.length,
  activeSupport: botState.activeSupport.size,
  ticketsTotal: persistData.ticketHistory.length,
  uptime: Math.floor(process.uptime())
}));
app.listen(3000, () => console.log("🌐 Web activa en puerto 3000"));

// ===============================
// COMANDOS SLASH
// ===============================

const commands = [
  new SlashCommandBuilder()
    .setName('descanso')
    .setDescription('Tomar un descanso temporal del soporte')
    .addIntegerOption(opt =>
      opt.setName('minutos').setDescription('Duración (máx 60)').setRequired(true).setMinValue(1).setMaxValue(60)
    ),
  new SlashCommandBuilder().setName('volver').setDescription('Volver al servicio de soporte'),
  new SlashCommandBuilder().setName('estadisticas').setDescription('Ver estadísticas del sistema'),
  new SlashCommandBuilder().setName('cola').setDescription('Ver estado actual de la cola'),
  new SlashCommandBuilder().setName('ticket').setDescription('Ver el estado de tu ticket actual'),
  new SlashCommandBuilder().setName('misresenas').setDescription('Ver tus estadísticas de reseñas (staff)'),
  new SlashCommandBuilder()
    .setName('historial')
    .setDescription('Ver historial de tickets recientes (staff)')
    .addIntegerOption(opt =>
      opt.setName('cantidad').setDescription('Cantidad a mostrar (máx 20)').setRequired(false).setMinValue(1).setMaxValue(20)
    ),
].map(cmd => cmd.toJSON());

// ===============================
// UTILIDADES
// ===============================

const isStaff    = m => m.roles.cache.some(r => CONFIG.STAFF_ROLES.includes(r.id));
const isVIP      = m => m.roles.cache.some(r => CONFIG.VIP_ROLES.includes(r.id));
const isDonator  = m => m.roles.cache.some(r => CONFIG.DONATOR_ROLES.includes(r.id));

function getUserPriority(member) {
  if (isVIP(member)) return 3;
  if (isDonator(member)) return 2;
  return 1;
}

function generateTicketId() {
  const d = new Date();
  const date = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  return `PATIO-${date}-${Math.random().toString(36).substr(2,6).toUpperCase()}`;
}

const wait            = ms => new Promise(r => setTimeout(r, ms));
const getWaitingTime  = e  => Math.floor((Date.now() - e.joinTime) / 60000);
const getEstimatedTime = p => Math.max(1, p * CONFIG.AVERAGE_SUPPORT_TIME);

// ===============================
// SEND DM SEGURO
// ===============================

async function sendDMSafe(user, options) {
  try {
    const dm = await user.createDM();
    return await dm.send(options);
  } catch (err) {
    if (err.code === 50007 || err.message?.includes('Cannot send messages')) {
      console.log(`⚠️ DM bloqueado por ${user.username}, saltando...`);
    } else {
      console.error(`❌ Error DM a ${user.username}:`, err.message);
    }
    return null;
  }
}

// ===============================
// ANTI-SPAM
// ===============================

function isSpamming(userId) {
  const last = botState.antiSpamMap.get(userId);
  return last && (Date.now() - last) < CONFIG.ANTI_SPAM_COOLDOWN;
}
function markEntry(userId) {
  botState.antiSpamMap.set(userId, Date.now());
}

// ===============================
// SISTEMA DE COLA
// ===============================

function addToQueue(member) {
  if (botState.queue.find(e => e.userId === member.id)) return null;

  const priority = getUserPriority(member);
  const ticketId = generateTicketId();
  const entry = { userId: member.id, member, joinTime: Date.now(), priority, ticketId, guildId: member.guild.id };

  const insertIndex = botState.queue.findIndex(e => e.priority < priority);
  if (insertIndex === -1) botState.queue.push(entry);
  else botState.queue.splice(insertIndex, 0, entry);

  console.log(`📋 ${member.user.username} en cola (Ticket: ${ticketId}, Prioridad: ${priority})`);

  botState.noStaffWarnings.set(member.id, setTimeout(() => sendNoStaffWarning(member.guild, entry), CONFIG.NO_STAFF_WARNING_TIME));

  botState.queueTimeouts.set(member.id, setTimeout(async () => {
    if (!botState.queue.find(e => e.userId === member.id)) return;
    console.log(`⏰ Timeout de cola para ${member.user.username}`);
    removeFromQueue(member.id);
    const embed = new EmbedBuilder()
      .setColor('#FF6600').setTitle('⏰ Tiempo de espera agotado')
      .setDescription('Has sido removido de la cola por tiempo prolongado sin staff disponible.\n\n**Puedes volver a unirte cuando quieras.**')
      .addFields({ name: '🎫 Ticket', value: ticketId, inline: true })
      .setTimestamp();
    await sendDMSafe(member.user, { embeds: [embed] });
    try {
      const freshMember = await member.guild.members.fetch(member.id);
      if (freshMember.voice.channelId === CONFIG.WAITING_CHANNEL_ID) await freshMember.voice.disconnect();
    } catch (_) {}
  }, CONFIG.USER_QUEUE_TIMEOUT));

  markEntry(member.id);
  return entry;
}

function removeFromQueue(userId) {
  const index = botState.queue.findIndex(e => e.userId === userId);
  if (index === -1) return null;
  const removed = botState.queue.splice(index, 1)[0];
  console.log(`📋 ${removed.member.user.username} removido de cola`);

  const warn = botState.noStaffWarnings.get(userId);
  if (warn) { clearTimeout(warn); botState.noStaffWarnings.delete(userId); }
  const timeout = botState.queueTimeouts.get(userId);
  if (timeout) { clearTimeout(timeout); botState.queueTimeouts.delete(userId); }

  return removed;
}

const getQueuePosition = userId => botState.queue.findIndex(e => e.userId === userId) + 1;

// ===============================
// ADVERTENCIA SIN STAFF
// ===============================

async function sendNoStaffWarning(guild, entry) {
  try {
    const staffChannel = guild.channels.cache.get(CONFIG.STAFF_TEXT_CHANNEL_ID);
    if (!staffChannel) return;
    const waitTime = getWaitingTime(entry);
    const embed = new EmbedBuilder()
      .setColor('#FF0000').setTitle('🚨 ALERTA: Usuario sin atender')
      .setDescription(`**${entry.member.user.username}** lleva **${waitTime} minutos** esperando`)
      .addFields(
        { name: '🎫 Ticket', value: entry.ticketId, inline: true },
        { name: '⏱️ Tiempo', value: `${waitTime} min`, inline: true },
        { name: '📍 Prioridad', value: entry.priority === 3 ? '👑 VIP' : entry.priority === 2 ? '⭐ Donador' : '🟢 Normal', inline: true }
      ).setTimestamp();
    await staffChannel.send({ embeds: [embed], content: CONFIG.STAFF_ROLES.map(id => `<@&${id}>`).join(' ') });
  } catch (err) { console.error('❌ Error advertencia staff:', err.message); }
}

// ===============================
// DM DE COLA
// ===============================

async function sendOrUpdateQueueDM(member) {
  try {
    const position = getQueuePosition(member.id);
    const entry = botState.queue.find(e => e.userId === member.id);
    if (!entry) return;

    const waitingTime = getWaitingTime(entry);
    const timeLeft = Math.max(1, (CONFIG.USER_QUEUE_TIMEOUT / 60000) - waitingTime);

    let color = '#00FF00', statusEmoji = '🟢', statusText = 'Normal';
    if (entry.priority === 3) { color = '#FFD700'; statusEmoji = '👑'; statusText = 'VIP'; }
    else if (entry.priority === 2) { color = '#00BFFF'; statusEmoji = '⭐'; statusText = 'Donador'; }

    const embed = new EmbedBuilder()
      .setColor(color).setTitle('📊 Estado en Cola - El Patio RP')
      .setDescription(`Estás en la posición **#${position}** de la cola`)
      .addFields(
        { name: '⏱️ Esperando', value: `${waitingTime} min`, inline: true },
        { name: '⏳ Estimado', value: `~${getEstimatedTime(position)} min`, inline: true },
        { name: '📍 Estado', value: `${statusEmoji} ${statusText}`, inline: true },
        { name: '🎫 Ticket', value: entry.ticketId, inline: true },
        { name: '⏰ Timeout en', value: `~${timeLeft} min`, inline: true }
      ).setFooter({ text: 'El Patio RP - Sistema de Soporte' }).setTimestamp();

    const existing = botState.userDMMessages.get(member.id);
    if (existing) {
      try {
        const dm = await member.user.createDM();
        const msg = await dm.messages.fetch(existing.messageId);
        await msg.edit({ embeds: [embed] });
        return;
      } catch (_) {}
    }

    const message = await sendDMSafe(member.user, { embeds: [embed] });
    if (message) {
      botState.userDMMessages.set(member.id, { messageId: message.id });
      console.log(`📬 DM enviado a ${member.user.username}`);
    }
  } catch (err) { console.error(`❌ Error DM cola:`, err.message); }
}

async function updateAllQueueMessages() {
  for (const entry of botState.queue) {
    await sendOrUpdateQueueDM(entry.member);
    await wait(500);
  }
}

// ===============================
// SISTEMA DE EVALUACIÓN
// ===============================

async function sendReviewRequest(member, staffMember, ticketId, duration) {
  try {
    const embed = new EmbedBuilder()
      .setColor('#00BFFF').setTitle('⭐ Evalúa tu experiencia de soporte')
      .setDescription(`¡Gracias por usar nuestro soporte!\n\nCalifica la atención de **${staffMember.user.username}**`)
      .addFields(
        { name: '🎫 Ticket', value: ticketId, inline: true },
        { name: '⏱️ Duración', value: `${duration} min`, inline: true }
      ).setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`review:5:${staffMember.id}:${ticketId}:${member.id}`).setLabel('⭐⭐⭐⭐⭐').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`review:4:${staffMember.id}:${ticketId}:${member.id}`).setLabel('⭐⭐⭐⭐').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`review:3:${staffMember.id}:${ticketId}:${member.id}`).setLabel('⭐⭐⭐').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`review:2:${staffMember.id}:${ticketId}:${member.id}`).setLabel('⭐⭐').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`review:1:${staffMember.id}:${ticketId}:${member.id}`).setLabel('⭐').setStyle(ButtonStyle.Danger)
    );

    const sent = await sendDMSafe(member.user, { embeds: [embed], components: [row] });
    if (sent) console.log(`⭐ Evaluación enviada a ${member.user.username}`);
  } catch (err) { console.error('❌ Error enviando evaluación:', err.message); }
}

async function handleReview(interaction) {
  try {
    await interaction.deferReply({ ephemeral: true });
    const [, starsStr, staffId, ticketId] = interaction.customId.split(':');
    const stars = parseInt(starsStr);

    const guild = client.guilds.cache.get(interaction.guildId) || client.guilds.cache.first();
    if (!guild) { await interaction.editReply({ content: '❌ Servidor no encontrado.' }); return; }

    const staffMember = await guild.members.fetch(staffId).catch(() => null);
    if (!staffMember) { await interaction.editReply({ content: '❌ Staff no encontrado.' }); return; }

    if (!persistData.staffStats[staffId]) {
      persistData.staffStats[staffId] = { totalReviews: 0, totalStars: 0, username: staffMember.user.username };
    }
    persistData.staffStats[staffId].totalReviews++;
    persistData.staffStats[staffId].totalStars += stars;
    persistData.staffStats[staffId].username = staffMember.user.username;

    const ticketEntry = persistData.ticketHistory.find(t => t.ticketId === ticketId);
    if (ticketEntry) { ticketEntry.rating = stars; ticketEntry.ratedAt = new Date().toISOString(); }
    saveData();

    const starRating = '⭐'.repeat(stars);
    const reviewChannel = guild.channels.cache.get(CONFIG.REVIEW_CHANNEL_ID);
    if (reviewChannel) {
      const embed = new EmbedBuilder()
        .setColor(stars >= 4 ? '#00FF00' : stars === 3 ? '#FFA500' : '#FF0000')
        .setTitle('⭐ Nueva Evaluación')
        .setDescription(`**Usuario:** ${interaction.user.username}\n**Staff:** ${staffMember.user.username}`)
        .addFields(
          { name: '🎫 Ticket', value: ticketId, inline: true },
          { name: '⭐ Calificación', value: `${starRating} (${stars}/5)`, inline: true },
          { name: '📅 Fecha', value: new Date().toLocaleString('es-ES'), inline: true }
        ).setTimestamp();
      await reviewChannel.send({ embeds: [embed] });
    }

    await interaction.editReply({ content: `✅ ¡Gracias! Has calificado con ${starRating}` });
    try { await interaction.message.delete(); } catch (_) {}
  } catch (err) {
    console.error('❌ Error evaluación:', err);
    try { await interaction.editReply({ content: '❌ Error procesando evaluación.' }); } catch (_) {}
  }
}

// ===============================
// 🎵 AUDIO - SISTEMA CORREGIDO
// ===============================

// Diagnóstico del sistema de audio
async function diagnoseAudioSystem() {
  console.log('\n🔧 Diagnóstico del sistema de audio:');

  // Verificar ffmpeg-static
  try {
    const ffmpegPath = require('ffmpeg-static');
    if (ffmpegPath) {
      console.log(`✅ ffmpeg-static: ${ffmpegPath}`);
    } else {
      console.log('⚠️  ffmpeg-static retornó null (normal en algunos entornos)');
    }
  } catch {
    console.log('❌ ffmpeg-static NO instalado — npm install ffmpeg-static');
  }

  // Verificar codec opus
  try {
    require('@discordjs/opus');
    console.log('✅ @discordjs/opus: OK');
  } catch {
    try {
      require('opusscript');
      console.log('✅ opusscript: OK (alternativa)');
    } catch {
      console.log('❌ Sin codec Opus — npm install @discordjs/opus');
    }
  }

  // Verificar archivos
  for (const [key, filePath] of Object.entries(CONFIG.AUDIO_FILES)) {
    if (fs.existsSync(filePath)) {
      const size = fs.statSync(filePath).size;
      console.log(`✅ ${key}: ${filePath} (${Math.round(size/1024)} KB)`);
    } else {
      console.log(`❌ ${key}: NO ENCONTRADO → ${filePath}`);
    }
  }
  console.log('');
}

function checkAudioFiles() {
  console.log("\n🔍 Verificando archivos de audio...");
  let ok = true;
  for (const [key, filePath] of Object.entries(CONFIG.AUDIO_FILES)) {
    try {
      const exists = fs.existsSync(filePath);
      if (exists) {
        const stats = fs.statSync(filePath);
        const sizeKB = Math.round(stats.size / 1024);
        console.log(`✅ ${key}: ${filePath} (${sizeKB} KB)`);
        if (stats.size < 1000) {
          console.warn(`⚠️  ${key} parece muy pequeño (${stats.size} bytes)`);
        }
      } else {
        console.log(`❌ ${key}: ${filePath} — NO ENCONTRADO`);
        ok = false;
      }
    } catch (e) {
      console.error(`❌ ${key}: ${e.message}`);
      ok = false;
    }
  }
  console.log(ok ? "✅ Todos los archivos OK\n" : "❌ Faltan archivos de audio\n");
  return ok;
}

async function connectToVoiceChannel(channel) {
  try {
    console.log(`🔌 Conectando a: ${channel.name}`);
    const connection = joinVoiceChannel({
      channelId: channel.id, guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator, selfDeaf: false, selfMute: false
    });
    await entersState(connection, VoiceConnectionStatus.Ready, 30000);
    console.log(`✅ Conectado a: ${channel.name}`);
    botState.activeConnections.set(channel.id, connection);

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5000),
        ]);
      } catch {
        connection.destroy();
        botState.activeConnections.delete(channel.id);
      }
    });
    return connection;
  } catch (err) {
    console.error("❌ Error conectando:", err.message);
    return null;
  }
}

// ─── FUNCIÓN CENTRAL CORREGIDA ───
async function playAudio(connection, channelId, audioFile, volume = 1.0, description = "Audio") {
  return new Promise((resolve) => {
    try {
      // Validar existencia
      if (!fs.existsSync(audioFile)) {
        console.error(`❌ Archivo no encontrado: ${audioFile}`);
        resolve();
        return;
      }

      // Validar tamaño mínimo (evita "offset is out of bounds" con archivos vacíos/corruptos)
      const stats = fs.statSync(audioFile);
      if (stats.size < 1000) {
        console.error(`❌ Archivo corrupto o vacío: ${audioFile} (${stats.size} bytes)`);
        resolve();
        return;
      }

      console.log(`🔊 Reproduciendo ${description}: ${path.basename(audioFile)} (${Math.round(stats.size/1024)}KB, Vol: ${Math.round(volume*100)}%)`);

      const player = createAudioPlayer();

      // ✅ FIX PRINCIPAL: usar ruta absoluta + inlineVolume separado del stream
      const absolutePath = path.resolve(audioFile);
      const resource = createAudioResource(absolutePath, {
        inputType: StreamType.Arbitrary,
        inlineVolume: true,
      });

      if (!resource) {
        console.error(`❌ createAudioResource retornó null para: ${audioFile}`);
        resolve();
        return;
      }

      // Setear volumen después de crear el resource
      if (resource.volume) {
        resource.volume.setVolume(Math.max(0, Math.min(2, volume)));
      }

      connection.subscribe(player);
      botState.currentPlayers.set(channelId, player);

      // Timeout de seguridad: si el audio tarda más de 10 min algo está mal
      const safetyTimeout = setTimeout(() => {
        console.warn(`⚠️ Timeout de seguridad para ${description}`);
        try { player.stop(true); } catch (_) {}
        resolve();
      }, 600000);

      player.on('error', err => {
        clearTimeout(safetyTimeout);
        console.error(`❌ Error en player "${description}": ${err.message}`);
        botState.currentPlayers.delete(channelId);
        try { player.stop(true); } catch (_) {}
        resolve();
      });

      player.on(AudioPlayerStatus.Idle, () => {
        clearTimeout(safetyTimeout);
        console.log(`✅ ${description} finalizado`);
        botState.currentPlayers.delete(channelId);
        resolve();
      });

      player.play(resource);

    } catch (err) {
      console.error(`❌ Error crítico en playAudio "${description}":`, err.message);
      botState.currentPlayers.delete(channelId);
      resolve(); // Nunca dejar la promesa colgada
    }
  });
}

// ===============================
// SECUENCIA INICIAL
// ===============================

async function startCallCenterSequence(connection, channelId, member) {
  try {
    console.log(`\n╔════════════════════════════════════════════════╗`);
    console.log(`║  🎼 INICIANDO SECUENCIA CALL CENTER            ║`);
    console.log(`║  👤 Usuario: ${member.user.username.padEnd(30)}║`);
    console.log(`╚════════════════════════════════════════════════╝\n`);

    console.log(`📻 [PASO 1] Música de Bienvenida`);
    await playAudio(connection, channelId, CONFIG.AUDIO_FILES.WELCOME_MUSIC, 0.35, "🎵 Música Intro");
    await wait(CONFIG.TRANSITION_BUFFER);
    if (!await checkChannelHasUsers(channelId)) return;

    console.log(`📻 [PASO 2] Voz Atendiendo`);
    await playAudio(connection, channelId, CONFIG.AUDIO_FILES.VOICE_WAITING, 1.0, "🎙️ Voz Atendiendo");
    await wait(CONFIG.TRANSITION_BUFFER);
    if (!await checkChannelHasUsers(channelId)) return;

    console.log(`📻 [PASO 3] Música de Espera`);
    await playAudio(connection, channelId, CONFIG.AUDIO_FILES.WELCOME_MUSIC, 0.28, "🎵 Música Espera");
    await wait(CONFIG.TRANSITION_BUFFER);
    if (!await checkChannelHasUsers(channelId)) return;

    let roleVoice = CONFIG.AUDIO_FILES.VOICE_WAITING, roleDesc = "Normal";
    if (isVIP(member))          { roleVoice = CONFIG.AUDIO_FILES.VOICE_VIP; roleDesc = "VIP 👑"; }
    else if (isDonator(member)) { roleVoice = CONFIG.AUDIO_FILES.VOICE_VIP; roleDesc = "Donador ⭐"; }

    console.log(`📻 [PASO 4] Voz Rol: ${roleDesc}`);
    await playAudio(connection, channelId, roleVoice, 1.0, `🎙️ Voz ${roleDesc}`);
    await wait(CONFIG.TRANSITION_BUFFER);
    if (!await checkChannelHasUsers(channelId)) return;

    const channel = client.channels.cache.get(channelId);
    if (channel && getAvailableStaff(channel.guild).length === 0) {
      console.log(`📻 [PASO 5] ⚠️ Sin Staff`);
      await wait(CONFIG.MUSIC_BETWEEN_VOICES);
      await playAudio(connection, channelId, CONFIG.AUDIO_FILES.VOICE_NO_STAFF, 1.0, "🎙️ Voz Sin Staff");
      await wait(CONFIG.TRANSITION_BUFFER);
    } else {
      console.log(`📻 [PASO 5] ✅ Staff disponible`);
    }

    if (!await checkChannelHasUsers(channelId)) return;

    console.log(`📻 [PASO 6] 🔄 Iniciando ciclo continuo...\n`);
    await startMusicVoiceCycle(connection, channelId);
  } catch (err) {
    console.error('❌ Error en secuencia:', err.message);
  }
}

// ===============================
// CICLO CONTINUO
// ===============================

async function startMusicVoiceCycle(connection, channelId) {
  botState.cycleRunning.set(channelId, true);
  let cycleCount = 0;

  while (botState.cycleRunning.get(channelId)) {
    if (!await checkChannelHasUsers(channelId)) break;
    cycleCount++;

    let musicDuration = CONFIG.MUSIC_CYCLE_BASE + ((cycleCount - 1) * CONFIG.MUSIC_CYCLE_INCREMENT);
    if (musicDuration > CONFIG.MAX_MUSIC_DURATION) musicDuration = CONFIG.MAX_MUSIC_DURATION;

    console.log(`\n┌─────────────────────────────────────┐`);
    console.log(`│  🔄 CICLO #${String(cycleCount).padEnd(3)} - MÚSICA + VOZ        │`);
    console.log(`└─────────────────────────────────────┘`);

    await playAudio(connection, channelId, CONFIG.AUDIO_FILES.WELCOME_MUSIC, 0.25, "🎵 Música Ciclo");
    await wait(CONFIG.TRANSITION_BUFFER);
    if (!botState.cycleRunning.get(channelId)) break;
    if (!await checkChannelHasUsers(channelId)) break;

    const channel = client.channels.cache.get(channelId);
    if (!channel) break;
    const humans = channel.members.filter(m => !m.user.bot);
    if (humans.size === 0) break;

    const availableStaff = getAvailableStaff(channel.guild);
    let voiceFile = CONFIG.AUDIO_FILES.VOICE_WAITING, voiceDesc = "Atendiendo";

    if (availableStaff.length === 0) {
      voiceFile = CONFIG.AUDIO_FILES.VOICE_NO_STAFF; voiceDesc = "Sin Staff ⚠️";
    } else {
      for (const [, m] of humans) {
        if (isVIP(m))      { voiceFile = CONFIG.AUDIO_FILES.VOICE_VIP; voiceDesc = "VIP 👑"; break; }
        if (isDonator(m))  { voiceFile = CONFIG.AUDIO_FILES.VOICE_VIP; voiceDesc = "Donador ⭐"; break; }
      }
    }

    console.log(`🎙️ Voz: ${voiceDesc}`);
    await playAudio(connection, channelId, voiceFile, 1.0, `🎙️ Voz ${voiceDesc}`);
    await wait(CONFIG.TRANSITION_BUFFER);

    console.log(`✅ Ciclo #${cycleCount} completado`);
    await wait(2000);
  }

  console.log(`🔄 Ciclo detenido para canal ${channelId}`);
  botState.cycleRunning.delete(channelId);
}

// ===============================
// DETENER / DESCONECTAR
// ===============================

function stopAllAudio(channelId) {
  console.log(`🛑 Deteniendo audio`);
  botState.cycleRunning.set(channelId, false);
  const player = botState.currentPlayers.get(channelId);
  if (player) { try { player.stop(true); } catch (_) {} botState.currentPlayers.delete(channelId); }
}

function disconnectFromChannel(channel) {
  console.log(`👋 Desconectando de: ${channel.name}`);
  stopAllAudio(channel.id);
  const connection = botState.activeConnections.get(channel.id);
  if (connection) { try { connection.destroy(); } catch (_) {} botState.activeConnections.delete(channel.id); }
}

async function checkChannelHasUsers(channelId) {
  const channel = client.channels.cache.get(channelId);
  if (!channel) return false;
  const humans = channel.members.filter(m => !m.user.bot);
  if (humans.size === 0) {
    console.log("📭 Canal vacío, deteniendo audio");
    stopAllAudio(channelId);
    disconnectFromChannel(channel);
    return false;
  }
  return true;
}

async function manageWaitingChannelAudio(channel, member) {
  console.log(`\n📞 Gestionando audio para: ${member.user.username}`);
  let connection = botState.activeConnections.get(channel.id);
  if (!connection) { connection = await connectToVoiceChannel(channel); if (!connection) return; }
  await wait(1000);
  await startCallCenterSequence(connection, channel.id, member);
}

// ===============================
// STAFF
// ===============================

function getAvailableStaff(guild) {
  const ch = guild.channels.cache.get(CONFIG.STAFF_AVAILABLE_CHANNEL_ID);
  if (!ch) return [];
  return ch.members.filter(m => !m.user.bot && isStaff(m)).map(m => m);
}

function findEmptySupportChannel(guild) {
  for (const channelId of CONFIG.SUPPORT_CHANNELS) {
    const ch = guild.channels.cache.get(channelId);
    if (ch && !ch.members.some(m => !m.user.bot)) {
      console.log(`📞 Canal vacío: ${ch.name}`);
      return ch;
    }
  }
  return null;
}

async function assignUserToStaff(guild) {
  if (botState.queue.length === 0) return;
  const availableStaff = getAvailableStaff(guild);
  if (availableStaff.length === 0) return;
  const supportChannel = findEmptySupportChannel(guild);
  if (!supportChannel) return;

  const nextUser = botState.queue[0];
  const staff = availableStaff[0];

  console.log(`\n🎯 ASIGNANDO: ${nextUser.member.user.username} → ${staff.user.username} | ${supportChannel.name}`);

  try {
    await nextUser.member.voice.setChannel(supportChannel);
    await nextUser.member.voice.setMute(false);
    await staff.voice.setChannel(supportChannel);

    botState.activeSupport.set(nextUser.userId, {
      staffId: staff.id, staffUsername: staff.user.username,
      channelId: supportChannel.id, startTime: Date.now(),
      ticketId: nextUser.ticketId, userId: nextUser.userId,
      username: nextUser.member.user.username
    });
    removeFromQueue(nextUser.userId);

    persistData.ticketHistory.unshift({
      ticketId: nextUser.ticketId, userId: nextUser.userId,
      username: nextUser.member.user.username, staffId: staff.id,
      staffUsername: staff.user.username, startTime: new Date().toISOString(),
      duration: null, rating: null
    });
    if (persistData.ticketHistory.length > 500) persistData.ticketHistory = persistData.ticketHistory.slice(0, 500);
    saveData();

    const dmInfo = botState.userDMMessages.get(nextUser.userId);
    if (dmInfo) {
      try {
        const dm = await nextUser.member.user.createDM();
        const msg = await dm.messages.fetch(dmInfo.messageId);
        const embed = new EmbedBuilder()
          .setColor('#00FF00').setTitle('✅ Soporte Asignado')
          .setDescription(`Estás siendo atendido por **${staff.user.username}**`)
          .addFields(
            { name: '📞 Canal', value: supportChannel.name, inline: true },
            { name: '🎫 Ticket', value: nextUser.ticketId, inline: true }
          ).setTimestamp();
        await msg.edit({ embeds: [embed] });
      } catch (_) { console.log(`⚠️ No se pudo actualizar DM de ${nextUser.member.user.username}`); }
      botState.userDMMessages.delete(nextUser.userId);
    }

    await updateAllQueueMessages();
    setTimeout(() => assignUserToStaff(guild), 2000);
  } catch (err) {
    console.error('❌ Error asignando usuario:', err.message);
  }
}

// ===============================
// MONITOREO STAFF
// ===============================

function cancelStaffUnavailableTimer(memberId) {
  const t = botState.staffUnavailableTimers.get(memberId);
  if (t) { clearTimeout(t); botState.staffUnavailableTimers.delete(memberId); }
}

async function startStaffUnavailableTimer(member) {
  cancelStaffUnavailableTimer(member.id);
  const timer = setTimeout(async () => {
    const mins = CONFIG.STAFF_UNAVAILABLE_WARNING_TIME / 60000;
    const embed = new EmbedBuilder()
      .setColor('#FFA500').setTitle('⚠️ Recordatorio de Descanso')
      .setDescription(`Llevas **${mins} minutos** en Staff No Disponible.\nEl equipo necesita tu apoyo.`)
      .setTimestamp();
    await sendDMSafe(member.user, { embeds: [embed] });
  }, CONFIG.STAFF_UNAVAILABLE_WARNING_TIME);
  botState.staffUnavailableTimers.set(member.id, timer);
}

// ===============================
// ACTUALIZADOR DE COLA
// ===============================

function startQueueUpdater(guild) {
  setInterval(async () => {
    if (botState.queue.filter(e => e.guildId === guild.id).length > 0) {
      await updateAllQueueMessages();
      if (getAvailableStaff(guild).length > 0) await assignUserToStaff(guild);
    }
  }, CONFIG.QUEUE_UPDATE_INTERVAL);
}

// ===============================
// COMANDOS SLASH - HANDLERS
// ===============================

async function handleDescansoCommand(interaction) {
  if (!isStaff(interaction.member)) return interaction.reply({ content: '❌ Solo para staff.', ephemeral: true });
  const minutos = interaction.options.getInteger('minutos');
  const busyChannel = interaction.guild.channels.cache.get(CONFIG.STAFF_BUSY_CHANNEL_ID);
  if (!busyChannel) return interaction.reply({ content: '❌ Canal no configurado.', ephemeral: true });
  try {
    await interaction.member.voice.setChannel(busyChannel);
    const embed = new EmbedBuilder().setColor('#FFA500').setTitle('☕ Descanso Programado')
      .setDescription(`Movido a **Staff No Disponible** por **${minutos} min**`).setTimestamp();
    await interaction.reply({ embeds: [embed], ephemeral: true });
    setTimeout(async () => {
      const embed = new EmbedBuilder().setColor('#00FF00').setTitle('⏰ Fin del Descanso')
        .setDescription(`Tu descanso de **${minutos} min** ha terminado. ¡El equipo te necesita!`).setTimestamp();
      await sendDMSafe(interaction.member.user, { embeds: [embed] });
    }, minutos * 60000);
    console.log(`☕ ${interaction.user.username} tomó descanso de ${minutos} min`);
  } catch (err) { interaction.reply({ content: '❌ Error al tomar descanso.', ephemeral: true }); }
}

async function handleVolverCommand(interaction) {
  if (!isStaff(interaction.member)) return interaction.reply({ content: '❌ Solo para staff.', ephemeral: true });
  const availableChannel = interaction.guild.channels.cache.get(CONFIG.STAFF_AVAILABLE_CHANNEL_ID);
  if (!availableChannel) return interaction.reply({ content: '❌ Canal no configurado.', ephemeral: true });
  try {
    await interaction.member.voice.setChannel(availableChannel);
    cancelStaffUnavailableTimer(interaction.member.id);
    const embed = new EmbedBuilder().setColor('#00FF00').setTitle('✅ De Vuelta al Servicio')
      .setDescription('Has sido movido a **Staff Disponible**').setTimestamp();
    await interaction.reply({ embeds: [embed], ephemeral: true });
    console.log(`✅ ${interaction.user.username} volvió al servicio`);
  } catch (err) { interaction.reply({ content: '❌ Error al volver.', ephemeral: true }); }
}

async function handleEstadisticasCommand(interaction) {
  if (!isStaff(interaction.member)) return interaction.reply({ content: '❌ Solo para staff.', ephemeral: true });
  const guild = interaction.guild;
  const ratedTickets = persistData.ticketHistory.filter(t => t.rating);
  const avgRating = ratedTickets.length > 0
    ? (ratedTickets.reduce((a, t) => a + t.rating, 0) / ratedTickets.length).toFixed(1) : 'N/A';
  const embed = new EmbedBuilder().setColor('#00BFFF').setTitle('📊 Estadísticas del Sistema')
    .addFields(
      { name: '👥 En Cola', value: `${botState.queue.length}`, inline: true },
      { name: '👨‍💼 Staff Disponible', value: `${getAvailableStaff(guild).length}`, inline: true },
      { name: '🔧 Soportes Activos', value: `${botState.activeSupport.size}`, inline: true },
      { name: '🎫 Total Tickets', value: `${persistData.ticketHistory.length}`, inline: true },
      { name: '⭐ Calificación Prom.', value: `${avgRating}`, inline: true },
      { name: '📝 Tickets Calificados', value: `${ratedTickets.length}`, inline: true }
    ).setTimestamp();
  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleColaCommand(interaction) {
  const guildQueue = botState.queue.filter(e => e.guildId === interaction.guild.id);
  if (guildQueue.length === 0) {
    const embed = new EmbedBuilder().setColor('#00FF00').setTitle('📭 Cola Vacía').setDescription('No hay usuarios esperando.').setTimestamp();
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }
  const list = guildQueue.slice(0, 10).map((e, i) => {
    const emoji = e.priority === 3 ? '👑' : e.priority === 2 ? '⭐' : '🟢';
    return `${emoji} **#${i+1}** - ${e.member.user.username} (${getWaitingTime(e)} min) · \`${e.ticketId}\``;
  }).join('\n');
  const embed = new EmbedBuilder().setColor('#FFA500').setTitle('📋 Cola de Espera').setDescription(list)
    .addFields(
      { name: '👥 Total', value: `${guildQueue.length}`, inline: true },
      { name: '🎯 Próximo', value: guildQueue[0].member.user.username, inline: true }
    ).setFooter({ text: guildQueue.length > 10 ? `Mostrando 10 de ${guildQueue.length}` : 'El Patio RP' }).setTimestamp();
  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleTicketCommand(interaction) {
  const userId = interaction.user.id;
  const activeSupport = botState.activeSupport.get(userId);

  if (activeSupport) {
    const duration = Math.floor((Date.now() - activeSupport.startTime) / 60000);
    const embed = new EmbedBuilder().setColor('#00FF00').setTitle('🎫 Tu Ticket - En Atención')
      .addFields(
        { name: '🎫 Ticket', value: activeSupport.ticketId, inline: true },
        { name: '👨‍💼 Staff', value: activeSupport.staffUsername, inline: true },
        { name: '⏱️ Duración', value: `${duration} min`, inline: true }
      ).setTimestamp();
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  const entry = botState.queue.find(e => e.userId === userId);
  if (entry) {
    const pos = getQueuePosition(userId);
    const embed = new EmbedBuilder().setColor('#FFA500').setTitle('🎫 Tu Ticket - En Cola')
      .addFields(
        { name: '🎫 Ticket', value: entry.ticketId, inline: true },
        { name: '📍 Posición', value: `#${pos}`, inline: true },
        { name: '⏱️ Esperando', value: `${getWaitingTime(entry)} min`, inline: true },
        { name: '⏳ Estimado', value: `~${getEstimatedTime(pos)} min`, inline: true }
      ).setTimestamp();
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  const lastTicket = persistData.ticketHistory.find(t => t.userId === userId);
  if (lastTicket) {
    const embed = new EmbedBuilder().setColor('#AAAAAA').setTitle('🎫 Último Ticket (sin activo)')
      .addFields(
        { name: '🎫 Ticket', value: lastTicket.ticketId, inline: true },
        { name: '👨‍💼 Atendido por', value: lastTicket.staffUsername || 'N/A', inline: true },
        { name: '⭐ Calificación', value: lastTicket.rating ? '⭐'.repeat(lastTicket.rating) : '—', inline: true }
      ).setTimestamp();
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  await interaction.reply({ content: '❌ No tienes ningún ticket activo o historial.', ephemeral: true });
}

async function handleMisResenasCommand(interaction) {
  if (!isStaff(interaction.member)) return interaction.reply({ content: '❌ Solo para staff.', ephemeral: true });
  const stats = persistData.staffStats[interaction.user.id];
  if (!stats || stats.totalReviews === 0) return interaction.reply({ content: '📭 Aún no tienes reseñas.', ephemeral: true });
  const avg = (stats.totalStars / stats.totalReviews).toFixed(2);
  const embed = new EmbedBuilder().setColor('#FFD700').setTitle('⭐ Tus Estadísticas de Reseñas')
    .addFields(
      { name: '📝 Total Reseñas', value: `${stats.totalReviews}`, inline: true },
      { name: '⭐ Promedio', value: `${avg}/5`, inline: true },
      { name: '🌟 Estrellas Totales', value: `${stats.totalStars}`, inline: true }
    ).setTimestamp();
  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleHistorialCommand(interaction) {
  if (!isStaff(interaction.member)) return interaction.reply({ content: '❌ Solo para staff.', ephemeral: true });
  const cantidad = interaction.options.getInteger('cantidad') || 10;
  const tickets = persistData.ticketHistory.slice(0, cantidad);
  if (tickets.length === 0) return interaction.reply({ content: '📭 No hay historial de tickets.', ephemeral: true });
  const list = tickets.map((t, i) => {
    const rating = t.rating ? '⭐'.repeat(t.rating) : '—';
    const date = new Date(t.startTime).toLocaleDateString('es-ES');
    return `**#${i+1}** \`${t.ticketId}\` · ${t.username} → ${t.staffUsername||'?'} · ${rating} · ${date}`;
  }).join('\n');
  const embed = new EmbedBuilder().setColor('#00BFFF').setTitle(`📋 Historial (últimos ${tickets.length})`)
    .setDescription(list).setFooter({ text: `Total: ${persistData.ticketHistory.length} tickets` }).setTimestamp();
  await interaction.reply({ embeds: [embed], ephemeral: true });
}

// ===============================
// EVENTOS
// ===============================

client.on("voiceStateUpdate", async (oldState, newState) => {
  const member = newState.member || oldState.member;
  if (!member || member.user.bot) return;

  const guild = member.guild;
  const waitingId = CONFIG.WAITING_CHANNEL_ID;
  const staffBusyId = CONFIG.STAFF_BUSY_CHANNEL_ID;

  if (isStaff(member)) {
    if (newState.channelId === staffBusyId && oldState.channelId !== staffBusyId) await startStaffUnavailableTimer(member);
    if (oldState.channelId === staffBusyId && newState.channelId !== staffBusyId) cancelStaffUnavailableTimer(member.id);
  }

  if (newState.channelId === waitingId && oldState.channelId !== waitingId) {
    console.log(`\n📥 ${member.user.username} entró a espera`);

    if (isSpamming(member.id)) {
      console.log(`🚫 Anti-spam: ${member.user.username}`);
      try {
        const embed = new EmbedBuilder().setColor('#FF0000').setTitle('⏳ Espera un momento')
          .setDescription('Estás entrando al canal muy rápido. Espera unos segundos.').setTimestamp();
        await sendDMSafe(member.user, { embeds: [embed] });
        await member.voice.disconnect();
      } catch (_) {}
      return;
    }

    const entry = addToQueue(member);
    if (entry) {
      await sendOrUpdateQueueDM(member);
      await manageWaitingChannelAudio(newState.channel, member);
      setTimeout(() => assignUserToStaff(guild), CONFIG.TIME_BEFORE_ASSIGN);
    }
  }

  if (oldState.channelId === waitingId && newState.channelId !== waitingId) {
    console.log(`\n📤 ${member.user.username} salió de espera`);
    removeFromQueue(member.id);
    botState.userDMMessages.delete(member.id);

    const channel = oldState.channel;
    if (channel) {
      const humans = channel.members.filter(m => !m.user.bot);
      if (humans.size === 0) disconnectFromChannel(channel);
      else console.log(`🔄 Continuando audio para ${humans.size} usuario(s)`);
    }
    await updateAllQueueMessages();
  }

  const supportInfo = botState.activeSupport.get(member.id);
  if (supportInfo && oldState.channelId === supportInfo.channelId && newState.channelId !== supportInfo.channelId) {
    console.log(`\n✅ ${member.user.username} terminó soporte`);
    const duration = Math.floor((Date.now() - supportInfo.startTime) / 60000);

    const ticketEntry = persistData.ticketHistory.find(t => t.ticketId === supportInfo.ticketId);
    if (ticketEntry) { ticketEntry.duration = duration; ticketEntry.endTime = new Date().toISOString(); }
    saveData();

    const staffMember = guild.members.cache.get(supportInfo.staffId);
    if (staffMember) await sendReviewRequest(member, staffMember, supportInfo.ticketId, duration);

    botState.activeSupport.delete(member.id);

    if (staffMember?.voice.channelId === supportInfo.channelId) {
      const staffAvailable = guild.channels.cache.get(CONFIG.STAFF_AVAILABLE_CHANNEL_ID);
      if (staffAvailable) {
        try { await staffMember.voice.setChannel(staffAvailable); console.log(`👨‍💼 Staff devuelto a disponibles`); }
        catch (e) { console.error('❌ Error moviendo staff:', e.message); }
      }
    }
    setTimeout(() => assignUserToStaff(guild), 2000);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (interaction.isButton() && interaction.customId.startsWith('review:')) {
    await handleReview(interaction); return;
  }
  if (!interaction.isChatInputCommand()) return;
  try {
    switch (interaction.commandName) {
      case 'descanso':     await handleDescansoCommand(interaction); break;
      case 'volver':       await handleVolverCommand(interaction); break;
      case 'estadisticas': await handleEstadisticasCommand(interaction); break;
      case 'cola':         await handleColaCommand(interaction); break;
      case 'ticket':       await handleTicketCommand(interaction); break;
      case 'misresenas':   await handleMisResenasCommand(interaction); break;
      case 'historial':    await handleHistorialCommand(interaction); break;
    }
  } catch (err) {
    console.error('❌ Error comando:', err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '❌ Error ejecutando comando.', ephemeral: true }).catch(() => {});
    }
  }
});

// ===============================
// BOT LISTO
// ===============================

client.once("clientReady", async () => {
  console.log(`\n╔════════════════════════════════════════════════╗`);
  console.log(`║  ✅ EL PATIO RP - CALL CENTER V5.1 AUDIO FIX  ║`);
  console.log(`║  👤 ${client.user.tag.padEnd(37)}║`);
  console.log(`╚════════════════════════════════════════════════╝\n`);

  // Ejecutar diagnóstico de audio al arrancar
  await diagnoseAudioSystem();
  checkAudioFiles();

  const rest = new REST({ version: '10' }).setToken(CONFIG.TOKEN);
  try {
    console.log('🔄 Registrando comandos slash...');
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('✅ Comandos slash registrados\n');
  } catch (err) { console.error('❌ Error registrando comandos:', err); }

  for (const [, guild] of client.guilds.cache) {
    console.log(`🏠 Inicializando: ${guild.name}`);
    startQueueUpdater(guild);
    const waitingChannel = guild.channels.cache.get(CONFIG.WAITING_CHANNEL_ID);
    if (waitingChannel?.isVoiceBased()) {
      const humans = waitingChannel.members.filter(m => !m.user.bot);
      if (humans.size > 0) {
        console.log(`🔄 ${humans.size} usuario(s) esperando al arrancar`);
        for (const [, member] of humans) { addToQueue(member); await sendOrUpdateQueueDM(member); }
        await manageWaitingChannelAudio(waitingChannel, humans.first());
        setTimeout(() => assignUserToStaff(guild), CONFIG.TIME_BEFORE_ASSIGN);
      }
    }
  }

  console.log(`\n╔════════════════════════════════════════════════╗`);
  console.log(`║  ✅ BOT LISTO - V5.1 AUDIO FIX                ║`);
  console.log(`║  🔧 path.resolve() fix: ✅                    ║`);
  console.log(`║  🔧 Validación tamaño archivo: ✅             ║`);
  console.log(`║  🔧 Safety timeout: ✅                        ║`);
  console.log(`║  🔧 Diagnóstico al arrancar: ✅               ║`);
  console.log(`╚════════════════════════════════════════════════╝\n`);
});

// ===============================
// ERRORES GLOBALES
// ===============================

process.on('unhandledRejection', err => console.error('\n❌ UNHANDLED:', err?.message || err));
process.on('uncaughtException',  err => console.error('\n❌ UNCAUGHT:', err?.message || err));
client.on('error', err => console.error('\n❌ CLIENT ERROR:', err?.message || err));

// ===============================
// LOGIN
// ===============================

console.log("🚀 Iniciando El Patio RP Call Center V5.1 AUDIO FIX...\n");
client.login(CONFIG.TOKEN).catch(err => { console.error("❌ Error de login:", err); process.exit(1); });
