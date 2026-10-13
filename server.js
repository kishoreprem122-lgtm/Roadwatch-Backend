
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const jwt = require("jsonwebtoken");

const User = require("./models/User");
const Report = require("./models/Report");

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

// MONGODB CONNECTION MONITORING
mongoose.connection.on("connected", () => {
  console.log("MongoDB connection established.");
});

mongoose.connection.on("disconnected", () => {
  console.log("WARNING: MongoDB disconnected!");
});

mongoose.connection.on("error", (error) => {
  console.error("MongoDB connection error:", error.message);
});

// CONNECT TO MONGODB
async function startServer() {
  if (!process.env.MONGO_URI) {
    console.error("MONGO_URI is missing from backend/.env");
    process.exit(1);
  }

  try {
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
    });

    console.log("MongoDB connected successfully!");
    console.log("MongoDB connection state:", mongoose.connection.readyState);

    app.listen(PORT, () => {
      console.log(`RoadWatch AI Backend running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("MongoDB connection failed:", error.message);
    process.exit(1);
  }
}

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

    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        success: false,
        message: "Database is not connected.",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existingUser = await User.findOne({ email: normalizedEmail });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists.",
      });
    }

    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      password,
    });

    console.log("User registered:", user.email);

    return res.status(201).json({
      success: true,
      message: "Registration successful!",
    });
  } catch (error) {
    console.error("REGISTRATION ERROR:", error);

    return res.status(error.code === 11000 ? 409 : 500).json({
      success: false,
      message:
        error.code === 11000
          ? "An account with this email already exists."
          : "Registration failed.",
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

    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        success: false,
        message: "Database is not connected.",
      });
    }

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({
        success: false,
        message: "Server authentication configuration is missing.",
      });
    }

    const user = await User.findOne({
      email: email.trim().toLowerCase(),
    });

    if (!user || typeof user.comparePassword !== "function") {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    const passwordMatches = await user.comparePassword(password);

    if (!passwordMatches) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    const token = jwt.sign(
      { id: user._id.toString() },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    return res.status(200).json({
      success: true,
      message: "Login successful!",
      token,
      user: {
        id: user._id,
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
      console.log("REPORT DATA:", req.body);
      console.log("IMAGE RECEIVED:", Boolean(req.file));
      console.log("MONGODB STATE:", mongoose.connection.readyState);

      if (mongoose.connection.readyState !== 1) {
        return res.status(503).json({
          success: false,
          message: "Database is not connected.",
          connectionState: mongoose.connection.readyState,
        });
      }

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

      const reportData = {
        damageType: String(damageType).trim(),
        latitude: Number(latitude),
        longitude: Number(longitude),
        imagePath: req.file ? `/uploads/${req.file.filename}` : "",
        status: "Reported",
      };

      console.log("DATA TO SAVE:", reportData);

      const report = await Report.create(reportData);

      console.log("REPORT SAVED SUCCESSFULLY:", report._id);

      return res.status(201).json({
        success: true,
        message: "Road damage report submitted successfully!",
        report,
      });
    } catch (error) {
      console.error("REPORT SUBMISSION ERROR:", error);
      console.error("ERROR NAME:", error.name);
      console.error("ERROR MESSAGE:", error.message);

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
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        success: false,
        message: "Database is not connected.",
      });
    }

    const reports = await Report.find().sort({ createdAt: -1 });

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

    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid report ID.",
      });
    }

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid report status.",
      });
    }

    const report = await Report.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true, runValidators: true }
    );

    if (!report) {
      return res.status(404).json({
        success: false,
        message: "Report not found.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Report status updated successfully!",
      report,
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

  if (res.headersSent) {
    return next(error);
  }

  return res.status(500).json({
    success: false,
    message: "An unexpected server error occurred.",
  });
});

// START AFTER DATABASE CONNECTS
startServer();
