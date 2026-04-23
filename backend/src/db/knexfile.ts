import 'dotenv/config';
import path from 'path';
import type { Knex } from 'knex';

const isTypeScript = __filename.endsWith('.ts');

const config: Knex.Config = {
  client: 'pg',
  connection: process.env.DATABASE_URL || {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || 'opsatlas',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  },
  migrations: {
    directory: path.join(__dirname, 'migrations'),
    extension: isTypeScript ? 'ts' : 'js',
  },
};

export default config;
