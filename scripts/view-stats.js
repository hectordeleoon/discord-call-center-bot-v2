const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Script para ver estadísticas de la base de datos

const dbPath = './database/call_center.db';

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('❌ Error al conectar:', err);
        process.exit(1);
    }
});

console.log('╔════════════════════════════════════════╗');
console.log('║  ESTADÍSTICAS DE LA BASE DE DATOS     ║');
console.log('╚════════════════════════════════════════╝\n');

// Total de sesiones
db.get('SELECT COUNT(*) as total FROM support_sessions', (err, row) => {
    if (!err) {
        console.log(`📊 Total de Sesiones: ${row.total}`);
    }
});

// Total de sesiones completadas
db.get('SELECT COUNT(*) as total FROM support_sessions WHERE end_time IS NOT NULL', (err, row) => {
    if (!err) {
        console.log(`✅ Sesiones Completadas: ${row.total}`);
    }
});

// Duración promedio
db.get('SELECT AVG(duration) as avg FROM support_sessions WHERE duration IS NOT NULL', (err, row) => {
    if (!err && row.avg) {
        const minutes = Math.floor(row.avg / 60);
        const seconds = Math.floor(row.avg % 60);
        console.log(`⏱️  Duración Promedio: ${minutes}m ${seconds}s`);
    }
});

// Rating promedio global
db.get('SELECT AVG(rating) as avg, COUNT(*) as total FROM support_sessions WHERE rating IS NOT NULL', (err, row) => {
    if (!err && row.avg) {
        console.log(`⭐ Rating Promedio: ${row.avg.toFixed(2)}/5 (${row.total} ratings)`);
    }
});

// Top 5 staff
console.log('\n🏆 Top 5 Staff (Por Clientes Atendidos):');
db.all(`
    SELECT staff_tag, total_clients, average_rating 
    FROM staff_stats 
    ORDER BY total_clients DESC 
    LIMIT 5
`, (err, rows) => {
    if (!err) {
        rows.forEach((row, i) => {
            console.log(`   ${i + 1}. ${row.staff_tag}: ${row.total_clients} clientes | ⭐ ${row.average_rating.toFixed(1)}/5`);
        });
    }
});

// Top 5 usuarios frecuentes
console.log('\n👥 Top 5 Usuarios Más Frecuentes:');
db.all(`
    SELECT user_tag, total_sessions, is_vip, is_donator
    FROM user_frequency 
    ORDER BY total_sessions DESC 
    LIMIT 5
`, (err, rows) => {
    if (!err) {
        rows.forEach((row, i) => {
            const badge = row.is_vip ? '👑' : row.is_donator ? '💎' : '👤';
            console.log(`   ${i + 1}. ${badge} ${row.user_tag}: ${row.total_sessions} sesiones`);
        });
    }
});

// Sesiones VIP vs Normal
console.log('\n📈 Distribución de Sesiones:');
db.get('SELECT COUNT(*) as total FROM support_sessions WHERE is_vip = 1', (err, vip) => {
    db.get('SELECT COUNT(*) as total FROM support_sessions WHERE is_donator = 1', (err2, donator) => {
        db.get('SELECT COUNT(*) as total FROM support_sessions WHERE is_vip = 0 AND is_donator = 0', (err3, normal) => {
            if (!err && !err2 && !err3) {
                console.log(`   👑 VIP: ${vip.total}`);
                console.log(`   💎 Donadores: ${donator.total}`);
                console.log(`   👤 Normales: ${normal.total}`);
            }
        });
    });
});

// Tickets escritos
setTimeout(() => {
    db.get('SELECT COUNT(*) as open FROM written_tickets WHERE status = "open"', (err, open) => {
        db.get('SELECT COUNT(*) as closed FROM written_tickets WHERE status = "closed"', (err2, closed) => {
            if (!err && !err2) {
                console.log('\n🎫 Tickets Escritos:');
                console.log(`   🔓 Abiertos: ${open.open}`);
                console.log(`   ✅ Cerrados: ${closed.closed}`);
            }
            
            db.close(() => {
                console.log('\n✅ Consulta completada\n');
            });
        });
    });
}, 500);
