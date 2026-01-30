# ✅ CHECKLIST DE CONFIGURACIÓN RÁPIDA

## 📋 Usa esta lista para verificar que todo esté configurado

### PASO 1: ARCHIVOS ✅
- [ ] Descargué todos los archivos nuevos
- [ ] Reemplacé `_env-v2.example` con `.env.example`
- [ ] Reemplacé `_gitignore` con `.gitignore`
- [ ] Reemplacé `package-v2.json` con `package.json`
- [ ] Tengo el archivo `bot-v2.js` en la carpeta principal
- [ ] Tengo las carpetas: `audio/`, `database/`, `backups/`, `scripts/`

### PASO 2: NODE.JS ✅
- [ ] Instalé Node.js desde nodejs.org
- [ ] Probé `node --version` en PowerShell y funciona
- [ ] Probé `npm --version` en PowerShell y funciona

### PASO 3: BOT DE DISCORD ✅
- [ ] Creé la aplicación en Discord Developer Portal
- [ ] Copié el TOKEN del bot
- [ ] Activé los 3 "Privileged Gateway Intents":
  - [ ] PRESENCE INTENT
  - [ ] SERVER MEMBERS INTENT
  - [ ] MESSAGE CONTENT INTENT
- [ ] Invité el bot a mi servidor con permisos de Administrador

### PASO 4: SERVIDOR DE DISCORD ✅
- [ ] Activé el "Modo Desarrollador" en Discord
- [ ] Creé el canal de voz: 🕐 sala-espera
- [ ] Creé el canal de voz: 👨‍💼 staff-disponible
- [ ] Creé 3+ canales de voz: 📞 soporte-1, soporte-2, soporte-3
- [ ] Creé el canal de texto: 💬 comandos-staff
- [ ] Creé el canal de texto: ⭐ reseñas
- [ ] Creé el rol: 👨‍💼 Staff
- [ ] Creé el rol: 👑 VIP (opcional)
- [ ] Creé el rol: 💎 Donador (opcional)
- [ ] Copié los IDs de TODOS los canales y roles

### PASO 5: ARCHIVO .env ✅
- [ ] Copié `.env.example` a `.env`
- [ ] Pegué mi TOKEN en `DISCORD_BOT_TOKEN=`
- [ ] Pegué el ID del canal sala-espera en `WAITING_CHANNEL_ID=`
- [ ] Pegué el ID del canal staff-disponible en `STAFF_AVAILABLE_CHANNEL_ID=`
- [ ] Pegué el ID del canal comandos-staff en `STAFF_TEXT_CHANNEL_ID=`
- [ ] Pegué el ID del canal reseñas en `REVIEWS_CHANNEL_ID=`
- [ ] Pegué los IDs de soporte (separados por comas) en `SUPPORT_CHANNELS=`
- [ ] Pegué el ID del rol Staff en `STAFF_ROLES=`
- [ ] Pegué el ID del rol VIP en `VIP_ROLES=` (o dejé un ID de ejemplo)
- [ ] Pegué el ID del rol Donador en `DONATOR_ROLES=` (o dejé un ID de ejemplo)
- [ ] Verifiqué que NO hay espacios después de las comas
- [ ] Guardé el archivo `.env`

### PASO 6: INSTALACIÓN LOCAL ✅
- [ ] Abrí PowerShell en la carpeta del bot
- [ ] Ejecuté: `npm install`
- [ ] La instalación terminó sin errores
- [ ] Se creó la carpeta `node_modules/`

### PASO 7: PRUEBA LOCAL ✅
- [ ] Ejecuté: `npm start`
- [ ] Vi el mensaje: "✅ Bot conectado como..."
- [ ] El bot aparece ONLINE en Discord
- [ ] Puedo ver los comandos del bot en Discord con `/`
- [ ] Probé unirme a sala-espera y el bot me detectó
- [ ] Detuve el bot con Ctrl+C

### PASO 8: GITHUB ✅
- [ ] Instalé Git o GitHub Desktop
- [ ] Creé un repositorio en GitHub
- [ ] Subí mi código (sin el archivo .env)
- [ ] Verifiqué que el archivo .env NO se subió (debe aparecer en .gitignore)

### PASO 9: RAILWAY ✅
- [ ] Creé cuenta en railway.app
- [ ] Conecté mi repositorio de GitHub
- [ ] Agregué TODAS las variables de entorno (del archivo .env)
- [ ] El bot se desplegó correctamente
- [ ] Vi los logs y dice "✅ Bot conectado como..."
- [ ] El bot está ONLINE en Discord 24/7

---

## 🎯 VALORES QUE NECESITAS COPIAR

Usa esta tabla para organizar tus IDs antes de pegarlos en .env:

| Item | ID | Dónde va |
|------|----|----|
| Token del Bot | `MTIzNDU2...` | `DISCORD_BOT_TOKEN=` |
| Canal: sala-espera | `1234567890123456789` | `WAITING_CHANNEL_ID=` |
| Canal: staff-disponible | `2345678901234567890` | `STAFF_AVAILABLE_CHANNEL_ID=` |
| Canal: comandos-staff | `3456789012345678901` | `STAFF_TEXT_CHANNEL_ID=` |
| Canal: reseñas | `4567890123456789012` | `REVIEWS_CHANNEL_ID=` |
| Canal: soporte-1 | `5678901234567890123` | `SUPPORT_CHANNELS=` |
| Canal: soporte-2 | `6789012345678901234` | `SUPPORT_CHANNELS=` (después de coma) |
| Canal: soporte-3 | `7890123456789012345` | `SUPPORT_CHANNELS=` (después de coma) |
| Rol: Staff | `8901234567890123456` | `STAFF_ROLES=` |
| Rol: VIP | `9012345678901234567` | `VIP_ROLES=` |
| Rol: Donador | `0123456789012345678` | `DONATOR_ROLES=` |

---

## ⚠️ ERRORES COMUNES

### ❌ "Error: Invalid token"
- **Causa:** El token es incorrecto
- **Solución:** Copia nuevamente el token del Developer Portal

### ❌ "Missing Privileged Intents"
- **Causa:** No activaste los intents
- **Solución:** Ve a Discord Developer Portal → Bot → Activa los 3 intents

### ❌ "Cannot find channel"
- **Causa:** IDs de canales incorrectos
- **Solución:** Verifica que copiaste los IDs correctos con "Copiar ID"

### ❌ Bot offline después de unos minutos
- **Causa:** Tu PC se apagó o cerraste PowerShell
- **Solución:** Despliega en Railway para que esté 24/7

### ❌ "npm install" falla
- **Causa:** Node.js no está instalado correctamente
- **Solución:** Reinstala Node.js desde nodejs.org

---

## 🎉 SI TODO ESTÁ ✅

¡Felicidades! Tu bot está funcionando correctamente.

**Comandos útiles para el día a día:**

```powershell
# Ver estado del bot
npm start

# Ver estadísticas
npm run view-stats

# Hacer backup de la base de datos
npm run db:backup
```

**En Discord, comandos para staff:**
- `/disponible` - Marcarte como disponible
- `/ocupado` - Marcarte como ocupado
- `/finalizar` - Finalizar atención actual
- `/stats` - Ver tus estadísticas
- `/cola` - Ver estado de la cola

---

**¿Todo funcionando?** ¡Excelente! Ahora tu servidor tiene un sistema profesional de atención al cliente. 🎊
