
# Backend.js sample showing how to compare output from different LLMs


![Screenshot](screenshot.jpg)

### First Time Setup

1. This is example inside the backendjs repository, so first you need to clone it if it does not exist yet,
skip to the next item if you have it

  ```
  git clone --depth 1 https://github.com/vseryakov/backendjs.git
  ```

2. Navigate to the example:

  ```
  cd backendjs/examples/llm-compare
  ```

3.. Prepare and start the example, no external depencies are needed

  ```
  npm run setup
  npm run start
  ```

4. Visit [http://localhost:8000](http://localhost:8000)

## Tech Stack

- **Framework**: Backendjs
- **Database**: SQLite
- **Styling**: Bootstrap 5
- **UI/UX**: Alpinejs, Alpinejs-app


## Project Structure

```
src/
├── web/
│   ├── config.js      # Config component
│   ├── config.html    # Config HTML template
|   ├── index.js       # app startup code
│   └── index.html     # Home page
├── modules/
│   └── api.js         # Config module with routes
├── var/
    └── llms.db        # Local SQLite database
```

## Learn More

- [Backendjs Documentation](https://vseryakov.github.io/backendjs)
- [Alpinejs-app Documentation](https://github.com/vseryakov/alpinejs-app)
- [Alpine.js Documentation](https://alpinejs.dev/)
- [Boostrap Documentation](https://getboostrap.com/)

## License

MIT
