const prisma = require("../config/prisma");

const submitContact = async (req, res) => {
  try {
    const { name, email, subject, message } = req.body;

    if (!name || !email || !subject || !message) {
      return res.status(400).json({
        success: false,
        message: "All contact fields are required.",
      });
    }

    await prisma.contactMessage.create({
      data: {
        name,
        email,
        subject,
        message,
      },
    });

    res.status(201).json({
      success: true,
      message: "Message received successfully",
    });
  } catch (error) {
    console.error("Contact error:", error);
    res.status(500).json({
      success: false,
      message: "Server error while saving contact message.",
    });
  }
};

module.exports = {
  submitContact,
};