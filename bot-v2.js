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
  REVIEW_CHANNEL_ID: "1423880600422711377", // Canal de reseñas

  SUPPORT_CHANNELS: process.env.SUPPORT_CHANNELS?.split(',').map(id => id.trim()) || [],

  STAFF_ROLES: process.env.STAFF_ROLES?.split(',').map(id => id.trim()) || [],
  VIP_ROLES: process.env.VIP_ROLES?.split(',').map(id => id.trim()) || [],
  DONATOR_ROLES: process.env.DONATOR_ROLES?.split(',').map(id => id.trim()) || [],

  AUDIO_FILES: {
    WELCOME_MUSIC: "./musica_espera.mp3",        // Música de bienvenida
    VOICE_WAITING: "./voz_atendiendo.mp3",       // Voz normal: "Estamos atendiendo..."
    VOICE_NO_STAFF: "./voz_no_disponible.mp3",   // Voz sin staff
    VOICE_VIP: "./voz_vip.mp3"                   // Voz VIP/Donador
  },

  WELCOME_MUSIC_DURATION: 15000,      // 15 segundos de música de bienvenida
  INITIAL_MUSIC_DURATION: 30000,      // 30 segundos de música entre voces
  MUSIC_INCREMENT: 5000,               // Incremento de 5 segundos
  VOICE_OVERLAP_BUFFER: 1500,         // Buffer para evitar cortes (1.5 segundos)
  
  TIME_BEFORE_ASSIGN: 5000,
  QUEUE_UPDATE_INTERVAL: 10000,
  NO_STAFF_WARNING_TIME: 180000,      // 3 minutos sin atención
  STAFF_UNAVAILABLE_WARNING_TIME: 1800000, // 30 minutos en no disponible

  AVERAGE_SUPPORT_TIME: 3
};

// ===============================
// ESTADO DEL BOT
// ===============================

const botState = {
  // Audio - Sistema mejorado con secuencia
  activeConnections: new Map(),
  audioSequences: new Map(),        // Secuencias de audio por canal
  currentPlayers: new Map(),        // Reproductor actual
  audioTimers: new Map(),
  musicCycles: new Map(),
  isFirstPlay: new Map(),           // Para controlar reproducción inicial
  
  // Cola de soporte
  queue: [],
  
  // Usuarios siendo atendidos
  activeSupport: new Map(),
  
  // Mensajes DM
  userDMMessages: new Map(),
  
  // Staff
  lastStaffNotification: null,
  staffUnavailableTimers: new Map(),
  noStaffWarnings: new Map(),
  
  // Sistema de evaluación
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
app.get("/", (req, res) => res.send("✅ El Patio RP - Call Center V3.3 OPTIMIZADO"));
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
// SISTEMA DE EVALUACIÓN (CORREGIDO)
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
    
    // Eliminar el mensaje original con los botones
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
// SISTEMA DE AUDIO MEJORADO CON SECUENCIAS
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
// 🎵 REPRODUCIR AUDIO (MEJORADO PARA EVITAR CORTES)
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
// 🎼 SECUENCIA DE AUDIO COMPLETA
// ===============================

async function startAudioSequence(connection, channelId, member) {
  try {
    console.log(`\n🎼 ========================================`);
    console.log(`🎼 INICIANDO SECUENCIA DE AUDIO`);
    console.log(`👤 Usuario: ${member.user.username}`);
    console.log(`🎼 ========================================\n`);

    // Marcar como primera reproducción
    botState.isFirstPlay.set(channelId, true);
    botState.musicCycles.set(channelId, 0);

    // PASO 1: Música de bienvenida (15 segundos)
    console.log(`📻 PASO 1: Música de bienvenida`);
    await playAudio(connection, channelId, CONFIG.AUDIO_FILES.WELCOME_MUSIC, 0.3, "Música de Bienvenida");
    await wait(CONFIG.VOICE_OVERLAP_BUFFER);

    // Verificar si el canal aún tiene usuarios
    if (!await checkChannelHasUsers(channelId)) return;

    // PASO 2: Primera voz (voz_atendiendo.mp3)
    console.log(`📻 PASO 2: Voz de atención`);
    await playAudio(connection, channelId, CONFIG.AUDIO_FILES.VOICE_WAITING, 1.0, "Voz Atendiendo");
    await wait(CONFIG.VOICE_OVERLAP_BUFFER);

    if (!await checkChannelHasUsers(channelId)) return;

    // PASO 3: Música de espera nuevamente
    console.log(`📻 PASO 3: Música de espera`);
    await playAudio(connection, channelId, CONFIG.AUDIO_FILES.WELCOME_MUSIC, 0.25, "Música de Espera");
    await wait(CONFIG.VOICE_OVERLAP_BUFFER);

    if (!await checkChannelHasUsers(channelId)) return;

    // PASO 4: Voz según rol (VIP/Donador o normal)
    console.log(`📻 PASO 4: Voz según rol`);
    let roleVoice = CONFIG.AUDIO_FILES.VOICE_WAITING;
    
    if (isVIP(member)) {
      roleVoice = CONFIG.AUDIO_FILES.VOICE_VIP;
      console.log(`👑 Usuario VIP: ${member.user.username}`);
    } else if (isDonator(member)) {
      roleVoice = CONFIG.AUDIO_FILES.VOICE_VIP;
      console.log(`⭐ Usuario Donador: ${member.user.username}`);
    }
    
    await playAudio(connection, channelId, roleVoice, 1.0, "Voz Rol");
    await wait(CONFIG.VOICE_OVERLAP_BUFFER);

    if (!await checkChannelHasUsers(channelId)) return;

    // PASO 5: Verificar staff disponible
    console.log(`📻 PASO 5: Verificar staff disponible`);
    const channel = client.channels.cache.get(channelId);
    const availableStaff = getAvailableStaff(channel.guild);
    
    if (availableStaff.length === 0) {
      console.log(`🚨 Sin staff disponible`);
      await playAudio(connection, channelId, CONFIG.AUDIO_FILES.VOICE_NO_STAFF, 1.0, "Voz Sin Staff");
      await wait(CONFIG.VOICE_OVERLAP_BUFFER);
    }

    if (!await checkChannelHasUsers(channelId)) return;

    // PASO 6: Iniciar ciclo de música
    console.log(`📻 PASO 6: Iniciando ciclo de música continua`);
    botState.isFirstPlay.set(channelId, false);
    await continueMusicCycle(connection, channelId);

  } catch (error) {
    console.error('❌ Error en secuencia de audio:', error);
  }
}

// ===============================
// 🔄 CICLO CONTINUO DE MÚSICA
// ===============================

async function continueMusicCycle(connection, channelId) {
  try {
    if (!await checkChannelHasUsers(channelId)) return;

    const currentCycle = (botState.musicCycles.get(channelId) || 0) + 1;
    botState.musicCycles.set(channelId, currentCycle);
    
    const duration = CONFIG.INITIAL_MUSIC_DURATION + (currentCycle * CONFIG.MUSIC_INCREMENT);
    
    console.log(`🔄 Ciclo ${currentCycle}: Música por ${duration / 1000} segundos`);
    
    // Reproducir música por la duración calculada
    const musicPlayer = createAudioPlayer();
    const resource = createAudioResource(CONFIG.AUDIO_FILES.WELCOME_MUSIC, {
      inlineVolume: true,
      inputType: StreamType.Arbitrary
    });
    
    resource.volume.setVolume(0.25);
    connection.subscribe(musicPlayer);
    botState.currentPlayers.set(channelId, musicPlayer);
    musicPlayer.play(resource);

    // Programar la siguiente acción
    const timer = setTimeout(async () => {
      musicPlayer.stop();
      await wait(CONFIG.VOICE_OVERLAP_BUFFER);
      
      if (!await checkChannelHasUsers(channelId)) return;
      
      // Reproducir voz intermedia
      await playIntermediateVoice(connection, channelId);
      
      // Continuar con el siguiente ciclo
      await continueMusicCycle(connection, channelId);
      
    }, duration);

    botState.audioTimers.set(channelId, timer);

  } catch (error) {
    console.error('❌ Error en ciclo de música:', error);
  }
}

// ===============================
// 🎙️ VOZ INTERMEDIA
// ===============================

async function playIntermediateVoice(connection, channelId) {
  try {
    const channel = client.channels.cache.get(channelId);
    if (!channel) return;
    
    const humans = channel.members.filter(m => !m.user.bot);
    if (humans.size === 0) return;

    const availableStaff = getAvailableStaff(channel.guild);
    let audioFile = CONFIG.AUDIO_FILES.VOICE_WAITING;
    
    if (availableStaff.length === 0) {
      audioFile = CONFIG.AUDIO_FILES.VOICE_NO_STAFF;
    } else {
      // Verificar VIP/Donador
      for (const [id, member] of humans) {
        if (isVIP(member) || isDonator(member)) {
          audioFile = CONFIG.AUDIO_FILES.VOICE_VIP;
          break;
        }
      }
    }

    await playAudio(connection, channelId, audioFile, 1.0, "Voz Intermedia");
    await wait(CONFIG.VOICE_OVERLAP_BUFFER);

  } catch (error) {
    console.error('❌ Error en voz intermedia:', error);
  }
}

// ===============================
// 🛑 DETENER TODO AUDIO
// ===============================

function stopAllAudio(channelId) {
  console.log(`🛑 Deteniendo todo el audio del canal`);

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
  
  botState.musicCycles.delete(channelId);
  botState.isFirstPlay.delete(channelId);
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

  // Iniciar secuencia completa
  await startAudioSequence(connection, channel.id, member);

  console.log(`✅ Sistema de audio iniciado\n`);
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

// ===============================
// UTILIDADES
// ===============================

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
  
  console.log(`👨‍💼 Staff disponible: ${available.length}`);
  
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
    console.log('📭 No hay usuarios en cola');
    return;
  }
  
  const availableStaff = getAvailableStaff(guild);
  
  if (availableStaff.length === 0) {
    console.log('❌ No hay staff disponible');
    return;
  }
  
  const supportChannel = findEmptySupportChannel(guild);
  
  if (!supportChannel) {
    console.log('❌ No hay canales de soporte disponibles');
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
    console.log(`✅ Usuario movido a ${supportChannel.name} (sin mute)`);
    
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
  console.log(`⏱️ Temporizador iniciado para ${member.user.username} en canal no disponible`);
}

async function notifyStaffUnavailable(member, guild) {
  try {
    const timeInMinutes = CONFIG.STAFF_UNAVAILABLE_WARNING_TIME / 60000;
    
    const dmEmbed = new EmbedBuilder()
      .setColor('#FFA500')
      .setTitle('⚠️ Recordatorio - Canal No Disponible')
      .setDescription(`Has estado en el canal de **Staff No Disponible** por **${timeInMinutes} minutos**.`)
      .addFields(
        { name: '💬 Mensaje', value: 'Entendemos que necesitas descansar, pero el equipo necesita tu apoyo para atender a los usuarios en espera.' }
      )
      .setFooter({ text: 'El Patio RP - Sistema de Soporte' })
      .setTimestamp();
    
    try {
      await member.user.send({ embeds: [dmEmbed] });
      console.log(`📧 Notificación enviada a ${member.user.username} (No disponible ${timeInMinutes} min)`);
    } catch (error) {
      console.error(`❌ Error enviando DM a ${member.user.username}:`, error.message);
    }
    
    const staffChannel = guild.channels.cache.get(CONFIG.STAFF_TEXT_CHANNEL_ID);
    if (staffChannel) {
      const staffNotifyEmbed = new EmbedBuilder()
        .setColor('#FFA500')
        .setTitle('⚠️ Staff en Canal No Disponible')
        .setDescription(`**${member.user.username}** lleva **${timeInMinutes} minutos** en el canal de Staff No Disponible.`)
        .addFields(
          { name: '📝 Acción requerida', value: 'Se requiere justificación del motivo de la ausencia prolongada.' }
        )
        .setFooter({ text: 'El Patio RP - Monitoreo de Staff' })
        .setTimestamp();
      
      await staffChannel.send({ embeds: [staffNotifyEmbed] });
      console.log(`📢 Alerta enviada al canal de staff sobre ${member.user.username}`);
    }
    
  } catch (error) {
    console.error('❌ Error notificando staff no disponible:', error.message);
  }
}

function cancelStaffUnavailableTimer(memberId) {
  const timer = botState.staffUnavailableTimers.get(memberId);
  if (timer) {
    clearTimeout(timer);
    botState.staffUnavailableTimers.delete(memberId);
    console.log(`⏱️ Temporizador cancelado para miembro ${memberId}`);
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
    
    // Programar recordatorio
    setTimeout(async () => {
      try {
        const reminderEmbed = new EmbedBuilder()
          .setColor('#00FF00')
          .setTitle('⏰ Fin del Descanso')
          .setDescription(`Tu descanso de **${minutos} minuto(s)** ha terminado.\n\nPuedes volver al canal de Staff Disponible cuando estés listo.`)
          .setFooter({ text: 'El Patio RP - Sistema de Soporte' })
          .setTimestamp();
        
        await interaction.member.user.send({ embeds: [reminderEmbed] });
      } catch (error) {
        console.error('❌ Error enviando recordatorio:', error.message);
      }
    }, minutos * 60000);
    
    console.log(`☕ ${interaction.user.username} tomó descanso de ${minutos} minutos`);
    
  } catch (error) {
    await interaction.reply({ content: '❌ Error al tomar descanso. Asegúrate de estar en un canal de voz.', ephemeral: true });
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
      .setDescription(`Has sido movido al canal de **Staff Disponible**\n\nEstás listo para atender usuarios.`)
      .setFooter({ text: 'El Patio RP - Sistema de Soporte' })
      .setTimestamp();
    
    await interaction.reply({ embeds: [embed], ephemeral: true });
    
    // Cancelar temporizador si existe
    cancelStaffUnavailableTimer(interaction.member.id);
    
    console.log(`✅ ${interaction.user.username} volvió al servicio`);
    
  } catch (error) {
    await interaction.reply({ content: '❌ Error al volver. Asegúrate de estar en un canal de voz.', ephemeral: true });
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
      .setDescription('No hay usuarios esperando en este momento.')
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
      { name: '👥 Total en Cola', value: `${queueLength}`, inline: true },
      { name: '🎯 Próximo', value: botState.queue[0].member.user.username, inline: true }
    )
    .setFooter({ text: queueLength > 10 ? `Mostrando 10 de ${queueLength}` : 'El Patio RP - Sistema de Soporte' })
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
  
  // MONITOREO DE STAFF NO DISPONIBLE
  if (isStaff(member)) {
    if (newState.channelId === staffBusyId && oldState.channelId !== staffBusyId) {
      await startStaffUnavailableTimer(member, guild);
    }
    
    if (oldState.channelId === staffBusyId && newState.channelId !== staffBusyId) {
      cancelStaffUnavailableTimer(member.id);
    }
  }
  
  // ENTRA A ESPERA
  if (newState.channelId === waitingId && oldState.channelId !== waitingId) {
    console.log(`\n📥 ${member.user.username} entró a espera`);
    
    const channel = newState.channel;
    
    const entry = addToQueue(member);
    await sendOrUpdateQueueDM(member);
    await manageWaitingChannelAudio(channel, member);
    
    setTimeout(async () => {
      await assignUserToStaff(guild);
    }, CONFIG.TIME_BEFORE_ASSIGN);
  }
  
  // SALE DE ESPERA
  if (oldState.channelId === waitingId && newState.channelId !== waitingId) {
    console.log(`\n📤 ${member.user.username} salió de espera`);
    
    removeFromQueue(member.id);
    botState.userDMMessages.delete(member.id);
    
    const channel = oldState.channel;
    const humans = channel.members.filter(m => !m.user.bot);
    
    console.log(`👥 Usuarios restantes: ${humans.size}`);
    
    if (humans.size === 0) {
      disconnectFromChannel(channel);
    } else {
      // Si todavía hay usuarios, reiniciar la secuencia para el primer usuario
      const firstUser = humans.first();
      const isFirst = botState.isFirstPlay.get(channel.id);
      
      if (!isFirst) {
        console.log(`🔄 Reiniciando secuencia para ${firstUser.user.username}`);
        stopAllAudio(channel.id);
        const connection = botState.activeConnections.get(channel.id);
        if (connection) {
          await startAudioSequence(connection, channel.id, firstUser);
        }
      }
    }
    
    await updateAllQueueMessages();
  }
  
  // SALE DE SOPORTE
  const supportInfo = botState.activeSupport.get(member.id);
  
  if (supportInfo && oldState.channelId === supportInfo.channelId && newState.channelId !== supportInfo.channelId) {
    console.log(`\n✅ ${member.user.username} terminó soporte`);
    
    const duration = Math.floor((Date.now() - supportInfo.startTime) / 60000);
    console.log(`⏱️ Duración: ${duration} minutos`);
    
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
        await interaction.reply({ content: '❌ Hubo un error ejecutando el comando.', ephemeral: true });
      }
    }
  }
});

// ===============================
// BOT LISTO
// ===============================

client.once("ready", async () => {
  console.log(`\n╔════════════════════════════════════════╗`);
  console.log(`║  ✅ EL PATIO RP - BOT V3.3 OPTIMIZADO ║`);
  console.log(`║  👤 ${client.user.tag.padEnd(31)}║`);
  console.log(`╚════════════════════════════════════════╝\n`);
  
  checkAudioFiles();
  
  // Registrar comandos slash
  const rest = new REST({ version: '10' }).setToken(CONFIG.TOKEN);
  
  try {
    console.log('🔄 Registrando comandos slash...');
    
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands },
    );
    
    console.log('✅ Comandos slash registrados');
  } catch (error) {
    console.error('❌ Error registrando comandos:', error);
  }
  
  const guild = client.guilds.cache.first();
  
  if (guild) {
    startQueueUpdater(guild);
    console.log(`🔄 Sistema iniciado`);
    
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
  
  console.log(`\n✅ Bot listo y operativo`);
  console.log(`📊 Canales soporte: ${CONFIG.SUPPORT_CHANNELS.length}`);
  console.log(`🎵 Sistema de audio optimizado: ACTIVO`);
  console.log(`⭐ Sistema de calificación: CORREGIDO`);
  console.log(`⚠️ Monitoreo de staff: ACTIVO`);
  console.log(`🎮 Comandos disponibles: /descanso, /volver, /estadisticas, /cola\n`);
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

console.log("🚀 Iniciando El Patio RP Bot V3.3 OPTIMIZADO...\n");

client.login(CONFIG.TOKEN).catch(err => {
  console.error("❌ Error login:", err);
  process.exit(1);
});
