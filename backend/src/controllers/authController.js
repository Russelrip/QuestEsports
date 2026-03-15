const bcrypt = require("bcryptjs");
const prisma = require("../config/prisma");

const signup = async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      email,
      username,
      password,
      phone,
      discordTag,
    } = req.body;

    if (!firstName || !lastName || !email || !username || !password) {
      return res.status(400).json({
        success: false,
        message: "Please fill all required fields.",
      });
    }

    const existingEmail = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (existingEmail) {
      return res.status(400).json({
        success: false,
        message: "Email already exists.",
      });
    }

    const existingUsername = await prisma.user.findUnique({
      where: { username },
    });

    if (existingUsername) {
      return res.status(400).json({
        success: false,
        message: "Username already exists.",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await prisma.user.create({
      data: {
        firstName,
        lastName,
        email: email.toLowerCase(),
        username,
        password: hashedPassword,
        phone: phone || null,
        discordTag: discordTag || null,
      },
    });

    res.status(201).json({
      success: true,
      message: "Signup successful.",
    });
  } catch (error) {
    console.error("Signup error:", error);
    res.status(500).json({
      success: false,
      message: "Server error during signup.",
    });
  }
};

const login = async (req, res) => {
  try {
    const { emailOrUsername, password } = req.body;

    if (!emailOrUsername || !password) {
      return res.status(400).json({
        success: false,
        message: "Email/username and password are required.",
      });
    }

    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: emailOrUsername.toLowerCase() },
          { username: emailOrUsername },
        ],
      },
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials.",
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials.",
      });
    }

    res.status(200).json({
      success: true,
      message: "Login successful.",
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        username: user.username,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({
      success: false,
      message: "Server error during login.",
    });
  }
};

module.exports = {
  signup,
  login,
};