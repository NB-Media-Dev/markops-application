const mysql = require('mysql2/promise');

async function main() {
  const url = new URL(process.env.DATABASE_URL);

  const connection = await mysql.createConnection({
    host: url.hostname,
    port: Number(url.port),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.slice(1),
    ssl: {
      rejectUnauthorized: true
    }
  });

  console.log('✅ Connected to MySQL');

  const [tables] = await connection.query(`
    SELECT TABLE_NAME
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_TYPE = 'BASE TABLE'
  `);

  await connection.query('SET FOREIGN_KEY_CHECKS = 0');

  try {
    for (const table of tables) {
      const tableName = table.TABLE_NAME;

      if (tableName === '_prisma_migrations') continue;

      await connection.query(`TRUNCATE TABLE \`${tableName}\``);

      console.log(`Cleared: ${tableName}`);
    }
  } finally {
    await connection.query('SET FOREIGN_KEY_CHECKS = 1');
    await connection.end();
  }

  console.log('✅ All table data cleared');
}

main().catch((error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});

