const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const log = require('electron-log');

class Database {
    constructor() {
        const dbPath = path.join(__dirname, 'shop_closing.db');
        const dbExists = fs.existsSync(dbPath);
        
        this.db = new sqlite3.Database(dbPath, (err) => {
            if (err) {
                log.error('Error opening database', err);
            } else {
                log.info('Database connected');
                if (!dbExists) {
                    this.init();
                }
            }
        });
    }

    init() {
        console.log('Initializing database...');
        this.db.serialize(() => {
            this.db.run(`CREATE TABLE IF NOT EXISTS opening_balance (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                amount REAL NOT NULL,
                date TEXT DEFAULT CURRENT_TIMESTAMP
            )`);

            this.db.run(`CREATE TABLE IF NOT EXISTS petty_cash (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                description TEXT NOT NULL,
                amount REAL NOT NULL,
                date TEXT DEFAULT CURRENT_TIMESTAMP
            )`);

            this.db.run(`CREATE TABLE IF NOT EXISTS purchase (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                description TEXT NOT NULL,
                type TEXT NOT NULL,
                amount REAL NOT NULL,
                date TEXT DEFAULT CURRENT_TIMESTAMP
            )`);

            this.db.run(`CREATE TABLE IF NOT EXISTS payment (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                description TEXT NOT NULL,
                amount REAL NOT NULL,
                date TEXT DEFAULT CURRENT_TIMESTAMP
            )`);

            this.db.run(`CREATE TABLE IF NOT EXISTS closing_balance (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                amount REAL NOT NULL,
                date TEXT DEFAULT CURRENT_TIMESTAMP
            )`);

            this.db.run(`CREATE TABLE IF NOT EXISTS sales (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                amount REAL NOT NULL,
                date TEXT DEFAULT CURRENT_TIMESTAMP
            )`);
        });
    }

    async getCurrentDate() {
        return new Promise((resolve, reject) => {
            this.db.get("SELECT date('now', 'localtime') as current_date", (err, row) => {
                if (err) reject(err);
                else resolve(row.current_date);
            });
        });
    }

    async getLatestEntryDate() {
        return new Promise((resolve, reject) => {
            this.db.get("SELECT MAX(date) as latest_date FROM (SELECT MAX(date) as date FROM opening_balance UNION SELECT MAX(date) as date FROM closing_balance UNION SELECT MAX(date) as date FROM sales UNION SELECT MAX(date) as date FROM purchase UNION SELECT MAX(date) as date FROM petty_cash UNION SELECT MAX(date) as date FROM payment)", (err, row) => {
                if (err) reject(err);
                else resolve(row.latest_date);
            });
        });
    }

    async insert(table, data) {
        const currentDate = await this.getCurrentDate();
        const latestEntryDate = await this.getLatestEntryDate();

        if (latestEntryDate && latestEntryDate !== currentDate) {
            throw new Error("Cannot add entries for previous dates. Please start a new closing session.");
        }

        return new Promise((resolve, reject) => {
            const keys = Object.keys(data).filter(key => key !== 'entry_type');
            const values = keys.map(key => data[key]);
            const placeholders = keys.map(() => '?').join(',');
            const sql = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${placeholders})`;
            
            log.info('Executing SQL:', sql);
            log.info('With values:', values);

            const stmt = this.db.prepare(sql);
            stmt.run(values, function(err) {
                if (err) {
                    log.error('Error inserting data:', err);
                    reject(err);
                } else {
                    log.info(`Inserted data into ${table} with ID: ${this.lastID}`);
                    resolve({ id: this.lastID });
                }
            });
            stmt.finalize();
        });
    }

    async select(table) {
        const currentDate = await this.getCurrentDate();
        return new Promise((resolve, reject) => {
            const sql = `SELECT * FROM ${table} WHERE date(date) = date(?)`;
            this.db.all(sql, [currentDate], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    update(table, id, data) {
        return new Promise((resolve, reject) => {
            const keys = Object.keys(data);
            const values = Object.values(data);
            const setClause = keys.map(key => `${key} = ?`).join(',');
            const sql = `UPDATE ${table} SET ${setClause} WHERE id = ?`;
            
            this.db.run(sql, [...values, id], function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({ changes: this.changes });
                }
            });
        });
    }

    delete(table, id) {
        return new Promise((resolve, reject) => {
            const sql = `DELETE FROM ${table} WHERE id = ?`;
            this.db.run(sql, [id], function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({ changes: this.changes });
                }
            });
        });
    }
}

module.exports = Database;
