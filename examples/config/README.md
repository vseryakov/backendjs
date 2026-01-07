
# Backend.js sample config CRUD app with Alpine.js

## Tech Stack

- **Framework**: Backendjs
- **Database**: SQLite / PostgreSQL
- **Styling**: Bootstrap 5
- **UI/UX**: Alpinejs, Alpinejs-app

### First Time Setup

```bash
npm install
npm run init
npm run initdb
npm run start
```

Visit [http://localhost:8000](http://localhost:8000)

Login as user "admin" with password "Test12345!"


### Subsequent Runs

```bash
npm run start
```

### Re-create local Database (SQLite)

```bash
rm config.db
npm run initdb
```

## API Endpoints

The following API endpoints are exposed by the app:

Default endpoints implemented by the api.users module:

  - POST /auth
  - POST /login
  - POST /logout

Config endpoints implemeted by the module:

  - GET /config/list
  - POST /config/put
  - PUT /config/update
  - POST /coonfig/del

## Project Structure

```
src/
├── web/
│   ├── config.js      # Config component
│   ├── config.html    # Config HTML template
|   ├── index.js       # app startup code
│   └── index.html     # Home page
├── modules/
│   └── config.js      # Config module with routes
config.db              # Local SQLite database
```

## Features

- ✅ Create, edit, and delete config records
- ✅ Responsive design with Bootstrap theme
- ✅ Alpinejs-app for dynamic updates
- ✅ Alpinejs custom magic $user
- ✅ Input validation
- ✅ Bootstratp dialogs
- ✅ Error handling with loading states
- ✅ Dual-database support (SQLite + PostgreSQL)

## Learn More

- [Backendjs Documentation](https://vseryakov.github.io/backendjs)
- [Alpinejs-app Documentation](https://github.com/vseryakov/alpinejs-app)
- [Alpine.js Documentation](https://alpinejs.dev/)
- [Boostrap Documentation](https://getboostrap.com/)

## License

MIT
