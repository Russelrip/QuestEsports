const express = require("express");
const cors = require("cors");
const path = require("path");
const authRoutes = require("./routes/authRoutes");
const contactRoutes = require("./routes/contactRoutes");
const tournamentRoutes = require("./routes/tournamentRoutes");

const app = express();

app.use(
  cors({
    origin: "http://localhost:3000",
    credentials: true,
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

app.get("/api/health", (req, res) => {
  res.json({ message: "Backend is running" });
});

app.use("/api", authRoutes);
app.use("/api", contactRoutes);
app.use("/api", tournamentRoutes);

module.exports = app;