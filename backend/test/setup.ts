// Register ts-node so Knex can `require()` .ts migration files.
// Without this, Knex's internal import-file.js uses bare require() which
// doesn't understand TypeScript syntax (import type, etc.).
import 'ts-node/register/transpile-only';
