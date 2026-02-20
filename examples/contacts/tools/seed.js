const { db, shell } = require('backendjs');

const contacts = [];

for (let i = 10; i < 45; i++) {
    contacts.push({ first_name: `first${i}`, last_name: `last${i}`, email: `email${i}@email.com`, phone: `55555500${i}` })
}

async function seed() {
  console.log('Seeding database...');

  // Insert new data
  await db.batch(contacts.map(query => ({ table: "contacts", query })));

  shell.exit(0, 'Database seeded successfully!');
}

seed().catch(shell.exit);

