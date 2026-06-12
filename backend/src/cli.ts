/**
 * OpsAtlas admin CLI — user management without going through the web UI.
 *
 * Development:  npm run cli -- <command> [args]
 * Production:   node dist/cli.js <command> [args]
 * Docker:       docker compose exec backend node dist/cli.js <command> [args]
 *
 * Commands:
 *   list-users
 *   create-admin <email> [--password <pw>]
 *   create-viewer <email> [--password <pw>]
 *   reset-password <email> [--password <pw>]
 *   set-role <email> <admin|viewer>
 *   disable-mfa <email>
 *
 * When --password is omitted the password is prompted interactively (hidden input).
 */
import 'dotenv/config';
import bcrypt from 'bcrypt';
import db from './db';

const SALT_ROUNDS = 12; // keep in sync with routes/auth.ts
const MIN_PASSWORD_LENGTH = 8;

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exitCode = 1;
  throw new ExitError();
}

class ExitError extends Error {}

function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const value = args[i + 1];
  if (!value || value.startsWith('--')) fail(`--${name} requires a value`);
  args.splice(i, 2);
  return value;
}

/** Prompt with hidden input (no echo). Falls back to error when stdin is not a TTY. */
function promptHidden(question: string): Promise<string> {
  if (!process.stdin.isTTY) {
    fail('stdin is not a TTY — pass the password via --password instead');
  }
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    stdin.resume();
    stdin.setRawMode(true);
    let buf = '';
    const onData = (chunk: Buffer) => {
      const c = chunk.toString('utf8');
      if (c === '\n' || c === '\r' || c === '\u0004') {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.off('data', onData);
        process.stdout.write('\n');
        resolve(buf);
      } else if (c === '\u0003') { // Ctrl+C
        stdin.setRawMode(false);
        process.stdout.write('\n');
        process.exit(130);
      } else if (c === '\u007f' || c === '\b') {
        buf = buf.slice(0, -1);
      } else {
        buf += c;
      }
    };
    stdin.on('data', onData);
  });
}

async function resolvePassword(args: string[]): Promise<string> {
  let password = getFlag(args, 'password');
  if (!password) {
    password = await promptHidden('Password: ');
    const confirm = await promptHidden('Confirm password: ');
    if (password !== confirm) fail('passwords do not match');
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    fail(`password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  return password;
}

async function requireUser(email: string) {
  const user = await db('users').where({ email }).first();
  if (!user) fail(`no user with email ${email}`);
  return user;
}

async function listUsers(): Promise<void> {
  const users = await db('users')
    .select('email', 'role', 'sso_provider', 'mfa_enabled', 'created_at')
    .orderBy('created_at', 'asc');

  if (users.length === 0) {
    console.log('No users.');
    return;
  }
  for (const u of users) {
    const auth = u.sso_provider ? `sso:${u.sso_provider}` : 'password';
    const mfa = u.mfa_enabled ? 'mfa:on' : 'mfa:off';
    console.log(`${u.email}\t${u.role ?? 'admin'}\t${auth}\t${mfa}`);
  }
}

async function createUser(email: string, role: 'admin' | 'viewer', args: string[]): Promise<void> {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(`invalid email: ${email}`);
  const existing = await db('users').where({ email }).first();
  if (existing) fail(`user ${email} already exists (role: ${existing.role}) — use reset-password or set-role`);

  const password = await resolvePassword(args);
  const password_hash = await bcrypt.hash(password, SALT_ROUNDS);
  await db('users').insert({ email, password_hash, role });
  console.log(`Created ${role} user ${email}`);
}

async function resetPassword(email: string, args: string[]): Promise<void> {
  await requireUser(email);
  const password = await resolvePassword(args);
  const password_hash = await bcrypt.hash(password, SALT_ROUNDS);
  await db('users').where({ email }).update({ password_hash });
  console.log(`Password updated for ${email}`);
}

async function setRole(email: string, role: string): Promise<void> {
  if (role !== 'admin' && role !== 'viewer') fail(`role must be admin or viewer, got: ${role}`);
  await requireUser(email);
  await db('users').where({ email }).update({ role });
  console.log(`${email} is now ${role}`);
}

async function disableMfa(email: string): Promise<void> {
  const user = await requireUser(email);
  if (!user.mfa_enabled) {
    console.log(`MFA is already disabled for ${email}`);
    return;
  }
  await db('users').where({ email }).update({ mfa_enabled: false, mfa_secret: null });
  console.log(`MFA disabled for ${email}`);
}

function usage(): void {
  console.log(`OpsAtlas admin CLI

Usage:
  list-users
  create-admin <email> [--password <pw>]
  create-viewer <email> [--password <pw>]
  reset-password <email> [--password <pw>]
  set-role <email> <admin|viewer>
  disable-mfa <email>

Without --password you will be prompted interactively (input hidden).`);
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case 'list-users':
      await listUsers();
      break;
    case 'create-admin':
      if (!args[0]) fail('usage: create-admin <email> [--password <pw>]');
      await createUser(args[0], 'admin', args.slice(1));
      break;
    case 'create-viewer':
      if (!args[0]) fail('usage: create-viewer <email> [--password <pw>]');
      await createUser(args[0], 'viewer', args.slice(1));
      break;
    case 'reset-password':
      if (!args[0]) fail('usage: reset-password <email> [--password <pw>]');
      await resetPassword(args[0], args.slice(1));
      break;
    case 'set-role':
      if (!args[0] || !args[1]) fail('usage: set-role <email> <admin|viewer>');
      await setRole(args[0], args[1]);
      break;
    case 'disable-mfa':
      if (!args[0]) fail('usage: disable-mfa <email>');
      await disableMfa(args[0]);
      break;
    default:
      usage();
      if (command) process.exitCode = 1;
  }
}

main()
  .catch((err: unknown) => {
    if (!(err instanceof ExitError)) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exitCode = 1;
    }
  })
  .finally(() => db.destroy());
