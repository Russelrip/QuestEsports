const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors({
  origin: "http://localhost:3000",
  credentials: true,
}));

app.use(express.json());

app.get("/api/health", (req, res) => {
  res.json({ message: "Backend is running" });
});

app.post("/api/contact", (req, res) => {
  const { name, email, subject, message } = req.body;

  console.log("Contact form received:", {
    name,
    email,
    subject,
    message,
  });

  res.status(200).json({
    success: true,
    message: "Message received successfully",
  });
});

app.post("/api/signup", (req, res) => {
  const {
    firstName,
    lastName,
    email,
    username,
    password,
    phone,
    discordTag,
  } = req.body;

  console.log("Signup form received:", {
    firstName,
    lastName,
    email,
    username,
    password,
    phone,
    discordTag,
  });

  res.status(200).json({
    success: true,
    message: "Signup successful",
  });
});

module.exports = app;