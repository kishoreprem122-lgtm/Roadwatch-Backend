
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const dotenv = require("dotenv");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// MIDDLEWARE
const allowedOrigin = process.env.FRONTEND_URL || "*";
app.use(
  cors({
    origin: allowedOrigin,
    methods: ["GET", "POST", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// NEON POSTGRESQL CONNECTION
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// CREATE TABLES IF THEY DON'T EXIST
async function createTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS reports (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      damage_type VARCHAR(255) NOT NULL,
      latitude DECIMAL(11, 8) NOT NULL,
      longitude DECIMAL(11, 8) NOT NULL,
      image_path VARCHAR(500) DEFAULT '',
      status VARCHAR(50) DEFAULT 'Reported',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  console.log("Database tables ready.");
}

// CREATE UPLOADS FOLDER
const uploadsDirectory = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDirectory)) {
  fs.mkdirSync(uploadsDirectory, { recursive: true });
}
app.use("/uploads", express.static(uploadsDirectory));

// IMAGE UPLOAD CONFIGURATION
const storage = multer.diskStorage({
  destination: (req, file, callback) => {
    callback(null, uploadsDirectory);
  },
  filename: (req, file, callback) => {
    const extension = path.extname(file.originalname);
    callback(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${extension}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, callback) => {
    if (file.mimetype && file.mimetype.startsWith("image/")) {
      callback(null, true);
    } else {
      callback(new Error("Only image files are allowed."));
    }
  },
});

// HOME ROUTE
app.get("/", (req, res) => {
  res.send("RoadWatch AI Backend is running!");
});

// REGISTER
app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, password } = req.body || {};

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Name, email, and password are required.",
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 8 characters.",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Check if user exists
    const existing = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [normalizedEmail]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists.",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    await pool.query(
      "INSERT INTO users (name, email, password) VALUES ($1, $2, $3)",
      [name.trim(), normalizedEmail, hashedPassword]
    );

    console.log("User registered:", normalizedEmail);

    return res.status(201).json({
      success: true,
      message: "Registration successful!",
    });
  } catch (error) {
    console.error("REGISTRATION ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Registration failed.",
      error: error.message,
    });
  }
});

// LOGIN
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required.",
      });
    }

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({
        success: false,
        message: "Server authentication configuration is missing.",
      });
    }

    const result = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      [email.trim().toLowerCase()]
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    const passwordMatches = await bcrypt.compare(password, user.password);

    if (!passwordMatches) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    const token = jwt.sign(
      { id: user.id },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    return res.status(200).json({
      success: true,
      message: "Login successful!",
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
    });
  } catch (error) {
    console.error("LOGIN ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Login failed.",
      error: error.message,
    });
  }
});

// SUBMIT ROAD DAMAGE REPORT
app.post("/api/reports", (req, res) => {
  console.log("\n========== REPORT REQUEST RECEIVED ==========");

  upload.single("image")(req, res, async (uploadError) => {
    if (uploadError) {
      console.error("IMAGE UPLOAD ERROR:", uploadError.message);
      return res.status(400).json({
        success: false,
        message: uploadError.message || "Image upload failed.",
      });
    }

    try {
      const { damageType, latitude, longitude } = req.body || {};

      if (
        !damageType ||
        latitude === undefined ||
        longitude === undefined ||
        latitude === "" ||
        longitude === "" ||
        !Number.isFinite(Number(latitude)) ||
        !Number.isFinite(Number(longitude))
      ) {
        return res.status(400).json({
          success: false,
          message: "Damage type and valid GPS coordinates are required.",
        });
      }

      const imagePath = req.file ? `/uploads/${req.file.filename}` : "";

      const result = await pool.query(
        `INSERT INTO reports (damage_type, latitude, longitude, image_path, status)
         VALUES ($1, $2, $3, $4, 'Reported') RETURNING *`,
        [String(damageType).trim(), Number(latitude), Number(longitude), imagePath]
      );

      const report = result.rows[0];
      console.log("REPORT SAVED SUCCESSFULLY:", report.id);

      return res.status(201).json({
        success: true,
        message: "Road damage report submitted successfully!",
        report: {
          _id: report.id,
          damageType: report.damage_type,
          latitude: report.latitude,
          longitude: report.longitude,
          imagePath: report.image_path,
          status: report.status,
          createdAt: report.created_at,
        },
      });
    } catch (error) {
      console.error("REPORT SUBMISSION ERROR:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to save road damage report.",
        error: error.message,
      });
    }
  });
});

// GET ALL REPORTS
app.get("/api/reports", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM reports ORDER BY created_at DESC"
    );

    const reports = result.rows.map((r) => ({
      _id: r.id,
      damageType: r.damage_type,
      latitude: r.latitude,
      longitude: r.longitude,
      imagePath: r.image_path,
      status: r.status,
      createdAt: r.created_at,
    }));

    return res.status(200).json({
      success: true,
      count: reports.length,
      reports,
    });
  } catch (error) {
    console.error("FETCH REPORTS ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch reports.",
      error: error.message,
    });
  }
});

// UPDATE REPORT STATUS
app.patch("/api/reports/:id", async (req, res) => {
  try {
    const { status } = req.body || {};

    const allowedStatuses = [
      "Reported",
      "Under Review",
      "In Progress",
      "Resolved",
      "Rejected",
    ];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid report status.",
      });
    }

    const result = await pool.query(
      `UPDATE reports SET status = $1, updated_at = NOW()
       WHERE id = $2 RETURNING *`,
      [status, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Report not found.",
      });
    }

    const r = result.rows[0];

    return res.status(200).json({
      success: true,
      message: "Report status updated successfully!",
      report: {
        _id: r.id,
        damageType: r.damage_type,
        latitude: r.latitude,
        longitude: r.longitude,
        imagePath: r.image_path,
        status: r.status,
        createdAt: r.created_at,
      },
    });
  } catch (error) {
    console.error("UPDATE REPORT ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update report.",
      error: error.message,
    });
  }
});

// GENERAL ERROR HANDLER
app.use((error, req, res, next) => {
  console.error("SERVER ERROR:", error);
  if (res.headersSent) return next(error);
  return res.status(500).json({
    success: false,
    message: "An unexpected server error occurred.",
  });
});

// START SERVER
async function startServer() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is missing from backend/.env");
    process.exit(1);
  }

  try {
    await pool.connect();
    console.log("Connected to Neon PostgreSQL!");
    await createTables();

    app.listen(PORT, () => {
      console.log(`RoadWatch AI Backend running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Database connection failed:", error.message);
    process.exit(1);
  }
}

startServer();
