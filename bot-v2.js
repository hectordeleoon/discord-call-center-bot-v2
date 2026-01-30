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
  ButtonStyle
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

  SUPPORT_CHANNELS: process.env.SUPPORT_CHANNELS?.split(',').map(id => id.trim()) || [],

  STAFF_ROLES: process.env.STAFF_ROLES?.split(',').map(id => id.trim()) || [],
  VIP_ROLES: process.env.VIP_ROLES?.split(',').map(id => id.trim()) || [],
  DONATOR_ROLES: process.env.DONATOR_ROLES?.split(',').map(id => id.trim()) || [],

  AUDIO_FILES: {
    BACKGROUND_MUSIC: "./audio/musica_espera.mp3",
    VOICE_WAITING: "./audio/voz_atendiendo.mp3",
    VOICE_NO_STAFF: "./audio/voz_no_disponible.mp3",
    VOICE_VIP: "./audio/voz_vip.mp3"
  },

  VOICE_REPEAT_INTERVAL: parseInt(process.env.VOICE_REPEAT_INTERVAL) || 60000,
  TIME_BEFORE_ASSIGN: parseInt(process.env.TIME_BEFORE_ASSIGN) || 5000,
  QUEUE_UPDATE_INTERVAL: parseInt(process.env.QUEUE_UPDATE_INTERVAL) || 10000,

  AVERAGE_SUPPORT_TIME: 3
};

client.login(CONFIG.TOKEN);
  
  WAITING_CHANNEL_ID: process.env.WAITING_CHANNEL_ID,
  STAFF_AVAILABLE_CHANNEL_ID: process.env.STAFF_AVAILABLE_CHANNEL_ID,
  STAFF_TEXT_CHANNEL_ID: process.env.STAFF_TEXT_CHANNEL_ID,
  
  SUPPORT_CHANNELS: process.env.SUPPORT_CHANNELS?.split(',').map(id => id.trim()) || [],
  
  STAFF_ROLES: process.env.STAFF_ROLES?.split(',').map(id => id.trim()) || [],
  VIP_ROLES: process.env.VIP_ROLES?.split(',').map(id => id.trim()) || [],
  DONATOR_ROLES: process.env.DONATOR_ROLES?.split(',').map(id => id.trim()) || [],
  
  AUDIO_FILES: {
    BACKGROUND_MUSIC: "./audio/musica_espera.mp3",
    VOICE_WAITING: "./audio/voz_atendiendo.mp3",
    VOICE_NO_STAFF: "./audio/voz_no_disponible.mp3",
    VOICE_VIP: "./audio/voz_vip.mp3"
  },
  
  VOICE_REPEAT_INTERVAL: parseInt(process.env.VOICE_REPEAT_INTERVAL) || 60000,
  TIME_BEFORE_ASSIGN: parseInt(process.env.TIME_BEFORE_ASSIGN) || 5000,
  QUEUE_UPDATE_INTERVAL: parseInt(process.env.QUEUE_UPDATE_INTERVAL) || 10000,
  
  AVERAGE_SUPPORT_TIME: 3
};

// ===============================
// ESTADO DEL BOT
// ===============================

const botState = {
  // Audio - 2 PLAYERS SEPARADOS (música + voz)
  activeConnections: new Map(),
  musicPlayers: new Map(),      // Player dedicado SOLO para música
  voicePlayers: new Map(),      // Player dedicado SOLO para voces
  voiceQueue: new Map(),        // Cola de voces pendientes por canal
  voiceIntervals: new Map(),
  
  // Cola de soporte
  queue: [],
  
  // Usuarios siendo atendidos
  activeSupport: new Map(),
  
  // Mensajes DM
  userDMMessages: new Map(),
  
  // Staff
  lastStaffNotification: null
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
app.get("/", (req, res) => res.send("✅ El Patio RP - Call Center V3.1"));
app.listen(3000, () => console.log("🌐 Web activa"));

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
  
  return queueEntry;
}

function removeFromQueue(userId) {
  const index = botState.queue.findIndex(entry => entry.userId === userId);
  
  if (index !== -1) {
    const removed = botState.queue.splice(index, 1)[0];
    console.log(`📋 ${removed.member.user.username} removido de cola`);
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
// MENSAJES DM (1 SOLO QUE SE ACTUALIZA)
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
// SISTEMA DE AUDIO MEJORADO
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
// 🎵 MÚSICA DE FONDO (NUNCA SE DETIENE)
// ===============================

function playBackgroundMusic(connection, channelId) {
  console.log("🎵 Iniciando música de fondo continua...");

  try {
    if (!fs.existsSync(CONFIG.AUDIO_FILES.BACKGROUND_MUSIC)) {
      console.error("❌ Archivo de música no encontrado");
      return;
    }

    // Player DEDICADO solo para música
    const musicPlayer = createAudioPlayer();
    
    const resource = createAudioResource(
      CONFIG.AUDIO_FILES.BACKGROUND_MUSIC,
      { inlineVolume: true, inputType: StreamType.Arbitrary }
    );

    resource.volume.setVolume(0.20); // Volumen bajo para fondo

    connection.subscribe(musicPlayer);
    musicPlayer.play(resource);

    console.log("✅ Música de fondo iniciada (volumen: 20%)");

    // Loop automático de música (NUNCA se detiene)
    musicPlayer.on(AudioPlayerStatus.Idle, () => {
      if (botState.musicPlayers.has(channelId)) {
        const newResource = createAudioResource(
          CONFIG.AUDIO_FILES.BACKGROUND_MUSIC,
          { inlineVolume: true, inputType: StreamType.Arbitrary }
        );
        newResource.volume.setVolume(0.20);
        musicPlayer.play(newResource);
        console.log("🔁 Música reiniciada (loop)");
      }
    });

    musicPlayer.on('error', error => {
      console.error('❌ Error en música:', error);
    });

    // Guardar en Map separado
    botState.musicPlayers.set(channelId, musicPlayer);

  } catch (error) {
    console.error("❌ Error reproduciendo música:", error);
  }
}

// ===============================
// 🎙️ SISTEMA DE COLA DE VOCES
// ===============================

async function addToVoiceQueue(channelId, audioFile, username) {
  if (!botState.voiceQueue.has(channelId)) {
    botState.voiceQueue.set(channelId, []);
  }
  
  const queue = botState.voiceQueue.get(channelId);
  queue.push({ audioFile, username, timestamp: Date.now() });
  
  console.log(`🎙️ Voz agregada a cola: ${path.basename(audioFile)} para ${username}`);
  console.log(`   Cola de voces: ${queue.length} pendiente(s)`);
  
  // Si no hay voz reproduciéndose, iniciar
  if (!botState.voicePlayers.has(channelId)) {
    processVoiceQueue(channelId);
  }
}

async function processVoiceQueue(channelId) {
  const queue = botState.voiceQueue.get(channelId);
  
  if (!queue || queue.length === 0) {
    console.log(`🎙️ Cola de voces vacía para canal ${channelId}`);
    botState.voicePlayers.delete(channelId);
    return;
  }
  
  const connection = botState.activeConnections.get(channelId);
  
  if (!connection) {
    console.log(`❌ No hay conexión para canal ${channelId}`);
    return;
  }
  
  // Tomar siguiente voz de la cola
  const nextVoice = queue.shift();
  
  console.log(`🎙️ Reproduciendo voz: ${path.basename(nextVoice.audioFile)} para ${nextVoice.username}`);
  
  try {
    if (!fs.existsSync(nextVoice.audioFile)) {
      console.error("❌ Archivo de voz no encontrado:", nextVoice.audioFile);
      // Continuar con la siguiente
      processVoiceQueue(channelId);
      return;
    }

    // Player DEDICADO solo para voces (SEPARADO de la música)
    const voicePlayer = createAudioPlayer();
    
    const resource = createAudioResource(
      nextVoice.audioFile,
      { inlineVolume: true, inputType: StreamType.Arbitrary }
    );

    resource.volume.setVolume(1.0); // Volumen alto para voz

    connection.subscribe(voicePlayer);
    voicePlayer.play(resource);

    console.log(`✅ Voz iniciada (volumen: 100%)`);

    voicePlayer.on('error', error => {
      console.error('❌ Error en voz:', error);
      processVoiceQueue(channelId); // Continuar con siguiente
    });

    // Cuando termine esta voz, reproducir la siguiente
    voicePlayer.on(AudioPlayerStatus.Idle, () => {
      console.log(`🎙️ Voz finalizada`);
      botState.voicePlayers.delete(channelId);
      
      // Pequeña pausa entre voces (500ms)
      setTimeout(() => {
        processVoiceQueue(channelId);
      }, 500);
    });

    // Guardar player actual
    botState.voicePlayers.set(channelId, voicePlayer);

  } catch (error) {
    console.error("❌ Error reproduciendo voz:", error);
    processVoiceQueue(channelId); // Continuar con siguiente
  }
}

// ===============================
// ⛔ DETENER TODO AUDIO
// ===============================

function stopAudio(channelId) {
  console.log(`🛑 Deteniendo audio del canal`);

  // Detener intervalo
  const interval = botState.voiceIntervals.get(channelId);
  if (interval) {
    clearInterval(interval);
    botState.voiceIntervals.delete(channelId);
  }

  // Detener música
  const musicPlayer = botState.musicPlayers.get(channelId);
  if (musicPlayer) {
    musicPlayer.stop();
    botState.musicPlayers.delete(channelId);
    console.log("🎵 Música detenida");
  }
  
  // Detener voz
  const voicePlayer = botState.voicePlayers.get(channelId);
  if (voicePlayer) {
    voicePlayer.stop();
    botState.voicePlayers.delete(channelId);
    console.log("🎙️ Voz detenida");
  }
  
  // Limpiar cola de voces
  botState.voiceQueue.delete(channelId);
}

// ===============================
// 🔁 REPETIR VOZ PERIÓDICAMENTE
// ===============================

function startVoiceRepetition(channel) {
  console.log(`🔁 Iniciando repetición de voz cada ${CONFIG.VOICE_REPEAT_INTERVAL / 1000} segundos`);

  const oldInterval = botState.voiceIntervals.get(channel.id);
  if (oldInterval) clearInterval(oldInterval);

  const interval = setInterval(() => {
    const humans = channel.members.filter(m => !m.user.bot);

    if (humans.size === 0) {
      console.log("📭 Canal vacío, deteniendo");
      clearInterval(interval);
      botState.voiceIntervals.delete(channel.id);
      disconnectFromChannel(channel);
      return;
    }

    // Agregar voz a la cola para cada usuario
    for (const [id, member] of humans) {
      let audioFile = CONFIG.AUDIO_FILES.VOICE_WAITING;
      
      if (isVIP(member)) {
        audioFile = CONFIG.AUDIO_FILES.VOICE_VIP;
      } else if (isDonator(member)) {
        audioFile = CONFIG.AUDIO_FILES.VOICE_VIP; // Puedes usar otro archivo
      }
      
      addToVoiceQueue(channel.id, audioFile, member.user.username);
    }

  }, CONFIG.VOICE_REPEAT_INTERVAL);

  botState.voiceIntervals.set(channel.id, interval);
}

// ===============================
// 🎧 GESTIÓN COMPLETA DEL AUDIO
// ===============================

async function manageWaitingChannelAudio(channel, member) {
  console.log(`\n📞 Gestionando audio para: ${member.user.username}`);

  let connection = botState.activeConnections.get(channel.id);

  if (!connection) {
    connection = await connectToVoiceChannel(channel);
    if (!connection) return;
  }

  await new Promise(resolve => setTimeout(resolve, 1000));

  // 1. MÚSICA DE FONDO (se inicia solo 1 vez y nunca se detiene)
  if (!botState.musicPlayers.has(channel.id)) {
    playBackgroundMusic(connection, channel.id);
  }

  await new Promise(resolve => setTimeout(resolve, 500));

  // 2. VOZ INICIAL (se agrega a la cola)
  let audioFile = CONFIG.AUDIO_FILES.VOICE_WAITING;
  
  if (isVIP(member)) {
    audioFile = CONFIG.AUDIO_FILES.VOICE_VIP;
    console.log(`👑 Usuario VIP detectado: ${member.user.username}`);
  } else if (isDonator(member)) {
    audioFile = CONFIG.AUDIO_FILES.VOICE_VIP;
    console.log(`⭐ Usuario Donador detectado: ${member.user.username}`);
  }

  addToVoiceQueue(channel.id, audioFile, member.user.username);

  // 3. REPETICIÓN (solo si aún no está activa)
  if (!botState.voiceIntervals.has(channel.id)) {
    startVoiceRepetition(channel);
  }

  console.log(`✅ Audio configurado\n`);
}

// ===============================
// 🚪 DESCONECTAR DEL CANAL
// ===============================

function disconnectFromChannel(channel) {
  console.log(`👋 Desconectando de: ${channel.name}`);

  stopAudio(channel.id);

  const connection = botState.activeConnections.get(channel.id);
  if (connection) {
    connection.destroy();
    botState.activeConnections.delete(channel.id);
  }
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
    
    if (!botState.queue[0].notified) {
      await notifyStaffChannel(guild);
      botState.queue[0].notified = true;
    }
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
    // Mover usuario
    await nextUser.member.voice.setChannel(supportChannel);
    console.log(`✅ Usuario movido a ${supportChannel.name}`);
    
    // Mover staff
    await staff.voice.setChannel(supportChannel);
    console.log(`✅ Staff movido a ${supportChannel.name}`);
    
    // Registrar soporte activo
    botState.activeSupport.set(nextUser.userId, {
      staffId: staff.id,
      channelId: supportChannel.id,
      startTime: Date.now(),
      ticketId: nextUser.ticketId
    });
    
    // Remover de la cola
    removeFromQueue(nextUser.userId);
    
    // Actualizar DM
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
    
    // Intentar asignar más usuarios
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
// EVENTOS
// ===============================

client.on("voiceStateUpdate", async (oldState, newState) => {
  const member = newState.member || oldState.member;
  
  if (!member || member.user.bot) return;
  
  const guild = member.guild;
  const waitingId = CONFIG.WAITING_CHANNEL_ID;
  
  // ENTRA A ESPERA
  if (newState.channelId === waitingId && oldState.channelId !== waitingId) {
    console.log(`\n📥 ${member.user.username} entró a espera`);
    
    const channel = newState.channel;
    
    // Agregar a cola
    const entry = addToQueue(member);
    
    // Enviar DM
    await sendOrUpdateQueueDM(member);
    
    // Audio
    await manageWaitingChannelAudio(channel, member);
    
    // Intentar asignar
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
    }
    
    await updateAllQueueMessages();
  }
  
  // SALE DE SOPORTE
  const supportInfo = botState.activeSupport.get(member.id);
  
  if (supportInfo && oldState.channelId === supportInfo.channelId && newState.channelId !== supportInfo.channelId) {
    console.log(`\n✅ ${member.user.username} terminó soporte`);
    
    const duration = Math.floor((Date.now() - supportInfo.startTime) / 60000);
    console.log(`⏱️ Duración: ${duration} minutos`);
    
    botState.activeSupport.delete(member.id);
    
    // Mover staff de vuelta
    const staffMember = guild.members.cache.get(supportInfo.staffId);
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

// ===============================
// BOT LISTO
// ===============================

client.once("ready", async () => {
  console.log(`\n╔════════════════════════════════════════╗`);
  console.log(`║  ✅ EL PATIO RP - BOT V3.1 ACTIVO     ║`);
  console.log(`║  👤 ${client.user.tag.padEnd(31)}║`);
  console.log(`╚════════════════════════════════════════╝\n`);
  
  checkAudioFiles();
  
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
  console.log(`🎵 Sistema de audio mejorado: ACTIVO`);
  console.log(`🎙️ Cola de voces: ACTIVO\n`);
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

console.log("🚀 Iniciando El Patio RP Bot V3.1...\n");

client.login(CONFIG.TOKEN).catch(err => {
  console.error("❌ Error login:", err);
  process.exit(1);
});
