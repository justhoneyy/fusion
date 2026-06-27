const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

let pool;

function getPool() {
    if (!pool) {
        pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
            max: 20,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 10000
        });

        pool.on('error', (err) => {
            console.error('Unexpected database pool error:', err);
        });
    }
    return pool;
}

// Export query function
module.exports.query = async (text, params) => {
    const client = await getPool().connect();
    try {
        const result = await client.query(text, params);
        return result;
    } catch (err) {
        console.error('Database query error:', err);
        throw err;
    } finally {
        client.release();
    }
};

// Initialize database - run schema
module.exports.initDatabase = async () => {
    try {
        const schemaPath = path.join(__dirname, '..', 'database', 'schema.sql');
        const schema = fs.readFileSync(schemaPath, 'utf8');
        
        console.log('Initializing database schema...');
        await this.query(schema);
        console.log('Database schema initialized successfully.');
    } catch (err) {
        console.error('Database initialization error:', err);
        throw err;
    }
};

// Transaction helper
module.exports.transaction = async (callback) => {
    const client = await getPool().connect();
    try {
        await client.query('BEGIN');
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
};

// Health check
module.exports.healthCheck = async () => {
    try {
        await this.query('SELECT 1');
        return { status: 'ok', timestamp: new Date().toISOString() };
    } catch (err) {
        return { status: 'error', message: err.message };
    }
};
