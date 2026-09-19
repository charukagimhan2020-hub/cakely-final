require("dotenv").config();

// Render runs this file directly. The API module conditionally mounts the
// built frontend before its API 404 handler when this flag is present.
process.env.SERVE_FRONTEND = "true";
const { app } = require("./netlify/functions/api");

const port = Number(process.env.PORT || 8888);

app.listen(port, "0.0.0.0", () => {
  console.log(`Cakely server listening on port ${port}`);
});
