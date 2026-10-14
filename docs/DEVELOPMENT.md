# WordKnit Development Guide

This guide explains how to run, develop, and troubleshoot the WordKnit project locally.

## 1. Project overview

WordKnit is a full-stack vocabulary learning app that helps users learn words from what they read. The project combines:

- a React frontend for the learning experience
- an Express backend for APIs and business logic
- MongoDB for persistent data
- AI-assisted contextual word support
- Docker-based local setup for development

## 2. Tech stack

### Frontend

- React 19
- Vite
- React Router
- Axios
- Radix UI primitives
- custom CSS styling

### Backend

- Node.js
- Express 5
- MongoDB with Mongoose
- JWT auth with cookies
- bcryptjs for password hashing
- rate limiting and security middleware

### AI/document processing

- Python services
- PDF parsing and extraction
- contextual word support
- Groq / external AI integrations

## 3. Repository structure

```text
WordKnit/
├── backend/
│   ├── config/
│   ├── middleware/
│   ├── models/
│   ├── routes/
│   ├── services/
│   ├── tests/
│   ├── utils/
│   ├── validators/
│   ├── server.js
│   ├── package.json
│   ├── requirements.txt
│   ├── pdf_service.py
│   ├── ocr_service.py
│   ├── Dockerfile
│   └── vercel.json
├── frontend/
│   ├── public/
│   ├── src/
│   ├── package.json
│   ├── vite.config.js
│   ├── Dockerfile
│   ├── nginx.conf
│   └── README.md
├── docs/
│   ├── ARCHITECTURE.md
│   └── DEVELOPMENT.md
├── docker-compose.yml
├── DOCKER.md
├── README.md
├── .gitignore
└── .github/
```

## 4. Prerequisites

Before developing locally, install:

- Node.js 18+
- npm
- Python 3.10+
- MongoDB (local or Atlas)
- Git
- optional: Docker Desktop if using containerized setup

## 5. Local setup

### 5.1 Clone the project

```bash
git clone https://github.com/Mariam-gitt/WordKnit.git
cd WordKnit
```

### 5.2 Backend setup

```bash
cd backend
npm install
pip install -r requirements.txt
```

Then create a `.env` file inside `backend/`:

```env
MONGO_URI=your_mongodb_connection_string
JWT_SECRET=your_secret_key
GROQ_API_KEY=your_groq_api_key
PORT=5000
FRONTEND_URL=http://localhost:5173
```

Optional settings:

```env
# cookie behavior
# COOKIE_SAMESITE=lax
# COOKIE_SECURE=false

# PDF settings
# MAX_PDF_MB=11
```

Run backend:

```bash
npm run dev
```

Expected local API URL:

- http://localhost:5000

### 5.3 Frontend setup

```bash
cd ../frontend
npm install
```

Create a `.env` file inside `frontend/` if needed:

```env
VITE_API_URL=http://localhost:5000/api
```

Then run the frontend:

```bash
npm run dev
```

Expected local app URL:

- http://localhost:5173

## 6. Running tests

From the backend folder:

```bash
cd backend
npm test
```

The project uses Jest for backend tests. Keep tests focused on API behavior, auth flows, and model logic.

## 7. Docker setup

From the repo root:

```bash
docker-compose up --build
```

This is a convenient way to start the app stack together for local development and quick validation.

For more details, see `DOCKER.md`.

## 8. Common workflow for development

### Starting work

1. Pull the latest code
2. create a branch
3. install dependencies
4. run MongoDB
5. start backend and frontend
6. test critical flows

Example:

```bash
git checkout -b feature/my-new-feature
cd backend && npm run dev
cd ../frontend && npm run dev
```

### During feature work

- keep backend and frontend concerns separate
- follow route -> controller -> model logic structure
- validate API responses before UI integration
- test auth and protected routes carefully
- avoid hardcoding secrets into code

## 9. Backend conventions

The backend is structured with route-level organization and middleware-based protections.

### Typical backend flow

1. request enters `server.js`
2. CORS, headers, cookies, and origin checks run
3. DB connection is ensured
4. route module handles the request
5. model/database logic executes
6. response is returned via Express

### Key route groups

- `/api/auth` — login and registration
- `/api/words` — vocabulary management
- `/api/documents` — document handling
- `/api/bookmarks` — saved reading positions
- `/api/profile` — word profiles and contextual pages
- `/api/pdf` — document analysis
- `/api/contextual` — AI-based explanations
- `/api/speaking` — speaking practice

## 10. Frontend conventions

The frontend uses React with route-level organization and a simple app shell.

### Main patterns

- `App.js` defines routes and protected page access
- `AuthContext.jsx` manages authentication state
- `api.js` centralizes API calls and cookie handling
- pages are lazy-loaded for better startup performance
- protected routes redirect users to login when session is invalid

## 11. Environment and configuration

### Backend config

Use environment variables for:

- database connection
- JWT secret
- frontend allowed origin
- AI API keys
- app port

### Frontend config

Use `VITE_API_URL` in local development so the frontend can connect to the right backend.

## 12. Typical troubleshooting

### Frontend cannot connect to backend

Check:

- backend is running
- `VITE_API_URL` matches backend URL
- CORS config includes the frontend origin
- server port is correct

### Login or session issues

Check:

- JWT secret is set
- cookies are enabled in the browser
- frontend and backend are using the same allowed origin settings
- backend is receiving the cookie with `withCredentials: true`

### MongoDB connection issues

Check:

- `MONGO_URI` is valid
- database is reachable from your environment
- if using Atlas, IP access is allowed

### PDF or AI feature issues

Check:

- required Python packages are installed
- Groq / AI keys are set
- backend environment variables are loaded correctly

## 13. Best practices for contributors

- keep features modular and easy to reason about
- follow existing route and file structure
- write clear commit messages
- add tests for logic-heavy backend features
- validate API behavior before adding UI polish
- avoid exposing secrets or API keys in source files

## 14. Suggested next improvements

As the project grows, useful additions include:

- better user analytics and progress tracking
- stronger unit and integration coverage
- more modular AI service architecture
- improved error monitoring and logging
- docs for deployment and release flow

## 15. Final note

This project is a strong beginner-to-midlevel full-stack portfolio app. A clean architecture, realistic features, and proper documentation make it a solid example of practical software engineering work.
