const express = require('express');
const app = express();
const cors = require('cors');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const AdmZip = require('adm-zip');
const rateLimiters = {};

const port = process.env.PORT || 5000;

// Middleware
app.use(express.json());
app.use(cors({
  origin: ["https://mern-job-portal-website.vercel.app"],
  methods: ["POST", "GET", "PATCH", "DELETE"],
  credentials: true
}));

// MongoDB setup
const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/mernJobPortal';
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

// Multer setup for resume uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname);
  }
});
const upload = multer({ storage: storage });

// --- Rate Limiting Middleware ---
function rateLimiter(req, res, next) {
  const user = req.headers['x-user'] || req.ip;
  const now = Date.now();
  if (!rateLimiters[user]) rateLimiters[user] = [];
  rateLimiters[user] = rateLimiters[user].filter(ts => now - ts < 60000);
  if (rateLimiters[user].length >= 60) {
    return res.status(429).json({ error: { code: 'RATE_LIMIT' } });
  }
  rateLimiters[user].push(now);
  next();
}
app.use(rateLimiter);

// --- Uniform Error Helper ---
function errorResponse(code, field, message, status=400) {
  return { status, json: { error: { code, field, message } } };
}

// --- Idempotency Middleware ---
const idempotencyCache = {};
function idempotency(req, res, next) {
  if (req.method === 'POST') {
    const key = req.headers['idempotency-key'];
    if (!key) return res.status(400).json({ error: { code: 'FIELD_REQUIRED', field: 'Idempotency-Key', message: 'Idempotency-Key is required' } });
    if (idempotencyCache[key]) {
      return res.status(200).json(idempotencyCache[key]);
    }
    res.sendResponse = res.json;
    res.json = (body) => {
      idempotencyCache[key] = body;
      res.sendResponse(body);
    };
  }
  next();
}
app.use(idempotency);

// --- Auth Endpoints (Mock) ---
app.post('/api/register', (req, res) => {
  const { email, password } = req.body;
  if (!email) return res.status(400).json(errorResponse('FIELD_REQUIRED', 'email', 'Email is required').json);
  if (!password) return res.status(400).json(errorResponse('FIELD_REQUIRED', 'password', 'Password is required').json);
  res.json({ user: { id: 'testid', email } });
});
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json(errorResponse('FIELD_REQUIRED', 'email/password', 'Email and password required').json);
  res.json({ token: 'mocktoken', user: { id: 'testid', email } });
});

// Root route
app.get('/', (req, res) => {
  res.send('Hello Developer');
});

async function run() {
  try {
    await client.connect();
    const db = client.db("mernJobPortal");
    const jobsCollections = db.collection("demoJobs");

    // Post a Job
    app.post("/post-job", async (req, res) => {
      const body = { ...req.body, createdAt: new Date() };
      const result = await jobsCollections.insertOne(body);
      if(result.insertedId){
        return res.status(200).send(result);
      } else {
        return res.status(500).send({ message: "Failed to post job", status: false });
      }
    });

    // Get all jobs
    app.get("/all-jobs", async (req, res) => {
      const jobs = await jobsCollections.find({}).toArray();
      res.send(jobs);
    });

    // Get single job by ID
    app.get("/all-jobs/:id", async (req, res) => {
      const id = req.params.id;
      const job = await jobsCollections.findOne({ _id: new ObjectId(id) });
      res.send(job);
    });

    // Get jobs by email
    app.get("/myJobs/:email", async (req, res) => {
      const jobs = await jobsCollections.find({ postedBy: req.params.email }).toArray();
      res.send(jobs);
    });

    // Delete a job
    app.delete("/job/:id", async (req, res) => {
      const id = req.params.id;
      const result = await jobsCollections.deleteOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    // Update a job
    app.patch("/update-job/:id", async (req, res) => {
      const id = req.params.id;
      const jobData = req.body;
      const result = await jobsCollections.updateOne(
        { _id: new ObjectId(id) },
        { $set: jobData },
        { upsert: true }
      );
      res.send(result);
    });

    // --- Resume Upload (with ZIP support) ---
    app.post('/api/resumes', upload.any(), async (req, res) => {
      let files = req.files || [];
      let resumeFiles = [];
      for (const file of files) {
        if (file.mimetype === 'application/zip') {
          const zip = new AdmZip(file.path);
          zip.getEntries().forEach(entry => {
            if (!entry.isDirectory) {
              const entryPath = path.join('uploads', Date.now() + '-' + entry.entryName);
              fs.writeFileSync(entryPath, entry.getData());
              resumeFiles.push({ filename: entry.entryName, path: entryPath });
            }
          });
        } else {
          resumeFiles.push(file);
        }
      }
      // Simulate parsing/embedding
      const parsed = resumeFiles.map(f => ({ id: Date.now() + Math.random(), filename: f.filename, text: 'parsed text', embedding: [0.1, 0.2] }));
      res.json({ items: parsed, next_offset: null });
    });

    // --- Resume List & Get ---
    let resumeDB = [];
    app.get('/api/resumes', (req, res) => {
      const { limit = 10, offset = 0, q } = req.query;
      let items = resumeDB;
      if (q) items = items.filter(r => r.text.includes(q));
      res.json({ items: items.slice(offset, offset + limit), next_offset: offset + limit < items.length ? offset + limit : null });
    });
    app.get('/api/resumes/:id', (req, res) => {
      const item = resumeDB.find(r => r.id == req.params.id);
      if (!item) return res.status(404).json(errorResponse('NOT_FOUND', 'id', 'Resume not found').json);
      res.json(item);
    });

    // --- Q&A Endpoint ---
    app.post('/api/ask', (req, res) => {
      const { query, k } = req.body;
      if (!query) return res.status(400).json(errorResponse('FIELD_REQUIRED', 'query', 'Query is required').json);
      // Simulate answer
      res.json({ answers: [{ text: 'Sample answer', evidence: 'Sample snippet' }] });
    });

    // --- Jobs Endpoints (with pagination) ---
    app.post('/api/jobs', (req, res) => {
      // ...simulate job creation...
      res.json({ id: Date.now(), ...req.body });
    });
    app.get('/api/jobs/:id', (req, res) => {
      // ...simulate job fetch...
      res.json({ id: req.params.id, title: 'Sample Job' });
    });

    // --- Job Match Endpoint ---
    app.post('/api/jobs/:id/match', (req, res) => {
      const { top_n } = req.body;
      // Simulate match
      res.json({ matches: [{ resume_id: 1, score: 0.95, evidence: 'Skill match', missing: [] }] });
    });

    // --- PII Redaction Helper ---
    function redactPII(text, isRecruiter) {
      if (isRecruiter) return text;
      return text.replace(/\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/g, '[REDACTED EMAIL]');
    }

    // Confirm connection
    await client.db("admin").command({ ping: 1 });
    console.log("Successfully connected to MongoDB!");
  } finally {
    // client.close() // Do NOT close client if server is running
  }
}

run().catch(console.dir);

// Start server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
