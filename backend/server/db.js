// const path = require('path');
// require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
// require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
// require('dotenv').config();

// const mysqlModule = require('mysql2/promise');

// let activePool = null;

// const dbPool = {
//   query: async (...args) => {
//     if (!activePool) return [[]];
//     try {
//       const res = await activePool.query(...args);
//       return res;
//     } catch (e) {
//       console.log('[MySQL Pool Query Notice]:', e?.message || e);
//       return [[]];
//     }
//   },
//   getConnection: async (...args) => {
//     if (!activePool) throw new Error('Database pool not connected');
//     return activePool.getConnection(...args);
//   },
// };

// const ROLE_MAP = {
//   ADMINISTRATOR: { id: 1, name: 'Administrator', code: 'ADMINISTRATOR' },
//   MARKETING_MANAGER: { id: 2, name: 'Marketing Manager', code: 'MARKETING_MANAGER' },
//   DIGITAL_MARKETING: { id: 3, name: 'Digital Marketing', code: 'DIGITAL_MARKETING' },
//   DESIGNER: { id: 4, name: 'Designer', code: 'DESIGNER' },
//   TELECALLER: { id: 5, name: 'Telecaller', code: 'TELECALLER' },
//   BDM: { id: 6, name: 'Business Development Manager', code: 'BDM' },
// };

// async function initDatabase() {
//   try {
//     let pool = null;
//     const dbUrl = process.env.DATABASE_URL;
//     let connected = false;

//     if (dbUrl) {
//       try {
//         pool = mysqlModule.createPool({ uri: dbUrl, connectTimeout: 10000, waitForConnections: true, connectionLimit: 10 });
//         const conn = await pool.getConnection();
//         conn.release();
//         connected = true;
//       } catch (err) {
//         console.log('[MySQL DB Notice] Failed URI connection, trying host/port fallback:', err?.message || err);
//       }
//     }

//     if (!connected) {
//       pool = mysqlModule.createPool({
//         host: process.env.DB_HOST || 'localhost',
//         port: Number(process.env.DB_PORT) || 3306,
//         user: process.env.DB_USER || 'root',
//         password: process.env.DB_PASSWORD || 'tiger',
//         database: process.env.DB_NAME || 'markops',
//         connectTimeout: 10000,
//         waitForConnections: true,
//         connectionLimit: 10,
//       });
//       const conn = await pool.getConnection();
//       conn.release();
//       connected = true;
//     }

//     activePool = pool;

//     await activePool.query('SET FOREIGN_KEY_CHECKS = 0');

//     // 1. Seed Roles
//     await activePool.query(`
//       INSERT INTO roles (id, name, code, description) VALUES
//       (1, 'Administrator', 'ADMINISTRATOR', 'Full System Access'),
//       (2, 'Marketing Manager', 'MARKETING_MANAGER', 'Campaign Operations'),
//       (3, 'Digital Marketing', 'DIGITAL_MARKETING', 'Ad Operations'),
//       (4, 'Designer', 'DESIGNER', 'Asset Design'),
//       (5, 'Telecaller', 'TELECALLER', 'Lead Telecalling'),
//       (6, 'Business Development Manager', 'BDM', 'Package Task Management & Designer Collaboration')
//       ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description)
//     `);

//     // 2. Seed Teams
//     await activePool.query(`
//       INSERT INTO teams (id, name, description) VALUES
//       (1, 'System Administration', 'Core administrative operations'),
//       (2, 'Marketing Operations', 'Campaigns & Ads'),
//       (3, 'Design & Creative', 'Asset creation and branding'),
//       (4, 'Telecalling Team', 'Outreach and conversions'),
//       (5, 'Business Development', 'Package and business development')
//       ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description)
//     `);

//     // 3. Seed Default System Users (Password: admin123)
//     const defaultPasswordHash = '$2b$10$rAtwAbv6mCMiTEQY/BfHmuvxzT3rFrz.C9UArZx5HqG1nBVtztvsq';
//     await activePool.query(`
//       INSERT INTO users (id, email, password_hash, full_name, role_id, team_id, department, is_active) VALUES
//       (1, 'admin@markops.io', ?, 'System Administrator', 1, 1, 'Executive Operations', 1),
//       ON DUPLICATE KEY UPDATE
//         password_hash = VALUES(password_hash),
//         full_name = VALUES(full_name),
//         role_id = VALUES(role_id),
//         department = VALUES(department),
//         is_active = VALUES(is_active)
//     `, [defaultPasswordHash, defaultPasswordHash, defaultPasswordHash, defaultPasswordHash, defaultPasswordHash, defaultPasswordHash]);

//     await activePool.query('SET FOREIGN_KEY_CHECKS = 1');

//     // Ensure packages table exists
//     await activePool.query(`
//       CREATE TABLE IF NOT EXISTS packages (
//         id INT NOT NULL AUTO_INCREMENT,
//         product_id VARCHAR(100) NOT NULL,
//         name VARCHAR(255) NOT NULL,
//         image_url LONGTEXT DEFAULT NULL,
//         price DECIMAL(10,2) DEFAULT NULL,
//         description TEXT DEFAULT NULL,
//         status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
//         created_by INT DEFAULT NULL,
//         created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
//         updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
//         PRIMARY KEY (id),
//         KEY idx_packages_product (product_id)
//       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
//     `);

//     // Ensure campaigns table exists
//     await activePool.query(`
//       CREATE TABLE IF NOT EXISTS campaigns (
//         id INT NOT NULL AUTO_INCREMENT,
//         name VARCHAR(255) NOT NULL,
//         objective VARCHAR(100) DEFAULT 'LEAD_GENERATION',
//         product_id VARCHAR(100) DEFAULT 'pkg_careermate',
//         status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
//         start_date DATE DEFAULT NULL,
//         end_date DATE DEFAULT NULL,
//         budget DECIMAL(12,2) DEFAULT 0.00,
//         target_leads INT DEFAULT 0,
//         target_cpl DECIMAL(10,2) DEFAULT 0.00,
//         target_qualified_pct DECIMAL(5,2) DEFAULT 0.00,
//         target_conversion_pct DECIMAL(5,2) DEFAULT 0.00,
//         spend DECIMAL(12,2) DEFAULT 0.00,
//         leads_count INT DEFAULT 0,
//         owner_id INT DEFAULT 1,
//         created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
//         updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
//         PRIMARY KEY (id)
//       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
//     `);

//     try { await activePool.query(`ALTER TABLE campaigns ADD COLUMN product_id VARCHAR(100) DEFAULT 'pkg_careermate'`); } catch (e) {}
//     try { await activePool.query(`ALTER TABLE campaigns ADD COLUMN spend DECIMAL(12,2) DEFAULT 0.00`); } catch (e) {}
//     try { await activePool.query(`ALTER TABLE campaigns ADD COLUMN leads_count INT DEFAULT 0`); } catch (e) {}
//     try { await activePool.query(`ALTER TABLE campaigns MODIFY COLUMN start_date DATE DEFAULT NULL`); } catch (e) {}
//     try { await activePool.query(`ALTER TABLE campaigns MODIFY COLUMN end_date DATE DEFAULT NULL`); } catch (e) {}

//     // Ensure ads table exists
//     await activePool.query(`
//       CREATE TABLE IF NOT EXISTS ads (
//         id INT NOT NULL AUTO_INCREMENT,
//         name VARCHAR(255) NOT NULL,
//         campaign_id INT DEFAULT NULL,
//         platform VARCHAR(50) DEFAULT 'Meta',
//         status VARCHAR(50) DEFAULT 'ACTIVE',
//         spend DECIMAL(12,2) DEFAULT 0.00,
//         impressions INT DEFAULT 0,
//         clicks INT DEFAULT 0,











// const dbCommonTargetStore = {
//   dailyCallsTarget: 30,
//   dailyInterestedTarget: 5,
//   dailyDurationTargetSeconds: 3600,
//   updatedBy: 'Marketing Manager',
//   updatedAt: new Date().toISOString(),
// };
// const dbTelecallerTargetsStore = [];

// module.exports = {
//   dbPool,
//   ROLE_MAP,
//   initDatabase,
//   dbUsersStore,
//   dbTasksStore,
//   dbCampaignsStore,
//   dbAdsStore,
//   dbLeadsStore,
//   dbCallActivitiesStore,
//   dbFollowUpsStore,
//   dbTransactionsStore,
//   dbNotificationsStore,
//   dbPackagesStore,
//   dbCommonTargetStore,
//   dbTelecallerTargetsStore,
// };



const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config();

const mysqlModule = require('mysql2/promise');

let activePool = null;

const dbPool = {
  query: async (...args) => {
    if (!activePool) return [[]];
    try {
      const res = await activePool.query(...args);
      return res;
    } catch (e) {
      console.log('[MySQL Pool Query Notice]:', e?.message || e);
      return [[]];
    }
  },
  getConnection: async (...args) => {
    if (!activePool) throw new Error('Database pool not connected');
    return activePool.getConnection(...args);
  },
};

const ROLE_MAP = {
  ADMINISTRATOR: { id: 1, name: 'Administrator', code: 'ADMINISTRATOR' },
  MARKETING_MANAGER: { id: 2, name: 'Marketing Manager', code: 'MARKETING_MANAGER' },
  DIGITAL_MARKETING: { id: 3, name: 'Digital Marketing', code: 'DIGITAL_MARKETING' },
  DESIGNER: { id: 4, name: 'Designer', code: 'DESIGNER' },
  TELECALLER: { id: 5, name: 'Telecaller', code: 'TELECALLER' },
  BDM: { id: 6, name: 'Business Development Manager', code: 'BDM' },
};

async function initDatabase() {
  try {
    let pool = null;
    const dbUrl = process.env.DATABASE_URL;
    let connected = false;

    if (dbUrl) {
      try {
        const cleanUrl = dbUrl.replace(/[?&]ssl-mode=[^&]*/i, '').replace(/\?$/, '');
        pool = mysqlModule.createPool({ uri: cleanUrl, ssl: { rejectUnauthorized: false }, connectTimeout: 10000, waitForConnections: true, connectionLimit: 10 });
        const conn = await pool.getConnection();
        conn.release();
        connected = true;
      } catch (err) {
        console.log('[MySQL DB Notice] Failed URI connection, trying host/port fallback:', err?.message || err);
      }
    }

    if (!connected) {
      pool = mysqlModule.createPool({
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || 'tiger',
        database: process.env.DB_NAME || 'markops',
        connectTimeout: 10000,
        waitForConnections: true,
        connectionLimit: 10,
      });
      const conn = await pool.getConnection();
      conn.release();
      connected = true;
    }

    activePool = pool;
    console.log('[MySQL DB] Successfully connected to MySQL pool.');
  } catch (err) {
    console.log('[MySQL DB Notice] MySQL unreachable, operating in high-performance memory store mode:', err?.message || err);
    activePool = null;
  }
}

// In-Memory Fallback Stores (Clean slate for production use)
const dbUsersStore = [];
const dbTasksStore = [];
const dbCampaignsStore = [];
const dbAdsStore = [];
const dbLeadsStore = [];
const dbCallActivitiesStore = [];
const dbFollowUpsStore = [];
const dbTransactionsStore = [];
const dbNotificationsStore = [];
const dbPackagesStore = [];
const dbCommonTargetStore = {
  dailyCallsTarget: 30,
  dailyInterestedTarget: 5,
  dailyDurationTargetSeconds: 3600,
  updatedBy: 'Marketing Manager',
  updatedAt: new Date().toISOString(),
};
const dbTelecallerTargetsStore = [];

module.exports = {
  dbPool,
  ROLE_MAP,
  initDatabase,
  dbUsersStore,
  dbTasksStore,
  dbCampaignsStore,
  dbAdsStore,
  dbLeadsStore,
  dbCallActivitiesStore,
  dbFollowUpsStore,
  dbTransactionsStore,
  dbNotificationsStore,
  dbPackagesStore,
  dbCommonTargetStore,
  dbTelecallerTargetsStore,
};