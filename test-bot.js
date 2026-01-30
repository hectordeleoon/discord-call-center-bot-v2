const { Client, GatewayIntentBits } = require('discord.js');
require('dotenv').config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
    ]
});

client.once('ready', () => {
    console.log('✅ Bot de prueba conectado:', client.user.tag);
});

client.on('voiceStateUpdate', (oldState, newState) => {
    console.log('🔔 EVENTO DETECTADO!');
    console.log('Usuario:', newState.member.user.tag);
    console.log('Canal anterior:', oldState.channelId);
    console.log('Canal nuevo:', newState.channelId);
});

client.login(process.env.DISCORD_BOT_TOKEN);
