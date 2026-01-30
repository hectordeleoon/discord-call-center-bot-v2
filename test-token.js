const { Client, GatewayIntentBits } = require('discord.js');
require('dotenv').config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const token = process.env.DISCORD_BOT_TOKEN;

console.log('Intentando conectar...');
console.log('Token (primeros 30 chars):', token.substring(0, 30) + '...');
console.log('Token longitud:', token.length);

client.on('ready', () => {
    console.log('✅ ¡BOT CONECTADO EXITOSAMENTE!');
    console.log('Usuario:', client.user.tag);
    process.exit(0);
});

client.on('error', error => {
    console.error('❌ Error:', error.message);
    process.exit(1);
});

client.login(token).catch(error => {
    console.error('❌ Error al hacer login:', error.message);
    console.error('Código de error:', error.code);
    process.exit(1);
});
