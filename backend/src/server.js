require("dotenv").config();
const app = require("./app");

const PORT = process.env.PORT || 5001;

// Start the Express app after environment variables have been loaded.
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
