require("dotenv").config();

const { app } = require("./netlify/functions/api");

const port = Number(process.env.PORT || 8888);
app.listen(port, "0.0.0.0", () => {
  console.log(`Cakely API listening on port ${port}`);
});
