import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('dns_records', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('dns_connection_id')
      .notNullable()
      .references('id')
      .inTable('dns_connections')
      .onDelete('CASCADE');
    t.string('zone').notNullable();       // e.g. "example.com"
    t.string('zone_id').notNullable();    // provider zone ID
    t.string('record_id').notNullable();  // provider record ID (unique per provider)
    t.string('name').notNullable();       // e.g. "app.example.com"
    t.string('type').notNullable();       // 'A' | 'AAAA' | 'CNAME'
    t.string('value').notNullable();      // IP address or CNAME target
    t.integer('ttl').nullable();
    t.boolean('proxied').notNullable().defaultTo(false);
    t.timestamp('last_seen_at').notNullable().defaultTo(knex.fn.now());
    t.timestamps(true, true);
    t.unique(['dns_connection_id', 'record_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('dns_records');
}
