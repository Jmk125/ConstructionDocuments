const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'db', 'database.sqlite');

let db = null;

async function initDatabase() {
  const SQL = await initSqlJs();

  // Load existing database or create new one
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
    runMigrations();
  } else {
    db = new SQL.Database();
    createTables();
    saveDatabase();
  }

  return db;
}

function runMigrations() {
  try {
    // Check if sheet_number column exists in chunks table
    const columns = db.exec("PRAGMA table_info(chunks)");
    if (columns.length > 0) {
      const columnNames = columns[0].values.map(row => row[1]);

      // Add sheet_number column if it doesn't exist
      if (!columnNames.includes('sheet_number')) {
        console.log('Running migration: Adding sheet_number column to chunks table');
        db.run('ALTER TABLE chunks ADD COLUMN sheet_number TEXT');
        saveDatabase();
      }

      // Add detail_reference column if it doesn't exist
      if (!columnNames.includes('detail_reference')) {
        console.log('Running migration: Adding detail_reference column to chunks table');
        db.run('ALTER TABLE chunks ADD COLUMN detail_reference TEXT');
        saveDatabase();
      }

      if (!columnNames.includes('ocr_text')) {
        console.log('Running migration: Adding ocr_text column to chunks table');
        db.run('ALTER TABLE chunks ADD COLUMN ocr_text TEXT');
        saveDatabase();
      }

      if (!columnNames.includes('image_path')) {
        console.log('Running migration: Adding image_path column to chunks table');
        db.run('ALTER TABLE chunks ADD COLUMN image_path TEXT');
        saveDatabase();
      }
    }

    db.run(`
      CREATE TABLE IF NOT EXISTS callouts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id INTEGER NOT NULL,
        page_number INTEGER NOT NULL,
        sheet_number TEXT,
        detail_reference TEXT NOT NULL,
        detail_number TEXT,
        target_sheet TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS visual_findings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id INTEGER NOT NULL,
        page_number INTEGER NOT NULL,
        sheet_number TEXT,
        findings TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
      )
    `);
    saveDatabase();
  } catch (error) {
    console.error('Migration error:', error);
  }
}

function createTables() {
  // Projects table
  db.run(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Documents table
  db.run(`
    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      filename TEXT NOT NULL,
      filepath TEXT NOT NULL,
      type TEXT NOT NULL, -- 'spec' or 'drawing'
      page_count INTEGER,
      processed BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    )
  `);

  // Document chunks table (stores text chunks with embeddings)
  db.run(`
    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL,
      page_number INTEGER NOT NULL,
      sheet_number TEXT, -- Drawing sheet number (e.g., A-101, S-3.1)
      detail_reference TEXT, -- Detail reference (e.g., "3/A-101")
      ocr_text TEXT, -- OCR extracted text from rasterized page
      image_path TEXT, -- Stored rasterized page image path
      content TEXT NOT NULL,
      embedding TEXT, -- JSON string of embedding vector
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    )
  `);

  // Chats table
  db.run(`
    CREATE TABLE IF NOT EXISTS chats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      title TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    )
  `);

  // Messages table
  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      role TEXT NOT NULL, -- 'user' or 'assistant'
      content TEXT NOT NULL,
      citations TEXT, -- JSON string of citation objects
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS callouts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL,
      page_number INTEGER NOT NULL,
      sheet_number TEXT,
      detail_reference TEXT NOT NULL,
      detail_number TEXT,
      target_sheet TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS visual_findings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL,
      page_number INTEGER NOT NULL,
      sheet_number TEXT,
      findings TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    )
  `);

  console.log('Database tables created successfully');
}

function saveDatabase() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

function getDatabase() {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

// Helper function to run queries and save
function runQuery(sql, params = []) {
  const result = db.run(sql, params);
  saveDatabase();
  return result;
}

function getQuery(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length > 0) {
    stmt.bind(params);
  }
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

function getOneQuery(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length > 0) {
    stmt.bind(params);
  }
  let result = null;
  if (stmt.step()) {
    result = stmt.getAsObject();
  }
  stmt.free();
  return result;
}

module.exports = {
  initDatabase,
  getDatabase,
  saveDatabase,
  runQuery,
  getQuery,
  getOneQuery
};
