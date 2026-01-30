const fs = require('fs');
const path = require('path');

// Script para hacer backup de la base de datos

const dbPath = './database/call_center.db';
const backupDir = './backups';

// Crear carpeta de backups si no existe
if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
}

// Crear nombre con fecha
const date = new Date();
const dateStr = date.toISOString().replace(/[:.]/g, '-').slice(0, -5);
const backupPath = path.join(backupDir, `call_center_backup_${dateStr}.db`);

// Copiar archivo
if (fs.existsSync(dbPath)) {
    fs.copyFileSync(dbPath, backupPath);
    console.log(`✅ Backup creado: ${backupPath}`);
    
    // Mostrar tamaño
    const stats = fs.statSync(backupPath);
    const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
    console.log(`📊 Tamaño: ${sizeMB} MB`);
    
    // Limpiar backups antiguos (mantener últimos 10)
    const files = fs.readdirSync(backupDir)
        .filter(f => f.startsWith('call_center_backup_'))
        .map(f => ({
            name: f,
            time: fs.statSync(path.join(backupDir, f)).mtime.getTime()
        }))
        .sort((a, b) => b.time - a.time);
    
    if (files.length > 10) {
        console.log('\n🧹 Limpiando backups antiguos...');
        files.slice(10).forEach(file => {
            fs.unlinkSync(path.join(backupDir, file.name));
            console.log(`   Eliminado: ${file.name}`);
        });
    }
} else {
    console.error('❌ No se encontró la base de datos');
}
