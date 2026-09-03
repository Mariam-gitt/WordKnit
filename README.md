# 📚 WordKnit - Vocabulary Learning Platform

A full-stack **MERN application** that transforms how users learn new words through interactive flashcards, AI-powered context generation, and intelligent quizzing. Learn vocabulary faster with multiple learning methods including PDF parsing, image OCR, and contextual meaning generation.

**Live Demo:** [my-mern-project-backend.vercel.app](https://my-mern-project-backend.vercel.app)

---

## ✨ Key Features

- 🎯 **Smart Flashcards** - Review words with spaced repetition tracking
- 🧠 **Interactive Quizzes** - Multiple-choice quizzes with performance analytics
- 📄 **PDF Text Extraction** - Upload PDFs to automatically extract and learn words
- 🖼️ **Image OCR** - Extract text from images using Optical Character Recognition
- 🤖 **AI-Powered Contexts** - Get intelligent example sentences and contextual meanings via LLM
- 🔍 **RAG Retrieval** - Retrieval-Augmented Generation for semantically similar contexts
- 📊 **Progress Tracking** - Monitor learning stats (correct/wrong counts, review dates)
- 🔐 **Secure Authentication** - JWT-based user authentication with password encryption
- 🎨 **Responsive Design** - Works seamlessly on desktop and mobile devices
- 🐳 **Docker Support** - Easy deployment with Docker and Docker Compose

---

## 🏗️ Architecture Overview

### Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Frontend** | React 19, React Router v7, Axios | Interactive UI & API communication |
| **Backend** | Node.js, Express.js | REST API server |
| **Database** | MongoDB (Cloud) | User data & vocabulary storage |
| **AI Services** | Python (Flask/FastAPI) | OCR, PDF parsing, RAG embeddings, LLM context |
| **Deployment** | Docker, Vercel | Containerization & cloud hosting |
| **Security** | bcryptjs, JWT | Password hashing & token authentication |

### Project Structure

```
WordKnit/
├── frontend/                         # React SPA
│   ├── src/
│   │   ├── pages/                   # Route pages
│   │   │   ├── Login.js             # User authentication
│   │   │   ├── Register.js          # User signup
│   │   │   ├── Dashboard.js         # Main hub
│   │   │   ├── Vocabulary.js        # Word management
│   │   │   ├── Flashcards.js        # Card-based learning
│   │   │   ├── Quiz.js              # Quiz module
│   │   │   ├── PDFReader.js         # PDF text extraction
│   │   │   ├── OCR.js               # Image text extraction
│   │   │   ├── WordProfile.js       # Word details
│   │   │   └── ContextualMeaning.js # AI contexts
│   │   ├── components/              # Reusable React components
│   │   ├── hooks/                   # Custom React hooks
│   │   ├── api.js                   # Axios client
│   │   └── App.js                   # Main router
│   ├── package.json
│   └── Dockerfile
│
├── backend/                          # Node.js + Express API
│   ├── config/
│   │   └── db.js                    # MongoDB connection
│   ├── models/
│   │   ├── User.js                  # User schema
│   │   └── Word.js                  # Word schema
│   ├── controllers/                 # Business logic
│   │   ├── authController.js
│   │   ├── wordController.js
│   │   ├── quizController.js
│   │   └── ...
│   ├── routes/                      # API endpoints
│   │   ├── authRoutes.js
│   │   ├── wordRoutes.js
│   │   ├── quizRoutes.js
│   │   ├── pdfRoutes.js
│   │   ├── ocrRoutes.js
│   │   └── ragRoutes.js
│   ├── middleware/
│   │   └── authMiddleware.js        # JWT verification
│   ├── ocr_service.py               # Python OCR service
│   ├── pdf_service.py               # Python PDF parser
│   ├── rag_service.py               # Python RAG embeddings
│   ├── rag_llm_service.py           # Python LLM context
│   ├── server.js                    # Express app entry
│   ├── package.json
│   ├── requirements.txt
│   └── Dockerfile
│
├── docker-compose.yml               # Multi-container setup
├── DOCKER.md                        # Docker guide
└── project-structure.md             # Detailed architecture
```

---

## 🔄 How It Works

### 1. User Authentication
Users register/login with secure JWT token generation. Passwords are hashed using bcryptjs before storage in MongoDB.

```
Login → Backend validates credentials → JWT token generated → Stored in localStorage
→ All future requests include token in Authorization header
```

### 2. Word Management
Users can manually add words with meanings, examples, and synonyms. All words are tracked with learning status and quiz performance.

**CRUD Operations:**
- ✅ Create - Add new word via AddWord component
- ✅ Read - Fetch word list from MongoDB
- ✅ Update - Edit word details or mark as "learned"
- ✅ Delete - Remove words from collection

### 3. Interactive Learning

#### 📇 Flashcards
Review words one by one with front (word) and back (meaning) reveal. Mark as "Learned" or "Need Review" to update status.

#### 🎯 Quizzes
Backend generates random quiz questions with multiple-choice options. Tracks correct/wrong answers for performance analytics.

#### 📊 Progress Tracking
Every interaction updates the Word record in MongoDB with:
- Learning status ("review" / "learned")
- Correct answer count
- Wrong answer count
- Last reviewed date

### 4. Multi-Input Learning Methods

#### 📄 PDF Text Extraction
1. User uploads PDF via PDFReader page
2. Backend receives file via multer middleware
3. Python `pdf_service.py` extracts all text content
4. Frontend displays extracted text
5. Users can select and add words to vocabulary

#### 🖼️ Image OCR
1. User uploads image via OCR page
2. Backend processes image with Python `ocr_service.py`
3. Tesseract/Paddle OCR detects text in image
4. Extracted text displayed for word addition

### 5. AI-Powered Context Generation

#### 🤖 LLM Contextual Meanings
Calls `rag_llm_service.py` which prompts an LLM (GPT/Claude) to generate:
- Example sentences using the word
- Contextual usage patterns
- Related terminology

#### 🔍 RAG Context Retrieval
`rag_service.py` converts words to vector embeddings and searches a RAG database to retrieve:
- Similar word contexts
- Related examples
- Semantic associations

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** 18+ 
- **Python** 3.8+
- **MongoDB** (Cloud account or local)
- **Docker** (optional, for containerized setup)

### Installation

#### 1. Clone Repository

```bash
git clone https://github.com/Mariam-gitt/WordKnit.git
cd WordKnit
```

#### 2. Backend Setup

```bash
cd backend

# Install Node dependencies
npm install

# Install Python dependencies
pip install -r requirements.txt

# Create .env file
cat > .env << EOF
MONGO_URI=mongodb+srv://your_username:your_password@cluster.mongodb.net/wordknit
JWT_SECRET=your_secret_key_here
NODE_ENV=development
PORT=5000
EOF

# Start backend server
npm run dev      # With auto-reload (development)
# OR
npm start        # Production mode
```

#### 3. Frontend Setup

```bash
cd ../frontend

# Install React dependencies
npm install

# Create .env file
cat > .env << EOF
REACT_APP_API_URL=http://localhost:5000
EOF

# Start React development server
npm start
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Docker Setup (Recommended)

```bash
# Build and run all services
docker-compose up --build

# Stop services
docker-compose down
```

This will start:
- MongoDB container
- Backend server (port 5000)
- Frontend server (port 3000)

---

## 📊 Key API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| **POST** | `/api/auth/register` | Create new account |
| **POST** | `/api/auth/login` | User login |
| **GET** | `/api/words` | Fetch all user words |
| **POST** | `/api/words` | Add new word |
| **PUT** | `/api/words/:id` | Update word details |
| **DELETE** | `/api/words/:id` | Delete word |
| **GET** | `/api/quiz` | Get quiz questions |
| **POST** | `/api/quiz/submit` | Submit quiz answer |
| **POST** | `/api/pdf/upload` | Upload & extract PDF text |
| **POST** | `/api/ocr/extract` | Extract text from image |
| **GET** | `/api/rag/context` | Get RAG-based contexts |
| **GET** | `/api/ragl/context` | Get LLM-generated contexts |

---

## 🗄️ Database Schema

### User Collection
```javascript
{
  _id: ObjectId,
  name: String,        // User's full name
  email: String,       // Unique email
  password: String,    // Hashed with bcryptjs
  createdAt: Date,
  updatedAt: Date
}
```

### Word Collection
```javascript
{
  _id: ObjectId,
  userId: ObjectId,              // Reference to User
  word: String,                  // The vocabulary word
  meaning: String,               // Definition
  exampleSentence: String,       // Usage example
  synonyms: [String],            // Related words
  status: String,                // "review" or "learned"
  correctCount: Number,          // Quiz correct answers
  wrongCount: Number,            // Quiz wrong answers
  lastReviewed: Date,            // Last flashcard review
  createdAt: Date,
  updatedAt: Date
}
```

---

## 🔐 Security Features

- **Password Hashing** - bcryptjs (12-round salt)
- **JWT Authentication** - Secure token-based auth
- **Protected Routes** - `authMiddleware` verifies tokens
- **Environment Variables** - Sensitive data in `.env`
- **CORS Configuration** - Controlled cross-origin requests

---

## 🧪 Testing

### Run Frontend Tests
```bash
cd frontend
npm test
```

### Run Backend with Nodemon
```bash
cd backend
npm run dev  # Auto-restarts on file changes
```

---

## 📈 Project Composition

```
JavaScript: 73.5% ████████████████████
CSS:        17.2% ████
Python:      8.6% ██
Other:       0.7% 
```

---

## 🌐 Deployment

### Vercel (Frontend Recommended)
```bash
# Frontend deployment
vercel deploy
```

### Backend Deployment Options
- **Vercel** - Serverless Node.js
- **Heroku** - Classic PaaS
- **AWS** - EC2 or Lambda
- **DigitalOcean** - VPS
- **Self-hosted** - Any Node.js server

### Environment Variables to Set
**Frontend:**
- `REACT_APP_API_URL` - Backend API URL

**Backend:**
- `MONGO_URI` - MongoDB connection string
- `JWT_SECRET` - Secret for token signing
- `NODE_ENV` - development/production
- `PORT` - Server port (default 5000)

---

## 🐛 Troubleshooting

### Issue: Can't connect to MongoDB
**Solution:**
- Verify MongoDB URI in `.env`
- Check internet connection (for cloud MongoDB)
- Ensure IP is whitelisted in MongoDB Atlas

### Issue: JWT token errors
**Solution:**
- Clear browser localStorage
- Ensure token is being sent in Authorization header
- Check JWT_SECRET matches between login & middleware

### Issue: PDF/OCR not working
**Solution:**
- Install Python dependencies: `pip install -r requirements.txt`
- Verify Python version 3.8+
- Check Tesseract installation for OCR

### Issue: React can't reach backend
**Solution:**
- Verify backend server is running (port 5000)
- Check `REACT_APP_API_URL` in `.env`
- Ensure CORS is enabled in Express

---

## 🤝 Contributing

Contributions are welcome! Follow these steps:

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes
4. Commit: `git commit -m 'Add amazing feature'`
5. Push: `git push origin feature/amazing-feature`
6. Open a Pull Request

---

## 📚 Learning Resources

- **React 19** - [react.dev](https://react.dev)
- **Express.js** - [expressjs.com](https://expressjs.com)
- **MongoDB** - [mongodb.com/docs](https://www.mongodb.com/docs)
- **JWT** - [jwt.io](https://jwt.io)
- **Docker** - [docker.com/resources](https://www.docker.com/resources)

---

## 🎯 Roadmap

Future enhancements:

- [ ] Spaced repetition algorithm for optimal review scheduling
- [ ] Analytics dashboard for learning progress
- [ ] Multiplayer quizzes & leaderboards
- [ ] Mobile app (React Native)
- [ ] Voice pronunciation & audio recognition
- [ ] Community word lists & sharing
- [ ] Email notifications for review reminders
- [ ] Dark mode theme

---

## 📄 License

This project is open source and available under the **ISC License**.

---

## 👤 Author

**Mariam** - [GitHub Profile](https://github.com/Mariam-gitt)

---

## 💡 Highlights
 
*"WordKnit is a MERN stack vocabulary learning platform that combines traditional learning methods (flashcards, quizzes) with AI-powered features (LLM context generation, RAG embeddings). It supports multiple input methods including PDF parsing and image OCR, with JWT authentication and progress tracking."*

**Key Technical Achievements:**
✅ Full-stack MERN development  
✅ Python microservices for AI/ML tasks  
✅ JWT token-based security  
✅ MongoDB data modeling & aggregation  
✅ PDF & image text extraction  
✅ Docker containerization  
✅ RESTful API design  

---

