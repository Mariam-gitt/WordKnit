# WordKnit

WordKnit is a full-stack vocabulary learning platform designed to help you learn real words from the material you read. Upload a PDF, read it in-app, identify difficult words, save vocabulary, review with flashcards and quizzes, and ask AI-powered questions about your documents.

It blends a React frontend, a Node.js/Express API, MongoDB storage, and Python-based AI services to turn reading into a personalized language-learning workflow.



<img width="1912" height="874" alt="Screenshot (86)" src="https://github.com/user-attachments/assets/62a7fc1e-8bfd-407d-b602-1e309ec81771" />
<img width="1890" height="874" alt="Screenshot (88)" src="https://github.com/user-attachments/assets/80564a5e-ecb0-4b19-bc4f-c9eb3fcc4892" />
<img width="1899" height="876" alt="Screenshot (90)" src="https://github.com/user-attachments/assets/7ec40d41-66f4-4d30-bd41-78a1344c2ae4" />
<img width="1893" height="863" alt="Screenshot (84)" src="https://github.com/user-attachments/assets/b715c1ac-0832-49e4-b72b-9bc2211b19ee" />
<img width="1896" height="870" alt="Screenshot (87)" src="https://github.com/user-attachments/assets/723403c2-2c6f-4ad1-9eed-96bfee4631d9" />
<img width="1915" height="865" alt="Screenshot (89)" src="https://github.com/user-attachments/assets/9d74493e-ec54-4f35-a56a-6a7586ea4f84" />
<img width="1915" height="872" alt="Screenshot (85)" src="https://github.com/user-attachments/assets/46e392e3-7dd2-45e6-916a-e06c04ca800b" />


## Features

- PDF reading and analysis for difficult vocabulary
- In-document reading experience with bookmarks and saved highlights
- Vocabulary tracking with word meaning, usage context, and review status
- Flashcards and quiz-based revision
- Word profile pages with dictionary-style information and contextual explanations
- AI-powered contextual interpretation of words within a passage
- Document Q&A using retrieval + LLM workflows
- JWT-based authentication and user account management
- MongoDB-backed persistence for users, words, documents, and bookmarks
- Docker-based local setup for full-stack development

## Tech Stack

- Frontend: React 19, Vite, React Router
- Backend: Node.js, Express.js, MongoDB
- AI/ML: Python microservices, Groq API, retrieval-based document Q&A
- Auth: JWT + bcryptjs
- Deployment: Vercel + Docker

## Project Structure

```text
WordKnit/
├── backend/
│   ├── config/
│   ├── controllers/
│   ├── middleware/
│   ├── models/
│   ├── routes/
│   ├── utils/
│   ├── server.js
│   ├── package.json
│   ├── package-lock.json
│   ├── requirements.txt
│   ├── pdf_service.py
│   ├── rag_service.py
│   ├── rag_llm_service.py
│   ├── ocr_service.py
│   ├── Dockerfile
│   └── vercel.json
├── frontend/
│   ├── public/
│   ├── src/
│   ├── package.json
│   ├── package-lock.json
│   ├── vite.config.js
│   ├── index.html
│   ├── Dockerfile
│   ├── nginx.conf
│   └── README.md
├── docker-compose.yml
├── DOCKER.md
├── README.md
├── project-structure.md
└── .gitignore
```

## How It Works

### 1. Read and analyze a document
Users upload PDFs and open them inside the app. The backend extracts text, scores vocabulary difficulty, and identifies words that are likely challenging based on context and word characteristics.

### 2. Save and review vocabulary
Words can be added to the learner's personal vocabulary list. The app tracks meanings, examples, statuses, and review history.

### 3. Learn with interactive tools
The app supports flashcards, quizzes, and word profiles to reinforce understanding and retention.

### 4. Ask questions about what you read
WordKnit can explain a word in context, along with document-level Q&A powered by retrieval and LLM services.

### 5. Keep user context secure
Authentication is handled with JWTs, and user data is kept separate by account.

## Getting Started

### Prerequisites

- Node.js 18+
- Python 3.10+
- MongoDB Atlas or a local MongoDB instance
- Groq API key (for AI features)

### 1) Clone the repository

```bash
git clone https://github.com/Mariam-gitt/WordKnit.git
cd WordKnit
```

### 2) Backend setup

```bash
cd backend
npm install
pip install -r requirements.txt
```

Create a `.env` file:

```env
MONGO_URI=your_mongodb_connection_string
JWT_SECRET=your_secret_key
GROQ_API_KEY=your_groq_api_key
PORT=5000

# optional integrations
HUBSPOT_PRIVATE_APP_TOKEN=your_hubspot_token
RESEND_API_KEY=your_resend_key
```

Run the backend:

```bash
npm run dev
```

Optional Python services:

```bash
python rag_service.py
python rag_llm_service.py
```

### 3) Frontend setup

```bash
cd frontend
npm install
```

Create a `.env` file:

```env
REACT_APP_API_URL=http://localhost:5000
```

Start the frontend:

```bash
npm run dev
```

The app will run in development mode, usually at:

- Frontend: http://localhost:5173
- Backend: http://localhost:5000

### 4) Docker setup

From the project root:

```bash
docker-compose up --build
```

This starts the main services together for a local all-in-one setup.

## Main API Endpoints

The backend exposes endpoints for authentication, documents, vocabulary, quizzes, and AI-assisted learning.

### Authentication

- `POST /api/auth/register`
- `POST /api/auth/login`
- `DELETE /api/auth/account`

### Vocabulary and learning

- `GET /api/words`
- `POST /api/words`
- `PUT /api/words/:id`
- `DELETE /api/words/:id`
- `GET /api/quiz`
- `POST /api/quiz/submit`

### Documents and reading

- `POST /api/documents`
- `GET /api/documents`
- `PATCH /api/documents/:id`
- `POST /api/bookmarks`
- `GET /api/bookmarks`
- `POST /api/pdf/analyze-difficulty`

### AI-assisted features

- `POST /api/contextual/explain`
- `POST /api/ragl/upload`
- `POST /api/ragl/ask`
- `GET /api/profile/:word`
- `POST /api/speaking/...` (speech-based learning workflow)

## Database Model

WordKnit stores core data in MongoDB, including:

- Users
- Words
- Documents
- Bookmarks

This allows each user to maintain a personal vocabulary library tied to their reading and learning activity.

## Security

- Passwords are hashed before storage
- JWT tokens are used for authentication
- Protected routes are checked through middleware
- External integrations are designed to fail gracefully without breaking core account flows

## Docker

See `DOCKER.md` for the full container setup and troubleshooting steps. The project includes Docker configuration for local containerized development.

## Notes

This project has evolved beyond a simple dictionary app into a more complete reading-and-learning workflow. It is built around the idea that vocabulary retention improves when words are encountered in context, reviewed repeatedly, and connected to authentic reading material.

## License

This project is distributed under the ISC license as defined in the package metadata.

## Author

Mariam

GitHub: https://github.com/Mariam-gitt
