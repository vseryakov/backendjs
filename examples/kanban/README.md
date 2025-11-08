# Kanban Board - Alpine.js Implementation

A full-featured Kanban board application built with Alpine.js and Alpinejs-app, featuring drag-and-drop, real-time updates, and SQLite/PostgreSQL persistence.

## Tech Stack

- **Framework**: Backendjs with Alpinejs-app
- **Database**: SQLite (local) / PostgreSQL (production)
- **Deployment**: Cloudflare Pages
- **Styling**: Tailwind CSS + Bootstrap 5
- **Drag & Drop**: @formkit/drag-and-drop
- **Animations**: @formkit/auto-animate
- **Charts**: charts.css
- **Validation**: Valibot

## Local Development

The app uses a dual-database setup:
- **Local Development**: node:sqlite
- **Production**: PostgreSQL

### First Time Setup

```bash
npm install
npm run setup  # Resets, migrates, and seeds the SQLite database
npm run dev
```

Visit [http://localhost:8000](http://localhost:8000)

> **Note**: Migration files are included in the repo, so you don't need to generate them.

### Subsequent Runs

```bash
npm run dev
```

## Database Setup

The app uses a dual-database setup:
- **Local Development**: node:sqlite
- **Production**: PostgreSQL

### Local Database (SQLite)

```bash
npm run setup  # This automatically resets, migrates, and seeds
```

## Project Structure

```
src/
├── web/
│   ├── card.js        # Card component
│   ├── board.js       # Board component
│   └── index.html     # Home page
├── modules/
│   ├── board.js       # Board API
│   └── card.js        # Card API
tools/
└── seed.js            # DB seed file
/tmp/kanban.db         # Local SQLite database
```

## Features

- ✅ Create and manage multiple boards
- ✅ Four fixed lists per board (Todo, In-Progress, QA, Done)
- ✅ Create, edit, and delete cards
- ✅ Drag-and-drop cards within and between lists
- ✅ Assign users to cards
- ✅ Add tags to cards with color coding
- ✅ Add comments to cards
- ✅ Mark cards as complete
- ✅ Responsive design with Bootstrap theme
- ✅ Board overview charts
- ✅ Alpinejs-app for dynamic updates
- ✅ Locality of behavior with inline event handlers
- ✅ Native HTML dialogs
- ✅ Error handling with loading states
- ✅ Dual-database support (SQLite + PostgreSQL)

## Learn More

- [Backendjs Documentation](https://vseryakov.github.io/backendjs/docs/web/index.html)
- [Alpinejs-app Documentation](https://github.com/vseryakov/alpinejs-app)
- [Alpine.js Documentation](https://alpinejs.dev/)
- [Boostrap Documentation](https://getboostrap.com/)

## License

MIT
