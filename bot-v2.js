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
  PermissionFlagsBits,
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
  REVIEW_CHANNEL_ID: "1423880600422711377",

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

  // 🎯 CONFIGURACIÓN OPTIMIZADA TIPO CALL CENTER PROFESIONAL
  MUSIC_INTRO: 8000,                  // 8 segundos música de bienvenida
  MUSIC_BETWEEN_VOICES: 15000,        // 15 segundos música entre voces
  MUSIC_CYCLE_BASE: 25000,            // 25 segundos base para ciclos
  MUSIC_CYCLE_INCREMENT: 8000,        // Incremento de 8 segundos
  MAX_MUSIC_DURATION: 50000,          // Máximo 50 segundos de música
  TRANSITION_BUFFER: 600,             // 0.6 segundos de buffer
  
  TIME_BEFORE_ASSIGN: 5000,
  QUEUE_UPDATE_INTERVAL: 10000,
  NO_STAFF_WARNING_TIME: 180000,
  STAFF_UNAVAILABLE_WARNING_TIME: 1800000,

  AVERAGE_SUPPORT_TIME: 3
};

// ===============================
// ESTADO DEL BOT
// ===============================

const botState = {
  activeConnections: new Map(),
  currentPlayers: new Map(),
  audioSequences: new Map(),
  audioTimers: new Map(),
  cycleCounters: new Map(),
  
  queue: [],
  activeSupport: new Map(),
  userDMMessages: new Map(),
  
  lastStaffNotification: null,
  staffUnavailableTimers: new Map(),
  noStaffWarnings: new Map(),
  
  pendingReviews: new Map()
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
// WEB
// ===============================

const app = express();
app.get("/", (req, res) => res.send("✅ El Patio RP - Call Center V4.0 ULTRA PROFESIONAL"));
app.listen(3000, () => console.log("🌐 Web activa en puerto 3000"));

// ===============================
// COMANDOS SLASH
// ===============================

const commands = [
  new SlashCommandBuilder()
    .setName('descanso')
    .setDescription('Tomar un descanso temporal del soporte')
    .addIntegerOption(option =>
      option.setName('minutos')
        .setDescription('Duración del descanso en minutos (máximo 60)')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(60)
    ),
  
  new SlashCommandBuilder()
    .setName('volver')
    .setDescription('Volver al servicio de soporte'),
  
  new SlashCommandBuilder()
    .setName('estadisticas')
    .setDescription('Ver estadísticas del sistema de soporte'),
  
  new SlashCommandBuilder()
    .setName('cola')
    .setDescription('Ver el estado actual de la cola de espera')
].map(command => command.toJSON());

// ===============================
// UTILIDADES
// ===============================

function isStaff(member) {
  return member.roles.cache.some(role => CONFIG.STAFF_ROLES.includes(role.id));
}

function isVIP(member) {
  return member.roles.cache.some(role => CONFIG.VIP_ROLES.includes(role.id));
}

function isDonator(member) {
  return member.roles.cache.some(role => CONFIG.DONATOR_ROLES.includes(role.id));
}

function getUserPriority(member) {
  if (isVIP(member)) return 3;
  if (isDonator(member)) return 2;
  return 1;
}

function formatTime(minutes) {
  if (minutes < 1) return "menos de 1 minuto";
  if (minutes === 1) return "1 minuto";
  return `${minutes} minutos`;
}

function generateTicketId() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const random = Math.random().toString(36).substr(2, 6).toUpperCase();
  return `PATIO-${year}${month}${day}-${random}`;
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ===============================
// SISTEMA DE COLA
// ===============================

function addToQueue(member) {
  const priority = getUserPriority(member);
  const ticketId = generateTicketId();
  
  const queueEntry = {
    userId: member.id,
    member: member,
    joinTime: Date.now(),
    priority: priority,
    notified: false,
    ticketId: ticketId
  };
  
  const insertIndex = botState.queue.findIndex(entry => entry.priority < priority);
  
  if (insertIndex === -1) {
    botState.queue.push(queueEntry);
  } else {
    botState.queue.splice(insertIndex, 0, queueEntry);
  }
  
  console.log(`📋 ${member.user.username} en cola (Ticket: ${ticketId}, Prioridad: ${priority})`);
  
  const warningTimer = setTimeout(async () => {
    await sendNoStaffWarning(member.guild, queueEntry);
  }, CONFIG.NO_STAFF_WARNING_TIME);
  
  botState.noStaffWarnings.set(member.id, warningTimer);
  
  return queueEntry;
}

function removeFromQueue(userId) {
  const index = botState.queue.findIndex(entry => entry.userId === userId);
  
  if (index !== -1) {
    const removed = botState.queue.splice(index, 1)[0];
    console.log(`📋 ${removed.member.user.username} removido de cola`);
    
    const warningTimer = botState.noStaffWarnings.get(userId);
    if (warningTimer) {
      clearTimeout(warningTimer);
      botState.noStaffWarnings.delete(userId);
    }
    
    return removed;
  }
  
  return null;
}

function getQueuePosition(userId) {
  return botState.queue.findIndex(entry => entry.userId === userId) + 1;
}

function getWaitingTime(entry) {
  return Math.floor((Date.now() - entry.joinTime) / 60000);
}

function getEstimatedTime(position) {
  return Math.max(1, position * CONFIG.AVERAGE_SUPPORT_TIME);
}

// ===============================
// ADVERTENCIA POR FALTA DE STAFF
// ===============================

async function sendNoStaffWarning(guild, queueEntry) {
  try {
    const staffChannel = guild.channels.cache.get(CONFIG.STAFF_TEXT_CHANNEL_ID);
    if (!staffChannel) return;
    
    const waitTime = getWaitingTime(queueEntry);
    
    const embed = new EmbedBuilder()
      .setColor('#FF0000')
      .setTitle('🚨 ALERTA: Usuario sin atender')
      .setDescription(`El usuario **${queueEntry.member.user.username}** lleva **${waitTime} minutos** esperando sin ser atendido`)
      .addFields(
        { name: '🎫 Ticket', value: queueEntry.ticketId, inline: true },
        { name: '⏱️ Tiempo', value: `${waitTime} minutos`, inline: true },
        { name: '📍 Prioridad', value: queueEntry.priority === 3 ? '👑 VIP' : queueEntry.priority === 2 ? '⭐ Donador' : '🟢 Normal', inline: true }
      )
      .setFooter({ text: 'El Patio RP - Sistema de Soporte' })
      .setTimestamp();
    
    await staffChannel.send({ embeds: [embed], content: CONFIG.STAFF_ROLES.map(id => `<@&${id}>`).join(' ') });
    
    console.log(`🚨 Advertencia enviada: ${queueEntry.member.user.username} - ${waitTime} min sin atender`);
    
  } catch (error) {
    console.error('❌ Error enviando advertencia de staff:', error.message);
  }
}

// ===============================
// MENSAJES DM
// ===============================

async function sendOrUpdateQueueDM(member) {
  try {
    const position = getQueuePosition(member.id);
    const entry = botState.queue.find(e => e.userId === member.id);
    
    if (!entry) return;
    
    const waitingTime = getWaitingTime(entry);
    const estimatedTime = getEstimatedTime(position);
    
    let statusEmoji = "🟢";
    let statusText = "Normal";
    let color = '#00FF00';
    
    if (entry.priority === 3) {
      statusEmoji = "👑";
      statusText = "VIP";
      color = '#FFD700';
    } else if (entry.priority === 2) {
      statusEmoji = "⭐";
      statusText = "Donador";
      color = '#00BFFF';
    }
    
    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle('📊 Estado en Cola - El Patio RP')
      .setDescription(`Estás en la posición **#${position}** de la cola`)
      .addFields(
        { name: '⏱️ Tiempo Esperando', value: `${waitingTime} minuto(s)`, inline: true },
        { name: '⏳ Tiempo Estimado', value: `~${estimatedTime} min`, inline: true },
        { name: '📍 Estado', value: `${statusEmoji} ${statusText}`, inline: true },
        { name: '🎫 Ticket', value: entry.ticketId, inline: false }
      )
      .setFooter({ text: 'El Patio RP - Sistema de Soporte' })
      .setTimestamp();
    
    const dmChannel = await member.user.createDM();
    const existingDM = botState.userDMMessages.get(member.id);
    
    if (existingDM) {
      try {
        const existingMessage = await dmChannel.messages.fetch(existingDM.messageId);
        await existingMessage.edit({ embeds: [embed] });
      } catch (error) {
        const newMessage = await dmChannel.send({ embeds: [embed] });
        botState.userDMMessages.set(member.id, { messageId: newMessage.id, channelId: dmChannel.id });
      }
    } else {
      const message = await dmChannel.send({ embeds: [embed] });
      botState.userDMMessages.set(member.id, { messageId: message.id, channelId: dmChannel.id });
      console.log(`📬 DM enviado a ${member.user.username}`);
    }
    
  } catch (error) {
    console.error(`❌ Error enviando DM:`, error.message);
  }
}

async function updateAllQueueMessages() {
  for (const entry of botState.queue) {
    await sendOrUpdateQueueDM(entry.member);
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}

// ===============================
// SISTEMA DE EVALUACIÓN
// ===============================

async function sendReviewRequest(member, staffMember, ticketId, duration) {
  try {
    const embed = new EmbedBuilder()
      .setColor('#00BFFF')
      .setTitle('⭐ Evalúa tu experiencia de soporte')
      .setDescription(`¡Gracias por usar nuestro sistema de soporte!\n\nPor favor califica la atención recibida de **${staffMember.user.username}**`)
      .addFields(
        { name: '🎫 Ticket', value: ticketId, inline: true },
        { name: '⏱️ Duración', value: `${duration} minutos`, inline: true }
      )
      .setFooter({ text: 'El Patio RP - Sistema de Soporte' })
      .setTimestamp();
    
    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`review:5:${staffMember.id}:${ticketId}:${member.id}`)
          .setLabel('⭐⭐⭐⭐⭐')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`review:4:${staffMember.id}:${ticketId}:${member.id}`)
          .setLabel('⭐⭐⭐⭐')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`review:3:${staffMember.id}:${ticketId}:${member.id}`)
          .setLabel('⭐⭐⭐')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`review:2:${staffMember.id}:${ticketId}:${member.id}`)
          .setLabel('⭐⭐')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`review:1:${staffMember.id}:${ticketId}:${member.id}`)
          .setLabel('⭐')
          .setStyle(ButtonStyle.Danger)
      );
    
    const dmChannel = await member.user.createDM();
    await dmChannel.send({ embeds: [embed], components: [row] });
    
    console.log(`⭐ Solicitud de evaluación enviada a ${member.user.username}`);
    
  } catch (error) {
    console.error('❌ Error enviando solicitud de evaluación:', error.message);
  }
}

async function handleReview(interaction) {
  try {
    await interaction.deferReply({ ephemeral: true });
    
    const parts = interaction.customId.split(':');
    const stars = parseInt(parts[1]);
    const staffId = parts[2];
    const ticketId = parts[3];
    const userId = parts[4];
    
    const guild = client.guilds.cache.first();
    if (!guild) {
      await interaction.editReply({ content: '❌ Error: No se pudo encontrar el servidor.' });
      return;
    }
    
    const staffMember = await guild.members.fetch(staffId).catch(() => null);
    
    if (!staffMember) {
      await interaction.editReply({ content: '❌ Error: No se pudo encontrar al staff member.' });
      return;
    }
    
    const starRating = '⭐'.repeat(stars);
    
    const reviewEmbed = new EmbedBuilder()
      .setColor(stars >= 4 ? '#00FF00' : stars === 3 ? '#FFA500' : '#FF0000')
      .setTitle('⭐ Nueva Evaluación de Soporte')
      .setDescription(`**Usuario:** ${interaction.user.username}\n**Staff:** ${staffMember.user.username}`)
      .addFields(
        { name: '🎫 Ticket', value: ticketId, inline: true },
        { name: '⭐ Calificación', value: `${starRating} (${stars}/5)`, inline: true },
        { name: '📅 Fecha', value: new Date().toLocaleString('es-ES'), inline: true }
      )
      .setFooter({ text: 'El Patio RP - Sistema de Evaluación' })
      .setTimestamp();
    
    const reviewChannel = guild.channels.cache.get(CONFIG.REVIEW_CHANNEL_ID);
    
    if (reviewChannel) {
      await reviewChannel.send({ embeds: [reviewEmbed] });
      console.log(`⭐ Evaluación publicada: ${interaction.user.username} -> ${staffMember.user.username} = ${stars} estrellas`);
    } else {
      console.error('❌ Canal de reseñas no encontrado');
    }
    
    await interaction.editReply({
      content: `✅ ¡Gracias por tu evaluación! Has calificado con ${starRating}`,
    });
    
    try {
      await interaction.message.delete();
    } catch (error) {
      console.log('ℹ️ No se pudo eliminar el mensaje original de evaluación');
    }
    
  } catch (error) {
    console.error('❌ Error procesando evaluación:', error);
    try {
      await interaction.editReply({ content: '❌ Hubo un error al procesar tu evaluación. Por favor intenta nuevamente.' });
    } catch (e) {
      console.error('❌ Error enviando mensaje de error:', e);
    }
  }
}

// ===============================
// 🎵 SISTEMA DE AUDIO PROFESIONAL
// ===============================

function checkAudioFiles() {
  console.log("\n🔍 Verificando archivos de audio...");
  let allFilesExist = true;
  
  for (const [key, filePath] of Object.entries(CONFIG.AUDIO_FILES)) {
    const exists = fs.existsSync(filePath);
    console.log(`${exists ? '✅' : '❌'} ${key}: ${filePath}`);
    if (!exists) allFilesExist = false;
  }
  
  console.log("");
  return allFilesExist;
}

async function connectToVoiceChannel(channel) {
  try {
    console.log(`🔌 Conectando a: ${channel.name}`);

    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: false
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
      } catch (error) {
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

// ===============================
// 🎵 REPRODUCIR AUDIO (CORE)
// ===============================

async function playAudio(connection, channelId, audioFile, volume = 1.0, description = "Audio") {
  return new Promise((resolve, reject) => {
    try {
      if (!fs.existsSync(audioFile)) {
        console.error(`❌ Archivo no encontrado: ${audioFile}`);
        reject(new Error('Archivo no encontrado'));
        return;
      }

      console.log(`🔊 Reproduciendo ${description}: ${path.basename(audioFile)} (Vol: ${volume * 100}%)`);

      const player = createAudioPlayer();
      const resource = createAudioResource(audioFile, {
        inlineVolume: true,
        inputType: StreamType.Arbitrary
      });

      resource.volume.setVolume(volume);
      connection.subscribe(player);
      botState.currentPlayers.set(channelId, player);

      player.play(resource);

      player.on(AudioPlayerStatus.Idle, () => {
        console.log(`✅ ${description} finalizado`);
        botState.currentPlayers.delete(channelId);
        resolve();
      });

      player.on('error', error => {
        console.error(`❌ Error en ${description}:`, error);
        botState.currentPlayers.delete(channelId);
        reject(error);
      });

    } catch (error) {
      console.error(`❌ Error reproduciendo ${description}:`, error);
      reject(error);
    }
  });
}

// ===============================
// 🎼 SECUENCIA CALL CENTER PROFESIONAL
// ===============================

async function startCallCenterSequence(connection, channelId, member) {
  try {
    console.log(`\n╔════════════════════════════════════════════════╗`);
    console.log(`║  🎼 INICIANDO SECUENCIA CALL CENTER PROFESIONAL ║`);
    console.log(`║  👤 Usuario: ${member.user.username.padEnd(30)}║`);
    console.log(`╚════════════════════════════════════════════════╝\n`);

    botState.cycleCounters.set(channelId, 0);

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 🎵 PASO 1: Música de Bienvenida (8 segundos)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log(`📻 [PASO 1] Música de Bienvenida (8s)`);
    await playAudio(connection, channelId, CONFIG.AUDIO_FILES.WELCOME_MUSIC, 0.35, "🎵 Música Intro");
    await wait(CONFIG.TRANSITION_BUFFER);

    if (!await checkChannelHasUsers(channelId)) return;

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 🎙️ PASO 2: Primera Voz (Atendiendo)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log(`📻 [PASO 2] Voz: "Estamos atendiendo su llamada..."`);
    await playAudio(connection, channelId, CONFIG.AUDIO_FILES.VOICE_WAITING, 1.0, "🎙️ Voz Atendiendo");
    await wait(CONFIG.TRANSITION_BUFFER);

    if (!await checkChannelHasUsers(channelId)) return;

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 🎵 PASO 3: Música Intermedia (15 segundos)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log(`📻 [PASO 3] Música de Espera (15s)`);
    await playAudio(connection, channelId, CONFIG.AUDIO_FILES.WELCOME_MUSIC, 0.28, "🎵 Música Espera");
    await wait(CONFIG.TRANSITION_BUFFER);

    if (!await checkChannelHasUsers(channelId)) return;

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 🎙️ PASO 4: Voz VIP/Donador o Normal
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    let roleVoice = CONFIG.AUDIO_FILES.VOICE_WAITING;
    let roleDesc = "Normal";
    
    if (isVIP(member)) {
      roleVoice = CONFIG.AUDIO_FILES.VOICE_VIP;
      roleDesc = "VIP 👑";
    } else if (isDonator(member)) {
      roleVoice = CONFIG.AUDIO_FILES.VOICE_VIP;
      roleDesc = "Donador ⭐";
    }
    
    console.log(`📻 [PASO 4] Voz Rol: ${roleDesc}`);
    await playAudio(connection, channelId, roleVoice, 1.0, `🎙️ Voz ${roleDesc}`);
    await wait(CONFIG.TRANSITION_BUFFER);

    if (!await checkChannelHasUsers(channelId)) return;

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 🔍 PASO 5: Verificar Staff y Voz de No Disponible
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const channel = client.channels.cache.get(channelId);
    const availableStaff = getAvailableStaff(channel.guild);
    
    if (availableStaff.length === 0) {
      console.log(`📻 [PASO 5] ⚠️ Sin Staff - Reproduciendo voz especial`);
      await wait(CONFIG.MUSIC_BETWEEN_VOICES);
      await playAudio(connection, channelId, CONFIG.AUDIO_FILES.VOICE_NO_STAFF, 1.0, "🎙️ Voz Sin Staff");
      await wait(CONFIG.TRANSITION_BUFFER);
    } else {
      console.log(`📻 [PASO 5] ✅ Staff disponible: ${availableStaff.length}`);
    }

    if (!await checkChannelHasUsers(channelId)) return;

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 🔄 PASO 6: Iniciar Ciclo Continuo
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log(`📻 [PASO 6] 🔄 Iniciando ciclo continuo...\n`);
    await startMusicVoiceCycle(connection, channelId);

  } catch (error) {
    console.error('❌ Error en secuencia call center:', error);
  }
}

// ===============================
// 🔄 CICLO CONTINUO: Música → Voz → Música → Voz...
// ===============================

async function startMusicVoiceCycle(connection, channelId) {
  try {
    if (!await checkChannelHasUsers(channelId)) return;

    const currentCycle = (botState.cycleCounters.get(channelId) || 0) + 1;
    botState.cycleCounters.set(channelId, currentCycle);
    
    // Calcular duración de música (incrementa progresivamente)
    let musicDuration = CONFIG.MUSIC_CYCLE_BASE + ((currentCycle - 1) * CONFIG.MUSIC_CYCLE_INCREMENT);
    if (musicDuration > CONFIG.MAX_MUSIC_DURATION) {
      musicDuration = CONFIG.MAX_MUSIC_DURATION;
    }
    
    console.log(`\n┌─────────────────────────────────────┐`);
    console.log(`│  🔄 CICLO #${currentCycle} - MÚSICA + VOZ       │`);
    console.log(`└─────────────────────────────────────┘`);
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 🎵 Reproducir Música
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log(`🎵 Reproduciendo música (${musicDuration / 1000}s)...`);
    await playAudio(connection, channelId, CONFIG.AUDIO_FILES.WELCOME_MUSIC, 0.25, "🎵 Música Ciclo");
    await wait(CONFIG.TRANSITION_BUFFER);

    if (!await checkChannelHasUsers(channelId)) return;

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 🎙️ Reproducir Voz Apropiada
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const channel = client.channels.cache.get(channelId);
    if (!channel) return;
    
    const humans = channel.members.filter(m => !m.user.bot);
    if (humans.size === 0) return;

    const availableStaff = getAvailableStaff(channel.guild);
    let voiceFile = CONFIG.AUDIO_FILES.VOICE_WAITING;
    let voiceDesc = "Atendiendo";
    
    // Verificar sin staff primero
    if (availableStaff.length === 0) {
      voiceFile = CONFIG.AUDIO_FILES.VOICE_NO_STAFF;
      voiceDesc = "Sin Staff Disponible ⚠️";
    } else {
      // Verificar VIP/Donador
      for (const [id, member] of humans) {
        if (isVIP(member)) {
          voiceFile = CONFIG.AUDIO_FILES.VOICE_VIP;
          voiceDesc = "VIP 👑";
          break;
        } else if (isDonator(member)) {
          voiceFile = CONFIG.AUDIO_FILES.VOICE_VIP;
          voiceDesc = "Donador ⭐";
          break;
        }
      }
    }

    console.log(`🎙️ Reproduciendo voz: ${voiceDesc}`);
    await playAudio(connection, channelId, voiceFile, 1.0, `🎙️ Voz ${voiceDesc}`);
    await wait(CONFIG.TRANSITION_BUFFER);

    if (!await checkChannelHasUsers(channelId)) return;

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 🔄 Continuar con el Siguiente Ciclo
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log(`✅ Ciclo #${currentCycle} completado. Próximo ciclo en 2s...`);
    await wait(2000);
    
    await startMusicVoiceCycle(connection, channelId);

  } catch (error) {
    console.error('❌ Error en ciclo música-voz:', error);
  }
}

// ===============================
// 🛑 DETENER TODO AUDIO
// ===============================

function stopAllAudio(channelId) {
  console.log(`🛑 Deteniendo audio del canal`);

  const timer = botState.audioTimers.get(channelId);
  if (timer) {
    clearTimeout(timer);
    botState.audioTimers.delete(channelId);
  }

  const player = botState.currentPlayers.get(channelId);
  if (player) {
    player.stop();
    botState.currentPlayers.delete(channelId);
  }
  
  botState.cycleCounters.delete(channelId);
  botState.audioSequences.delete(channelId);
}

// ===============================
// 🔌 GESTIÓN DE CONEXIÓN
// ===============================

async function manageWaitingChannelAudio(channel, member) {
  console.log(`\n📞 Gestionando audio para: ${member.user.username}`);

  let connection = botState.activeConnections.get(channel.id);

  if (!connection) {
    connection = await connectToVoiceChannel(channel);
    if (!connection) return;
  }

  await wait(1000);
  await startCallCenterSequence(connection, channel.id, member);

  console.log(`✅ Sistema de audio call center iniciado\n`);
}

function disconnectFromChannel(channel) {
  console.log(`👋 Desconectando de: ${channel.name}`);
  stopAllAudio(channel.id);

  const connection = botState.activeConnections.get(channel.id);
  if (connection) {
    connection.destroy();
    botState.activeConnections.delete(channel.id);
  }
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

// ===============================
// DETECCIÓN Y ASIGNACIÓN DE STAFF
// ===============================

function getAvailableStaff(guild) {
  const staffChannel = guild.channels.cache.get(CONFIG.STAFF_AVAILABLE_CHANNEL_ID);
  
  if (!staffChannel) {
    console.log('❌ Canal de staff no encontrado');
    return [];
  }
  
  const available = staffChannel.members
    .filter(member => !member.user.bot && isStaff(member))
    .map(member => member);
  
  return available;
}

function findEmptySupportChannel(guild) {
  for (const channelId of CONFIG.SUPPORT_CHANNELS) {
    const channel = guild.channels.cache.get(channelId);
    
    if (!channel) continue;
    
    const hasUsers = channel.members.some(m => !m.user.bot);
    
    if (!hasUsers) {
      console.log(`📞 Canal vacío encontrado: ${channel.name}`);
      return channel;
    }
  }
  
  console.log('❌ No hay canales de soporte vacíos');
  return null;
}

async function assignUserToStaff(guild) {
  if (botState.queue.length === 0) {
    return;
  }
  
  const availableStaff = getAvailableStaff(guild);
  
  if (availableStaff.length === 0) {
    return;
  }
  
  const supportChannel = findEmptySupportChannel(guild);
  
  if (!supportChannel) {
    return;
  }
  
  const nextUser = botState.queue[0];
  const staff = availableStaff[0];
  
  console.log(`\n🎯 ========================================`);
  console.log(`🎯 ASIGNANDO SOPORTE`);
  console.log(`👤 Usuario: ${nextUser.member.user.username}`);
  console.log(`👨‍💼 Staff: ${staff.user.username}`);
  console.log(`📞 Canal: ${supportChannel.name}`);
  console.log(`🎯 ========================================`);
  
  try {
    await nextUser.member.voice.setChannel(supportChannel);
    await nextUser.member.voice.setMute(false);
    console.log(`✅ Usuario movido a ${supportChannel.name}`);
    
    await staff.voice.setChannel(supportChannel);
    console.log(`✅ Staff movido a ${supportChannel.name}`);
    
    botState.activeSupport.set(nextUser.userId, {
      staffId: staff.id,
      channelId: supportChannel.id,
      startTime: Date.now(),
      ticketId: nextUser.ticketId
    });
    
    removeFromQueue(nextUser.userId);
    
    const dmInfo = botState.userDMMessages.get(nextUser.userId);
    if (dmInfo) {
      try {
        const dmChannel = await nextUser.member.user.createDM();
        const msg = await dmChannel.messages.fetch(dmInfo.messageId);
        
        const embed = new EmbedBuilder()
          .setColor('#00FF00')
          .setTitle('✅ Soporte Asignado')
          .setDescription(`Estás siendo atendido por **${staff.user.username}**`)
          .addFields(
            { name: '📞 Canal', value: supportChannel.name, inline: true },
            { name: '🎫 Ticket', value: nextUser.ticketId, inline: true }
          )
          .setFooter({ text: 'El Patio RP - Sistema de Soporte' })
          .setTimestamp();
        
        await msg.edit({ embeds: [embed] });
        
      } catch (error) {
        console.error('❌ Error actualizando DM:', error.message);
      }
      
      botState.userDMMessages.delete(nextUser.userId);
    }
    
    await updateAllQueueMessages();
    
    setTimeout(() => assignUserToStaff(guild), 2000);
    
  } catch (error) {
    console.error('❌ Error asignando usuario:', error.message);
  }
}

async function notifyStaffChannel(guild) {
  try {
    const staffChannel = guild.channels.cache.get(CONFIG.STAFF_TEXT_CHANNEL_ID);
    
    if (!staffChannel) return;
    
    const usersWaiting = botState.queue.map((entry, index) => {
      const waitTime = getWaitingTime(entry);
      const priorityEmoji = entry.priority === 3 ? '👑' : entry.priority === 2 ? '⭐' : '🟢';
      return `${priorityEmoji} **#${index + 1}** - ${entry.member.user.username} (${waitTime} min)`;
    }).join('\n');
    
    const embed = new EmbedBuilder()
      .setColor('#FF0000')
      .setTitle('🚨 Usuarios Esperando Soporte')
      .setDescription(usersWaiting || 'No hay usuarios')
      .addFields(
        { name: '👥 Total', value: `${botState.queue.length}`, inline: true },
        { name: '🎯 Próximo', value: botState.queue[0]?.member.user.username || 'N/A', inline: true }
      )
      .setFooter({ text: 'El Patio RP - Sistema de Soporte' })
      .setTimestamp();
    
    if (botState.lastStaffNotification) {
      try {
        const msg = await staffChannel.messages.fetch(botState.lastStaffNotification);
        await msg.edit({ embeds: [embed] });
      } catch (error) {
        const newMsg = await staffChannel.send({ embeds: [embed] });
        botState.lastStaffNotification = newMsg.id;
      }
    } else {
      const msg = await staffChannel.send({ embeds: [embed] });
      botState.lastStaffNotification = msg.id;
    }
    
  } catch (error) {
    console.error('❌ Error notificando staff:', error.message);
  }
}

// ===============================
// MONITOREO DE STAFF NO DISPONIBLE
// ===============================

async function startStaffUnavailableTimer(member, guild) {
  const existingTimer = botState.staffUnavailableTimers.get(member.id);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }
  
  const timer = setTimeout(async () => {
    await notifyStaffUnavailable(member, guild);
  }, CONFIG.STAFF_UNAVAILABLE_WARNING_TIME);
  
  botState.staffUnavailableTimers.set(member.id, timer);
  console.log(`⏱️ Temporizador iniciado para ${member.user.username}`);
}

async function notifyStaffUnavailable(member, guild) {
  try {
    const timeInMinutes = CONFIG.STAFF_UNAVAILABLE_WARNING_TIME / 60000;
    
    const dmEmbed = new EmbedBuilder()
      .setColor('#FFA500')
      .setTitle('⚠️ Recordatorio - Canal No Disponible')
      .setDescription(`Has estado en el canal de **Staff No Disponible** por **${timeInMinutes} minutos**.`)
      .addFields(
        { name: '💬 Mensaje', value: 'Entendemos que necesitas descansar, pero el equipo necesita tu apoyo.' }
      )
      .setFooter({ text: 'El Patio RP - Sistema de Soporte' })
      .setTimestamp();
    
    try {
      await member.user.send({ embeds: [dmEmbed] });
      console.log(`📧 Notificación enviada a ${member.user.username}`);
    } catch (error) {
      console.error(`❌ Error enviando DM:`, error.message);
    }
    
  } catch (error) {
    console.error('❌ Error notificando staff:', error.message);
  }
}

function cancelStaffUnavailableTimer(memberId) {
  const timer = botState.staffUnavailableTimers.get(memberId);
  if (timer) {
    clearTimeout(timer);
    botState.staffUnavailableTimers.delete(memberId);
  }
}

// ===============================
// ACTUALIZACIÓN DE COLA
// ===============================

function startQueueUpdater(guild) {
  setInterval(async () => {
    if (botState.queue.length > 0) {
      await updateAllQueueMessages();
      
      const availableStaff = getAvailableStaff(guild);
      if (availableStaff.length > 0) {
        await assignUserToStaff(guild);
      }
    }
  }, CONFIG.QUEUE_UPDATE_INTERVAL);
}

// ===============================
// COMANDOS SLASH - HANDLERS
// ===============================

async function handleDescansoCommand(interaction) {
  if (!isStaff(interaction.member)) {
    await interaction.reply({ content: '❌ Este comando es solo para staff.', ephemeral: true });
    return;
  }
  
  const minutos = interaction.options.getInteger('minutos');
  const guild = interaction.guild;
  const staffBusyChannel = guild.channels.cache.get(CONFIG.STAFF_BUSY_CHANNEL_ID);
  
  if (!staffBusyChannel) {
    await interaction.reply({ content: '❌ Canal de staff no disponible no configurado.', ephemeral: true });
    return;
  }
  
  try {
    await interaction.member.voice.setChannel(staffBusyChannel);
    
    const embed = new EmbedBuilder()
      .setColor('#FFA500')
      .setTitle('☕ Descanso Programado')
      .setDescription(`Has sido movido al canal de **Staff No Disponible**`)
      .addFields(
        { name: '⏱️ Duración', value: `${minutos} minuto(s)`, inline: true },
        { name: '🔔 Recordatorio', value: `Recibirás un aviso cuando termine`, inline: true }
      )
      .setFooter({ text: 'El Patio RP - Sistema de Soporte' })
      .setTimestamp();
    
    await interaction.reply({ embeds: [embed], ephemeral: true });
    
    setTimeout(async () => {
      try {
        const reminderEmbed = new EmbedBuilder()
          .setColor('#00FF00')
          .setTitle('⏰ Fin del Descanso')
          .setDescription(`Tu descanso de **${minutos} minuto(s)** ha terminado.`)
          .setFooter({ text: 'El Patio RP - Sistema de Soporte' })
          .setTimestamp();
        
        await interaction.member.user.send({ embeds: [reminderEmbed] });
      } catch (error) {
        console.error('❌ Error enviando recordatorio:', error.message);
      }
    }, minutos * 60000);
    
    console.log(`☕ ${interaction.user.username} tomó descanso de ${minutos} minutos`);
    
  } catch (error) {
    await interaction.reply({ content: '❌ Error al tomar descanso.', ephemeral: true });
  }
}

async function handleVolverCommand(interaction) {
  if (!isStaff(interaction.member)) {
    await interaction.reply({ content: '❌ Este comando es solo para staff.', ephemeral: true });
    return;
  }
  
  const guild = interaction.guild;
  const staffAvailableChannel = guild.channels.cache.get(CONFIG.STAFF_AVAILABLE_CHANNEL_ID);
  
  if (!staffAvailableChannel) {
    await interaction.reply({ content: '❌ Canal de staff disponible no configurado.', ephemeral: true });
    return;
  }
  
  try {
    await interaction.member.voice.setChannel(staffAvailableChannel);
    
    const embed = new EmbedBuilder()
      .setColor('#00FF00')
      .setTitle('✅ De Vuelta al Servicio')
      .setDescription(`Has sido movido al canal de **Staff Disponible**`)
      .setFooter({ text: 'El Patio RP - Sistema de Soporte' })
      .setTimestamp();
    
    await interaction.reply({ embeds: [embed], ephemeral: true });
    
    cancelStaffUnavailableTimer(interaction.member.id);
    
    console.log(`✅ ${interaction.user.username} volvió al servicio`);
    
  } catch (error) {
    await interaction.reply({ content: '❌ Error al volver.', ephemeral: true });
  }
}

async function handleEstadisticasCommand(interaction) {
  if (!isStaff(interaction.member)) {
    await interaction.reply({ content: '❌ Este comando es solo para staff.', ephemeral: true });
    return;
  }
  
  const guild = interaction.guild;
  const availableStaff = getAvailableStaff(guild);
  const activeSupports = botState.activeSupport.size;
  const queueLength = botState.queue.length;
  
  const embed = new EmbedBuilder()
    .setColor('#00BFFF')
    .setTitle('📊 Estadísticas del Sistema')
    .addFields(
      { name: '👥 Usuarios en Cola', value: `${queueLength}`, inline: true },
      { name: '👨‍💼 Staff Disponible', value: `${availableStaff.length}`, inline: true },
      { name: '🔧 Soportes Activos', value: `${activeSupports}`, inline: true }
    )
    .setFooter({ text: 'El Patio RP - Sistema de Soporte' })
    .setTimestamp();
  
  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleColaCommand(interaction) {
  const queueLength = botState.queue.length;
  
  if (queueLength === 0) {
    const embed = new EmbedBuilder()
      .setColor('#00FF00')
      .setTitle('📭 Cola Vacía')
      .setDescription('No hay usuarios esperando.')
      .setFooter({ text: 'El Patio RP - Sistema de Soporte' })
      .setTimestamp();
    
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }
  
  const queueList = botState.queue.slice(0, 10).map((entry, index) => {
    const waitTime = getWaitingTime(entry);
    const priorityEmoji = entry.priority === 3 ? '👑' : entry.priority === 2 ? '⭐' : '🟢';
    return `${priorityEmoji} **#${index + 1}** - ${entry.member.user.username} (${waitTime} min)`;
  }).join('\n');
  
  const embed = new EmbedBuilder()
    .setColor('#FFA500')
    .setTitle('📋 Cola de Espera')
    .setDescription(queueList)
    .addFields(
      { name: '👥 Total', value: `${queueLength}`, inline: true },
      { name: '🎯 Próximo', value: botState.queue[0].member.user.username, inline: true }
    )
    .setFooter({ text: queueLength > 10 ? `Mostrando 10 de ${queueLength}` : 'El Patio RP' })
    .setTimestamp();
  
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
  const staffAvailableId = CONFIG.STAFF_AVAILABLE_CHANNEL_ID;
  const staffBusyId = CONFIG.STAFF_BUSY_CHANNEL_ID;
  
  if (isStaff(member)) {
    if (newState.channelId === staffBusyId && oldState.channelId !== staffBusyId) {
      await startStaffUnavailableTimer(member, guild);
    }
    
    if (oldState.channelId === staffBusyId && newState.channelId !== staffBusyId) {
      cancelStaffUnavailableTimer(member.id);
    }
  }
  
  if (newState.channelId === waitingId && oldState.channelId !== waitingId) {
    console.log(`\n📥 ${member.user.username} entró a espera`);
    
    const channel = newState.channel;
    
    addToQueue(member);
    await sendOrUpdateQueueDM(member);
    await manageWaitingChannelAudio(channel, member);
    
    setTimeout(async () => {
      await assignUserToStaff(guild);
    }, CONFIG.TIME_BEFORE_ASSIGN);
  }
  
  if (oldState.channelId === waitingId && newState.channelId !== waitingId) {
    console.log(`\n📤 ${member.user.username} salió de espera`);
    
    removeFromQueue(member.id);
    botState.userDMMessages.delete(member.id);
    
    const channel = oldState.channel;
    const humans = channel.members.filter(m => !m.user.bot);
    
    if (humans.size === 0) {
      disconnectFromChannel(channel);
    } else {
      console.log(`🔄 Continuando audio para ${humans.size} usuarios restantes`);
    }
    
    await updateAllQueueMessages();
  }
  
  const supportInfo = botState.activeSupport.get(member.id);
  
  if (supportInfo && oldState.channelId === supportInfo.channelId && newState.channelId !== supportInfo.channelId) {
    console.log(`\n✅ ${member.user.username} terminó soporte`);
    
    const duration = Math.floor((Date.now() - supportInfo.startTime) / 60000);
    
    const staffMember = guild.members.cache.get(supportInfo.staffId);
    if (staffMember) {
      await sendReviewRequest(member, staffMember, supportInfo.ticketId, duration);
    }
    
    botState.activeSupport.delete(member.id);
    
    if (staffMember && staffMember.voice.channelId === supportInfo.channelId) {
      const staffChannel = guild.channels.cache.get(CONFIG.STAFF_AVAILABLE_CHANNEL_ID);
      if (staffChannel) {
        try {
          await staffMember.voice.setChannel(staffChannel);
          console.log(`👨‍💼 Staff devuelto a disponibles`);
        } catch (error) {
          console.error('❌ Error moviendo staff:', error.message);
        }
      }
    }
    
    setTimeout(() => assignUserToStaff(guild), 2000);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (interaction.isButton()) {
    if (interaction.customId.startsWith('review:')) {
      await handleReview(interaction);
    }
  }
  
  if (interaction.isChatInputCommand()) {
    try {
      switch (interaction.commandName) {
        case 'descanso':
          await handleDescansoCommand(interaction);
          break;
        case 'volver':
          await handleVolverCommand(interaction);
          break;
        case 'estadisticas':
          await handleEstadisticasCommand(interaction);
          break;
        case 'cola':
          await handleColaCommand(interaction);
          break;
      }
    } catch (error) {
      console.error('❌ Error manejando comando:', error);
      if (!interaction.replied) {
        await interaction.reply({ content: '❌ Error ejecutando comando.', ephemeral: true });
      }
    }
  }
});

// ===============================
// BOT LISTO
// ===============================

client.once("ready", async () => {
  console.log(`\n╔════════════════════════════════════════════════╗`);
  console.log(`║  ✅ EL PATIO RP - CALL CENTER V4.0 ULTRA PRO  ║`);
  console.log(`║  👤 ${client.user.tag.padEnd(37)}║`);
  console.log(`╚════════════════════════════════════════════════╝\n`);
  
  checkAudioFiles();
  
  const rest = new REST({ version: '10' }).setToken(CONFIG.TOKEN);
  
  try {
    console.log('🔄 Registrando comandos slash...');
    
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands },
    );
    
    console.log('✅ Comandos slash registrados\n');
  } catch (error) {
    console.error('❌ Error registrando comandos:', error);
  }
  
  const guild = client.guilds.cache.first();
  
  if (guild) {
    startQueueUpdater(guild);
    console.log(`🔄 Sistema de cola iniciado`);
    
    const waitingChannel = guild.channels.cache.get(CONFIG.WAITING_CHANNEL_ID);
    
    if (waitingChannel && waitingChannel.isVoiceBased()) {
      const humans = waitingChannel.members.filter(m => !m.user.bot);
      
      if (humans.size > 0) {
        console.log(`\n🔄 ${humans.size} usuario(s) esperando\n`);
        
        for (const [id, member] of humans) {
          addToQueue(member);
          await sendOrUpdateQueueDM(member);
        }
        
        await manageWaitingChannelAudio(waitingChannel, humans.first());
        setTimeout(() => assignUserToStaff(guild), CONFIG.TIME_BEFORE_ASSIGN);
      }
    }
  }
  
  console.log(`\n✅ BOT LISTO Y OPERATIVO`);
  console.log(`╔════════════════════════════════════════════════╗`);
  console.log(`║  🎵 SISTEMA CALL CENTER PROFESIONAL            ║`);
  console.log(`║  ✅ Balance Música/Voz: OPTIMIZADO             ║`);
  console.log(`║  ✅ Secuencia: Música → Voz → Música → Voz     ║`);
  console.log(`║  ✅ Detección VIP/Donador/Sin Staff: ACTIVA    ║`);
  console.log(`║  ⭐ Sistema de Evaluación: FUNCIONAL           ║`);
  console.log(`║  🎮 Comandos: /descanso /volver /stats /cola   ║`);
  console.log(`╚════════════════════════════════════════════════╝\n`);
});

// ===============================
// ERRORES
// ===============================

process.on('unhandledRejection', error => {
  console.error('\n❌ ERROR:', error);
});

client.on('error', error => {
  console.error('\n❌ ERROR CLIENTE:', error);
});

// ===============================
// LOGIN
// ===============================

console.log("🚀 Iniciando El Patio RP Call Center V4.0 ULTRA PRO...\n");

client.login(CONFIG.TOKEN).catch(err => {
  console.error("❌ Error login:", err);
  process.exit(1);
});
